// Purchase requests: drafting, review and cancellation.
// Status rules (CLAUDE.md): DRAFT → IN_REVIEW → APPROVED | REJECTED; REJECTED → DRAFT by the author.
// Items can only change in DRAFT, so changing a submitted/approved request means re-review.
// Order/receipt-driven statuses (PARTIALLY_ORDERED … RECEIVED) are set by the orders module.
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import type { CancellationSide, ProjectRole, RequestStatus } from "@/generated/prisma/enums";
import { db, type Tx } from "@/lib/db";
import { parseWorkDate, tbilisiDayStart, todayInTbilisi } from "@/lib/format";
import { errors } from "@/lib/i18n/ka";
import { isPositiveQuantity, normalizeQuantity } from "@/lib/quantity";
import { requireProjectAccess, type Actor, type ProjectAccess } from "@/server/access";
import { recordEvent } from "@/server/audit";
import {
  ORDERABLE,
  approvedOf,
  deliveryState,
  lineOrdered,
  loadItemProgress,
  lockRequest,
  recomputeRequestStatus,
} from "@/server/orders/progress";
import { closeOrderLines } from "@/server/orders/service";
import { AppError, notFound } from "@/server/errors";
import { parseInput } from "@/server/validation";

export const MAX_ITEMS = 200;
export const PAGE_SIZE = 50;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `მაქსიმუმ ${max} სიმბოლო.`)
    .optional()
    .transform((v) => v || null);

export const itemInput = z.object({
  name: z.string().trim().min(1, "მიუთითეთ დასახელება.").max(200, "მაქსიმუმ 200 სიმბოლო."),
  spec: optionalText(200),
  quantity: z.union([z.string(), z.number()]).transform((v, ctx) => {
    const q = normalizeQuantity(v);
    if (!q || !isPositiveQuantity(q)) {
      ctx.addIssue({
        code: "custom",
        message: "რაოდენობა უნდა იყოს დადებითი რიცხვი (მაქსიმუმ 3 ათწილადი).",
      });
      return z.NEVER;
    }
    return q;
  }),
  unit: z.string().trim().min(1, "მიუთითეთ ერთეული.").max(30, "მაქსიმუმ 30 სიმბოლო."),
  note: optionalText(500),
});

const fieldsInput = {
  desiredDate: z
    .string()
    .trim()
    .optional()
    .transform((v, ctx) => {
      if (!v) return null;
      const d = parseWorkDate(v);
      if (!d) {
        ctx.addIssue({ code: "custom", message: "თარიღის ფორმატი არასწორია." });
        return z.NEVER;
      }
      return d;
    }),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).default("NORMAL"),
  note: optionalText(2000),
  items: z.array(itemInput).max(MAX_ITEMS, `მაქსიმუმ ${MAX_ITEMS} პოზიცია.`),
};

export const createRequestInput = z.object({
  projectId: z.string().min(1, "აირჩიეთ პროექტი.").max(64),
  ...fieldsInput,
});
export const updateRequestInput = z.object(fieldsInput);

const reasonInput = z.object({
  reason: z.string().trim().min(3, errors.reasonRequired).max(1000, "მაქსიმუმ 1000 სიმბოლო."),
});

type ItemData = z.output<typeof itemInput>;

function assertDateNotPast(d: Date | null) {
  if (d && d.toISOString().slice(0, 10) < todayInTbilisi()) {
    throw new AppError("VALIDATION", errors.desiredDatePast, {
      desiredDate: errors.desiredDatePast,
    });
  }
}

const itemRows = (items: ItemData[]) =>
  items.map((it, i) => ({
    position: i + 1,
    name: it.name,
    spec: it.spec,
    quantity: new Prisma.Decimal(it.quantity),
    unit: it.unit,
    note: it.note,
  }));

const itemSnapshotSelect = {
  name: true,
  spec: true,
  quantity: true,
  unit: true,
  note: true,
} as const;

const snapshotItem = (it: {
  name: string;
  spec: string | null;
  quantity: Prisma.Decimal;
  unit: string;
  note: string | null;
}) => ({
  name: it.name,
  spec: it.spec,
  quantity: it.quantity.toString(),
  unit: it.unit,
  note: it.note,
});

const dayOf = (d: Date | null) => d?.toISOString().slice(0, 10) ?? null;

// ─── Create and edit ─────────────────────────────────────────────────────────

export type DraftData = z.output<typeof createRequestInput>;

/**
 * Insert a numbered draft inside the caller's transaction (shared with the WhatsApp import).
 * Requires the REQUESTER role in an active project (admins pass). Input must already be parsed.
 */
