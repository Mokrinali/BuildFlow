import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { todayInTbilisi } from "@/lib/format";
import { normalizeQuantity } from "@/lib/quantity";
import type { Actor } from "@/server/access";
import { createProject, setProjectArchived } from "@/server/projects/service";
import {
  approveRequest,
  cancelRequest,
  createRequest,
  getRequest,
  listRequests,
  rejectRequest,
  reopenRequest,
  requestDashboard,
  returnToDraft,
  submitRequest,
  updateRequest,
  withdrawRequest,
} from "@/server/requests/service";
import { addMembership, createActor, createOrg, expectAppError, resetDb } from "./helpers";

let admin: Actor;
let requester: Actor;
let buyer: Actor;
let receiver: Actor;
let outsider: Actor; // member of another project only
let otherOrgAdmin: Actor;
let projectId: string;
let otherProjectId: string;

const items = [
  { name: "ცემენტი M400", quantity: "25", unit: "ტომარა" },
  { name: "არმატურა", spec: "Ø12", quantity: "1,5", unit: "ტონა", note: "A500C" },
];
const newRequest = (extra: Record<string, unknown> = {}) => ({
  projectId,
  priority: "HIGH",
  note: "სასწრაფოდ",
  items,
  ...extra,
});
const statusOf = async (id: string) =>
  (await db.purchaseRequest.findUniqueOrThrow({ where: { id } })).status;
const actionsOf = async (id: string) =>
  (
    await db.auditEvent.findMany({
      where: { entityType: "PurchaseRequest", entityId: id },
      orderBy: { seq: "asc" },
    })
  ).map((e) => e.action);

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
  otherProjectId = (await createProject(admin, { name: "ობიექტი 2", address: "ბათუმი" })).id;
  await addMembership(projectId, requester.userId, ["REQUESTER"]);
  await addMembership(projectId, buyer.userId, ["BUYER"]);
  await addMembership(projectId, receiver.userId, ["RECEIVER"]);
  await addMembership(otherProjectId, outsider.userId, ["REQUESTER", "BUYER"]);
});

afterAll(async () => {
  await db.$disconnect();
});

describe("quantity parsing", () => {
  it("accepts comma and point decimals, rejects bad input", () => {
    expect(normalizeQuantity("1,5")).toBe("1.5");
    expect(normalizeQuantity(" 012.500 ")).toBe("12.5");
    expect(normalizeQuantity("25")).toBe("25");
    expect(normalizeQuantity("0.001")).toBe("0.001");
    expect(normalizeQuantity("1.2345")).toBeNull();
    expect(normalizeQuantity("-3")).toBeNull();
    expect(normalizeQuantity("abc")).toBeNull();
    expect(normalizeQuantity("1e3")).toBeNull();
  });
});

