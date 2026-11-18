// Waybills (ზედნადები) on deliveries: optional when recording, required to finish, search, export.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { todayInTbilisi } from "@/lib/format";
import type { Actor } from "@/server/access";
import {
  createOrder,
  exportReceiptLines,
  getOrder,
  listOrders,
  orderDashboard,
  setSupplierTaxId,
} from "@/server/orders/service";
import { createProject } from "@/server/projects/service";
import { correctReceiptItem, createReceipt, setReceiptWaybill } from "@/server/receipts/service";
import { approveRequest, createRequest, submitRequest } from "@/server/requests/service";
import { addMembership, createActor, createOrg, expectAppError, resetDb } from "./helpers";

let admin: Actor;
let requester: Actor;
let buyer: Actor;
let receiver: Actor;
let outsider: Actor;
let projectId: string;
let supplierId: string;

const statusOf = async (id: string) =>
  (await db.purchaseRequest.findUniqueOrThrow({ where: { id } })).status;

/** Approved request (cement 10 bags) with one order for all of it. */
async function ordered() {
  const r = await createRequest(requester, {
    projectId,
    items: [{ name: "ცემენტი", quantity: "10", unit: "ტომარა" }],
  });
  await submitRequest(requester, r.id);
  await approveRequest(buyer, r.id);
  const item = await db.requestItem.findFirstOrThrow({ where: { requestId: r.id } });
  const o = await createOrder(buyer, {
    requestId: r.id,
    supplierId,
    currency: "GEL",
    items: [{ requestItemId: item.id, quantity: "10", unitPrice: "18.5" }],
  });
  const line = await db.orderItem.findFirstOrThrow({ where: { orderId: o.id } });
  return { requestId: r.id, orderId: o.id, lineId: line.id };
}

const receive = (orderId: string, lineId: string, quantity: string, waybill?: string) =>
  createReceipt(receiver, {
    orderId,
    receivedOn: todayInTbilisi(),
    ...(waybill ? { waybillNumber: waybill, waybillDate: todayInTbilisi() } : {}),
    items: [{ orderItemId: lineId, quantity }],
  });

beforeEach(async () => {
  await resetDb();
  const org = await createOrg();
  admin = await createActor(org.id, { admin: true });
  requester = await createActor(org.id, { name: "მომთხოვნი" });
  buyer = await createActor(org.id, { name: "შემსყიდველი" });
  receiver = await createActor(org.id, { name: "მიმღები" });
  outsider = await createActor(org.id, { name: "უცხო" });
  projectId = (await createProject(admin, { name: "ობიექტი", address: "თბილისი" })).id;
  await addMembership(projectId, requester.userId, ["REQUESTER"]);
  await addMembership(projectId, buyer.userId, ["BUYER"]);
  await addMembership(projectId, receiver.userId, ["RECEIVER"]);
  supplierId = (await db.supplier.create({ data: { organizationId: org.id, name: "შპს ა" } })).id;
});

afterAll(async () => {
  await db.$disconnect();
});

