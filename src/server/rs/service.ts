// RS.ge waybill link (optional, per organization, off by default).
// - Admin: choose the mode (off / demo / live), store the service user, test the connection.
// - Receivers and buyers: pick a delivery's waybill from the supplier's RS.ge waybills, or check
//   a hand-entered waybill against RS.ge (exists, not deleted, issued by this supplier).
// Network calls never run inside a database transaction; writes re-check state in their own.
import { z } from "zod";
import type { RsMode } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { parseWorkDate, todayInTbilisi } from "@/lib/format";
import { errors, rsErrors } from "@/lib/i18n/ka";
import { assertAdmin, requireProjectAccess, type Actor } from "@/server/access";
import { recordEvent } from "@/server/audit";
import { AppError, notFound } from "@/server/errors";
import { lockRequest } from "@/server/orders/progress";
import { consumeRateLimit } from "@/server/rate-limit";
import { setReceiptWaybill } from "@/server/receipts/service";
import { demoClient, liveClient, type RsClient } from "@/server/rs/client";
import { decryptSecret, encryptSecret } from "@/server/rs/crypto";
import { RsTransportError, type RsWaybill } from "@/server/rs/soap";
import { parseInput } from "@/server/validation";

/** RS.ge calls per organization per minute (the service is shared and slow). */
const RS_CALLS_PER_MINUTE = 30;
/** Waybills are looked up from this many days before the order was placed. */
const LOOKBACK_DAYS = 14;

// Replaceable in tests, so no test ever reaches the real RS.ge service.
let makeLiveClient: (su: string, sp: string) => RsClient = liveClient;
export function setLiveClientFactoryForTests(f: typeof makeLiveClient) {
  makeLiveClient = f;
}

// ─── Settings (admin) ────────────────────────────────────────────────────────

export async function getRsSettings(actor: Actor) {
  assertAdmin(actor);
  const org = await db.organization.findUniqueOrThrow({
    where: { id: actor.organizationId },
    select: { rsMode: true, rsServiceUser: true, rsServicePassword: true },
  });
  return {
    mode: org.rsMode,
    serviceUser: org.rsServiceUser,
    hasPassword: !!org.rsServicePassword,
  };
}

/** The organization's RS.ge mode (for showing or hiding the RS.ge buttons). */
export async function getRsMode(organizationId: string): Promise<RsMode> {
  const org = await db.organization.findUnique({
    where: { id: organizationId },
    select: { rsMode: true },
  });
  return org?.rsMode ?? "OFF";
}

export const rsSettingsInput = z.object({
  mode: z.enum(["OFF", "DEMO", "LIVE"], { message: errors.invalidInput }),
  serviceUser: z
    .string()
    .trim()
    .max(100, "მაქსიმუმ 100 სიმბოლო.")
    .optional()
    .transform((v) => v || null),
  // Empty means "keep the stored password".
  password: z.string().max(200, "მაქსიმუმ 200 სიმბოლო.").optional().default(""),
});

export async function saveRsSettings(actor: Actor, raw: unknown) {
  assertAdmin(actor);
  const input = parseInput(rsSettingsInput, raw);
  await db.$transaction(async (tx) => {
    const org = await tx.organization.findUniqueOrThrow({
      where: { id: actor.organizationId },
      select: { rsMode: true, rsServiceUser: true, rsServicePassword: true },
    });
    const password = input.password ? encryptSecret(input.password) : org.rsServicePassword;
    if (input.mode === "LIVE") {
      const fe: Record<string, string> = {};
      if (!password) fe.password = rsErrors.passwordRequired;
      if (!input.serviceUser) fe.serviceUser = rsErrors.userRequired;
      const first = fe.serviceUser ?? fe.password;
      if (first) throw new AppError("VALIDATION", first, fe);
    }
    await tx.organization.update({
      where: { id: actor.organizationId },
      data: { rsMode: input.mode, rsServiceUser: input.serviceUser, rsServicePassword: password },
    });
    await recordEvent(tx, actor, {
      entityType: "Organization",
      entityId: actor.organizationId,
      action: "org.rs_settings_changed",
      // The password is never written to the history, only whether it changed.
      changes: {
        mode: { from: org.rsMode, to: input.mode },
        serviceUser: { from: org.rsServiceUser, to: input.serviceUser },
        passwordChanged: !!input.password,
      },
    });
  });
}

