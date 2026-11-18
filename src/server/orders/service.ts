// Purchase orders: placing orders against an approved request, cancelling them, and queries.
// Rules (CLAUDE.md): one request can be split into several orders (e.g. several suppliers);
// the sum ordered over ACTIVE orders may not exceed the approved quantity; one currency per order.
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import type { Currency, ProjectRole } from "@/generated/prisma/enums";
import { db, type Tx } from "@/lib/db";
import { parseWorkDate, tbilisiDayStart, todayInTbilisi } from "@/lib/format";
import { errors } from "@/lib/i18n/ka";
import { isPositiveQuantity, normalizePrice, normalizeQuantity } from "@/lib/quantity";
import { requireProjectAccess, type Actor, type ProjectAccess } from "@/server/access";
import { recordEvent } from "@/server/audit";
import { AppError, notFound } from "@/server/errors";
import {
  ORDERABLE,
  deliveryState,
  loadItemProgress,
  lockRequest,
  missingWaybillOrderIds,
  recomputeRequestStatus,
  sumDecimals,
  type LockedRequest,
} from "@/server/orders/progress";
import { parseInput } from "@/server/validation";

export const PAGE_SIZE = 50;
const MAX_ITEMS = 200;
const CURRENCIES = ["GEL", "USD", "EUR"] as const;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `მაქსიმუმ ${max} სიმბოლო.`)
    .optional()
    .transform((v) => v || null);

const quantityField = z.union([z.string(), z.number()]).transform((v, ctx) => {
  const q = normalizeQuantity(v);
  if (!q || !isPositiveQuantity(q)) {
    ctx.addIssue({
      code: "custom",
      message: "რაოდენობა უნდა იყოს დადებითი რიცხვი (მაქსიმუმ 3 ათწილადი).",
    });
    return z.NEVER;
  }
  return q;
});

const priceField = z.union([z.string(), z.number()]).transform((v, ctx) => {
  const p = normalizePrice(v);
  if (p === null) {
    ctx.addIssue({
      code: "custom",
      message: "ფასი უნდა იყოს არაუარყოფითი რიცხვი (მაქსიმუმ 4 ათწილადი).",
    });
    return z.NEVER;
  }
  return p;
});

const workDateField = z
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
  });

export const createOrderInput = z.object({
  requestId: z.string().min(1).max(64),
  supplierId: z
    .string()
    .max(64)
    .optional()
    .transform((v) => v || null),
  supplierName: optionalText(200),
  currency: z.enum(CURRENCIES).default("GEL"),
  plannedDeliveryDate: workDateField,
  supplierTaxId: z
    .string()
    .trim()
    .optional()
    .transform((v, ctx) => {
      if (!v) return null;
      if (!/^\d{9}$|^\d{11}$/.test(v)) {
        ctx.addIssue({ code: "custom", message: errors.taxIdFormat });
        return z.NEVER;
      }
      return v;
    }),
  items: z
    .array(
      z.object({
        requestItemId: z.string().min(1).max(64),
        quantity: quantityField,
        unitPrice: priceField,
        note: optionalText(500),
      }),
    )
    .max(MAX_ITEMS, `მაქსიმუმ ${MAX_ITEMS} პოზიცია.`),
});

const reasonInput = z.object({
  reason: z.string().trim().min(3, errors.reasonRequired).max(1000, "მაქსიმუმ 1000 სიმბოლო."),
});

const isBuyer = (a: ProjectAccess) => a.isAdmin || a.roles.includes("BUYER" as ProjectRole);
const isReceiver = (a: ProjectAccess) => a.isAdmin || a.roles.includes("RECEIVER" as ProjectRole);

/** Line total rounded to 2 decimals (money). */
const lineTotal = (q: Prisma.Decimal, price: Prisma.Decimal) =>
  q.times(price).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

// ─── Create ──────────────────────────────────────────────────────────────────