export async function insertDraft(
  tx: Tx,
  actor: Actor,
  input: DraftData,
  audit: { action?: string; changes?: Record<string, Prisma.InputJsonValue> } = {},
) {
  assertDateNotPast(input.desiredDate);
  await requireProjectAccess(tx, actor, input.projectId, {
    requiredRoles: ["REQUESTER"],
    write: true,
  });
  // Row lock on the organization serializes numbering: numbers are unique and gap-free.
  const org = await tx.organization.update({
    where: { id: actor.organizationId },
    data: { requestSeq: { increment: 1 } },
    select: { requestSeq: true },
  });
  const request = await tx.purchaseRequest.create({
    data: {
      organizationId: actor.organizationId,
      number: org.requestSeq,
      projectId: input.projectId,
      authorId: actor.userId,
      desiredDate: input.desiredDate,
      priority: input.priority,
      note: input.note,
      items: { create: itemRows(input.items) },
    },
    select: { id: true, number: true },
  });
  await recordEvent(tx, actor, {
    entityType: "PurchaseRequest",
    entityId: request.id,
    projectId: input.projectId,
    action: audit.action ?? "request.created",
    changes: { number: request.number, itemCount: input.items.length, ...audit.changes },
  });
  return request;
}

/** Create a draft. Requires the REQUESTER role in an active project (admins pass). */
export async function createRequest(actor: Actor, raw: unknown) {
  const input = parseInput(createRequestInput, raw);
  assertDateNotPast(input.desiredDate);
  return db.$transaction((tx) => insertDraft(tx, actor, input));
}

/** Edit a draft (author or admin). Items are replaced as a whole. */
export async function updateRequest(actor: Actor, requestId: string, raw: unknown) {
  const input = parseInput(updateRequestInput, raw);
  assertDateNotPast(input.desiredDate);
  return db.$transaction(async (tx) => {
    // Lock first: a concurrent submit waits, so it checks the items this edit leaves behind.
    await lockRequest(tx, actor, requestId);
    const req = await loadForAction(tx, actor, requestId);
    const access = await requireProjectAccess(tx, actor, req.projectId, { write: true });
    if (!isAuthor(actor, req, access)) throw new AppError("FORBIDDEN", errors.forbidden);
    if (req.status !== "DRAFT") throw new AppError("CONFLICT", errors.requestNotEditable);

    const previous = await tx.purchaseRequest.findUniqueOrThrow({
      where: { id: requestId },
      select: {
        note: true,
        desiredDate: true,
        priority: true,
        items: { orderBy: { position: "asc" }, select: itemSnapshotSelect },
      },
    });
    await tx.purchaseRequest.update({
      where: { id: requestId },
      data: { desiredDate: input.desiredDate, priority: input.priority, note: input.note },
    });
    await tx.requestItem.deleteMany({ where: { requestId } });
    await tx.requestItem.createMany({
      data: itemRows(input.items).map((r) => ({ ...r, requestId })),
    });
    await recordEvent(tx, actor, {
      entityType: "PurchaseRequest",
      entityId: requestId,
      projectId: req.projectId,
      action: "request.updated",
      // Full before/after snapshot, so edited values stay traceable (CLAUDE.md audit rule).
      changes: {
        before: {
          desiredDate: dayOf(previous.desiredDate),
          priority: previous.priority,
          note: previous.note,
          items: previous.items.map(snapshotItem),
        },
        after: {
          desiredDate: dayOf(input.desiredDate),
          priority: input.priority,
          note: input.note,
          items: input.items.map((it) => ({
            name: it.name,
            spec: it.spec,
            quantity: it.quantity,
            unit: it.unit,
            note: it.note,
          })),
        },
      },
    });
  });
}

// ─── Status transitions ──────────────────────────────────────────────────────

type Who = "author" | "buyer" | "authorOrBuyer";

type TransitionSpec = {
  from: RequestStatus[];
  to: RequestStatus;
  who: Who;
  action: string;
  reason?: string | null;
  data?: Prisma.PurchaseRequestUncheckedUpdateManyInput;
  check?: (tx: Tx, req: LoadedRequest) => Promise<void>;
  /**
   * The submission the reviewer saw (its submittedAt). A withdraw, edit and resubmit changes it,
   * so a decision made on a stale page is refused instead of approving unseen content.
   */
  expectedSubmittedAt?: Date | null;
};

type LoadedRequest = {
  id: string;
  projectId: string;
  authorId: string;
  status: RequestStatus;
  submittedAt: Date | null;
};

async function loadForAction(tx: Tx, actor: Actor, requestId: string): Promise<LoadedRequest> {
  const req = await tx.purchaseRequest.findUnique({
    where: { id: requestId },
    select: {
      id: true,
      projectId: true,
      authorId: true,
      status: true,
      submittedAt: true,
      organizationId: true,
    },
  });
  if (!req || req.organizationId !== actor.organizationId) throw notFound();
  return req;
}

function isAuthor(actor: Actor, req: { authorId: string }, access: ProjectAccess) {
  return access.isAdmin || req.authorId === actor.userId;
}
function isBuyer(access: ProjectAccess) {
  return access.isAdmin || access.roles.includes("BUYER" as ProjectRole);
}
function allowed(who: Who, actor: Actor, req: { authorId: string }, access: ProjectAccess) {
  if (who === "author") return isAuthor(actor, req, access);
  if (who === "buyer") return isBuyer(access);
  return isAuthor(actor, req, access) || isBuyer(access);
}

