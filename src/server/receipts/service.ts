// Receipts: recording actual deliveries on an order, and correcting confirmed receipts.
// Rules (CLAUDE.md): an order can have several deliveries; net received per order item may not
// exceed the ordered quantity; confirmed rows are never edited in place. A correction is a new
// receipt row with the difference (possibly negative) that points at the corrected row.
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { db, type Tx } from "@/lib/db";
import { parseWorkDate, todayInTbilisi } from "@/lib/format";
import { errors } from "@/lib/i18n/ka";
import { isPositiveQuantity, normalizeQuantity } from "@/lib/quantity";
import { requireProjectAccess, type Actor } from "@/server/access";
import { recordEvent } from "@/server/audit";
import { AppError, notFound } from "@/server/errors";
import { lockRequest, recomputeRequestStatus, sumDecimals } from "@/server/orders/progress";
import { parseInput } from "@/server/validation";

const MAX_ITEMS = 200;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `მაქსიმუმ ${max} სიმბოლო.`)
    .optional()
    .transform((v) => v || null);

const receivedOnField = z
  .string()
  .trim()
  .min(1, "მიუთითეთ მიღების თარიღი.")
  .transform((v, ctx) => {
    const d = parseWorkDate(v);
    if (!d) {
      ctx.addIssue({ code: "custom", message: "თარიღის ფორმატი არასწორია." });
      return z.NEVER;
    }
    if (v > todayInTbilisi()) {
      ctx.addIssue({ code: "custom", message: errors.receiptDateFuture });
      return z.NEVER;
    }
    return d;
  });

/** Waybill number: digits, Latin letters, "-" and "/" (RS.ge numbers are digits). */
export const waybillNumberField = z
  .string()
  .trim()
  .max(40, "მაქსიმუმ 40 სიმბოლო.")
  .regex(/^[0-9A-Za-z/-]*$/, "ზედნადების ნომერში დასაშვებია ციფრები, ლათინური ასოები, „-“ და „/“.")
  .optional()
  .transform((v) => v || null);

/** Waybill date: optional, a real calendar date, not in the future. */
export const waybillDateField = z
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
    if (v > todayInTbilisi()) {
      ctx.addIssue({ code: "custom", message: "ზედნადების თარიღი მომავალშია." });
      return z.NEVER;
    }
    return d;
  });

export const createReceiptInput = z.object({
  orderId: z.string().min(1).max(64),
  receivedOn: receivedOnField,
  note: optionalText(1000),
  waybillNumber: waybillNumberField,
  waybillDate: waybillDateField,
  items: z
    .array(
      z.object({
        orderItemId: z.string().min(1).max(64),
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
        note: optionalText(500),
      }),
    )
    .max(MAX_ITEMS, `მაქსიმუმ ${MAX_ITEMS} პოზიცია.`),
});

export const correctReceiptInput = z.object({
  // The corrected net value of the original entry (zero allowed: "nothing actually arrived").
  quantity: z.union([z.string(), z.number()]).transform((v, ctx) => {
    const q = normalizeQuantity(v);
    if (q === null) {
      ctx.addIssue({
        code: "custom",
        message: "რაოდენობა უნდა იყოს არაუარყოფითი რიცხვი (მაქსიმუმ 3 ათწილადი).",
      });
      return z.NEVER;
    }
    return q;
  }),
  reason: z.string().trim().min(3, errors.reasonRequired).max(1000, "მაქსიმუმ 1000 სიმბოლო."),
});

/** Order, its request (locked) and the actor's receiver access, in one transaction step. */
async function lockOrderForReceipt(tx: Tx, actor: Actor, orderId: string) {
  const order = await tx.purchaseOrder.findUnique({
    where: { id: orderId },
    select: { id: true, organizationId: true, requestId: true },
  });
  if (!order || order.organizationId !== actor.organizationId) throw notFound();
  const req = await lockRequest(tx, actor, order.requestId);
  await requireProjectAccess(tx, actor, req.projectId, {
    requiredRoles: ["RECEIVER"],
    write: true,
  });
  // Re-read the status after the lock: a concurrent cancel may have just committed.
  const fresh = await tx.purchaseOrder.findUniqueOrThrow({
    where: { id: orderId },
    select: { status: true },
  });
  if (fresh.status !== "ACTIVE") throw new AppError("CONFLICT", errors.orderNotActive);
  return req;
}

/** Ordered and net received quantity per order item of one order. */
async function orderItemProgress(tx: Tx, orderId: string) {
  const items = await tx.orderItem.findMany({
    where: { orderId },
    select: {
      id: true,
      quantity: true,
      closedAt: true,
      receiptItems: { select: { quantity: true } },
    },
  });
  return new Map(
    items.map((it) => [
      it.id,
      {
        ordered: it.quantity,
        received: sumDecimals(it.receiptItems.map((r) => r.quantity)),
        closed: it.closedAt !== null,
      },
    ]),
  );
}

