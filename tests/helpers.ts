import { randomUUID } from "node:crypto";
import type { ProjectRole } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import type { Actor } from "@/server/access";

/** Remove all rows (test database only; guarded in setup-env.ts). */
export async function resetDb() {
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length === 0) return;
  const list = tables.map((t) => `"public"."${t.tablename}"`).join(", ");
  await db.$executeRawUnsafe(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
}

export async function createOrg(name = "სატესტო ორგანიზაცია") {
  return db.organization.create({ data: { name } });
}

export async function createActor(
  organizationId: string,
  opts: { admin?: boolean; name?: string } = {},
): Promise<Actor> {
  const id = randomUUID();
  await db.user.create({
    data: {
      id,
      name: opts.name ?? "სატესტო მომხმარებელი",
      email: `${id}@test.example`,
      organizationId,
      orgRole: opts.admin ? "ADMIN" : "MEMBER",
    },
  });
  return { userId: id, organizationId, isAdmin: !!opts.admin };
}

export async function addMembership(projectId: string, userId: string, roles: ProjectRole[]) {
  return db.projectMembership.create({ data: { projectId, userId, roles } });
}
