import { z } from "zod";
import { errors } from "@/lib/i18n/ka";
import type { ActionState } from "@/server/action-state";
import { AppError, notFound } from "@/server/errors";

export type { ActionState };

/**
 * Run a server-action body and turn expected errors into a form state.
 * Unexpected errors are logged without request data and shown as a generic message.
 */
export async function runAction(fn: () => Promise<string | void>): Promise<ActionState> {
  try {
    const message = await fn();
    return { ok: true, message: message ?? undefined };
  } catch (e) {
    if (e instanceof AppError) {
      return { ok: false, message: e.message, fieldErrors: e.fieldErrors };
    }
    // Let Next.js handle redirect()/notFound() control-flow errors.
    if (isNextControlFlow(e)) throw e;
    logUnexpected(e);
    return { ok: false, message: errors.unexpected };
  }
}

/** Log error type, code and stack frames, but not the message (it can contain user data). */
function logUnexpected(e: unknown) {
  if (e instanceof Error) {
    const code = "code" in e ? String(e.code) : undefined;
    const frames = e.stack?.split("\n").slice(1).join("\n");
    console.error(`action failed: ${e.name}${code ? ` (${code})` : ""}\n${frames ?? ""}`);
  } else {
    console.error("action failed: non-Error thrown");
  }
}

function isNextControlFlow(e: unknown): boolean {
  const digest = typeof e === "object" && e !== null && "digest" in e ? String(e.digest) : "";
  return digest.startsWith("NEXT_REDIRECT") || digest.startsWith("NEXT_HTTP_ERROR_FALLBACK");
}

const idSchema = z.string().min(1).max(64);

/** Validate an id that a client bound into a server action. */
export function parseId(value: unknown): string {
  const r = idSchema.safeParse(value);
  if (!r.success) throw notFound();
  return r.data;
}

/** Validate a boolean that a client bound into a server action. */
export function parseBool(value: unknown): boolean {
  if (typeof value !== "boolean") throw new AppError("VALIDATION", errors.invalidInput);
  return value;
}

// Server actions receive ids as hidden form fields, not via `action.bind(...)`:
// in Next.js 16.4 a bound action used with useActionState and posted without JavaScript
// sends the server into an endless render loop (a one-request denial of service).

/** Read and validate an id from a hidden form field. */
export function formId(form: FormData, key: string): string {
  return parseId(form.get(key));
}

/** Read a "1"/"0" flag from a hidden form field. */
export function formFlag(form: FormData, key: string): boolean {
  const v = form.get(key);
  if (v === "1") return true;
  if (v === "0") return false;
  throw new AppError("VALIDATION", errors.invalidInput);
}

const MAX_PAYLOAD = 200_000; // characters; item caps are enforced by the services

/** Read the JSON "payload" field that client forms with item rows send. */
export function formPayload(form: FormData): unknown {
  const raw = form.get("payload");
  if (typeof raw !== "string" || raw.length > MAX_PAYLOAD) {
    throw new AppError("VALIDATION", errors.invalidInput);
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new AppError("VALIDATION", errors.invalidInput);
  }
}
