// Goods lines of RS.ge waybills, matched to order lines.
// - Fill a new delivery from a waybill: the receiver picks the supplier's waybill, BuildFlow
//   suggests the order line and unit factor for each goods line, the receiver confirms, and the
//   received quantities are pre-filled (still editable: what arrived may differ from the paper).
// - Compare a delivery with its waybill: the goods lines are stored with the delivery and the
//   order page shows, per order line, the waybill quantity (converted) next to what was received.
//   A difference is a warning, never a block.
// - Matches made by a person are remembered per supplier and goods name for the next waybill.
// Network calls run outside database transactions, like the rest of the RS.ge link.
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { errors, rsErrors } from "@/lib/i18n/ka";
import { normalizeFactor, unitFactor } from "@/lib/unit-convert";
import { requireProjectAccess, type Actor } from "@/server/access";
import { recordEvent } from "@/server/audit";
import { AppError, notFound } from "@/server/errors";
import { lockRequest, sumDecimals } from "@/server/orders/progress";
import { createReceipt, type WaybillLineInput } from "@/server/receipts/service";
import type { RsGoodsHint } from "@/server/rs/client";
import { suggestMatches, type LearnedMatch, type MatchTarget } from "@/server/rs/match";
import { clientFor, guard, rsRateLimit, supplierWaybills } from "@/server/rs/service";
import type { RsGoods } from "@/server/rs/soap";
import { parseInput } from "@/server/validation";

/** Goods lines accepted from one waybill. */
const MAX_LINES = 200;

const dec = (d: Prisma.Decimal | null) => (d === null ? null : d.toString());

/** Order with its lines, for the receiver filling a delivery from a waybill. */
async function loadOrder(actor: Actor, orderId: string) {
  const order = await db.purchaseOrder.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      organizationId: true,
      status: true,
      createdAt: true,
      request: { select: { projectId: true } },
      supplier: { select: { id: true, name: true, taxId: true } },
      items: {
        orderBy: { requestItem: { position: "asc" } },
        select: {
          id: true,
          quantity: true,
          unitPrice: true,
          closedAt: true,
          requestItem: { select: { name: true, spec: true, unit: true } },
          receiptItems: { select: { quantity: true } },
        },
      },
    },
  });
  if (!order || order.organizationId !== actor.organizationId) throw notFound();
  const access = await requireProjectAccess(db, actor, order.request.projectId, {
    requiredRoles: ["RECEIVER"],
  });
  if (access.archived) throw new AppError("CONFLICT", errors.projectArchived);
  if (order.status !== "ACTIVE") throw new AppError("CONFLICT", errors.orderNotActive);
  if (!order.supplier.taxId) throw new AppError("VALIDATION", rsErrors.noSupplierTaxId);
  const lines = order.items.map((it) => {
    const remaining = it.quantity.minus(sumDecimals(it.receiptItems.map((r) => r.quantity)));
    return {
      orderItemId: it.id,
      name: it.requestItem.name,
      spec: it.requestItem.spec,
      unit: it.requestItem.unit,
      unitPrice: it.unitPrice.toString(),
      remaining: it.closedAt || remaining.lte(0) ? "0" : remaining.toString(),
    };
  });
  return { order, open: lines.filter((l) => l.remaining !== "0") };
}

/** This supplier's past matches, newest first (the memory behind the suggestions). */
async function learnedMatches(organizationId: string, supplierId: string): Promise<LearnedMatch[]> {
  const rows = await db.receiptWaybillLine.findMany({
    where: { orderItemId: { not: null }, receipt: { order: { organizationId, supplierId } } },
    orderBy: { receipt: { createdAt: "desc" } },
    take: 500,
    select: {
      name: true,
      unit: true,
      factor: true,
      orderItem: { select: { requestItem: { select: { name: true, unit: true } } } },
    },
  });
  return rows.map((r) => ({
    goodsName: r.name,
    goodsUnit: r.unit,
    itemName: r.orderItem!.requestItem.name,
    itemUnit: r.orderItem!.requestItem.unit,
    factor: dec(r.factor),
  }));
}

