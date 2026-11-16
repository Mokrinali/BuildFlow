import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Badge, ButtonLink, Card, EmptyState, PageHeader } from "@/components/ui";
import type { ProjectRole } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { projectRoleLabel, projectStatusLabel, requestEventLabel } from "@/lib/i18n/ka";
import { AppError } from "@/server/errors";
import { getProject } from "@/server/projects/service";
import { requireUser } from "@/server/session";
import { listUsers } from "@/server/users/service";
import { ProjectForm } from "../project-form";
import { AddMemberForm, ArchiveButton, MemberRow } from "./members";

export const metadata: Metadata = { title: "პროექტი" };

type Props = { params: Promise<{ projectId: string }> };

const eventLabel: Record<string, string> = {
  "project.created": "პროექტი შეიქმნა",
  "project.updated": "პროექტის მონაცემები შეიცვალა",
  "project.archived": "პროექტი არქივირდა",
  "project.restored": "პროექტი აღდგა",
  "member.added": "წევრი დაემატა",
  "member.roles_changed": "წევრის როლები შეიცვალა",
  "member.removed": "წევრი წაიშალა",
};

export default async function ProjectPage({ params }: Props) {
  const { projectId } = await params;
  const user = await requireUser();

  let data;
  try {
    data = await getProject(user, projectId);
  } catch (e) {
    // Hide both "does not exist" and "no access" behind the same 404.
    if (e instanceof AppError && (e.code === "NOT_FOUND" || e.code === "FORBIDDEN")) notFound();
    throw e;
  }
  const { project, access } = data;
  const editable = user.isAdmin && !access.archived;

  const memberIds = new Set(project.memberships.map((m) => m.user.id));
  const candidates = editable
    ? (await listUsers(user)).filter((u) => u.isActive && !memberIds.has(u.id))
    : [];
  const events = await db.auditEvent.findMany({
    where: { projectId, organizationId: user.organizationId },
    orderBy: { seq: "desc" },
    take: 20,
    select: { id: true, action: true, createdAt: true, actor: { select: { name: true } } },
  });

  return (
    <>
      <PageHeader
        title={project.name}
        actions={
          user.isAdmin ? (
            <ArchiveButton projectId={project.id} archived={access.archived} />
          ) : undefined
        }
      />
      <div className="mb-6 flex flex-wrap items-center gap-3 text-sm">
        <Badge tone={access.archived ? "gray" : "green"}>
          {projectStatusLabel[project.status]}
        </Badge>
        <span className="text-steel-600">{project.address}</span>
        {!user.isAdmin && access.roles.length > 0 && (
          <span>
            თქვენი როლები: {access.roles.map((r: ProjectRole) => projectRoleLabel[r]).join(", ")}
          </span>
        )}
      </div>
      {access.archived && (
        <p className="mb-6 rounded-md bg-gray-100 px-3 py-2 text-sm">
          პროექტი არქივირებულია. ისტორია ხელმისაწვდომია მხოლოდ სანახავად.
        </p>
      )}
      <div className="mb-6 flex flex-wrap gap-3">
        <ButtonLink href={`/requests?project=${project.id}`} variant="secondary">
          პროექტის მოთხოვნები
        </ButtonLink>
        {!access.archived && (access.isAdmin || access.roles.includes("REQUESTER")) && (
          <ButtonLink href={`/requests/new?project=${project.id}`}>ახალი მოთხოვნა</ButtonLink>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <Card>
          <h2 className="mb-4 text-lg font-semibold">წევრები</h2>
          {project.memberships.length === 0 ? (
            <EmptyState title="პროექტს წევრები არ ჰყავს" />
          ) : (
            <ul className="divide-y divide-line">
              {project.memberships.map((m) => (
                <MemberRow
                  key={m.id}
                  projectId={project.id}
                  membership={m}
                  editable={editable}
                  removable={user.isAdmin}
                />
              ))}
            </ul>
          )}
          {editable && (
            <div className="mt-6 border-t border-line pt-6">
              <h3 className="mb-3 font-semibold">წევრის დამატება</h3>
              {candidates.length === 0 ? (
                <p className="text-sm text-steel-600">
                  დასამატებელი მომხმარებელი არ არის. ახალი მომხმარებელი შექმენით გვერდზე
                  „მომხმარებლები“.
                </p>
              ) : (
                <AddMemberForm projectId={project.id} candidates={candidates} />
              )}
            </div>
          )}
        </Card>

        <div className="flex flex-col gap-6">
          {editable && (
            <Card>
              <h2 className="mb-4 text-lg font-semibold">პროექტის მონაცემები</h2>
              <ProjectForm project={project} />
            </Card>
          )}
          <Card>
            <h2 className="mb-4 text-lg font-semibold">ქრონოლოგია</h2>
            {events.length === 0 ? (
              <p className="text-sm text-steel-600">მოვლენები არ არის.</p>
            ) : (
              <ol className="flex flex-col gap-3 text-sm">
                {events.map((e) => (
                  <li key={e.id}>
                    <p>{eventLabel[e.action] ?? requestEventLabel[e.action] ?? e.action}</p>
                    <p className="text-xs text-steel-600">
                      {formatDateTime(e.createdAt)} · {e.actor?.name ?? "სისტემა"}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
