import Link from "next/link";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { listProjects } from "@/server/projects/service";
import { requireUser } from "@/server/session";

export default async function DashboardPage() {
  const user = await requireUser();
  const projects = await listProjects(user);

  return (
    <>
      <PageHeader title="მიმოხილვა" />
      <p className="mb-6 text-steel-600">გამარჯობა, {user.name}!</p>
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <h2 className="font-semibold">მიმდინარე მოთხოვნები</h2>
          <p className="mt-2 text-sm text-steel-600">
            მოთხოვნების მოდული მომდევნო ეტაპზე დაემატება.
          </p>
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