function checkGoods(goods: RsGoods[]) {
  if (goods.length === 0) throw new AppError("VALIDATION", rsErrors.noGoods);
  if (goods.length > MAX_LINES) throw new AppError("VALIDATION", rsErrors.tooManyGoods(MAX_LINES));
}

// ─── Fill a new delivery from a waybill ──────────────────────────────────────

export type GoodsPreviewLine = RsGoods & {
  position: number;
  orderItemId: string | null;
  factor: string | null;
};

export type GoodsPreview = {
  waybill: { id: string; number: string; date: string | null };
  lines: GoodsPreviewLine[];
};

async function fetchWaybillGoods(actor: Actor, orderId: string, rsWaybillId: string) {
  const { order, open } = await loadOrder(actor, orderId);
  const { options, client } = await supplierWaybills(actor, order);
  const picked = options.find((w) => w.id === rsWaybillId);
  if (!picked) throw new AppError("CONFLICT", rsErrors.pickedGone);
  await rsRateLimit(actor.organizationId);
  const hint: RsGoodsHint[] = open.map((l) => ({
    name: l.spec ? `${l.name} ${l.spec}` : l.name,
    unit: l.unit,
    quantity: l.remaining,
    unitPrice: l.unitPrice,
  }));
  const goods = await guard(() => client.waybillGoods(picked, hint));
  checkGoods(goods);
  return { order, open, picked, goods };
}

/** Goods lines of the picked waybill with suggested order lines and unit factors. */
export async function previewWaybillGoods(
  actor: Actor,
  orderId: string,
  rsWaybillId: string,
): Promise<GoodsPreview> {
  const { order, open, picked, goods } = await fetchWaybillGoods(actor, orderId, rsWaybillId);
  const suggestions = suggestMatches(
    goods,
    open,
    await learnedMatches(actor.organizationId, order.supplier.id),
  );
  return {
    waybill: { id: picked.id, number: picked.number, date: picked.date },
    lines: goods.map((g, i) => ({ ...g, position: i, ...suggestions[i]! })),
  };
}

const matchesInput = z.object({
  rsWaybillId: z.string().min(1).max(64),
  matches: z
    .array(
      z.object({
        position: z.number().int().min(0).max(MAX_LINES),
        orderItemId: z
          .string()
          .max(64)
          .nullable()
          .optional()
          .transform((v) => v || null),
        factor: z
          .union([z.string(), z.number()])
          .nullable()
          .optional()
          .transform((v, ctx) => {
            if (v === null || v === undefined || v === "") return null;
            const f = normalizeFactor(v);
            if (!f) {
              ctx.addIssue({ code: "custom", message: rsErrors.badFactor });
              return z.NEVER;
            }
            return f;
          }),
      }),
    )
    .max(MAX_LINES),
});

/**
 * Record a delivery from an RS.ge waybill. The goods lines are re-read from RS.ge (never taken
 * from the form); the form sends the received quantities and the confirmed matches.
 */
export async function createReceiptFromWaybill(actor: Actor, orderId: string, raw: unknown) {
  const input = parseInput(matchesInput, raw);
  const { order, picked, goods } = await fetchWaybillGoods(actor, orderId, input.rsWaybillId);
  const ids = new Set(order.items.map((i) => i.id));
  const byPosition = new Map(input.matches.map((m) => [m.position, m]));
  const lines: WaybillLineInput[] = goods.map((g, i) => {
    const m = byPosition.get(i);
    const orderItemId = m?.orderItemId ?? null;
    if (orderItemId && !ids.has(orderItemId)) {
      throw new AppError("VALIDATION", errors.receiptItemForeign);
    }
    return { ...g, position: i, orderItemId, factor: orderItemId ? (m?.factor ?? null) : null };
  });
  return createReceipt(
    actor,
    {
      ...(raw as object),
      orderId,
      waybillNumber: picked.number,
      waybillDate: picked.date ?? "",
    },
    { rsWaybillId: picked.id, lines },
  );
}

// ─── Goods of an existing delivery's waybill ─────────────────────────────────

