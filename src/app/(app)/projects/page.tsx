import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { projectStatusLabel } from "@/lib/i18n/ka";
import { listProjects } from "@/server/projects/service";
import { requireUser } from "@/server/session";
import { ProjectForm } from "./project-form";

export const metadata: Metadata = { title: "პროექტები" };

type Props = { searchParams: Promise<{ archived?: string }> };

export default async function ProjectsPage({ searchParams }: Props) {
  const user = await requireUser();
  const showArchived = (await searchParams).archived === "1";
  const projects = await listProjects(user, { includeArchived: showArchived });

  return (
    <>
      <PageHeader title="პროექტები" />
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div>
          <div className="mb-3 flex justify-end">
            <Link
              href={showArchived ? "/projects" : "/projects?archived=1"}
              className="text-sm font-medium underline underline-offset-4"
            >
              {showArchived ? "მხოლოდ აქტიურები" : "არქივირებულების ჩვენებაც"}
            </Link>
          </div>
          {projects.length === 0 ? (
            <EmptyState title="პროექტები ჯერ არ არის">
              {user.isAdmin
                ? "შექმენით პირველი პროექტი მარჯვენა ფორმით."
                : "ადმინისტრატორს სთხოვეთ პროექტში დამატება."}
            </EmptyState>
          ) : (
            <ul className="grid gap-3">
              {projects.map((p) => (
                <li key={p.id}>
                  <Link
                    href={`/projects/${p.id}`}
                    className="block rounded-lg border border-line bg-white p-4 hover:border-steel"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold">{p.name}</span>
                      <Badge tone={p.status === "ACTIVE" ? "green" : "gray"}>
                        {projectStatusLabel[p.status]}
                      </Badge>
                    </div>
                    <p className="mt-1 text-sm text-steel-600">{p.address}</p>
                    <p className="mt-1 text-xs text-steel-600">წევრები: {p._count.memberships}</p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
        {user.isAdmin && (
          <Card>
            <h2 className="mb-4 text-lg font-semibold">ახალი პროექტი</h2>
            <ProjectForm />
          </Card>
        )}
      </div>
    </>
  );
}
