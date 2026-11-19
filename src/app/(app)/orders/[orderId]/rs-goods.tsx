"use client";

// RS.ge waybill goods: fill a new delivery from a waybill, and match a delivery's waybill lines.
import { useActionState, useId } from "react";
import { Button, FormMessage } from "@/components/ui";
import { formatIsoDate, formatMoney, formatQuantity } from "@/lib/format";
import { formatOrderNumber } from "@/lib/units";
import { mulDecimal, normalizeFactor, sameUnit, unitFactor } from "@/lib/unit-convert";
import { initialActionState } from "@/server/action-state";
import type { RsListState } from "@/server/rs/view";
import {
  listOrderWaybillsAction,
  loadWaybillGoodsAction,
  setWaybillLineMatchAction,
} from "../actions";

const inputClass =
  "min-h-10 w-full rounded-md border border-steel bg-white px-3 text-base text-navy aria-invalid:border-red-700";

export type OrderLineOption = { id: string; name: string; unit: string };

/** A goods line of the waybill being used for a new delivery, with the receiver's match. */
export type FillLine = {
  position: number;
  name: string;
  unit: string;
  quantity: string;
  orderItemId: string | null;
  /** As typed (may be empty or invalid while editing). */
  factor: string;
};

export type Fill = {
  waybill: { id: string; number: string; date: string | null };
  lines: FillLine[];
};

/** Quantity in the order unit, or null when the line is not matched or the factor is invalid. */
export function convertedOf(line: FillLine): string | null {
  const f = normalizeFactor(line.factor);
  return line.orderItemId && f ? mulDecimal(line.quantity, f) : null;
}

const initialList: RsListState = { ok: false };

/**
 * Step 1 and 2 of filling a delivery from RS.ge: load the supplier's waybills, pick one and load
 * its goods. The goods preview itself is handled by the parent form (it owns the quantities).
 */
export function RsFillPicker({
  orderId,
  demo,
  previewAction,
  previewPending,
  previewMessage,
}: {
  orderId: string;
  demo: boolean;
  previewAction: (form: FormData) => void;
  previewPending: boolean;
  previewMessage?: { ok: boolean; message?: string };
}) {
  const [list, load, loading] = useActionState(listOrderWaybillsAction, initialList);
  const id = useId();
  const options = list.options ?? [];
  return (
    <details className="mb-4 rounded-md border border-line p-3">
      <summary className="cursor-pointer text-sm font-semibold">
        RS.ge ზედნადებიდან შევსება{demo && " (სადემონსტრაციო)"}
      </summary>
      <div className="mt-2 flex flex-col gap-2">
        <p className="text-sm text-steel-600">
          აირჩიეთ მომწოდებლის ზედნადები: მისი ხაზები მიესადაგება შეკვეთის პოზიციებს და მიღებული
          რაოდენობები თავისით შეივსება. შევსებული რაოდენობის შეცვლა შემდეგაც შეგიძლიათ.
        </p>
        <form action={load}>
          <input type="hidden" name="orderId" value={orderId} />
          <Button type="submit" variant="secondary" disabled={loading}>
            {loading
              ? "იტვირთება…"
              : options.length
                ? "სიის განახლება"
                : "მომწოდებლის ზედნადებების ჩამოტვირთვა"}
          </Button>
        </form>
        <FormMessage ok={list.ok} message={list.message} />
        {options.length > 0 && (
          <form action={previewAction} className="flex flex-col gap-2">
            <input type="hidden" name="orderId" value={orderId} />
            <fieldset className="flex flex-col gap-1">
              <legend className="mb-1 text-xs font-medium">აირჩიეთ ზედნადები</legend>
              {options.map((w, i) => (
                <label
                  key={w.id}
                  htmlFor={`${id}-${i}`}
                  className="flex cursor-pointer items-start gap-2 rounded-md border border-line p-2 has-checked:border-navy"
                >
                  <input
                    id={`${id}-${i}`}
                    type="radio"
                    name="rsWaybillId"
                    value={w.id}
                    required
                    className="mt-1"
                  />
                  <span className="min-w-0 text-sm">
                    <strong>№{w.number}</strong>
                    {w.date && `, ${formatIsoDate(w.date)}`}
                    {w.amount && ` · ${formatMoney(w.amount, "GEL")}`}
                    {w.usedOn.length > 0 && (
                      <span className="block text-xs text-[#8a3f00]">
                        უკვე მიბმულია: {w.usedOn.map((o) => formatOrderNumber(o.number)).join(", ")}
                      </span>
                    )}
                  </span>
                </label>
              ))}
            </fieldset>
            <div>
              <Button type="submit" disabled={previewPending}>
                {previewPending ? "იტვირთება…" : "ზედნადების ხაზების ჩატვირთვა"}
              </Button>
            </div>
            {previewMessage && !previewMessage.ok && (
              <FormMessage ok={false} message={previewMessage.message} />
            )}
          </form>
        )}
      </div>
    </details>
  );
}