async function transition(actor: Actor, requestId: string, spec: TransitionSpec) {
  return db.$transaction(async (tx) => {
    // Lock the row: checks below (items, orders, receipts) see state no one can change meanwhile.
    await lockRequest(tx, actor, requestId);
    const req = await loadForAction(tx, actor, requestId);
    const access = await requireProjectAccess(tx, actor, req.projectId, { write: true });
    if (!allowed(spec.who, actor, req, access)) throw new AppError("FORBIDDEN", errors.forbidden);
    if (!spec.from.includes(req.status)) throw new AppError("CONFLICT", errors.staleStatus);
    if (
      spec.expectedSubmittedAt !== undefined &&
      req.submittedAt?.getTime() !== spec.expectedSubmittedAt?.getTime()
    ) {
      throw new AppError("CONFLICT", errors.requestChanged);
    }
    await spec.check?.(tx, req);
    // Compare-and-set on the status: of two concurrent transitions only one succeeds.
    const updated = await tx.purchaseRequest.updateMany({
      where: { id: requestId, status: req.status },
      data: { status: spec.to, ...spec.data },
    });
    if (updated.count === 0) throw new AppError("CONFLICT", errors.staleStatus);
    await recordEvent(tx, actor, {
      entityType: "PurchaseRequest",
      entityId: requestId,
      projectId: req.projectId,
      action: spec.action,
      changes: { from: req.status, to: spec.to },
      reason: spec.reason ?? null,
    });
  });
}

const reasonOf = (raw: unknown) => parseInput(reasonInput, { reason: raw }).reason;

export async function submitRequest(actor: Actor, requestId: string) {
  return transition(actor, requestId, {
    from: ["DRAFT"],
    to: "IN_REVIEW",
    who: "author",
    action: "request.submitted",
    data: { submittedAt: new Date(), rejectionReason: null },
    check: async (tx) => {
      const r = await tx.purchaseRequest.findUniqueOrThrow({
        where: { id: requestId },
        select: { desiredDate: true, _count: { select: { items: true } } },
      });
      if (r._count.items === 0) throw new AppError("VALIDATION", errors.requestNoItems);
      assertDateNotPast(r.desiredDate);
    },
  });
}

export async function withdrawRequest(actor: Actor, requestId: string) {
  return transition(actor, requestId, {
    from: ["IN_REVIEW"],
    to: "DRAFT",
    who: "author",
    action: "request.withdrawn",
  });
}

/** Review options: the submission the reviewer saw (always sent by the review forms). */
export type ReviewOptions = { expectedSubmittedAt?: Date | null };

export async function approveRequest(actor: Actor, requestId: string, opts: ReviewOptions = {}) {
  return transition(actor, requestId, {
    from: ["IN_REVIEW"],
    to: "APPROVED",
    who: "buyer",
    action: "request.approved",
    data: { reviewedAt: new Date(), reviewedById: actor.userId },
    expectedSubmittedAt: opts.expectedSubmittedAt,
    check: async (tx) => {
      const items = await tx.requestItem.count({ where: { requestId } });
      if (items === 0) throw new AppError("VALIDATION", errors.requestNoItems);
    },
  });
}

export async function rejectRequest(
  actor: Actor,
  requestId: string,
  rawReason: unknown,
  opts: ReviewOptions = {},
) {
  const reason = reasonOf(rawReason);
  return transition(actor, requestId, {
    from: ["IN_REVIEW"],
    to: "REJECTED",
    who: "buyer",
    action: "request.rejected",
    reason,
    data: { reviewedAt: new Date(), reviewedById: actor.userId, rejectionReason: reason },
    expectedSubmittedAt: opts.expectedSubmittedAt,
  });
}

export async function returnToDraft(actor: Actor, requestId: string) {
  return transition(actor, requestId, {
    from: ["REJECTED"],
    to: "DRAFT",
    who: "author",
    action: "request.returned_to_draft",
    // The rejection stays in the audit history; the detail page shows the current review only.
    data: { reviewedAt: null, reviewedById: null },
  });
}

/**
 * Re-open an approved request for changes (needs re-review). Not allowed once any order exists,
 * cancelled ones included: editing replaces the items, and order lines keep pointing at them.
 */
export async function reopenRequest(actor: Actor, requestId: string, rawReason: unknown) {
  const reason = reasonOf(rawReason);
  return transition(actor, requestId, {
    from: ["APPROVED"],
    to: "DRAFT",
    who: "authorOrBuyer",
    action: "request.reopened",
    reason,
    data: { reviewedAt: null, reviewedById: null },
    check: async (tx) => {
      const orders = await tx.purchaseOrder.count({ where: { requestId } });
      if (orders > 0) throw new AppError("CONFLICT", errors.requestHasAnyOrders);
    },
  });
}

