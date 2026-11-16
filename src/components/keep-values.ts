"use client";

import { startTransition, type FormEvent } from "react";

/**
 * Submit handler that keeps what the user typed when the server returns an error.
 *
 * React 19 resets a form after every `<form action={fn}>` submission, also when the action
 * returns a validation error, so uncontrolled fields would be wiped. This handler dispatches the
 * action itself inside a transition (pending state still works), which skips that reset.
 * Keep `action={formAction}` on the form as well: without JavaScript the browser posts normally.
 *
 * `confirmText` asks before submitting (the native dialog), as several forms already do.
 */
export function submitKeepingValues(dispatch: (form: FormData) => void, confirmText?: string) {
  return (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (confirmText && !confirm(confirmText)) return;
    const submitter = (e.nativeEvent as SubmitEvent).submitter;
    const form = new FormData(e.currentTarget, submitter);
    startTransition(() => dispatch(form));
  };
}
