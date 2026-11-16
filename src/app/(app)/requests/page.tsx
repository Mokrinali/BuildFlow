import type { Metadata } from "next";
import Link from "next/link";
import { RequestStatusBadge } from "@/components/request-status";
import { ButtonLink, EmptyState, PageHeader, buttonClass } from "@/components/ui";
import type { RequestStatus } from "@/generated/prisma/enums";
import { formatDate, formatWorkDate } from "@/lib/format";
import { priorityLabel, requestStatusLabel } from "@/lib/i18n/ka";
import { formatRequestNumber } from "@/lib/units";
import { listProjects } from "@/server/projects/service";
import { listRequests, type ListFilters } from "@/server/requests/service";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "მოთხოვნები" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const STATUSES = Object.keys(requestStatusLabel) as RequestStatus[];

function queryString(f: ListFilters, page?: number) {
  const p = new URLSearchParams();
  if (f.project) p.set("project", f.project);
  if (f.status) p.set("status", f.status);
  if (f.q) p.set("q", f.q);
  if (f.from) p.set("from", f.from);
  if (f.to) p.set("to", f.to);
  if (page && page > 1) p.set("page", String(page));
  const s = p.toString();
  return s ? `?${s}` : "";
}

const fieldClass = "min-h-10 rounded-md border border-steel bg-white px-2 text-sm";

export default async function RequestsPage({ searchParams }: Props) {
  const user = await requireUser();
  const raw = await searchParams;
  const first = (k: string) => (Array.isArray(raw[k]) ? raw[k][0] : raw[k]) || undefined;
  const [{ rows, total, page, pageCount, filters }, projects] = await Promise.all([
    listRequests(user, {
      project: first("project"),
      status: first("status"),
      q: first("q"),
      from: first("from"),
      to: first("to"),
      page: first("page"),
    }),
    listProjects(user, { includeArchived: true }),
  ]);
  const filtered = Boolean(
    filters.project || filters.status || filters.q || filters.from || filters.to,
  );

  return (
    <>
      <PageHeader
        title="მოთხოვნები"
        actions={
          <>
            <ButtonLink href="/requests/import" variant="secondary">
              WhatsApp ტექსტის იმპორტი
            </ButtonLink>
            <ButtonLink href="/requests/new">ახალი მოთხოვნა</ButtonLink>
          </>
        }
      />

      {/* GET form: filters live in the URL, so they survive reloads and can be shared. */}
      <form
        method="get"
        className="mb-6 grid grid-cols-1 gap-3 rounded-lg border border-line bg-white p-4 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_0.9fr_0.9fr_auto]"
        aria-label="მოთხოვნების ფილტრი"
      >
        <div className="flex flex-col gap-1">
          <label htmlFor="f-q" className="text-xs font-medium">
            ძიება (ნომერი ან მასალა)
          </label>
          <input
            id="f-q"
            name="q"
            defaultValue={filters.q}
            placeholder="მაგ. 12 ან ცემენტი"
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
          <label htmlFor="f-status" className="text-xs font-medium">
            სტატუსი
          </label>
          <select
            id="f-status"
            name="status"
            defaultValue={filters.status ?? ""}
            className={fieldClass}
          >
            <option value="">ყველა</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {requestStatusLabel[s]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="f-from" className="text-xs font-medium">
            შექმნილია (დან)
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
            შექმნილია (მდე)
          </label>
          <input id="f-to" type="date" name="to" defaultValue={filters.to} className={fieldClass} />
        </div>
        <div className="flex items-end gap-2">
          <button type="submit" className={buttonClass("secondary")}>
            ფილტრი
          </button>
          {filtered && (
            <Link href="/requests" className="self-center text-sm underline underline-offset-4">
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
          title={filtered ? "ფილტრს შესაბამისი მოთხოვნა არ მოიძებნა" : "მოთხოვნები ჯერ არ არის"}
        >
          {filtered
            ? "შეცვალეთ ან გაასუფთავეთ ფილტრი."
            : "შექმენით პირველი მოთხოვნა ღილაკით „ახალი მოთხოვნა“."}
        </EmptyState>
      ) : (
        <>
          <div className="hidden overflow-x-auto rounded-lg border border-line bg-white md:block">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line bg-offwhite text-xs text-steel-600">
                <tr>
                  <th className="px-4 py-3">ნომერი</th>
                  <th className="px-4 py-3">პროექტი</th>
                  <th className="px-4 py-3">სტატუსი</th>
                  <th className="px-4 py-3">პრიორიტეტი</th>
                  <th className="px-4 py-3">სასურველი თარიღი</th>
                  <th className="px-4 py-3">ავტორი</th>
                  <th className="px-4 py-3">შექმნილია</th>
                  <th className="px-4 py-3 text-right">პოზ.</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-offwhite">
                    <td className="px-4 py-3 font-semibold">
                      <Link href={`/requests/${r.id}`} className="underline underline-offset-4">
                        {formatRequestNumber(r.number)}
                      </Link>
                    </td>
                    <td className="px-4 py-3">{r.project.name}</td>
                    <td className="px-4 py-3">
                      <RequestStatusBadge status={r.status} />
                    </td>
                    <td className="px-4 py-3">{priorityLabel[r.priority]}</td>
                    <td className="px-4 py-3">
                      {r.desiredDate ? formatWorkDate(r.desiredDate) : "—"}
                    </td>
                    <td className="px-4 py-3">{r.author.name}</td>
                    <td className="px-4 py-3">{formatDate(r.createdAt)}</td>
                    <td className="px-4 py-3 text-right">{r._count.items}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="flex flex-col gap-3 md:hidden">
            {rows.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/requests/${r.id}`}
                  className="block rounded-lg border border-line bg-white p-4 hover:border-steel"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold">{formatRequestNumber(r.number)}</span>
                    <RequestStatusBadge status={r.status} />
                  </div>
                  <p className="mt-1 text-sm">{r.project.name}</p>
                  <p className="mt-1 text-xs text-steel-600">
                    {r.author.name} · {formatDate(r.createdAt)} · პოზიციები: {r._count.items}
                    {r.desiredDate ? ` · მიწოდება: ${formatWorkDate(r.desiredDate)}` : ""}
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
                  href={`/requests${queryString(filters, page - 1)}`}
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
                  href={`/requests${queryString(filters, page + 1)}`}
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
