// CSV export of received order lines for accounting (waybill, supplier, amounts).
// Same filters and visibility as the order list. Opens in Excel with Georgian text: UTF-8 BOM,
// ";" as separator and a decimal comma, as Excel expects with Georgian regional settings.
import { formatWorkDate, todayInTbilisi } from "@/lib/format";
import { formatOrderNumber, formatRequestNumber } from "@/lib/units";
import { exportReceiptLines } from "@/server/orders/service";
import { consumeRateLimit } from "@/server/rate-limit";
import { AppError } from "@/server/errors";
import { requireUser } from "@/server/session";

const HEADERS = [
  "მიღების თარიღი",
  "ზედნადების №",
  "ზედნადების თარიღი",
  "მომწოდებელი",
  "მომწოდებლის ს/კ",
  "პროექტი",
  "მოთხოვნა",
  "შეკვეთა",
  "მასალა",
  "სპეციფიკაცია",
  "რაოდენობა",
  "ერთეული",
  "ერთეულის ფასი",
  "თანხა",
  "ვალუტა",
  "ჩანაწერი",
  "მიმღები",
];

/** Text cell: quoted, and never read as a formula by a spreadsheet (CSV injection). */
const text = (v: string | null | undefined) => {
  let s = v ?? "";
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
};
/** Number cell: decimal comma, no grouping, so Excel reads it as a number. */
const num = (v: string) => v.replace(".", ",");

export async function GET(request: Request) {
  const user = await requireUser();
  try {
    await consumeRateLimit(`export:${user.userId}`, 10);
  } catch (e) {
    if (e instanceof AppError) return new Response(e.message, { status: 429 });
    throw e;
  }
  const params = new URL(request.url).searchParams;
  const pick = (k: string) => params.get(k) || undefined;
  const rows = await exportReceiptLines(user, {
    project: pick("project"),
    status: pick("status"),
    supplier: pick("supplier"),
    delivery: pick("delivery"),
    q: pick("q"),
    from: pick("from"),
    to: pick("to"),
  });

  const lines = [HEADERS.map(text).join(";")];
  for (const r of rows) {
    lines.push(
      [
        text(formatWorkDate(r.receivedOn)),
        text(r.waybillNumber ?? "აკლია"),
        text(r.waybillDate ? formatWorkDate(r.waybillDate) : ""),
        text(r.supplier),
        text(r.supplierTaxId),
        text(r.project),
        text(formatRequestNumber(r.requestNumber)),
        text(formatOrderNumber(r.orderNumber)),
        text(r.material),
        text(r.spec),
        num(r.quantity),
        text(r.unit),
        num(r.unitPrice),
        num(r.amount),
        text(r.currency),
        text(r.isCorrection ? "შესწორება" : "მიწოდება"),
        text(r.receivedBy),
      ].join(";"),
    );
  }
  const body = "﻿" + lines.join("\r\n") + "\r\n";
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="buildflow-receipts-${todayInTbilisi()}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
