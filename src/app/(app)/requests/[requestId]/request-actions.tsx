"use client";

import { useActionState, useId } from "react";
import { Button, Card, FormMessage } from "@/components/ui";
import { submitKeepingValues } from "@/components/keep-values";
import type { ActionState } from "@/server/action-state";
import { initialActionState } from "@/server/action-state";
import type { RequestPermissions } from "@/server/requests/service";
import {
  approveAction,
  cancelAction,
  rejectAction,
  reopenAction,
  returnToDraftAction,
  submitAction,
  withdrawAction,
} from "../actions";

type FormAction = (state: ActionState, form: FormData) => Promise<ActionState>;

function SimpleAction({
  requestId,
  submittedAt,
  action,
  label,
  variant = "primary",
  confirmText,
}: {
  requestId: string;
  /** The submission shown on this page; reviews are refused if it changed since. */
  submittedAt?: string;
  action: FormAction;
  label: string;
  variant?: "primary" | "secondary";
  confirmText?: string;
}) {
  const [state, formAction, pending] = useActionState(action, initialActionState);
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (confirmText && !confirm(confirmText)) e.preventDefault();
      }}
      className="flex flex-col gap-2"
    >
      <input type="hidden" name="requestId" value={requestId} />
      {submittedAt !== undefined && <input type="hidden" name="submittedAt" value={submittedAt} />}
      <Button type="submit" variant={variant} disabled={pending} className="w-full">
        {label}
      </Button>
      <FormMessage ok={state.ok} message={state.message} />
    </form>
  );
}

function ReasonAction({
  requestId,
  submittedAt,
  action,
  label,
  reasonLabel,
  variant = "secondary",
}: {
  requestId: string;
  submittedAt?: string;
  action: FormAction;
  label: string;
  reasonLabel: string;
  variant?: "secondary" | "danger";
}) {
  const [state, formAction, pending] = useActionState(action, initialActionState);
  const id = useId();
  return (
    <details className="rounded-md border border-line p-3">
      <summary className="cursor-pointer text-sm font-semibold">{label}</summary>
      <form
        action={formAction}
        onSubmit={submitKeepingValues(formAction)}
        className="mt-3 flex flex-col gap-2"
      >
        <input type="hidden" name="requestId" value={requestId} />
        {submittedAt !== undefined && (
          <input type="hidden" name="submittedAt" value={submittedAt} />
        )}
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
        <Button type="submit" variant={variant} disabled={pending}>
          {label}
        </Button>
        {!state.fieldErrors && <FormMessage ok={state.ok} message={state.message} />}
      </form>
    </details>
  );
}

export function RequestActions({
  requestId,
  submittedAt,
  permissions: p,
}: {
  requestId: string;
  submittedAt: string;
  permissions: RequestPermissions;
}) {
  // Ordering and editing are links in the page header, not actions in this card.
  const any = Object.entries(p).some(([k, v]) => v && k !== "canOrder" && k !== "canEdit");
  if (!any) return null;

  return (
    <Card>
      <h2 className="mb-4 text-lg font-semibold">მოქმედებები</h2>
      <div className="flex flex-col gap-3">
        {p.canSubmit && (
          <SimpleAction
            requestId={requestId}
            action={submitAction}
            label="განსახილველად გაგზავნა"
          />
        )}
        {p.canApprove && (
          <SimpleAction
            requestId={requestId}
            submittedAt={submittedAt}
            action={approveAction}
            label="დამტკიცება"
            confirmText="დავამტკიცოთ მოთხოვნა?"
          />
        )}
        {p.canReject && (
          <ReasonAction
            requestId={requestId}
            submittedAt={submittedAt}
            action={rejectAction}
            label="უარყოფა"
            reasonLabel="უარყოფის მიზეზი"
            variant="danger"
          />
        )}
        {p.canWithdraw && (
          <SimpleAction
            requestId={requestId}
            action={withdrawAction}
            label="განხილვიდან დაბრუნება"
            variant="secondary"
          />
        )}
        {p.canReturnToDraft && (
          <SimpleAction
            requestId={requestId}
            action={returnToDraftAction}
            label="მონახაზში დაბრუნება"
            variant="secondary"
          />
        )}
        {p.canReopen && (
          <ReasonAction
            requestId={requestId}
            action={reopenAction}
            label="ხელახლა გახსნა შესაცვლელად"
            reasonLabel="რატომ იცვლება დამტკიცებული მოთხოვნა?"
          />
        )}
        {p.canCancel && (
          <ReasonAction
            requestId={requestId}
            action={cancelAction}
            label="მოთხოვნის გაუქმება"
            reasonLabel="გაუქმების მიზეზი"
            variant="danger"
          />
        )}
      </div>
    </Card>
  );
}