/** Cancel with a reason. Blocked while active orders exist or anything was received. */
export async function cancelRequest(actor: Actor, requestId: string, rawReason: unknown) {
  const reason = reasonOf(rawReason);
  return transition(actor, requestId, {
    from: ["DRAFT", "IN_REVIEW", "APPROVED", "REJECTED", "PARTIALLY_ORDERED", "ORDERED"],
    to: "CANCELLED",
    who: "authorOrBuyer",
    action: "request.cancelled",
    reason,
    data: { cancelReason: reason },
    check: async (tx) => {
      // Net quantity: a receipt fully corrected to zero does not block cancellation.
      const received = await tx.receiptItem.aggregate({
        where: { orderItem: { order: { requestId } } },
        _sum: { quantity: true },
      });
      if (received._sum.quantity && !received._sum.quantity.isZero()) {
        throw new AppError("CONFLICT", errors.requestHasReceipts);
      }
      const orders = await tx.purchaseOrder.count({ where: { requestId, status: "ACTIVE" } });
      if (orders > 0) throw new AppError("CONFLICT", errors.requestHasOrders);
    },
  });
}

// ─── Approved quantity and remainder cancellation ────────────────────────────
//
// The buyer can change an item's approved quantity (packaging: 1,5 → 2 t) with a reason.
// Cancelling the undelivered remainder needs both sides: one side asks, a different person on
// the other side confirms (the requester side is the request author, the buyer side holds BUYER;
// admins count as both, but never confirm their own ask).

/** Statuses in which the buyer may change approved quantities. */
const ADJUSTABLE: RequestStatus[] = [
  "IN_REVIEW",
  "APPROVED",
  "PARTIALLY_ORDERED",
  "ORDERED",
  "PARTIALLY_RECEIVED",
];
/** Statuses in which a remainder can be cancelled (something approved is still undelivered). */
const CANCELLABLE: RequestStatus[] = [
  "APPROVED",
  "PARTIALLY_ORDERED",
  "ORDERED",
  "PARTIALLY_RECEIVED",
];

const adjustInput = z.object({
  itemId: z.string().min(1).max(64),
  quantity: z.union([z.string(), z.number()]).transform((v, ctx) => {
    const q = normalizeQuantity(v);
    if (q === null) {
      ctx.addIssue({ code: "custom", message: "მიუთითეთ რიცხვი (მაქსიმუმ 3 ათწილადი)." });
      return z.NEVER;
    }
    return q;
  }),
  reason: reasonInput.shape.reason,
});

/** Lock the request and load the actor's access for an item-level change. */
async function lockForItem(tx: Tx, actor: Actor, requestId: string, itemId: string) {
  const locked = await lockRequest(tx, actor, requestId);
  const req = await loadForAction(tx, actor, requestId);
  const access = await requireProjectAccess(tx, actor, req.projectId, { write: true });
  const item = await tx.requestItem.findUnique({
    where: { id: itemId },
    select: { id: true, requestId: true, name: true, quantity: true, approvedQuantity: true },
  });
  if (!item || item.requestId !== requestId) {
    throw new AppError("VALIDATION", errors.requestItemForeign);
  }
  return { locked, req, access, item };
}

/** Buyer changes the approved quantity of one item, with a reason. */
export async function adjustApprovedQuantity(actor: Actor, requestId: string, raw: unknown) {
  const input = parseInput(adjustInput, raw);
  return db.$transaction(async (tx) => {
    const { locked, req, access, item } = await lockForItem(tx, actor, requestId, input.itemId);
    if (!isBuyer(access)) throw new AppError("FORBIDDEN", errors.forbidden);
    if (!ADJUSTABLE.includes(req.status)) throw new AppError("CONFLICT", errors.adjustNotAllowed);
    if (!isPositiveQuantity(input.quantity)) {
      throw new AppError("VALIDATION", errors.adjustZero, { quantity: errors.adjustZero });
    }
    const next = new Prisma.Decimal(input.quantity);
    const current = approvedOf(item);
    if (next.eq(current)) {
      throw new AppError("VALIDATION", errors.adjustSame, { quantity: errors.adjustSame });
    }
    const p = (await loadItemProgress(tx, requestId)).find((x) => x.id === item.id)!;
    if (next.lt(p.ordered) || next.lt(p.received)) {
      const min = p.ordered.gt(p.received) ? p.ordered : p.received;
      throw new AppError("CONFLICT", errors.adjustBelowOrdered, {
        quantity: `${errors.adjustBelowOrdered} მინიმუმ ${min.toString()}.`,
      });
    }
    await tx.requestItem.update({
      where: { id: item.id },
      // Back to "as requested" stores null, so the page does not show a change that is none.
      data: { approvedQuantity: next.eq(item.quantity) ? null : next },
    });
    await recordEvent(tx, actor, {
      entityType: "PurchaseRequest",
      entityId: requestId,
      projectId: req.projectId,
      action: "request.item_adjusted",
      reason: input.reason,
      changes: { itemId: item.id, name: item.name, from: current.toString(), to: next.toString() },
    });
    await recomputeRequestStatus(tx, actor, locked);
  });
}

const cancelAskInput = z.object({
  itemId: z.string().min(1).max(64),
  reason: reasonInput.shape.reason,
});

