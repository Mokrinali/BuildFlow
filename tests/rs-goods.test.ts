// RS.ge waybill goods: filling a delivery from a waybill, comparing a delivery with its waybill,
// changing matches and remembering them. LIVE uses an injected fake client (never the real RS.ge).
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { todayInTbilisi } from "@/lib/format";
import type { Actor } from "@/server/access";
import { createOrder, getOrder } from "@/server/orders/service";
import { createProject } from "@/server/projects/service";
import { createReceipt, setReceiptWaybill } from "@/server/receipts/service";
import { approveRequest, createRequest, submitRequest } from "@/server/requests/service";
import { demoGoods, type RsClient } from "@/server/rs/client";
import {
  createReceiptFromWaybill,
  listOrderWaybills,
  loadReceiptWaybillGoods,
  previewWaybillGoods,
  setWaybillLineMatch,
} from "@/server/rs/goods";
import { applyRsWaybill, saveRsSettings, setLiveClientFactoryForTests } from "@/server/rs/service";
import { collectGoods, parseXml, type RsGoods, type RsWaybill } from "@/server/rs/soap";
import { addMembership, createActor, createOrg, expectAppError, resetDb } from "./helpers";

const TIN = "204567890";

let admin: Actor;
let buyer: Actor;
let receiver: Actor;
let requester: Actor;
let projectId: string;
let supplierId: string;

const WAYBILL: RsWaybill = {
  id: "9001",
  number: "0412345678",
  sellerTin: TIN,
  sellerName: "შპს მეტალი",
  date: todayInTbilisi(),
  amount: "4000.00",
  status: "ACTIVE",
};

const GOODS: RsGoods[] = [
  { name: "არმატურა A500C Ø12", unit: "კგ", quantity: "2000", unitPrice: "1.9" },
  { name: "ცემენტი M400", unit: "ტომარა", quantity: "10", unitPrice: "18" },
  { name: "წვრილი ფრაქცია", unit: "მანქანა", quantity: "1", unitPrice: "250" },
];

let goods: RsGoods[] = GOODS;
function fakeClient(): RsClient {
  return {
    checkUser: async () => true,
    buyerWaybills: async () => [WAYBILL],
    waybillByNumber: async (n) => (n === WAYBILL.number ? WAYBILL : null),
    waybillGoods: async (w) => (w.id === WAYBILL.id ? goods : []),
  };
}

/** Approved request and an order: rebar Ø12 2 t, cement 10 bags, sand 8 m³. */
async function order() {
  const r = await createRequest(requester, {
    projectId,
    items: [
      { name: "არმატურა", spec: "Ø12", quantity: "2", unit: "ტონა" },
      { name: "ცემენტი", quantity: "10", unit: "ტომარა" },
      { name: "ქვიშა", quantity: "8", unit: "მ³" },
    ],
  });
  await submitRequest(requester, r.id);
  await approveRequest(buyer, r.id);
  const items = await db.requestItem.findMany({
    where: { requestId: r.id },
    orderBy: { position: "asc" },
  });
  const o = await createOrder(buyer, {
    requestId: r.id,
    supplierId,
    currency: "GEL",
    items: items.map((it) => ({
      requestItemId: it.id,
      quantity: it.quantity.toString(),
      unitPrice: "10",
    })),
  });
  const lines = await db.orderItem.findMany({
    where: { orderId: o.id },
    orderBy: { requestItem: { position: "asc" } },
  });
  const [rebar, cement, sand] = lines.map((l) => l.id) as [string, string, string];
  return { orderId: o.id, requestId: r.id, rebar, cement, sand };
}

beforeEach(async () => {
  await resetDb();
  const org = await createOrg();
  admin = await createActor(org.id, { admin: true });
  requester = await createActor(org.id, { name: "მომთხოვნი" });
  buyer = await createActor(org.id, { name: "შემსყიდველი" });
  receiver = await createActor(org.id, { name: "მიმღები" });
  projectId = (await createProject(admin, { name: "ობიექტი", address: "თბილისი" })).id;
  await addMembership(projectId, requester.userId, ["REQUESTER"]);
  await addMembership(projectId, buyer.userId, ["BUYER"]);
  await addMembership(projectId, receiver.userId, ["RECEIVER"]);
  supplierId = (
    await db.supplier.create({ data: { organizationId: org.id, name: "შპს მეტალი", taxId: TIN } })
  ).id;
  goods = GOODS;
  await saveRsSettings(admin, { mode: "LIVE", serviceUser: "app:1", password: "pw" });
  setLiveClientFactoryForTests(fakeClient);
});

afterEach(() => {
  setLiveClientFactoryForTests(() => {
    throw new Error("live RS.ge client used without a fake");
  });
});

afterAll(async () => {
  await db.$disconnect();
});

