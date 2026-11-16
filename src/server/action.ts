import { errors } from "@/lib/i18n/ka";
import type { ActionState } from "@/server/action-state";
import { AppError } from "@/server/errors";

export type { ActionState };

/**
 * Run a server-action body and turn expected errors into a form state.
 * Unexpected errors are logged (without request data) and shown as a generic message.
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
    console.error("action failed:", e instanceof Error ? e.name : "unknown");
    return { ok: false, message: errors.unexpected };
  }
}

function isNextControlFlow(e: unknown): boolean {
  const digest = typeof e === "object" && e !== null && "digest" in e ? String(e.digest) : "";
  return digest.startsWith("NEXT_REDIRECT") || digest.startsWith("NEXT_HTTP_ERROR_FALLBACK");
}