/** Step 3: match each goods line to an order line (and set the unit factor when needed). */
export function WaybillMapping({
  fill,
  lines: orderLines,
  onChange,
  onClear,
}: {
  fill: Fill;
  lines: OrderLineOption[];
  onChange: (lines: FillLine[]) => void;
  onClear: () => void;
}) {
  const uid = useId();
  const update = (position: number, patch: Partial<FillLine>) =>
    onChange(fill.lines.map((l) => (l.position === position ? { ...l, ...patch } : l)));
  return (
    <fieldset className="mb-4 flex flex-col gap-3 rounded-md border border-navy/30 bg-offwhite p-3">
      <legend className="px-1 text-sm font-semibold">
        ზედნადები №{fill.waybill.number}
        {fill.waybill.date && `, ${formatIsoDate(fill.waybill.date)}`}: ხაზების მისადაგება
      </legend>
      <ul className="flex flex-col gap-3">
        {fill.lines.map((l) => {
          const target = orderLines.find((o) => o.id === l.orderItemId);
          const converted = convertedOf(l);
          const id = `${uid}-${l.position}`;
          const needsFactor = !!target && !sameUnit(l.unit, target.unit);
          return (
            <li key={l.position} className="rounded-md border border-line bg-white p-3 text-sm">
              <p>
                <strong>{l.name}</strong> — {formatQuantity(l.quantity)} {l.unit}
              </p>
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div className="flex flex-col gap-1">
                  <label htmlFor={`${id}-t`} className="text-xs font-medium">
                    შეკვეთის პოზიცია
                  </label>
                  <select
                    id={`${id}-t`}
                    value={l.orderItemId ?? ""}
                    onChange={(e) => {
                      const next = orderLines.find((o) => o.id === e.target.value);
                      update(l.position, {
                        orderItemId: next?.id ?? null,
                        factor: next ? (unitFactor(l.unit, next.unit) ?? "") : "",
                      });
                    }}
                    className={inputClass}
                  >
                    <option value="">— არ ეკუთვნის ამ შეკვეთას —</option>
                    {orderLines.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name} ({o.unit})
                      </option>
                    ))}
                  </select>
                </div>
                {needsFactor && (
                  <div className="flex flex-col gap-1">
                    <label htmlFor={`${id}-f`} className="text-xs font-medium">
                      1 {l.unit} = ? {target.unit}
                    </label>
                    <input
                      id={`${id}-f`}
                      inputMode="decimal"
                      maxLength={16}
                      value={l.factor}
                      onChange={(e) => update(l.position, { factor: e.target.value })}
                      aria-invalid={!normalizeFactor(l.factor) ? true : undefined}
                      aria-describedby={`${id}-r`}
                      className={inputClass}
                    />
                  </div>
                )}
              </div>
              {target && (
                <p id={`${id}-r`} className="mt-1 text-xs">
                  {converted !== null ? (
                    <>
                      მიღებულში ჩაიწერება: <strong>{formatQuantity(converted)}</strong>{" "}
                      {target.unit}
                    </>
                  ) : (
                    <span className="text-[#8a3f00]">
                      მიუთითეთ, რამდენი {target.unit}-ია 1 {l.unit}.
                    </span>
                  )}
                </p>
              )}
            </li>
          );
        })}
      </ul>
      <div>
        <button
          type="button"
          onClick={onClear}
          className="min-h-10 rounded px-2 text-sm underline underline-offset-4"
        >
          ზედნადების გარეშე შევსება
        </button>
      </div>
    </fieldset>
  );
}

/** Change the order line and unit factor of one stored waybill line (delivery card). */
export function WaybillLineMatchForm({
  orderId,
  lineId,
  goodsUnit,
  current,
  currentFactor,
  orderLines,
}: {
  orderId: string;
  lineId: string;
  goodsUnit: string;
  current: string | null;
  currentFactor: string | null;
  orderLines: OrderLineOption[];
}) {
  const [state, action, pending] = useActionState(setWaybillLineMatchAction, initialActionState);
  const id = useId();
  return (
    <details className="mt-1">
      <summary className="cursor-pointer text-xs underline underline-offset-4">
        მისადაგების შეცვლა
      </summary>
      <form
        action={action}
        className="mt-2 grid grid-cols-1 gap-2 rounded-md bg-offwhite p-3 sm:grid-cols-2"
      >
        <input type="hidden" name="orderId" value={orderId} />
        <input type="hidden" name="lineId" value={lineId} />
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-t`} className="text-xs font-medium">
            შეკვეთის პოზიცია
          </label>
          <select
            id={`${id}-t`}
            name="orderItemId"
            defaultValue={current ?? ""}
            className={inputClass}
          >
            <option value="">— არ ეკუთვნის ამ შეკვეთას —</option>
            {orderLines.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name} ({o.unit})
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-f`} className="text-xs font-medium">
            1 {goodsUnit} = ? (შეკვეთის ერთეულში)
          </label>
          <input
            id={`${id}-f`}
            name="factor"
            inputMode="decimal"
            maxLength={16}
            defaultValue={currentFactor ?? ""}
            aria-invalid={state.fieldErrors?.factor ? true : undefined}
            aria-describedby={`${id}-h`}
            className={inputClass}
          />
          <p id={`${id}-h`} className="text-xs text-steel-600">
            ცარიელი: ერთნაირი ან ცნობილი ერთეულებისთვის (კგ → ტონა) თავისით გამოითვლება.
          </p>
        </div>
        <div className="sm:col-span-2">
          <Button type="submit" variant="secondary" disabled={pending}>
            შენახვა
          </Button>
        </div>
        <div className="sm:col-span-2">
          <FormMessage ok={state.ok} message={state.fieldErrors?.factor ?? state.message} />
        </div>
      </form>
    </details>
  );
}

/** (Re)load the goods lines of a delivery's RS.ge waybill for the comparison. */
export function RsLoadGoodsButton({
  orderId,
  receiptId,
  again,
}: {
  orderId: string;
  receiptId: string;
  again: boolean;
}) {
  const [state, action, pending] = useActionState(loadWaybillGoodsAction, initialActionState);
  return (
    <form action={action} className="mt-2 flex flex-col items-start gap-2">
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="receiptId" value={receiptId} />
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? "იტვირთება…" : again ? "საქონლის ხელახლა ჩატვირთვა" : "საქონლის ჩატვირთვა"}
      </Button>
      <FormMessage ok={state.ok} message={state.message} />
    </form>
  );
}
