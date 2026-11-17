"use client";

import { useActionState } from "react";
import { Button, FormMessage } from "@/components/ui";
import { PasswordField } from "@/components/password-field";
import { submitKeepingValues } from "@/components/keep-values";
import { initialActionState } from "@/server/action-state";
import { changePasswordAction } from "./actions";

export function PasswordForm() {
  const [state, action, pending] = useActionState(changePasswordAction, initialActionState);
  return (
    <form action={action} onSubmit={submitKeepingValues(action)} className="flex flex-col gap-4">
      <PasswordField
        label="მიმდინარე პაროლი"
        name="currentPassword"
        autoComplete="current-password"
        required
        error={state.fieldErrors?.currentPassword}
      />
      <PasswordField
        label="ახალი პაროლი"
        name="newPassword"
        autoComplete="new-password"
        required
        hint="მინიმუმ 10 სიმბოლო."
        error={state.fieldErrors?.newPassword}
      />
      <PasswordField
        label="გაიმეორეთ ახალი პაროლი"
        name="confirmPassword"
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