/** One side asks to cancel the undelivered remainder of an item. */
export async function requestItemCancellation(actor: Actor, requestId: string, raw: unknown) {
  const input = parseInput(cancelAskInput, raw);
  return db.$transaction(async (tx) => {
    const { req, access, item } = await lockForItem(tx, actor, requestId, input.itemId);
    const requesterSide = isAuthor(actor, req, access);
    if (!requesterSide && !isBuyer(access)) throw new AppError("FORBIDDEN", errors.forbidden);
    if (!CANCELLABLE.includes(req.status)) throw new AppError("CONFLICT", errors.cancelNotAllowed);
    const p = (await loadItemProgress(tx, requestId)).find((x) => x.id === item.id)!;
    if (!p.approved.gt(p.received)) throw new AppError("CONFLICT", errors.cancelNothingLeft);
    const pending = await tx.itemCancellation.count({
      where: { requestItemId: item.id, status: "PENDING" },
    });
    if (pending > 0) throw new AppError("CONFLICT", errors.cancelPendingExists);
    // The request author asks as the requester side, even if they also hold BUYER.
    const side: CancellationSide =
      req.authorId === actor.userId || !isBuyer(access) ? "REQUESTER" : "BUYER";
    const created = await tx.itemCancellation.create({
      data: { requestItemId: item.id, side, reason: input.reason, requestedById: actor.userId },
      select: { id: true },
    });
    await recordEvent(tx, actor, {
      entityType: "PurchaseRequest",
      entityId: requestId,
      projectId: req.projectId,
      action: "request.cancel_requested",
      reason: input.reason,
      changes: {
        cancellationId: created.id,
        itemId: item.id,
        name: item.name,
        side,
        remainder: p.approved.minus(p.received).toString(),
      },
    });
    return created;
  });
}

const decideInput = z.object({
  cancellationId: z.string().min(1).max(64),
  decision: z.enum(["confirm", "reject"]),
  reason: z.string().trim().max(1000, "მაქსიმუმ 1000 სიმბოლო.").optional().default(""),
});

/**
 * The other side confirms or rejects a pending cancellation. On confirm, open order lines of
 * the item are closed at what was received and the approved quantity drops to the received
 * quantity, so nothing more is ordered or delivered for it.
 */
export async function decideItemCancellation(actor: Actor, requestId: string, raw: unknown) {
  const input = parseInput(decideInput, raw);
  if (input.decision === "reject" && input.reason.length < 3) {
    throw new AppError("VALIDATION", errors.reasonRequired, { reason: errors.reasonRequired });
  }
  return db.$transaction(async (tx) => {
    const found = await tx.itemCancellation.findUnique({
      where: { id: input.cancellationId },
      select: { requestItemId: true },
    });
    if (!found) throw notFound();
    const { locked, req, access, item } = await lockForItem(
      tx,
      actor,
      requestId,
      found.requestItemId,
    );
    const c = await tx.itemCancellation.findUniqueOrThrow({
      where: { id: input.cancellationId },
      select: { id: true, status: true, side: true, reason: true, requestedById: true },
    });
    if (c.status !== "PENDING") throw new AppError("CONFLICT", errors.cancelNotPending);
    if (c.requestedById === actor.userId) {
      throw new AppError("FORBIDDEN", errors.cancelOwnDecision);
    }
    const otherSide = c.side === "REQUESTER" ? isBuyer(access) : isAuthor(actor, req, access);
    if (!otherSide) throw new AppError("FORBIDDEN", errors.cancelWrongSide);

    if (input.decision === "reject") {
      await tx.itemCancellation.update({
        where: { id: c.id },
        data: {
          status: "REJECTED",
          decidedById: actor.userId,
          decidedAt: new Date(),
          decisionReason: input.reason,
        },
      });
      await recordEvent(tx, actor, {
        entityType: "PurchaseRequest",
        entityId: requestId,
        projectId: req.projectId,
        action: "request.cancel_rejected",
        reason: input.reason,
        changes: { cancellationId: c.id, itemId: item.id, name: item.name },
      });
      return { status: "REJECTED" as const };
    }

    await closeOrderLines(tx, actor, locked, { requestItemId: item.id }, c.reason);
    const p = (await loadItemProgress(tx, requestId)).find((x) => x.id === item.id)!;
    const cancelled = p.approved.minus(p.received);
    await tx.requestItem.update({
      where: { id: item.id },
      data: { approvedQuantity: p.received },
    });
    await tx.itemCancellation.update({
      where: { id: c.id },
      data: {
        status: "CONFIRMED",
        decidedById: actor.userId,
        decidedAt: new Date(),
        decisionReason: input.reason || null,
        cancelledQuantity: cancelled.isNegative() ? new Prisma.Decimal(0) : cancelled,
      },
    });
    await recordEvent(tx, actor, {
      entityType: "PurchaseRequest",
      entityId: requestId,
      projectId: req.projectId,
      action: "request.cancel_confirmed",
      reason: c.reason,
      changes: {
        cancellationId: c.id,
        itemId: item.id,
        name: item.name,
        cancelled: cancelled.toString(),
        decisionReason: input.reason || null,
      },
    });
    const status = await recomputeRequestStatus(tx, actor, locked);
    // Everything cancelled before anything arrived: the request itself ends as cancelled.
    if (status === "CANCELLED") {
      await tx.purchaseRequest.update({
        where: { id: requestId },
        data: { cancelReason: c.reason },
      });
    }
    return { status: "CONFIRMED" as const };
  });
}

