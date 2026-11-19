// Minimal SOAP 1.1 client for the RS.ge WayBill service (read-only buyer operations).
// Operation and parameter names come from the official service page
// https://services.rs.ge/WayBillService/WayBillService.asmx. The service returns most results as
// an untyped XML fragment, so the parsing below is tolerant: element names are matched without
// regard to case and a waybill is any element that carries a WAYBILL_NUMBER child.
import { XMLParser } from "fast-xml-parser";

export const RS_ENDPOINT = "https://services.rs.ge/WayBillService/WayBillService.asmx";
const NS = "http://tempuri.org/";
const TIMEOUT_MS = 15_000;

/** A waybill as BuildFlow uses it, whatever the RS.ge field spelling. */
export type RsWaybill = {
  id: string;
  number: string;
  sellerTin: string;
  sellerName: string;
  /** Calendar day (YYYY-MM-DD, Tbilisi) the waybill was activated or created. */
  date: string | null;
  amount: string | null;
  status: RsWaybillStatus;
};

/** RS.ge waybill status codes: 0 saved, 1 active, 2 closed, -1 deleted, -2 deactivated. */
export type RsWaybillStatus = "SAVED" | "ACTIVE" | "CLOSED" | "DELETED" | "DEACTIVATED" | "OTHER";

export class RsTransportError extends Error {
  constructor(public readonly kind: "timeout" | "http" | "network" | "fault" | "auth") {
    super(`RS.ge ${kind}`);
    this.name = "RsTransportError";
  }
}

const escapeXml = (s: string) => s.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * SOAP 1.1 envelope. Parameters with `undefined` are left out: the .NET service then uses the
 * type's default (empty string, minimum date), which it treats as "no filter".
 */
export function buildEnvelope(operation: string, params: [string, string | undefined][]): string {
  const body = params
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `<${k}>${escapeXml(v!)}</${k}>`)
    .join("");
  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ' +
    'xmlns:xsd="http://www.w3.org/2001/XMLSchema" ' +
    'xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">' +
    `<soap:Body><${operation} xmlns="${NS}">${body}</${operation}></soap:Body></soap:Envelope>`
  );
}

const parser = new XMLParser({
  ignoreAttributes: true,
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: true,
  // Never expand entities beyond the XML built-ins (no DTD tricks from a remote response).
  processEntities: true,
  htmlEntities: false,
});

type Node = string | number | boolean | null | Node[] | { [k: string]: Node };

export function parseXml(xml: string): Node {
  return parser.parse(xml) as Node;
}

/** Depth-first search for the first value under a key (case-insensitive). */
export function findKey(node: Node, key: string): Node | undefined {
  const want = key.toLowerCase();
  if (Array.isArray(node)) {
    for (const n of node) {
      const r = findKey(n, key);
      if (r !== undefined) return r;
    }
  } else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) if (k.toLowerCase() === want) return v;
    for (const v of Object.values(node)) {
      const r = findKey(v, key);
      if (r !== undefined) return r;
    }
  }
  return undefined;
}

/** All objects that carry a WAYBILL_NUMBER field, anywhere in the tree. */
export function collectWaybills(node: Node): RsWaybill[] {
  const out: RsWaybill[] = [];
  const visit = (n: Node) => {
    if (Array.isArray(n)) return n.forEach(visit);
    if (!n || typeof n !== "object") return;
    const upper = Object.fromEntries(Object.entries(n).map(([k, v]) => [k.toUpperCase(), v]));
    if ("WAYBILL_NUMBER" in upper) {
      const w = toWaybill(upper);
      if (w) out.push(w);
      return;
    }
    Object.values(n).forEach(visit);
  };
  visit(node);
  return out;
}

const text = (v: Node | undefined) =>
  v === undefined || v === null || typeof v === "object" ? "" : String(v).trim();

const STATUS: Record<string, RsWaybillStatus> = {
  "0": "SAVED",
  "1": "ACTIVE",
  "2": "CLOSED",
  "-1": "DELETED",
  "-2": "DEACTIVATED",
};

