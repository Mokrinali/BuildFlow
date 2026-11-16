// Fixed-window rate limit for application operations (login is limited by Better Auth itself).
// Shares the RateLimit table with Better Auth; keys here always start with "app:".
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { errors } from "@/lib/i18n/ka";
import { AppError } from "@/server/errors";

/**
 * Count one attempt for `key` and throw RATE_LIMITED above `max` attempts per window.
 * Atomic (single upsert), and it runs outside business transactions so failed attempts count.
 */
export async function consumeRateLimit(key: string, max: number, windowSeconds = 60) {
  const now = BigInt(Date.now());
  const windowStart = now - BigInt(windowSeconds * 1000);
  const rows = await db.$queryRaw<{ count: number }[]>`
    INSERT INTO "RateLimit" ("id", "key", "count", "lastRequest")
    VALUES (${randomUUID()}, ${`app:${key}`}, 1, ${now})
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "RateLimit"."lastRequest" < ${windowStart} THEN 1
                     ELSE "RateLimit"."count" + 1 END,
      "lastRequest" = CASE WHEN "RateLimit"."lastRequest" < ${windowStart} THEN ${now}
                           ELSE "RateLimit"."lastRequest" END
    RETURNING "count"`;
  if ((rows[0]?.count ?? 0) > max) throw new AppError("RATE_LIMITED", errors.tooManyAttempts);
}