/** Place an order on an approved request. Requires the BUYER role (admins pass). */
export async function createOrder(actor: Actor, raw: unknown) {
  const input = parseInput(createOrderInput, raw);
  if (!input.supplierId && !input.supplierName) {
    throw new AppError("VALIDATION", errors.supplierRequired, {
      supplier: errors.supplierRequired,
    });
  }
  if (input.items.length === 0) throw new AppError("VALIDATION", errors.orderNoItems);
  const ids = input.items.map((i) => i.requestItemId);
  if (new Set(ids).size !== ids.length) throw new AppError("VALIDATION", errors.orderDuplicateItem);

  return db.$transaction(async (tx) => {
    const req = await lockRequest(tx, actor, input.requestId);
    await requireProjectAccess(tx, actor, req.projectId, { requiredRoles: ["BUYER"], write: true });
    if (!ORDERABLE.includes(req.status)) {
      throw new AppError("CONFLICT", errors.requestNotOrderable);
    }

    // Limit check against fresh sums (the request lock keeps them stable until commit).
    const progress = new Map((await loadItemProgress(tx, req.id)).map((p) => [p.id, p]));
    const fieldErrors: Record<string, string> = {};
    input.items.forEach((it, i) => {
      const p = progress.get(it.requestItemId);
      if (!p) throw new AppError("VALIDATION", errors.orderItemForeign);
      if (p.ordered.plus(it.quantity).gt(p.approved)) {
        fieldErrors[`items.${i}.quantity`] =
          `${errors.overOrder} შესაძლებელია მაქსიმუმ ${p.approved.minus(p.ordered).toString()}.`;
      }
    });
    if (Object.keys(fieldErrors).length > 0) {
      throw new AppError("CONFLICT", errors.overOrder, fieldErrors);
    }

    const supplierId = input.supplierId
      ? await existingSupplier(tx, actor, input.supplierId)
      : await findOrCreateSupplier(tx, actor, input.supplierName!, input.supplierTaxId);

    const org = await tx.organization.update({
      where: { id: actor.organizationId },
      data: { orderSeq: { increment: 1 } },
      select: { orderSeq: true },
    });
    const order = await tx.purchaseOrder.create({
      data: {
        organizationId: actor.organizationId,
        number: org.orderSeq,
        requestId: req.id,
        supplierId,
        currency: input.currency,
        plannedDeliveryDate: input.plannedDeliveryDate,
        createdById: actor.userId,
        items: {
          create: input.items.map((it) => ({
            requestItemId: it.requestItemId,
            quantity: new Prisma.Decimal(it.quantity),
            unitPrice: new Prisma.Decimal(it.unitPrice),
            note: it.note,
          })),
        },
      },
      select: { id: true, number: true },
    });
    await recordEvent(tx, actor, {
      entityType: "PurchaseOrder",
      entityId: order.id,
      projectId: req.projectId,
      action: "order.created",
      changes: {
        number: order.number,
        requestId: req.id,
        supplierId,
        currency: input.currency,
        items: input.items.map((it) => ({
          requestItemId: it.requestItemId,
          quantity: it.quantity,
          unitPrice: it.unitPrice,
        })),
      },
    });
    await recomputeRequestStatus(tx, actor, req);
    return order;
  });
}

async function existingSupplier(tx: Tx, actor: Actor, supplierId: string) {
  const s = await tx.supplier.findUnique({
    where: { id: supplierId },
    select: { id: true, organizationId: true },
  });
  if (!s || s.organizationId !== actor.organizationId) {
    throw new AppError("VALIDATION", errors.supplierRequired, {
      supplier: errors.supplierRequired,
    });
  }
  return s.id;
}

/** Suppliers are unique by name within the organization; reuse an existing one. */
async function findOrCreateSupplier(
  tx: Tx,
  actor: Actor,
  name: string,
  taxId: string | null = null,
) {
  const existing = await tx.supplier.findFirst({
    // Case-insensitive "equals" compiles to ILIKE: escape its wildcards so "A_B" matches only
    // "A_B" (and not "AXB").
    where: {
      organizationId: actor.organizationId,
      name: { equals: name.replace(/[\\%_]/g, "\\$&"), mode: "insensitive" },
    },
    select: { id: true },
  });
  if (existing) return existing.id;
  const created = await tx.supplier.upsert({
    where: { organizationId_name: { organizationId: actor.organizationId, name } },
    create: { organizationId: actor.organizationId, name, taxId },
    update: {},
    select: { id: true },
  });
  await recordEvent(tx, actor, {
    entityType: "Supplier",
    entityId: created.id,
    action: "supplier.created",
    changes: { name, taxId },
  });
  return created.id;
}

