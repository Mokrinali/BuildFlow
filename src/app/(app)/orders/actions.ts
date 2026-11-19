"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { formId, formPayload, runAction, type ActionState } from "@/server/action";
import { cancelOrder, closeOrder, createOrder, setSupplierTaxId } from "@/server/orders/service";
import { correctReceiptItem, createReceipt, setReceiptWaybill } from "@/server/receipts/service";
import { applyRsWaybill, listReceiptWaybills, verifyReceiptWaybill } from "@/server/rs/service";
import type { RsListState, RsWaybillView } from "@/server/rs/view";
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

export async function setWaybillAction(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  return mutate(
    async () =>
      setReceiptWaybill(user, formId(form, "receiptId"), {
        waybillNumber: String(form.get("waybillNumber") ?? ""),
        waybillDate: String(form.get("waybillDate") ?? ""),
        reason: String(form.get("reason") ?? ""),
      }),
    "ზედნადები შენახულია.",
  );
}

// ─── RS.ge ───────────────────────────────────────────────────────────────────

/** Load the supplier's RS.ge waybills that can belong to a delivery. */
export async function listRsWaybillsAction(_: RsListState, form: FormData): Promise<RsListState> {
  const user = await requireUser();
  let options: RsWaybillView[] = [];
  const state = await runAction(async () => {
    const list = await listReceiptWaybills(user, formId(form, "receiptId"));
    options = list.map((w) => ({
      id: w.id,
      number: w.number,
      sellerName: w.sellerName,
      date: w.date,
      amount: w.amount,
      closed: w.status === "CLOSED",
      usedOn: w.usedOn,
    }));
    return list.length ? undefined : "RS.ge-ზე ამ მომწოდებლის შესაბამისი ზედნადები ვერ მოიძებნა.";
  });
  return { ...state, options };
}

export async function applyRsWaybillAction(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  return mutate(
    () =>
      applyRsWaybill(
        user,
        formId(form, "receiptId"),
        String(form.get("rsWaybillId") ?? "").slice(0, 64),
      ),
    "ზედნადები RS.ge-დან მიეთითა.",
  );
}

export async function verifyRsWaybillAction(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  let orderId = "";
  const state = await runAction(async () => {
    orderId = formId(form, "orderId");
    return verifyReceiptWaybill(user, formId(form, "receiptId"));
  });
  if (state.ok) revalidatePath(`/orders/${orderId}`);
  return state;
}

export async function setSupplierTaxIdAction(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  let orderId = "";
  const state = await runAction(async () => {
    orderId = formId(form, "orderId");
    await setSupplierTaxId(user, formId(form, "supplierId"), {
      taxId: String(form.get("taxId") ?? ""),
    });
    return "კოდი შენახულია.";
  });
  if (state.ok) revalidatePath(`/orders/${orderId}`);
  return state;
}
