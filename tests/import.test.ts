import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { todayInTbilisi } from "@/lib/format";
import type { Actor } from "@/server/access";
import {
  PREVIEW_LIMIT_PER_MINUTE,
  confirmImport,
  previewImport,
  type ImportPreview,
} from "@/server/import/service";
import { createProject, setProjectArchived } from "@/server/projects/service";
import { createRequest, getRequest } from "@/server/requests/service";
import { addMembership, createActor, createOrg, expectAppError, resetDb } from "./helpers";

let admin: Actor;
let requester: Actor;
let buyer: Actor;
let outsider: Actor;
let otherOrgAdmin: Actor;
let projectId: string;
let otherProjectId: string;

// The header carries the day the message was written; relative dates ("ხვალ") count from it,
// so it must be today or the desired date can end up in the past.
const [yyyy, mm, dd] = todayInTbilisi().split("-");
const TEXT = [
  `[${dd}.${mm}.${yyyy!.slice(2)}, 09:15] ნიკა: გამარჯობა, დამირეკეთ 599 12 34 56`,
  "საჭიროა:",
  "- ცემენტი M400 25 ტომარა",
  "- 12 ც. არმატურა Ø12",
  "- ქვიშა 3",
  "მადლობა",
].join("\n");

/** Turn a preview into the confirm payload the client would send (all items kept). */
function payloadFrom(p: ImportPreview, fix: Record<number, Partial<Record<string, string>>> = {}) {
  const items = p.lines.flatMap((l) =>
    l.kind === "items"
      ? l.items.map((it) => ({
          name: it.name,
          spec: it.spec,
          quantity: it.quantity ?? "",
          unit: it.unit ?? "",
          note: "",
          lineNo: l.lineNo,
        }))
      : [],
  );
  return {
    projectId: p.projectId,
    idempotencyKey: p.idempotencyKey,
    textHash: p.textHash,
    token: p.token,
    desiredDate: p.desiredDate?.value ?? "",
    priority: "NORMAL",
    note: "",
    items: items.map((it, i) => ({ ...it, ...fix[i] })),
    stats: {
      lineCount: p.stats.lineCount,
      skippedLineCount: p.stats.skippedLineCount,
      flaggedItemCount: p.stats.flaggedItemCount,
    },
  };
}

beforeEach(async () => {
  await resetDb();
  const org = await createOrg();
  const otherOrg = await createOrg("სხვა");
  admin = await createActor(org.id, { admin: true });
  requester = await createActor(org.id, { name: "მომთხოვნი" });
  buyer = await createActor(org.id);
  outsider = await createActor(org.id);
  otherOrgAdmin = await createActor(otherOrg.id, { admin: true });
  projectId = (await createProject(admin, { name: "ობიექტი 1", address: "თბილისი" })).id;
  otherProjectId = (await createProject(admin, { name: "ობიექტი 2", address: "ბათუმი" })).id;
  await addMembership(projectId, requester.userId, ["REQUESTER"]);
  await addMembership(projectId, buyer.userId, ["BUYER"]);
  await addMembership(otherProjectId, outsider.userId, ["REQUESTER"]);
  await addMembership(otherProjectId, requester.userId, ["REQUESTER"]);
});

afterAll(async () => {
  await db.$disconnect();
});

describe("preview", () => {
  it("parses lines with references, skips non-material lines and flags unclear ones", async () => {
    const p = await previewImport(requester, { projectId, text: TEXT });
    expect(p.lines.map((l) => [l.lineNo, l.kind])).toEqual([
      [1, "skipped"],
      [2, "skipped"],
      [3, "items"],
      [4, "items"],
      [5, "items"],
      [6, "skipped"],
    ]);
    expect(p.stats).toEqual({
      lineCount: 6,
      skippedLineCount: 3,
      itemCount: 3,
      flaggedItemCount: 1,
    });
    expect(p.duplicateOf).toBeNull();
    expect(p.textHash).toMatch(/^[0-9a-f]{64}$/);
    // Nothing is written by a preview.
    expect(await db.purchaseRequest.count()).toBe(0);
    expect(await db.requestImport.count()).toBe(0);
  });

  it("requires the REQUESTER role in an active project of the organization", async () => {
    const input = { projectId, text: TEXT };
    await expectAppError(previewImport(buyer, input), "FORBIDDEN");
    await expectAppError(previewImport(outsider, input), "FORBIDDEN");
    await expectAppError(previewImport(otherOrgAdmin, input), "NOT_FOUND");
    await setProjectArchived(admin, projectId, true);
    await expectAppError(previewImport(requester, input), "CONFLICT");
  });

  it("limits text size and line count, and rejects empty text", async () => {
    await expectAppError(previewImport(requester, { projectId, text: "  \n " }), "VALIDATION");
    await expectAppError(
      previewImport(requester, { projectId, text: "ა".repeat(10_001) }),
      "VALIDATION",
    );
    await expectAppError(
      previewImport(requester, { projectId, text: "ა\n".repeat(401) }),
      "VALIDATION",
    );
    const many = Array.from({ length: 201 }, (_, i) => `მასალა${i} 1 ცალი`).join("\n");
    await expectAppError(previewImport(requester, { projectId, text: many }), "VALIDATION");
  });

  it("rate-limits previews per user", async () => {
    for (let i = 0; i < PREVIEW_LIMIT_PER_MINUTE; i++) {
      await previewImport(requester, { projectId, text: "ცემენტი 1 ტომარა" });
    }
    await expectAppError(
      previewImport(requester, { projectId, text: "ცემენტი 1 ტომარა" }),
      "RATE_LIMITED",
    );
    // Another user has their own budget.
    await expect(
      previewImport(admin, { projectId, text: "ცემენტი 1 ტომარა" }),
    ).resolves.toBeTruthy();
  });
});

