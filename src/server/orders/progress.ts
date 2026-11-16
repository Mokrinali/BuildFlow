// Shared quantity rules for orders and receipts.
//
// Locking rule: every mutation that changes ordered or received quantities first locks the parent
// PurchaseRequest row (`lockRequest`), then re-reads status and sums, validates, writes and calls
// `recomputeRequestStatus`. Under READ COMMITTED this serializes all quantity changes of one
// request, so two parallel orders or receipts cannot both pass the limit check.
// Lock order is always request → organization (order numbering), which avoids deadlocks.
import { Prisma } from "@/generated/prisma/client";
import type { RequestStatus } from "@/generated/prisma/enums";
import type { Db, Tx } from "@/lib/db";
import type { Actor } from "@/server/access";
import { recordEvent } from "@/server/audit";
import { notFound } from "@/server/errors";

const ZERO = new Prisma.Decimal(0);
export const sumDecimals = (values: Prisma.Decimal[]) => values.reduce((a, b) => a.plus(b), ZERO);

/** Statuses that are derived from ordered and received quantities. */
export const ORDER_DRIVEN: RequestStatus[] = [
  "APPROVED",
  "PARTIALLY_ORDERED",
  "ORDERED",
  "PARTIALLY_RECEIVED",
  "RECEIVED",
];

/** Statuses in which new orders may be placed (remaining quantity is checked separately). */
export const ORDERABLE: RequestStatus[] = ["APPROVED", "PARTIALLY_ORDERED", "PARTIALLY_RECEIVED"];

export type ItemProgress = {
  approved: Prisma.Decimal;
  /** Sum over ACTIVE orders only. */
  ordered: Prisma.Decimal;
  /** Net received (corrections included). */
  received: Prisma.Decimal;
};

/**
 * Request status from actual quantities. Receiving takes precedence over ordering:
 * all received → RECEIVED; any received → PARTIALLY_RECEIVED; all ordered → ORDERED;
 * any ordered → PARTIALLY_ORDERED; otherwise APPROVED.
 */
export function deriveRequestStatus(items: ItemProgress[]): RequestStatus {
  if (items.length === 0) return "APPROVED";
  if (items.every((i) => i.received.gte(i.approved))) return "RECEIVED";
  if (items.some((i) => i.received.gt(0))) return "PARTIALLY_RECEIVED";
  if (items.every((i) => i.ordered.gte(i.approved))) return "ORDERED";
  if (items.some((i) => i.ordered.gt(0))) return "PARTIALLY_ORDERED";
  return "APPROVED";
}

export type LockedRequest = {
  id: string;
  organizationId: string;
  projectId: string;
  status: RequestStatus;
};

/** Lock the request row for the rest of the transaction and return its current state. */
export async function lockRequest(tx: Tx, actor: Actor, requestId: string): Promise<LockedRequest> {
  const rows = await tx.$queryRaw<LockedRequest[]>`
    SELECT "id", "organizationId", "projectId", "status"::text AS "status"
    FROM "PurchaseRequest" WHERE "id" = ${requestId} FOR UPDATE`;
  const req = rows[0];
  if (!req || req.organizationId !== actor.organizationId) throw notFound();
  return req;
}

/** Per request item: approved, ordered (active orders) and net received quantities. */
export async function loadItemProgress(tx: Db | Tx, requestId: string) {
  const items = await tx.requestItem.findMany({
    where: { requestId },
    orderBy: { position: "asc" },
    select: {
      id: true,
      quantity: true,
      orderItems: {
        select: {
          quantity: true,
          order: { select: { status: true } },
          receiptItems: { select: { quantity: true } },
        },
      },
    },
  });
  return items.map((it) => ({
    id: it.id,
    approved: it.quantity,
    ordered: sumDecimals(
      it.orderItems.filter((o) => o.order.status === "ACTIVE").map((o) => o.quantity),
    ),
    received: sumDecimals(it.orderItems.flatMap((o) => o.receiptItems.map((r) => r.quantity))),
  }));
}

/** Recompute and store the request status after an order or receipt change (request locked). */
export async function recomputeRequestStatus(tx: Tx, actor: Actor, req: LockedRequest) {
  if (!ORDER_DRIVEN.includes(req.status)) return req.status;
  const next = deriveRequestStatus(await loadItemProgress(tx, req.id));
  if (next === req.status) return next;
  await tx.purchaseRequest.update({ where: { id: req.id }, data: { status: next } });
  await recordEvent(tx, actor, {
    entityType: "PurchaseRequest",
    entityId: req.id,
    projectId: req.projectId,
    action: "request.status_changed",
    changes: { from: req.status, to: next },
  });
  return next;
}