/** Record a delivery. Requires the RECEIVER role (admins pass). */
export async function createReceipt(actor: Actor, raw: unknown) {
  const input = parseInput(createReceiptInput, raw);
  if (input.items.length === 0) throw new AppError("VALIDATION", errors.receiptNoItems);
  const ids = input.items.map((i) => i.orderItemId);
  if (new Set(ids).size !== ids.length) throw new AppError("VALIDATION", errors.orderDuplicateItem);

  return db.$transaction(async (tx) => {
    const req = await lockOrderForReceipt(tx, actor, input.orderId);
    const order = await tx.purchaseOrder.findUniqueOrThrow({
      where: { id: input.orderId },
      select: { createdAt: true },
    });
    // A delivery cannot predate the order (dates compared as Tbilisi calendar days).
    if (input.receivedOn.toISOString().slice(0, 10) < todayInTbilisi(order.createdAt)) {
      throw new AppError("VALIDATION", errors.receiptBeforeOrder, {
        receivedOn: errors.receiptBeforeOrder,
      });
    }
    const progress = await orderItemProgress(tx, input.orderId);
    const fieldErrors: Record<string, string> = {};
    input.items.forEach((it, i) => {
      const p = progress.get(it.orderItemId);
      if (!p) throw new AppError("VALIDATION", errors.receiptItemForeign);
      if (p.closed) {
        fieldErrors[`items.${i}.quantity`] = errors.receiptLineClosed;
      } else if (p.received.plus(it.quantity).gt(p.ordered)) {
        fieldErrors[`items.${i}.quantity`] =
          `${errors.overReceipt} დარჩენილია ${p.ordered.minus(p.received).toString()}.`;
      }
    });
    if (Object.keys(fieldErrors).length > 0) {
      const onlyClosed = Object.values(fieldErrors).every((m) => m === errors.receiptLineClosed);
      throw new AppError(
        "CONFLICT",
        onlyClosed ? errors.receiptLineClosed : errors.overReceipt,
        fieldErrors,
      );
    }

    const receipt = await tx.receipt.create({
      data: {
        orderId: input.orderId,
        receivedOn: input.receivedOn,
        receivedById: actor.userId,
        note: input.note,
        waybillNumber: input.waybillNumber,
        waybillDate: input.waybillNumber ? input.waybillDate : null,
        items: {
          create: input.items.map((it) => ({
            orderItemId: it.orderItemId,
            quantity: new Prisma.Decimal(it.quantity),
            note: it.note,
          })),
        },
      },
      select: { id: true },
    });
    await recordEvent(tx, actor, {
      entityType: "PurchaseOrder",
      entityId: input.orderId,
      projectId: req.projectId,
      action: "receipt.created",
      changes: {
        receiptId: receipt.id,
        receivedOn: input.receivedOn.toISOString().slice(0, 10),
        waybillNumber: input.waybillNumber,
        items: input.items.map((it) => ({ orderItemId: it.orderItemId, quantity: it.quantity })),
      },
    });
    await recomputeRequestStatus(tx, actor, req);
    return { id: receipt.id, orderId: input.orderId, requestId: req.id };
  });
}

/**
 * Correct a confirmed receipt entry to a new net value, keeping the original row.
 * Adds a correction receipt (dated today, by the actor) holding the difference.
 */
