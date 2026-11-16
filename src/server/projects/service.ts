import { z } from "zod";
import type { ProjectRole } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { errors } from "@/lib/i18n/ka";
import {
  assertAdmin,
  requireProjectAccess,
  visibleProjectsWhere,
  type Actor,
} from "@/server/access";
import { recordEvent } from "@/server/audit";
import { AppError, isUniqueViolation, notFound } from "@/server/errors";
import { parseInput } from "@/server/validation";

const roleEnum = z.enum(["REQUESTER", "BUYER", "RECEIVER"]);

export const projectInput = z.object({
  name: z.string().trim().min(2, "მინიმუმ 2 სიმბოლო.").max(120, "მაქსიმუმ 120 სიმბოლო."),
  address: z.string().trim().min(3, "მიუთითეთ მისამართი.").max(300, "მაქსიმუმ 300 სიმბოლო."),
});

export const memberInput = z.object({
  userId: z.string().min(1, "აირჩიეთ მომხმარებელი."),
  roles: z.array(roleEnum).min(1, errors.rolesRequired),
});

// ─── Queries ─────────────────────────────────────────────────────────────────

export async function listProjects(actor: Actor, opts: { includeArchived?: boolean } = {}) {
  return db.project.findMany({
    where: {
      ...visibleProjectsWhere(actor),
      ...(opts.includeArchived ? {} : { status: "ACTIVE" as const }),
    },
    orderBy: [{ status: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      address: true,
      status: true,
      _count: { select: { memberships: true } },
    },
  });
}

export async function getProject(actor: Actor, projectId: string) {
  const access = await requireProjectAccess(db, actor, projectId);
  const project = await db.project.findUniqueOrThrow({
    where: { id: projectId },
    select: {
      id: true,
      name: true,
      address: true,
      status: true,
      archivedAt: true,
      createdAt: true,
      memberships: {
        orderBy: { user: { name: "asc" } },
        select: {
          id: true,
          roles: true,
          user: { select: { id: true, name: true, email: true, isActive: true } },
        },
      },
    },
  });
  return { project, access };
}

// ─── Mutations (admin only) ──────────────────────────────────────────────────

export async function createProject(actor: Actor, raw: unknown) {
  assertAdmin(actor);
  const input = parseInput(projectInput, raw);
  try {
    return await db.$transaction(async (tx) => {
      const project = await tx.project.create({
        data: { organizationId: actor.organizationId, name: input.name, address: input.address },
      });
      await recordEvent(tx, actor, {
        entityType: "Project",
        entityId: project.id,
        projectId: project.id,
        action: "project.created",
        changes: { name: input.name, address: input.address },
      });
      return project;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw nameTaken();
    throw e;
  }
}

export async function updateProject(actor: Actor, projectId: string, raw: unknown) {
  assertAdmin(actor);
  const input = parseInput(projectInput, raw);
  try {
    return await db.$transaction(async (tx) => {
      await requireProjectAccess(tx, actor, projectId, { write: true });
      const before = await tx.project.findUniqueOrThrow({ where: { id: projectId } });
      const project = await tx.project.update({ where: { id: projectId }, data: input });
      await recordEvent(tx, actor, {
        entityType: "Project",
        entityId: projectId,
        projectId,
        action: "project.updated",
        changes: {
          before: { name: before.name, address: before.address },
          after: { name: project.name, address: project.address },
        },
      });
      return project;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw nameTaken();
    throw e;
  }
}

export async function setProjectArchived(actor: Actor, projectId: string, archived: boolean) {
  assertAdmin(actor);
  return db.$transaction(async (tx) => {
    await requireProjectAccess(tx, actor, projectId);
    const project = await tx.project.update({
      where: { id: projectId },
      data: archived
        ? { status: "ARCHIVED", archivedAt: new Date() }
        : { status: "ACTIVE", archivedAt: null },
    });
    await recordEvent(tx, actor, {
      entityType: "Project",
      entityId: projectId,
      projectId,
      action: archived ? "project.archived" : "project.restored",
    });
    return project;
  });
}

export async function addMember(actor: Actor, projectId: string, raw: unknown) {
  assertAdmin(actor);
  const input = parseInput(memberInput, raw);
  const roles = dedupe(input.roles);
  try {
    return await db.$transaction(async (tx) => {
      await requireProjectAccess(tx, actor, projectId, { write: true });
      const user = await tx.user.findUnique({
        where: { id: input.userId },
        select: { organizationId: true },
      });
      if (!user || user.organizationId !== actor.organizationId) {
        throw new AppError("VALIDATION", errors.userOtherOrg, { userId: errors.userOtherOrg });
      }
      const membership = await tx.projectMembership.create({
        data: { projectId, userId: input.userId, roles },
      });
      await recordEvent(tx, actor, {
        entityType: "ProjectMembership",
        entityId: membership.id,
        projectId,
        action: "member.added",
        changes: { userId: input.userId, roles },
      });
      return membership;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new AppError("CONFLICT", errors.memberExists);
    throw e;
  }
}

export async function updateMemberRoles(
  actor: Actor,
  projectId: string,
  membershipId: string,
  raw: unknown,
) {
  assertAdmin(actor);
  const roles = dedupe(parseInput(memberInput.shape.roles, raw));
  return db.$transaction(async (tx) => {
    await requireProjectAccess(tx, actor, projectId, { write: true });
    const before = await tx.projectMembership.findUnique({ where: { id: membershipId } });
    if (!before || before.projectId !== projectId) throw notFound();
    const membership = await tx.projectMembership.update({
      where: { id: membershipId },
      data: { roles },
    });
    await recordEvent(tx, actor, {
      entityType: "ProjectMembership",
      entityId: membershipId,
      projectId,
      action: "member.roles_changed",
      changes: { userId: before.userId, before: before.roles, after: roles },
    });
    return membership;
  });
}

export async function removeMember(actor: Actor, projectId: string, membershipId: string) {
  assertAdmin(actor);
  return db.$transaction(async (tx) => {
    await requireProjectAccess(tx, actor, projectId, { write: true });
    const membership = await tx.projectMembership.findUnique({ where: { id: membershipId } });
    if (!membership || membership.projectId !== projectId) throw notFound();
    await tx.projectMembership.delete({ where: { id: membershipId } });
    await recordEvent(tx, actor, {
      entityType: "ProjectMembership",
      entityId: membershipId,
      projectId,
      action: "member.removed",
      changes: { userId: membership.userId, roles: membership.roles },
    });
  });
}

function dedupe(roles: ProjectRole[]): ProjectRole[] {
  return [...new Set(roles)];
}

function nameTaken() {
  return new AppError("CONFLICT", errors.projectNameTaken, { name: errors.projectNameTaken });
}
