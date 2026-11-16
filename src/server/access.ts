// Server-side access control. Every read and write goes through these checks.
import type { ProjectRole } from "@/generated/prisma/enums";
import type { Db, Tx } from "@/lib/db";
import { errors } from "@/lib/i18n/ka";
import { AppError, forbidden, notFound } from "@/server/errors";

/** The signed-in user performing an operation. */
export type Actor = {
  userId: string;
  organizationId: string;
  isAdmin: boolean;
};

export type ProjectAccess = {
  projectId: string;
  organizationId: string;
  archived: boolean;
  roles: ProjectRole[];
  isAdmin: boolean;
};

export function assertAdmin(actor: Actor): void {
  if (!actor.isAdmin) throw forbidden();
}

/**
 * Resolve the actor's access to a project.
 * - Other organization: NOT_FOUND (do not reveal that it exists).
 * - Same organization, not a member and not admin: FORBIDDEN.
 * - `requiredRoles`: the actor must hold at least one of them (admins pass).
 * - `write`: archived projects are read-only.
 */
export async function requireProjectAccess(
  client: Db | Tx,
  actor: Actor,
  projectId: string,
  opts: { requiredRoles?: ProjectRole[]; write?: boolean } = {},
): Promise<ProjectAccess> {
  // Writers share-lock the project row: archiving (an UPDATE) waits for them, and a writer that
  // starts after an archive commits sees ARCHIVED. Outside a transaction this is a no-op.
  if (opts.write) {
    await client.$queryRaw`SELECT 1 AS ok FROM "Project" WHERE "id" = ${projectId} FOR SHARE`;
  }
  const project = await client.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      organizationId: true,
      status: true,
      memberships: { where: { userId: actor.userId }, select: { roles: true } },
    },
  });
  if (!project || project.organizationId !== actor.organizationId) throw notFound();

  const roles = project.memberships[0]?.roles ?? [];
  const isMember = project.memberships.length > 0;
  if (!actor.isAdmin && !isMember) throw forbidden();
  if (opts.requiredRoles && !actor.isAdmin && !opts.requiredRoles.some((r) => roles.includes(r))) {
    throw forbidden();
  }
  const archived = project.status === "ARCHIVED";
  if (opts.write && archived) throw new AppError("CONFLICT", errors.projectArchived);

  return {
    projectId: project.id,
    organizationId: project.organizationId,
    archived,
    roles,
    isAdmin: actor.isAdmin,
  };
}

/** Prisma `where` fragment limiting projects to those the actor may see. */
export function visibleProjectsWhere(actor: Actor) {
  return actor.isAdmin
    ? { organizationId: actor.organizationId }
    : { organizationId: actor.organizationId, memberships: { some: { userId: actor.userId } } };
}
