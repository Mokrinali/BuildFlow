import Image from "next/image";
import Link from "next/link";
import { ButtonLink } from "@/components/ui";
import { listProjects } from "@/server/projects/service";
import { requireUser } from "@/server/session";
import { MobileMenu } from "./mobile-menu";
import { NavLinks } from "./nav-links";
import { ProjectSwitcher } from "./project-switcher";
import { SignOutButton } from "./sign-out-button";

function UserBox({ name, email }: { name: string; email: string }) {
  return (
    <div className="border-t border-white/15 p-4 text-sm">
      <p className="font-semibold">{name}</p>
      <p className="truncate text-white/75">{email}</p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Link href="/account/password" className="underline underline-offset-4">
          პაროლის შეცვლა
        </Link>
        <SignOutButton />
      </div>
    </div>
  );
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const projects = await listProjects(user);

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2"
      >
        მთავარ შიგთავსზე გადასვლა
      </a>

      <aside className="bg-navy text-white lg:sticky lg:top-0 lg:h-dvh">
        {/* Mobile: brand bar with a toggle; the panel closes after navigation. */}
        <div className="lg:hidden">
          <MobileMenu
            brand={
              <Link href="/" className="rounded-sm bg-white px-2 py-1">
                <Image
                  src="/brand/buildflow-lockup.svg"
                  alt="BuildFlow — მიმოხილვა"
                  width={110}
                  height={24}
                  className="h-6 w-auto"
                />
              </Link>
            }
          >
            <nav aria-label="მთავარი მენიუ" className="px-2 pb-2">
              <NavLinks isAdmin={user.isAdmin} />
            </nav>
            <UserBox name={user.name} email={user.email} />
          </MobileMenu>
        </div>

        {/* Desktop sidebar */}
        <div className="hidden h-full flex-col lg:flex">
          <Link href="/" className="m-4 rounded-md bg-white px-3 py-2">
            <Image
              src="/brand/buildflow-lockup.svg"
              alt="BuildFlow — მიმოხილვა"
              width={146}
              height={32}
              className="h-8 w-auto"
            />
          </Link>
          <nav aria-label="მთავარი მენიუ" className="flex-1 px-2">
            <NavLinks isAdmin={user.isAdmin} />
          </nav>
          <UserBox name={user.name} email={user.email} />
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="flex flex-wrap items-center gap-3 border-b border-line bg-white px-4 py-3 sm:px-6">
          <ProjectSwitcher projects={projects.map((p) => ({ id: p.id, name: p.name }))} />
          <div className="ml-auto">
            <ButtonLink href="/requests/new">ახალი მოთხოვნა</ButtonLink>
          </div>
        </header>
        <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6">
          {children}
        </main>
      </div>
    </div>
  );
}
