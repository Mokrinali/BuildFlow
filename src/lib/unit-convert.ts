// Unit conversion between a supplier's waybill and an order line (client-safe, no server imports).
// Only physical units convert by themselves (kg ↔ t, l ↔ m³, cm ↔ m…). Package units (bag,
// bundle, pallet) depend on the product, so their factor is entered once by a person and then
// remembered for that supplier's goods.

type Dim = "mass" | "volume" | "length" | "area" | "count";

/** Canonical unit → [dimension, size in the dimension's base unit]. */
const UNITS: Record<string, [Dim, number]> = {
  გ: ["mass", 0.001],
  კგ: ["mass", 1],
  ტონა: ["mass", 1000],
  მლ: ["volume", 0.001],
  ლიტრი: ["volume", 1],
  "მ³": ["volume", 1000],
  მმ: ["length", 0.001],
  სმ: ["length", 0.01],
  მ: ["length", 1],
  კმ: ["length", 1000],
  "სმ²": ["area", 0.0001],
  "მ²": ["area", 1],
  ცალი: ["count", 1],
};

// Spellings seen in the app and on RS.ge waybills (lower-cased, without dots and spaces).
const ALIASES: [RegExp, string][] = [
  [/^(გ|გრ|გრამი?|g)$/u, "გ"],
  [/^(კგ|კილოგრამი?|კილო|kg)$/u, "კგ"],
  [/^(ტ|ტონა|ტონ|t)$/u, "ტონა"],
  [/^(მლ|მილილიტრი|ml)$/u, "მლ"],
  [/^(ლ|ლიტრი|ლიტ|l)$/u, "ლიტრი"],
  [/^(მ3|მ³|კუბმ|კუბმეტრი|კუბი|კუბ|m3|m³)$/u, "მ³"],
  [/^(მმ|მილიმეტრი|mm)$/u, "მმ"],
  [/^(სმ|სანტიმეტრი|cm)$/u, "სმ"],
  [/^(მ|მეტრი|გრძმ|m)$/u, "მ"],
  [/^(კმ|კილომეტრი|km)$/u, "კმ"],
  [/^(კვსმ|სმ2|სმ²|cm2)$/u, "სმ²"],
  [/^(მ2|მ²|კვმ|კვმეტრი|კვადრატი|m2|m²)$/u, "მ²"],
  [/^(ც|ცალი|ცლ|შტ|pcs|ერთეული)$/u, "ცალი"],
];

/** The canonical spelling of a unit, or the trimmed text when it is not a known physical unit. */
export function canonicalUnit(raw: string): string {
  const key = raw.trim().toLowerCase().replace(/[.\s]/g, "");
  for (const [re, unit] of ALIASES) if (re.test(key)) return unit;
  return raw.trim();
}

/**
 * Factor that turns a quantity in `from` into `to` (as a decimal string), or null when the
 * conversion depends on the product (e.g. bag → kg) or the units are unrelated.
 */
export function unitFactor(from: string, to: string): string | null {
  const a = canonicalUnit(from);
  const b = canonicalUnit(to);
  if (a === b) return "1";
  const ua = UNITS[a];
  const ub = UNITS[b];
  if (!ua || !ub || ua[0] !== ub[0]) return null;
  return trimDecimal((ua[1] / ub[1]).toFixed(6));
}

/** Same unit after canonicalization. */
export const sameUnit = (a: string, b: string) => canonicalUnit(a) === canonicalUnit(b);

function trimDecimal(s: string): string {
  return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
}

// ─── Exact decimal arithmetic on strings (quantities and factors) ────────────

const SCALE = 10;
const toInt = (s: string): bigint => {
  const neg = s.startsWith("-");
  const [i = "0", f = ""] = s.replace("-", "").split(".");
  const v = BigInt(i + f.padEnd(SCALE, "0").slice(0, SCALE));
  return neg ? -v : v;
};
const fromInt = (v: bigint, decimals: number): string => {
  const neg = v < 0n;
  let a = neg ? -v : v;
  // Round half up to `decimals`.
  const drop = 10n ** BigInt(SCALE - decimals);
  a = (a + drop / 2n) / drop;
  const s = a.toString().padStart(decimals + 1, "0");
  const out = decimals ? `${s.slice(0, -decimals)}.${s.slice(-decimals)}` : s;
  const t = trimDecimal(out);
  return neg && t !== "0" ? `-${t}` : t;
};

/** a × b rounded to `decimals` places (default 3, the precision of stored quantities). */
export function mulDecimal(a: string, b: string, decimals = 3): string {
  return fromInt((toInt(a) * toInt(b)) / 10n ** BigInt(SCALE), decimals);
}

/** Sum rounded to `decimals` places. */
export function sumDecimal(values: string[], decimals = 3): string {
  return fromInt(
    values.reduce((s, v) => s + toInt(v), 0n),
    decimals,
  );
}

/** Positive decimal factor with up to 6 decimals (e.g. "0.001", "25"), or null. */
export function normalizeFactor(raw: unknown): string | null {
  if (typeof raw === "number") raw = String(raw);
  if (typeof raw !== "string") return null;
  const s = raw.trim().replace(/\s+/g, "").replace(",", ".");
  if (!/^\d{1,9}(\.\d{1,6})?$/.test(s) || !/[1-9]/.test(s)) return null;
  const [i = "0", f = ""] = s.split(".");
  const int = i.replace(/^0+(?=\d)/, "");
  const frac = f.replace(/0+$/, "");
  return frac ? `${int}.${frac}` : int;
}
