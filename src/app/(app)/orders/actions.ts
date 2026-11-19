"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { formId, formPayload, runAction, type ActionState } from "@/server/action";
import { cancelOrder, closeOrder, createOrder, setSupplierTaxId } from "@/server/orders/service";
import { correctReceiptItem, createReceipt, setReceiptWaybill } from "@/server/receipts/service";
import { applyRsWaybill, listReceiptWaybills, verifyReceiptWaybill } from "@/server/rs/service";
import {
  createReceiptFromWaybill,
  listOrderWaybills,
  loadReceiptWaybillGoods,
  loadReceiptWaybillGoodsQuietly,
  previewWaybillGoods,
  setWaybillLineMatch,
} from "@/server/rs/goods";
import type { RsGoodsPreviewState, RsListState, RsWaybillView } from "@/server/rs/view";
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
    const payload = formPayload(form) as Record<string, unknown>;
    const orderId = formId(form, "orderId");
    // Filled from an RS.ge waybill: the goods lines are re-read from RS.ge on the server.
    if (payload && typeof payload.rsWaybillId === "string" && payload.rsWaybillId) {
      return createReceiptFromWaybill(user, orderId, payload);
    }
    return createReceipt(user, { ...payload, orderId });
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

const toView = (list: Awaited<ReturnType<typeof listOrderWaybills>>): RsWaybillView[] =>
  list.map((w) => ({
    id: w.id,
    number: w.number,
    sellerName: w.sellerName,
    date: w.date,
    amount: w.amount,
    closed: w.status === "CLOSED",
    usedOn: w.usedOn,
  }));

const NO_WAYBILLS = "RS.ge-ზე ამ მომწოდებლის შესაბამისი ზედნადები ვერ მოიძებნა.";

/** Load the supplier's RS.ge waybills that can belong to a delivery. */
export async function listRsWaybillsAction(_: RsListState, form: FormData): Promise<RsListState> {
  const user = await requireUser();
  let options: RsWaybillView[] = [];
  const state = await runAction(async () => {
    options = toView(await listReceiptWaybills(user, formId(form, "receiptId")));
    return options.length ? undefined : NO_WAYBILLS;
  });
  return { ...state, options };
}

/** The supplier's RS.ge waybills, for filling a new delivery of an order. */
export async function listOrderWaybillsAction(
  _: RsListState,
  form: FormData,
): Promise<RsListState> {
  const user = await requireUser();
  let options: RsWaybillView[] = [];
  const state = await runAction(async () => {
    options = toView(await listOrderWaybills(user, formId(form, "orderId")));
    return options.length ? undefined : NO_WAYBILLS;
  });
  return { ...state, options };
}

/** Goods lines of the picked waybill with suggested matches (nothing is saved yet). */
export async function previewWaybillGoodsAction(
  _: RsGoodsPreviewState,
  form: FormData,
): Promise<RsGoodsPreviewState> {
  const user = await requireUser();
  let preview: RsGoodsPreviewState["preview"];
  const state = await runAction(async () => {
    const p = await previewWaybillGoods(
      user,
      formId(form, "orderId"),
      String(form.get("rsWaybillId") ?? "").slice(0, 64),
    );
    preview = {
      waybill: p.waybill,
      lines: p.lines.map((l) => ({
        position: l.position,
        name: l.name,
        unit: l.unit,
        quantity: l.quantity,
        orderItemId: l.orderItemId,
        factor: l.factor,
      })),
    };
  });
  return { ...state, preview };
}

/** Read (again) the goods lines of a delivery's RS.ge waybill for the comparison. */
export async function loadWaybillGoodsAction(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  let orderId = "";
  let count = 0;
  const state = await runAction(async () => {
    orderId = formId(form, "orderId");
    count = await loadReceiptWaybillGoods(user, formId(form, "receiptId"));
    return `ჩაიტვირთა ზედნადების ${count} ხაზი.`;
  });
  if (state.ok) revalidatePath(`/orders/${orderId}`);
  return state;
}

/** Change the order line (and unit factor) of one waybill goods line. */
export async function setWaybillLineMatchAction(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  return mutate(
    () =>
      setWaybillLineMatch(user, formId(form, "lineId"), {
        orderItemId: String(form.get("orderItemId") ?? ""),
        factor: String(form.get("factor") ?? ""),
      }),
    "მისადაგება შენახულია.",
  );
}

export async function applyRsWaybillAction(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  let receiptId = "";
  const state = await mutate(() => {
    receiptId = formId(form, "receiptId");
    return applyRsWaybill(user, receiptId, String(form.get("rsWaybillId") ?? "").slice(0, 64));
  }, "ზედნადები RS.ge-დან მიეთითა.");
  if (!state.ok) return state;
  // Goods lines for the comparison; a failure here leaves the picked waybill in place.
  const note = await loadReceiptWaybillGoodsQuietly(user, receiptId);
  return note ? { ...state, message: `${state.message} ${note}` } : state;
}

export async function verifyRsWaybillAction(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  let orderId = "";
  let receiptId = "";
  let state = await runAction(async () => {
    orderId = formId(form, "orderId");
    receiptId = formId(form, "receiptId");
    return verifyReceiptWaybill(user, receiptId);
  });
  if (state.ok) {
    const note = await loadReceiptWaybillGoodsQuietly(user, receiptId);
    if (note) state = { ...state, message: `${state.message} ${note}` };
    revalidatePath(`/orders/${orderId}`);
  }
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