async function lockedReceiptContext(actor: Actor, receiptId: string) {
  const receipt = await db.receipt.findUnique({
    where: { id: receiptId },
    select: {
      id: true,
      orderId: true,
      rsWaybillId: true,
      waybillNumber: true,
      items: {
        select: {
          orderItemId: true,
          quantity: true,
          correctsId: true,
          corrections: { select: { quantity: true } },
        },
      },
      order: {
        select: {
          organizationId: true,
          status: true,
          request: { select: { projectId: true } },
          supplier: { select: { id: true } },
          items: {
            select: {
              id: true,
              unitPrice: true,
              requestItem: { select: { name: true, spec: true, unit: true } },
            },
          },
        },
      },
    },
  });
  if (!receipt || receipt.order.organizationId !== actor.organizationId) throw notFound();
  const access = await requireProjectAccess(db, actor, receipt.order.request.projectId, {
    requiredRoles: ["RECEIVER", "BUYER"],
  });
  if (access.archived) throw new AppError("CONFLICT", errors.projectArchived);
  if (receipt.order.status !== "ACTIVE") throw new AppError("CONFLICT", errors.orderNotActive);
  return receipt;
}

/**
 * Read the goods lines of a delivery's RS.ge waybill and store them with suggested matches
 * (replacing earlier ones). Returns the number of lines.
 */
export async function loadReceiptWaybillGoods(actor: Actor, receiptId: string): Promise<number> {
  const receipt = await lockedReceiptContext(actor, receiptId);
  if (!receipt.rsWaybillId || !receipt.waybillNumber) {
    throw new AppError("VALIDATION", rsErrors.notFromRs);
  }
  const { client } = await clientFor(actor.organizationId);
  await rsRateLimit(actor.organizationId);

  const targets: (MatchTarget & { unitPrice: string })[] = receipt.order.items.map((it) => ({
    orderItemId: it.id,
    name: it.requestItem.name,
    spec: it.requestItem.spec,
    unit: it.requestItem.unit,
    unitPrice: it.unitPrice.toString(),
  }));
  // What this delivery holds (net of corrections), for the demo goods.
  const hint: RsGoodsHint[] = targets.flatMap((t) => {
    const net = sumDecimals(
      receipt.items
        .filter((ri) => ri.orderItemId === t.orderItemId && ri.correctsId === null)
        .map((ri) => ri.quantity.plus(sumDecimals(ri.corrections.map((c) => c.quantity)))),
    );
    return net.gt(0)
      ? [
          {
            name: t.spec ? `${t.name} ${t.spec}` : t.name,
            unit: t.unit,
            quantity: net.toString(),
            unitPrice: t.unitPrice,
          },
        ]
      : [];
  });
  const rsId = receipt.rsWaybillId;
  const number = receipt.waybillNumber;
  const goods = await guard(() => client.waybillGoods({ id: rsId, number }, hint));
  checkGoods(goods);
  const suggestions = suggestMatches(
    goods,
    targets,
    await learnedMatches(actor.organizationId, receipt.order.supplier.id),
  );

  await db.$transaction(async (tx) => {
    const order = await tx.purchaseOrder.findUniqueOrThrow({
      where: { id: receipt.orderId },
      select: { requestId: true },
    });
    const req = await lockRequest(tx, actor, order.requestId);
    await requireProjectAccess(tx, actor, req.projectId, {
      requiredRoles: ["RECEIVER", "BUYER"],
      write: true,
    });
    // The waybill may have been changed while RS.ge was answering.
    const now = await tx.receipt.findUniqueOrThrow({
      where: { id: receipt.id },
      select: { rsWaybillId: true },
    });
    if (now.rsWaybillId !== rsId) throw new AppError("CONFLICT", rsErrors.changedMeanwhile);
    await tx.receiptWaybillLine.deleteMany({ where: { receiptId: receipt.id } });
    await tx.receiptWaybillLine.createMany({
      data: goods.map((g, i) => ({
        receiptId: receipt.id,
        position: i,
        name: g.name,
        unit: g.unit,
        quantity: new Prisma.Decimal(g.quantity),
        unitPrice: g.unitPrice === null ? null : new Prisma.Decimal(g.unitPrice),
        orderItemId: suggestions[i]!.orderItemId,
        factor:
          suggestions[i]!.factor === null ? null : new Prisma.Decimal(suggestions[i]!.factor!),
      })),
    });
    await recordEvent(tx, actor, {
      entityType: "PurchaseOrder",
      entityId: receipt.orderId,
      projectId: req.projectId,
      action: "receipt.waybill_goods_loaded",
      changes: { receiptId: receipt.id, waybillNumber: number, lines: goods.length },
    });
  });
  return goods.length;
}

