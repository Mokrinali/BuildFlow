"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { errors } from "@/lib/i18n/ka";
import { formId, formPayload, runAction, type ActionState } from "@/server/action";
import { AppError } from "@/server/errors";
import {
  adjustApprovedQuantity,
  approveRequest,
  cancelRequest,
  createRequest,
  decideItemCancellation,
  rejectRequest,
  requestItemCancellation,
  reopenRequest,
  returnToDraft,
  submitRequest,
  updateRequest,
  withdrawItemCancellation,
  withdrawRequest,
} from "@/server/requests/service";
import { requireUser } from "@/server/session";

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
    const payload = formPayload(form);
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

/** The submission the reviewer saw. Required for approve/reject; a stale page is refused. */
function reviewedSubmission(form: FormData): { expectedSubmittedAt: Date | null } {
  const raw = form.get("submittedAt");
  if (typeof raw !== "string") throw new AppError("VALIDATION", errors.invalidInput);
  if (raw === "") return { expectedSubmittedAt: null };
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) throw new AppError("VALIDATION", errors.invalidInput);
  return { expectedSubmittedAt: d };
}

export async function submitAction(_: ActionState, form: FormData): Promise<ActionState> {
  return runTransition(form, submitRequest, "მოთხოვნა გაიგზავნა განსახილველად.");
}
export async function withdrawAction(_: ActionState, form: FormData): Promise<ActionState> {
  return runTransition(form, withdrawRequest, "მოთხოვნა დაბრუნდა მონახაზში.");
}
export async function approveAction(_: ActionState, form: FormData): Promise<ActionState> {
  return runTransition(
    form,
    (u, rid) => approveRequest(u, rid, reviewedSubmission(form)),
    "მოთხოვნა დამტკიცდა.",
  );
}
export async function returnToDraftAction(_: ActionState, form: FormData): Promise<ActionState> {
  return runTransition(form, returnToDraft, "მოთხოვნა დაბრუნდა მონახაზში.");
}
export async function rejectAction(_: ActionState, form: FormData): Promise<ActionState> {
  return runTransition(
    form,
    (u, rid) => rejectRequest(u, rid, reasonOf(form), reviewedSubmission(form)),
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

// ─── Item-level: approved quantity and remainder cancellation ────────────────

async function runItemAction(
  form: FormData,
  fn: (requestId: string) => Promise<unknown>,
  message: string,
) {
  let requestId = "";
  const state = await runAction(async () => {
    requestId = formId(form, "requestId");
    await fn(requestId);
    return message;
  });
  if (state.ok) {
    revalidatePath(`/requests/${requestId}`);
    revalidatePath("/requests");
    revalidatePath("/orders");
    revalidatePath("/");
  }
  return state;
}

export async function adjustItemAction(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  return runItemAction(
    form,
    (rid) =>
      adjustApprovedQuantity(user, rid, {
        itemId: formId(form, "itemId"),
        quantity: String(form.get("quantity") ?? ""),
        reason: reasonOf(form),
      }),
    "დამტკიცებული რაოდენობა შეიცვალა.",
  );
}

export async function askItemCancelAction(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  return runItemAction(
    form,
    (rid) =>
      requestItemCancellation(user, rid, {
        itemId: formId(form, "itemId"),
        reason: reasonOf(form),
      }),
    "გაუქმების მოთხოვნა გაიგზავნა. გაუქმდება მეორე მხარის დადასტურების შემდეგ.",
  );
}

export async function decideItemCancelAction(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const decision = form.get("decision") === "confirm" ? "confirm" : "reject";
  return runItemAction(
    form,
    (rid) =>
      decideItemCancellation(user, rid, {
        cancellationId: formId(form, "cancellationId"),
        decision,
        reason: reasonOf(form),
      }),
    decision === "confirm" ? "გაუქმება დადასტურდა." : "გაუქმება უარყოფილია.",
  );
}

export async function withdrawItemCancelAction(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  return runItemAction(
    form,
    (rid) =>
      withdrawItemCancellation(user, rid, { cancellationId: formId(form, "cancellationId") }),
    "გაუქმების მოთხოვნა გაწვეულია.",
  );
}