describe("confirm", () => {
  it("creates a draft with the reviewed items and technical metadata only", async () => {
    const p = await previewImport(requester, { projectId, text: `${TEXT}\nმიწოდება ხვალ` });
    // The user fixes the flagged unit of line 5 ("ქვიშა 3").
    const r = await confirmImport(requester, payloadFrom(p, { 2: { unit: "მ³" } }));
    expect(r.replayed).toBe(false);

    const detail = await getRequest(requester, r.id);
    expect(detail.request.status).toBe("DRAFT");
    expect(detail.items.map((i) => [i.name, i.spec, i.quantity, i.unit])).toEqual([
      ["ცემენტი", "M400", "25", "ტომარა"],
      ["არმატურა", "Ø12", "12", "ცალი"],
      ["ქვიშა", null, "3", "მ³"],
    ]);
    expect(detail.request.desiredDate?.toISOString().slice(0, 10)).toBe(p.desiredDate?.value);
    expect(detail.events.map((e) => e.action)).toEqual(["request.imported"]);

    const meta = await db.requestImport.findFirstOrThrow();
    expect(meta).toMatchObject({
      requestId: r.id,
      userId: requester.userId,
      textHash: p.textHash,
      lineCount: 7,
      skippedLineCount: 4,
      itemCount: 3,
      flaggedItemCount: 1,
      repeatConfirmed: false,
    });
    expect(meta.sourceLines).toEqual([
      { position: 1, lineNo: 3 },
      { position: 2, lineNo: 4 },
      { position: 3, lineNo: 5 },
    ]);
  });

  it("never stores the raw text", async () => {
    const p = await previewImport(requester, { projectId, text: TEXT });
    await confirmImport(requester, payloadFrom(p, { 2: { unit: "მ³" } }));
    const stored = JSON.stringify(
      [
        await db.requestImport.findMany(),
        await db.auditEvent.findMany(),
        await db.purchaseRequest.findMany(),
      ],
      (_, v: unknown) => (typeof v === "bigint" ? v.toString() : v),
    );
    for (const fragment of ["599 12 34 56", "გამარჯობა", "მადლობა", "ნიკა", "საჭიროა"]) {
      expect(stored).not.toContain(fragment);
    }
  });

  it("rejects unresolved flags, an empty list and a past date with field paths", async () => {
    const p = await previewImport(requester, { projectId, text: TEXT });
    const err = await expectAppError(confirmImport(requester, payloadFrom(p)), "VALIDATION");
    expect(err.fieldErrors?.["items.2.unit"]).toBeTruthy();
    await expectAppError(confirmImport(requester, { ...payloadFrom(p), items: [] }), "VALIDATION");
    await expectAppError(
      confirmImport(requester, {
        ...payloadFrom(p, { 2: { unit: "მ³" } }),
        desiredDate: "2020-01-01",
      }),
      "VALIDATION",
    );
    expect(await db.purchaseRequest.count()).toBe(0);
  });

  it("is idempotent: a repeated submit returns the same draft", async () => {
    const p = await previewImport(requester, { projectId, text: TEXT });
    const payload = payloadFrom(p, { 2: { unit: "მ³" } });
    const first = await confirmImport(requester, payload);
    const again = await confirmImport(requester, payload);
    expect(again).toEqual({ id: first.id, number: first.number, replayed: true });
    expect(await db.purchaseRequest.count()).toBe(1);
    // Someone else cannot use the key to reach that request.
    await expectAppError(confirmImport(admin, payload), "VALIDATION");
  });

  it("creates one draft for a parallel double submit and keeps numbering gap-free", async () => {
    const p = await previewImport(requester, { projectId, text: TEXT });
    const payload = payloadFrom(p, { 2: { unit: "მ³" } });
    const results = await Promise.all([
      confirmImport(requester, payload),
      confirmImport(requester, payload),
      confirmImport(requester, payload),
    ]);
    expect(new Set(results.map((r) => r.id)).size).toBe(1);
    expect(await db.purchaseRequest.count()).toBe(1);
    expect(await db.requestImport.count()).toBe(1);
    const next = await createRequest(requester, {
      projectId,
      items: [{ name: "ქვიშა", quantity: "1", unit: "მ³" }],
    });
    expect(next.number).toBe(2);
  });

  it("warns about the same text and allows a deliberate re-import", async () => {
    const p1 = await previewImport(requester, { projectId, text: TEXT });
    const first = await confirmImport(requester, payloadFrom(p1, { 2: { unit: "მ³" } }));

    // Spacing and case differences still count as the same text.
    const p2 = await previewImport(requester, {
      projectId,
      text: TEXT.replace("ცემენტი", "ცემენტი  ").toUpperCase(),
    });
    expect(p2.duplicateOf).toMatchObject({ requestId: first.id, number: first.number });
    const repeatErr = await expectAppError(
      confirmImport(requester, payloadFrom(p2, { 2: { unit: "მ³" } })),
      "CONFLICT",
    );
    // The client shows the "import anyway" checkbox from this field error.
    expect(repeatErr.fieldErrors?.allowRepeat).toBeTruthy();
    const second = await confirmImport(requester, {
      ...payloadFrom(p2, { 2: { unit: "მ³" } }),
      allowRepeat: true,
    });
    expect(second.id).not.toBe(first.id);
    expect(
      (await db.requestImport.findUniqueOrThrow({ where: { requestId: second.id } }))
        .repeatConfirmed,
    ).toBe(true);

    // The warning is per project: another project does not reveal the request.
    const other = await previewImport(requester, { projectId: otherProjectId, text: TEXT });
    expect(other.duplicateOf).toBeNull();
  });

  it("refuses tampered preview metadata", async () => {
    const p = await previewImport(requester, { projectId, text: TEXT });
    const payload = payloadFrom(p, { 2: { unit: "მ³" } });
    await expectAppError(
      confirmImport(requester, { ...payload, textHash: "0".repeat(64) }),
      "VALIDATION",
    );
    await expectAppError(
      confirmImport(requester, { ...payload, stats: { ...payload.stats, lineCount: 1 } }),
      "VALIDATION",
    );
    // A preview made for one user cannot be confirmed by another.
    await addMembership(projectId, admin.userId, ["REQUESTER"]);
    await expectAppError(confirmImport(admin, payload), "VALIDATION");
    expect(await db.purchaseRequest.count()).toBe(0);
  });

  it("lets only one of two parallel previews of the same text through without allowRepeat", async () => {
    const [a, b] = await Promise.all([
      previewImport(requester, { projectId, text: TEXT }),
      previewImport(requester, { projectId, text: TEXT }),
    ]);
    const results = await Promise.allSettled([
      confirmImport(requester, payloadFrom(a, { 2: { unit: "მ³" } })),
      confirmImport(requester, payloadFrom(b, { 2: { unit: "მ³" } })),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.purchaseRequest.count()).toBe(1);
  });

  it("re-checks access on confirm instead of trusting the preview", async () => {
    const p = await previewImport(requester, { projectId, text: TEXT });
    const payload = payloadFrom(p, { 2: { unit: "მ³" } });
    // Someone else's preview (or a changed key) fails the signature before anything else.
    await expectAppError(
      confirmImport(buyer, { ...payload, idempotencyKey: randomUUID() }),
      "VALIDATION",
    );
    await expectAppError(confirmImport(otherOrgAdmin, payload), "VALIDATION");
    // The requester loses the role after the preview: the confirm is refused.
    await db.projectMembership.updateMany({
      where: { projectId, userId: requester.userId },
      data: { roles: ["RECEIVER"] },
    });
    await expectAppError(confirmImport(requester, payload), "FORBIDDEN");
    await db.projectMembership.updateMany({
      where: { projectId, userId: requester.userId },
      data: { roles: ["REQUESTER"] },
    });
    await setProjectArchived(admin, projectId, true);
    await expectAppError(confirmImport(requester, payload), "CONFLICT");
    expect(await db.purchaseRequest.count()).toBe(0);
    expect(todayInTbilisi()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
