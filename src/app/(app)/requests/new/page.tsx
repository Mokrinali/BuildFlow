import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, PageHeader } from "@/components/ui";
import { todayInTbilisi } from "@/lib/format";
import { projectsForNewRequest } from "@/server/requests/service";
import { requireUser } from "@/server/session";
import { RequestForm } from "../request-form";

export const metadata: Metadata = { title: "ახალი მოთხოვნა" };

type Props = { searchParams: Promise<{ project?: string }> };

export default async function NewRequestPage({ searchParams }: Props) {
  const user = await requireUser();
  const projects = await projectsForNewRequest(user);
  const wanted = (await searchParams).project;
  const preselected = projects.find((p) => p.id === wanted)?.id ?? projects[0]?.id ?? "";

  return (
    <>
      <PageHeader title="ახალი მოთხოვნა" />
      {projects.length === 0 ? (
        <EmptyState title="მოთხოვნის შექმნა ვერ ხერხდება">
          მოთხოვნის შესაქმნელად საჭიროა „მომთხოვნის“ როლი აქტიურ პროექტში. მიმართეთ ადმინისტრატორს.{" "}
          <Link href="/requests" className="font-medium underline underline-offset-4">
            მოთხოვნების სია
          </Link>
        </EmptyState>
      ) : (
        <RequestForm
          requestId={null}
          projects={projects}
          today={todayInTbilisi()}
          initial={{
            projectId: preselected,
            desiredDate: "",
            priority: "NORMAL",
            note: "",
            items: [],
          }}
        />
      )}
    </>
  );
}
