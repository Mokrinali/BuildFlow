// Formatting for the ka-GE locale. Work dates follow the Asia/Tbilisi calendar.
export const TIME_ZONE = "Asia/Tbilisi";
const LOCALE = "ka-GE";

const dateFmt = new Intl.DateTimeFormat(LOCALE, {
  timeZone: TIME_ZONE,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});
const dateTimeFmt = new Intl.DateTimeFormat(LOCALE, {
  timeZone: TIME_ZONE,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** Timestamp (UTC instant) shown in Tbilisi time. */
export const formatDateTime = (d: Date) => dateTimeFmt.format(d);
/** Timestamp shown as a Tbilisi calendar date. */
export const formatDate = (d: Date) => dateFmt.format(d);

/** A @db.Date value (stored as UTC midnight) shown without timezone shifting. */
export const formatWorkDate = (d: Date) =>
  new Intl.DateTimeFormat(LOCALE, {
    timeZone: "UTC",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(d);

/** Today's calendar date in Tbilisi as YYYY-MM-DD. */
export function todayInTbilisi(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE }).format(now);
}

export function formatMoney(amount: string | number, currency: string): string {
  return new Intl.NumberFormat(LOCALE, { style: "currency", currency }).format(Number(amount));
}

export function formatQuantity(q: string | number): string {
  return new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 3 }).format(Number(q));
}
