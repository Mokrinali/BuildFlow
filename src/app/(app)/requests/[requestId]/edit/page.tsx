import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { todayInTbilisi, workDateToInput } from "@/lib/format";
import { formatRequestNumber } from "@/lib/units";
import { AppError } from "@/server/errors";
import { getRequest } from "@/server/requests/service";
import { requireUser } from "@/server/session";
import { RequestForm } from "../../request-form";

export const metadata: Metadata = { title: "მოთხოვნის რედაქტირება" };

type Props = { params: Promise<{ requestId: string }> };

export default async function EditRequestPage({ params }: Props) {
  const { requestId } = await params;
  const user = await requireUser();
  let data;
  try {
    data = await getRequest(user, requestId);
  } catch (e) {
    if (e instanceof AppError && (e.code === "NOT_FOUND" || e.code === "FORBIDDEN")) notFound();
    throw e;
  }
  if (!data.permissions.canEdit) redirect(`/requests/${requestId}`);
  const { request, items } = data;

  return (
    <>
      <PageHeader title={`მოთხოვნა ${formatRequestNumber(request.number)} — რედაქტირება`} />
      <p className="-mt-4 mb-6 text-sm text-steel-600">პროექტი: {request.project.name}</p>
      <RequestForm
        requestId={request.id}
        projects={[request.project]}
        today={todayInTbilisi()}
        initial={{
          projectId: request.project.id,
          desiredDate: workDateToInput(request.desiredDate),
          priority: request.priority,
          note: request.note ?? "",
          items: items.map((it) => ({
            name: it.name,
            spec: it.spec ?? "",
            quantity: it.quantity,
            unit: it.unit,
            note: it.note ?? "",
          })),
        }}
      />
    </>
  );
}
