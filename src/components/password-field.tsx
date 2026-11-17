"use client";

import { useState, type ComponentProps } from "react";
import { Field, fieldInputClass } from "@/components/ui";

type PasswordFieldProps = Omit<ComponentProps<typeof Field>, "type" | "adornment"> & {
  /** Colors of the eye button; the default suits light forms. */
  toggleClassName?: string;
};

/** Password input with an eye button that shows or hides what was typed. */
export function PasswordField({
  className = fieldInputClass,
  toggleClassName = "text-steel-600 hover:text-navy",
  ...props
}: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);
  const label = visible ? "პაროლის დამალვა" : "პაროლის ჩვენება";
  return (
    <Field
      {...props}
      type={visible ? "text" : "password"}
      className={`${className} pr-12`}
      adornment={
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={label}
          aria-pressed={visible}
          aria-controls={props.id ?? `f-${props.name}`}
          title={label}
          className={`absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-md focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-orange ${toggleClassName}`}
        >
          {visible ? <EyeOffIcon /> : <EyeIcon />}
        </button>
      }
    />
  );
}

function EyeIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M10.6 5.1A10.6 10.6 0 0 1 12 5c6.5 0 10 7 10 7a17.6 17.6 0 0 1-2.9 3.9" />
      <path d="M6.6 6.6C3.7 8.4 2 12 2 12s3.5 7 10 7c1.9 0 3.6-.6 5-1.5" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
      <path d="m2 2 20 20" />
    </svg>
  );
}