// ─── Cancel ──────────────────────────────────────────────────────────────────

/** Cancel an active order with a reason. Blocked once anything was received on it. */
export async function cancelOrder(actor: Actor, orderId: string, rawReason: unknown) {
  const { reason } = parseInput(reasonInput, { reason: rawReason });
  return db.$transaction(async (tx) => {
    const found = await tx.purchaseOrder.findUnique({
      where: { id: orderId },
      select: { organizationId: true, requestId: true },
    });
    if (!found || found.organizationId !== actor.organizationId) throw notFound();
    const req = await lockRequest(tx, actor, found.requestId);
    await requireProjectAccess(tx, actor, req.projectId, { requiredRoles: ["BUYER"], write: true });

    const received = await tx.receiptItem.aggregate({
      where: { orderItem: { orderId } },
      _sum: { quantity: true },
    });
    if (received._sum.quantity && !received._sum.quantity.isZero()) {
      throw new AppError("CONFLICT", errors.orderHasReceipts);
    }
    const updated = await tx.purchaseOrder.updateMany({
      where: { id: orderId, status: "ACTIVE" },
      data: { status: "CANCELLED", cancelReason: reason },
    });
    if (updated.count === 0) throw new AppError("CONFLICT", errors.orderNotActive);
    await recordEvent(tx, actor, {
      entityType: "PurchaseOrder",
      entityId: orderId,
      projectId: req.projectId,
      action: "order.cancelled",
      reason,
    });
    await recomputeRequestStatus(tx, actor, req);
    return { requestId: req.id };
  });
}

// ─── Supplier tax id ─────────────────────────────────────────────────────────

const taxIdInput = z.object({
  taxId: z
    .string()
    .trim()
    .regex(/^\d{9}$|^\d{11}$/, errors.taxIdFormat),
});

/** Set a supplier's identification code (needed to match waybills, e.g. with RS.ge later). */
export async function setSupplierTaxId(actor: Actor, supplierId: string, raw: unknown) {
  const { taxId } = parseInput(taxIdInput, raw);
  if (!actor.isAdmin) {
    const buyer = await db.projectMembership.count({
      where: {
        userId: actor.userId,
        roles: { has: "BUYER" },
        project: { organizationId: actor.organizationId },
      },
    });
    if (buyer === 0) throw new AppError("FORBIDDEN", errors.forbidden);
  }
  return db.$transaction(async (tx) => {
    const supplier = await tx.supplier.findUnique({
      where: { id: supplierId },
      select: { id: true, organizationId: true, taxId: true },
    });
    if (!supplier || supplier.organizationId !== actor.organizationId) throw notFound();
    await tx.supplier.update({ where: { id: supplierId }, data: { taxId } });
    await recordEvent(tx, actor, {
      entityType: "Supplier",
      entityId: supplierId,
      action: "supplier.tax_id_set",
      changes: { from: supplier.taxId, to: taxId },
    });
  });
}

// ─── Close short ─────────────────────────────────────────────────────────────

/**
 * Close the open lines of an order at what was received (the supplier delivers no more).
 * The rest returns to the request: it can be ordered again or cancelled there.
 * Used by the buyer directly, and by a confirmed item cancellation (`requestItemId` given).
 */
export async function closeOrderLines(
  tx: Tx,
  actor: Actor,
  req: LockedRequest,
  where: { orderId?: string; requestItemId?: string },
  reason: string,
) {
  const lines = await tx.orderItem.findMany({
    where: { ...where, closedAt: null, order: { status: "ACTIVE" } },
    select: {
      id: true,
      orderId: true,
      requestItemId: true,
      quantity: true,
      receiptItems: { select: { quantity: true } },
    },
  });
  const open = lines.filter((l) =>
    l.quantity.gt(sumDecimals(l.receiptItems.map((r) => r.quantity))),
  );
  if (open.length === 0) return 0;
  const now = new Date();
  await tx.orderItem.updateMany({
    where: { id: { in: open.map((l) => l.id) } },
    data: { closedAt: now, closeReason: reason },
  });
  for (const orderId of new Set(open.map((l) => l.orderId))) {
    await recordEvent(tx, actor, {
      entityType: "PurchaseOrder",
      entityId: orderId,
      projectId: req.projectId,
      action: "order.closed",
      reason,
      changes: {
        lines: open
          .filter((l) => l.orderId === orderId)
          .map((l) => ({
            orderItemId: l.id,
            requestItemId: l.requestItemId,
            ordered: l.quantity.toString(),
            received: sumDecimals(l.receiptItems.map((r) => r.quantity)).toString(),
          })),
      },
    });
  }
  return open.length;
}