/** The asker withdraws their own pending cancellation. */
export async function withdrawItemCancellation(actor: Actor, requestId: string, raw: unknown) {
  const { cancellationId } = parseInput(
    z.object({ cancellationId: z.string().min(1).max(64) }),
    raw,
  );
  return db.$transaction(async (tx) => {
    const found = await tx.itemCancellation.findUnique({
      where: { id: cancellationId },
      select: { requestItemId: true },
    });
    if (!found) throw notFound();
    const { req, item } = await lockForItem(tx, actor, requestId, found.requestItemId);
    const c = await tx.itemCancellation.findUniqueOrThrow({
      where: { id: cancellationId },
      select: { status: true, requestedById: true },
    });
    if (c.status !== "PENDING") throw new AppError("CONFLICT", errors.cancelNotPending);
    if (c.requestedById !== actor.userId) throw new AppError("FORBIDDEN", errors.forbidden);
    await tx.itemCancellation.update({
      where: { id: cancellationId },
      data: { status: "WITHDRAWN", decidedById: actor.userId, decidedAt: new Date() },
    });
    await recordEvent(tx, actor, {
      entityType: "PurchaseRequest",
      entityId: requestId,
      projectId: req.projectId,
      action: "request.cancel_withdrawn",
      changes: { cancellationId, itemId: item.id, name: item.name },
    });
  });
}

/** Pending cancellations the actor can decide (for the dashboard). */
export async function cancellationsToDecide(actor: Actor) {
  const rows = await db.itemCancellation.findMany({
    where: {
      status: "PENDING",
      requestedById: { not: actor.userId },
      requestItem: {
        request: {
          organizationId: actor.organizationId,
          project: {
            status: "ACTIVE",
            ...(actor.isAdmin ? {} : { memberships: { some: { userId: actor.userId } } }),
          },
        },
      },
    },
    orderBy: { createdAt: "asc" },
    take: 50,
    select: {
      id: true,
      side: true,
      reason: true,
      createdAt: true,
      requestedBy: { select: { name: true } },
      requestItem: {
        select: {
          name: true,
          request: {
            select: {
              id: true,
              number: true,
              authorId: true,
              projectId: true,
              project: { select: { name: true } },
            },
          },
        },
      },
    },
  });
  const buyerProjects = actor.isAdmin
    ? null
    : new Set(
        (
          await db.projectMembership.findMany({
            where: { userId: actor.userId, roles: { has: "BUYER" } },
            select: { projectId: true },
          })
        ).map((m) => m.projectId),
      );
  return rows
    .filter((r) => {
      const req = r.requestItem.request;
      const buyer = buyerProjects === null || buyerProjects.has(req.projectId);
      const requester = actor.isAdmin || req.authorId === actor.userId;
      return r.side === "REQUESTER" ? buyer : requester;
    })
    .map((r) => ({
      id: r.id,
      side: r.side,
      reason: r.reason,
      createdAt: r.createdAt,
      requestedBy: r.requestedBy.name,
      itemName: r.requestItem.name,
      request: {
        id: r.requestItem.request.id,
        number: r.requestItem.request.number,
        projectName: r.requestItem.request.project.name,
      },
    }));
}

// ─── Queries ─────────────────────────────────────────────────────────────────

export type RequestPermissions = {
  canEdit: boolean;
  canSubmit: boolean;
  canWithdraw: boolean;
  canApprove: boolean;
  canReject: boolean;
  canReturnToDraft: boolean;
  canReopen: boolean;
  canCancel: boolean;
  canOrder: boolean;
};

function permissionsFor(
  actor: Actor,
  req: { authorId: string; status: RequestStatus },
  access: ProjectAccess,
  ctx: { hasOrders: boolean; anyToOrder: boolean },
): RequestPermissions {
  const none: RequestPermissions = {
    canEdit: false,
    canSubmit: false,
    canWithdraw: false,
    canApprove: false,
    canReject: false,
    canReturnToDraft: false,
    canReopen: false,
    canCancel: false,
    canOrder: false,
  };
  if (access.archived) return none;
  const author = isAuthor(actor, req, access);
  const buyer = isBuyer(access);
  const s = req.status;
  return {
    canEdit: author && s === "DRAFT",
    canSubmit: author && s === "DRAFT",
    canWithdraw: author && s === "IN_REVIEW",
    canApprove: buyer && s === "IN_REVIEW",
    canReject: buyer && s === "IN_REVIEW",
    canReturnToDraft: author && s === "REJECTED",
    canReopen: (author || buyer) && s === "APPROVED" && !ctx.hasOrders,
    canCancel:
      (author || buyer) &&
      ["DRAFT", "IN_REVIEW", "APPROVED", "REJECTED", "PARTIALLY_ORDERED", "ORDERED"].includes(s),
    canOrder: buyer && ORDERABLE.includes(s) && ctx.anyToOrder,
  };
}

