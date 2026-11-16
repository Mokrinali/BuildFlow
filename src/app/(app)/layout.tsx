import Image from "next/image";
import Link from "next/link";
import { ButtonLink } from "@/components/ui";
import { listProjects } from "@/server/projects/service";
import { requireUser } from "@/server/session";
import { NavLinks } from "./nav-links";
import { ProjectSwitcher } from "./project-switcher";
import { SignOutButton } from "./sign-out-button";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const projects = await listProjects(user);

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[15rem_1fr]">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2"
      >
        მთავარ შიგთავსზე გადასვლა
      </a>

      {/* Sidebar (desktop) / collapsible menu (mobile) */}
      <aside className="bg-navy text-white lg:sticky lg:top-0 lg:h-dvh">
        <details className="group lg:hidden">
          <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3">
            <Link href="/" aria-label="BuildFlow — მიმოხილვა">
              <Image
                src="/brand/buildflow-mark.svg"
                alt=""
                width={24}
                height={24}
                className="h-6 w-6 rounded-sm bg-white"
              />
            </Link>
            <span className="rounded border border-white/30 px-3 py-1 text-sm">მენიუ</span>
          </summary>
          <div className="px-2 pb-3">
            <NavLinks isAdmin={user.isAdmin} />
          </div>
        </details>
        <div className="hidden h-full flex-col lg:flex">
          <Link href="/" className="m-4 rounded-md bg-white px-3 py-2">
            <Image
              src="/brand/buildflow-lockup.svg"
              alt="BuildFlow"
              width={146}
              height={32}
              className="h-8 w-auto"
            />
          </Link>
          <nav aria-label="მთავარი მენიუ" className="flex-1 px-2">
            <NavLinks isAdmin={user.isAdmin} />
          </nav>
          <div className="border-t border-white/15 p-4 text-sm">
            <p className="font-semibold">{user.name}</p>
            <p className="truncate text-white/75">{user.email}</p>
            <SignOutButton className="mt-3" />
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="flex flex-wrap items-center gap-3 border-b border-line bg-white px-4 py-3 sm:px-6">
          <ProjectSwitcher projects={projects.map((p) => ({ id: p.id, name: p.name }))} />
          <div className="ml-auto flex items-center gap-2">
            <ButtonLink href="/requests/new">ახალი მოთხოვნა</ButtonLink>
            <SignOutButton className="lg:hidden" />
          </div>
        </header>
        <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6">
          {children}
        </main>
      </div>
    </div>
  );
}
