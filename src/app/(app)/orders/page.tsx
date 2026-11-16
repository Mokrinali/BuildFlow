import type { Metadata } from "next";
import { EmptyState, PageHeader } from "@/components/ui";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "შეკვეთები" };

export default async function OrdersPage() {
  await requireUser();
  return (
    <>
      <PageHeader title="შეკვეთები" />
      <EmptyState title="შეკვეთები ჯერ არ არის">
        შეკვეთები და მიღება მესამე ეტაპზე დაემატება.
      </EmptyState>
    </>
  );
}
