// Real Better Auth sign-in against rows written by our user service.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// The Next.js cookie plugin needs a request scope; it is irrelevant for direct API calls.
vi.mock("better-auth/next-js", () => ({
  nextCookies: () => ({ id: "next-cookies" }),
  toNextJsHandler: () => ({}),
}));

const { auth } = await import("@/lib/auth");
const { db } = await import("@/lib/db");
const users = await import("@/server/users/service");
const { createActor, createOrg, expectAppError, resetDb } = await import("./helpers");

type Actor = Awaited<ReturnType<typeof createActor>>;
let admin: Actor;

async function signIn(email: string, password: string) {
  return auth.api.signInEmail({ body: { email, password } });
}

async function signInFails(email: string, password: string) {
  const err = await signIn(email, password).then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).not.toBeNull();
}

beforeEach(async () => {
  await resetDb();
  const org = await createOrg();
  admin = await createActor(org.id, { admin: true });
});

afterAll(async () => {
  await db.$disconnect();
});

describe("sign-in with admin-created accounts", () => {
  it("signs in with the temporary password and flags a forced change", async () => {
    const u = await users.createUser(admin, {
      name: "ახალი თანამშრომელი",
      email: "  New.User@Test.Example ",
      password: "temporary-pass-1",
    });
    const res = await signIn("new.user@test.example", "temporary-pass-1");
    expect(res.user.id).toBe(u.id);
    const row = await db.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(row.mustChangePassword).toBe(true);
    expect(row.organizationId).toBe(admin.organizationId);
    await signInFails("new.user@test.example", "wrong-password-1");
  });

  it("blocks sign-in for deactivated users", async () => {
    const u = await users.createUser(admin, {
      name: "გასათიშავი",
      email: "off@test.example",
      password: "temporary-pass-1",
    });
    await users.setUserActive(admin, u.id, false);
    await signInFails("off@test.example", "temporary-pass-1");
    await users.setUserActive(admin, u.id, true);
    await expect(signIn("off@test.example", "temporary-pass-1")).resolves.toBeTruthy();
  });

  it("rejects public sign-up", async () => {
    const err = await auth.api
      .signUpEmail({ body: { name: "x", email: "self@test.example", password: "self-signup-1" } })
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect(err).not.toBeNull();
    expect(await db.user.count({ where: { email: "self@test.example" } })).toBe(0);
  });
});

describe("password change and reset", () => {
  it("user changes own password: old one stops working, other sessions end", async () => {
    const u = await users.createUser(admin, {
      name: "მომხმარებელი",
      email: "me@test.example",
      password: "temporary-pass-1",
    });
    const first = await signIn("me@test.example", "temporary-pass-1");
    const second = await signIn("me@test.example", "temporary-pass-1");
    const current = await db.session.findUniqueOrThrow({ where: { token: second.token } });
    const actor = { userId: u.id, organizationId: admin.organizationId, isAdmin: false };

    await expectAppError(
      users.changeOwnPassword(actor, current.id, {
        currentPassword: "wrong-password",
        newPassword: "brand-new-pass-1",
        confirmPassword: "brand-new-pass-1",
      }),
      "VALIDATION",
    );
    await expectAppError(
      users.changeOwnPassword(actor, current.id, {
        currentPassword: "temporary-pass-1",
        newPassword: "brand-new-pass-1",
        confirmPassword: "different-pass-1",
      }),
      "VALIDATION",
    );

    await users.changeOwnPassword(actor, current.id, {
      currentPassword: "temporary-pass-1",
      newPassword: "brand-new-pass-1",
      confirmPassword: "brand-new-pass-1",
    });
    await signInFails("me@test.example", "temporary-pass-1");
    await expect(signIn("me@test.example", "brand-new-pass-1")).resolves.toBeTruthy();
    expect(await db.session.findUnique({ where: { token: first.token } })).toBeNull();
    expect(await db.session.findUnique({ where: { token: second.token } })).not.toBeNull();
    const row = await db.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(row.mustChangePassword).toBe(false);
  });

  it("admin reset sets a temporary password and ends all sessions", async () => {
    const u = await users.createUser(admin, {
      name: "დამავიწყდა",
      email: "forgot@test.example",
      password: "temporary-pass-1",
    });
    const s = await signIn("forgot@test.example", "temporary-pass-1");
    await users.resetPassword(admin, u.id, "reset-pass-123");
    expect(await db.session.findUnique({ where: { token: s.token } })).toBeNull();
    await signInFails("forgot@test.example", "temporary-pass-1");
    await expect(signIn("forgot@test.example", "reset-pass-123")).resolves.toBeTruthy();
    const events = await db.auditEvent.findMany({
      where: { entityId: u.id },
      orderBy: { seq: "asc" },
    });
    expect(events.map((e) => e.action)).toEqual(["user.created", "user.password_reset"]);
  });

  it("only admins of the same organization can reset", async () => {
    const otherOrg = await createOrg("სხვა");
    const otherAdmin = await createActor(otherOrg.id, { admin: true });
    const member = await createActor(admin.organizationId);
    await expectAppError(users.resetPassword(member, admin.userId, "reset-pass-123"), "FORBIDDEN");
    await expectAppError(
      users.resetPassword(otherAdmin, member.userId, "reset-pass-123"),
      "NOT_FOUND",
    );
  });
});

describe("organization bootstrap", () => {
  it("creates an organization with a working admin login", async () => {
    const r = await users.createOrganizationWithAdmin({
      organizationName: "შპს ტესტი",
      name: "პირველი ადმინი",
      email: "boss@test.example",
      password: "boss-password-1",
    });
    const row = await db.user.findUniqueOrThrow({ where: { id: r.userId } });
    expect(row.orgRole).toBe("ADMIN");
    expect(row.mustChangePassword).toBe(false);
    await expect(signIn("boss@test.example", "boss-password-1")).resolves.toBeTruthy();
  });
});
