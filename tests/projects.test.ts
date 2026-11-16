import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { requireProjectAccess, type Actor } from "@/server/access";
import { AppError } from "@/server/errors";
import {
  addMember,
  createProject,
  getProject,
  listProjects,
  removeMember,
  setProjectArchived,
  updateMemberRoles,
  updateProject,
} from "@/server/projects/service";
import { createUser, setUserActive } from "@/server/users/service";
import { addMembership, createActor, createOrg, resetDb } from "./helpers";

async function expectAppError(p: Promise<unknown>, code: AppError["code"]) {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(AppError);
  expect((err as AppError).code).toBe(code);
  return err as AppError;
}

let admin: Actor;
let member: Actor;
let outsider: Actor; // same org, not a member
let otherOrgAdmin: Actor;
let projectId: string;

beforeEach(async () => {
  await resetDb();
  const org = await createOrg();
  const otherOrg = await createOrg("სხვა ორგანიზაცია");
  admin = await createActor(org.id, { admin: true, name: "ადმინი" });
  member = await createActor(org.id, { name: "წევრი" });
  outsider = await createActor(org.id, { name: "გარეშე" });
  otherOrgAdmin = await createActor(otherOrg.id, { admin: true });
  const project = await createProject(admin, {
    name: "ვაკის ობიექტი",
    address: "თბილისი, ტესტის ქ. 1",
  });
  projectId = project.id;
  await addMembership(projectId, member.userId, ["REQUESTER"]);
});

afterAll(async () => {
  await db.$disconnect();
});

describe("project access", () => {
  it("lets admins and members read the project", async () => {
    await expect(getProject(admin, projectId)).resolves.toBeTruthy();
    const { access } = await getProject(member, projectId);
    expect(access.roles).toEqual(["REQUESTER"]);
  });

  it("forbids a same-org user who is not a member", async () => {
    await expectAppError(getProject(outsider, projectId), "FORBIDDEN");
  });

  it("hides the project from another organization, even its admin", async () => {
    await expectAppError(getProject(otherOrgAdmin, projectId), "NOT_FOUND");
    expect(await listProjects(otherOrgAdmin)).toHaveLength(0);
  });

  it("lists only visible projects", async () => {
    await createProject(admin, { name: "მეორე ობიექტი", address: "ქუთაისი, ტესტის ქ. 2" });
    expect(await listProjects(admin)).toHaveLength(2);
    expect((await listProjects(member)).map((p) => p.id)).toEqual([projectId]);
    expect(await listProjects(outsider)).toHaveLength(0);
  });

  it("enforces required roles", async () => {
    await expect(
      requireProjectAccess(db, member, projectId, { requiredRoles: ["REQUESTER"] }),
    ).resolves.toBeTruthy();
    await expectAppError(
      requireProjectAccess(db, member, projectId, { requiredRoles: ["BUYER"] }),
      "FORBIDDEN",
    );
    await expect(
      requireProjectAccess(db, admin, projectId, { requiredRoles: ["BUYER"] }),
    ).resolves.toBeTruthy();
  });
});

describe("project management", () => {
  it("allows only admins to create, update and archive", async () => {
    await expectAppError(
      createProject(member, { name: "ახალი", address: "მისამართი 1" }),
      "FORBIDDEN",
    );
    await expectAppError(
      updateProject(member, projectId, { name: "შეცვლილი", address: "მისამართი 2" }),
      "FORBIDDEN",
    );
    await expectAppError(setProjectArchived(member, projectId, true), "FORBIDDEN");
  });

  it("validates input with Georgian messages", async () => {
    const err = await expectAppError(
      createProject(admin, { name: "ა", address: "" }),
      "VALIDATION",
    );
    expect(err.fieldErrors?.name).toBe("მინიმუმ 2 სიმბოლო.");
    expect(err.fieldErrors?.address).toBeTruthy();
  });

  it("rejects duplicate project names in the same organization", async () => {
    await expectAppError(
      createProject(admin, { name: "ვაკის ობიექტი", address: "სხვა მისამართი" }),
      "CONFLICT",
    );
    // Same name in another organization is fine.
    await expect(
      createProject(otherOrgAdmin, { name: "ვაკის ობიექტი", address: "სხვა მისამართი" }),
    ).resolves.toBeTruthy();
  });

  it("keeps archived projects readable but read-only", async () => {
    await setProjectArchived(admin, projectId, true);
    expect(await listProjects(member)).toHaveLength(0);
    expect(await listProjects(member, { includeArchived: true })).toHaveLength(1);
    const { access } = await getProject(member, projectId);
    expect(access.archived).toBe(true);
    await expectAppError(
      updateProject(admin, projectId, { name: "შეცვლილი", address: "მისამართი 2" }),
      "CONFLICT",
    );
    await setProjectArchived(admin, projectId, false);
    await expect(
      updateProject(admin, projectId, { name: "შეცვლილი", address: "მისამართი 2" }),
    ).resolves.toBeTruthy();
  });

  it("writes an audit trail", async () => {
    await updateProject(admin, projectId, { name: "განახლებული", address: "ახალი მისამართი" });
    await setProjectArchived(admin, projectId, true);
    const events = await db.auditEvent.findMany({
      where: { entityType: "Project", entityId: projectId },
      orderBy: { createdAt: "asc" },
    });
    expect(events.map((e) => e.action)).toEqual([
      "project.created",
      "project.updated",
      "project.archived",
    ]);
    expect(events.every((e) => e.actorId === admin.userId)).toBe(true);
  });
});

