"use client";

import { useActionState, useState } from "react";
import type { RsMode } from "@/generated/prisma/enums";
import { Button, Field, FormMessage } from "@/components/ui";
import { PasswordField } from "@/components/password-field";
import { initialActionState } from "@/server/action-state";
import { saveRsSettingsAction, testRsConnectionAction } from "./actions";

const modes: { value: RsMode; label: string; hint: string }[] = [
  {
    value: "OFF",
    label: "გამორთული",
    hint: "ზედნადები ხელით ეთითება. RS.ge-ს ღილაკები არ ჩანს.",
  },
  {
    value: "DEMO",
    label: "სადემონსტრაციო",
    hint: "გამოგონილი ზედნადებები ფუნქციის გასაცნობად. RS.ge-სთან კავშირი არ ხდება.",
  },
  {
    value: "LIVE",
    label: "რეალური",
    hint: "ზედნადებები RS.ge-დან, ორგანიზაციის სერვისის მომხმარებლით.",
  },
];

export function RsSettingsForm({
  mode,
  serviceUser,
  hasPassword,
}: {
  mode: RsMode;
  serviceUser: string | null;
  hasPassword: boolean;
}) {
  const [state, action, pending] = useActionState(saveRsSettingsAction, initialActionState);
  const [selected, setSelected] = useState<RsMode>(mode);
  const fe = state.fieldErrors ?? {};
  return (
    <form action={action} className="flex flex-col gap-4">
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">რეჟიმი</legend>
        {modes.map((m) => (
          <label
            key={m.value}
            htmlFor={`rs-mode-${m.value}`}
            className="flex cursor-pointer items-start gap-2 rounded-md border border-line p-3 has-checked:border-navy"
          >
            <input
              id={`rs-mode-${m.value}`}
              type="radio"
              name="mode"
              value={m.value}
              checked={selected === m.value}
              onChange={() => setSelected(m.value)}
              className="mt-1 accent-navy"
            />
            <span>
              <span className="font-semibold">{m.label}</span>
              <span className="block text-sm text-steel-600">{m.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {selected === "LIVE" && (
        <>
          <Field
            label="სერვისის მომხმარებელი"
            name="serviceUser"
            autoComplete="off"
            defaultValue={serviceUser ?? ""}
            maxLength={100}
            required
            hint="იქმნება eservices.rs.ge-ზე: მომხმარებლების მართვა → სერვისის მომხმარებელი."
            error={fe.serviceUser}
          />
          <PasswordField
            label="სერვისის მომხმარებლის პაროლი"
            name="password"
            autoComplete="new-password"
            maxLength={200}
            required={!hasPassword}
            hint={
              hasPassword
                ? "პაროლი შენახულია დაშიფრულად. შეცვლისთვის შეიყვანეთ ახალი, თორემ დატოვეთ ცარიელი."
                : "ინახება დაშიფრულად და არასდროს ჩანს."
            }
            error={fe.password}
          />
        </>
      )}
      {selected !== "LIVE" && serviceUser && (
        <input type="hidden" name="serviceUser" value={serviceUser} />
      )}
      <FormMessage ok={state.ok} message={state.fieldErrors ? undefined : state.message} />
      <div>
        <Button type="submit" disabled={pending}>
          შენახვა
        </Button>
      </div>
    </form>
  );
}

export function RsTestButton() {
  const [state, action, pending] = useActionState(testRsConnectionAction, initialActionState);
  return (
    <form action={action} className="flex flex-col items-start gap-2">
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? "მოწმდება…" : "კავშირის შემოწმება"}
      </Button>
      <FormMessage ok={state.ok} message={state.message} />
    </form>
  );
}
