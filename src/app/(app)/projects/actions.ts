"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { formFlag, formId, runAction, type ActionState } from "@/server/action";
import {
  addMember,
  createProject,
  removeMember,
  setProjectArchived,
  updateMemberRoles,
  updateProject,
} from "@/server/projects/service";
import { requireUser } from "@/server/session";

// Ids and flags arrive as hidden form fields and are validated here (see formId in action.ts).
const str = (form: FormData, key: string) => String(form.get(key) ?? "");
const roles = (form: FormData) => form.getAll("roles").map(String);

export async function createProjectAction(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  let id = "";
  const state = await runAction(async () => {
    const project = await createProject(user, {
      name: str(form, "name"),
      address: str(form, "address"),
    });
    id = project.id;
  });
  if (!state.ok) return state;
  revalidatePath("/", "layout");
  redirect(`/projects/${id}`);
}

export async function updateProjectAction(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const state = await runAction(async () => {
    await updateProject(user, formId(form, "projectId"), {
      name: str(form, "name"),
      address: str(form, "address"),
    });
    return "ცვლილებები შენახულია.";
  });
  if (state.ok) revalidatePath("/", "layout");
  return state;
}

export async function setArchivedAction(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const state = await runAction(async () => {
    const archived = formFlag(form, "archived");
    await setProjectArchived(user, formId(form, "projectId"), archived);
    return archived ? "პროექტი არქივირებულია." : "პროექტი აღდგენილია.";
  });
  if (state.ok) revalidatePath("/", "layout");
  return state;
}

export async function addMemberAction(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  let projectId = "";
  const state = await runAction(async () => {
    projectId = formId(form, "projectId");
    await addMember(user, projectId, { userId: str(form, "userId"), roles: roles(form) });
    return "წევრი დამატებულია.";
  });
  if (state.ok) revalidatePath(`/projects/${projectId}`);
  return state;
}

export async function updateMemberAction(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  let projectId = "";
  const state = await runAction(async () => {
    projectId = formId(form, "projectId");
    await updateMemberRoles(user, projectId, formId(form, "membershipId"), roles(form));
    return "როლები განახლებულია.";
  });
  if (state.ok) revalidatePath(`/projects/${projectId}`);
  return state;
}

export async function removeMemberAction(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  let projectId = "";
  const state = await runAction(async () => {
    projectId = formId(form, "projectId");
    await removeMember(user, projectId, formId(form, "membershipId"));
    return "წევრი წაშლილია.";
  });
  if (state.ok) revalidatePath(`/projects/${projectId}`);
  return state;
}
