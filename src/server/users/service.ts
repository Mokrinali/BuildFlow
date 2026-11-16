import { hashPassword } from "better-auth/crypto";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { errors } from "@/lib/i18n/ka";
import { assertAdmin, type Actor } from "@/server/access";
import { recordEvent } from "@/server/audit";
import { AppError, isUniqueViolation, notFound } from "@/server/errors";
import { parseInput } from "@/server/validation";

export const createUserInput = z.object({
  name: z.string().trim().min(2, "მინიმუმ 2 სიმბოლო.").max(100, "მაქსიმუმ 100 სიმბოლო."),
  email: z.string().trim().toLowerCase().pipe(z.email("ელფოსტის ფორმატი არასწორია.")),
  password: z
    .string()
    .min(10, "პაროლი უნდა შეიცავდეს მინიმუმ 10 სიმბოლოს.")
    .max(128, "მაქსიმუმ 128 სიმბოლო."),
  isAdmin: z.boolean().default(false),
});

export async function listUsers(actor: Actor) {
  assertAdmin(actor);
  return db.user.findMany({
    where: { organizationId: actor.organizationId },
    orderBy: { name: "asc" },
    select: { id: true, name: true, email: true, orgRole: true, isActive: true },
  });
}

/**
 * Create a user with an email/password login in the actor's organization.
 * Writes the Better Auth `user` and `account` rows directly (public sign-up is disabled).
 */
export async function createUser(actor: Actor, raw: unknown) {
  assertAdmin(actor);
  const input = parseInput(createUserInput, raw);
  const passwordHash = await hashPassword(input.password);
  try {
    return await db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          id: randomUUID(),
          name: input.name,
          email: input.email,
          emailVerified: true,
          organizationId: actor.organizationId,
          orgRole: input.isAdmin ? "ADMIN" : "MEMBER",
        },
      });
      await tx.account.create({
        data: {
          id: randomUUID(),
          userId: user.id,
          accountId: user.id,
          providerId: "credential",
          password: passwordHash,
        },
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

/** Deactivate or reactivate a user. Deactivation also ends their sessions. */
export async function setUserActive(actor: Actor, userId: string, active: boolean) {
  assertAdmin(actor);
  if (userId === actor.userId && !active) {
    throw new AppError("VALIDATION", "საკუთარი ანგარიშის გათიშვა შეუძლებელია.");
  }
  return db.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!user || user.organizationId !== actor.organizationId) throw notFound();
    await tx.user.update({ where: { id: userId }, data: { isActive: active } });
    if (!active) await tx.session.deleteMany({ where: { userId } });
    await recordEvent(tx, actor, {
      entityType: "User",
      entityId: userId,
      action: active ? "user.activated" : "user.deactivated",
    });
  });
}
