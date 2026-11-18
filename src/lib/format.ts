// Formatting in the ka-GE style. Work dates follow the Asia/Tbilisi calendar.
//
// Deliberately not Intl: browsers ship different locale data, and a browser without ka-GE falls
// back to English ("1.5", "11/18/2026"). That shows the wrong format and breaks hydration, since
// the server renders "1,5". These functions give the same result as Node's ka-GE Intl output
// on every runtime: decimal comma, no-break-space thousands groups from five integer digits on
// (4415,00 but 12 345,00), dd.mm.yyyy dates.
export const TIME_ZONE = "Asia/Tbilisi";
/** Georgia is UTC+4 all year (no daylight saving time since 2005). */
const TBILISI_OFFSET_MS = 4 * 60 * 60 * 1000;
const NBSP = "\u00a0";

const pad2 = (n: number) => String(n).padStart(2, "0");

/** Calendar fields of a UTC instant shifted to Tbilisi time. */
function tbilisiParts(d: Date) {
  const t = new Date(d.getTime() + TBILISI_OFFSET_MS);
  return {
    y: t.getUTCFullYear(),
    m: t.getUTCMonth() + 1,
    d: t.getUTCDate(),
    hh: t.getUTCHours(),
    mm: t.getUTCMinutes(),
  };
}

/** Timestamp (UTC instant) shown in Tbilisi time: "18.11.2026, 14:02". */
export function formatDateTime(d: Date): string {
  const p = tbilisiParts(d);
  return `${pad2(p.d)}.${pad2(p.m)}.${p.y}, ${pad2(p.hh)}:${pad2(p.mm)}`;
}

/** Timestamp shown as a Tbilisi calendar date: "18.11.2026". */
export function formatDate(d: Date): string {
  const p = tbilisiParts(d);
  return `${pad2(p.d)}.${pad2(p.m)}.${p.y}`;
}

/** A @db.Date value (stored as UTC midnight) shown without timezone shifting. */
export const formatWorkDate = (d: Date) =>
  `${pad2(d.getUTCDate())}.${pad2(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`;

/** "YYYY-MM-DD" work date (as in <input type="date">) shown as "dd.mm.yyyy". */
export function formatIsoDate(s: string): string {
  const d = parseWorkDate(s);
  return d ? formatWorkDate(d) : s;
}

/** Today's calendar date in Tbilisi as YYYY-MM-DD. */
export function todayInTbilisi(now = new Date()): string {
  const p = tbilisiParts(now);
  return `${p.y}-${pad2(p.m)}-${pad2(p.d)}`;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** "YYYY-MM-DD" → Date at UTC midnight (the storage form of @db.Date), or null if invalid. */
export function parseWorkDate(s: string): Date | null {
  if (!DATE_RE.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : d;
}

/** @db.Date value → "YYYY-MM-DD" for <input type="date">. */
export function workDateToInput(d: Date | null | undefined): string {
  return d ? d.toISOString().slice(0, 10) : "";
}

/**
 * The UTC instant when a Tbilisi calendar day starts (Georgia is UTC+4 all year, no DST).
 * Used to filter timestamps by Tbilisi dates.
 */
export function tbilisiDayStart(s: string): Date | null {
  if (!parseWorkDate(s)) return null;
  return new Date(`${s}T00:00:00+04:00`);
}

// ─── Numbers ─────────────────────────────────────────────────────────────────

/**
 * Plain decimal string ("-12.5") of a value. Decimal strings from the database are kept exact;
 * numbers go through toString, with exponent notation expanded.
 */
function toPlainDecimal(v: string | number): string | null {
  let s = typeof v === "number" ? (Number.isFinite(v) ? String(v) : "") : v.trim();
  const exp = /^(-?)(\d+)(?:\.(\d+))?e([+-]\d+)$/i.exec(s);
  if (exp) {
    const [, sign, int, frac = "", e] = exp;
    const digits = int! + frac;
    const point = int!.length + Number(e);
    s =
      point <= 0
        ? `${sign}0.${"0".repeat(-point)}${digits}`
        : point >= digits.length
          ? `${sign}${digits}${"0".repeat(point - digits.length)}`
          : `${sign}${digits.slice(0, point)}.${digits.slice(point)}`;
  }
  return /^-?\d+(?:\.\d+)?$/.test(s) ? s : null;
}

/** Round half away from zero (as Intl does) to `maxFrac` decimals, keep at least `minFrac`. */
function roundDecimal(s: string, minFrac: number, maxFrac: number) {
  const negative = s.startsWith("-");
  const [int0, frac0 = ""] = (negative ? s.slice(1) : s).split(".");
  let digits = int0! + frac0.padEnd(maxFrac, "0").slice(0, maxFrac);
  if ((frac0[maxFrac] ?? "0") >= "5") {
    // Add one to the last kept digit, carrying to the left.
    const arr = digits.split("").map(Number);
    let i = arr.length - 1;
    while (i >= 0 && arr[i] === 9) arr[i--] = 0;
    if (i >= 0) arr[i]! += 1;
    else arr.unshift(1);
    digits = arr.join("");
  }
  let int = digits.slice(0, digits.length - maxFrac).replace(/^0+(?=\d)/, "") || "0";
  let frac = digits.slice(digits.length - maxFrac).replace(/0+$/, "");
  frac = frac.padEnd(minFrac, "0");
  const isZero = /^0*$/.test(int + frac);
  if (int === "") int = "0";
  return { negative: negative && !isZero, int, frac };
}

/** Group thousands with a no-break space, only from five integer digits on (ka-GE rule). */
const groupInt = (int: string) =>
  int.length < 5 ? int : int.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);

function formatNumber(v: string | number, minFrac: number, maxFrac: number): string {
  const plain = toPlainDecimal(v);
  if (plain === null) return String(v);
  const { negative, int, frac } = roundDecimal(plain, minFrac, maxFrac);
  return `${negative ? "-" : ""}${groupInt(int)}${frac ? `,${frac}` : ""}`;
}

const CURRENCY_SYMBOLS: Record<string, string> = { GEL: "₾", USD: "US$", EUR: "€" };
const currencySymbol = (c: string) => CURRENCY_SYMBOLS[c] ?? c;

/** "4415,00 ₾", "12 345,00 US$". */
export function formatMoney(amount: string | number, currency: string): string {
  return `${formatNumber(amount, 2, 2)}${NBSP}${currencySymbol(currency)}`;
}

/** Unit prices are stored with up to 4 decimals; show them all (at least 2). */
export function formatUnitPrice(amount: string | number, currency: string): string {
  return `${formatNumber(amount, 2, 4)}${NBSP}${currencySymbol(currency)}`;
}

/** "1,5", "12 345,678". */
export function formatQuantity(q: string | number): string {
  return formatNumber(q, 0, 3);
}