/** Check the stored settings against RS.ge. Returns a Georgian message. */
export async function testRsConnection(actor: Actor): Promise<string> {
  assertAdmin(actor);
  const { client, mode } = await clientFor(actor.organizationId);
  await consumeRateLimit(`rs:${actor.organizationId}`, RS_CALLS_PER_MINUTE);
  const ok = await guard(() => client.checkUser());
  if (!ok) throw new AppError("VALIDATION", rsErrors.badCredentials);
  return mode === "DEMO" ? rsErrors.demoConnected : rsErrors.connected;
}

async function clientFor(organizationId: string): Promise<{ client: RsClient; mode: RsMode }> {
  const org = await db.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { rsMode: true, rsServiceUser: true, rsServicePassword: true },
  });
  if (org.rsMode === "OFF") throw new AppError("CONFLICT", rsErrors.off);
  if (org.rsMode === "DEMO") return { client: demoClient(), mode: "DEMO" };
  const password = org.rsServicePassword ? decryptSecret(org.rsServicePassword) : null;
  if (!org.rsServiceUser || !password) throw new AppError("CONFLICT", rsErrors.reenterPassword);
  return { client: makeLiveClient(org.rsServiceUser, password), mode: "LIVE" };
}

/** Turn RS.ge transport problems into Georgian messages. */
async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof RsTransportError) {
      throw new AppError(
        "CONFLICT",
        e.kind === "timeout"
          ? rsErrors.timeout
          : e.kind === "fault" || e.kind === "auth"
            ? rsErrors.fault
            : rsErrors.unreachable,
      );
    }
    throw e;
  }
}

// ─── Waybills of a delivery ──────────────────────────────────────────────────

