import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Badge, Card, PageHeader } from "@/components/ui";
import { orgRoleLabel } from "@/lib/i18n/ka";
import { requireUser } from "@/server/session";
import { listUsers } from "@/server/users/service";
import { ResetPasswordForm, ToggleActiveButton, UserForm } from "./user-form";

export const metadata: Metadata = { title: "მომხმარებლები" };

export default async function UsersPage() {
  const user = await requireUser();
  if (!user.isAdmin) notFound();
  const users = await listUsers(user);

  return (
    <>
      <PageHeader title="მომხმარებლები" />
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <Card>
          <ul className="divide-y divide-line">
            {users.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{u.name}</p>
                  <p className="truncate text-sm text-steel-600">{u.email}</p>
                </div>
                <Badge tone={u.orgRole === "ADMIN" ? "orange" : "navy"}>
                  {orgRoleLabel[u.orgRole]}
                </Badge>
                {!u.isActive && <Badge tone="gray">გათიშული</Badge>}
                {u.mustChangePassword && <Badge tone="gray">დროებითი პაროლი</Badge>}
                {u.id !== user.userId && (
                  <>
                    <ToggleActiveButton userId={u.id} active={u.isActive} />
                    <ResetPasswordForm userId={u.id} userName={u.name} />
                  </>
                )}
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <h2 className="mb-4 text-lg font-semibold">ახალი მომხმარებელი</h2>
          <UserForm />
        </Card>
      </div>
    </>
  );
}