/**
 * Load the goods after a waybill was picked or checked; a failure there must not undo the pick.
 * Returns a note to append to the success message, or null.
 */
export async function loadReceiptWaybillGoodsQuietly(
  actor: Actor,
  receiptId: string,
): Promise<string | null> {
  try {
    await loadReceiptWaybillGoods(actor, receiptId);
    return null;
  } catch (e) {
    // Name only: the message could carry RS.ge data.
    if (!(e instanceof AppError)) {
      console.error(`waybill goods load failed: ${e instanceof Error ? e.name : "non-Error"}`);
    }
    return rsErrors.goodsLater;
  }
}

export const lineMatchInput = z.object({
  orderItemId: z
    .string()
    .max(64)
    .optional()
    .transform((v) => v || null),
  factor: z
    .string()
    .max(20)
    .optional()
    .transform((v) => v?.trim() ?? ""),
});

/** Change which order line a waybill goods line belongs to, and its unit factor. */
export async function setWaybillLineMatch(actor: Actor, lineId: string, raw: unknown) {
  const input = parseInput(lineMatchInput, raw);
  return db.$transaction(async (tx) => {
    const line = await tx.receiptWaybillLine.findUnique({
      where: { id: lineId },
      select: {
        id: true,
        name: true,
        unit: true,
        orderItemId: true,
        factor: true,
        receipt: {
          select: {
            id: true,
            orderId: true,
            order: {
              select: {
                organizationId: true,
                status: true,
                requestId: true,
                items: { select: { id: true, requestItem: { select: { unit: true } } } },
              },
            },
          },
        },
      },
    });
    if (!line || line.receipt.order.organizationId !== actor.organizationId) throw notFound();
    const order = line.receipt.order;
    const req = await lockRequest(tx, actor, order.requestId);
    await requireProjectAccess(tx, actor, req.projectId, {
      requiredRoles: ["RECEIVER", "BUYER"],
      write: true,
    });
    if (order.status !== "ACTIVE") throw new AppError("CONFLICT", errors.orderNotActive);

    let factor: string | null = null;
    if (input.orderItemId) {
      const target = order.items.find((i) => i.id === input.orderItemId);
      if (!target) throw new AppError("VALIDATION", errors.receiptItemForeign);
      if (input.factor) {
        factor = normalizeFactor(input.factor);
        if (!factor) {
          throw new AppError("VALIDATION", rsErrors.badFactor, { factor: rsErrors.badFactor });
        }
      } else {
        factor = unitFactor(line.unit, target.requestItem.unit);
      }
    }
    const before = { orderItemId: line.orderItemId, factor: dec(line.factor) };
    const after = { orderItemId: input.orderItemId, factor };
    const sameFactor =
      (before.factor === null && after.factor === null) ||
      (before.factor !== null &&
        after.factor !== null &&
        new Prisma.Decimal(before.factor).eq(after.factor));
    if (before.orderItemId === after.orderItemId && sameFactor) {
      throw new AppError("VALIDATION", rsErrors.matchSame);
    }
    await tx.receiptWaybillLine.update({
      where: { id: line.id },
      data: {
        orderItemId: after.orderItemId,
        factor: after.factor === null ? null : new Prisma.Decimal(after.factor),
      },
    });
    await recordEvent(tx, actor, {
      entityType: "PurchaseOrder",
      entityId: line.receipt.orderId,
      projectId: req.projectId,
      action: "receipt.waybill_match_changed",
      changes: { receiptId: line.receipt.id, goods: line.name, from: before, to: after },
    });
    return { orderId: line.receipt.orderId, requestId: req.id };
  });
}

/** The supplier's RS.ge waybills for filling a new delivery of this order. */
export async function listOrderWaybills(actor: Actor, orderId: string) {
  const { order } = await loadOrder(actor, orderId);
  return (await supplierWaybills(actor, order)).options;
}
