// Compare a delivery with the goods lines of its RS.ge waybill (pure, no database access).
// Per order line: the waybill quantity converted to the order unit next to what was received
// (net of corrections). A difference, an unknown unit factor or an order line missing from the
// waybill is a warning; goods lines not matched to this order are listed (the same waybill may
// also cover another order).
import { mulDecimal, sumDecimal } from "@/lib/unit-convert";

export type WaybillLineView = {
  id: string;
  position: number;
  name: string;
  unit: string;
  quantity: string;
  unitPrice: string | null;
  orderItemId: string | null;
  factor: string | null;
  /** Quantity in the order unit, when matched and the factor is known. */
  converted: string | null;
};

export type WaybillCompareRow = {
  orderItemId: string;
  name: string;
  unit: string;
  /** Converted waybill quantity, or null when a matched line has no factor yet. */
  waybill: string | null;
  received: string;
  /** received − waybill, or null when the waybill quantity is unknown. */
  diff: string | null;
  ok: boolean;
};

export type WaybillComparison = {
  lines: WaybillLineView[];
  rows: WaybillCompareRow[];
  unmatched: number;
  mismatch: boolean;
};

export function compareWaybill(
  lines: Omit<WaybillLineView, "converted">[],
  received: { orderItemId: string; quantity: string }[],
  orderLines: Map<string, { name: string; unit: string }>,
): WaybillComparison {
  const views: WaybillLineView[] = lines.map((l) => ({
    ...l,
    converted: l.orderItemId && l.factor ? mulDecimal(l.quantity, l.factor) : null,
  }));
  const ids = [
    ...new Set([
      ...views.flatMap((l) => (l.orderItemId ? [l.orderItemId] : [])),
      ...received.map((r) => r.orderItemId),
    ]),
  ].filter((id) => orderLines.has(id));

  const rows = ids.map((id) => {
    const matched = views.filter((l) => l.orderItemId === id);
    const rec = sumDecimal(received.filter((r) => r.orderItemId === id).map((r) => r.quantity));
    const known = matched.every((l) => l.converted !== null);
    const waybill = known ? sumDecimal(matched.map((l) => l.converted!)) : null;
    const diff = waybill === null ? null : sumDecimal([rec, `-${waybill}`.replace("--", "")]);
    const line = orderLines.get(id)!;
    return {
      orderItemId: id,
      name: line.name,
      unit: line.unit,
      waybill,
      received: rec,
      diff,
      ok: diff === "0",
    };
  });
  return {
    lines: views,
    rows,
    unmatched: views.filter((l) => !l.orderItemId).length,
    mismatch: rows.some((r) => !r.ok),
  };
}
