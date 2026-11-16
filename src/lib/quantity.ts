// Parsing of user-entered quantities. Accepts a decimal comma or point ("12,5" / "12.5").
// Stored as Decimal(14,3): up to 11 integer digits and 3 decimals.

const QUANTITY_RE = /^\d{1,11}(\.\d{1,3})?$/;

/** Normalize a user quantity to a canonical decimal string, or return null if invalid. */
export function normalizeQuantity(raw: unknown): string | null {
  if (typeof raw === "number") raw = String(raw);
  if (typeof raw !== "string") return null;
  const s = raw.trim().replace(/\s+/g, "").replace(",", ".");
  if (!QUANTITY_RE.test(s)) return null;
  // Strip leading zeros of the integer part and trailing zeros of the fraction.
  const [int = "0", frac = ""] = s.split(".");
  const intPart = int.replace(/^0+(?=\d)/, "");
  const fracPart = frac.replace(/0+$/, "");
  return fracPart ? `${intPart}.${fracPart}` : intPart;
}

export function isPositiveQuantity(q: string): boolean {
  return /[1-9]/.test(q);
}

// Unit prices: Decimal(14,4), up to 10 integer digits and 4 decimals. Zero is allowed.
const PRICE_RE = /^\d{1,10}(\.\d{1,4})?$/;

/** Normalize a user unit price to a canonical decimal string, or return null if invalid. */
export function normalizePrice(raw: unknown): string | null {
  if (typeof raw === "number") raw = String(raw);
  if (typeof raw !== "string") return null;
  const s = raw.trim().replace(/\s+/g, "").replace(",", ".");
  if (!PRICE_RE.test(s)) return null;
  const [int = "0", frac = ""] = s.split(".");
  const intPart = int.replace(/^0+(?=\d)/, "");
  const fracPart = frac.replace(/0+$/, "");
  return fracPart ? `${intPart}.${fracPart}` : intPart;
}