/** Buyer closes an order short with a reason. Something must already have been received. */
export async function closeOrder(actor: Actor, orderId: string, rawReason: unknown) {
  const { reason } = parseInput(reasonInput, { reason: rawReason });
  return db.$transaction(async (tx) => {
    const found = await tx.purchaseOrder.findUnique({
      where: { id: orderId },
      select: { organizationId: true, requestId: true },
    });
    if (!found || found.organizationId !== actor.organizationId) throw notFound();
    const req = await lockRequest(tx, actor, found.requestId);
    await requireProjectAccess(tx, actor, req.projectId, { requiredRoles: ["BUYER"], write: true });
    const fresh = await tx.purchaseOrder.findUniqueOrThrow({
      where: { id: orderId },
      select: { status: true },
    });
    if (fresh.status !== "ACTIVE") throw new AppError("CONFLICT", errors.orderNotActive);
    const received = await tx.receiptItem.aggregate({
      where: { orderItem: { orderId } },
      _sum: { quantity: true },
    });
    // Nothing received yet: cancelling the order is the right action, not closing it.
    if (!received._sum.quantity || received._sum.quantity.lte(0)) {
      throw new AppError("CONFLICT", errors.orderNothingToClose);
    }
    const closed = await closeOrderLines(tx, actor, req, { orderId }, reason);
    if (closed === 0) throw new AppError("CONFLICT", errors.orderNothingToClose);
    await recomputeRequestStatus(tx, actor, req);
    return { requestId: req.id };
  });
}

// ─── Queries ─────────────────────────────────────────────────────────────────

/** Data for the "new order" form: what is still available to order per request item. */
export async function getOrderDraft(actor: Actor, requestId: string) {
  const req = await db.purchaseRequest.findUnique({
    where: { id: requestId },
    select: {
      id: true,
      number: true,
      status: true,
      organizationId: true,
      projectId: true,
      project: { select: { name: true } },
      items: {
        orderBy: { position: "asc" },
        select: { id: true, position: true, name: true, spec: true, unit: true, quantity: true },
      },
    },
  });
  if (!req || req.organizationId !== actor.organizationId) throw notFound();
  await requireProjectAccess(db, actor, req.projectId, { requiredRoles: ["BUYER"], write: true });
  if (!ORDERABLE.includes(req.status)) throw new AppError("CONFLICT", errors.requestNotOrderable);

  const progress = new Map((await loadItemProgress(db, req.id)).map((p) => [p.id, p]));
  const items = req.items.map((it) => {
    const p = progress.get(it.id)!;
    const available = p.approved.minus(p.ordered);
    return {
      id: it.id,
      position: it.position,
      name: it.name,
      spec: it.spec,
      unit: it.unit,
      approved: p.approved.toString(),
      ordered: p.ordered.toString(),
      available: (available.isNegative() ? new Prisma.Decimal(0) : available).toString(),
    };
  });
  const suppliers = await listSuppliers(actor);
  return {
    request: { id: req.id, number: req.number, projectName: req.project.name },
    items,
    suppliers,
  };
}

export type OrderPermissions = {
  /** Add or change a delivery's waybill (receivers and buyers, also after receiving). */
  canEditWaybill: boolean;
  /** Set the supplier's identification code. */
  canEditSupplier: boolean;
  canReceive: boolean;
  canCancel: boolean;
  canCorrect: boolean;
  /** Close short: the supplier delivers no more; requires something received already. */
  canClose: boolean;
};

