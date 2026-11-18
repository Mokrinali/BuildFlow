// Packaging changes, closing orders short and two-sided remainder cancellation.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { todayInTbilisi } from "@/lib/format";
import type { Actor } from "@/server/access";
import { closeOrder, createOrder, getOrder, getOrderDraft } from "@/server/orders/service";
import { createProject } from "@/server/projects/service";
import { correctReceiptItem, createReceipt } from "@/server/receipts/service";
import {
  adjustApprovedQuantity,
  approveRequest,
  cancellationsToDecide,
  createRequest,
  decideItemCancellation,
  getRequest,
  requestItemCancellation,
  submitRequest,
  withdrawItemCancellation,
} from "@/server/requests/service";
import { addMembership, createActor, createOrg, expectAppError, resetDb } from "./helpers";

let admin: Actor;
let requester: Actor;
let buyer: Actor;
let buyer2: Actor;
let receiver: Actor;
let outsider: Actor;
let projectId: string;
let supplierA: string;
let supplierB: string;

const statusOf = async (id: string) =>
  (await db.purchaseRequest.findUniqueOrThrow({ where: { id } })).status;

/** Approved request: cement 40 bags, rebar 1.5 t. */
async function approvedRequest() {
  const r = await createRequest(requester, {
    projectId,
    items: [
      { name: "ცემენტი", quantity: "40", unit: "ტომარა" },
      { name: "არმატურა", spec: "Ø12", quantity: "1,5", unit: "ტონა" },
    ],
  });
  await submitRequest(requester, r.id);
  await approveRequest(buyer, r.id);
  const items = await db.requestItem.findMany({
    where: { requestId: r.id },
    orderBy: { position: "asc" },
  });
  return { id: r.id, cement: items[0]!.id, rebar: items[1]!.id };
}

async function order(
  requestId: string,
  requestItemId: string,
  quantity: string,
  supplier = supplierA,
) {
  return createOrder(buyer, {
    requestId,
    supplierId: supplier,
    currency: "GEL",
    items: [{ requestItemId, quantity, unitPrice: "10" }],
  });
}

async function receive(orderId: string, quantity: string) {
  const line = await db.orderItem.findFirstOrThrow({ where: { orderId } });
  return createReceipt(receiver, {
    waybillNumber: "1000000001",
    orderId,
    receivedOn: todayInTbilisi(),
    items: [{ orderItemId: line.id, quantity }],
  });
}

const itemOf = async (requestId: string, itemId: string, who: Actor = requester) =>
  (await getRequest(who, requestId)).items.find((i) => i.id === itemId)!;

beforeEach(async () => {
  await resetDb();
  const org = await createOrg();
  admin = await createActor(org.id, { admin: true, name: "ადმინი" });
  requester = await createActor(org.id, { name: "მომთხოვნი" });
  buyer = await createActor(org.id, { name: "შემსყიდველი" });
  buyer2 = await createActor(org.id, { name: "მეორე შემსყიდველი" });
  receiver = await createActor(org.id, { name: "მიმღები" });
  outsider = await createActor(org.id, { name: "უცხო" });
  projectId = (await createProject(admin, { name: "ობიექტი", address: "თბილისი" })).id;
  await addMembership(projectId, requester.userId, ["REQUESTER"]);
  await addMembership(projectId, buyer.userId, ["BUYER"]);
  await addMembership(projectId, buyer2.userId, ["BUYER"]);
  await addMembership(projectId, receiver.userId, ["RECEIVER"]);
  supplierA = (await db.supplier.create({ data: { organizationId: org.id, name: "შპს ა" } })).id;
  supplierB = (await db.supplier.create({ data: { organizationId: org.id, name: "შპს ბ" } })).id;
});

afterAll(async () => {
  await db.$disconnect();
});