describe("fill a delivery from a waybill", () => {
  it("suggests matches, records the delivery with the waybill and compares it", async () => {
    const o = await order();
    expect((await listOrderWaybills(receiver, o.orderId)).map((w) => w.id)).toEqual(["9001"]);
    await expectAppError(listOrderWaybills(buyer, o.orderId), "FORBIDDEN"); // receivers record

    const p = await previewWaybillGoods(receiver, o.orderId, "9001");
    expect(p.waybill).toEqual({ id: "9001", number: WAYBILL.number, date: WAYBILL.date });
    expect(p.lines.map((l) => [l.orderItemId, l.factor])).toEqual([
      [o.rebar, "0.001"],
      [o.cement, "1"],
      [null, null], // "წვრილი ფრაქცია" does not look like "ქვიშა"
    ]);

    // The receiver matches the truck of sand by hand (1 truck = 8 m³) and counts less rebar.
    const matches = p.lines.map((l) => ({
      position: l.position,
      orderItemId: l.position === 2 ? o.sand : l.orderItemId,
      factor: l.position === 2 ? "8" : l.factor,
    }));
    const rec = await createReceiptFromWaybill(receiver, o.orderId, {
      rsWaybillId: "9001",
      matches,
      receivedOn: todayInTbilisi(),
      items: [
        { orderItemId: o.rebar, quantity: "1.8" },
        { orderItemId: o.cement, quantity: "10" },
        { orderItemId: o.sand, quantity: "8" },
      ],
      // Ignored: the waybill comes from RS.ge, not from the form.
      waybillNumber: "1",
    });
    const saved = await db.receipt.findUniqueOrThrow({
      where: { id: rec.id },
      include: { waybillLines: { orderBy: { position: "asc" } } },
    });
    expect(saved.waybillNumber).toBe(WAYBILL.number);
    expect(saved.rsWaybillId).toBe("9001");
    expect(saved.rsCheckedAt).not.toBeNull();
    expect(saved.waybillLines.map((l) => [l.name, l.quantity.toString(), l.orderItemId])).toEqual([
      ["არმატურა A500C Ø12", "2000", o.rebar],
      ["ცემენტი M400", "10", o.cement],
      ["წვრილი ფრაქცია", "1", o.sand],
    ]);
    const ev = await db.auditEvent.findFirstOrThrow({ where: { action: "receipt.created" } });
    expect(ev.changes).toMatchObject({ source: "rs.ge", waybillLines: 3 });

    const view = await getOrder(buyer, o.orderId);
    const cmp = view.receipts[0]!.waybillCompare!;
    expect(cmp.mismatch).toBe(true);
    expect(cmp.rows.map((r) => [r.name, r.waybill, r.received, r.diff])).toEqual([
      ["არმატურა", "2", "1.8", "-0.2"],
      ["ცემენტი", "10", "10", "0"],
      ["ქვიშა", "8", "8", "0"],
    ]);
  });

  it("still blocks over-receipt and refuses lines of another order", async () => {
    const o = await order();
    const other = await order();
    const base = { rsWaybillId: "9001", receivedOn: todayInTbilisi() };
    await expectAppError(
      createReceiptFromWaybill(receiver, o.orderId, {
        ...base,
        matches: [{ position: 0, orderItemId: o.rebar, factor: "0.001" }],
        items: [{ orderItemId: o.rebar, quantity: "3" }],
      }),
      "CONFLICT",
    );
    await expectAppError(
      createReceiptFromWaybill(receiver, o.orderId, {
        ...base,
        matches: [{ position: 0, orderItemId: other.rebar, factor: "1" }],
        items: [{ orderItemId: o.rebar, quantity: "1" }],
      }),
      "VALIDATION",
    );
    await expectAppError(
      createReceiptFromWaybill(receiver, o.orderId, {
        ...base,
        matches: [{ position: 0, orderItemId: o.rebar, factor: "0" }],
        items: [{ orderItemId: o.rebar, quantity: "1" }],
      }),
      "VALIDATION",
    );
    await expectAppError(
      createReceiptFromWaybill(receiver, o.orderId, { ...base, rsWaybillId: "1", matches: [] }),
      "CONFLICT", // not one of the supplier's waybills
    );
    expect(await db.receipt.count()).toBe(0);
  });

  it("remembers a match made by hand for this supplier's next waybill", async () => {
    const o = await order();
    const rec = await createReceiptFromWaybill(receiver, o.orderId, {
      rsWaybillId: "9001",
      matches: [],
      receivedOn: todayInTbilisi(),
      items: [{ orderItemId: o.cement, quantity: "10" }],
    });
    const sandLine = await db.receiptWaybillLine.findFirstOrThrow({
      where: { receiptId: rec.id, position: 2 },
    });
    await expectAppError(
      setWaybillLineMatch(requester, sandLine.id, { orderItemId: o.sand, factor: "8" }),
      "FORBIDDEN",
    );
    await expectAppError(
      setWaybillLineMatch(buyer, sandLine.id, { orderItemId: o.sand, factor: "x" }),
      "VALIDATION",
    );
    await setWaybillLineMatch(buyer, sandLine.id, { orderItemId: o.sand, factor: "8" });
    await expectAppError(
      setWaybillLineMatch(buyer, sandLine.id, { orderItemId: o.sand, factor: "8,0" }),
      "VALIDATION", // nothing changed
    );
    const ev = await db.auditEvent.findFirstOrThrow({
      where: { action: "receipt.waybill_match_changed" },
    });
    expect(ev.changes).toMatchObject({
      goods: "წვრილი ფრაქცია",
      from: { orderItemId: null, factor: null },
      to: { orderItemId: o.sand, factor: "8" },
    });

    const next = await order();
    const p = await previewWaybillGoods(receiver, next.orderId, "9001");
    expect(p.lines[2]).toMatchObject({ orderItemId: next.sand, factor: "8" });
  });
});

