import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { todayInTbilisi } from "@/lib/format";
import { normalizePrice } from "@/lib/quantity";
import type { Actor } from "@/server/access";
import { deriveRequestStatus } from "@/server/orders/progress";
import {
  cancelOrder,
  createOrder,
  getOrder,
  getOrderDraft,
  listOrders,
  orderDashboard,
  totalsByCurrency,
} from "@/server/orders/service";
import { createProject, setProjectArchived } from "@/server/projects/service";
import { correctReceiptItem, createReceipt } from "@/server/receipts/service";
import {
  approveRequest,
  cancelRequest,
  createRequest,
  getRequest,
  reopenRequest,
  requestDashboard,
  submitRequest,
} from "@/server/requests/service";
import { addMembership, createActor, createOrg, expectAppError, resetDb } from "./helpers";

let admin: Actor;
let requester: Actor;
let buyer: Actor;
let receiver: Actor;
let outsider: Actor; // buyer and receiver of another project
let otherOrgAdmin: Actor;
let projectId: string;
let supplierA: string;
let supplierB: string;

const D = (v: string | number) => new Prisma.Decimal(v);
const statusOf = async (id: string) =>
  (await db.purchaseRequest.findUniqueOrThrow({ where: { id } })).status;

/** An approved request: cement 25 bags, rebar 1.5 t. Returns ids of the request and items. */
async function approvedRequest() {
  const r = await createRequest(requester, {
    projectId,
    items: [
      { name: "ცემენტი M400", quantity: "25", unit: "ტომარა" },
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

const orderInput = (
  requestId: string,
  items: { requestItemId: string; quantity: string; unitPrice?: string }[],
  extra: Record<string, unknown> = {},
) => ({
  requestId,
  supplierId: supplierA,
  currency: "GEL",
  items: items.map((i) => ({ unitPrice: "10", ...i })),
  ...extra,
});

const orderItemsOf = async (orderId: string) =>
  db.orderItem.findMany({ where: { orderId }, include: { requestItem: true } });

beforeEach(async () => {
  await resetDb();
  const org = await createOrg();
  const otherOrg = await createOrg("სხვა");
  admin = await createActor(org.id, { admin: true, name: "ადმინი" });
  requester = await createActor(org.id, { name: "მომთხოვნი" });
  buyer = await createActor(org.id, { name: "შემსყიდველი" });
  receiver = await createActor(org.id, { name: "მიმღები" });
  outsider = await createActor(org.id, { name: "სხვა პროექტის" });
  otherOrgAdmin = await createActor(otherOrg.id, { admin: true });
  projectId = (await createProject(admin, { name: "ობიექტი 1", address: "თბილისი" })).id;
  const otherProjectId = (await createProject(admin, { name: "ობიექტი 2", address: "ბათუმი" })).id;
  await addMembership(projectId, requester.userId, ["REQUESTER"]);
  await addMembership(projectId, buyer.userId, ["BUYER"]);
  await addMembership(projectId, receiver.userId, ["RECEIVER"]);
  await addMembership(otherProjectId, outsider.userId, ["BUYER", "RECEIVER"]);
  supplierA = (await db.supplier.create({ data: { organizationId: org.id, name: "შპს ბეტონი" } }))
    .id;
  supplierB = (await db.supplier.create({ data: { organizationId: org.id, name: "შპს ლითონი" } }))
    .id;
});

afterAll(async () => {
  await db.$disconnect();
});

describe("status derivation", () => {
  const p = (approved: string, ordered: string, received: string) => ({
    approved: D(approved),
    ordered: D(ordered),
    received: D(received),
  });
  it("prefers receiving over ordering", () => {
    expect(deriveRequestStatus([p("10", "0", "0")])).toBe("APPROVED");
    expect(deriveRequestStatus([p("10", "4", "0"), p("5", "0", "0")])).toBe("PARTIALLY_ORDERED");
    expect(deriveRequestStatus([p("10", "10", "0"), p("5", "5", "0")])).toBe("ORDERED");
    expect(deriveRequestStatus([p("10", "4", "1"), p("5", "0", "0")])).toBe("PARTIALLY_RECEIVED");
    expect(deriveRequestStatus([p("10", "10", "10"), p("5", "5", "4.999")])).toBe(
      "PARTIALLY_RECEIVED",
    );
    expect(deriveRequestStatus([p("10", "10", "10"), p("5", "5", "5")])).toBe("RECEIVED");
  });

  it("parses prices with a comma or point and up to 4 decimals", () => {
    expect(normalizePrice("12,5")).toBe("12.5");
    expect(normalizePrice("0")).toBe("0");
    expect(normalizePrice("0.1234")).toBe("0.1234");
    expect(normalizePrice("1.23456")).toBeNull();
    expect(normalizePrice("-1")).toBeNull();
  });
});

describe("orders", () => {
  it("splits one request across two suppliers and tracks the status", async () => {
    const r = await approvedRequest();
    const o1 = await createOrder(
      buyer,
      orderInput(r.id, [{ requestItemId: r.cement, quantity: "25", unitPrice: "18,50" }], {
        plannedDeliveryDate: todayInTbilisi(),
      }),
    );
    expect(o1.number).toBe(1);
    expect(await statusOf(r.id)).toBe("PARTIALLY_ORDERED");

    const o2 = await createOrder(
      buyer,
      orderInput(r.id, [{ requestItemId: r.rebar, quantity: "1.5", unitPrice: "2450" }], {
        supplierId: supplierB,
        currency: "USD",
      }),
    );
    expect(o2.number).toBe(2);
    expect(await statusOf(r.id)).toBe("ORDERED");

    const detail = await getRequest(requester, r.id);
    expect(detail.items.map((i) => i.ordered)).toEqual(["25", "1.5"]);
    expect(detail.orders.map((o) => [o.supplier.name, o.currency, o.total])).toEqual([
      ["შპს ბეტონი", "GEL", "462.5"],
      ["შპს ლითონი", "USD", "3675"],
    ]);
    // Different currencies are never added together.
    expect(totalsByCurrency(detail.orders)).toEqual([
      { currency: "GEL", total: "462.5" },
      { currency: "USD", total: "3675" },
    ]);
    expect(detail.permissions.canOrder).toBe(false);
    expect(detail.events.map((e) => e.action)).toContain("order.created");
  });

  it("allows partial orders of one item over several orders, but not above the approved quantity", async () => {
    const r = await approvedRequest();
    await createOrder(buyer, orderInput(r.id, [{ requestItemId: r.cement, quantity: "10" }]));
    const err = await expectAppError(
      createOrder(
        buyer,
        orderInput(r.id, [{ requestItemId: r.cement, quantity: "15.001" }], {
          supplierId: supplierB,
        }),
      ),
      "CONFLICT",
    );
    expect(err.fieldErrors?.["items.0.quantity"]).toMatch(/მაქსიმუმ 15/);
    await createOrder(
      buyer,
      orderInput(r.id, [{ requestItemId: r.cement, quantity: "15" }], { supplierId: supplierB }),
    );
    const draft = await getOrderDraft(buyer, r.id);
    expect(draft.items.map((i) => i.available)).toEqual(["0", "1.5"]);
    expect(await statusOf(r.id)).toBe("PARTIALLY_ORDERED");
  });

  it("validates the order input", async () => {
    const r = await approvedRequest();
    await expectAppError(createOrder(buyer, orderInput(r.id, [])), "VALIDATION");
    await expectAppError(
      createOrder(
        buyer,
        orderInput(r.id, [{ requestItemId: r.cement, quantity: "1" }], {
          supplierId: "",
        }),
      ),
      "VALIDATION",
    );
    await expectAppError(
      createOrder(
        buyer,
        orderInput(r.id, [
          { requestItemId: r.cement, quantity: "1" },
          { requestItemId: r.cement, quantity: "1" },
        ]),
      ),
      "VALIDATION",
    );
    const bad = await expectAppError(
      createOrder(
        buyer,
        orderInput(r.id, [{ requestItemId: r.cement, quantity: "0", unitPrice: "-1" }]),
      ),
      "VALIDATION",
    );
    expect(bad.fieldErrors?.["items.0.quantity"]).toBeTruthy();
    expect(bad.fieldErrors?.["items.0.unitPrice"]).toBeTruthy();
    // Item of another request.
    const other = await approvedRequest();
    await expectAppError(
      createOrder(buyer, orderInput(r.id, [{ requestItemId: other.cement, quantity: "1" }])),
      "VALIDATION",
    );
    // Supplier of another organization.
    const foreign = await db.supplier.create({
      data: { organizationId: otherOrgAdmin.organizationId, name: "უცხო" },
    });
    await expectAppError(
      createOrder(
        buyer,
        orderInput(r.id, [{ requestItemId: r.cement, quantity: "1" }], { supplierId: foreign.id }),
      ),
      "VALIDATION",
    );
  });

  it("creates a new supplier by name and reuses it case-insensitively", async () => {
    const r = await approvedRequest();
    const o1 = await createOrder(
      buyer,
      orderInput(r.id, [{ requestItemId: r.cement, quantity: "5" }], {
        supplierId: "",
        supplierName: "Building Materials LLC",
      }),
    );
    const o2 = await createOrder(
      buyer,
      orderInput(r.id, [{ requestItemId: r.rebar, quantity: "1" }], {
        supplierId: "",
        supplierName: "building materials llc",
      }),
    );
    const [a, b] = await Promise.all([
      db.purchaseOrder.findUniqueOrThrow({ where: { id: o1.id } }),
      db.purchaseOrder.findUniqueOrThrow({ where: { id: o2.id } }),
    ]);
    expect(a.supplierId).toBe(b.supplierId);
  });

  it("treats % and _ in a new supplier name literally", async () => {
    const r = await approvedRequest();
    // "შპს ბეტონი" exists; "შპს %" and "შპს ბ_ტონი" must not match it.
    for (const supplierName of ["შპს %", "შპს ბ_ტონი"]) {
      const o = await createOrder(
        buyer,
        orderInput(r.id, [{ requestItemId: r.cement, quantity: "1" }], {
          supplierId: "",
          supplierName,
        }),
      );
      const order = await db.purchaseOrder.findUniqueOrThrow({
        where: { id: o.id },
        include: { supplier: true },
      });
      expect(order.supplier.name).toBe(supplierName);
    }
  });

  it("only orders approved requests", async () => {
    const r = await createRequest(requester, {
      projectId,
      items: [{ name: "ქვიშა", quantity: "3", unit: "მ³" }],
    });
    const itemId = (await db.requestItem.findFirstOrThrow({ where: { requestId: r.id } })).id;
    await expectAppError(
      createOrder(buyer, orderInput(r.id, [{ requestItemId: itemId, quantity: "1" }])),
      "CONFLICT",
    );
    await submitRequest(requester, r.id);
    await expectAppError(
      createOrder(buyer, orderInput(r.id, [{ requestItemId: itemId, quantity: "1" }])),
      "CONFLICT",
    );
  });

  it("requires the BUYER role and project membership", async () => {
    const r = await approvedRequest();
    const input = orderInput(r.id, [{ requestItemId: r.cement, quantity: "1" }]);
    await expectAppError(createOrder(requester, input), "FORBIDDEN");
    await expectAppError(createOrder(receiver, input), "FORBIDDEN");
    await expectAppError(createOrder(outsider, input), "FORBIDDEN");
    await expectAppError(createOrder(otherOrgAdmin, input), "NOT_FOUND");
    await expectAppError(getOrderDraft(receiver, r.id), "FORBIDDEN");
    const o = await createOrder(admin, input);
    await expect(getOrder(receiver, o.id)).resolves.toBeTruthy();
    await expectAppError(getOrder(outsider, o.id), "FORBIDDEN");
    await expectAppError(getOrder(otherOrgAdmin, o.id), "NOT_FOUND");
    expect((await listOrders(outsider, {})).total).toBe(0);
    expect((await listOrders(otherOrgAdmin, {})).total).toBe(0);
    expect((await listOrders(requester, {})).total).toBe(1);
  });

  it("never over-orders under concurrency", async () => {
    const r = await approvedRequest();
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, (_, i) =>
        createOrder(
          buyer,
          orderInput(r.id, [{ requestItemId: r.cement, quantity: "10" }], {
            supplierId: i % 2 ? supplierA : supplierB,
          }),
        ),
      ),
    );
    expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(2);
    const sum = await db.orderItem.aggregate({
      where: { requestItemId: r.cement },
      _sum: { quantity: true },
    });
    expect(sum._sum.quantity?.toString()).toBe("20");
    const numbers = (await db.purchaseOrder.findMany({ orderBy: { number: "asc" } })).map(
      (o) => o.number,
    );
    expect(numbers).toEqual([1, 2]);
  });

  it("cancels an order with a reason and frees its quantity", async () => {
    const r = await approvedRequest();
    const o = await createOrder(
      buyer,
      orderInput(r.id, [
        { requestItemId: r.cement, quantity: "25" },
        { requestItemId: r.rebar, quantity: "1.5" },
      ]),
    );
    expect(await statusOf(r.id)).toBe("ORDERED");
    await expectAppError(cancelOrder(buyer, o.id, ""), "VALIDATION");
    await expectAppError(cancelOrder(receiver, o.id, "მომწოდებელმა უარი თქვა"), "FORBIDDEN");
    await cancelOrder(buyer, o.id, "მომწოდებელმა უარი თქვა");
    expect(await statusOf(r.id)).toBe("APPROVED");
    await expectAppError(cancelOrder(buyer, o.id, "ხელახლა"), "CONFLICT");
    // The quantity can be ordered again elsewhere.
    await createOrder(
      buyer,
      orderInput(r.id, [{ requestItemId: r.cement, quantity: "25" }], { supplierId: supplierB }),
    );
    expect(await statusOf(r.id)).toBe("PARTIALLY_ORDERED");
    const events = await db.auditEvent.findMany({
      where: { entityId: o.id, action: "order.cancelled" },
    });
    expect(events[0]?.reason).toBe("მომწოდებელმა უარი თქვა");
  });

  it("keeps the request rules: cancel needs cancelled orders first; no reopen once ordered", async () => {
    const r = await approvedRequest();
    const o = await createOrder(
      buyer,
      orderInput(r.id, [{ requestItemId: r.cement, quantity: "5" }]),
    );
    await expectAppError(cancelRequest(buyer, r.id, "აღარ გვჭირდება"), "CONFLICT");
    await cancelOrder(buyer, o.id, "გაუქმება");
    expect(await statusOf(r.id)).toBe("APPROVED");
    // Editing would replace items that order lines still reference.
    await expectAppError(reopenRequest(requester, r.id, "ცვლილება"), "CONFLICT");
    expect((await getRequest(requester, r.id)).permissions.canReopen).toBe(false);
    await cancelRequest(buyer, r.id, "აღარ გვჭირდება");
    expect(await statusOf(r.id)).toBe("CANCELLED");
  });
});

describe("receipts", () => {
  async function orderedRequest() {
    const r = await approvedRequest();
    const o = await createOrder(
      buyer,
      orderInput(r.id, [
        { requestItemId: r.cement, quantity: "25" },
        { requestItemId: r.rebar, quantity: "1.5" },
      ]),
    );
    const items = await orderItemsOf(o.id);
    const cement = items.find((i) => i.requestItemId === r.cement)!.id;
    const rebar = items.find((i) => i.requestItemId === r.rebar)!.id;
    return { r, orderId: o.id, cement, rebar };
  }
  const today = () => todayInTbilisi();

  it("records several deliveries until fully received", async () => {
    const { r, orderId, cement, rebar } = await orderedRequest();
    await createReceipt(receiver, {
      orderId,
      receivedOn: today(),
      items: [{ orderItemId: cement, quantity: "10" }],
    });
    expect(await statusOf(r.id)).toBe("PARTIALLY_RECEIVED");
    let detail = await getOrder(receiver, orderId);
    expect(detail.order.delivery).toBe("PARTIAL");
    expect(detail.items.find((i) => i.id === cement)?.remaining).toBe("15");

    await createReceipt(receiver, {
      orderId,
      receivedOn: today(),
      note: "მეორე მანქანა",
      items: [
        { orderItemId: cement, quantity: "15" },
        { orderItemId: rebar, quantity: "1,5" },
      ],
    });
    expect(await statusOf(r.id)).toBe("RECEIVED");
    detail = await getOrder(receiver, orderId);
    expect(detail.order.delivery).toBe("RECEIVED");
    expect(detail.receipts).toHaveLength(2);
    expect(detail.permissions.canReceive).toBe(false);
    expect(detail.permissions.canCancel).toBe(false);
    const req = await getRequest(requester, r.id);
    expect(req.items.map((i) => [i.received, i.remaining])).toEqual([
      ["25", "0"],
      ["1.5", "0"],
    ]);
    expect(req.events.filter((e) => e.action === "receipt.created")).toHaveLength(2);
  });

  it("blocks receiving more than ordered", async () => {
    const { orderId, cement } = await orderedRequest();
    await createReceipt(receiver, {
      orderId,
      receivedOn: today(),
      items: [{ orderItemId: cement, quantity: "20" }],
    });
    const err = await expectAppError(
      createReceipt(receiver, {
        orderId,
        receivedOn: today(),
        items: [{ orderItemId: cement, quantity: "5.001" }],
      }),
      "CONFLICT",
    );
    expect(err.fieldErrors?.["items.0.quantity"]).toMatch(/დარჩენილია 5/);
  });

  it("validates the receipt input and access", async () => {
    const { orderId, cement } = await orderedRequest();
    const ok = { orderId, receivedOn: today(), items: [{ orderItemId: cement, quantity: "1" }] };
    await expectAppError(createReceipt(receiver, { ...ok, items: [] }), "VALIDATION");
    await expectAppError(
      createReceipt(receiver, { ...ok, receivedOn: "2999-01-01" }),
      "VALIDATION",
    );
    await expectAppError(createReceipt(receiver, { ...ok, receivedOn: "" }), "VALIDATION");
    await expectAppError(
      createReceipt(receiver, { ...ok, items: [{ orderItemId: cement, quantity: "0" }] }),
      "VALIDATION",
    );
    const other = await orderedRequest();
    await expectAppError(
      createReceipt(receiver, { ...ok, items: [{ orderItemId: other.cement, quantity: "1" }] }),
      "VALIDATION",
    );
    await expectAppError(createReceipt(buyer, ok), "FORBIDDEN");
    await expectAppError(createReceipt(requester, ok), "FORBIDDEN");
    await expectAppError(createReceipt(outsider, ok), "FORBIDDEN");
    await expectAppError(createReceipt(otherOrgAdmin, ok), "NOT_FOUND");
    await expect(createReceipt(admin, ok)).resolves.toBeTruthy();
  });

  it("does not receive on a cancelled order, and does not cancel a received one", async () => {
    const a = await orderedRequest();
    await createReceipt(receiver, {
      orderId: a.orderId,
      receivedOn: today(),
      items: [{ orderItemId: a.cement, quantity: "1" }],
    });
    await expectAppError(cancelOrder(buyer, a.orderId, "გაუქმება"), "CONFLICT");
    await expectAppError(cancelRequest(buyer, a.r.id, "გაუქმება"), "CONFLICT");

    const b = await orderedRequest();
    await cancelOrder(buyer, b.orderId, "გაუქმება");
    await expectAppError(
      createReceipt(receiver, {
        orderId: b.orderId,
        receivedOn: today(),
        items: [{ orderItemId: b.cement, quantity: "1" }],
      }),
      "CONFLICT",
    );
  });

  it("never receives more than ordered under concurrency", async () => {
    const { orderId, cement } = await orderedRequest();
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () =>
        createReceipt(receiver, {
          orderId,
          receivedOn: today(),
          items: [{ orderItemId: cement, quantity: "10" }],
        }),
      ),
    );
    expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(2);
    const sum = await db.receiptItem.aggregate({
      where: { orderItemId: cement },
      _sum: { quantity: true },
    });
    expect(sum._sum.quantity?.toString()).toBe("20");
  });

  it("does not let a receipt and an order cancellation both succeed", async () => {
    const { orderId, cement } = await orderedRequest();
    const results = await Promise.allSettled([
      createReceipt(receiver, {
        orderId,
        receivedOn: today(),
        items: [{ orderItemId: cement, quantity: "5" }],
      }),
      cancelOrder(buyer, orderId, "პარალელური გაუქმება"),
    ]);
    expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    const order = await db.purchaseOrder.findUniqueOrThrow({ where: { id: orderId } });
    const received = await db.receiptItem.count({ where: { orderItem: { orderId } } });
    expect(order.status === "CANCELLED" ? received === 0 : received === 1).toBe(true);
  });

  it("corrects a confirmed receipt with a trail and updates the status", async () => {
    const { r, orderId, cement, rebar } = await orderedRequest();
    await createReceipt(receiver, {
      orderId,
      receivedOn: today(),
      items: [
        { orderItemId: cement, quantity: "25" },
        { orderItemId: rebar, quantity: "1.5" },
      ],
    });
    expect(await statusOf(r.id)).toBe("RECEIVED");
    const entry = await db.receiptItem.findFirstOrThrow({ where: { orderItemId: cement } });

    await expectAppError(correctReceiptItem(receiver, entry.id, { quantity: "22" }), "VALIDATION");
    await expectAppError(
      correctReceiptItem(receiver, entry.id, { quantity: "25", reason: "იგივე" }),
      "VALIDATION",
    );
    await expectAppError(
      correctReceiptItem(receiver, entry.id, { quantity: "26", reason: "მეტი" }),
      "CONFLICT",
    );
    await expectAppError(
      correctReceiptItem(buyer, entry.id, { quantity: "22", reason: "3 დაზიანებული" }),
      "FORBIDDEN",
    );
    await correctReceiptItem(receiver, entry.id, { quantity: "22", reason: "3 დაზიანებული" });

    // The original row is kept; the correction is a separate negative row pointing at it.
    const original = await db.receiptItem.findUniqueOrThrow({ where: { id: entry.id } });
    expect(original.quantity.toString()).toBe("25");
    const fix = await db.receiptItem.findFirstOrThrow({ where: { correctsId: entry.id } });
    expect(fix.quantity.toString()).toBe("-3");
    expect(await statusOf(r.id)).toBe("PARTIALLY_RECEIVED");
    await expectAppError(
      correctReceiptItem(receiver, fix.id, { quantity: "0", reason: "შესწორების შესწორება" }),
      "VALIDATION",
    );

    const detail = await getOrder(receiver, orderId);
    const shown = detail.receipts.flatMap((x) => x.items).find((i) => i.id === entry.id);
    expect(shown?.effective).toBe("22");
    expect(detail.items.find((i) => i.id === cement)?.received).toBe("22");
    // The missing 3 can be received later.
    await createReceipt(receiver, {
      orderId,
      receivedOn: today(),
      items: [{ orderItemId: cement, quantity: "3" }],
    });
    expect(await statusOf(r.id)).toBe("RECEIVED");

    const ev = await db.auditEvent.findFirstOrThrow({ where: { action: "receipt.corrected" } });
    expect(ev.reason).toBe("3 დაზიანებული");
    expect(ev.changes).toMatchObject({ from: "25", to: "22", delta: "-3" });
  });

  it("allows cancelling after a receipt was corrected to zero", async () => {
    const { r, orderId, cement } = await orderedRequest();
    await createReceipt(receiver, {
      orderId,
      receivedOn: today(),
      items: [{ orderItemId: cement, quantity: "5" }],
    });
    const entry = await db.receiptItem.findFirstOrThrow({ where: { orderItemId: cement } });
    await correctReceiptItem(receiver, entry.id, { quantity: "0", reason: "შეცდომით ჩაიწერა" });
    expect(await statusOf(r.id)).toBe("ORDERED");
    await cancelOrder(buyer, orderId, "მომწოდებელმა უარი თქვა");
    await cancelRequest(buyer, r.id, "აღარ გვჭირდება");
    expect(await statusOf(r.id)).toBe("CANCELLED");
  });

  it("makes orders of archived projects read-only", async () => {
    const { orderId, cement } = await orderedRequest();
    await setProjectArchived(admin, projectId, true);
    await expectAppError(
      createReceipt(receiver, {
        orderId,
        receivedOn: today(),
        items: [{ orderItemId: cement, quantity: "1" }],
      }),
      "CONFLICT",
    );
    await expectAppError(cancelOrder(buyer, orderId, "არქივი"), "CONFLICT");
    const detail = await getOrder(receiver, orderId);
    expect(detail.permissions).toEqual({ canReceive: false, canCancel: false, canCorrect: false });
  });
});

