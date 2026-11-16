"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { errors } from "@/lib/i18n/ka";
import { formId, runAction, type ActionState } from "@/server/action";
import { AppError } from "@/server/errors";
import {
  approveRequest,
  cancelRequest,
  createRequest,
  rejectRequest,
  reopenRequest,
  returnToDraft,
  submitRequest,
  updateRequest,
  withdrawRequest,
} from "@/server/requests/service";
import { requireUser } from "@/server/session";

const MAX_PAYLOAD = 200_000; // characters; the item cap is enforced by the service

function readPayload(form: FormData): unknown {
  const raw = form.get("payload");
  if (typeof raw !== "string" || raw.length > MAX_PAYLOAD) {
    throw new AppError("VALIDATION", errors.invalidInput);
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new AppError("VALIDATION", errors.invalidInput);
  }
}

/**
 * Create (no requestId field) or edit a draft; `intent=submit` also sends it for review.
 * Ids come from hidden form fields (see formId in server/action.ts for why not .bind()).
 */
export async function saveRequestAction(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const submit = form.get("intent") === "submit";
  const requestId = form.get("requestId") ? String(form.get("requestId")) : null;
  let id = requestId ?? "";
  let saved = false;
  const state = await runAction(async () => {
    const payload = readPayload(form);
    if (requestId) {
      id = formId(form, "requestId");
      await updateRequest(user, id, payload);
    } else {
      id = (await createRequest(user, payload)).id;
    }
    saved = true;
    if (submit) await submitRequest(user, id);
  });
  if (saved) revalidatePath("/requests");
  if (!state.ok) {
    // The draft was saved but submitting failed: go to the request and show why.
    if (saved && !requestId) redirect(`/requests/${id}?notice=saved-not-submitted`);
    return state;
  }
  redirect(`/requests/${id}${submit ? "?notice=submitted" : "?notice=saved"}`);
}

type Transition = (user: Awaited<ReturnType<typeof requireUser>>, id: string) => Promise<void>;

async function runTransition(form: FormData, fn: Transition, message: string) {
  const user = await requireUser();
  let requestId = "";
  const state = await runAction(async () => {
    requestId = formId(form, "requestId");
    await fn(user, requestId);
    return message;
  });
  if (state.ok) {
    revalidatePath(`/requests/${requestId}`);
    revalidatePath("/requests");
  }
  return state;
}

const reasonOf = (form: FormData) => String(form.get("reason") ?? "");

export async function submitAction(_: ActionState, form: FormData): Promise<ActionState> {
  return runTransition(form, submitRequest, "მოთხოვნა გაიგზავნა განსახილველად.");
}
export async function withdrawAction(_: ActionState, form: FormData): Promise<ActionState> {
  return runTransition(form, withdrawRequest, "მოთხოვნა დაბრუნდა მონახაზში.");
}
export async function approveAction(_: ActionState, form: FormData): Promise<ActionState> {
  return runTransition(form, approveRequest, "მოთხოვნა დამტკიცდა.");
}
export async function returnToDraftAction(_: ActionState, form: FormData): Promise<ActionState> {
  return runTransition(form, returnToDraft, "მოთხოვნა დაბრუნდა მონახაზში.");
}
export async function rejectAction(_: ActionState, form: FormData): Promise<ActionState> {
  return runTransition(
    form,
    (u, rid) => rejectRequest(u, rid, reasonOf(form)),
    "მოთხოვნა უარყოფილია.",
  );
}
export async function reopenAction(_: ActionState, form: FormData): Promise<ActionState> {
  return runTransition(
    form,
    (u, rid) => reopenRequest(u, rid, reasonOf(form)),
    "მოთხოვნა გაიხსნა შესაცვლელად.",
  );
}
export async function cancelAction(_: ActionState, form: FormData): Promise<ActionState> {
  return runTransition(
    form,
    (u, rid) => cancelRequest(u, rid, reasonOf(form)),
    "მოთხოვნა გაუქმდა.",
  );
}
