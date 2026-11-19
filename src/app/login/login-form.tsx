"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Field, FormMessage } from "@/components/ui";
import { PasswordField } from "@/components/password-field";
import { authClient } from "@/lib/auth-client";
import { errors } from "@/lib/i18n/ka";

const inputClass =
  "min-h-11 rounded-lg border border-[#829ab2] bg-[#102e49] px-3 text-base text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange aria-invalid:border-[#ff9b9b]";

export function LoginForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string>();
  const [missing, setMissing] = useState<{ email?: boolean; password?: boolean }>({});

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    // The form is noValidate (the browser bubble would be in the browser's language), so empty
    // fields are reported here, in Georgian, without a request to the server.
    const empty = { email: !email, password: !password };
    setMissing(empty);
    if (empty.email || empty.password) {
      setMessage(errors.loginMissing);
      e.currentTarget
        .querySelector<HTMLInputElement>(empty.email ? "#f-email" : "#f-password")
        ?.focus();
      return;
    }
    setPending(true);
    setMessage(undefined);
    const { error } = await authClient.signIn.email({
      email,
      password,
    });
    setPending(false);
    if (error) {
      setMessage(
        error.code === "ACCOUNT_LOCKED"
          ? errors.accountLocked
          : error.status === 429
            ? errors.tooManyAttempts
            : errors.loginFailed,
      );
      return;
    }
    router.replace("/");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
      <Field
        label="ელფოსტა"
        name="email"
        type="email"
        autoComplete="username"
        aria-invalid={missing.email || undefined}
        className={inputClass}
        required
      />
      <PasswordField
        label="პაროლი"
        name="password"
        autoComplete="current-password"
        aria-invalid={missing.password || undefined}
        className={inputClass}
        toggleClassName="text-[#c5d3e0] hover:text-white"
        required
      />
      <FormMessage ok={false} message={message} />
      <Button
        type="submit"
        disabled={pending}
        className="mt-1 h-11 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
      >
        {pending ? "შესვლა…" : "შესვლა"}
      </Button>
    </form>
  );
}
