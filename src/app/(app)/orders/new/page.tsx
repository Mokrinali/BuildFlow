import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EmptyState, PageHeader } from "@/components/ui";
import { todayInTbilisi } from "@/lib/format";
import { formatRequestNumber } from "@/lib/units";
import { AppError } from "@/server/errors";
import { getOrderDraft } from "@/server/orders/service";
import { requireUser } from "@/server/session";
import { OrderForm } from "./order-form";

export const metadata: Metadata = { title: "ახალი შეკვეთა" };

type Props = { searchParams: Promise<{ request?: string }> };

export default async function NewOrderPage({ searchParams }: Props) {
  const user = await requireUser();
  const requestId = (await searchParams).request;
  if (!requestId) notFound();
  let draft;
  try {
    draft = await getOrderDraft(user, requestId);
  } catch (e) {
    if (e instanceof AppError && (e.code === "NOT_FOUND" || e.code === "FORBIDDEN")) notFound();
    if (e instanceof AppError && e.code === "CONFLICT") {
      return (
        <>
          <PageHeader title="ახალი შეკვეთა" />
          <EmptyState title="შეკვეთის გაფორმება ვერ ხერხდება">
            {e.message}{" "}
            <Link
              href={`/requests/${requestId}`}
              className="font-medium underline underline-offset-4"
            >
              მოთხოვნაზე დაბრუნება
            </Link>
          </EmptyState>
        </>
      );
    }
    throw e;
  }
  const { request, items, suppliers } = draft;

  return (
    <>
      <PageHeader title="ახალი შეკვეთა" />
      <p className="mb-6 text-sm text-steel-600">
        მოთხოვნა{" "}
        <Link href={`/requests/${request.id}`} className="font-medium underline underline-offset-4">
          {formatRequestNumber(request.number)}
        </Link>{" "}
        · {request.projectName}
      </p>
      {items.every((i) => i.available === "0") ? (
        <EmptyState title="შესაკვეთი რაოდენობა აღარ დარჩა">
          ყველა დამტკიცებული რაოდენობა უკვე შეკვეთილია.
        </EmptyState>
      ) : (
        <OrderForm
          requestId={request.id}
          items={items}
          suppliers={suppliers}
          today={todayInTbilisi()}
        />
      )}
    </>
  );
}
