// Small shared UI primitives styled with the brand tokens.
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

const buttonBase =
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-md px-4 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60";
const buttonVariants: Record<ButtonVariant, string> = {
  // Orange with navy text: contrast 6.3:1.
  primary: "bg-orange text-navy hover:bg-orange-600",
  secondary: "border border-steel bg-white text-navy hover:bg-offwhite",
  danger: "border border-red-700 bg-white text-red-800 hover:bg-red-50",
  ghost: "text-navy hover:bg-navy/5",
};

export function buttonClass(variant: ButtonVariant = "primary", extra = "") {
  return `${buttonBase} ${buttonVariants[variant]} ${extra}`;
}

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ComponentProps<"button"> & { variant?: ButtonVariant }) {
  return <button className={buttonClass(variant, className)} {...props} />;
}

export function ButtonLink({
  variant = "primary",
  className = "",
  ...props
}: ComponentProps<typeof Link> & { variant?: ButtonVariant }) {
  return <Link className={buttonClass(variant, className)} {...props} />;
}

export const fieldInputClass =
  "min-h-10 rounded-md border border-steel bg-white px-3 text-base text-navy placeholder:text-steel-600 aria-invalid:border-red-700";

export function Field({
  label,
  name,
  error,
  hint,
  adornment,
  ...input
}: ComponentProps<"input"> & {
  label: string;
  name: string;
  error?: string;
  hint?: string;
  /** Rendered over the right edge of the input, e.g. a show-password button. */
  adornment?: ReactNode;
}) {
  const id = input.id ?? `f-${name}`;
  const describedBy = [error ? `${id}-err` : null, hint ? `${id}-hint` : null]
    .filter(Boolean)
    .join(" ");
  const field = (
    <input
      id={id}
      name={name}
      aria-invalid={error ? true : undefined}
      aria-describedby={describedBy || undefined}
      className={fieldInputClass}
      {...input}
    />
  );
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {adornment ? (
        <div className="relative flex flex-col">
          {field}
          {adornment}
        </div>
      ) : (
        field
      )}
      {hint && (
        <p id={`${id}-hint`} className="text-xs text-steel-600">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-err`} className="text-sm text-red-800">
          {error}
        </p>
      )}
    </div>
  );
}

export function FormMessage({ ok, message }: { ok: boolean; message?: string }) {
  if (!message) return null;
  return (
    <p
      role={ok ? "status" : "alert"}
      className={`rounded-md px-3 py-2 text-sm ${ok ? "bg-green-50 text-green-900" : "bg-red-50 text-red-900"}`}
    >
      {message}
    </p>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-lg border border-line bg-white p-4 sm:p-6 ${className}`}>
      {children}
    </section>
  );
}

export function PageHeader({ title, actions }: { title: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-2xl font-bold">{title}</h1>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-steel bg-white p-8 text-center">
      <p className="font-semibold">{title}</p>
      {children && <div className="mt-2 text-sm text-steel-600">{children}</div>}
    </div>
  );
}

const badgeTones = {
  navy: "bg-navy/10 text-navy",
  green: "bg-green-100 text-green-900",
  gray: "bg-gray-200 text-gray-800",
  orange: "bg-orange/15 text-[#8a3f00]",
  red: "bg-red-100 text-red-900",
} as const;

export function Badge({
  tone = "navy",
  children,
}: {
  tone?: keyof typeof badgeTones;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${badgeTones[tone]}`}
    >
      {children}
    </span>
  );
}
