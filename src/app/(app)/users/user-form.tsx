"use client";

import { useActionState, useEffect, useRef } from "react";
import { Button, Field, FormMessage } from "@/components/ui";
import { initialActionState } from "@/server/action-state";
import { createUserAction, setUserActiveAction } from "./actions";

export function UserForm() {
  const [state, action, pending] = useActionState(createUserAction, initialActionState);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={action} className="flex flex-col gap-4">
      <Field label="სახელი და გვარი" name="name" required error={state.fieldErrors?.name} />
      <Field
        label="ელფოსტა"
        name="email"
        type="email"
        autoComplete="off"
        required
        error={state.fieldErrors?.email}
      />
      <Field
        label="დროებითი პაროლი"
        name="password"
        type="password"
        autoComplete="new-password"
        required
        hint="მინიმუმ 10 სიმბოლო. გადაეცით მომხმარებელს უსაფრთხოდ."
        error={state.fieldErrors?.password}
      />
      <label htmlFor="isAdmin" className="flex items-center gap-2 text-sm">
        <input id="isAdmin" type="checkbox" name="isAdmin" className="h-4 w-4 accent-navy" />
        ადმინისტრატორი
      </label>
      <FormMessage ok={state.ok} message={state.message} />
      <Button type="submit" disabled={pending}>
        შექმნა
      </Button>
    </form>
  );
}

export function ToggleActiveButton({ userId, active }: { userId: string; active: boolean }) {
  const [state, action, pending] = useActionState(
    setUserActiveAction.bind(null, userId, !active),
    initialActionState,
  );
  return (
    <form action={action} className="flex items-center gap-2">
      <Button
        type="submit"
        variant={active ? "danger" : "secondary"}
        disabled={pending}
        className="min-h-9"
      >
        {active ? "გათიშვა" : "გააქტიურება"}
      </Button>
      {!state.ok && state.message && (
        <span role="alert" className="text-sm text-red-800">
          {state.message}
        </span>
      )}
    </form>
  );
}
