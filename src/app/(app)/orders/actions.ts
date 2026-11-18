"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { formId, formPayload, runAction, type ActionState } from "@/server/action";
import { cancelOrder, closeOrder, createOrder } from "@/server/orders/service";
import { correctReceiptItem, createReceipt } from "@/server/receipts/service";
import { requireUser } from "@/server/session";

// Ids come from hidden form fields (see formId in server/action.ts for why not .bind()).

type Changed = { orderId: string; requestId: string };

/** Run a change, then revalidate the order, its request and both lists (ids from the service). */
async function mutate(fn: () => Promise<Changed>, message: string): Promise<ActionState> {
  const ref: { changed?: Changed } = {};
  const state = await runAction(async () => {
    ref.changed = await fn();
    return message;
  });
  if (ref.changed) {
    revalidatePath(`/orders/${ref.changed.orderId}`);
    revalidatePath("/orders");
    revalidatePath(`/requests/${ref.changed.requestId}`);
    revalidatePath("/requests");
  }
  return state;
}

export async function createOrderAction(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  let orderId = "";
  const state = await runAction(async () => {
    orderId = (await createOrder(user, formPayload(form))).id;
  });
  if (!state.ok) {
    // Another order may have been placed meanwhile (that is a typical reason for the error):
    // refresh the form's approved/ordered/remaining figures. Typed values stay in client state.
    revalidatePath("/orders/new");
    return state;
  }
  revalidatePath("/orders");
  revalidatePath("/requests");
  redirect(`/orders/${orderId}?notice=created`);
}

export async function cancelOrderAction(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  return mutate(async () => {
    const orderId = formId(form, "orderId");
    const { requestId } = await cancelOrder(user, orderId, String(form.get("reason") ?? ""));
    return { orderId, requestId };
  }, "შეკვეთა გაუქმდა.");
}

export async function closeOrderAction(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  return mutate(async () => {
    const orderId = formId(form, "orderId");
    const { requestId } = await closeOrder(user, orderId, String(form.get("reason") ?? ""));
    return { orderId, requestId };
  }, "შეკვეთა დაიხურა. დარჩენილი რაოდენობა მოთხოვნაში დაბრუნდა.");
}

export async function createReceiptAction(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  return mutate(async () => {
    const payload = formPayload(form);
    const orderId = formId(form, "orderId");
    return createReceipt(user, { ...(payload as object), orderId });
  }, "მიწოდება დაფიქსირდა.");
}

export async function correctReceiptAction(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  return mutate(
    () =>
      correctReceiptItem(user, formId(form, "receiptItemId"), {
        quantity: String(form.get("quantity") ?? ""),
        reason: String(form.get("reason") ?? ""),
      }),
    "მიღება შესწორდა.",
  );
}
