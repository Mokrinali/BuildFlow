import type { Metadata } from "next";
import { EmptyState, PageHeader } from "@/components/ui";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "ახალი მოთხოვნა" };

export default async function NewRequestPage() {
  await requireUser();
  return (
    <>
      <PageHeader title="ახალი მოთხოვნა" />
      <EmptyState title="მოთხოვნის ფორმა მზადდება">
        მოთხოვნის შექმნა მომდევნო ეტაპზე დაემატება.
      </EmptyState>
    </>
  );
}
