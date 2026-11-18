"use client";

import { useEffect } from "react";
import { formatIsoDate } from "@/lib/format";

type Validatable = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

const isValidatable = (t: EventTarget | null): t is Validatable =>
  t instanceof HTMLInputElement ||
  t instanceof HTMLSelectElement ||
  t instanceof HTMLTextAreaElement;

/** Georgian text for the browser's built-in validation bubble. */
function message(el: Validatable): string {
  const v = el.validity;
  const input = el instanceof HTMLInputElement ? el : null;
  const isDate = input?.type === "date";
  const bound = (value: string) => (isDate ? formatIsoDate(value) : value);
  if (v.valueMissing) {
    if (el instanceof HTMLSelectElement) return "აირჩიეთ მნიშვნელობა.";
    if (input?.type === "checkbox") return "მონიშნეთ ეს ველი.";
    return "შეავსეთ ეს ველი.";
  }
  if (v.typeMismatch)
    return input?.type === "email" ? "შეიყვანეთ სწორი ელფოსტა." : "მნიშვნელობა არასწორია.";
  if (v.badInput) return isDate ? "შეიყვანეთ სწორი თარიღი." : "შეიყვანეთ რიცხვი.";
  if (v.rangeUnderflow && input) {
    return isDate
      ? `თარიღი არ უნდა იყოს ${bound(input.min)}-ზე ადრე.`
      : `მინიმალური მნიშვნელობაა ${input.min}.`;
  }
  if (v.rangeOverflow && input) {
    return isDate
      ? `თარიღი არ უნდა იყოს ${bound(input.max)}-ზე გვიან.`
      : `მაქსიმალური მნიშვნელობაა ${input.max}.`;
  }
  if (v.tooShort && !(el instanceof HTMLSelectElement)) return `მინიმუმ ${el.minLength} სიმბოლო.`;
  if (v.tooLong && !(el instanceof HTMLSelectElement)) return `მაქსიმუმ ${el.maxLength} სიმბოლო.`;
  return "მნიშვნელობა არასწორია.";
}

/**
 * Replaces the browser's validation messages (shown in the browser's own language, e.g.
 * "Please fill out this field.") with Georgian ones, for every form. Mounted once in the root
 * layout. The server still validates everything; this only changes the text of the bubble.
 */
export function GeorgianValidation() {
  useEffect(() => {
    const onInvalid = (e: Event) => {
      if (!isValidatable(e.target)) return;
      e.target.setCustomValidity("");
      e.target.setCustomValidity(message(e.target));
    };
    // A custom message keeps the field invalid until cleared, so clear it on every edit.
    const onEdit = (e: Event) => {
      if (isValidatable(e.target)) e.target.setCustomValidity("");
    };
    document.addEventListener("invalid", onInvalid, true);
    document.addEventListener("input", onEdit, true);
    document.addEventListener("change", onEdit, true);
    return () => {
      document.removeEventListener("invalid", onInvalid, true);
      document.removeEventListener("input", onEdit, true);
      document.removeEventListener("change", onEdit, true);
    };
  }, []);
  return null;
}
