import type { Metadata } from "next";
import Image from "next/image";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/session";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "შესვლა" };

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/");
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <Image
          src="/brand/buildflow-lockup.svg"
          alt="BuildFlow"
          width={220}
          height={48}
          priority
          className="mx-auto mb-8 h-12 w-auto"
        />
        <div className="rounded-lg border border-line bg-white p-6 shadow-sm">
          <h1 className="mb-4 text-xl font-bold">სისტემაში შესვლა</h1>
          <LoginForm />
        </div>
      </div>
    </main>
  );
}
