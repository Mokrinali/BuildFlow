"use client";

import { useActionState } from "react";
import { Button, Field, FormMessage } from "@/components/ui";
import { submitKeepingValues } from "@/components/keep-values";
import { initialActionState } from "@/server/action-state";
import { changePasswordAction } from "./actions";

export function PasswordForm() {
  const [state, action, pending] = useActionState(changePasswordAction, initialActionState);
  return (
    <form action={action} onSubmit={submitKeepingValues(action)} className="flex flex-col gap-4">
      <Field
        label="მიმდინარე პაროლი"
        name="currentPassword"
        type="password"
        autoComplete="current-password"
        required
        error={state.fieldErrors?.currentPassword}
      />
      <Field
        label="ახალი პაროლი"
        name="newPassword"
        type="password"
        autoComplete="new-password"
        required
        hint="მინიმუმ 10 სიმბოლო."
        error={state.fieldErrors?.newPassword}
      />
      <Field
        label="გაიმეორეთ ახალი პაროლი"
        name="confirmPassword"
        type="password"
        autoComplete="new-password"
        required
        error={state.fieldErrors?.confirmPassword}
      />
      {!state.fieldErrors && <FormMessage ok={state.ok} message={state.message} />}
      <Button type="submit" disabled={pending}>
        პაროლის შეცვლა
      </Button>
    </form>
  );
}
