import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { requireUser } from "@/server/session";
import { PasswordForm } from "./password-form";

export const metadata: Metadata = { title: "პაროლის შეცვლა" };

export default async function ChangePasswordPage() {
  const user = await requireUser({ allowPasswordChange: true });
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
          <h1 className="mb-2 text-xl font-bold">პაროლის შეცვლა</h1>
          {user.mustChangePassword ? (
            <p className="mb-4 text-sm text-steel-600">
              თქვენი პაროლი დროებითია. გასაგრძელებლად შეიყვანეთ ახალი პაროლი.
            </p>
          ) : (
            <p className="mb-4 text-sm text-steel-600">
              შეცვლის შემდეგ სხვა მოწყობილობებზე სესიები დასრულდება.
            </p>
          )}
          <PasswordForm />
        </div>
        {!user.mustChangePassword && (
          <p className="mt-4 text-center text-sm">
            <Link href="/" className="font-medium underline underline-offset-4">
              უკან დაბრუნება
            </Link>
          </p>
        )}
      </div>
    </main>
  );
}
