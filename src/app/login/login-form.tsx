"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Field, FormMessage } from "@/components/ui";
import { authClient } from "@/lib/auth-client";
import { errors } from "@/lib/i18n/ka";

const inputClass =
  "min-h-11 rounded-lg border border-[#829ab2] bg-[#102e49] px-3 text-base text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange";

export function LoginForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string>();

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setPending(true);
    setMessage(undefined);
    const { error } = await authClient.signIn.email({
      email: String(form.get("email") ?? "").trim(),
      password: String(form.get("password") ?? ""),
    });
    setPending(false);
    if (error) {
      setMessage(error.status === 429 ? errors.tooManyAttempts : errors.loginFailed);
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
        className={inputClass}
        required
      />
      <Field
        label="პაროლი"
        name="password"
        type="password"
        autoComplete="current-password"
        className={inputClass}
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
