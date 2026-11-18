// Shared quantity rules for orders and receipts.
//
// Locking rule: every mutation that changes ordered or received quantities first locks the parent
// PurchaseRequest row (`lockRequest`), then re-reads status and sums, validates, writes and calls
// `recomputeRequestStatus`. Under READ COMMITTED this serializes all quantity changes of one
// request, so two parallel orders or receipts cannot both pass the limit check.
// Lock order is always request → organization (order numbering), which avoids deadlocks.
import { Prisma } from "@/generated/prisma/client";
import type { OrderStatus, RequestStatus } from "@/generated/prisma/enums";
import type { Db, Tx } from "@/lib/db";
import type { Actor } from "@/server/access";
import type { DeliveryState } from "@/lib/i18n/ka";
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
  "AWAITING_WAYBILL",
  "RECEIVED",
];

/** Statuses in which new orders may be placed (remaining quantity is checked separately). */
export const ORDERABLE: RequestStatus[] = ["APPROVED", "PARTIALLY_ORDERED", "PARTIALLY_RECEIVED"];

export type ItemProgress = {
  approved: Prisma.Decimal;
  /** Sum over ACTIVE orders only; a line closed short counts as what was received on it. */
  ordered: Prisma.Decimal;
  /** Net received (corrections included). */
  received: Prisma.Decimal;
};

/**
 * Request status from actual quantities. Receiving takes precedence over ordering:
 * all received → RECEIVED (or AWAITING_WAYBILL while a delivery has no waybill);
 * any received → PARTIALLY_RECEIVED; all ordered → ORDERED; any ordered → PARTIALLY_ORDERED;
 * otherwise APPROVED.
 */
export function deriveRequestStatus(
  all: ItemProgress[],
  opts: { waybillMissing?: boolean } = {},
): RequestStatus {
  if (all.length === 0) return "APPROVED";
  // Items whose whole quantity was cancelled (approved 0, nothing received) no longer count.
  const items = all.filter((i) => i.approved.gt(0) || i.received.gt(0));
  if (items.length === 0) return "CANCELLED";
  if (items.every((i) => i.received.gte(i.approved))) {
    return opts.waybillMissing ? "AWAITING_WAYBILL" : "RECEIVED";
  }
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

/** The quantity that may be ordered: the buyer's change, or what was requested. */
export const approvedOf = (it: {
  quantity: Prisma.Decimal;
  approvedQuantity: Prisma.Decimal | null;
}) => it.approvedQuantity ?? it.quantity;

/** How much of an order line counts as ordered: all of it, or the received part once closed. */
export function lineOrdered(line: {
  quantity: Prisma.Decimal;
  closedAt: Date | null;
  received: Prisma.Decimal;
}) {
  return line.closedAt ? line.received : line.quantity;
}

/** Per request item: approved, ordered (active orders) and net received quantities. */
export async function loadItemProgress(tx: Db | Tx, requestId: string) {
  const items = await tx.requestItem.findMany({
    where: { requestId },
    orderBy: { position: "asc" },
    select: {
      id: true,
      quantity: true,
      approvedQuantity: true,
      orderItems: {
        select: {
          quantity: true,
          closedAt: true,
          order: { select: { status: true } },
          receiptItems: { select: { quantity: true } },
        },
      },
    },
  });
  return items.map((it) => {
    const lines = it.orderItems.map((o) => ({
      ...o,
      received: sumDecimals(o.receiptItems.map((r) => r.quantity)),
    }));
    return {
      id: it.id,
      requested: it.quantity,
      approved: approvedOf(it),
      ordered: sumDecimals(lines.filter((o) => o.order.status === "ACTIVE").map(lineOrdered)),
      received: sumDecimals(lines.map((o) => o.received)),
    };
  });
}

/** Recompute and store the request status after an order or receipt change (request locked). */
export async function recomputeRequestStatus(tx: Tx, actor: Actor, req: LockedRequest) {
  if (!ORDER_DRIVEN.includes(req.status)) return req.status;
  const waybillMissing =
    (await missingWaybillOrderIds(tx, Prisma.sql`o."requestId" = ${req.id}`)).length > 0;
  const next = deriveRequestStatus(await loadItemProgress(tx, req.id), { waybillMissing });
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

/**
 * Active orders (matching `where`, SQL over "PurchaseOrder" o) with a delivery that has no
 * waybill yet. Only deliveries that still count are considered: correction-only receipts and
 * entries corrected down to zero need no waybill.
 */
export async function missingWaybillOrderIds(tx: Db | Tx, where: Prisma.Sql): Promise<string[]> {
  const rows = await tx.$queryRaw<{ orderId: string }[]>`
    SELECT DISTINCT r."orderId"
    FROM "Receipt" r
    JOIN "PurchaseOrder" o ON o."id" = r."orderId"
    JOIN "ReceiptItem" ri ON ri."receiptId" = r."id" AND ri."correctsId" IS NULL
    LEFT JOIN (
      SELECT "correctsId", SUM("quantity") AS "delta" FROM "ReceiptItem"
      WHERE "correctsId" IS NOT NULL GROUP BY "correctsId"
    ) c ON c."correctsId" = ri."id"
    WHERE (r."waybillNumber" IS NULL OR r."waybillNumber" = '') AND o."status" = 'ACTIVE' AND ${where}
    GROUP BY r."id", r."orderId"
    HAVING SUM(ri."quantity" + COALESCE(c."delta", 0)) > 0`;
  return rows.map((r) => r.orderId);
}

/**
 * Delivery progress of one order. A line closed short is finished at what was received; an
 * order whose lines are all finished, at least one of them short, is CLOSED.
 */
export function deliveryState(
  status: OrderStatus,
  items: { quantity: string; received: string; closed?: boolean }[],
  waybillMissing = false,
): DeliveryState {
  if (status === "CANCELLED") return "CANCELLED";
  const rec = items.map((i) => new Prisma.Decimal(i.received));
  const full = items.map((i, k) => rec[k]!.gte(i.quantity));
  if (items.every((i, k) => full[k] || i.closed)) {
    // Physically done, but not finished until every delivery has its waybill.
    if (waybillMissing) return "WAYBILL_MISSING";
    return items.some((i, k) => i.closed && !full[k]) ? "CLOSED" : "RECEIVED";
  }
  if (rec.some((r) => r.gt(0))) return "PARTIAL";
  return "AWAITING";
}
