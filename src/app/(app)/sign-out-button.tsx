"use client";

import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

export function SignOutButton({ className = "" }: { className?: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={async () => {
        await authClient.signOut();
        router.replace("/login");
        router.refresh();
      }}
      className={`rounded-md border border-current px-3 py-1.5 text-sm font-medium ${className}`}
    >
      გასვლა
    </button>
  );
}
