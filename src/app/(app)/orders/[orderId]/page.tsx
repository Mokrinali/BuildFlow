import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DeliveryBadge } from "@/components/request-status";
import { Card, PageHeader } from "@/components/ui";
import {
  formatDateTime,
  formatMoney,
  formatQuantity,
  formatUnitPrice,
  formatWorkDate,
  todayInTbilisi,
} from "@/lib/format";
import { currencyLabel, eventLabel } from "@/lib/i18n/ka";
import { formatOrderNumber, formatRequestNumber } from "@/lib/units";
import { AppError } from "@/server/errors";
import { getOrder } from "@/server/orders/service";
import { requireUser } from "@/server/session";
import { CancelOrderForm, CorrectReceiptForm, ReceiveForm } from "./order-actions";

export const metadata: Metadata = { title: "შეკვეთა" };

type Props = {
  params: Promise<{ orderId: string }>;
  searchParams: Promise<{ notice?: string }>;
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-steel-600">{label}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  );
}

export default async function OrderPage({ params, searchParams }: Props) {
  const { orderId } = await params;
  const { notice } = await searchParams;
  const user = await requireUser();
  let data;
  try {
    data = await getOrder(user, orderId);
  } catch (e) {
    if (e instanceof AppError && (e.code === "NOT_FOUND" || e.code === "FORBIDDEN")) notFound();
    throw e;
  }
  const { order, items, receipts, events, permissions, access } = data;
  const money = (v: string) => formatMoney(v, order.currency);

  return (
    <>
      <PageHeader title={`შეკვეთა ${formatOrderNumber(order.number)}`} />
      {notice === "created" && order.status === "ACTIVE" && (
        <p role="status" className="mb-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-900">
          შეკვეთა გაფორმდა.
        </p>
      )}
      {access.archived && (
        <p className="mb-4 rounded-md bg-gray-100 px-3 py-2 text-sm">
          პროექტი არქივირებულია. შეკვეთა ხელმისაწვდომია მხოლოდ სანახავად.
        </p>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <DeliveryBadge state={order.delivery} />
              <Link
                href={`/requests/${order.request.id}`}
                className="text-sm font-medium underline underline-offset-4"
              >
                მოთხოვნა {formatRequestNumber(order.request.number)}
              </Link>
              <Link
                href={`/projects/${order.request.project.id}`}
                className="text-sm font-medium underline underline-offset-4"
              >
                {order.request.project.name}
              </Link>
            </div>
            <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Row label="მომწოდებელი">
                {order.supplier.name}
                {order.supplier.phone && (
                  <span className="block text-sm font-normal">{order.supplier.phone}</span>
                )}
              </Row>
              <Row label="დაგეგმილი მიწოდება">
                {order.plannedDeliveryDate ? formatWorkDate(order.plannedDeliveryDate) : "—"}
              </Row>
              <Row label="ვალუტა">{currencyLabel[order.currency]}</Row>
              <Row label="გააფორმა">
                {order.createdBy}, {formatDateTime(order.createdAt)}
              </Row>
              <Row label="ჯამი">{money(order.total)}</Row>
            </dl>
            {order.status === "CANCELLED" && order.cancelReason && (
              <p className="mt-4 rounded-md bg-gray-100 p-3 text-sm">
                <strong>გაუქმების მიზეზი:</strong> {order.cancelReason}
              </p>
            )}
          </Card>

          <Card>
            <h2 className="mb-4 text-lg font-semibold">პოზიციები და მიწოდება</h2>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-line text-xs text-steel-600">
                  <tr>
                    <th className="py-2 pr-3">დასახელება</th>
                    <th className="py-2 pr-3">ერთეული</th>
                    <th className="py-2 pr-3 text-right">შეკვეთილი</th>
                    <th className="py-2 pr-3 text-right">მიღებული</th>
                    <th className="py-2 pr-3 text-right">დარჩენილი</th>
                    <th className="py-2 pr-3 text-right">ფასი</th>
                    <th className="py-2 text-right">თანხა</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {items.map((it) => (
                    <tr key={it.id} className="align-top">
                      <td className="py-2 pr-3">
                        <span className="font-medium">{it.name}</span>
                        {it.spec && <span className="text-steel-600"> · {it.spec}</span>}
                        {it.note && <p className="text-xs text-steel-600">{it.note}</p>}
                      </td>
                      <td className="py-2 pr-3">{it.unit}</td>
                      <td className="py-2 pr-3 text-right font-medium">
                        {formatQuantity(it.quantity)}
                      </td>
                      <td className="py-2 pr-3 text-right">{formatQuantity(it.received)}</td>
                      <td className="py-2 pr-3 text-right">{formatQuantity(it.remaining)}</td>
                      <td className="py-2 pr-3 text-right whitespace-nowrap">
                        {formatUnitPrice(it.unitPrice, order.currency)}
                      </td>
                      <td className="py-2 text-right whitespace-nowrap">{money(it.total)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-line font-semibold">
                    <td colSpan={6} className="py-2 pr-3 text-right">
                      ჯამი
                    </td>
                    <td className="py-2 text-right whitespace-nowrap">{money(order.total)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <ul className="flex flex-col gap-3 md:hidden">
              {items.map((it) => (
                <li key={it.id} className="rounded-md border border-line p-3 text-sm">
                  <p className="font-medium">
                    {it.name}
                    {it.spec && <span className="font-normal text-steel-600"> · {it.spec}</span>}
                  </p>
                  <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1">
                    <dt className="text-steel-600">შეკვეთილი</dt>
                    <dd className="text-right font-medium">
                      {formatQuantity(it.quantity)} {it.unit}
                    </dd>
                    <dt className="text-steel-600">მიღებული</dt>
                    <dd className="text-right">{formatQuantity(it.received)}</dd>
                    <dt className="text-steel-600">დარჩენილი</dt>
                    <dd className="text-right">{formatQuantity(it.remaining)}</dd>
                    <dt className="text-steel-600">ფასი</dt>
                    <dd className="text-right">{formatUnitPrice(it.unitPrice, order.currency)}</dd>
                    <dt className="text-steel-600">თანხა</dt>
                    <dd className="text-right">{money(it.total)}</dd>
                  </dl>
                </li>
              ))}
              <li className="text-right text-sm font-semibold">ჯამი: {money(order.total)}</li>
            </ul>
          </Card>

          {permissions.canReceive && (
            <ReceiveForm orderId={order.id} items={items} today={todayInTbilisi()} />
          )}

          <Card>
            <h2 className="mb-4 text-lg font-semibold">მიწოდებები</h2>
            {receipts.length === 0 ? (
              <p className="text-sm text-steel-600">მიწოდება ჯერ არ დაფიქსირებულა.</p>
            ) : (
              <ol className="flex flex-col gap-4">
                {receipts.map((r) => {
                  const isCorrection = r.items.every((i) => i.isCorrection);
                  return (
                    <li key={r.id} className="rounded-md border border-line p-3 text-sm">
                      <p className="font-semibold">
                        {isCorrection ? "შესწორება" : "მიწოდება"} · {formatWorkDate(r.receivedOn)}
                      </p>
                      <p className="text-xs text-steel-600">
                        {r.receivedBy} · ჩაწერილია {formatDateTime(r.createdAt)}
                      </p>
                      {r.note && <p className="mt-1">„{r.note}“</p>}
                      <ul className="mt-2 flex flex-col gap-2">
                        {r.items.map((ri) => (
                          <li key={ri.id}>
                            <span>
                              {ri.name}:{" "}
                              <strong>
                                {ri.isCorrection && !ri.quantity.startsWith("-") ? "+" : ""}
                                {formatQuantity(ri.quantity)} {ri.unit}
                              </strong>
                            </span>
                            {!ri.isCorrection && ri.effective !== ri.quantity && (
                              <span className="text-steel-600">
                                {" "}
                                (შესწორების შემდეგ: {formatQuantity(ri.effective)})
                              </span>
                            )}
                            {permissions.canCorrect && !ri.isCorrection && (
                              <CorrectReceiptForm
                                orderId={order.id}
                                receiptItemId={ri.id}
                                current={ri.effective}
                                unit={ri.unit}
                              />
                            )}
                          </li>
                        ))}
                      </ul>
                    </li>
                  );
                })}
              </ol>
            )}
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          {permissions.canCancel && <CancelOrderForm orderId={order.id} />}
          <Card>
            <h2 className="mb-4 text-lg font-semibold">ქრონოლოგია</h2>
            <ol className="flex flex-col gap-3 text-sm">
              {events.map((e) => (
                <li key={e.id}>
                  <p>{eventLabel(e.action)}</p>
                  {e.reason && <p className="text-steel-600">„{e.reason}“</p>}
                  <p className="text-xs text-steel-600">
                    {formatDateTime(e.createdAt)} · {e.actor?.name ?? "სისტემა"}
                  </p>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>
    </>
  );
}
