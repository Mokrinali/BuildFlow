import { hashPassword, verifyPassword } from "better-auth/crypto";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Tx } from "@/lib/db";
import { db } from "@/lib/db";
import { errors } from "@/lib/i18n/ka";
import { assertAdmin, type Actor } from "@/server/access";
import { recordEvent } from "@/server/audit";
import { AppError, isUniqueViolation, notFound } from "@/server/errors";
import { parseInput } from "@/server/validation";

const passwordSchema = z
  .string()
  .min(10, "პაროლი უნდა შეიცავდეს მინიმუმ 10 სიმბოლოს.")
  .max(128, "მაქსიმუმ 128 სიმბოლო.");

export const createUserInput = z.object({
  name: z.string().trim().min(2, "მინიმუმ 2 სიმბოლო.").max(100, "მაქსიმუმ 100 სიმბოლო."),
  email: z.string().trim().toLowerCase().pipe(z.email("ელფოსტის ფორმატი არასწორია.")),
  password: passwordSchema,
  isAdmin: z.boolean().default(false),
});

export const changePasswordInput = z
  .object({
    currentPassword: z.string().min(1, "შეიყვანეთ მიმდინარე პაროლი."),
    newPassword: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    path: ["confirmPassword"],
    message: "პაროლები არ ემთხვევა.",
  })
  .refine((v) => v.newPassword !== v.currentPassword, {
    path: ["newPassword"],
    message: "ახალი პაროლი უნდა განსხვავდებოდეს მიმდინარისგან.",
  });

export async function listUsers(actor: Actor) {
  assertAdmin(actor);
  return db.user.findMany({
    where: { organizationId: actor.organizationId },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      email: true,
      orgRole: true,
      isActive: true,
      mustChangePassword: true,
    },
  });
}

type NewUser = z.output<typeof createUserInput> & { mustChangePassword: boolean };

/**
 * Insert the Better Auth `user` + credential `account` rows (public sign-up is disabled).
 * Better Auth signs in only when providerId = "credential" and accountId = user.id.
 */
async function insertUser(tx: Tx, organizationId: string, input: NewUser) {
  const user = await tx.user.create({
    data: {
      id: randomUUID(),
      name: input.name,
      email: input.email,
      emailVerified: true,
      organizationId,
      orgRole: input.isAdmin ? "ADMIN" : "MEMBER",
      mustChangePassword: input.mustChangePassword,
    },
  });
  await tx.account.create({
    data: {
      id: randomUUID(),
      userId: user.id,
      accountId: user.id,
      providerId: "credential",
      password: await hashPassword(input.password),
    },
  });
  return user;
}

/** Admin creates a user with a temporary password (must be changed at first login). */
export async function createUser(actor: Actor, raw: unknown) {
  assertAdmin(actor);
  const input = parseInput(createUserInput, raw);
  try {
    return await db.$transaction(async (tx) => {
      const user = await insertUser(tx, actor.organizationId, {
        ...input,
        mustChangePassword: true,
      });
      await recordEvent(tx, actor, {
        entityType: "User",
        entityId: user.id,
        action: "user.created",
        changes: { name: user.name, email: user.email, orgRole: user.orgRole },
      });
      return { id: user.id, name: user.name, email: user.email };
    });
  } catch (e) {
    if (isUniqueViolation(e)) {
      throw new AppError("CONFLICT", errors.emailTaken, { email: errors.emailTaken });
    }
    throw e;
  }
}

/**
 * Bootstrap: create an organization and its first admin (CLI only, no actor).
 * The admin chose the password themselves, so no forced change.
 */
export async function createOrganizationWithAdmin(raw: {
  organizationName: string;
  name: string;
  email: string;
  password: string;
}) {
  const orgName = z.string().trim().min(2).max(200).parse(raw.organizationName);
  const input = parseInput(createUserInput, { ...raw, isAdmin: true });
  return db.$transaction(async (tx) => {
    const org = await tx.organization.create({ data: { name: orgName } });
    const user = await insertUser(tx, org.id, { ...input, mustChangePassword: false });
    await tx.auditEvent.create({
      data: {
        organizationId: org.id,
        actorId: user.id,
        entityType: "User",
        entityId: user.id,
        action: "user.created",
        changes: { name: user.name, email: user.email, orgRole: user.orgRole, bootstrap: true },
      },
    });
    return { organizationId: org.id, userId: user.id };
  });
}

/** Admin sets a new temporary password; the user must change it and all sessions end. */
export async function resetPassword(actor: Actor, userId: string, rawPassword: unknown) {
  assertAdmin(actor);
  const password = parseInput(z.object({ password: passwordSchema }), {
    password: rawPassword,
  }).password;
  const hash = await hashPassword(password);
  return db.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!user || user.organizationId !== actor.organizationId) throw notFound();
    const updated = await tx.account.updateMany({
      where: { userId, providerId: "credential" },
      data: { password: hash },
    });
    if (updated.count === 0) throw notFound();
    await tx.user.update({ where: { id: userId }, data: { mustChangePassword: true } });
    await tx.session.deleteMany({ where: { userId } });
    await recordEvent(tx, actor, {
      entityType: "User",
      entityId: userId,
      action: "user.password_reset",
    });
  });
}

/** The signed-in user changes their own password. Other sessions are ended. */
export async function changeOwnPassword(actor: Actor, currentSessionId: string, raw: unknown) {
  const input = parseInput(changePasswordInput, raw);
  const account = await db.account.findFirst({
    where: { userId: actor.userId, providerId: "credential" },
    select: { id: true, password: true },
  });
  if (!account?.password) throw notFound();
  const valid = await verifyPassword({ hash: account.password, password: input.currentPassword });
  if (!valid) {
    const msg = "მიმდინარე პაროლი არასწორია.";
    throw new AppError("VALIDATION", msg, { currentPassword: msg });
  }
  const hash = await hashPassword(input.newPassword);
  await db.$transaction(async (tx) => {
    await tx.account.update({ where: { id: account.id }, data: { password: hash } });
    await tx.user.update({ where: { id: actor.userId }, data: { mustChangePassword: false } });
    await tx.session.deleteMany({ where: { userId: actor.userId, id: { not: currentSessionId } } });
    await recordEvent(tx, actor, {
      entityType: "User",
      entityId: actor.userId,
      action: "user.password_changed",
    });
  });
}

/** Deactivate or reactivate a user. Deactivation also ends their sessions. */
export async function setUserActive(actor: Actor, userId: string, active: boolean) {
  assertAdmin(actor);
  if (userId === actor.userId && !active) {
    throw new AppError("VALIDATION", "საკუთარი ანგარიშის გათიშვა შეუძლებელია.");
  }
  return db.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!user || user.organizationId !== actor.organizationId) throw notFound();
    if (user.isActive === active) return; // nothing to change, no duplicate audit event
    await tx.user.update({ where: { id: userId }, data: { isActive: active } });
    if (!active) await tx.session.deleteMany({ where: { userId } });
    await recordEvent(tx, actor, {
      entityType: "User",
      entityId: userId,
      action: active ? "user.activated" : "user.deactivated",
    });
  });
}
