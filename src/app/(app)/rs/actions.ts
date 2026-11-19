"use server";

import { revalidatePath } from "next/cache";
import { runAction, type ActionState } from "@/server/action";
import { saveRsSettings, testRsConnection } from "@/server/rs/service";
import { requireUser } from "@/server/session";

export async function saveRsSettingsAction(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const state = await runAction(async () => {
    await saveRsSettings(user, {
      mode: String(form.get("mode") ?? ""),
      serviceUser: String(form.get("serviceUser") ?? ""),
      password: String(form.get("password") ?? ""),
    });
    return "პარამეტრები შენახულია.";
  });
  if (state.ok) revalidatePath("/rs");
  return state;
}

export async function testRsConnectionAction(_: ActionState): Promise<ActionState> {
  const user = await requireUser();
  return runAction(() => testRsConnection(user));
}
