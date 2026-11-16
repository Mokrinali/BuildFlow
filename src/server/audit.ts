import type { Prisma } from "@/generated/prisma/client";
import type { Tx } from "@/lib/db";
import type { Actor } from "@/server/access";

export type AuditInput = {
  entityType: string;
  entityId: string;
  action: string;
  projectId?: string | null;
  changes?: Prisma.InputJsonValue;
  reason?: string | null;
};

/** Record an audit event inside the same transaction as the change it describes. */
export async function recordEvent(tx: Tx, actor: Actor, input: AuditInput): Promise<void> {
  await tx.auditEvent.create({
    data: {
      organizationId: actor.organizationId,
      actorId: actor.userId,
      projectId: input.projectId ?? null,
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
      changes: input.changes,
      reason: input.reason ?? null,
    },
  });
}