/** Full order for the details page: items with progress, receipts, history, allowed actions. */
export async function getOrder(actor: Actor, orderId: string) {
  const order = await db.purchaseOrder.findUnique({
    where: { id: orderId },
    include: {
      supplier: { select: { id: true, name: true, phone: true, taxId: true } },
      createdBy: { select: { name: true } },
      request: {
        select: {
          id: true,
          number: true,
          projectId: true,
          project: { select: { id: true, name: true } },
        },
      },
      items: {
        orderBy: { requestItem: { position: "asc" } },
        include: {
          requestItem: { select: { position: true, name: true, spec: true, unit: true } },
          receiptItems: { select: { quantity: true } },
        },
      },
      receipts: {
        orderBy: { createdAt: "desc" },
        include: {
          receivedBy: { select: { name: true } },
          items: {
            orderBy: { id: "asc" },
            include: {
              orderItem: { select: { requestItem: { select: { name: true, unit: true } } } },
              corrections: { select: { quantity: true } },
            },
          },
        },
      },
    },
  });
  if (!order || order.organizationId !== actor.organizationId) throw notFound();
  const access = await requireProjectAccess(db, actor, order.request.projectId);

  const items = order.items.map((it) => {
    const received = sumDecimals(it.receiptItems.map((r) => r.quantity));
    // A closed line expects nothing more.
    const remaining = it.closedAt ? new Prisma.Decimal(0) : it.quantity.minus(received);
    return {
      id: it.id,
      position: it.requestItem.position,
      name: it.requestItem.name,
      spec: it.requestItem.spec,
      unit: it.requestItem.unit,
      note: it.note,
      quantity: it.quantity.toString(),
      unitPrice: it.unitPrice.toString(),
      total: lineTotal(it.quantity, it.unitPrice).toString(),
      received: received.toString(),
      remaining: (remaining.isNegative() ? new Prisma.Decimal(0) : remaining).toString(),
      closed: it.closedAt !== null,
      closeReason: it.closeReason,
    };
  });
  const total = sumDecimals(order.items.map((it) => lineTotal(it.quantity, it.unitPrice)));
  const anyRemaining = items.some((i) => new Prisma.Decimal(i.remaining).gt(0));
  const anyReceived = items.some((i) => new Prisma.Decimal(i.received).gt(0));

  const waybillMissing =
    (await missingWaybillOrderIds(db, Prisma.sql`o."id" = ${order.id}`)).length > 0;
  // Other deliveries with the same waybill number from this supplier (one waybill can cover
  // several orders; shown so a double entry is noticed).
  const numbers = [
    ...new Set(order.receipts.map((r) => r.waybillNumber).filter(Boolean)),
  ] as string[];
  const shared = numbers.length
    ? await db.receipt.findMany({
        where: {
          waybillNumber: { in: numbers },
          orderId: { not: order.id },
          order: { supplierId: order.supplierId, organizationId: actor.organizationId },
        },
        select: { waybillNumber: true, order: { select: { id: true, number: true } } },
      })
    : [];
  const receipts = order.receipts.map((r) => ({
    id: r.id,
    receivedOn: r.receivedOn,
    createdAt: r.createdAt,
    note: r.note,
    receivedBy: r.receivedBy.name,
    waybillNumber: r.waybillNumber,
    waybillDate: r.waybillDate,
    isCorrectionOnly: r.items.every((ri) => ri.correctsId !== null),
    alsoOn: shared
      .filter((x) => x.waybillNumber === r.waybillNumber)
      .map((x) => x.order)
      .filter((o, i, all) => all.findIndex((y) => y.id === o.id) === i),
    items: r.items.map((ri) => ({
      id: ri.id,
      name: ri.orderItem.requestItem.name,
      unit: ri.orderItem.requestItem.unit,
      quantity: ri.quantity.toString(),
      isCorrection: ri.correctsId !== null,
      // Net value of an original entry after its corrections.
      effective: ri.quantity.plus(sumDecimals(ri.corrections.map((c) => c.quantity))).toString(),
      note: ri.note,
    })),
  }));

  const events = await db.auditEvent.findMany({
    where: { entityType: "PurchaseOrder", entityId: orderId },
    orderBy: { seq: "desc" },
    select: {
      id: true,
      action: true,
      reason: true,
      createdAt: true,
      actor: { select: { name: true } },
    },
  });

  const active = order.status === "ACTIVE" && !access.archived;
  const permissions: OrderPermissions = {
    canReceive: active && isReceiver(access) && anyRemaining,
    canCancel: active && isBuyer(access) && !anyReceived,
    canCorrect: active && isReceiver(access) && receipts.length > 0,
    canClose: active && isBuyer(access) && anyRemaining && anyReceived,
    canEditWaybill: active && (isReceiver(access) || isBuyer(access)),
    canEditSupplier: !access.archived && isBuyer(access),
  };

  return {
    order: {
      id: order.id,
      number: order.number,
      status: order.status,
      currency: order.currency,
      plannedDeliveryDate: order.plannedDeliveryDate,
      cancelReason: order.cancelReason,
      createdAt: order.createdAt,
      createdBy: order.createdBy.name,
      supplier: order.supplier,
      request: order.request,
      total: total.toString(),
      delivery: deliveryState(order.status, items, waybillMissing),
      waybillMissing,
    },
    items,
    receipts,
    events,
    access,
    permissions,
  };
}

