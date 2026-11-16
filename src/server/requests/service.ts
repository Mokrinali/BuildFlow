// Purchase requests: drafting, review and cancellation.
// Status rules (CLAUDE.md): DRAFT → IN_REVIEW → APPROVED | REJECTED; REJECTED → DRAFT by the author.
// Items can only change in DRAFT, so changing a submitted/approved request means re-review.
// Order/receipt-driven statuses (PARTIALLY_ORDERED … RECEIVED) are set by the orders module.
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import type { ProjectRole, RequestStatus } from "@/generated/prisma/enums";
import { db, type Tx } from "@/lib/db";
import { parseWorkDate, tbilisiDayStart, todayInTbilisi } from "@/lib/format";
import { errors } from "@/lib/i18n/ka";
import { isPositiveQuantity, normalizeQuantity } from "@/lib/quantity";
import { requireProjectAccess, type Actor, type ProjectAccess } from "@/server/access";
import { recordEvent } from "@/server/audit";
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

// ─── Create and edit ─────────────────────────────────────────────────────────

/** Create a draft. Requires the REQUESTER role in an active project (admins pass). */
export async function createRequest(actor: Actor, raw: unknown) {
  const input = parseInput(createRequestInput, raw);
  assertDateNotPast(input.desiredDate);
  return db.$transaction(async (tx) => {
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
      action: "request.created",
      changes: { number: request.number, itemCount: input.items.length },
    });
    return request;
  });
}

