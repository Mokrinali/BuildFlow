// RS.ge waybill link: settings, demo mode, picking and checking waybills, SOAP parsing.
// No test reaches the real RS.ge service: LIVE uses an injected fake client or a fake fetch.
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { todayInTbilisi } from "@/lib/format";
import type { Actor } from "@/server/access";
import { createOrder } from "@/server/orders/service";
import { createProject } from "@/server/projects/service";
import { createReceipt, setReceiptWaybill } from "@/server/receipts/service";
import { approveRequest, createRequest, submitRequest } from "@/server/requests/service";
import { demoWaybills, liveClient, type RsClient } from "@/server/rs/client";
import { decryptSecret, encryptSecret } from "@/server/rs/crypto";
import {
  applyRsWaybill,
  getRsSettings,
  listReceiptWaybills,
  saveRsSettings,
  setLiveClientFactoryForTests,
  testRsConnection,
  verifyReceiptWaybill,
} from "@/server/rs/service";
import { buildEnvelope, collectWaybills, parseXml, type RsWaybill } from "@/server/rs/soap";
import { addMembership, createActor, createOrg, expectAppError, resetDb } from "./helpers";

const TIN = "204567890";

function at<T>(a: T[], i: number): T {
  const v = a[i];
  if (v === undefined) throw new Error(`no element ${i}`);
  return v;
}

let orgId: string;
let admin: Actor;
let buyer: Actor;
let receiver: Actor;
let requester: Actor;
let projectId: string;
let supplierId: string;

/** Order for 10 bags with one delivery of 4 (no waybill yet). Returns the receipt id. */
async function delivery() {
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
  const rec = await createReceipt(receiver, {
    orderId: o.id,
    receivedOn: todayInTbilisi(),
    items: [{ orderItemId: line.id, quantity: "4" }],
  });
  return { receiptId: rec.id, orderId: o.id };
}

beforeEach(async () => {
  await resetDb();
  const org = await createOrg();
  orgId = org.id;
  admin = await createActor(org.id, { admin: true });
  requester = await createActor(org.id, { name: "მომთხოვნი" });
  buyer = await createActor(org.id, { name: "შემსყიდველი" });
  receiver = await createActor(org.id, { name: "მიმღები" });
  projectId = (await createProject(admin, { name: "ობიექტი", address: "თბილისი" })).id;
  await addMembership(projectId, requester.userId, ["REQUESTER"]);
  await addMembership(projectId, buyer.userId, ["BUYER"]);
  await addMembership(projectId, receiver.userId, ["RECEIVER"]);
  supplierId = (
    await db.supplier.create({ data: { organizationId: org.id, name: "შპს ბეტონი", taxId: TIN } })
  ).id;
});

afterEach(() => {
  setLiveClientFactoryForTests(() => {
    throw new Error("live RS.ge client used without a fake");
  });
});

afterAll(async () => {
  await db.$disconnect();
});

describe("settings", () => {
  it("is off by default; only admins change it; the password is stored encrypted", async () => {
    expect((await getRsSettings(admin)).mode).toBe("OFF");
    await expectAppError(getRsSettings(buyer), "FORBIDDEN");
    await expectAppError(saveRsSettings(buyer, { mode: "DEMO" }), "FORBIDDEN");

    await expectAppError(saveRsSettings(admin, { mode: "LIVE" }), "VALIDATION");
    await saveRsSettings(admin, {
      mode: "LIVE",
      serviceUser: "app:206322102",
      password: "s3cret!",
    });
    const org = await db.organization.findUniqueOrThrow({ where: { id: orgId } });
    expect(org.rsServicePassword).not.toContain("s3cret");
    expect(decryptSecret(org.rsServicePassword!)).toBe("s3cret!");
    expect(await getRsSettings(admin)).toEqual({
      mode: "LIVE",
      serviceUser: "app:206322102",
      hasPassword: true,
    });

    // An empty password keeps the stored one; the history never holds the password.
    await saveRsSettings(admin, { mode: "LIVE", serviceUser: "app:206322102", password: "" });
    expect(
      decryptSecret(
        (await db.organization.findUniqueOrThrow({ where: { id: orgId } })).rsServicePassword!,
      ),
    ).toBe("s3cret!");
    const events = await db.auditEvent.findMany({ where: { action: "org.rs_settings_changed" } });
    expect(events).toHaveLength(2);
    expect(JSON.stringify(events.map((e) => [e.changes, e.reason]))).not.toContain("s3cret");
  });

  it("encryption round-trips and rejects tampering", () => {
    const enc = encryptSecret("პაროლი-1");
    expect(decryptSecret(enc)).toBe("პაროლი-1");
    const parts = enc.split(":");
    const flipped = Buffer.from(at(parts, 3), "base64");
    flipped.writeUInt8(flipped.readUInt8(0) ^ 1, 0);
    parts[3] = flipped.toString("base64");
    expect(decryptSecret(parts.join(":"))).toBeNull();
  });
});

