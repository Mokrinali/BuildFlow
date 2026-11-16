import type { z } from "zod";
import { errors } from "@/lib/i18n/ka";
import { AppError } from "@/server/errors";

/** Parse untrusted input; on failure throw a VALIDATION error with per-field Georgian messages. */
export function parseInput<T extends z.ZodType>(schema: T, raw: unknown): z.output<T> {
  const result = schema.safeParse(raw);
  if (result.success) return result.data;
  const fieldErrors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join(".") || "_";
    fieldErrors[key] ??= issue.message;
  }
  throw new AppError("VALIDATION", errors.invalidInput, fieldErrors);
}
