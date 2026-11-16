"use server";

import { revalidatePath } from "next/cache";
import { runAction, type ActionState } from "@/server/action";
import { requireUser } from "@/server/session";
import { createUser, setUserActive } from "@/server/users/service";

export async function createUserAction(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const state = await runAction(async () => {
    const created = await createUser(user, {
      name: String(form.get("name") ?? ""),
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
      isAdmin: form.get("isAdmin") === "on",
    });
    return `მომხმარებელი ${created.name} შეიქმნა.`;
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
    await setUserActive(user, userId, active);
  });
  if (state.ok) revalidatePath("/users");
  return state;
}
