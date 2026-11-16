import type { z } from "zod";
import { errors } from "@/lib/i18n/ka";
import { AppError } from "@/server/errors";

/** Parse untrusted input; on failure throw a VALIDATION error with per-field Georgian messages. */
/** True if any string in the input holds a NUL character (Postgres text cannot store it). */
function hasNul(v: unknown, depth = 0): boolean {
  if (typeof v === "string") return v.includes("\u0000");
  if (depth > 6 || v === null || typeof v !== "object") return false;
  return Object.values(v as Record<string, unknown>).some((x) => hasNul(x, depth + 1));
}

export function parseInput<T extends z.ZodType>(schema: T, raw: unknown): z.output<T> {
  if (hasNul(raw)) throw new AppError("VALIDATION", errors.controlCharacters);
  const result = schema.safeParse(raw);
  if (result.success) return result.data;
  const fieldErrors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join(".") || "_";
    fieldErrors[key] ??= issue.message;
  }
  throw new AppError("VALIDATION", errors.invalidInput, fieldErrors);
}