describe("approved quantity (packaging)", () => {
  it("lets the buyer raise it with a reason, so a 2 t bundle can be ordered for 1,5 t", async () => {
    const r = await approvedRequest();
    await expectAppError(order(r.id, r.rebar, "2"), "CONFLICT");
    await adjustApprovedQuantity(buyer, r.id, {
      itemId: r.rebar,
      quantity: "2",
      reason: "მომწოდებელი ყიდის 2-ტონიან შეკვრებს",
    });
    const item = await itemOf(r.id, r.rebar);
    expect(item).toMatchObject({ quantity: "1.5", approved: "2", changed: true });
    await order(r.id, r.rebar, "2");
    const draft = await getOrderDraft(buyer, r.id);
    expect(draft.items.find((i) => i.id === r.rebar)).toMatchObject({
      approved: "2",
      available: "0",
    });
    const ev = await db.auditEvent.findFirstOrThrow({ where: { action: "request.item_adjusted" } });
    expect(ev.reason).toBe("მომწოდებელი ყიდის 2-ტონიან შეკვრებს");
    expect(ev.changes).toMatchObject({ from: "1.5", to: "2" });
  });

  it("is buyer-only, needs a reason, a positive value, and never drops below ordered", async () => {
    const r = await approvedRequest();
    const input = { itemId: r.cement, quantity: "30", reason: "შეფუთვა" };
    await expectAppError(adjustApprovedQuantity(requester, r.id, input), "FORBIDDEN");
    await expectAppError(adjustApprovedQuantity(outsider, r.id, input), "FORBIDDEN");
    await expectAppError(
      adjustApprovedQuantity(buyer, r.id, { ...input, reason: "" }),
      "VALIDATION",
    );
    await expectAppError(
      adjustApprovedQuantity(buyer, r.id, { ...input, quantity: "0" }),
      "VALIDATION",
    );
    await order(r.id, r.cement, "35");
    const err = await expectAppError(adjustApprovedQuantity(buyer, r.id, input), "CONFLICT");
    expect(err.fieldErrors?.quantity).toContain("35");
    await adjustApprovedQuantity(buyer, r.id, { ...input, quantity: "35" });
    expect(await statusOf(r.id)).toBe("PARTIALLY_ORDERED");
  });

  it("going back to the requested value is stored as 'as requested'", async () => {
    const r = await approvedRequest();
    await adjustApprovedQuantity(buyer, r.id, {
      itemId: r.cement,
      quantity: "50",
      reason: "პალეტი",
    });
    await adjustApprovedQuantity(buyer, r.id, {
      itemId: r.cement,
      quantity: "40",
      reason: "დაბრუნება",
    });
    expect(
      (await db.requestItem.findUniqueOrThrow({ where: { id: r.cement } })).approvedQuantity,
    ).toBeNull();
    expect((await itemOf(r.id, r.cement)).changed).toBe(false);
  });
});