const sum = (values: Prisma.Decimal[]) => values.reduce((a, b) => a.plus(b), new Prisma.Decimal(0));

/** Full request for the details page, with per-item progress and allowed actions. */
export async function getRequest(actor: Actor, requestId: string) {
  const req = await db.purchaseRequest.findUnique({
    where: { id: requestId },
    include: {
      project: { select: { id: true, name: true } },
      author: { select: { id: true, name: true } },
      reviewedBy: { select: { name: true } },
      items: {
        orderBy: { position: "asc" },
        include: {
          orderItems: {
            select: {
              quantity: true,
              closedAt: true,
              order: { select: { status: true } },
              receiptItems: { select: { quantity: true } },
            },
          },
          cancellations: {
            where: { status: "PENDING" },
            select: {
              id: true,
              side: true,
              reason: true,
              createdAt: true,
              requestedById: true,
              requestedBy: { select: { name: true } },
            },
          },
        },
      },
      orders: {
        orderBy: { number: "asc" },
        select: {
          id: true,
          number: true,
          status: true,
          currency: true,
          plannedDeliveryDate: true,
          supplier: { select: { name: true } },
          items: {
            select: {
              quantity: true,
              unitPrice: true,
              closedAt: true,
              receiptItems: { select: { quantity: true } },
            },
          },
        },
      },
    },
  });
  if (!req || req.organizationId !== actor.organizationId) throw notFound();
  const access = await requireProjectAccess(db, actor, req.projectId);

  const buyerSide = isBuyer(access) && !access.archived;
  const requesterSide = isAuthor(actor, req, access) && !access.archived;
  const items = req.items.map((it) => {
    const lines = it.orderItems.map((o) => ({
      ...o,
      received: sum(o.receiptItems.map((r) => r.quantity)),
    }));
    const ordered = sum(lines.filter((o) => o.order.status === "ACTIVE").map(lineOrdered));
    const received = sum(lines.map((o) => o.received));
    const approved = approvedOf(it);
    const remaining = approved.minus(received);
    const pending = it.cancellations[0];
    return {
      id: it.id,
      position: it.position,
      name: it.name,
      spec: it.spec,
      unit: it.unit,
      note: it.note,
      quantity: it.quantity.toString(),
      approved: approved.toString(),
      changed: it.approvedQuantity !== null && !it.approvedQuantity.eq(it.quantity),
      ordered: ordered.toString(),
      received: received.toString(),
      remaining: (remaining.isNegative() ? new Prisma.Decimal(0) : remaining).toString(),
      pendingCancellation: pending
        ? {
            id: pending.id,
            side: pending.side,
            reason: pending.reason,
            createdAt: pending.createdAt,
            requestedBy: pending.requestedBy.name,
            canDecide:
              pending.requestedById !== actor.userId &&
              (pending.side === "REQUESTER" ? buyerSide : requesterSide),
            canWithdraw: pending.requestedById === actor.userId && !access.archived,
          }
        : null,
      canAdjust: buyerSide && ADJUSTABLE.includes(req.status),
      canRequestCancel:
        (buyerSide || requesterSide) &&
        CANCELLABLE.includes(req.status) &&
        !pending &&
        remaining.gt(0),
    };
  });

  const orders = req.orders.map(({ items: lines, ...o }) => ({
    ...o,
    delivery: deliveryState(
      o.status,
      lines.map((l) => ({
        quantity: l.quantity.toString(),
        received: sum(l.receiptItems.map((r) => r.quantity)).toString(),
        closed: l.closedAt !== null,
      })),
    ),
    total: sum(
      lines.map((l) =>
        l.quantity.times(l.unitPrice).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP),
      ),
    ).toString(),
  }));

  // The request timeline also shows its orders and deliveries.
  const events = await db.auditEvent.findMany({
    where: {
      OR: [
        { entityType: "PurchaseRequest", entityId: requestId },
        { entityType: "PurchaseOrder", entityId: { in: orders.map((o) => o.id) } },
      ],
    },
    orderBy: { seq: "desc" },
    select: {
      id: true,
      action: true,
      entityType: true,
      changes: true,
      reason: true,
      createdAt: true,
      actor: { select: { name: true } },
    },
  });

  return {
    request: {
      id: req.id,
      number: req.number,
      status: req.status,
      priority: req.priority,
      desiredDate: req.desiredDate,
      note: req.note,
      createdAt: req.createdAt,
      submittedAt: req.submittedAt,
      reviewedAt: req.reviewedAt,
      rejectionReason: req.rejectionReason,
      cancelReason: req.cancelReason,
      project: req.project,
      author: req.author,
      reviewedBy: req.reviewedBy,
    },
    items,
    orders,
    events,
    access,
    permissions: permissionsFor(actor, req, access, {
      hasOrders: orders.length > 0,
      anyToOrder: items.some((i) => new Prisma.Decimal(i.approved).gt(i.ordered)),
    }),
  };
}

