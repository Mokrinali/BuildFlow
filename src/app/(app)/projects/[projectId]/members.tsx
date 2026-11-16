"use client";

import { useActionState } from "react";
import { Badge, Button, FormMessage } from "@/components/ui";
import { submitKeepingValues } from "@/components/keep-values";
import type { ProjectRole } from "@/generated/prisma/enums";
import { projectRoleLabel } from "@/lib/i18n/ka";
import { initialActionState } from "@/server/action-state";
import {
  addMemberAction,
  removeMemberAction,
  setArchivedAction,
  updateMemberAction,
} from "../actions";

const ROLES: ProjectRole[] = ["REQUESTER", "BUYER", "RECEIVER"];

function RoleCheckboxes({ selected, idPrefix }: { selected: ProjectRole[]; idPrefix: string }) {
  return (
    <fieldset className="flex flex-wrap gap-x-4 gap-y-2">
      <legend className="sr-only">როლები</legend>
      {ROLES.map((r) => (
        <label key={r} htmlFor={`${idPrefix}-${r}`} className="flex items-center gap-2 text-sm">
          <input
            id={`${idPrefix}-${r}`}
            type="checkbox"
            name="roles"
            value={r}
            defaultChecked={selected.includes(r)}
            className="h-4 w-4 accent-navy"
          />
          {projectRoleLabel[r]}
        </label>
      ))}
    </fieldset>
  );
}

export function MemberRow({
  projectId,
  membership,
  editable,
  removable = false,
}: {
  projectId: string;
  membership: {
    id: string;
    roles: ProjectRole[];
    user: { id: string; name: string; email: string; isActive: boolean };
  };
  editable: boolean;
  /** Admin on an archived project: roles are frozen, but access can still be revoked. */
  removable?: boolean;
}) {
  const [updState, updAction, updPending] = useActionState(updateMemberAction, initialActionState);
  const [rmState, rmAction, rmPending] = useActionState(removeMemberAction, initialActionState);
  const { user } = membership;

  return (
    <li className="py-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{user.name}</span>
        <span className="text-sm text-steel-600">{user.email}</span>
        {!user.isActive && <Badge tone="gray">გათიშული</Badge>}
      </div>
      {editable ? (
        <div className="mt-2 flex flex-col gap-2">
          <form action={updAction} className="flex flex-wrap items-center gap-3">
            <input type="hidden" name="projectId" value={projectId} />
            <input type="hidden" name="membershipId" value={membership.id} />
            <RoleCheckboxes selected={membership.roles} idPrefix={`m-${membership.id}`} />
            <Button type="submit" variant="secondary" disabled={updPending} className="min-h-9">
              როლების შენახვა
            </Button>
          </form>
          <form
            action={rmAction}
            onSubmit={(e) => {
              if (!confirm(`წავშალოთ ${user.name} პროექტიდან?`)) e.preventDefault();
            }}
          >
            <input type="hidden" name="projectId" value={projectId} />
            <input type="hidden" name="membershipId" value={membership.id} />
            <Button type="submit" variant="danger" disabled={rmPending} className="min-h-9">
              პროექტიდან წაშლა
            </Button>
          </form>
          <FormMessage ok={updState.ok} message={updState.message} />
          <FormMessage ok={rmState.ok} message={rmState.message} />
        </div>
      ) : (
        <div className="mt-1 flex flex-col gap-2">
          <div className="flex flex-wrap gap-1">
            {membership.roles.map((r) => (
              <Badge key={r}>{projectRoleLabel[r]}</Badge>
            ))}
          </div>
          {removable && (
            <>
              <form
                action={rmAction}
                onSubmit={(e) => {
                  if (!confirm(`წავშალოთ ${user.name} პროექტიდან?`)) e.preventDefault();
                }}
              >
                <input type="hidden" name="projectId" value={projectId} />
                <input type="hidden" name="membershipId" value={membership.id} />
                <Button type="submit" variant="danger" disabled={rmPending} className="min-h-9">
                  წვდომის გაუქმება
                </Button>
              </form>
              <FormMessage ok={rmState.ok} message={rmState.message} />
            </>
          )}
        </div>
      )}
    </li>
  );
}

export function AddMemberForm({
  projectId,
  candidates,
}: {
  projectId: string;
  candidates: { id: string; name: string; email: string }[];
}) {
  const [state, action, pending] = useActionState(addMemberAction, initialActionState);
  return (
    <form action={action} onSubmit={submitKeepingValues(action)} className="flex flex-col gap-3">
      <input type="hidden" name="projectId" value={projectId} />
      <div className="flex flex-col gap-1">
        <label htmlFor="add-member-user" className="text-sm font-medium">
          მომხმარებელი
        </label>
        <select
          id="add-member-user"
          name="userId"
          required
          className="min-h-10 rounded-md border border-steel bg-white px-2"
        >
          <option value="">აირჩიეთ…</option>
          {candidates.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name} ({u.email})
            </option>
          ))}
        </select>
        {state.fieldErrors?.userId && (
          <p className="text-sm text-red-800">{state.fieldErrors.userId}</p>
        )}
      </div>
      <RoleCheckboxes selected={["REQUESTER"]} idPrefix="add" />
      {state.fieldErrors?.roles && (
        <p className="text-sm text-red-800">{state.fieldErrors.roles}</p>
      )}
      <FormMessage ok={state.ok} message={state.message} />
      <Button type="submit" disabled={pending} className="self-start">
        დამატება
      </Button>
    </form>
  );
}

export function ArchiveButton({ projectId, archived }: { projectId: string; archived: boolean }) {
  const [state, action, pending] = useActionState(setArchivedAction, initialActionState);
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!archived && !confirm("დავაარქივოთ პროექტი? ისტორია შენარჩუნდება.")) e.preventDefault();
      }}
      className="flex items-center gap-2"
    >
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="archived" value={archived ? "0" : "1"} />
      <Button type="submit" variant="secondary" disabled={pending}>
        {archived ? "არქივიდან აღდგენა" : "არქივირება"}
      </Button>
      {!state.ok && state.message && (
        <span role="alert" className="text-sm text-red-800">
          {state.message}
        </span>
      )}
    </form>
  );
}
