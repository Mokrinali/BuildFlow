import type { Metadata } from "next";
import Link from "next/link";
import { DeliveryBadge } from "@/components/request-status";
import { EmptyState, PageHeader, buttonClass } from "@/components/ui";
import { formatDate, formatMoney, formatWorkDate } from "@/lib/format";
import { deliveryStateLabel, orderStatusLabel } from "@/lib/i18n/ka";
import { formatOrderNumber, formatRequestNumber } from "@/lib/units";
import { listOrders, listSuppliers, type OrderFilters } from "@/server/orders/service";
import { listProjects } from "@/server/projects/service";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "შეკვეთები" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

function queryString(f: OrderFilters, page?: number) {
  const p = new URLSearchParams();
  if (f.project) p.set("project", f.project);
  if (f.status) p.set("status", f.status);
  if (f.supplier) p.set("supplier", f.supplier);
  if (f.delivery) p.set("delivery", f.delivery);
  if (f.q) p.set("q", f.q);
  if (f.from) p.set("from", f.from);
  if (f.to) p.set("to", f.to);
  if (page && page > 1) p.set("page", String(page));
  const s = p.toString();
  return s ? `?${s}` : "";
}

const fieldClass = "min-h-10 rounded-md border border-steel bg-white px-2 text-sm";