describe("order list filters", () => {
  it("filters by status, supplier, number and material", async () => {
    const r = await approvedRequest();
    const a = await createOrder(
      buyer,
      orderInput(r.id, [{ requestItemId: r.cement, quantity: "5" }]),
    );
    const b = await createOrder(
      buyer,
      orderInput(r.id, [{ requestItemId: r.rebar, quantity: "1" }], { supplierId: supplierB }),
    );
    await cancelOrder(buyer, a.id, "გაუქმება");
    const ids = async (f: Record<string, unknown>) =>
      (await listOrders(admin, f)).rows.map((o) => o.id);
    expect(await ids({ status: "ACTIVE" })).toEqual([b.id]);
    expect(await ids({ supplier: supplierA })).toEqual([a.id]);
    expect(await ids({ q: "არმატ" })).toEqual([b.id]);
    expect(await ids({ q: "№0001" })).toEqual([a.id]);
    expect(await ids({ project: projectId })).toHaveLength(2);
    expect(await ids({ status: "NOPE" })).toHaveLength(2);
    expect(await ids({ to: "2020-01-01" })).toHaveLength(0);
    const rows = (await listOrders(admin, {})).rows;
    expect(rows.find((o) => o.id === a.id)?.delivery).toBe("CANCELLED");
    expect(rows.find((o) => o.id === b.id)?.delivery).toBe("AWAITING");
  });
});

