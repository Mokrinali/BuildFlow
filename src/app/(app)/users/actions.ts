"use server";

import { revalidatePath } from "next/cache";
import { parseBool, parseId, runAction, type ActionState } from "@/server/action";
import { requireUser } from "@/server/session";
import { createUser, resetPassword, setUserActive } from "@/server/users/service";

export async function createUserAction(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const state = await runAction(async () => {
    const created = await createUser(user, {
      name: String(form.get("name") ?? ""),
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
      isAdmin: form.get("isAdmin") === "on",
    });
    return `მომხმარებელი ${created.name} შეიქმნა. პირველი შესვლისას პაროლის შეცვლა მოუწევს.`;
  });
  if (state.ok) revalidatePath("/users");
  return state;
}

export async function setUserActiveAction(
  userId: string,
  active: boolean,
  _: ActionState,
): Promise<ActionState> {
  const user = await requireUser();
  const state = await runAction(async () => {
    await setUserActive(user, parseId(userId), parseBool(active));
  });
  if (state.ok) revalidatePath("/users");
  return state;
}

export async function resetPasswordAction(
  userId: string,
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const state = await runAction(async () => {
    await resetPassword(user, parseId(userId), String(form.get("password") ?? ""));
    return "დროებითი პაროლი დაყენებულია. მომხმარებელს შესვლისას შეცვლა მოუწევს.";
  });
  if (state.ok) revalidatePath("/users");
  return state;
}
