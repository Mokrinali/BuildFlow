import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-2xl font-bold">გვერდი ვერ მოიძებნა</h1>
      <p className="text-steel-600">ჩანაწერი არ არსებობს ან მისი ნახვის უფლება არ გაქვთ.</p>
      <Link href="/" className="font-semibold underline underline-offset-4">
        მთავარ გვერდზე დაბრუნება
      </Link>
    </main>
  );
}
