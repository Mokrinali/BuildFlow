import { Badge } from "@/components/ui";
import type { RequestStatus } from "@/generated/prisma/enums";
import { requestStatusLabel, requestStatusTone } from "@/lib/i18n/ka";

export function RequestStatusBadge({ status }: { status: RequestStatus }) {
  return <Badge tone={requestStatusTone[status]}>{requestStatusLabel[status]}</Badge>;
}
