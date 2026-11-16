"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { formPayload, runAction, type ActionState } from "@/server/action";
import { confirmImport, previewImport, type ImportPreview } from "@/server/import/service";
import { requireUser } from "@/server/session";

export type PreviewState = ActionState & { preview?: ImportPreview };

/** Parse the pasted text. The text is passed to the parser only: never logged or stored. */
export async function previewImportAction(_: PreviewState, form: FormData): Promise<PreviewState> {
  const user = await requireUser();
  const ref: { preview?: ImportPreview } = {};
  const state = await runAction(async () => {
    ref.preview = await previewImport(user, {
      projectId: String(form.get("projectId") ?? ""),
      text: String(form.get("text") ?? ""),
    });
  });
  return { ...state, preview: ref.preview };
}

/** Create the draft from the reviewed items and open it. */
export async function confirmImportAction(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  let requestId = "";
  const state = await runAction(async () => {
    requestId = (await confirmImport(user, formPayload(form))).id;
  });
  if (!state.ok) return state;
  revalidatePath("/requests");
  redirect(`/requests/${requestId}?notice=imported`);
}