function toWaybill(f: Record<string, Node>): RsWaybill | null {
  const number = text(f.WAYBILL_NUMBER);
  if (!number) return null;
  const amount = text(f.FULL_AMOUNT).replace(",", ".");
  return {
    id: text(f.ID) || number,
    number,
    sellerTin: text(f.SELLER_TIN),
    sellerName: text(f.SELLER_NAME),
    date:
      rsDate(text(f.ACTIVATE_DATE)) ?? rsDate(text(f.BEGIN_DATE)) ?? rsDate(text(f.CREATE_DATE)),
    amount: /^-?\d+(\.\d+)?$/.test(amount) ? amount : null,
    status: STATUS[text(f.STATUS)] ?? "OTHER",
  };
}

/** RS.ge dates are local Tbilisi date-times like 2026-11-18T14:05:00; keep the calendar day. */
export function rsDate(v: string): string | null {
  const day = /^(\d{4}-\d{2}-\d{2})/.exec(v)?.[1];
  return day && !day.startsWith("0001") ? day : null;
}

/** POST one operation and return the parsed SOAP body. Credentials never reach the logs. */
export async function callRs(
  operation: string,
  params: [string, string | undefined][],
  fetchImpl: typeof fetch = fetch,
): Promise<Node> {
  let res: Response;
  try {
    res = await fetchImpl(RS_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        SOAPAction: `"${NS}${operation}"`,
      },
      body: buildEnvelope(operation, params),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (e) {
    throw new RsTransportError(
      e instanceof Error && e.name === "TimeoutError" ? "timeout" : "network",
    );
  }
  const body = await res.text();
  if (!res.ok) throw new RsTransportError(/<faultstring/i.test(body) ? "fault" : "http");
  return parseXml(body);
}

// ─── Goods lines of one waybill (get_waybill) ────────────────────────────────

/** One goods line of a waybill. Quantities and prices as decimal strings. */
export type RsGoods = {
  name: string;
  unit: string;
  quantity: string;
  unitPrice: string | null;
};

/**
 * RS.ge unit codes (get_waybill_units). Not confirmed against a live account: the unit text
 * (UNIT_TXT) is preferred whenever the answer carries one, and an unknown code stays visible.
 */
const RS_UNITS: Record<string, string> = {
  "1": "ცალი",
  "2": "კგ",
  "3": "გ",
  "4": "ლიტრი",
  "5": "ტონა",
  "7": "სმ",
  "8": "მ",
  "9": "კმ",
  "10": "სმ²",
  "11": "მ²",
  "12": "მ³",
  "13": "მლ",
};

const decimal = (v: string) => {
  const s = v.replace(/\s/g, "").replace(",", ".");
  return /^\d{1,14}(\.\d+)?$/.test(s) ? s : null;
};

/** Up to 4 decimals (the precision stored for waybill lines), rounded half up. */
function round4(s: string): string {
  const [i = "0", f = ""] = s.split(".");
  if (f.length <= 4) return f.replace(/0+$/, "") ? `${i}.${f.replace(/0+$/, "")}` : i;
  const scaled = BigInt(i + f.slice(0, 4)) + (Number(f[4]) >= 5 ? 1n : 0n);
  const t = scaled.toString().padStart(5, "0");
  const out = `${t.slice(0, -4)}.${t.slice(-4)}`.replace(/0+$/, "").replace(/\.$/, "");
  return out;
}

/** All goods lines (objects with a W_NAME field) anywhere in the tree, in document order. */
export function collectGoods(node: Node): RsGoods[] {
  const out: RsGoods[] = [];
  const visit = (n: Node) => {
    if (Array.isArray(n)) return n.forEach(visit);
    if (!n || typeof n !== "object") return;
    const upper = Object.fromEntries(Object.entries(n).map(([k, v]) => [k.toUpperCase(), v]));
    if ("W_NAME" in upper) {
      const name = text(upper.W_NAME);
      const quantity = decimal(text(upper.QUANTITY));
      if (name && quantity) {
        const price = decimal(text(upper.PRICE));
        const unitCode = text(upper.UNIT_ID);
        out.push({
          name: name.slice(0, 300),
          unit: (text(upper.UNIT_TXT) || RS_UNITS[unitCode] || `ერთეული ${unitCode}`).slice(0, 40),
          quantity: round4(quantity),
          unitPrice: price ? round4(price) : null,
        });
      }
      return;
    }
    Object.values(n).forEach(visit);
  };
  visit(node);
  return out;
}
