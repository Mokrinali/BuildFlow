import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RequestStatusBadge } from "@/components/request-status";
import { ButtonLink, Card, EmptyState, PageHeader } from "@/components/ui";
import { formatDateTime, formatQuantity, formatWorkDate } from "@/lib/format";
import { priorityLabel, requestEventLabel } from "@/lib/i18n/ka";
import { formatRequestNumber } from "@/lib/units";
import { AppError } from "@/server/errors";
import { getRequest } from "@/server/requests/service";
import { requireUser } from "@/server/session";
import { RequestActions } from "./request-actions";

export const metadata: Metadata = { title: "მოთხოვნა" };

type Props = {
  params: Promise<{ requestId: string }>;
  searchParams: Promise<{ notice?: string }>;
};

// Each notice comes from a redirect after saving. It is shown only while the request is still in
// the status the save produced, so a later approve/reject on the same URL does not leave it stale.
const notices: Record<string, { ok: boolean; text: string; status: string }> = {
  saved: { ok: true, text: "მონახაზი შენახულია.", status: "DRAFT" },
  submitted: {
    ok: true,
    text: "მოთხოვნა შენახულია და გაიგზავნა განსახილველად.",
    status: "IN_REVIEW",
  },
  "saved-not-submitted": {
    ok: false,
    status: "DRAFT",
    text: "მონახაზი შენახულია, მაგრამ გაგზავნა ვერ მოხერხდა. შეამოწმეთ პოზიციები და თარიღი.",
  },
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-steel-600">{label}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  );
}

