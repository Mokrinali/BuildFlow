"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { runAction, type ActionState } from "@/server/action";
import {
  addMember,
  createProject,
  removeMember,
  setProjectArchived,
  updateMemberRoles,
  updateProject,
} from "@/server/projects/service";
import { requireUser } from "@/server/session";

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

export async function updateProjectAction(
  projectId: string,
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const state = await runAction(async () => {
    await updateProject(user, projectId, {
      name: str(form, "name"),
      address: str(form, "address"),
    });
    return "ცვლილებები შენახულია.";
  });
  if (state.ok) revalidatePath("/", "layout");
  return state;
}

export async function setArchivedAction(
  projectId: string,
  archived: boolean,
  _: ActionState,
): Promise<ActionState> {
  const user = await requireUser();
  const state = await runAction(async () => {
    await setProjectArchived(user, projectId, archived);
    return archived ? "პროექტი არქივირებულია." : "პროექტი აღდგენილია.";
  });
  if (state.ok) revalidatePath("/", "layout");
  return state;
}

export async function addMemberAction(
  projectId: string,
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const state = await runAction(async () => {
    await addMember(user, projectId, { userId: str(form, "userId"), roles: roles(form) });
    return "წევრი დამატებულია.";
  });
  if (state.ok) revalidatePath(`/projects/${projectId}`);
  return state;
}

export async function updateMemberAction(
  projectId: string,
  membershipId: string,
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const state = await runAction(async () => {
    await updateMemberRoles(user, projectId, membershipId, roles(form));
    return "როლები განახლებულია.";
  });
  if (state.ok) revalidatePath(`/projects/${projectId}`);
  return state;
}

export async function removeMemberAction(
  projectId: string,
  membershipId: string,
  _: ActionState,
): Promise<ActionState> {
  const user = await requireUser();
  const state = await runAction(async () => {
    await removeMember(user, projectId, membershipId);
    return "წევრი წაშლილია.";
  });
  if (state.ok) revalidatePath(`/projects/${projectId}`);
  return state;
}