describe("waybill is required to finish, optional when recording", () => {
  it("everything received without a waybill waits; adding it later finishes", async () => {
    const o = await ordered();
    const rec = await receive(o.orderId, o.lineId, "10");
    expect(await statusOf(o.requestId)).toBe("AWAITING_WAYBILL");
    const detail = await getOrder(receiver, o.orderId);
    expect(detail.order.delivery).toBe("WAYBILL_MISSING");
    expect(detail.receipts[0]!.waybillNumber).toBeNull();
    expect((await orderDashboard(buyer)).waybillCount).toBe(1);
    expect((await listOrders(buyer, { delivery: "waybill" })).total).toBe(1);

    await expectAppError(
      setReceiptWaybill(requester, rec.id, { waybillNumber: "123" }),
      "FORBIDDEN",
    );
    await expectAppError(
      setReceiptWaybill(outsider, rec.id, { waybillNumber: "123" }),
      "FORBIDDEN",
    );
    await setReceiptWaybill(buyer, rec.id, {
      waybillNumber: "0412345678",
      waybillDate: todayInTbilisi(),
    });
    expect(await statusOf(o.requestId)).toBe("RECEIVED");
    expect((await getOrder(receiver, o.orderId)).order.delivery).toBe("RECEIVED");
    expect((await orderDashboard(buyer)).waybillCount).toBe(0);
    const ev = await db.auditEvent.findFirstOrThrow({ where: { action: "receipt.waybill_set" } });
    expect(ev.changes).toMatchObject({ from: null, to: "0412345678" });
  });

  it("a partial delivery without a waybill does not block the partial status", async () => {
    const o = await ordered();
    await receive(o.orderId, o.lineId, "4");
    expect(await statusOf(o.requestId)).toBe("PARTIALLY_RECEIVED");
    await receive(o.orderId, o.lineId, "6", "0412345679");
    // The first delivery still has none.
    expect(await statusOf(o.requestId)).toBe("AWAITING_WAYBILL");
  });

  it("changing an existing waybill needs a reason and is recorded", async () => {
    const o = await ordered();
    const rec = await receive(o.orderId, o.lineId, "10", "0412345678");
    expect(await statusOf(o.requestId)).toBe("RECEIVED");
    await expectAppError(
      setReceiptWaybill(receiver, rec.id, { waybillNumber: "0412345670" }),
      "VALIDATION",
    );
    await expectAppError(
      setReceiptWaybill(receiver, rec.id, {
        waybillNumber: "0412345678",
        waybillDate: todayInTbilisi(),
        reason: "იგივე",
      }),
      "VALIDATION",
    );
    await setReceiptWaybill(receiver, rec.id, {
      waybillNumber: "0412345670",
      reason: "ნომერი შეცდომით ჩაიწერა",
    });
    const ev = await db.auditEvent.findFirstOrThrow({
      where: { action: "receipt.waybill_changed" },
    });
    expect(ev.reason).toBe("ნომერი შეცდომით ჩაიწერა");
    expect(ev.changes).toMatchObject({ from: "0412345678", to: "0412345670" });
  });

  it("validates the number and the date", async () => {
    const o = await ordered();
    const base = { orderId: o.orderId, receivedOn: todayInTbilisi() };
    const items = [{ orderItemId: o.lineId, quantity: "1" }];
    await expectAppError(
      createReceipt(receiver, { ...base, items, waybillNumber: "12 34" }),
      "VALIDATION",
    );
    await expectAppError(
      createReceipt(receiver, { ...base, items, waybillNumber: "1234", waybillDate: "2999-01-01" }),
      "VALIDATION",
    );
  });

  it("a delivery corrected down to zero needs no waybill", async () => {
    const o = await ordered();
    const rec = await receive(o.orderId, o.lineId, "3");
    await receive(o.orderId, o.lineId, "10", "0412345678").catch(() => null); // over: refused
    const entry = await db.receiptItem.findFirstOrThrow({ where: { receiptId: rec.id } });
    await correctReceiptItem(receiver, entry.id, { quantity: "0", reason: "არაფერი მოსულა" });
    await receive(o.orderId, o.lineId, "10", "0412345678");
    expect(await statusOf(o.requestId)).toBe("RECEIVED");
    // The correction receipt itself takes no waybill.
    const corr = await db.receipt.findFirstOrThrow({
      where: { orderId: o.orderId, items: { every: { correctsId: { not: null } } } },
    });
    await expectAppError(
      setReceiptWaybill(receiver, corr.id, { waybillNumber: "1" }),
      "VALIDATION",
    );
  });
});

describe("search, supplier code and export", () => {
  it("finds orders by waybill number", async () => {
    const o = await ordered();
    await receive(o.orderId, o.lineId, "10", "0498765432");
    expect((await listOrders(buyer, { q: "98765" })).rows.map((r) => r.id)).toEqual([o.orderId]);
    expect((await listOrders(buyer, { q: "11111" })).total).toBe(0);
  });

  it("buyers set the supplier code (9 or 11 digits)", async () => {
    await expectAppError(
      setSupplierTaxId(receiver, supplierId, { taxId: "123456789" }),
      "FORBIDDEN",
    );
    await expectAppError(setSupplierTaxId(buyer, supplierId, { taxId: "12345" }), "VALIDATION");
    await setSupplierTaxId(buyer, supplierId, { taxId: "405123456" });
    expect((await db.supplier.findUniqueOrThrow({ where: { id: supplierId } })).taxId).toBe(
      "405123456",
    );
  });

  it("exports received lines with waybill, supplier code and amounts, visible ones only", async () => {
    const o = await ordered();
    await setSupplierTaxId(buyer, supplierId, { taxId: "405123456" });
    await receive(o.orderId, o.lineId, "4", "0412345678");
    await receive(o.orderId, o.lineId, "6");
    const rows = await exportReceiptLines(buyer, {});
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      waybillNumber: "0412345678",
      supplierTaxId: "405123456",
      material: "ცემენტი",
      quantity: "4",
      unitPrice: "18.5",
      amount: "74",
      currency: "GEL",
    });
    expect(rows[1]!.waybillNumber).toBeNull();
    expect(await exportReceiptLines(outsider, {})).toEqual([]);
  });
});
