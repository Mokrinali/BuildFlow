import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { db } from "@/lib/db";
import { assertProductionEnv } from "@/lib/env";

assertProductionEnv();

const baseURL = process.env.BETTER_AUTH_URL;
const isProd = process.env.NODE_ENV === "production";

export const auth = betterAuth({
  baseURL,
  // Self-service profile/email changes and account deletion are disabled: names appear in the
  // audit timeline, so only admins manage them. Password change goes through our server action.
  disabledPaths: ["/update-user", "/change-email", "/delete-user", "/change-password"],
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
