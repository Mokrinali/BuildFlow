// RS.ge clients behind one interface: LIVE calls the WayBill service with the organization's
// service user; DEMO returns made-up waybills so the feature can be shown without a company
// account. Both are read-only: BuildFlow never creates, confirms or rejects waybills on RS.ge.
import { createHash } from "node:crypto";
import { todayInTbilisi } from "@/lib/format";
import { canonicalUnit, mulDecimal } from "@/lib/unit-convert";
import {
  callRs,
  collectGoods,
  collectWaybills,
  findKey,
  RsTransportError,
  type RsGoods,
  type RsWaybill,
} from "@/server/rs/soap";

/**
 * What the delivery is expected to hold (order lines and quantities). Only the demo client uses
 * it, to make up goods that look like the order; the live client reads the real waybill.
 */
export type RsGoodsHint = { name: string; unit: string; quantity: string; unitPrice: string };

export interface RsClient {
  /** True when the service user and password are accepted. */
  checkUser(): Promise<boolean>;
  /** Waybills issued to us by `sellerTin`, created between two calendar days (inclusive). */
  buyerWaybills(sellerTin: string, from: string, to: string): Promise<RsWaybill[]>;
  /** One waybill by its number, or null. `sellerTin` only narrows the demo data. */
  waybillByNumber(number: string, sellerTin: string): Promise<RsWaybill | null>;
  /** Goods lines of one waybill (by its RS.ge id). */
  waybillGoods(waybill: Pick<RsWaybill, "id" | "number">, hint: RsGoodsHint[]): Promise<RsGoods[]>;
}

// ─── Live ────────────────────────────────────────────────────────────────────

/** The service answers errors in a result as a negative number (an RS.ge error code). */
function assertNoErrorCode(result: unknown) {
  if (typeof result === "string" && /^-\d+$/.test(result.trim())) {
    throw new RsTransportError("fault");
  }
}

export function liveClient(su: string, sp: string, fetchImpl: typeof fetch = fetch): RsClient {
  const auth: [string, string][] = [
    ["su", su],
    ["sp", sp],
  ];
  return {
    async checkUser() {
      const body = await callRs("chek_service_user", auth, fetchImpl);
      return String(findKey(body, "chek_service_userResult") ?? "").toLowerCase() === "true";
    },
    async buyerWaybills(sellerTin, from, to) {
      const body = await callRs(
        "get_buyer_waybills",
        [
          ...auth,
          ["seller_tin", sellerTin],
          ["create_date_s", `${from}T00:00:00`],
          ["create_date_e", `${to}T23:59:59`],
        ],
        fetchImpl,
      );
      const result = findKey(body, "get_buyer_waybillsResult");
      assertNoErrorCode(result);
      return result === undefined ? [] : collectWaybills(result);
    },
    async waybillByNumber(number) {
      const body = await callRs(
        "get_waybill_by_number",
        [...auth, ["waybill_number", number]],
        fetchImpl,
      );
      const result = findKey(body, "get_waybill_by_numberResult");
      assertNoErrorCode(result);
      if (result === undefined) return null;
      return collectWaybills(result).find((w) => w.number === number) ?? null;
    },
    async waybillGoods(waybill) {
      const body = await callRs("get_waybill", [...auth, ["waybill_id", waybill.id]], fetchImpl);
      const result = findKey(body, "get_waybillResult");
      assertNoErrorCode(result);
      return result === undefined ? [] : collectGoods(result);
    },
  };
}

// ─── Demo ────────────────────────────────────────────────────────────────────

/** Days before today on which the demo supplier "issued" a waybill. */
const DEMO_DAYS = [0, 2, 5, 9, 16, 24, 40];

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The made-up waybills of one supplier: stable for a given day, different per supplier code. */
export function demoWaybills(sellerTin: string, today = todayInTbilisi()): RsWaybill[] {
  return DEMO_DAYS.map((ago, i) => {
    const date = addDays(today, -ago);
    const h = createHash("sha256").update(`${sellerTin}|${date}`).digest();
    const number = String(h.readUInt32BE(0) % 9_000_000_000).padStart(10, "0");
    const amount = ((h.readUInt32BE(4) % 900_000) / 100 + 50).toFixed(2);
    return {
      id: `demo-${number}`,
      number,
      sellerTin,
      sellerName: "",
      date,
      amount,
      status: i < 2 ? "ACTIVE" : "CLOSED",
    };
  });
}

/**
 * Made-up goods of a demo waybill, shaped like the expected delivery so that matching can be
 * shown: tonnes are written in kilograms (as suppliers often do), and on some waybills one line
 * is 10% short, so the comparison has something to warn about. Stable per waybill number.
 */
export function demoGoods(waybillNumber: string, hint: RsGoodsHint[]): RsGoods[] {
  const h = createHash("sha256").update(`goods|${waybillNumber}`).digest();
  const short = h.readUInt8(0) % 2 === 0 && hint.length ? h.readUInt8(1) % hint.length : -1;
  return hint.map((g, i) => {
    let quantity = i === short ? mulDecimal(g.quantity, "0.9") : g.quantity;
    let unit = g.unit;
    let unitPrice = g.unitPrice;
    if (canonicalUnit(unit) === "ტონა") {
      unit = "კგ";
      quantity = mulDecimal(quantity, "1000");
      unitPrice = mulDecimal(unitPrice, "0.001", 4);
    }
    return { name: g.name, unit, quantity, unitPrice };
  });
}

export function demoClient(today?: string): RsClient {
  return {
    async checkUser() {
      return true;
    },
    async buyerWaybills(sellerTin, from, to) {
      return demoWaybills(sellerTin, today).filter((w) => w.date! >= from && w.date! <= to);
    },
    async waybillByNumber(number, sellerTin) {
      return demoWaybills(sellerTin, today).find((w) => w.number === number) ?? null;
    },
    async waybillGoods(waybill, hint) {
      return demoGoods(waybill.number, hint);
    },
  };
}