describe("demo mode", () => {
  it("lists made-up waybills of the supplier and puts the picked one on the delivery", async () => {
    const d = await delivery();
    await expectAppError(listReceiptWaybills(receiver, d.receiptId), "CONFLICT"); // off
    await saveRsSettings(admin, { mode: "DEMO" });
    expect(await testRsConnection(admin)).toContain("სადემონსტრაციო");

    const list = await listReceiptWaybills(receiver, d.receiptId);
    expect(list.length).toBeGreaterThan(0);
    expect(list.every((w) => w.sellerName === "შპს ბეტონი")).toBe(true);
    // Newest first, nothing older than 14 days before the order.
    expect(at(list, 0).date).toBe(todayInTbilisi());

    await expectAppError(listReceiptWaybills(requester, d.receiptId), "FORBIDDEN");
    await applyRsWaybill(receiver, d.receiptId, at(list, 1).id);
    const rec = await db.receipt.findUniqueOrThrow({ where: { id: d.receiptId } });
    expect(rec.waybillNumber).toBe(at(list, 1).number);
    expect(rec.waybillDate?.toISOString().slice(0, 10)).toBe(at(list, 1).date);
    expect(rec.rsWaybillId).toBe(at(list, 1).id);
    expect(rec.rsCheckedAt).not.toBeNull();
    const ev = await db.auditEvent.findFirstOrThrow({ where: { action: "receipt.waybill_set" } });
    expect(ev.changes).toMatchObject({ source: "rs.ge", to: at(list, 1).number });

    // Shown as used on the next delivery of the same supplier; no second pick on this one.
    await expectAppError(applyRsWaybill(receiver, d.receiptId, at(list, 0).id), "CONFLICT");
    const d2 = await delivery();
    const again = await listReceiptWaybills(receiver, d2.receiptId);
    expect(again.find((w) => w.id === at(list, 1).id)?.usedOn.map((o) => o.id)).toEqual([
      d.orderId,
    ]);
  });

  it("a waybill id that RS.ge did not return is refused", async () => {
    const d = await delivery();
    await saveRsSettings(admin, { mode: "DEMO" });
    await expectAppError(applyRsWaybill(receiver, d.receiptId, "demo-0000000001"), "CONFLICT");
  });

  it("needs the supplier's identification code", async () => {
    const d = await delivery();
    await db.supplier.update({ where: { id: supplierId }, data: { taxId: null } });
    await saveRsSettings(admin, { mode: "DEMO" });
    await expectAppError(listReceiptWaybills(receiver, d.receiptId), "VALIDATION");
  });

  it("checks a hand-entered waybill; a manual change clears the check", async () => {
    const d = await delivery();
    await saveRsSettings(admin, { mode: "DEMO" });
    const real = at(demoWaybills(TIN), 2);
    await setReceiptWaybill(receiver, d.receiptId, { waybillNumber: "999", waybillDate: "" });
    await expectAppError(verifyReceiptWaybill(receiver, d.receiptId), "VALIDATION");

    await setReceiptWaybill(receiver, d.receiptId, {
      waybillNumber: real.number,
      waybillDate: "",
      reason: "სწორი ნომერი",
    });
    expect(await verifyReceiptWaybill(buyer, d.receiptId)).toContain("მოიძებნა");
    let rec = await db.receipt.findUniqueOrThrow({ where: { id: d.receiptId } });
    expect(rec.rsCheckedAt).not.toBeNull();
    expect(rec.waybillDate?.toISOString().slice(0, 10)).toBe(real.date); // filled from RS.ge
    expect(await db.auditEvent.count({ where: { action: "receipt.waybill_verified" } })).toBe(1);

    await setReceiptWaybill(receiver, d.receiptId, {
      waybillNumber: "12345",
      waybillDate: "",
      reason: "შეცდომა",
    });
    rec = await db.receipt.findUniqueOrThrow({ where: { id: d.receiptId } });
    expect(rec.rsCheckedAt).toBeNull();
    expect(rec.rsWaybillId).toBeNull();
  });
});