export default async function RequestPage({ params, searchParams }: Props) {
  const { requestId } = await params;
  const { notice } = await searchParams;
  const user = await requireUser();
  let data;
  try {
    data = await getRequest(user, requestId);
  } catch (e) {
    if (e instanceof AppError && (e.code === "NOT_FOUND" || e.code === "FORBIDDEN")) notFound();
    throw e;
  }
  const { request, items, orders, events, permissions, access } = data;
  const candidate = notice ? notices[notice] : undefined;
  const n = candidate?.status === request.status ? candidate : undefined;

  return (
    <>
      <PageHeader
        title={`მოთხოვნა ${formatRequestNumber(request.number)}`}
        actions={
          permissions.canEdit ? (
            <ButtonLink href={`/requests/${request.id}/edit`} variant="secondary">
              რედაქტირება
            </ButtonLink>
          ) : undefined
        }
      />
      {n && (
        <p
          role={n.ok ? "status" : "alert"}
          className={`mb-4 rounded-md px-3 py-2 text-sm ${n.ok ? "bg-green-50 text-green-900" : "bg-red-50 text-red-900"}`}
        >
          {n.text}
        </p>
      )}
      {access.archived && (
        <p className="mb-4 rounded-md bg-gray-100 px-3 py-2 text-sm">
          პროექტი არქივირებულია. მოთხოვნა ხელმისაწვდომია მხოლოდ სანახავად.
        </p>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <RequestStatusBadge status={request.status} />
              <Link
                href={`/projects/${request.project.id}`}
                className="text-sm font-medium underline underline-offset-4"
              >
                {request.project.name}
              </Link>
            </div>
            <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Row label="ავტორი">{request.author.name}</Row>
              <Row label="შექმნის დრო">{formatDateTime(request.createdAt)}</Row>
              <Row label="სასურველი მიწოდება">
                {request.desiredDate ? formatWorkDate(request.desiredDate) : "—"}
              </Row>
              <Row label="პრიორიტეტი">{priorityLabel[request.priority]}</Row>
              {request.reviewedBy && request.reviewedAt && (
                <Row label="განიხილა">
                  {request.reviewedBy.name}, {formatDateTime(request.reviewedAt)}
                </Row>
              )}
            </dl>
            {request.note && (
              <p className="mt-4 rounded-md bg-offwhite p-3 text-sm whitespace-pre-line">
                {request.note}
              </p>
            )}
            {request.status === "REJECTED" && request.rejectionReason && (
              <p className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-900">
                <strong>უარყოფის მიზეზი:</strong> {request.rejectionReason}
              </p>
            )}
            {request.status === "CANCELLED" && request.cancelReason && (
              <p className="mt-4 rounded-md bg-gray-100 p-3 text-sm">
                <strong>გაუქმების მიზეზი:</strong> {request.cancelReason}
              </p>
            )}
          </Card>

          <Card>
            <h2 className="mb-4 text-lg font-semibold">პოზიციები და პროგრესი</h2>
            {items.length === 0 ? (
              <EmptyState title="პოზიციები არ არის">
                {permissions.canEdit ? "დაამატეთ პოზიციები რედაქტირების გვერდზე." : null}
              </EmptyState>
            ) : (
              <>
                {/* Desktop table */}
                <div className="hidden overflow-x-auto md:block">
                  <table className="w-full text-left text-sm">
                    <thead className="border-b border-line text-xs text-steel-600">
                      <tr>
                        <th className="py-2 pr-3">#</th>
                        <th className="py-2 pr-3">დასახელება</th>
                        <th className="py-2 pr-3">ერთეული</th>
                        <th className="py-2 pr-3 text-right">მოთხოვნილი</th>
                        <th className="py-2 pr-3 text-right">შეკვეთილი</th>
                        <th className="py-2 pr-3 text-right">მიღებული</th>
                        <th className="py-2 text-right">დარჩენილი</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {items.map((it) => (
                        <tr key={it.id} className="align-top">
                          <td className="py-2 pr-3 text-steel-600">{it.position}</td>
                          <td className="py-2 pr-3">
                            <span className="font-medium">{it.name}</span>
                            {it.spec && <span className="text-steel-600"> · {it.spec}</span>}
                            {it.note && <p className="text-xs text-steel-600">{it.note}</p>}
                          </td>
                          <td className="py-2 pr-3">{it.unit}</td>
                          <td className="py-2 pr-3 text-right font-medium">
                            {formatQuantity(it.quantity)}
                          </td>
                          <td className="py-2 pr-3 text-right">{formatQuantity(it.ordered)}</td>
                          <td className="py-2 pr-3 text-right">{formatQuantity(it.received)}</td>
                          <td className="py-2 text-right">{formatQuantity(it.remaining)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {/* Mobile cards */}
                <ul className="flex flex-col gap-3 md:hidden">
                  {items.map((it) => (
                    <li key={it.id} className="rounded-md border border-line p-3 text-sm">
                      <p className="font-medium">
                        {it.position}. {it.name}
                        {it.spec && (
                          <span className="font-normal text-steel-600"> · {it.spec}</span>
                        )}
                      </p>
                      {it.note && <p className="text-xs text-steel-600">{it.note}</p>}
                      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1">
                        <dt className="text-steel-600">მოთხოვნილი</dt>
                        <dd className="text-right font-medium">
                          {formatQuantity(it.quantity)} {it.unit}
                        </dd>
                        <dt className="text-steel-600">შეკვეთილი</dt>
                        <dd className="text-right">{formatQuantity(it.ordered)}</dd>
                        <dt className="text-steel-600">მიღებული</dt>
                        <dd className="text-right">{formatQuantity(it.received)}</dd>
                        <dt className="text-steel-600">დარჩენილი</dt>
                        <dd className="text-right">{formatQuantity(it.remaining)}</dd>
                      </dl>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Card>

          <Card>
            <h2 className="mb-2 text-lg font-semibold">დაკავშირებული შეკვეთები</h2>
            {orders.length === 0 ? (
              <p className="text-sm text-steel-600">
                შეკვეთები ჯერ არ არის. შეკვეთების გაფორმება შემდეგ ეტაპზე დაემატება.
              </p>
            ) : (
              <ul className="text-sm">
                {orders.map((o) => (
                  <li key={o.id}>
                    შეკვეთა №{o.number} · {o.supplier.name}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          <RequestActions requestId={request.id} permissions={permissions} />
          <Card>
            <h2 className="mb-4 text-lg font-semibold">ქრონოლოგია</h2>
            <ol className="flex flex-col gap-3 text-sm">
              {events.map((e) => (
                <li key={e.id}>
                  <p>{requestEventLabel[e.action] ?? e.action}</p>
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