describe("compare an existing delivery with its waybill", () => {
  it("loads the goods after a pick; a manual waybill change drops them", async () => {
    const o = await order();
    const rec = await createReceipt(receiver, {
      orderId: o.orderId,
      receivedOn: todayInTbilisi(),
      items: [{ orderItemId: o.rebar, quantity: "2" }],
    });
    await expectAppError(loadReceiptWaybillGoods(receiver, rec.id), "VALIDATION"); // no RS waybill
    await applyRsWaybill(receiver, rec.id, "9001");
    expect(await loadReceiptWaybillGoods(buyer, rec.id)).toBe(3);
    expect(await db.auditEvent.count({ where: { action: "receipt.waybill_goods_loaded" } })).toBe(
      1,
    );

    const cmp = (await getOrder(receiver, o.orderId)).receipts[0]!.waybillCompare!;
    // Rebar matches (2000 kg = 2 t); cement is on the waybill but was not received here.
    expect(cmp.rows.map((r) => [r.name, r.waybill, r.received, r.ok])).toEqual([
      ["არმატურა", "2", "2", true],
      ["ცემენტი", "10", "0", false],
    ]);
    expect(cmp.unmatched).toBe(1);

    // Loading again replaces the lines (no duplicates).
    expect(await loadReceiptWaybillGoods(receiver, rec.id)).toBe(3);
    expect(await db.receiptWaybillLine.count({ where: { receiptId: rec.id } })).toBe(3);

    await setReceiptWaybill(receiver, rec.id, {
      waybillNumber: "555",
      waybillDate: "",
      reason: "სხვა ზედნადები",
    });
    expect(await db.receiptWaybillLine.count({ where: { receiptId: rec.id } })).toBe(0);
    expect((await getOrder(receiver, o.orderId)).receipts[0]!.waybillCompare).toBeNull();
  });

  it("an empty waybill gives a Georgian message", async () => {
    goods = [];
    const o = await order();
    await expect(previewWaybillGoods(receiver, o.orderId, "9001")).rejects.toThrow(
      "საქონლის ხაზები არ აქვს",
    );
  });
});

describe("demo goods and SOAP parsing", () => {
  it("demo goods look like the order, with tonnes written in kilograms", () => {
    const out = demoGoods("0000000001", [
      { name: "არმატურა Ø12", unit: "ტონა", quantity: "2", unitPrice: "1900" },
      { name: "ცემენტი", unit: "ტომარა", quantity: "10", unitPrice: "18" },
    ]);
    expect(out.map((g) => [g.name, g.unit])).toEqual([
      ["არმატურა Ø12", "კგ"],
      ["ცემენტი", "ტომარა"],
    ]);
    expect(["2000", "1800"]).toContain(out[0]!.quantity);
    expect(demoGoods("0000000001", [])).toEqual([]);
  });

  it("reads goods lines with unit text or unit code", () => {
    const body = parseXml(`<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
      <soap:Body><get_waybillResponse xmlns="http://tempuri.org/"><get_waybillResult>
      <WAYBILL><ID>9001</ID><WAYBILL_NUMBER>0412345678</WAYBILL_NUMBER>
        <GOODS_LIST>
          <GOODS><W_NAME>არმატურა Ø12</W_NAME><UNIT_ID>2</UNIT_ID><UNIT_TXT></UNIT_TXT>
            <QUANTITY>2000,5</QUANTITY><PRICE>1.9</PRICE></GOODS>
          <goods><w_name>ფრაქცია</w_name><unit_id>99</unit_id><unit_txt>მანქანა</unit_txt>
            <quantity>1</quantity></goods>
          <GOODS><W_NAME>ცარიელი რაოდენობა</W_NAME><QUANTITY></QUANTITY></GOODS>
        </GOODS_LIST>
      </WAYBILL></get_waybillResult></get_waybillResponse></soap:Body></soap:Envelope>`);
    expect(collectGoods(body)).toEqual([
      { name: "არმატურა Ø12", unit: "კგ", quantity: "2000.5", unitPrice: "1.9" },
      { name: "ფრაქცია", unit: "მანქანა", quantity: "1", unitPrice: null },
    ]);
  });
});
