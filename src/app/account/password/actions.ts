"use server";

import { redirect } from "next/navigation";
import { runAction, type ActionState } from "@/server/action";
import { requireUser } from "@/server/session";
import { changeOwnPassword } from "@/server/users/service";

export async function changePasswordAction(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser({ allowPasswordChange: true });
  const state = await runAction(async () => {
    await changeOwnPassword(user, user.sessionId, {
      currentPassword: String(form.get("currentPassword") ?? ""),
      newPassword: String(form.get("newPassword") ?? ""),
      confirmPassword: String(form.get("confirmPassword") ?? ""),
    });
  });
  if (!state.ok) return state;
  redirect("/?password=changed");
}
