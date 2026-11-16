"use client";

import Link from "next/link";

export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-2xl font-bold">რაღაც შეცდომა მოხდა</h1>
      <p className="text-steel-600">გვერდის ჩატვირთვა ვერ მოხერხდა. სცადეთ თავიდან.</p>
      <div className="flex gap-4">
        <button
          type="button"
          onClick={reset}
          className="min-h-10 rounded-md bg-orange px-4 font-semibold text-navy"
        >
          თავიდან ცდა
        </button>
        <Link href="/" className="self-center font-semibold underline underline-offset-4">
          მთავარ გვერდზე
        </Link>
      </div>
    </main>
  );
}