export default async function OrdersPage({ searchParams }: Props) {
  const user = await requireUser();
  const raw = await searchParams;
  const first = (k: string) => (Array.isArray(raw[k]) ? raw[k][0] : raw[k]) || undefined;
  const [{ rows, total, page, pageCount, filters }, projects, suppliers] = await Promise.all([
    listOrders(user, {
      project: first("project"),
      status: first("status"),
      supplier: first("supplier"),
      delivery: first("delivery"),
      q: first("q"),
      from: first("from"),
      to: first("to"),
      page: first("page"),
    }),
    listProjects(user, { includeArchived: true }),
    listSuppliers(user),
  ]);
  const filtered = Boolean(
    filters.project ||
    filters.status ||
    filters.supplier ||
    filters.delivery ||
    filters.q ||
    filters.from ||
    filters.to,
  );

  return (
    <>
      <PageHeader title="შეკვეთები" />

      {/* GET form: filters live in the URL, so they survive reloads and can be shared. */}
      <form
        method="get"
        className="mb-6 grid grid-cols-1 gap-3 rounded-lg border border-line bg-white p-4 sm:grid-cols-2 lg:grid-cols-[1.3fr_1fr_1fr_0.8fr_0.9fr_0.9fr_auto]"
        aria-label="შეკვეთების ფილტრი"
      >
        <div className="flex flex-col gap-1">
          <label htmlFor="f-q" className="text-xs font-medium">
            ძიება (ნომერი ან მასალა)
          </label>
          <input
            id="f-q"
            name="q"
            defaultValue={filters.q}
            placeholder="მაგ. 7 ან არმატურა"
            className={fieldClass}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="f-project" className="text-xs font-medium">
            პროექტი
          </label>
          <select
            id="f-project"
            name="project"
            defaultValue={filters.project ?? ""}
            className={fieldClass}
          >
            <option value="">ყველა</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.status === "ARCHIVED" ? " (არქივი)" : ""}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="f-supplier" className="text-xs font-medium">
            მომწოდებელი
          </label>
          <select
            id="f-supplier"
            name="supplier"
            defaultValue={filters.supplier ?? ""}
            className={fieldClass}
          >
            <option value="">ყველა</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="f-delivery" className="text-xs font-medium">
            მიწოდება
          </label>
          <select
            id="f-delivery"
            name="delivery"
            defaultValue={filters.delivery ?? ""}
            className={fieldClass}
          >
            <option value="">ყველა</option>
            <option value="open">მისაღები</option>
            <option value="overdue">ვადაგადაცილებული</option>
            <option value="received">{deliveryStateLabel.RECEIVED}</option>
            <option value="cancelled">{orderStatusLabel.CANCELLED}</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="f-from" className="text-xs font-medium">
            გაფორმდა (დან)
          </label>
          <input
            id="f-from"
            type="date"
            name="from"
            defaultValue={filters.from}
            className={fieldClass}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="f-to" className="text-xs font-medium">
            გაფორმდა (მდე)
          </label>
          <input id="f-to" type="date" name="to" defaultValue={filters.to} className={fieldClass} />
        </div>
        <div className="flex items-end gap-2">
          <button type="submit" className={buttonClass("secondary")}>
            ფილტრი
          </button>
          {filtered && (
            <Link href="/orders" className="self-center text-sm underline underline-offset-4">
              გასუფთავება
            </Link>
          )}
        </div>
      </form>

      <p className="mb-3 text-sm text-steel-600" aria-live="polite">
        ნაპოვნია: {total}
      </p>

      {rows.length === 0 ? (
        <EmptyState
          title={filtered ? "ფილტრს შესაბამისი შეკვეთა არ მოიძებნა" : "შეკვეთები ჯერ არ არის"}
        >
          {filtered
            ? "შეცვალეთ ან გაასუფთავეთ ფილტრი."
            : "შეკვეთა ფორმდება დამტკიცებული მოთხოვნის გვერდიდან, ღილაკით „შეკვეთის გაფორმება“."}
        </EmptyState>
      ) : (
        <>
          <div className="hidden overflow-x-auto rounded-lg border border-line bg-white md:block">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line bg-offwhite text-xs text-steel-600">
                <tr>
                  <th className="px-4 py-3">ნომერი</th>
                  <th className="px-4 py-3">მომწოდებელი</th>
                  <th className="px-4 py-3">პროექტი</th>
                  <th className="px-4 py-3">მოთხოვნა</th>
                  <th className="px-4 py-3">მიწოდება</th>
                  <th className="px-4 py-3">დაგეგმილი თარიღი</th>
                  <th className="px-4 py-3">გაფორმდა</th>
                  <th className="px-4 py-3 text-right">თანხა</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((o) => (
                  <tr key={o.id} className="hover:bg-offwhite">
                    <td className="px-4 py-3 font-semibold">
                      <Link href={`/orders/${o.id}`} className="underline underline-offset-4">
                        {formatOrderNumber(o.number)}
                      </Link>
                    </td>
                    <td className="px-4 py-3">{o.supplier}</td>
                    <td className="px-4 py-3">{o.request.project.name}</td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/requests/${o.request.id}`}
                        className="underline underline-offset-4"
                      >
                        {formatRequestNumber(o.request.number)}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <DeliveryBadge state={o.delivery} />
                    </td>
                    <td className="px-4 py-3">
                      {o.plannedDeliveryDate ? formatWorkDate(o.plannedDeliveryDate) : "—"}
                    </td>
                    <td className="px-4 py-3">{formatDate(o.createdAt)}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {formatMoney(o.total, o.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="flex flex-col gap-3 md:hidden">
            {rows.map((o) => (
              <li key={o.id}>
                <Link
                  href={`/orders/${o.id}`}
                  className="block rounded-lg border border-line bg-white p-4 hover:border-steel"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold">შეკვეთა {formatOrderNumber(o.number)}</span>
                    <DeliveryBadge state={o.delivery} />
                  </div>
                  <p className="mt-1 text-sm">
                    {o.supplier} · {formatMoney(o.total, o.currency)}
                  </p>
                  <p className="mt-1 text-xs text-steel-600">
                    {o.request.project.name} · მოთხოვნა {formatRequestNumber(o.request.number)}
                    {o.plannedDeliveryDate
                      ? ` · მიწოდება: ${formatWorkDate(o.plannedDeliveryDate)}`
                      : ""}
                  </p>
                </Link>
              </li>
            ))}
          </ul>

          {pageCount > 1 && (
            <nav
              aria-label="გვერდები"
              className="mt-6 flex items-center justify-center gap-4 text-sm"
            >
              {page > 1 ? (
                <Link
                  href={`/orders${queryString(filters, page - 1)}`}
                  className="underline underline-offset-4"
                >
                  ← წინა
                </Link>
              ) : (
                <span className="text-steel-600">← წინა</span>
              )}
              <span>
                {page} / {pageCount}
              </span>
              {page < pageCount ? (
                <Link
                  href={`/orders${queryString(filters, page + 1)}`}
                  className="underline underline-offset-4"
                >
                  შემდეგი →
                </Link>
              ) : (
                <span className="text-steel-600">შემდეგი →</span>
              )}
            </nav>
          )}
        </>
      )}
    </>
  );
}