describe("closing an order short", () => {
  it("finishes the order at what was received and returns the rest to the request", async () => {
    const r = await approvedRequest();
    const o = await order(r.id, r.cement, "40");
    await order(r.id, r.rebar, "1,5", supplierB);
    expect(await statusOf(r.id)).toBe("ORDERED");
    await receive(o.id, "25");
    await expectAppError(closeOrder(receiver, o.id, "მეტი არ აქვს"), "FORBIDDEN");
    await closeOrder(buyer, o.id, "მომწოდებელს მეტი არ აქვს");

    const detail = await getOrder(buyer, o.id);
    expect(detail.order.delivery).toBe("CLOSED");
    expect(detail.items[0]).toMatchObject({ closed: true, remaining: "0", received: "25" });
    expect(detail.permissions).toMatchObject({ canReceive: false, canClose: false });
    expect(await statusOf(r.id)).toBe("PARTIALLY_RECEIVED");
    expect(await itemOf(r.id, r.cement)).toMatchObject({ ordered: "25", remaining: "15" });

    // The rest can be ordered elsewhere.
    const draft = await getOrderDraft(buyer, r.id);
    expect(draft.items.find((i) => i.id === r.cement)!.available).toBe("15");
    await order(r.id, r.cement, "15", supplierB);
  });

  it("blocks deliveries on a closed line and upward corrections there", async () => {
    const r = await approvedRequest();
    const o = await order(r.id, r.cement, "40");
    const rec = await receive(o.id, "25");
    await closeOrder(buyer, o.id, "მეტი არ აქვს");
    const err = await expectAppError(receive(o.id, "5"), "CONFLICT");
    expect(err.message).toContain("დახურულია");
    const entry = await db.receiptItem.findFirstOrThrow({ where: { receiptId: rec.id } });
    await expectAppError(
      correctReceiptItem(receiver, entry.id, { quantity: "30", reason: "გადათვლა" }),
      "CONFLICT",
    );
    // Lowering stays possible; the rest then grows accordingly.
    await correctReceiptItem(receiver, entry.id, { quantity: "20", reason: "გადათვლა" });
    expect(await itemOf(r.id, r.cement)).toMatchObject({ ordered: "20", remaining: "20" });
  });

  it("needs something received (otherwise cancel the order) and something still open", async () => {
    const r = await approvedRequest();
    const o = await order(r.id, r.cement, "40");
    await expectAppError(closeOrder(buyer, o.id, "მეტი არ აქვს"), "CONFLICT");
    await receive(o.id, "40");
    await expectAppError(closeOrder(buyer, o.id, "მეტი არ აქვს"), "CONFLICT");
  });
});

