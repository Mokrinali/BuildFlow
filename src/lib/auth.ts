import { createHash } from "node:crypto";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware, isAPIError } from "better-auth/api";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { db } from "@/lib/db";
import { assertProductionEnv } from "@/lib/env";
import { errors } from "@/lib/i18n/ka";
import { clearRateLimit, consumeRateLimit } from "@/server/rate-limit";

/** Sign-in attempts per account in 15 minutes; a successful sign-in resets the count. */
export const LOGIN_LIMIT_PER_ACCOUNT = 10;
const LOGIN_WINDOW_SECONDS = 15 * 60;

function loginAccountKey(body: unknown): string | null {
  const email = (body as { email?: unknown } | undefined)?.email;
  if (typeof email !== "string" || !email.trim()) return null;
  const hash = createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
  return `login-account:${hash}`;
}

assertProductionEnv();

const baseURL = process.env.BETTER_AUTH_URL;
const isProd = process.env.NODE_ENV === "production";

export const auth = betterAuth({
  baseURL,
  // Self-service profile/email changes and account deletion are disabled: names appear in the
  // audit timeline, so only admins manage them. Password change goes through our server action.
  // /verify-password is unused here; disabled so a stolen session cannot test passwords with it.
  disabledPaths: [
    "/update-user",
    "/change-email",
    "/delete-user",
    "/change-password",
    "/verify-password",
  ],
  secret: process.env.BETTER_AUTH_SECRET,
  trustedOrigins: baseURL ? [baseURL] : [],
  database: prismaAdapter(db, { provider: "postgresql" }),
  emailAndPassword: {
    enabled: true,
    // Accounts are created by an organization admin, never by public sign-up.
    disableSignUp: true,
    autoSignIn: false,
    minPasswordLength: 10,
    maxPasswordLength: 128,
  },
  user: {
    additionalFields: {
      organizationId: { type: "string", required: true, input: false },
      orgRole: { type: "string", required: false, input: false, defaultValue: "MEMBER" },
      isActive: { type: "boolean", required: false, input: false, defaultValue: true },
      mustChangePassword: { type: "boolean", required: false, input: false, defaultValue: false },
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // refresh once a day
  },
  rateLimit: {
    enabled: true,
    storage: "database",
    window: 60,
    max: 100,
    customRules: {
      "/sign-in/email": { window: 60, max: 5 },
    },
  },
  advanced: {
    useSecureCookies: isProd,
    // Production runs only behind Cloudflare Tunnel (the app port is not published), so
    // CF-Connecting-IP is set by Cloudflare and cannot be forged by the client.
    ipAddress: { ipAddressHeaders: isProd ? ["cf-connecting-ip"] : ["x-forwarded-for"] },
  },
  hooks: {
    // Per-account login limit on top of the per-IP one: guessing one account's password from
    // many addresses is slowed down too. The key is a hash, so emails are not stored here.
    // Every attempt is counted before the password is checked (atomic, so parallel guesses
    // cannot slip past), and a successful sign-in resets the count: only consecutive failures
    // lock the account. While locked, even the right password is refused; checking it would
    // tell a guesser when they found it.
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== "/sign-in/email") return;
      const key = loginAccountKey(ctx.body);
      if (!key) return;
      try {
        await consumeRateLimit(key, LOGIN_LIMIT_PER_ACCOUNT, LOGIN_WINDOW_SECONDS);
      } catch {
        throw new APIError("TOO_MANY_REQUESTS", {
          message: errors.accountLocked,
          code: "ACCOUNT_LOCKED",
        });
      }
    }),
    after: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== "/sign-in/email") return;
      // Reset only on success: resetting on other errors (e.g. a malformed request) would let
      // a guesser clear the count between guesses.
      if (isAPIError(ctx.context.returned)) return;
      const key = loginAccountKey(ctx.body);
      if (key) await clearRateLimit(key);
    }),
  },
  databaseHooks: {
    session: {
      create: {
        // Deactivated users cannot start new sessions.
        before: async (session) => {
          const user = await db.user.findUnique({
            where: { id: session.userId },
            select: { isActive: true },
          });
          if (!user?.isActive) return false;
        },
      },
    },
  },
  plugins: [nextCookies()],
});