describe("full flow: draft → review → approved", () => {
  it("creates a numbered draft, submits and approves with an audit trail", async () => {
    const r = await createRequest(requester, newRequest());
    expect(r.number).toBe(1);
    const detail = await getRequest(requester, r.id);
    expect(detail.request.status).toBe("DRAFT");
    expect(detail.items.map((i) => [i.position, i.quantity])).toEqual([
      [1, "25"],
      [2, "1.5"],
    ]);
    expect(detail.permissions.canSubmit).toBe(true);
    expect(detail.permissions.canApprove).toBe(false);

    await submitRequest(requester, r.id);
    expect(await statusOf(r.id)).toBe("IN_REVIEW");
    const forBuyer = await getRequest(buyer, r.id);
    expect(forBuyer.permissions.canApprove).toBe(true);
    expect(forBuyer.permissions.canEdit).toBe(false);

    await approveRequest(buyer, r.id);
    const done = await db.purchaseRequest.findUniqueOrThrow({ where: { id: r.id } });
    expect(done.status).toBe("APPROVED");
    expect(done.reviewedById).toBe(buyer.userId);
    expect(await actionsOf(r.id)).toEqual([
      "request.created",
      "request.submitted",
      "request.approved",
    ]);
  });

  it("numbers requests per organization without gaps, also under concurrency", async () => {
    const created = await Promise.all(
      Array.from({ length: 8 }, () => createRequest(requester, newRequest())),
    );
    expect(created.map((c) => c.number).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    const otherProject = await createProject(otherOrgAdmin, {
      name: "სხვა ობიექტი",
      address: "ქუთაისი",
    });
    const other = await createRequest(otherOrgAdmin, newRequest({ projectId: otherProject.id }));
    expect(other.number).toBe(1);
  });
});

describe("rejection, withdrawal, re-opening", () => {
  it("rejects with a reason; the author returns it to draft, edits and resubmits", async () => {
    const r = await createRequest(requester, newRequest());
    await submitRequest(requester, r.id);
    await expectAppError(rejectRequest(buyer, r.id, ""), "VALIDATION");
    await rejectRequest(buyer, r.id, "რაოდენობა გადაჭარბებულია");
    const rejected = await db.purchaseRequest.findUniqueOrThrow({ where: { id: r.id } });
    expect(rejected.status).toBe("REJECTED");
    expect(rejected.rejectionReason).toBe("რაოდენობა გადაჭარბებულია");

    await expectAppError(updateRequest(requester, r.id, { items }), "CONFLICT");
    await returnToDraft(requester, r.id);
    await updateRequest(requester, r.id, { items: [items[0]!] });
    await submitRequest(requester, r.id);
    expect(await statusOf(r.id)).toBe("IN_REVIEW");
    const events = await db.auditEvent.findMany({
      where: { entityId: r.id, action: "request.rejected" },
    });
    expect(events[0]?.reason).toBe("რაოდენობა გადაჭარბებულია");
  });

  it("lets the author withdraw from review, and re-open an approved request with a reason", async () => {
    const r = await createRequest(requester, newRequest());
    await submitRequest(requester, r.id);
    await withdrawRequest(requester, r.id);
    expect(await statusOf(r.id)).toBe("DRAFT");
    await submitRequest(requester, r.id);
    await approveRequest(buyer, r.id);
    await expectAppError(reopenRequest(requester, r.id, ""), "VALIDATION");
    await reopenRequest(requester, r.id, "პოზიციის დამატება");
    const reopened = await db.purchaseRequest.findUniqueOrThrow({ where: { id: r.id } });
    expect(reopened.status).toBe("DRAFT");
    expect(reopened.reviewedById).toBeNull();
  });

  it("only allows editing drafts", async () => {
    const r = await createRequest(requester, newRequest());
    await updateRequest(requester, r.id, {
      items: [...items, { name: "ქვიშა", quantity: "3", unit: "მ³" }],
    });
    expect((await getRequest(requester, r.id)).items).toHaveLength(3);
    await submitRequest(requester, r.id);
    await expectAppError(updateRequest(requester, r.id, { items }), "CONFLICT");
  });
});

describe("validation", () => {
  it("rejects bad items with field paths and Georgian messages", async () => {
    const err = await expectAppError(
      createRequest(
        requester,
        newRequest({
          items: [
            { name: "", quantity: "0", unit: "" },
            { name: "ok", quantity: "1.2345", unit: "კგ" },
          ],
        }),
      ),
      "VALIDATION",
    );
    expect(err.fieldErrors?.["items.0.name"]).toBe("მიუთითეთ დასახელება.");
    expect(err.fieldErrors?.["items.0.quantity"]).toMatch(/დადებითი/);
    expect(err.fieldErrors?.["items.0.unit"]).toBeTruthy();
    expect(err.fieldErrors?.["items.1.quantity"]).toBeTruthy();
  });

  it("allows saving an empty draft but not submitting it", async () => {
    const r = await createRequest(requester, newRequest({ items: [] }));
    await expectAppError(submitRequest(requester, r.id), "VALIDATION");
    expect(await statusOf(r.id)).toBe("DRAFT");
  });

  it("rejects desired dates in the past and accepts today", async () => {
    await expectAppError(
      createRequest(requester, newRequest({ desiredDate: "2020-01-01" })),
      "VALIDATION",
    );
    await expectAppError(
      createRequest(requester, newRequest({ desiredDate: "2026-02-30" })),
      "VALIDATION",
    );
    const r = await createRequest(requester, newRequest({ desiredDate: todayInTbilisi() }));
    expect(r.number).toBeGreaterThan(0);
  });

  it("rejects NUL characters with a Georgian message instead of a database error", async () => {
    const err = await expectAppError(
      createRequest(
        requester,
        newRequest({ items: [{ name: "ცემ\u0000ენტი", quantity: "1", unit: "ტომარა" }] }),
      ),
      "VALIDATION",
    );
    expect(err.message).toMatch(/სიმბოლო/);
  });

  it("caps the number of items", async () => {
    const many = Array.from({ length: 201 }, (_, i) => ({
      name: `p${i}`,
      quantity: "1",
      unit: "ცალი",
    }));
    await expectAppError(createRequest(requester, newRequest({ items: many })), "VALIDATION");
  });
});

describe("roles and access", () => {
  it("requires the REQUESTER role to create", async () => {
    await expectAppError(createRequest(buyer, newRequest()), "FORBIDDEN");
    await expectAppError(createRequest(outsider, newRequest()), "FORBIDDEN");
    await expectAppError(createRequest(otherOrgAdmin, newRequest()), "NOT_FOUND");
    await expect(createRequest(admin, newRequest())).resolves.toBeTruthy();
  });

  it("requires the BUYER role to approve or reject", async () => {
    const r = await createRequest(requester, newRequest());
    await submitRequest(requester, r.id);
    await expectAppError(approveRequest(requester, r.id), "FORBIDDEN");
    await expectAppError(approveRequest(receiver, r.id), "FORBIDDEN");
    await expectAppError(approveRequest(outsider, r.id), "FORBIDDEN"); // buyer elsewhere
    await expectAppError(rejectRequest(otherOrgAdmin, r.id, "არა"), "NOT_FOUND");
    expect(await statusOf(r.id)).toBe("IN_REVIEW");
  });

  it("only the author (or admin) edits, submits and withdraws", async () => {
    const r = await createRequest(requester, newRequest());
    await expectAppError(updateRequest(buyer, r.id, { items }), "FORBIDDEN");
    await expectAppError(submitRequest(buyer, r.id), "FORBIDDEN");
    await submitRequest(admin, r.id);
    await expectAppError(withdrawRequest(receiver, r.id), "FORBIDDEN");
  });

  it("hides requests from users of other projects and organizations", async () => {
    const r = await createRequest(requester, newRequest());
    await expectAppError(getRequest(outsider, r.id), "FORBIDDEN");
    await expectAppError(getRequest(otherOrgAdmin, r.id), "NOT_FOUND");
    await expect(getRequest(receiver, r.id)).resolves.toBeTruthy(); // any member may read
    expect((await listRequests(outsider, {})).total).toBe(0);
    expect((await listRequests(otherOrgAdmin, {})).total).toBe(0);
    expect((await listRequests(receiver, {})).total).toBe(1);
    expect((await listRequests(admin, {})).total).toBe(1);
  });

  it("makes requests of archived projects read-only", async () => {
    const r = await createRequest(requester, newRequest());
    await setProjectArchived(admin, projectId, true);
    await expectAppError(submitRequest(requester, r.id), "CONFLICT");
    await expectAppError(createRequest(requester, newRequest()), "CONFLICT");
    const detail = await getRequest(requester, r.id);
    expect(detail.permissions.canSubmit).toBe(false);
  });
});

describe("cancellation", () => {
  it("needs a reason and allowed roles; cancelled requests are final", async () => {
    const r = await createRequest(requester, newRequest());
    await expectAppError(cancelRequest(requester, r.id, " "), "VALIDATION");
    await expectAppError(cancelRequest(receiver, r.id, "აღარ გვჭირდება"), "FORBIDDEN");
    await cancelRequest(requester, r.id, "აღარ გვჭირდება");
    const c = await db.purchaseRequest.findUniqueOrThrow({ where: { id: r.id } });
    expect(c.status).toBe("CANCELLED");
    expect(c.cancelReason).toBe("აღარ გვჭირდება");
    await expectAppError(submitRequest(requester, r.id), "CONFLICT");
    await expectAppError(cancelRequest(buyer, r.id, "კიდევ ერთხელ"), "CONFLICT");
  });
});

describe("concurrency", () => {
  it("lets only one of two concurrent reviews win", async () => {
    const r = await createRequest(requester, newRequest());
    await submitRequest(requester, r.id);
    const results = await Promise.allSettled([
      approveRequest(buyer, r.id),
      rejectRequest(admin, r.id, "პარალელური უარყოფა"),
    ]);
    expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(["APPROVED", "REJECTED"]).toContain(await statusOf(r.id));
    const reviews = (await actionsOf(r.id)).filter(
      (a) => a === "request.approved" || a === "request.rejected",
    );
    expect(reviews).toHaveLength(1);
  });

  it("does not let an edit slip in after a concurrent submit", async () => {
    const r = await createRequest(requester, newRequest());
    const results = await Promise.allSettled([
      submitRequest(requester, r.id),
      updateRequest(requester, r.id, { items: [items[0]!] }),
    ]);
    // Either order is fine, but the request must never be IN_REVIEW with an edit applied after it.
    const status = await statusOf(r.id);
    const actions = await actionsOf(r.id);
    if (status === "IN_REVIEW") {
      expect(actions.at(-1)).toBe("request.submitted");
    }
    expect(results.some((x) => x.status === "fulfilled")).toBe(true);
  });
});

describe("list filters and dashboard", () => {
  it("filters by status, project, number and item name", async () => {
    const a = await createRequest(requester, newRequest());
    const b = await createRequest(
      requester,
      newRequest({ items: [{ name: "ბლოკი", quantity: "100", unit: "ცალი" }] }),
    );
    await submitRequest(requester, b.id);
    expect((await listRequests(admin, { status: "IN_REVIEW" })).rows.map((r) => r.id)).toEqual([
      b.id,
    ]);
    expect((await listRequests(admin, { q: "ბლოკ" })).rows.map((r) => r.id)).toEqual([b.id]);
    expect((await listRequests(admin, { q: `№000${a.number}` })).rows.map((r) => r.id)).toEqual([
      a.id,
    ]);
    expect((await listRequests(admin, { project: otherProjectId })).total).toBe(0);
    expect((await listRequests(admin, { status: "NOPE" })).total).toBe(2); // invalid filter ignored
    const today = todayInTbilisi();
    expect((await listRequests(admin, { from: today, to: today })).total).toBe(2);
    expect((await listRequests(admin, { to: "2020-01-01" })).total).toBe(0);
  });

  it("counts open requests and reviews waiting for the buyer", async () => {
    const r = await createRequest(requester, newRequest());
    await createRequest(requester, newRequest());
    await submitRequest(requester, r.id);
    const forBuyer = await requestDashboard(buyer);
    expect(forBuyer.awaitingReview).toBe(1);
    expect(forBuyer.open).toBe(1);
    const forRequester = await requestDashboard(requester);
    expect(forRequester.awaitingReview).toBe(0);
    expect(forRequester.myDrafts).toBe(1);
    expect((await requestDashboard(outsider)).open).toBe(0);
  });
});

describe("review safety (code review findings)", () => {
  it("refuses a review made on a stale page after withdraw, edit and resubmit", async () => {
    const r = await createRequest(requester, newRequest());
    await submitRequest(requester, r.id);
    const seen = (await getRequest(buyer, r.id)).request.submittedAt;
    expect(seen).toBeInstanceOf(Date);

    await withdrawRequest(requester, r.id);
    await updateRequest(requester, r.id, {
      items: [{ name: "ცემენტი M400", quantity: "1000", unit: "ტომარა" }],
    });
    await submitRequest(requester, r.id);

    await expectAppError(approveRequest(buyer, r.id, { expectedSubmittedAt: seen }), "CONFLICT");
    await expectAppError(
      rejectRequest(buyer, r.id, "ძველი გვერდიდან", { expectedSubmittedAt: seen }),
      "CONFLICT",
    );
    expect(await statusOf(r.id)).toBe("IN_REVIEW");
    const current = (await getRequest(buyer, r.id)).request.submittedAt;
    await approveRequest(buyer, r.id, { expectedSubmittedAt: current });
    expect(await statusOf(r.id)).toBe("APPROVED");
  });

  it("never approves a request without items", async () => {
    const r = await createRequest(requester, newRequest());
    await submitRequest(requester, r.id);
    await db.requestItem.deleteMany({ where: { requestId: r.id } });
    await expectAppError(approveRequest(buyer, r.id), "VALIDATION");
  });

  it("never puts an empty request into review when an edit races the submit", async () => {
    for (let i = 0; i < 8; i++) {
      const r = await createRequest(requester, newRequest());
      await Promise.allSettled([
        submitRequest(requester, r.id),
        updateRequest(requester, r.id, { items: [] }),
      ]);
      const req = await db.purchaseRequest.findUniqueOrThrow({
        where: { id: r.id },
        include: { _count: { select: { items: true } } },
      });
      if (req.status === "IN_REVIEW") expect(req._count.items).toBeGreaterThan(0);
    }
  });

  it("records the full before/after of an edit", async () => {
    const r = await createRequest(requester, newRequest());
    await updateRequest(requester, r.id, {
      note: "შეცვლილი",
      items: [{ name: "არმატურა", spec: "Ø16", quantity: "120", unit: "ცალი" }],
    });
    const ev = await db.auditEvent.findFirstOrThrow({
      where: { entityId: r.id, action: "request.updated" },
    });
    expect(ev.changes).toMatchObject({
      before: {
        note: "სასწრაფოდ",
        items: [
          { name: "ცემენტი M400", quantity: "25", unit: "ტომარა" },
          { name: "არმატურა", spec: "Ø12", quantity: "1.5", unit: "ტონა" },
        ],
      },
      after: {
        note: "შეცვლილი",
        items: [{ name: "არმატურა", spec: "Ø16", quantity: "120", unit: "ცალი" }],
      },
    });
  });
});

describe("list filters (code review findings)", () => {
  it("filters open requests and my own, and clamps an out-of-range page", async () => {
    const mine = await createRequest(requester, newRequest());
    await submitRequest(requester, mine.id);
    const draft = await createRequest(admin, newRequest());
    expect((await listRequests(admin, { status: "OPEN" })).rows.map((r) => r.id)).toEqual([
      mine.id,
    ]);
    expect((await listRequests(admin, { mine: "1" })).rows.map((r) => r.id)).toEqual([draft.id]);
    expect((await listRequests(requester, { status: "DRAFT", mine: "1" })).total).toBe(0);
    const far = await listRequests(admin, { page: "9" });
    expect(far.page).toBe(1);
    expect(far.rows).toHaveLength(2);
  });
});

describe("access on every write (code review findings)", () => {
  it("refuses other projects and organizations on each request transition", async () => {
    const r = await createRequest(requester, newRequest());
    for (const [who, code] of [
      [outsider, "FORBIDDEN"],
      [otherOrgAdmin, "NOT_FOUND"],
    ] as const) {
      await expectAppError(updateRequest(who, r.id, { items }), code);
      await expectAppError(submitRequest(who, r.id), code);
      await expectAppError(cancelRequest(who, r.id, "უცხო"), code);
    }
    await submitRequest(requester, r.id);
    await expectAppError(withdrawRequest(outsider, r.id), "FORBIDDEN");
    await expectAppError(withdrawRequest(otherOrgAdmin, r.id), "NOT_FOUND");
    await approveRequest(buyer, r.id);
    await expectAppError(reopenRequest(outsider, r.id, "უცხო"), "FORBIDDEN");
    await expectAppError(reopenRequest(otherOrgAdmin, r.id, "უცხო"), "NOT_FOUND");
    expect(await statusOf(r.id)).toBe("APPROVED");
  });
});