/** URL filters for the order list (unknown or invalid values are ignored). */
export const orderFiltersSchema = z.object({
  project: z.string().max(64).optional().catch(undefined),
  status: z.enum(["ACTIVE", "CANCELLED"]).optional().catch(undefined),
  supplier: z.string().max(64).optional().catch(undefined),
  q: z.string().trim().max(100).optional().catch(undefined),
  from: z.string().optional().catch(undefined),
  to: z.string().optional().catch(undefined),
  // Delivery progress: open = something left to receive; overdue = open and planned date passed.
  delivery: z
    .enum(["open", "overdue", "received", "waybill", "cancelled"])
    .optional()
    .catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).optional().catch(undefined),
});
export type OrderFilters = z.output<typeof orderFiltersSchema>;

/** Ids of the active orders the actor can see that still have something left to receive. */
async function openOrderIds(actor: Actor): Promise<string[]> {
  const visible = actor.isAdmin
    ? Prisma.sql`TRUE`
    : Prisma.sql`EXISTS (SELECT 1 FROM "ProjectMembership" m
        WHERE m."projectId" = pr."projectId" AND m."userId" = ${actor.userId})`;
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT o."id"
    FROM "PurchaseOrder" o
    JOIN "PurchaseRequest" pr ON pr."id" = o."requestId"
    JOIN "OrderItem" oi ON oi."orderId" = o."id"
    LEFT JOIN (
      SELECT ri."orderItemId", SUM(ri."quantity") AS "received"
      FROM "ReceiptItem" ri GROUP BY ri."orderItemId"
    ) r ON r."orderItemId" = oi."id"
    WHERE o."organizationId" = ${actor.organizationId} AND o."status" = 'ACTIVE' AND ${visible}
    GROUP BY o."id"
    HAVING bool_or(oi."closedAt" IS NULL AND oi."quantity" > COALESCE(r."received", 0))`;
  return rows.map((r) => r.id);
}

const todayDate = () => parseWorkDate(todayInTbilisi())!;

const dashboardOrderSelect = {
  id: true,
  number: true,
  plannedDeliveryDate: true,
  supplier: { select: { name: true } },
  request: {
    select: { id: true, number: true, project: { select: { id: true, name: true } } },
  },
} satisfies Prisma.PurchaseOrderSelect;

/**
 * Dashboard: overdue deliveries and orders still to be received (5 each, soonest first).
 * Archived projects are left out here only (nothing can be received there); the order list
 * filter keeps them, because "received" is computed as the complement of the open set.
 */
export async function orderDashboard(actor: Actor) {
  const open = await openOrderIds(actor);
  const activeProject = { request: { project: { status: "ACTIVE" as const } } };
  const openWhere = { id: { in: open }, ...activeProject };
  const overdueWhere = { ...openWhere, plannedDeliveryDate: { lt: todayDate() } };
  const receiverProjects = actor.isAdmin
    ? null
    : new Set(
        (
          await db.projectMembership.findMany({
            where: { userId: actor.userId, roles: { has: "RECEIVER" } },
            select: { projectId: true },
          })
        ).map((m) => m.projectId),
      );
  const withAction = <T extends { request: { project: { id: string } } }>(orders: T[]) =>
    orders.map((o) => ({
      ...o,
      canReceive: receiverProjects === null || receiverProjects.has(o.request.project.id),
    }));
  const waybillWhere = { id: { in: await waybillMissingIds(actor) } };
  const [waybillCount, waybill] = await Promise.all([
    db.purchaseOrder.count({ where: waybillWhere }),
    db.purchaseOrder.findMany({
      where: waybillWhere,
      orderBy: { number: "asc" },
      take: 5,
      select: dashboardOrderSelect,
    }),
  ]);
  const [overdueCount, toReceiveCount, overdue, toReceive] = await Promise.all([
    db.purchaseOrder.count({ where: overdueWhere }),
    db.purchaseOrder.count({ where: openWhere }),
    db.purchaseOrder.findMany({
      where: overdueWhere,
      orderBy: [{ plannedDeliveryDate: "asc" }, { number: "asc" }],
      take: 5,
      select: dashboardOrderSelect,
    }),
    db.purchaseOrder.findMany({
      where: openWhere,
      orderBy: [{ plannedDeliveryDate: { sort: "asc", nulls: "last" } }, { number: "asc" }],
      take: 5,
      select: dashboardOrderSelect,
    }),
  ]);
  return {
    overdueCount,
    overdue: withAction(overdue),
    toReceiveCount,
    toReceive: withAction(toReceive),
    waybillCount,
    waybill,
  };
}

function visibleOrdersWhere(actor: Actor): Prisma.PurchaseOrderWhereInput {
  return actor.isAdmin
    ? { organizationId: actor.organizationId }
    : {
        organizationId: actor.organizationId,
        request: { project: { memberships: { some: { userId: actor.userId } } } },
      };
}

/** Active orders the actor can see that have a delivery without a waybill. */
async function waybillMissingIds(actor: Actor): Promise<string[]> {
  const visible = actor.isAdmin
    ? Prisma.sql`TRUE`
    : Prisma.sql`EXISTS (SELECT 1 FROM "PurchaseRequest" pr JOIN "ProjectMembership" m
        ON m."projectId" = pr."projectId" WHERE pr."id" = o."requestId" AND m."userId" = ${actor.userId})`;
  return missingWaybillOrderIds(
    db,
    Prisma.sql`o."organizationId" = ${actor.organizationId} AND ${visible}`,
  );
}

/** Prisma filter for the order list and the export (same URL filters). */
async function orderListWhere(
  actor: Actor,
  f: OrderFilters,
): Promise<Prisma.PurchaseOrderWhereInput> {
  const and: Prisma.PurchaseOrderWhereInput[] = [visibleOrdersWhere(actor)];
  if (f.project) and.push({ request: { projectId: f.project } });
  if (f.status) and.push({ status: f.status });
  if (f.supplier) and.push({ supplierId: f.supplier });
  if (f.delivery) {
    const open = await openOrderIds(actor);
    if (f.delivery === "open") and.push({ id: { in: open } });
    if (f.delivery === "overdue") {
      and.push({ id: { in: open }, plannedDeliveryDate: { lt: todayDate() } });
    }
    if (f.delivery === "received") and.push({ status: "ACTIVE", id: { notIn: open } });
    if (f.delivery === "waybill") and.push({ id: { in: await waybillMissingIds(actor) } });
    if (f.delivery === "cancelled") and.push({ status: "CANCELLED" });
  }
  if (f.q) {
    const digits = f.q.replace(/^№/, "").replace(/^0+(?=\d)/, "");
    const num = /^\d{1,9}$/.test(digits) ? Number(digits) : null;
    and.push({
      OR: [
        ...(num !== null ? [{ number: num }] : []),
        {
          items: {
            some: { requestItem: { name: { contains: f.q, mode: "insensitive" as const } } },
          },
        },
        { receipts: { some: { waybillNumber: { contains: f.q, mode: "insensitive" as const } } } },
      ],
    });
  }
  const from = f.from ? tbilisiDayStart(f.from) : null;
  const toStart = f.to ? tbilisiDayStart(f.to) : null;
  if (from) and.push({ createdAt: { gte: from } });
  if (toStart) and.push({ createdAt: { lt: new Date(toStart.getTime() + 24 * 3600 * 1000) } });
  return { AND: and };
}

export async function listOrders(actor: Actor, rawFilters: unknown) {
  const f = orderFiltersSchema.parse(rawFilters ?? {});
  const where = await orderListWhere(actor, f);
  const total = await db.purchaseOrder.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  // An out-of-range page shows the last page, not "no orders yet".
  const page = Math.min(f.page ?? 1, pageCount);
  const [rows] = await Promise.all([
    db.purchaseOrder.findMany({
      where,
      orderBy: { number: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        number: true,
        status: true,
        currency: true,
        plannedDeliveryDate: true,
        createdAt: true,
        supplier: { select: { name: true } },
        request: { select: { id: true, number: true, project: { select: { name: true } } } },
        items: {
          select: {
            quantity: true,
            unitPrice: true,
            closedAt: true,
            receiptItems: { select: { quantity: true } },
          },
        },
      },
    }),
  ]);
  const missing = new Set(
    rows.length
      ? await missingWaybillOrderIds(
          db,
          Prisma.sql`o."id" IN (${Prisma.join(rows.map((r) => r.id))})`,
        )
      : [],
  );
  return {
    rows: rows.map((o) => {
      const items = o.items.map((it) => ({
        quantity: it.quantity.toString(),
        received: sumDecimals(it.receiptItems.map((r) => r.quantity)).toString(),
        closed: it.closedAt !== null,
      }));
      return {
        id: o.id,
        number: o.number,
        status: o.status,
        currency: o.currency as Currency,
        plannedDeliveryDate: o.plannedDeliveryDate,
        createdAt: o.createdAt,
        supplier: o.supplier.name,
        request: o.request,
        total: sumDecimals(o.items.map((it) => lineTotal(it.quantity, it.unitPrice))).toString(),
        delivery: deliveryState(o.status, items, missing.has(o.id)),
      };
    }),
    total,
    page,
    pageCount,
    filters: f,
  };
}

/** Suppliers of the actor's organization (for the list filter and the order form). */
export async function listSuppliers(actor: Actor) {
  return db.supplier.findMany({
    where: { organizationId: actor.organizationId },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
}

/** Totals of the request's active orders, one entry per currency (never mixed). */
export function totalsByCurrency(orders: { currency: Currency; total: string }[]) {
  const map = new Map<Currency, Prisma.Decimal>();
  for (const o of orders) {
    map.set(o.currency, (map.get(o.currency) ?? new Prisma.Decimal(0)).plus(o.total));
  }
  return [...map.entries()].map(([currency, total]) => ({ currency, total: total.toString() }));
}

// ─── Export for accounting ───────────────────────────────────────────────────

const EXPORT_LIMIT = 20_000;

/**
 * One row per received order line and delivery, for accounting: waybill, supplier and its code,
 * project, request/order numbers, material, quantity, price and amount. Uses the order list's
 * URL filters and the same visibility.
 */
export async function exportReceiptLines(actor: Actor, rawFilters: unknown) {
  const f = orderFiltersSchema.parse(rawFilters ?? {});
  const where = await orderListWhere(actor, f);
  const rows = await db.receiptItem.findMany({
    where: { receipt: { order: where } },
    orderBy: [{ receipt: { receivedOn: "asc" } }, { receipt: { createdAt: "asc" } }],
    take: EXPORT_LIMIT,
    select: {
      quantity: true,
      correctsId: true,
      note: true,
      receipt: {
        select: {
          receivedOn: true,
          waybillNumber: true,
          waybillDate: true,
          receivedBy: { select: { name: true } },
          order: {
            select: {
              number: true,
              currency: true,
              supplier: { select: { name: true, taxId: true } },
              request: { select: { number: true, project: { select: { name: true } } } },
            },
          },
        },
      },
      orderItem: {
        select: {
          unitPrice: true,
          requestItem: { select: { name: true, spec: true, unit: true } },
        },
      },
    },
  });
  return rows.map((r) => ({
    receivedOn: r.receipt.receivedOn,
    waybillNumber: r.receipt.waybillNumber,
    waybillDate: r.receipt.waybillDate,
    supplier: r.receipt.order.supplier.name,
    supplierTaxId: r.receipt.order.supplier.taxId,
    project: r.receipt.order.request.project.name,
    requestNumber: r.receipt.order.request.number,
    orderNumber: r.receipt.order.number,
    material: r.orderItem.requestItem.name,
    spec: r.orderItem.requestItem.spec,
    quantity: r.quantity.toString(),
    unit: r.orderItem.requestItem.unit,
    unitPrice: r.orderItem.unitPrice.toString(),
    amount: lineTotal(r.quantity, r.orderItem.unitPrice).toString(),
    currency: r.receipt.order.currency as Currency,
    isCorrection: r.correctsId !== null,
    receivedBy: r.receipt.receivedBy.name,
  }));
}