/** Edit a draft (author or admin). Items are replaced as a whole. */
export async function updateRequest(actor: Actor, requestId: string, raw: unknown) {
  const input = parseInput(updateRequestInput, raw);
  assertDateNotPast(input.desiredDate);
  return db.$transaction(async (tx) => {
    const req = await loadForAction(tx, actor, requestId);
    const access = await requireProjectAccess(tx, actor, req.projectId, { write: true });
    if (!isAuthor(actor, req, access)) throw new AppError("FORBIDDEN", errors.forbidden);
    // Claim the row only while it is still a draft (guards against a concurrent submit).
    const claimed = await tx.purchaseRequest.updateMany({
      where: { id: requestId, status: "DRAFT" },
      data: { desiredDate: input.desiredDate, priority: input.priority, note: input.note },
    });
    if (claimed.count === 0) throw new AppError("CONFLICT", errors.requestNotEditable);

    const before = await tx.requestItem.count({ where: { requestId } });
    await tx.requestItem.deleteMany({ where: { requestId } });
    await tx.requestItem.createMany({
      data: itemRows(input.items).map((r) => ({ ...r, requestId })),
    });
    await recordEvent(tx, actor, {
      entityType: "PurchaseRequest",
      entityId: requestId,
      projectId: req.projectId,
      action: "request.updated",
      changes: {
        itemCountBefore: before,
        itemCountAfter: input.items.length,
        desiredDate: input.desiredDate?.toISOString().slice(0, 10) ?? null,
        priority: input.priority,
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
};

type LoadedRequest = { id: string; projectId: string; authorId: string; status: RequestStatus };

async function loadForAction(tx: Tx, actor: Actor, requestId: string): Promise<LoadedRequest> {
  const req = await tx.purchaseRequest.findUnique({
    where: { id: requestId },
    select: { id: true, projectId: true, authorId: true, status: true, organizationId: true },
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
    const req = await loadForAction(tx, actor, requestId);
    const access = await requireProjectAccess(tx, actor, req.projectId, { write: true });
    if (!allowed(spec.who, actor, req, access)) throw new AppError("FORBIDDEN", errors.forbidden);
    if (!spec.from.includes(req.status)) throw new AppError("CONFLICT", errors.staleStatus);
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

export async function approveRequest(actor: Actor, requestId: string) {
  return transition(actor, requestId, {
    from: ["IN_REVIEW"],
    to: "APPROVED",
    who: "buyer",
    action: "request.approved",
    data: { reviewedAt: new Date(), reviewedById: actor.userId },
  });
}

export async function rejectRequest(actor: Actor, requestId: string, rawReason: unknown) {
  const reason = reasonOf(rawReason);
  return transition(actor, requestId, {
    from: ["IN_REVIEW"],
    to: "REJECTED",
    who: "buyer",
    action: "request.rejected",
    reason,
    data: { reviewedAt: new Date(), reviewedById: actor.userId, rejectionReason: reason },
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

/** Re-open an approved request for changes (needs re-review). Not allowed once ordered. */
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
      const orders = await tx.purchaseOrder.count({ where: { requestId, status: "ACTIVE" } });
      if (orders > 0) throw new AppError("CONFLICT", errors.requestHasOrders);
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
      const receipts = await tx.receiptItem.count({
        where: { orderItem: { order: { requestId } } },
      });
      if (receipts > 0) throw new AppError("CONFLICT", errors.requestHasReceipts);
      const orders = await tx.purchaseOrder.count({ where: { requestId, status: "ACTIVE" } });
      if (orders > 0) throw new AppError("CONFLICT", errors.requestHasOrders);
    },
  });
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
};

function permissionsFor(
  actor: Actor,
  req: { authorId: string; status: RequestStatus },
  access: ProjectAccess,
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
    canReopen: (author || buyer) && s === "APPROVED",
    canCancel:
      (author || buyer) &&
      ["DRAFT", "IN_REVIEW", "APPROVED", "REJECTED", "PARTIALLY_ORDERED", "ORDERED"].includes(s),
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
              order: { select: { status: true } },
              receiptItems: { select: { quantity: true } },
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
        },
      },
    },
  });
  if (!req || req.organizationId !== actor.organizationId) throw notFound();
  const access = await requireProjectAccess(db, actor, req.projectId);

  const items = req.items.map((it) => {
    const active = it.orderItems.filter((o) => o.order.status === "ACTIVE");
    const ordered = sum(active.map((o) => o.quantity));
    const received = sum(it.orderItems.flatMap((o) => o.receiptItems.map((r) => r.quantity)));
    const remaining = it.quantity.minus(received);
    return {
      id: it.id,
      position: it.position,
      name: it.name,
      spec: it.spec,
      unit: it.unit,
      note: it.note,
      quantity: it.quantity.toString(),
      ordered: ordered.toString(),
      received: received.toString(),
      remaining: (remaining.isNegative() ? new Prisma.Decimal(0) : remaining).toString(),
    };
  });

  const events = await db.auditEvent.findMany({
    where: { entityType: "PurchaseRequest", entityId: requestId },
    orderBy: { seq: "desc" },
    select: {
      id: true,
      action: true,
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
    orders: req.orders,
    events,
    access,
    permissions: permissionsFor(actor, req, access),
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

/** URL filters for the request list (unknown or invalid values are ignored). */
export const listFiltersSchema = z.object({
  project: z.string().max(64).optional().catch(undefined),
  status: z.enum(statusValues).optional().catch(undefined),
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
  if (f.status) and.push({ status: f.status });
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
  const page = f.page ?? 1;
  const [total, rows] = await Promise.all([
    db.purchaseRequest.count({ where }),
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
  return { rows, total, page, pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)), filters: f };
}

const OPEN_STATUSES: RequestStatus[] = [
  "IN_REVIEW",
  "APPROVED",
  "PARTIALLY_ORDERED",
  "ORDERED",
  "PARTIALLY_RECEIVED",
];

/** Numbers for the dashboard: open requests, awaiting my review, my drafts. */
export async function requestDashboard(actor: Actor) {
  const visible = visibleRequestsWhere(actor);
  const buyerScope: Prisma.PurchaseRequestWhereInput = actor.isAdmin
    ? visible
    : {
        organizationId: actor.organizationId,
        project: { memberships: { some: { userId: actor.userId, roles: { has: "BUYER" } } } },
      };
  const [open, awaitingReview, myDrafts, recent] = await Promise.all([
    db.purchaseRequest.count({ where: { AND: [visible, { status: { in: OPEN_STATUSES } }] } }),
    db.purchaseRequest.count({ where: { AND: [buyerScope, { status: "IN_REVIEW" }] } }),
    db.purchaseRequest.count({
      where: { AND: [visible, { status: "DRAFT", authorId: actor.userId }] },
    }),
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
  return { open, awaitingReview, myDrafts, recent };
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
