import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, PageHeader } from "@/components/ui";
import { todayInTbilisi } from "@/lib/format";
import { projectsForNewRequest } from "@/server/requests/service";
import { requireUser } from "@/server/session";
import { ImportFlow } from "./import-flow";

export const metadata: Metadata = { title: "WhatsApp ტექსტის იმპორტი" };

type Props = { searchParams: Promise<{ project?: string }> };

export default async function ImportPage({ searchParams }: Props) {
  const user = await requireUser();
  const projects = await projectsForNewRequest(user);
  const wanted = (await searchParams).project;
  const preselected = projects.find((p) => p.id === wanted)?.id ?? projects[0]?.id ?? "";

  return (
    <>
      <PageHeader title="WhatsApp ტექსტის იმპორტი" />
      {projects.length === 0 ? (
        <EmptyState title="იმპორტი ვერ ხერხდება">
          მოთხოვნის შესაქმნელად საჭიროა „მომთხოვნის“ როლი აქტიურ პროექტში. მიმართეთ ადმინისტრატორს.{" "}
          <Link href="/requests" className="font-medium underline underline-offset-4">
            მოთხოვნების სია
          </Link>
        </EmptyState>
      ) : (
        <ImportFlow projects={projects} initialProjectId={preselected} today={todayInTbilisi()} />
      )}
    </>
  );
}
