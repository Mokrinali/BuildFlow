// Common Georgian units for construction materials. Users may also type their own.
export const COMMON_UNITS = [
  "ცალი",
  "ტომარა",
  "კგ",
  "ტონა",
  "მ",
  "მ²",
  "მ³",
  "ლიტრი",
  "კომპლექტი",
  "შეკვრა",
  "რულონი",
  "ფურცელი",
  "ღერი",
  "ყუთი",
  "პალეტი",
] as const;

/** Human-readable request number, e.g. 12 → "№0012". */
export function formatRequestNumber(n: number): string {
  return `№${String(n).padStart(4, "0")}`;
}

/** Human-readable order number, e.g. 7 → "№0007". */
export const formatOrderNumber = formatRequestNumber;
