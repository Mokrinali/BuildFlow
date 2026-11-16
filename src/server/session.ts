import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Actor } from "@/server/access";

export type CurrentUser = Actor & {
  name: string;
  email: string;
  sessionId: string;
  mustChangePassword: boolean;
};

/** Current signed-in user, or null. Cached per request. Role and status are re-read from the DB. */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;
  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      name: true,
      email: true,
      organizationId: true,
      orgRole: true,
      isActive: true,
      mustChangePassword: true,
    },
  });
  if (!user || !user.isActive) return null;
  return {
    userId: user.id,
    organizationId: user.organizationId,
    isAdmin: user.orgRole === "ADMIN",
    name: user.name,
    email: user.email,
    sessionId: session.session.id,
    mustChangePassword: user.mustChangePassword,
  };
});

/**
 * Current user or redirect to the login page. Use in pages, layouts and server actions.
 * Users with a temporary password are sent to the password page until they change it.
 */
export async function requireUser(opts: { allowPasswordChange?: boolean } = {}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.mustChangePassword && !opts.allowPasswordChange) redirect("/account/password");
  return user;
}
