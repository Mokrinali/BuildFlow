import type { Metadata } from "next";
import Image from "next/image";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/session";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "შესვლა" };

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/");
  return (
    <main className="flex min-h-dvh items-center justify-center bg-[#08233d] bg-[url('/brand/login-blueprint.webp')] bg-cover bg-center px-4 py-10 text-white">
      <div className="w-full max-w-md rounded-2xl border border-[#42617b] bg-[#09243e] p-6 shadow-2xl sm:p-9">
        <Image
          src="/brand/buildflow-lockup-light.svg"
          alt="BuildFlow"
          width={220}
          height={48}
          priority
          className="mx-auto mb-8 h-12 w-auto"
        />
        <h1 className="mb-7 text-center text-2xl font-bold">სისტემაში შესვლა</h1>
        <LoginForm />
      </div>
    </main>
  );
}