describe("memberships", () => {
  it("adds, updates and removes members with audit events", async () => {
    const m = await addMember(admin, projectId, {
      userId: outsider.userId,
      roles: ["BUYER", "BUYER", "RECEIVER"],
    });
    expect(m.roles).toEqual(["BUYER", "RECEIVER"]);
    await expect(getProject(outsider, projectId)).resolves.toBeTruthy();

    await updateMemberRoles(admin, projectId, m.id, ["RECEIVER"]);
    await removeMember(admin, projectId, m.id);
    await expectAppError(getProject(outsider, projectId), "FORBIDDEN");

    const actions = (
      await db.auditEvent.findMany({
        where: { entityType: "ProjectMembership", entityId: m.id },
        orderBy: { createdAt: "asc" },
      })
    ).map((e) => e.action);
    expect(actions).toEqual(["member.added", "member.roles_changed", "member.removed"]);
  });

  it("rejects duplicates, empty roles and users from another organization", async () => {
    await expectAppError(
      addMember(admin, projectId, { userId: member.userId, roles: ["BUYER"] }),
      "CONFLICT",
    );
    await expectAppError(
      addMember(admin, projectId, { userId: outsider.userId, roles: [] }),
      "VALIDATION",
    );
    await expectAppError(
      addMember(admin, projectId, { userId: otherOrgAdmin.userId, roles: ["BUYER"] }),
      "VALIDATION",
    );
  });

  it("does not let members manage membership", async () => {
    await expectAppError(
      addMember(member, projectId, { userId: outsider.userId, roles: ["BUYER"] }),
      "FORBIDDEN",
    );
  });

  it("does not let another organization's admin touch the project", async () => {
    await expectAppError(
      addMember(otherOrgAdmin, projectId, { userId: otherOrgAdmin.userId, roles: ["BUYER"] }),
      "NOT_FOUND",
    );
  });
});

describe("users", () => {
  it("creates a login-capable user in the admin's organization", async () => {
    const u = await createUser(admin, {
      name: "ახალი თანამშრომელი",
      email: "  New.User@Test.Example ",
      password: "very-secret-pass",
      isAdmin: false,
    });
    const row = await db.user.findUniqueOrThrow({
      where: { id: u.id },
      include: { accounts: true },
    });
    expect(row.email).toBe("new.user@test.example");
    expect(row.organizationId).toBe(admin.organizationId);
    expect(row.accounts[0]?.providerId).toBe("credential");
    expect(row.accounts[0]?.password).not.toContain("very-secret-pass");
  });

  it("rejects duplicate emails, short passwords and non-admins", async () => {
    const input = { name: "ერთი", email: "dup@test.example", password: "1234567890" };
    await createUser(admin, input);
    await expectAppError(createUser(admin, input), "CONFLICT");
    await expectAppError(
      createUser(admin, { ...input, email: "x@test.example", password: "short" }),
      "VALIDATION",
    );
    await expectAppError(createUser(member, { ...input, email: "y@test.example" }), "FORBIDDEN");
  });

  it("deactivation ends sessions and cannot target yourself", async () => {
    await db.session.create({
      data: {
        id: "s1",
        token: "t1",
        userId: member.userId,
        expiresAt: new Date(Date.now() + 3600_000),
      },
    });
    await setUserActive(admin, member.userId, false);
    expect(await db.session.count({ where: { userId: member.userId } })).toBe(0);
    await expectAppError(setUserActive(admin, admin.userId, false), "VALIDATION");
    await expectAppError(setUserActive(otherOrgAdmin, member.userId, true), "NOT_FOUND");
  });
});