const statusValues = [
  "DRAFT",
  "IN_REVIEW",
  "APPROVED",
  "REJECTED",
  "PARTIALLY_ORDERED",
  "ORDERED",
  "PARTIALLY_RECEIVED",
  "RECEIVED",
  "CANCELLED",
] as const;

const OPEN_STATUSES: RequestStatus[] = [
  "IN_REVIEW",
  "APPROVED",
  "PARTIALLY_ORDERED",
  "ORDERED",
  "PARTIALLY_RECEIVED",
];

/** URL filters for the request list (unknown or invalid values are ignored). */
export const listFiltersSchema = z.object({
  project: z.string().max(64).optional().catch(undefined),
  // "OPEN" = every status still in progress (what the dashboard counts as open requests).
  status: z
    .enum([...statusValues, "OPEN"])
    .optional()
    .catch(undefined),
  // "1" = only requests the actor wrote.
  mine: z.literal("1").optional().catch(undefined),
  q: z.string().trim().max(100).optional().catch(undefined),
  from: z.string().optional().catch(undefined),
  to: z.string().optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).optional().catch(undefined),
});
export type ListFilters = z.output<typeof listFiltersSchema>;

function visibleRequestsWhere(actor: Actor): Prisma.PurchaseRequestWhereInput {
  return actor.isAdmin
    ? { organizationId: actor.organizationId }
    : {
        organizationId: actor.organizationId,
        project: { memberships: { some: { userId: actor.userId } } },
      };
}

export async function listRequests(actor: Actor, rawFilters: unknown) {
  const f = listFiltersSchema.parse(rawFilters ?? {});
  const and: Prisma.PurchaseRequestWhereInput[] = [visibleRequestsWhere(actor)];
  if (f.project) and.push({ projectId: f.project });
  if (f.status === "OPEN") and.push({ status: { in: OPEN_STATUSES } });
  else if (f.status) and.push({ status: f.status });
  if (f.mine) and.push({ authorId: actor.userId });
  if (f.q) {
    const digits = f.q.replace(/^№/, "").replace(/^0+(?=\d)/, "");
    const num = /^\d{1,9}$/.test(digits) ? Number(digits) : null;
    and.push({
      OR: [
        ...(num !== null ? [{ number: num }] : []),
        { items: { some: { name: { contains: f.q, mode: "insensitive" as const } } } },
      ],
    });
  }
  const from = f.from ? tbilisiDayStart(f.from) : null;
  const toStart = f.to ? tbilisiDayStart(f.to) : null;
  if (from) and.push({ createdAt: { gte: from } });
  if (toStart) and.push({ createdAt: { lt: new Date(toStart.getTime() + 24 * 3600 * 1000) } });

  const where = { AND: and };
  const total = await db.purchaseRequest.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  // An out-of-range page (an old link, a typed URL) shows the last page, not "no requests yet".
  const page = Math.min(f.page ?? 1, pageCount);
  const [rows] = await Promise.all([
    db.purchaseRequest.findMany({
      where,
      orderBy: { number: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        number: true,
        status: true,
        priority: true,
        desiredDate: true,
        createdAt: true,
        project: { select: { id: true, name: true } },
        author: { select: { name: true } },
        _count: { select: { items: true } },
      },
    }),
  ]);
  return { rows, total, page, pageCount, filters: f };
}

/** Numbers for the dashboard: open requests, awaiting my review, my drafts. */
export async function requestDashboard(actor: Actor) {
  const visible = visibleRequestsWhere(actor);
  const buyerScope: Prisma.PurchaseRequestWhereInput = actor.isAdmin
    ? visible
    : {
        organizationId: actor.organizationId,
        project: { memberships: { some: { userId: actor.userId, roles: { has: "BUYER" } } } },
      };
  const [open, awaitingReview, myDrafts, toOrder, recent] = await Promise.all([
    db.purchaseRequest.count({ where: { AND: [visible, { status: { in: OPEN_STATUSES } }] } }),
    db.purchaseRequest.count({ where: { AND: [buyerScope, { status: "IN_REVIEW" }] } }),
    db.purchaseRequest.count({
      where: { AND: [visible, { status: "DRAFT", authorId: actor.userId }] },
    }),
    // Approved and not ordered at all yet: the buyer's next step.
    db.purchaseRequest.count({ where: { AND: [buyerScope, { status: "APPROVED" }] } }),
    db.purchaseRequest.findMany({
      where: { AND: [visible, { status: { in: OPEN_STATUSES } }] },
      orderBy: { number: "desc" },
      take: 5,
      select: {
        id: true,
        number: true,
        status: true,
        desiredDate: true,
        project: { select: { name: true } },
      },
    }),
  ]);
  return { open, awaitingReview, myDrafts, toOrder, recent };
}

/** Active projects where the actor may create requests (REQUESTER role, or admin). */
export async function projectsForNewRequest(actor: Actor) {
  return db.project.findMany({
    where: {
      organizationId: actor.organizationId,
      status: "ACTIVE",
      ...(actor.isAdmin
        ? {}
        : { memberships: { some: { userId: actor.userId, roles: { has: "REQUESTER" } } } }),
    },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
}
