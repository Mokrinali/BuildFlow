import { Badge } from "@/components/ui";
import type { RequestStatus } from "@/generated/prisma/enums";
import {
  deliveryStateLabel,
  deliveryStateTone,
  requestStatusLabel,
  requestStatusTone,
  type DeliveryState,
} from "@/lib/i18n/ka";

export function RequestStatusBadge({ status }: { status: RequestStatus }) {
  return <Badge tone={requestStatusTone[status]}>{requestStatusLabel[status]}</Badge>;
}

export function DeliveryBadge({ state }: { state: DeliveryState }) {
  return <Badge tone={deliveryStateTone[state]}>{deliveryStateLabel[state]}</Badge>;
}
