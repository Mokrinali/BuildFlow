"use client";

import { useActionState, useId, useMemo, useState } from "react";
import { Button, Card, FormMessage } from "@/components/ui";
import { submitKeepingValues } from "@/components/keep-values";
import { formatQuantity } from "@/lib/format";
import { initialActionState } from "@/server/action-state";
import type { ActionState } from "@/server/action-state";
import {
  cancelOrderAction,
  closeOrderAction,
  correctReceiptAction,
  createReceiptAction,
  setSupplierTaxIdAction,
  setWaybillAction,
} from "../actions";

const inputClass =
  "min-h-10 w-full rounded-md border border-steel bg-white px-3 text-base text-navy aria-invalid:border-red-700";

type ReceivableItem = { id: string; name: string; unit: string; remaining: string };

/** Record a delivery: one quantity per order line (empty = not delivered this time). */
export function ReceiveForm({
  orderId,
  items,
  today,
}: {
  orderId: string;
  items: ReceivableItem[];
  today: string;
}) {
  const [state, action, pending] = useActionState(createReceiptAction, initialActionState);
  const uid = useId();
  const open = items.filter((i) => i.remaining !== "0");
  const [receivedOn, setReceivedOn] = useState(today);
  const [note, setNote] = useState("");
  const [waybillNumber, setWaybillNumber] = useState("");
  const [waybillDate, setWaybillDate] = useState(today);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  // After a successful save the remaining quantities change: clear the inputs once per result.
  const [seenState, setSeenState] = useState(state);
  if (state !== seenState) {
    setSeenState(state);
    if (state.ok) {
      setQuantities({});
      setNote("");
      setWaybillNumber("");
    }
  }

  const { payload, sentToItem } = useMemo(() => {
    const sent: { orderItemId: string; quantity: string }[] = [];
    const map: string[] = [];
    for (const it of open) {
      const q = (quantities[it.id] ?? "").trim();
      if (!q) continue;
      sent.push({ orderItemId: it.id, quantity: q });
      map.push(it.id);
    }
    return {
      payload: JSON.stringify({
        receivedOn,
        note,
        waybillNumber,
        waybillDate: waybillNumber.trim() ? waybillDate : "",
        items: sent,
      }),
      sentToItem: map,
    };
  }, [open, quantities, receivedOn, note, waybillNumber, waybillDate]);

  const itemErrors = useMemo(() => {
    const out: Record<string, string> = {};
    for (const [key, msg] of Object.entries(state.fieldErrors ?? {})) {
      const m = /^items\.(\d+)\.quantity$/.exec(key);
      const id = m ? sentToItem[Number(m[1])] : undefined;
      if (id) out[id] = msg;
    }
    return out;
    // Errors refer to the payload of the last submit; recompute only when they change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.fieldErrors]);

  const fe = state.fieldErrors ?? {};

  return (
    <Card>
      <h2 className="mb-1 text-lg font-semibold">მიწოდების დაფიქსირება</h2>
      <p className="mb-4 text-sm text-steel-600">
        შეიყვანეთ ფაქტობრივად მიღებული რაოდენობა. ცარიელი ველი ნიშნავს, რომ ეს პოზიცია ამჯერად არ
        მოსულა.
      </p>
      <form action={action} className="flex flex-col gap-4">
        <input type="hidden" name="orderId" value={orderId} />
        <input type="hidden" name="payload" value={payload} />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <label htmlFor={`${uid}-wb`} className="text-sm font-medium">
              ზედნადების ნომერი
            </label>
            <input
              id={`${uid}-wb`}
              inputMode="numeric"
              maxLength={40}
              value={waybillNumber}
              onChange={(e) => setWaybillNumber(e.target.value)}
              aria-invalid={fe.waybillNumber ? true : undefined}
              aria-describedby={`${uid}-wb-hint${fe.waybillNumber ? ` ${uid}-wb-err` : ""}`}
              className={inputClass}
            />
            <p id={`${uid}-wb-hint`} className="text-xs text-steel-600">
              თუ ზედნადები ჯერ არ გამოწერილა, შეგიძლიათ მოგვიანებით დაამატოთ. მის გარეშე შეკვეთა
              დასრულებულად არ ჩაითვლება.
            </p>
            {fe.waybillNumber && (
              <p id={`${uid}-wb-err`} className="text-sm text-red-800">
                {fe.waybillNumber}
              </p>
            )}
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={`${uid}-wbd`} className="text-sm font-medium">
              ზედნადების თარიღი
            </label>
            <input
              id={`${uid}-wbd`}
              type="date"
              max={today}
              value={waybillDate}
              onChange={(e) => setWaybillDate(e.target.value)}
              aria-invalid={fe.waybillDate ? true : undefined}
              aria-describedby={fe.waybillDate ? `${uid}-wbd-err` : undefined}
              className={inputClass}
            />
            {fe.waybillDate && (
              <p id={`${uid}-wbd-err`} className="text-sm text-red-800">
                {fe.waybillDate}
              </p>
            )}
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <label htmlFor={`${uid}-date`} className="text-sm font-medium">
              მიღების თარიღი
            </label>
            <input
              id={`${uid}-date`}
              type="date"
              max={today}
              required
              value={receivedOn}
              onChange={(e) => setReceivedOn(e.target.value)}
              aria-invalid={fe.receivedOn ? true : undefined}
              aria-describedby={fe.receivedOn ? `${uid}-date-err` : undefined}
              className={inputClass}
            />
            {fe.receivedOn && (
              <p id={`${uid}-date-err`} className="text-sm text-red-800">
                {fe.receivedOn}
              </p>
            )}
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={`${uid}-note`} className="text-sm font-medium">
              შენიშვნა (მაგ. მანქანა, მძღოლი)
            </label>
            <input
              id={`${uid}-note`}
              maxLength={1000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className={inputClass}
            />
          </div>
        </div>
        <ul className="flex flex-col gap-3">
          {open.map((it) => {
            const id = `${uid}-${it.id}`;
            const err = itemErrors[it.id];
            return (
              <li
                key={it.id}
                className="grid grid-cols-1 items-end gap-2 rounded-md border border-line p-3 sm:grid-cols-[1fr_10rem]"
              >
                <label htmlFor={id} className="text-sm">
                  <span className="font-medium">{it.name}</span>
                  <span className="block text-xs text-steel-600">
                    დარჩენილი: {formatQuantity(it.remaining)} {it.unit}
                  </span>
                </label>
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <input
                      id={id}
                      inputMode="decimal"
                      maxLength={16}
                      value={quantities[it.id] ?? ""}
                      onChange={(e) => setQuantities((q) => ({ ...q, [it.id]: e.target.value }))}
                      aria-invalid={err ? true : undefined}
                      aria-describedby={err ? `${id}-err` : undefined}
                      className={inputClass}
                    />
                    <button
                      type="button"
                      onClick={() => setQuantities((q) => ({ ...q, [it.id]: it.remaining }))}
                      className="min-h-10 shrink-0 rounded px-2 text-sm underline underline-offset-4"
                      aria-label={`${it.name}: სრული დარჩენილი რაოდენობა`}
                    >
                      სრული
                    </button>
                  </div>
                  {err && (
                    <p id={`${id}-err`} className="text-sm text-red-800">
                      {err}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        <Button type="submit" disabled={pending || sentToItem.length === 0}>
          მიღების დადასტურება
        </Button>
        <FormMessage ok={state.ok} message={state.message} />
      </form>
    </Card>
  );
}

type OrderFormAction = (state: ActionState, form: FormData) => Promise<ActionState>;

export function CancelOrderForm({ orderId }: { orderId: string }) {
  return (
    <OrderReasonForm
      orderId={orderId}
      action={cancelOrderAction}
      summary="შეკვეთის გაუქმება"
      reasonLabel="გაუქმების მიზეზი"
      submitLabel="შეკვეთის გაუქმება"
    />
  );
}

/** Close short: the supplier delivers no more; the rest returns to the request. */
export function CloseOrderForm({ orderId }: { orderId: string }) {
  return (
    <OrderReasonForm
      orderId={orderId}
      action={closeOrderAction}
      summary="შეკვეთის დახურვა"
      intro="როცა მომწოდებელი მეტს აღარ მოიტანს. შეკვეთა დასრულდება უკვე მიღებული რაოდენობით, დარჩენილი კი მოთხოვნაში დაბრუნდება — მისი შეკვეთა სხვა მომწოდებელთან ან გაუქმება იქიდან შეიძლება."
      reasonLabel="მიზეზი (მაგ. მომწოდებელს მეტი არ აქვს)"
      submitLabel="შეკვეთის დახურვა"
    />
  );
}

function OrderReasonForm({
  orderId,
  action: serverAction,
  summary,
  intro,
  reasonLabel,
  submitLabel,
}: {
  orderId: string;
  action: OrderFormAction;
  summary: string;
  intro?: string;
  reasonLabel: string;
  submitLabel: string;
}) {
  const [state, action, pending] = useActionState(serverAction, initialActionState);
  const id = useId();
  return (
    <details className="rounded-md border border-line bg-white p-3">
      <summary className="cursor-pointer text-sm font-semibold">{summary}</summary>
      <form
        action={action}
        onSubmit={submitKeepingValues(action)}
        className="mt-3 flex flex-col gap-2"
      >
        <input type="hidden" name="orderId" value={orderId} />
        {intro && <p className="text-sm text-steel-600">{intro}</p>}
        <label htmlFor={id} className="text-sm font-medium">
          {reasonLabel}
        </label>
        <textarea
          id={id}
          name="reason"
          rows={3}
          required
          minLength={3}
          maxLength={1000}
          aria-invalid={state.fieldErrors?.reason ? true : undefined}
          aria-describedby={state.fieldErrors?.reason ? `${id}-err` : undefined}
          className="rounded-md border border-steel bg-white px-3 py-2 text-base"
        />
        {state.fieldErrors?.reason && (
          <p id={`${id}-err`} className="text-sm text-red-800">
            {state.fieldErrors.reason}
          </p>
        )}
        <Button type="submit" variant="danger" disabled={pending}>
          {submitLabel}
        </Button>
        {!state.fieldErrors && <FormMessage ok={state.ok} message={state.message} />}
      </form>
    </details>
  );
}

/** Correct one confirmed receipt entry to a new value; the original row stays in the history. */
export function CorrectReceiptForm({
  orderId,
  receiptItemId,
  current,
  unit,
}: {
  orderId: string;
  receiptItemId: string;
  current: string;
  unit: string;
}) {
  const [state, action, pending] = useActionState(correctReceiptAction, initialActionState);
  const id = useId();
  const fe = state.fieldErrors ?? {};
  return (
    <details className="mt-1">
      <summary className="cursor-pointer text-xs underline underline-offset-4">შესწორება</summary>
      <form
        action={action}
        onSubmit={submitKeepingValues(action)}
        className="mt-2 flex flex-col gap-2 rounded-md bg-offwhite p-3"
      >
        <input type="hidden" name="orderId" value={orderId} />
        <input type="hidden" name="receiptItemId" value={receiptItemId} />
        <label htmlFor={`${id}-q`} className="text-xs font-medium">
          სწორი რაოდენობა ({unit}), ახლა: {formatQuantity(current)}
        </label>
        <input
          id={`${id}-q`}
          name="quantity"
          inputMode="decimal"
          required
          maxLength={16}
          defaultValue={current}
          aria-invalid={fe.quantity ? true : undefined}
          aria-describedby={fe.quantity ? `${id}-q-err` : undefined}
          className={inputClass}
        />
        {fe.quantity && (
          <p id={`${id}-q-err`} className="text-sm text-red-800">
            {fe.quantity}
          </p>
        )}
        <label htmlFor={`${id}-r`} className="text-xs font-medium">
          შესწორების მიზეზი
        </label>
        <input
          id={`${id}-r`}
          name="reason"
          required
          minLength={3}
          maxLength={1000}
          aria-invalid={fe.reason ? true : undefined}
          aria-describedby={fe.reason ? `${id}-r-err` : undefined}
          className={inputClass}
        />
        {fe.reason && (
          <p id={`${id}-r-err`} className="text-sm text-red-800">
            {fe.reason}
          </p>
        )}
        <Button type="submit" variant="secondary" disabled={pending}>
          შესწორების შენახვა
        </Button>
        {!state.fieldErrors && <FormMessage ok={state.ok} message={state.message} />}
      </form>
    </details>
  );
}

/** Add or change the waybill of one delivery (changing an existing one needs a reason). */
export function WaybillForm({
  orderId,
  receiptId,
  current,
  currentDate,
  today,
}: {
  orderId: string;
  receiptId: string;
  current: string | null;
  currentDate: string;
  today: string;
}) {
  const [state, action, pending] = useActionState(setWaybillAction, initialActionState);
  const id = useId();
  const fe = state.fieldErrors ?? {};
  return (
    <details className="mt-2">
      <summary
        className={`cursor-pointer text-sm underline underline-offset-4 ${current ? "" : "font-semibold"}`}
      >
        {current ? "ზედნადების შეცვლა" : "ზედნადების დამატება"}
      </summary>
      <form
        action={action}
        onSubmit={submitKeepingValues(action)}
        className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2"
      >
        <input type="hidden" name="orderId" value={orderId} />
        <input type="hidden" name="receiptId" value={receiptId} />
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-n`} className="text-xs font-medium">
            ზედნადების ნომერი
          </label>
          <input
            id={`${id}-n`}
            name="waybillNumber"
            inputMode="numeric"
            maxLength={40}
            required
            defaultValue={current ?? ""}
            aria-invalid={fe.waybillNumber ? true : undefined}
            aria-describedby={fe.waybillNumber ? `${id}-n-err` : undefined}
            className={inputClass}
          />
          {fe.waybillNumber && (
            <p id={`${id}-n-err`} className="text-sm text-red-800">
              {fe.waybillNumber}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-d`} className="text-xs font-medium">
            ზედნადების თარიღი
          </label>
          <input
            id={`${id}-d`}
            name="waybillDate"
            type="date"
            max={today}
            defaultValue={currentDate}
            aria-invalid={fe.waybillDate ? true : undefined}
            aria-describedby={fe.waybillDate ? `${id}-d-err` : undefined}
            className={inputClass}
          />
          {fe.waybillDate && (
            <p id={`${id}-d-err`} className="text-sm text-red-800">
              {fe.waybillDate}
            </p>
          )}
        </div>
        {current && (
          <div className="flex flex-col gap-1 sm:col-span-2">
            <label htmlFor={`${id}-r`} className="text-xs font-medium">
              შეცვლის მიზეზი
            </label>
            <input
              id={`${id}-r`}
              name="reason"
              required
              minLength={3}
              maxLength={1000}
              aria-invalid={fe.reason ? true : undefined}
              aria-describedby={fe.reason ? `${id}-r-err` : undefined}
              className={inputClass}
            />
            {fe.reason && (
              <p id={`${id}-r-err`} className="text-sm text-red-800">
                {fe.reason}
              </p>
            )}
          </div>
        )}
        <div className="sm:col-span-2">
          <Button type="submit" variant="secondary" disabled={pending}>
            შენახვა
          </Button>
        </div>
        {!state.fieldErrors && (
          <div className="sm:col-span-2">
            <FormMessage ok={state.ok} message={state.message} />
          </div>
        )}
      </form>
    </details>
  );
}

/** Supplier identification code (9 or 11 digits), needed to match waybills. */
export function SupplierTaxIdForm({
  orderId,
  supplierId,
  current,
}: {
  orderId: string;
  supplierId: string;
  current: string | null;
}) {
  const [state, action, pending] = useActionState(setSupplierTaxIdAction, initialActionState);
  const id = useId();
  return (
    <details className="mt-1">
      <summary className="cursor-pointer text-xs underline underline-offset-4">
        {current ? "კოდის შეცვლა" : "საიდენტიფიკაციო კოდის მითითება"}
      </summary>
      <form
        action={action}
        onSubmit={submitKeepingValues(action)}
        className="mt-2 flex flex-wrap items-end gap-2"
      >
        <input type="hidden" name="orderId" value={orderId} />
        <input type="hidden" name="supplierId" value={supplierId} />
        <div className="flex flex-col gap-1">
          <label htmlFor={id} className="text-xs font-medium">
            საიდენტიფიკაციო კოდი
          </label>
          <input
            id={id}
            name="taxId"
            inputMode="numeric"
            maxLength={11}
            required
            defaultValue={current ?? ""}
            aria-invalid={state.fieldErrors?.taxId ? true : undefined}
            className={`${inputClass} max-w-48`}
          />
        </div>
        <Button type="submit" variant="secondary" disabled={pending}>
          შენახვა
        </Button>
        <div className="basis-full">
          <FormMessage ok={state.ok} message={state.fieldErrors?.taxId ?? state.message} />
        </div>
      </form>
    </details>
  );
}