describe("live mode (fake client)", () => {
  const waybill = (over: Partial<RsWaybill>): RsWaybill => ({
    id: "77",
    number: "0412345678",
    sellerTin: TIN,
    sellerName: "შპს ბეტონი",
    date: todayInTbilisi(),
    amount: "185.00",
    status: "ACTIVE",
    ...over,
  });

  function fake(list: RsWaybill[], ok = true): RsClient {
    return {
      checkUser: async () => ok,
      buyerWaybills: async () => list,
      waybillByNumber: async (n) => list.find((w) => w.number === n) ?? null,
    };
  }

  beforeEach(async () => {
    await saveRsSettings(admin, { mode: "LIVE", serviceUser: "app:1", password: "pw" });
  });

  it("passes the decrypted credentials and filters out unusable waybills", async () => {
    let creds: string[] = [];
    setLiveClientFactoryForTests((su, sp) => {
      creds = [su, sp];
      return fake([
        waybill({}),
        waybill({ id: "78", number: "2", status: "DELETED" }),
        waybill({ id: "79", number: "3", status: "SAVED" }),
        waybill({ id: "80", number: "4", sellerTin: "111111111" }),
      ]);
    });
    const d = await delivery();
    const list = await listReceiptWaybills(receiver, d.receiptId);
    expect(creds).toEqual(["app:1", "pw"]);
    expect(list.map((w) => w.number)).toEqual(["0412345678"]);
  });

  it("verification reports another supplier and a cancelled waybill", async () => {
    setLiveClientFactoryForTests(() =>
      fake([
        waybill({ number: "100", sellerTin: "999999999" }),
        waybill({ number: "200", status: "DEACTIVATED" }),
      ]),
    );
    const d = await delivery();
    await setReceiptWaybill(receiver, d.receiptId, { waybillNumber: "100", waybillDate: "" });
    await expect(verifyReceiptWaybill(receiver, d.receiptId)).rejects.toThrow("999999999");
    await setReceiptWaybill(receiver, d.receiptId, {
      waybillNumber: "200",
      waybillDate: "",
      reason: "სხვა",
    });
    await expect(verifyReceiptWaybill(receiver, d.receiptId)).rejects.toThrow("გაუქმებული");
  });

  it("wrong credentials and an unreachable service give Georgian messages", async () => {
    setLiveClientFactoryForTests(() => fake([], false));
    await expect(testRsConnection(admin)).rejects.toThrow("არ მიიღო");

    setLiveClientFactoryForTests((su, sp) =>
      liveClient(su, sp, async () => {
        throw new TypeError("fetch failed");
      }),
    );
    await expect(testRsConnection(admin)).rejects.toThrow("დაკავშირება ვერ მოხერხდა");
  });
});

describe("SOAP layer", () => {
  it("builds an escaped envelope and leaves unset parameters out", () => {
    const xml = buildEnvelope("get_buyer_waybills", [
      ["su", "a<b>&"],
      ["sp", "x"],
      ["seller_tin", undefined],
    ]);
    expect(xml).toContain('<get_buyer_waybills xmlns="http://tempuri.org/">');
    expect(xml).toContain("<su>a&#60;b&#62;&#38;</su>");
    expect(xml).not.toContain("seller_tin");
  });

  it("reads waybills from a response regardless of element case", () => {
    const body = parseXml(`<?xml version="1.0" encoding="utf-8"?>
      <soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>
      <get_buyer_waybillsResponse xmlns="http://tempuri.org/"><get_buyer_waybillsResult>
        <WAYBILL_LIST>
          <WAYBILL><ID>501</ID><WAYBILL_NUMBER>0412345678</WAYBILL_NUMBER><SELLER_TIN>${TIN}</SELLER_TIN>
            <SELLER_NAME>შპს ბეტონი</SELLER_NAME><FULL_AMOUNT>1250,5</FULL_AMOUNT>
            <BEGIN_DATE>2026-11-18T09:30:00</BEGIN_DATE><STATUS>1</STATUS></WAYBILL>
          <waybill><id>502</id><waybill_number>0412345679</waybill_number><status>-1</status>
            <create_date>0001-01-01T00:00:00</create_date></waybill>
        </WAYBILL_LIST>
      </get_buyer_waybillsResult></get_buyer_waybillsResponse></soap:Body></soap:Envelope>`);
    expect(collectWaybills(body)).toEqual([
      {
        id: "501",
        number: "0412345678",
        sellerTin: TIN,
        sellerName: "შპს ბეტონი",
        date: "2026-11-18",
        amount: "1250.5",
        status: "ACTIVE",
      },
      {
        id: "502",
        number: "0412345679",
        sellerTin: "",
        sellerName: "",
        date: null,
        amount: null,
        status: "DELETED",
      },
    ]);
  });

  it("live client sends the documented operation and reads the result", async () => {
    let sent = "";
    let action = "";
    const client = liveClient("app:1", "pw", async (_url, init) => {
      sent = String(init?.body);
      action = String((init?.headers as Record<string, string>).SOAPAction);
      return new Response(
        `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>
        <chek_service_userResponse xmlns="http://tempuri.org/">
        <chek_service_userResult>true</chek_service_userResult><un_id>1</un_id><s_user_id>2</s_user_id>
        </chek_service_userResponse></soap:Body></soap:Envelope>`,
        { status: 200 },
      );
    });
    expect(await client.checkUser()).toBe(true);
    expect(action).toBe('"http://tempuri.org/chek_service_user"');
    expect(sent).toContain("<su>app:1</su><sp>pw</sp>");
  });
});
