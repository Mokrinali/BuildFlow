// Delivery vs its RS.ge waybill: per order line, the waybill quantity (in the order unit) next to
// what was received. Differences are warnings; the receiver or buyer can fix a line's match.
import { Badge } from "@/components/ui";
import { formatQuantity } from "@/lib/format";
import type { WaybillComparison } from "@/server/rs/compare";
import { WaybillLineMatchForm, type OrderLineOption } from "./rs-goods";

export function WaybillCompare({
  orderId,
  compare,
  orderLines,
  canEdit,
}: {
  orderId: string;
  compare: WaybillComparison;
  orderLines: OrderLineOption[];
  canEdit: boolean;
}) {
  const nameOf = (id: string | null) => orderLines.find((o) => o.id === id);
  const signed = (d: string) => (d.startsWith("-") ? formatQuantity(d) : `+${formatQuantity(d)}`);
  return (
    <div className="mt-2 rounded-md bg-offwhite p-3">
      <p className="flex flex-wrap items-center gap-2 font-medium">
        შედარება ზედნადებთან
        {compare.mismatch ? (
          <Badge tone="orange">ზედნადებთან სხვაობაა</Badge>
        ) : (
          <Badge tone="green">ემთხვევა ზედნადებს</Badge>
        )}
      </p>
      {compare.rows.length > 0 && (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[22rem] text-left text-sm">
            <thead className="text-xs text-steel-600">
              <tr>
                <th className="py-1 pr-3">პოზიცია</th>
                <th className="py-1 pr-3 text-right">ზედნადებით</th>
                <th className="py-1 pr-3 text-right">მიღებული</th>
                <th className="py-1 text-right">სხვაობა</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {compare.rows.map((r) => (
                <tr key={r.orderItemId}>
                  <td className="py-1 pr-3">
                    {r.name} <span className="text-steel-600">({r.unit})</span>
                  </td>
                  <td className="py-1 pr-3 text-right">
                    {r.waybill === null ? (
                      <span className="text-[#8a3f00]">კოეფიციენტი აკლია</span>
                    ) : (
                      formatQuantity(r.waybill)
                    )}
                  </td>
                  <td className="py-1 pr-3 text-right">{formatQuantity(r.received)}</td>
                  <td className="py-1 text-right">
                    {r.diff === null ? (
                      "—"
                    ) : r.ok ? (
                      <span className="text-green-900">✓ ემთხვევა</span>
                    ) : (
                      <strong className="text-[#8a3f00]">{signed(r.diff)}</strong>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <details className="mt-2" open={compare.mismatch}>
        <summary className="cursor-pointer text-xs underline underline-offset-4">
          ზედნადების ხაზები ({compare.lines.length})
          {compare.unmatched > 0 && `, მიუსადაგებელი: ${compare.unmatched}`}
        </summary>
        <ul className="mt-2 flex flex-col gap-2">
          {compare.lines.map((l) => {
            const target = nameOf(l.orderItemId);
            return (
              <li key={l.id} className="rounded-md border border-line bg-white p-2 text-sm">
                <p>
                  <strong>{l.name}</strong> — {formatQuantity(l.quantity)} {l.unit}
                </p>
                <p className="text-xs text-steel-600">
                  {target ? (
                    <>
                      → {target.name}
                      {l.converted !== null ? (
                        <>
                          : {formatQuantity(l.converted)} {target.unit}
                          {l.factor !== "1" &&
                            l.factor &&
                            ` (1 ${l.unit} = ${formatQuantity(l.factor)} ${target.unit})`}
                        </>
                      ) : (
                        <span className="text-[#8a3f00]">
                          {" "}
                          — მიუთითეთ, რამდენი {target.unit}-ია 1 {l.unit}
                        </span>
                      )}
                    </>
                  ) : (
                    "არ არის მიბმული ამ შეკვეთის პოზიციაზე (შეიძლება სხვა შეკვეთას ეკუთვნის)."
                  )}
                </p>
                {canEdit && (
                  <WaybillLineMatchForm
                    orderId={orderId}
                    lineId={l.id}
                    goodsUnit={l.unit}
                    current={l.orderItemId}
                    currentFactor={l.factor}
                    orderLines={orderLines}
                  />
                )}
              </li>
            );
          })}
        </ul>
      </details>
    </div>
  );
}
