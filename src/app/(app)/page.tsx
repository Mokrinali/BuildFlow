import Link from "next/link";
import { RequestStatusBadge } from "@/components/request-status";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { formatDateTime, formatWorkDate } from "@/lib/format";
import { formatOrderNumber, formatRequestNumber } from "@/lib/units";
import { orderDashboard } from "@/server/orders/service";
import { listProjects } from "@/server/projects/service";
import { cancellationsToDecide, requestDashboard } from "@/server/requests/service";
import { requireUser } from "@/server/session";

type Props = { searchParams: Promise<{ password?: string }> };

type DashOrder = Awaited<ReturnType<typeof orderDashboard>>["overdue"][number];

/** Short order list with an action link to the order (where it is received). */
function OrderList({ orders, overdue }: { orders: DashOrder[]; overdue?: boolean }) {
  return (
    <ul className="mt-4 flex flex-col gap-3 border-t border-line pt-3 text-sm">
      {orders.map((o) => (
        <li key={o.id}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold">შეკვეთა {formatOrderNumber(o.number)}</span>
            <Link
              href={`/orders/${o.id}`}
              className="font-medium underline underline-offset-4"
              aria-label={`შეკვეთა ${formatOrderNumber(o.number)}: ${o.canReceive ? "მიღება" : "ნახვა"}`}
            >
              {o.canReceive ? "მიღება →" : "ნახვა →"}
            </Link>
          </div>
          <p className="text-steel-600">
            {o.supplier.name} · {o.request.project.name}
          </p>
          <p className={overdue ? "font-medium text-red-800" : "text-steel-600"}>
            {o.plannedDeliveryDate
              ? `${overdue ? "ვადა გავიდა: " : "მიწოდება: "}${formatWorkDate(o.plannedDeliveryDate)}`
              : "თარიღი არ არის მითითებული"}
          </p>
        </li>
      ))}
    </ul>
  );
}

function Stat({ href, value, label }: { href: string; value: number; label: string }) {
  return (
    <Link href={href} className="flex items-baseline gap-2 rounded-md px-1 hover:bg-offwhite">
      <span className="text-2xl font-bold">{value}</span>
      <span className="text-sm underline underline-offset-4">{label}</span>
    </Link>
  );
}

export default async function DashboardPage({ searchParams }: Props) {
  const user = await requireUser();
  const [projects, dash, orders, toDecide, { password }] = await Promise.all([
    listProjects(user),
    requestDashboard(user),
    orderDashboard(user),
    cancellationsToDecide(user),
    searchParams,
  ]);

  return (
    <>
      <PageHeader title="მიმოხილვა" />
      {password === "changed" && (
        <p role="status" className="mb-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-900">
          პაროლი შეიცვალა.
        </p>
      )}
      <p className="mb-6 text-steel-600">გამარჯობა, {user.name}!</p>
      {toDecide.length > 0 && (
        <section
          aria-labelledby="to-decide"
          className="mb-6 rounded-lg border-2 border-orange bg-white p-4 sm:p-6"
        >
          <h2 id="to-decide" className="font-semibold">
            დასადასტურებელი გაუქმებები ({toDecide.length})
          </h2>
          <p className="text-sm text-steel-600">
            მეორე მხარე ითხოვს დარჩენილი რაოდენობის გაუქმებას. გახსენით მოთხოვნა და დაადასტურეთ ან
            უარყავით.
          </p>
          <ul className="mt-3 flex flex-col gap-3 border-t border-line pt-3 text-sm">
            {toDecide.map((c) => (
              <li key={c.id}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold">
                    მოთხოვნა {formatRequestNumber(c.request.number)} · {c.itemName}
                  </span>
                  <Link
                    href={`/requests/${c.request.id}`}
                    className="font-medium underline underline-offset-4"
                    aria-label={`მოთხოვნა ${formatRequestNumber(c.request.number)}: გადაწყვეტა`}
                  >
                    გადაწყვეტა →
                  </Link>
                </div>
                <p className="text-steel-600">
                  {c.request.projectName} · {c.requestedBy} (
                  {c.side === "REQUESTER" ? "მომთხოვნი" : "შემსყიდველი"}),{" "}
                  {formatDateTime(c.createdAt)}
                </p>
                <p>„{c.reason}“</p>
              </li>
            ))}
          </ul>
        </section>
      )}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card>
          <h2 className="mb-3 font-semibold">მიმდინარე მოთხოვნები</h2>
          <div className="flex flex-col gap-2">
            <Stat
              href="/requests?status=IN_REVIEW"
              value={dash.awaitingReview}
              label="განსახილველი"
            />
            <Stat href="/requests?status=OPEN" value={dash.open} label="ღია მოთხოვნა" />
            {dash.toOrder > 0 && (
              <Stat href="/requests?status=APPROVED" value={dash.toOrder} label="შესაკვეთი" />
            )}
            {dash.myDrafts > 0 && (
              <Stat
                href="/requests?status=DRAFT&mine=1"
                value={dash.myDrafts}
                label="ჩემი მონახაზი"
              />
            )}
          </div>
          {dash.recent.length > 0 && (
            <ul className="mt-4 flex flex-col gap-2 border-t border-line pt-3 text-sm">
              {dash.recent.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/requests/${r.id}`}
                    className="font-semibold underline underline-offset-4"
                  >
                    {formatRequestNumber(r.number)}
                  </Link>
                  <RequestStatusBadge status={r.status} />
                  <span className="text-steel-600">
                    {r.project.name}
                    {r.desiredDate ? ` · ${formatWorkDate(r.desiredDate)}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <h2 className="mb-3 font-semibold">ვადაგადაცილებული მიწოდებები</h2>
          <Stat
            href="/orders?delivery=overdue"
            value={orders.overdueCount}
            label="ვადაგადაცილებული"
          />
          {orders.overdue.length > 0 ? (
            <OrderList orders={orders.overdue} overdue />
          ) : (
            <p className="mt-3 text-sm text-steel-600">ვადაგადაცილებული მიწოდება არ არის.</p>
          )}
        </Card>
        <Card>
          <h2 className="mb-3 font-semibold">მისაღები შეკვეთები</h2>
          <Stat href="/orders?delivery=open" value={orders.toReceiveCount} label="მისაღები" />
          {orders.toReceive.length > 0 ? (
            <OrderList orders={orders.toReceive} />
          ) : (
            <p className="mt-3 text-sm text-steel-600">მისაღები შეკვეთა არ არის.</p>
          )}
        </Card>
      </div>

      <h2 className="mt-8 mb-3 text-lg font-semibold">ჩემი პროექტები</h2>
      {projects.length === 0 ? (
        <EmptyState title="აქტიური პროექტები არ არის" />
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {projects.map((p) => (
            <li key={p.id}>
              <Link
                href={`/projects/${p.id}`}
                className="block rounded-lg border border-line bg-white p-4 hover:border-steel"
              >
                <span className="font-semibold">{p.name}</span>
                <p className="mt-1 text-sm text-steel-600">{p.address}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
