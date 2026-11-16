import type { Metadata } from "next";
import { EmptyState, PageHeader } from "@/components/ui";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "მოთხოვნები" };

export default async function RequestsPage() {
  await requireUser();
  return (
    <>
      <PageHeader title="მოთხოვნები" />
      <EmptyState title="მოთხოვნები ჯერ არ არის">
        მოთხოვნების შექმნა და განხილვა მომდევნო ეტაპზე დაემატება.
      </EmptyState>
    </>
  );
}