describe("remainder cancellation needs both sides", () => {
  it("requester asks, the same person cannot confirm, a buyer confirms; open lines close", async () => {
    const r = await approvedRequest();
    const o = await order(r.id, r.cement, "40");
    await receive(o.id, "10");
    const c = await requestItemCancellation(requester, r.id, {
      itemId: r.cement,
      reason: "საჭიროება აღარ არის",
    });
    // Nothing changes until confirmed: deliveries continue.
    await receive(o.id, "5");
    const pending = (await itemOf(r.id, r.cement)).pendingCancellation!;
    expect(pending).toMatchObject({ side: "REQUESTER", canWithdraw: true, canDecide: false });
    expect((await itemOf(r.id, r.cement, buyer)).pendingCancellation!.canDecide).toBe(true);

    await expectAppError(
      decideItemCancellation(requester, r.id, { cancellationId: c.id, decision: "confirm" }),
      "FORBIDDEN",
    );
    await expectAppError(
      decideItemCancellation(receiver, r.id, { cancellationId: c.id, decision: "confirm" }),
      "FORBIDDEN",
    );
    expect((await cancellationsToDecide(buyer)).map((x) => x.id)).toEqual([c.id]);
    expect(await cancellationsToDecide(requester)).toEqual([]);

    await decideItemCancellation(buyer, r.id, { cancellationId: c.id, decision: "confirm" });
    expect(await itemOf(r.id, r.cement)).toMatchObject({
      approved: "15",
      ordered: "15",
      received: "15",
      remaining: "0",
      pendingCancellation: null,
    });
    expect((await getOrder(buyer, o.id)).order.delivery).toBe("CLOSED");
    // Rebar still open: request stays partially received until it arrives.
    expect(await statusOf(r.id)).toBe("PARTIALLY_RECEIVED");
    const rb = await order(r.id, r.rebar, "1,5");
    await receive(rb.id, "1,5");
    expect(await statusOf(r.id)).toBe("RECEIVED");
    const confirmed = await db.itemCancellation.findUniqueOrThrow({ where: { id: c.id } });
    expect(confirmed.cancelledQuantity?.toString()).toBe("25");
  });

  it("buyer asks, the requester confirms", async () => {
    const r = await approvedRequest();
    const c = await requestItemCancellation(buyer, r.id, { itemId: r.rebar, reason: "ზედმეტია" });
    await expectAppError(
      decideItemCancellation(buyer2, r.id, { cancellationId: c.id, decision: "confirm" }),
      "FORBIDDEN",
    );
    expect((await cancellationsToDecide(requester)).map((x) => x.id)).toEqual([c.id]);
    await decideItemCancellation(requester, r.id, { cancellationId: c.id, decision: "confirm" });
    expect(await itemOf(r.id, r.rebar)).toMatchObject({ approved: "0", remaining: "0" });
    // Cement alone is left to order.
    expect(await statusOf(r.id)).toBe("APPROVED");
  });

  it("rejection needs a reason and leaves everything as it was", async () => {
    const r = await approvedRequest();
    const o = await order(r.id, r.cement, "40");
    const c = await requestItemCancellation(requester, r.id, {
      itemId: r.cement,
      reason: "აღარ გვინდა",
    });
    await expectAppError(
      decideItemCancellation(buyer, r.id, { cancellationId: c.id, decision: "reject" }),
      "VALIDATION",
    );
    await decideItemCancellation(buyer, r.id, {
      cancellationId: c.id,
      decision: "reject",
      reason: "მასალა უკვე გზაშია",
    });
    expect((await itemOf(r.id, r.cement)).pendingCancellation).toBeNull();
    expect((await getOrder(receiver, o.id)).permissions.canReceive).toBe(true);
    await expectAppError(
      decideItemCancellation(buyer, r.id, { cancellationId: c.id, decision: "confirm" }),
      "CONFLICT",
    );
    // A new request is possible after a decision.
    await requestItemCancellation(requester, r.id, {
      itemId: r.cement,
      reason: "ისევ აღარ გვინდა",
    });
  });

  it("one pending per item; the asker can withdraw; outsiders cannot ask", async () => {
    const r = await approvedRequest();
    const c = await requestItemCancellation(requester, r.id, {
      itemId: r.cement,
      reason: "აღარ გვინდა",
    });
    await expectAppError(
      requestItemCancellation(buyer, r.id, { itemId: r.cement, reason: "ჩვენც" }),
      "CONFLICT",
    );
    await expectAppError(
      requestItemCancellation(receiver, r.id, { itemId: r.rebar, reason: "აღარ გვინდა" }),
      "FORBIDDEN",
    );
    await expectAppError(
      requestItemCancellation(outsider, r.id, { itemId: r.rebar, reason: "აღარ გვინდა" }),
      "FORBIDDEN",
    );
    await expectAppError(
      withdrawItemCancellation(buyer, r.id, { cancellationId: c.id }),
      "FORBIDDEN",
    );
    await withdrawItemCancellation(requester, r.id, { cancellationId: c.id });
    expect((await itemOf(r.id, r.cement)).pendingCancellation).toBeNull();
  });

  it("cancelling everything before anything arrived cancels the request", async () => {
    const r = await approvedRequest();
    for (const itemId of [r.cement, r.rebar]) {
      const c = await requestItemCancellation(requester, r.id, {
        itemId,
        reason: "პროექტი შეიცვალა",
      });
      await decideItemCancellation(buyer, r.id, { cancellationId: c.id, decision: "confirm" });
    }
    const req = await db.purchaseRequest.findUniqueOrThrow({ where: { id: r.id } });
    expect(req.status).toBe("CANCELLED");
    expect(req.cancelReason).toBe("პროექტი შეიცვალა");
  });

  it("parallel confirmations: only one wins", async () => {
    const r = await approvedRequest();
    const c = await requestItemCancellation(requester, r.id, {
      itemId: r.cement,
      reason: "აღარ გვინდა",
    });
    const results = await Promise.allSettled([
      decideItemCancellation(buyer, r.id, { cancellationId: c.id, decision: "confirm" }),
      decideItemCancellation(buyer2, r.id, { cancellationId: c.id, decision: "confirm" }),
    ]);
    expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(await db.auditEvent.count({ where: { action: "request.cancel_confirmed" } })).toBe(1);
  });
});
