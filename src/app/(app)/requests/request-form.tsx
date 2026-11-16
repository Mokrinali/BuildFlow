"use client";

import { useActionState, useId, useMemo, useState } from "react";
import { Button, FormMessage } from "@/components/ui";
import type { Priority } from "@/generated/prisma/enums";
import { priorityLabel } from "@/lib/i18n/ka";
import { COMMON_UNITS } from "@/lib/units";
import { initialActionState } from "@/server/action-state";
import { saveRequestAction } from "./actions";

export type ItemRow = { name: string; spec: string; quantity: string; unit: string; note: string };
type Row = ItemRow & { key: number };

const PRIORITIES: Priority[] = ["LOW", "NORMAL", "HIGH", "URGENT"];
const emptyRow = (key: number): Row => ({
  key,
  name: "",
  spec: "",
  quantity: "",
  unit: "",
  note: "",
});
const isBlank = (r: ItemRow) =>
  !r.name.trim() && !r.spec.trim() && !r.quantity.trim() && !r.note.trim();

const inputClass =
  "min-h-10 w-full rounded-md border border-steel bg-white px-3 text-base text-navy aria-invalid:border-red-700";

export function RequestForm({
  requestId,
  projects,
  initial,
  today,
}: {
  requestId: string | null;
  projects: { id: string; name: string }[];
  initial?: {
    projectId: string;
    desiredDate: string;
    priority: Priority;
    note: string;
    items: ItemRow[];
  };
  today: string;
}) {
  const [state, action, pending] = useActionState(saveRequestAction, initialActionState);
  const uid = useId();
  const [projectId, setProjectId] = useState(initial?.projectId ?? projects[0]?.id ?? "");
  const [desiredDate, setDesiredDate] = useState(initial?.desiredDate ?? "");
  const [priority, setPriority] = useState<Priority>(initial?.priority ?? "NORMAL");
  const [note, setNote] = useState(initial?.note ?? "");
  const [rows, setRows] = useState<Row[]>(() =>
    initial?.items.length ? initial.items.map((it, i) => ({ ...it, key: i })) : [emptyRow(0)],
  );
  const [nextKey, setNextKey] = useState(rows.length);

  // Blank rows are not sent; keep a map from sent index → row index for error messages.
  const { payload, sentToRow } = useMemo(() => {
    const sent: ItemRow[] = [];
    const map: number[] = [];
    rows.forEach((r, i) => {
      if (isBlank(r)) return;
      sent.push({ name: r.name, spec: r.spec, quantity: r.quantity, unit: r.unit, note: r.note });
      map.push(i);
    });
    return {
      payload: JSON.stringify({ projectId, desiredDate, priority, note, items: sent }),
      sentToRow: map,
    };
  }, [rows, projectId, desiredDate, priority, note]);

  const rowErrors = useMemo(() => {
    const out: Record<number, Partial<Record<keyof ItemRow, string>>> = {};
    for (const [key, msg] of Object.entries(state.fieldErrors ?? {})) {
      const m = /^items\.(\d+)\.(\w+)$/.exec(key);
      if (!m) continue;
      const row = sentToRow[Number(m[1])];
      if (row === undefined) continue;
      (out[row] ??= {})[m[2] as keyof ItemRow] = msg;
    }
    return out;
    // Errors refer to the payload of the last submit; recompute only when they change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.fieldErrors]);

  const update = (i: number, field: keyof ItemRow, value: string) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [field]: value } : r)));
  const addRow = () => {
    setRows((rs) => [...rs, emptyRow(nextKey)]);
    setNextKey((k) => k + 1);
  };
  const removeRow = (i: number) =>
    setRows((rs) => (rs.length === 1 ? [emptyRow(nextKey)] : rs.filter((_, j) => j !== i)));

  const fe = state.fieldErrors ?? {};

  return (
    <form action={action} className="flex flex-col gap-6">
      <input type="hidden" name="payload" value={payload} />
      {requestId && <input type="hidden" name="requestId" value={requestId} />}

      <section className="grid grid-cols-1 gap-4 rounded-lg border border-line bg-white p-4 sm:grid-cols-2 sm:p-6">
        {!requestId && (
          <div className="flex flex-col gap-1 sm:col-span-2">
            <label htmlFor={`${uid}-project`} className="text-sm font-medium">
              პროექტი
            </label>
            <select
              id={`${uid}-project`}
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              aria-invalid={fe.projectId ? true : undefined}
              className={inputClass}
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            {fe.projectId && <p className="text-sm text-red-800">{fe.projectId}</p>}
          </div>
        )}
        <div className="flex flex-col gap-1">
          <label htmlFor={`${uid}-date`} className="text-sm font-medium">
            სასურველი მიწოდების თარიღი
          </label>
          <input
            id={`${uid}-date`}
            type="date"
            min={today}
            value={desiredDate}
            onChange={(e) => setDesiredDate(e.target.value)}
            aria-invalid={fe.desiredDate ? true : undefined}
            className={inputClass}
          />
          {fe.desiredDate && <p className="text-sm text-red-800">{fe.desiredDate}</p>}
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${uid}-priority`} className="text-sm font-medium">
            პრიორიტეტი
          </label>
          <select
            id={`${uid}-priority`}
            value={priority}
            onChange={(e) => setPriority(e.target.value as Priority)}
            className={inputClass}
          >
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {priorityLabel[p]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1 sm:col-span-2">
          <label htmlFor={`${uid}-note`} className="text-sm font-medium">
            შენიშვნა
          </label>
          <textarea
            id={`${uid}-note`}
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={2000}
            className="rounded-md border border-steel bg-white px-3 py-2 text-base text-navy"
          />
          {fe.note && <p className="text-sm text-red-800">{fe.note}</p>}
        </div>
      </section>

      <section className="rounded-lg border border-line bg-white p-4 sm:p-6">
        <h2 className="mb-1 text-lg font-semibold">პოზიციები</h2>
        <p className="mb-4 text-sm text-steel-600">
          რაოდენობაში შეგიძლიათ გამოიყენოთ მძიმე ან წერტილი (მაგ. 1,5). ცარიელი ხაზები არ შეინახება.
        </p>
        {fe.items && <p className="mb-3 text-sm text-red-800">{fe.items}</p>}
        <datalist id={`${uid}-units`}>
          {COMMON_UNITS.map((u) => (
            <option key={u} value={u} />
          ))}
        </datalist>

        <ol className="flex flex-col gap-4">
          {rows.map((r, i) => {
            const err = rowErrors[i] ?? {};
            const id = (f: string) => `${uid}-${r.key}-${f}`;
            const field = (
              f: keyof ItemRow,
              label: string,
              props: React.InputHTMLAttributes<HTMLInputElement> = {},
            ) => (
              <div className="flex flex-col gap-1">
                <label htmlFor={id(f)} className="text-xs font-medium text-steel-600">
                  {label}
                </label>
                <input
                  id={id(f)}
                  value={r[f]}
                  onChange={(e) => update(i, f, e.target.value)}
                  aria-invalid={err[f] ? true : undefined}
                  aria-describedby={err[f] ? id(`${f}-err`) : undefined}
                  className={inputClass}
                  {...props}
                />
                {err[f] && (
                  <p id={id(`${f}-err`)} className="text-sm text-red-800">
                    {err[f]}
                  </p>
                )}
              </div>
            );
            return (
              <li
                key={r.key}
                className="rounded-md border border-line p-3"
                aria-label={`პოზიცია ${i + 1}`}
              >
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm font-semibold">#{i + 1}</span>
                  <button
                    type="button"
                    onClick={() => removeRow(i)}
                    className="rounded px-2 py-1 text-sm text-red-800 underline underline-offset-4"
                    aria-label={`პოზიცია ${i + 1}-ის წაშლა`}
                  >
                    წაშლა
                  </button>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-[2fr_1.2fr_0.8fr_0.9fr]">
                  {field("name", "დასახელება", { maxLength: 200 })}
                  {field("spec", "ზომა / სპეციფიკაცია", { maxLength: 200 })}
                  {field("quantity", "რაოდენობა", { inputMode: "decimal", maxLength: 16 })}
                  {field("unit", "ერთეული", { list: `${uid}-units`, maxLength: 30 })}
                </div>
                <div className="mt-3">{field("note", "შენიშვნა", { maxLength: 500 })}</div>
              </li>
            );
          })}
        </ol>
        <Button type="button" variant="secondary" onClick={addRow} className="mt-4">
          + პოზიციის დამატება
        </Button>
      </section>

      <FormMessage ok={state.ok} message={state.message} />
      <div className="flex flex-wrap gap-3">
        <Button type="submit" name="intent" value="submit" disabled={pending}>
          შენახვა და გაგზავნა განსახილველად
        </Button>
        <Button type="submit" name="intent" value="save" variant="secondary" disabled={pending}>
          მონახაზის შენახვა
        </Button>
      </div>
    </form>
  );
}
