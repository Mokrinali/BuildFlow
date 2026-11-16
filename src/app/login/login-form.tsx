"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Field, FormMessage } from "@/components/ui";
import { authClient } from "@/lib/auth-client";
import { errors } from "@/lib/i18n/ka";

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
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <Field label="ელფოსტა" name="email" type="email" autoComplete="username" required />
      <Field
        label="პაროლი"
        name="password"
        type="password"
        autoComplete="current-password"
        required
      />
      <FormMessage ok={false} message={message} />
      <Button type="submit" disabled={pending}>
        {pending ? "შესვლა…" : "შესვლა"}
      </Button>
    </form>
  );
}
