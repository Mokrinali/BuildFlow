import Link from "next/link";
import { RequestStatusBadge } from "@/components/request-status";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { formatWorkDate } from "@/lib/format";
import { formatRequestNumber } from "@/lib/units";
import { listProjects } from "@/server/projects/service";
import { requestDashboard } from "@/server/requests/service";
import { requireUser } from "@/server/session";

type Props = { searchParams: Promise<{ password?: string }> };

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
  const [projects, dash, { password }] = await Promise.all([
    listProjects(user),
    requestDashboard(user),
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
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <h2 className="mb-3 font-semibold">მიმდინარე მოთხოვნები</h2>
          <div className="flex flex-col gap-2">
            <Stat
              href="/requests?status=IN_REVIEW"
              value={dash.awaitingReview}
              label="განსახილველი"
            />
            <Stat href="/requests" value={dash.open} label="ღია მოთხოვნა" />
            {dash.myDrafts > 0 && (
              <Stat href="/requests?status=DRAFT" value={dash.myDrafts} label="ჩემი მონახაზი" />
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
          <h2 className="font-semibold">ვადაგადაცილებული მიწოდებები</h2>
          <p className="mt-2 text-sm text-steel-600">ჩანს შეკვეთების მოდულის დამატების შემდეგ.</p>
        </Card>
        <Card>
          <h2 className="font-semibold">მისაღები შეკვეთები</h2>
          <p className="mt-2 text-sm text-steel-600">ჩანს მიღების მოდულის დამატების შემდეგ.</p>
        </Card>
      </div>

      <h2 className="mt-8 mb-3 text-lg font-semibold">ჩემი პროექტები</h2>
      {projects.length === 0 ? (
        <EmptyState title="აქტიური პროექტები არ არის" />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
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