describe("dashboard and delivery filter", () => {
  it("lists overdue and open orders, and filters by delivery progress", async () => {
    const r = await approvedRequest();
    // Planned yesterday → overdue; the server accepts past planned dates (set by the buyer).
    const late = await createOrder(
      buyer,
      orderInput(r.id, [{ requestItemId: r.cement, quantity: "25" }], {
        plannedDeliveryDate: "2020-01-15",
      }),
    );
    const soon = await createOrder(
      buyer,
      orderInput(r.id, [{ requestItemId: r.rebar, quantity: "1.5" }], {
        supplierId: supplierB,
        plannedDeliveryDate: "2099-01-01",
      }),
    );
    let dash = await orderDashboard(receiver);
    expect(dash.overdueCount).toBe(1);
    expect(dash.overdue.map((o) => o.id)).toEqual([late.id]);
    expect(dash.toReceive.map((o) => o.id)).toEqual([late.id, soon.id]);

    // Fully receiving the late order removes it from both lists.
    const item = (await orderItemsOf(late.id))[0]!;
    await createReceipt(receiver, {
      orderId: late.id,
      receivedOn: todayInTbilisi(),
      items: [{ orderItemId: item.id, quantity: "25" }],
    });
    dash = await orderDashboard(receiver);
    expect(dash.overdueCount).toBe(0);
    expect(dash.toReceiveCount).toBe(1);

    const ids = async (delivery: string) =>
      (await listOrders(admin, { delivery })).rows.map((o) => o.id);
    expect(await ids("open")).toEqual([soon.id]);
    expect(await ids("received")).toEqual([late.id]);
    expect(await ids("overdue")).toEqual([]);
    await cancelOrder(buyer, soon.id, "გაუქმება");
    expect(await ids("cancelled")).toEqual([soon.id]);
    expect(await ids("open")).toEqual([]);

    // The action link is offered only to receivers of the project.
    const open = await createOrder(
      buyer,
      orderInput(r.id, [{ requestItemId: r.rebar, quantity: "1" }], { supplierId: supplierB }),
    );
    expect((await orderDashboard(receiver)).toReceive[0]).toMatchObject({
      id: open.id,
      canReceive: true,
    });
    expect((await orderDashboard(requester)).toReceive[0]?.canReceive).toBe(false);
    // Archived projects leave the dashboard (nothing can be received there), not the list.
    await setProjectArchived(admin, projectId, true);
    expect((await orderDashboard(receiver)).toReceiveCount).toBe(0);
    expect(await ids("open")).toEqual([open.id]);

    // Other projects and organizations see nothing.
    expect((await orderDashboard(outsider)).toReceiveCount).toBe(0);
    expect((await orderDashboard(otherOrgAdmin)).toReceiveCount).toBe(0);
  });

  it("counts approved requests waiting to be ordered for buyers only", async () => {
    await approvedRequest();
    expect((await requestDashboard(buyer)).toOrder).toBe(1);
    expect((await requestDashboard(requester)).toOrder).toBe(0);
    expect((await requestDashboard(admin)).toOrder).toBe(1);
  });
});
