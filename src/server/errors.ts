import { errors } from "@/lib/i18n/ka";

export type AppErrorCode =
  "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND" | "CONFLICT" | "VALIDATION";

/** An expected business error with a Georgian message that is safe to show to the user. */
export class AppError extends Error {
  constructor(
    public readonly code: AppErrorCode,
    message: string,
    public readonly fieldErrors?: Record<string, string>,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const forbidden = () => new AppError("FORBIDDEN", errors.forbidden);
export const notFound = () => new AppError("NOT_FOUND", errors.notFound);

/** Prisma unique-constraint violation. */
export function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && "code" in e && e.code === "P2002";
}
