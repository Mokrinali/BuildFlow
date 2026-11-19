"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/", label: "მიმოხილვა" },
  { href: "/projects", label: "პროექტები" },
  { href: "/requests", label: "მოთხოვნები" },
  { href: "/orders", label: "შეკვეთები" },
];
const adminItems = [
  { href: "/users", label: "მომხმარებლები" },
  { href: "/rs", label: "RS.ge" },
];

export function NavLinks({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();
  const all = isAdmin ? [...items, ...adminItems] : items;
  return (
    <ul className="flex flex-col gap-1">
      {all.map((item) => {
        const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`block rounded-md px-3 py-2 text-sm font-medium ${
                active
                  ? "bg-white/15 text-white"
                  : "text-white/85 hover:bg-white/10 hover:text-white"
              }`}
            >
              {active && (
                <span aria-hidden className="mr-2 inline-block h-2 w-2 rounded-full bg-orange" />
              )}
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