async function loadReceipt(actor: Actor, receiptId: string) {
  const receipt = await db.receipt.findUnique({
    where: { id: receiptId },
    select: {
      id: true,
      orderId: true,
      waybillNumber: true,
      waybillDate: true,
      items: { select: { correctsId: true } },
      order: {
        select: {
          organizationId: true,
          status: true,
          createdAt: true,
          request: { select: { projectId: true } },
          supplier: { select: { id: true, name: true, taxId: true } },
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
  if (receipt.items.every((i) => i.correctsId !== null)) {
    throw new AppError("VALIDATION", errors.waybillOnCorrection);
  }
  if (!receipt.order.supplier.taxId) throw new AppError("VALIDATION", rsErrors.noSupplierTaxId);
  return receipt;
}

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Valid waybills: activated or closed (saved drafts, deleted and deactivated ones are not). */
const usable = (w: RsWaybill) => w.status === "ACTIVE" || w.status === "CLOSED";

export type RsWaybillOption = RsWaybill & {
  /** Orders in this organization whose deliveries already carry this waybill number. */
  usedOn: { id: string; number: number }[];
};

/** The supplier's RS.ge waybills that can belong to this delivery, newest first. */
export async function listReceiptWaybills(
  actor: Actor,
  receiptId: string,
): Promise<RsWaybillOption[]> {
  const receipt = await loadReceipt(actor, receiptId);
  const { client, mode } = await clientFor(actor.organizationId);
  await consumeRateLimit(`rs:${actor.organizationId}`, RS_CALLS_PER_MINUTE);
  const supplier = receipt.order.supplier;
  const from = addDays(todayInTbilisi(receipt.order.createdAt), -LOOKBACK_DAYS);
  const list = (await guard(() => client.buyerWaybills(supplier.taxId!, from, todayInTbilisi())))
    .filter(usable)
    // A live answer is filtered by seller code already; keep the check in case it is not.
    .filter((w) => !w.sellerTin || w.sellerTin === supplier.taxId)
    .map((w) => (mode === "DEMO" ? { ...w, sellerName: supplier.name } : w))
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));

  const used = await db.receipt.findMany({
    where: {
      waybillNumber: { in: list.map((w) => w.number) },
      order: { organizationId: actor.organizationId, supplierId: supplier.id },
    },
    select: { waybillNumber: true, order: { select: { id: true, number: true } } },
  });
  return list.map((w) => ({
    ...w,
    usedOn: used
      .filter((u) => u.waybillNumber === w.number)
      .map((u) => u.order)
      .filter((o, i, all) => all.findIndex((x) => x.id === o.id) === i),
  }));
}

/** Put a waybill picked from RS.ge on a delivery that has none yet. */
export async function applyRsWaybill(actor: Actor, receiptId: string, rsWaybillId: string) {
  const options = await listReceiptWaybills(actor, receiptId);
  const picked = options.find((w) => w.id === rsWaybillId);
  if (!picked) throw new AppError("CONFLICT", rsErrors.pickedGone);
  const current = await db.receipt.findUnique({
    where: { id: receiptId },
    select: { waybillNumber: true },
  });
  if (current?.waybillNumber) throw new AppError("CONFLICT", rsErrors.alreadyHasWaybill);
  return setReceiptWaybill(
    actor,
    receiptId,
    { waybillNumber: picked.number, waybillDate: picked.date ?? "" },
    { rsWaybillId: picked.id },
  );
}

/**
 * Check a delivery's hand-entered waybill against RS.ge. On success the delivery is marked as
 * checked (and gets the RS.ge date if it had none); on a mismatch nothing changes.
 */
export async function verifyReceiptWaybill(actor: Actor, receiptId: string): Promise<string> {
  const receipt = await loadReceipt(actor, receiptId);
  if (!receipt.waybillNumber) throw new AppError("VALIDATION", rsErrors.nothingToVerify);
  const { client } = await clientFor(actor.organizationId);
  await consumeRateLimit(`rs:${actor.organizationId}`, RS_CALLS_PER_MINUTE);
  const supplier = receipt.order.supplier;
  const w = await guard(() => client.waybillByNumber(receipt.waybillNumber!, supplier.taxId!));
  if (!w) throw new AppError("VALIDATION", rsErrors.notFound);
  if (!usable(w)) throw new AppError("VALIDATION", rsErrors.notValid);
  if (w.sellerTin && w.sellerTin !== supplier.taxId) {
    throw new AppError("VALIDATION", rsErrors.otherSupplier(w.sellerTin));
  }

  const number = receipt.waybillNumber;
  await db.$transaction(async (tx) => {
    const req = await lockRequest(
      tx,
      actor,
      (
        await tx.purchaseOrder.findUniqueOrThrow({
          where: { id: receipt.orderId },
          select: { requestId: true },
        })
      ).requestId,
    );
    // The waybill may have been changed while RS.ge was answering.
    const now = await tx.receipt.findUniqueOrThrow({
      where: { id: receipt.id },
      select: { waybillNumber: true, waybillDate: true },
    });
    if (now.waybillNumber !== number) throw new AppError("CONFLICT", rsErrors.changedMeanwhile);
    const fillDate = !now.waybillDate && w.date ? parseWorkDate(w.date) : null;
    await tx.receipt.update({
      where: { id: receipt.id },
      data: {
        rsWaybillId: w.id,
        rsCheckedAt: new Date(),
        ...(fillDate ? { waybillDate: fillDate } : {}),
      },
    });
    await recordEvent(tx, actor, {
      entityType: "PurchaseOrder",
      entityId: receipt.orderId,
      projectId: req.projectId,
      action: "receipt.waybill_verified",
      changes: { receiptId: receipt.id, waybillNumber: number, rsDate: w.date },
    });
  });
  const entered = receipt.waybillDate?.toISOString().slice(0, 10);
  return entered && w.date && entered !== w.date
    ? rsErrors.verifiedOtherDate(w.date)
    : rsErrors.verified;
}