export async function correctReceiptItem(actor: Actor, receiptItemId: string, raw: unknown) {
  const input = parseInput(correctReceiptInput, raw);
  return db.$transaction(async (tx) => {
    const original = await tx.receiptItem.findUnique({
      where: { id: receiptItemId },
      select: {
        id: true,
        orderItemId: true,
        correctsId: true,
        receipt: { select: { orderId: true, order: { select: { organizationId: true } } } },
      },
    });
    if (!original || original.receipt.order.organizationId !== actor.organizationId) {
      throw notFound();
    }
    if (original.correctsId) throw new AppError("VALIDATION", errors.correctionOfCorrection);
    const orderId = original.receipt.orderId;
    const req = await lockOrderForReceipt(tx, actor, orderId);

    // Current net value of this entry, and of the whole order item, after the lock.
    const entry = await tx.receiptItem.findUniqueOrThrow({
      where: { id: receiptItemId },
      select: { quantity: true, corrections: { select: { quantity: true } } },
    });
    const current = entry.quantity.plus(sumDecimals(entry.corrections.map((c) => c.quantity)));
    const target = new Prisma.Decimal(input.quantity);
    const delta = target.minus(current);
    if (delta.isZero()) {
      throw new AppError("VALIDATION", errors.correctionSame, { quantity: errors.correctionSame });
    }
    const p = (await orderItemProgress(tx, orderId)).get(original.orderItemId)!;
    const newNet = p.received.plus(delta);
    if (newNet.isNegative()) {
      throw new AppError("CONFLICT", errors.correctionNegative, {
        quantity: errors.correctionNegative,
      });
    }
    // A closed line counts as ordered up to what was received: raising it would over-order.
    if (p.closed && delta.gt(0)) {
      throw new AppError("CONFLICT", errors.correctionClosedIncrease, {
        quantity: errors.correctionClosedIncrease,
      });
    }
    if (newNet.gt(p.ordered)) {
      throw new AppError("CONFLICT", errors.overReceipt, {
        quantity: `${errors.overReceipt} შესაძლებელია მაქსიმუმ ${current.plus(p.ordered.minus(p.received)).toString()}.`,
      });
    }

    const receipt = await tx.receipt.create({
      data: {
        orderId,
        receivedOn: parseWorkDate(todayInTbilisi())!,
        receivedById: actor.userId,
        note: input.reason,
        items: {
          create: {
            orderItemId: original.orderItemId,
            quantity: delta,
            correctsId: original.id,
            note: input.reason,
          },
        },
      },
      select: { id: true },
    });
    await recordEvent(tx, actor, {
      entityType: "PurchaseOrder",
      entityId: orderId,
      projectId: req.projectId,
      action: "receipt.corrected",
      reason: input.reason,
      changes: {
        receiptId: receipt.id,
        receiptItemId: original.id,
        from: current.toString(),
        to: target.toString(),
        delta: delta.toString(),
      },
    });
    await recomputeRequestStatus(tx, actor, req);
    return { id: receipt.id, orderId, requestId: req.id };
  });
}

// ─── Waybill ─────────────────────────────────────────────────────────────────

export const setWaybillInput = z.object({
  waybillNumber: waybillNumberField.refine((v) => v !== null, "მიუთითეთ ზედნადების ნომერი."),
  waybillDate: waybillDateField,
  reason: z.string().trim().max(1000, "მაქსიმუმ 1000 სიმბოლო.").optional().default(""),
});

/**
 * Add or change the waybill of a delivery (later, when the supplier issues it). Receivers and
 * buyers may do it, also after the order is finished. Changing an existing waybill needs a reason.
 */
export async function setReceiptWaybill(actor: Actor, receiptId: string, raw: unknown) {
  const input = parseInput(setWaybillInput, raw);
  return db.$transaction(async (tx) => {
    const receipt = await tx.receipt.findUnique({
      where: { id: receiptId },
      select: {
        id: true,
        orderId: true,
        waybillNumber: true,
        waybillDate: true,
        items: { select: { correctsId: true } },
        order: { select: { organizationId: true, requestId: true, status: true } },
      },
    });
    if (!receipt || receipt.order.organizationId !== actor.organizationId) throw notFound();
    if (receipt.items.every((i) => i.correctsId !== null)) {
      throw new AppError("VALIDATION", errors.waybillOnCorrection);
    }
    const req = await lockRequest(tx, actor, receipt.order.requestId);
    await requireProjectAccess(tx, actor, req.projectId, {
      requiredRoles: ["RECEIVER", "BUYER"],
      write: true,
    });
    if (receipt.order.status !== "ACTIVE") throw new AppError("CONFLICT", errors.orderNotActive);
    const number = input.waybillNumber!;
    const sameDate =
      (receipt.waybillDate?.getTime() ?? null) === (input.waybillDate?.getTime() ?? null);
    if (receipt.waybillNumber === number && sameDate) {
      throw new AppError("VALIDATION", errors.waybillSame, { waybillNumber: errors.waybillSame });
    }
    const changing = !!receipt.waybillNumber;
    if (changing && input.reason.length < 3) {
      throw new AppError("VALIDATION", errors.waybillChangeReason, {
        reason: errors.waybillChangeReason,
      });
    }
    await tx.receipt.update({
      where: { id: receipt.id },
      data: { waybillNumber: number, waybillDate: input.waybillDate },
    });
    await recordEvent(tx, actor, {
      entityType: "PurchaseOrder",
      entityId: receipt.orderId,
      projectId: req.projectId,
      action: changing ? "receipt.waybill_changed" : "receipt.waybill_set",
      reason: changing ? input.reason : null,
      changes: {
        receiptId: receipt.id,
        from: receipt.waybillNumber,
        to: number,
        waybillDate: input.waybillDate?.toISOString().slice(0, 10) ?? null,
      },
    });
    await recomputeRequestStatus(tx, actor, req);
    return { orderId: receipt.orderId, requestId: req.id };
  });
}
