"use client";

import { useActionState, useId } from "react";
import { Button, FormMessage } from "@/components/ui";
import { submitKeepingValues } from "@/components/keep-values";
import { formatDateTime, formatQuantity } from "@/lib/format";
import type { ActionState } from "@/server/action-state";
import { initialActionState } from "@/server/action-state";
import {
  adjustItemAction,
  askItemCancelAction,
  decideItemCancelAction,
  withdrawItemCancelAction,
} from "../actions";

type FormAction = (state: ActionState, form: FormData) => Promise<ActionState>;

export type ItemActionData = {
  id: string;
  name: string;
  unit: string;
  approved: string;
  remaining: string;
  canAdjust: boolean;
  canRequestCancel: boolean;
  pendingCancellation: {
    id: string;
    side: "REQUESTER" | "BUYER";
    reason: string;
    createdAt: Date;
    requestedBy: string;
    canDecide: boolean;
    canWithdraw: boolean;
  } | null;
};

const fieldClass = "rounded-md border border-steel bg-white px-3 py-2 text-base";

/** A collapsible form with hidden ids, optional quantity field and a reason. */
function ItemForm({
  summary,
  action,
  hidden,
  submitLabel,
  variant = "secondary",
  intro,
  quantity,
  reasonLabel,
  reasonRequired = true,
  confirmText,
}: {
  summary: string;
  action: FormAction;
  hidden: Record<string, string>;
  submitLabel: string;
  variant?: "primary" | "secondary" | "danger";
  intro?: string;
  quantity?: { label: string; defaultValue: string };
  reasonLabel: string;
  reasonRequired?: boolean;
  confirmText?: string;
}) {
  const [state, formAction, pending] = useActionState(action, initialActionState);
  const id = useId();
  const fe = state.fieldErrors ?? {};
  return (
    <details className="rounded-md border border-line bg-white p-3">
      <summary className="cursor-pointer text-sm font-semibold">{summary}</summary>
      <form
        action={formAction}
        onSubmit={submitKeepingValues(formAction, confirmText)}
        className="mt-3 flex flex-col gap-2"
      >
        {Object.entries(hidden).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        {intro && <p className="text-sm text-steel-600">{intro}</p>}
        {quantity && (
          <>
            <label htmlFor={`${id}-q`} className="text-sm font-medium">
              {quantity.label}
            </label>
            <input
              id={`${id}-q`}
              name="quantity"
              inputMode="decimal"
              maxLength={16}
              required
              defaultValue={quantity.defaultValue}
              aria-invalid={fe.quantity ? true : undefined}
              aria-describedby={fe.quantity ? `${id}-q-err` : undefined}
              className={`${fieldClass} sm:max-w-48`}
            />
            {fe.quantity && (
              <p id={`${id}-q-err`} className="text-sm text-red-800">
                {fe.quantity}
              </p>
            )}
          </>
        )}
        <label htmlFor={`${id}-r`} className="text-sm font-medium">
          {reasonLabel}
        </label>
        <textarea
          id={`${id}-r`}
          name="reason"
          rows={2}
          required={reasonRequired}
          minLength={reasonRequired ? 3 : undefined}
          maxLength={1000}
          aria-invalid={fe.reason ? true : undefined}
          aria-describedby={fe.reason ? `${id}-r-err` : undefined}
          className={fieldClass}
        />
        {fe.reason && (
          <p id={`${id}-r-err`} className="text-sm text-red-800">
            {fe.reason}
          </p>
        )}
        <Button type="submit" variant={variant} disabled={pending} className="self-start">
          {submitLabel}
        </Button>
        <FormMessage ok={state.ok} message={state.message} />
      </form>
    </details>
  );
}

function SimpleItemAction({
  action,
  hidden,
  label,
  variant = "secondary",
  confirmText,
}: {
  action: FormAction;
  hidden: Record<string, string>;
  label: string;
  variant?: "primary" | "secondary";
  confirmText?: string;
}) {
  const [state, formAction, pending] = useActionState(action, initialActionState);
  return (
    <form
      action={formAction}
      onSubmit={submitKeepingValues(formAction, confirmText)}
      className="flex flex-col gap-1"
    >
      {Object.entries(hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <Button type="submit" variant={variant} disabled={pending}>
        {label}
      </Button>
      <FormMessage ok={state.ok} message={state.message} />
    </form>
  );
}

/** Per-item actions: change the approved quantity, ask/decide a remainder cancellation. */
export function ItemActions({ requestId, item }: { requestId: string; item: ItemActionData }) {
  const p = item.pendingCancellation;
  if (!item.canAdjust && !item.canRequestCancel && !p) return null;
  const ids = { requestId, itemId: item.id };
  const other = p?.side === "REQUESTER" ? "შემსყიდველის" : "მომთხოვნის";
  return (
    <div className="mt-2 flex flex-col gap-2">
      {p && (
        <div role="status" className="rounded-md border border-orange bg-orange-50 p-3 text-sm">
          <p className="font-semibold text-navy">
            მოთხოვნილია დარჩენილის ({formatQuantity(item.remaining)} {item.unit}) გაუქმება
          </p>
          <p className="text-navy">
            {p.requestedBy} ({p.side === "REQUESTER" ? "მომთხოვნი" : "შემსყიდველი"}),{" "}
            {formatDateTime(p.createdAt)}: „{p.reason}“
          </p>
          <p className="mt-1 text-navy">ელოდება {other} დადასტურებას.</p>
          {(p.canDecide || p.canWithdraw) && (
            <div className="mt-3 flex flex-col gap-2">
              {p.canDecide && (
                <SimpleItemAction
                  action={decideItemCancelAction}
                  hidden={{ ...ids, cancellationId: p.id, decision: "confirm", reason: "" }}
                  label="გაუქმების დადასტურება"
                  variant="primary"
                  confirmText={`დავადასტუროთ: „${item.name}“-ის დარჩენილი რაოდენობა აღარ შეკვეთდება და ღია შეკვეთის ხაზი დაიხურება?`}
                />
              )}
              {p.canDecide && (
                <ItemForm
                  summary="გაუქმების უარყოფა"
                  action={decideItemCancelAction}
                  hidden={{ ...ids, cancellationId: p.id, decision: "reject" }}
                  reasonLabel="უარყოფის მიზეზი (მაგ. მასალა უკვე გზაშია)"
                  submitLabel="უარყოფა"
                  variant="danger"
                />
              )}
              {p.canWithdraw && (
                <SimpleItemAction
                  action={withdrawItemCancelAction}
                  hidden={{ ...ids, cancellationId: p.id }}
                  label="მოთხოვნის გაწვევა"
                />
              )}
            </div>
          )}
        </div>
      )}
      {item.canAdjust && (
        <ItemForm
          summary="დამტკიცებული რაოდენობის შეცვლა"
          action={adjustItemAction}
          hidden={ids}
          intro="მაგალითად, როცა მომწოდებელი სხვა შეფუთვით ყიდის. ცვლილება და მიზეზი ქრონოლოგიაში ჩაიწერება."
          quantity={{
            label: `ახალი დამტკიცებული რაოდენობა (${item.unit})`,
            defaultValue: item.approved.replace(".", ","),
          }}
          reasonLabel="მიზეზი"
          submitLabel="შენახვა"
        />
      )}
      {item.canRequestCancel && (
        <ItemForm
          summary="დარჩენილის გაუქმება"
          action={askItemCancelAction}
          hidden={ids}
          intro={`გაუქმდება მიუღებელი ${formatQuantity(item.remaining)} ${item.unit}, მეორე მხარის დადასტურების შემდეგ. მანამდე მიღება ჩვეულებრივ გრძელდება.`}
          reasonLabel="მიზეზი (მაგ. საჭიროება აღარ არის)"
          submitLabel="გაუქმების მოთხოვნა"
          variant="danger"
        />
      )}
    </div>
  );
}
