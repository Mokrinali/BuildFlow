"use client";

import Link from "next/link";
import { useActionState, useId, useMemo, useState } from "react";
import { Button, FormMessage } from "@/components/ui";
import type { Priority } from "@/generated/prisma/enums";
import { formatDateTime } from "@/lib/format";
import { priorityLabel } from "@/lib/i18n/ka";
import { COMMON_UNITS, formatRequestNumber } from "@/lib/units";
import { initialActionState } from "@/server/action-state";
import type { ImportPreview } from "@/server/import/service";
import { confirmImportAction, previewImportAction, type PreviewState } from "./actions";

const inputClass =
  "min-h-10 w-full rounded-md border border-steel bg-white px-3 text-base text-navy aria-invalid:border-red-700";
const flaggedClass = "border-orange bg-orange/5";
const MAX_TEXT = 10_000;

export function ImportFlow({
  projects,
  initialProjectId,
  today,
}: {
  projects: { id: string; name: string }[];
  initialProjectId: string;
  today: string;
}) {
  const [state, action, pending] = useActionState<PreviewState, FormData>(
    previewImportAction,
    initialActionState,
  );
  const uid = useId();
  // Controlled fields: React resets uncontrolled inputs after a form action.
  const [projectId, setProjectId] = useState(initialProjectId);
  const [text, setText] = useState("");
  const [editing, setEditing] = useState(true);
  const [seen, setSeen] = useState(state);
  if (state !== seen) {
    setSeen(state);
    if (state.preview) setEditing(false);
  }
  const preview = state.preview;
  const fe = state.fieldErrors ?? {};

  // No maxLength on the textarea: browsers silently cut a longer paste. Show the limit instead.
  const tooLong = text.length > MAX_TEXT;

  return (
    <>
      {preview && (
        // Stays mounted while the text is shown again, so review edits are not lost.
        // A new preview (new idempotency key) starts a fresh review.
        <div hidden={editing}>
          <ImportReview
            key={preview.idempotencyKey}
            preview={preview}
            projectName={projects.find((p) => p.id === preview.projectId)?.name ?? ""}
            today={today}
            onBack={() => setEditing(true)}
          />
        </div>
      )}
      {(editing || !preview) && (
        <TextStep
          uid={uid}
          action={action}
          pending={pending}
          state={state}
          projects={projects}
          projectId={projectId}
          setProjectId={setProjectId}
          text={text}
          setText={setText}
          tooLong={tooLong}
          fe={fe}
          onShowPreview={preview ? () => setEditing(false) : undefined}
        />
      )}
    </>
  );
}

function TextStep({
  uid,
  action,
  pending,
  state,
  projects,
  projectId,
  setProjectId,
  text,
  setText,
  tooLong,
  fe,
  onShowPreview,
}: {
  uid: string;
  action: (form: FormData) => void;
  pending: boolean;
  state: PreviewState;
  projects: { id: string; name: string }[];
  projectId: string;
  setProjectId: (v: string) => void;
  text: string;
  setText: (v: string) => void;
  tooLong: boolean;
  fe: Record<string, string>;
  onShowPreview?: () => void;
}) {
  return (
    <form
      action={action}
      className="flex flex-col gap-4 rounded-lg border border-line bg-white p-4 sm:p-6"
    >
      <p className="text-sm text-steel-600">
        დააკოპირეთ შეტყობინება WhatsApp-იდან და ჩასვით ქვემოთ. ტექსტი არ ინახება: სისტემა მისგან
        ამოიცნობს პოზიციებს, თქვენ გადახედავთ და შეასწორებთ, შემდეგ შეიქმნება მონახაზი.
      </p>
      <div className="flex flex-col gap-1">
        <label htmlFor={`${uid}-project`} className="text-sm font-medium">
          პროექტი
        </label>
        <select
          id={`${uid}-project`}
          name="projectId"
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
      <div className="flex flex-col gap-1">
        <label htmlFor={`${uid}-text`} className="text-sm font-medium">
          შეტყობინების ტექსტი
        </label>
        <textarea
          id={`${uid}-text`}
          name="text"
          rows={12}
          value={text}
          onChange={(e) => setText(e.target.value)}
          required
          placeholder={"მაგალითად:\nცემენტი 25 ტომარა\n12 ც. არმატურა Ø12\nმიწოდება ხვალ"}
          aria-invalid={fe.text || tooLong ? true : undefined}
          aria-describedby={`${uid}-count${fe.text ? ` ${uid}-text-err` : ""}`}
          className="rounded-md border border-steel bg-white px-3 py-2 font-mono text-sm text-navy aria-invalid:border-red-700"
        />
        <p
          id={`${uid}-count`}
          className={`text-xs ${tooLong ? "font-semibold text-red-800" : "text-steel-600"}`}
          aria-live="polite"
        >
          {text.length} / {MAX_TEXT} სიმბოლო
          {tooLong &&
            ` · ტექსტი ძალიან გრძელია, ზედმეტია ${text.length - MAX_TEXT} სიმბოლო. გაყავით ნაწილებად.`}
        </p>
        {fe.text && (
          <p id={`${uid}-text-err`} className="text-sm text-red-800">
            {fe.text}
          </p>
        )}
      </div>
      {!state.ok && <FormMessage ok={false} message={state.message} />}
      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={pending || !text.trim() || tooLong}>
          {pending ? "მუშავდება…" : "გადახედვა"}
        </Button>
        {onShowPreview && (
          <Button type="button" variant="secondary" onClick={onShowPreview}>
            წინა გადახედვაზე დაბრუნება
          </Button>
        )}
      </div>
    </form>
  );
}

// ─── Review ──────────────────────────────────────────────────────────────────

type Field = "name" | "spec" | "quantity" | "unit" | "note";
type Row = Record<Field, string> & {
  key: number;
  lineNo: number | null;
  skip: boolean;
  flags: string[];
  issues: string[];
};

function rowsFrom(preview: ImportPreview): Row[] {
  let key = 0;
  return preview.lines.flatMap((l) =>
    l.kind === "items"
      ? l.items.map((it) => ({
          key: key++,
          lineNo: l.lineNo,
          name: it.name,
          spec: it.spec,
          quantity: it.quantity ?? "",
          unit: it.unit ?? "",
          note: "",
          skip: false,
          flags: it.flags,
          issues: it.issues,
        }))
      : [],
  );
}

function ImportReview({
  preview,
  projectName,
  today,
  onBack,
}: {
  preview: ImportPreview;
  projectName: string;
  today: string;
  onBack: () => void;
}) {
  const [state, action, pending] = useActionState(confirmImportAction, initialActionState);
  const uid = useId();
  const [rows, setRows] = useState<Row[]>(() => rowsFrom(preview));
  const [nextKey, setNextKey] = useState(rows.length);
  const [desiredDate, setDesiredDate] = useState(preview.desiredDate?.value ?? "");
  const [priority, setPriority] = useState<Priority>("NORMAL");
  const [note, setNote] = useState("");
  const [allowRepeat, setAllowRepeat] = useState(false);
  const lineText = useMemo(
    () => new Map(preview.lines.map((l) => [l.lineNo, l.text])),
    [preview.lines],
  );
  const skippedLines = preview.lines.filter((l) => l.kind === "skipped");
  const added = new Set(rows.map((r) => r.lineNo));

  const { payload, sentToRow } = useMemo(() => {
    const sent: (Record<Field, string> & { lineNo: number | null })[] = [];
    const map: number[] = [];
    rows.forEach((r, i) => {
      if (r.skip) return;
      sent.push({
        name: r.name,
        spec: r.spec,
        quantity: r.quantity,
        unit: r.unit,
        note: r.note,
        lineNo: r.lineNo,
      });
      map.push(i);
    });
    return {
      payload: JSON.stringify({
        projectId: preview.projectId,
        idempotencyKey: preview.idempotencyKey,
        textHash: preview.textHash,
        allowRepeat,
        desiredDate,
        priority,
        note,
        items: sent,
        stats: {
          lineCount: preview.stats.lineCount,
          skippedLineCount: preview.stats.skippedLineCount,
          flaggedItemCount: preview.stats.flaggedItemCount,
        },
      }),
      sentToRow: map,
    };
  }, [rows, preview, allowRepeat, desiredDate, priority, note]);

  const rowErrors = useMemo(() => {
    const out: Record<number, Partial<Record<Field, string>>> = {};
    for (const [key, msg] of Object.entries(state.fieldErrors ?? {})) {
      const m = /^items\.(\d+)\.(\w+)$/.exec(key);
      const row = m ? sentToRow[Number(m[1])] : undefined;
      if (row !== undefined) (out[row] ??= {})[m![2] as Field] = msg;
    }
    return out;
    // Errors refer to the payload of the last submit; recompute only when they change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.fieldErrors]);

  const update = (i: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const insertAfter = (i: number, row: Omit<Row, "key">) => {
    setRows((rs) => [...rs.slice(0, i + 1), { ...row, key: nextKey }, ...rs.slice(i + 1)]);
    setNextKey((k) => k + 1);
  };
  const blankRow = (lineNo: number | null, name = ""): Omit<Row, "key"> => ({
    lineNo,
    name,
    spec: "",
    quantity: "",
    unit: "",
    note: "",
    skip: false,
    flags: ["quantity", "unit"],
    issues: [],
  });

  const fe = state.fieldErrors ?? {};
  const active = rows.filter((r) => !r.skip).length;
  const unresolved = rows.filter(
    (r) => !r.skip && (!r.quantity.trim() || !r.unit.trim() || !r.name.trim()),
  ).length;
  const dateIssues = preview.desiredDate?.issues ?? [];
  const needsRepeat = preview.duplicateOf !== null || Boolean(fe.allowRepeat);

  return (
    <form action={action} className="flex flex-col gap-6">
      <input type="hidden" name="payload" value={payload} />

      <section className="rounded-lg border border-line bg-white p-4 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">გადახედვა</h2>
            <p className="text-sm text-steel-600">
              {projectName} · ხაზები: {preview.stats.lineCount} · ამოცნობილი პოზიციები:{" "}
              {preview.stats.itemCount} · დასაზუსტებელი: {preview.stats.flaggedItemCount}
            </p>
          </div>
          <Button type="button" variant="secondary" onClick={onBack}>
            ტექსტის შეცვლა
          </Button>
        </div>
        {needsRepeat && (
          <div
            role="alert"
            className="mt-4 rounded-md border border-orange bg-orange/10 p-3 text-sm"
          >
            {preview.duplicateOf ? (
              <p>
                ეს ტექსტი ამ პროექტში უკვე შემოტანილია:{" "}
                <Link
                  href={`/requests/${preview.duplicateOf.requestId}`}
                  className="font-semibold underline underline-offset-4"
                >
                  მოთხოვნა {formatRequestNumber(preview.duplicateOf.number)}
                </Link>{" "}
                ({preview.duplicateOf.by}, {formatDateTime(new Date(preview.duplicateOf.createdAt))}
                ).
              </p>
            ) : (
              // Imported by someone else between this preview and the confirm.
              <p>{fe.allowRepeat}</p>
            )}
            <label className="mt-2 flex items-center gap-2 font-medium">
              <input
                type="checkbox"
                checked={allowRepeat}
                onChange={(e) => setAllowRepeat(e.target.checked)}
                className="h-5 w-5 accent-navy"
              />
              ვიცი და მაინც ვქმნი ახალ მოთხოვნას
            </label>
          </div>
        )}
      </section>

      <section className="grid grid-cols-1 gap-4 rounded-lg border border-line bg-white p-4 sm:grid-cols-2 sm:p-6">
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
            aria-describedby={`${uid}-date-hint`}
            className={`${inputClass} ${dateIssues.length && !fe.desiredDate ? flaggedClass : ""}`}
          />
          <div id={`${uid}-date-hint`} className="text-xs text-steel-600">
            {preview.desiredDate ? (
              <>
                ამოცნობილია ხაზიდან {preview.desiredDate.lineNo}: „
                {lineText.get(preview.desiredDate.lineNo)}“
                {dateIssues.map((m) => (
                  <span key={m} className="block font-medium text-[#8a3f00]">
                    {m}
                  </span>
                ))}
              </>
            ) : (
              "ტექსტში თარიღი ვერ მოიძებნა."
            )}
          </div>
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
            {(["LOW", "NORMAL", "HIGH", "URGENT"] as Priority[]).map((p) => (
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
            maxLength={2000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="rounded-md border border-steel bg-white px-3 py-2 text-base text-navy"
          />
        </div>
      </section>

      <section className="rounded-lg border border-line bg-white p-4 sm:p-6">
        <h2 className="mb-1 text-lg font-semibold">პოზიციები ({active})</h2>
        <p className="mb-4 text-sm text-steel-600">
          ნარინჯისფრად და ვარსკვლავით (*) მონიშნული ველები დასაზუსტებელია. შეგიძლიათ შეასწოროთ,
          გაყოთ ან გამოტოვოთ პოზიცია.
        </p>
        {fe.items && <p className="mb-3 text-sm text-red-800">{fe.items}</p>}
        <datalist id={`${uid}-units`}>
          {COMMON_UNITS.map((u) => (
            <option key={u} value={u} />
          ))}
        </datalist>
        {rows.length === 0 && (
          <p className="mb-4 text-sm text-steel-600">
            ტექსტიდან პოზიციები ვერ ამოიცნო. დაამატეთ ხელით ან გამოტოვებული ხაზებიდან.
          </p>
        )}
        <ol className="flex flex-col gap-4">
          {rows.map((r, i) => {
            const err = rowErrors[i] ?? {};
            const id = (f: string) => `${uid}-${r.key}-${f}`;
            const label = `პოზიცია ${i + 1}`;
            const field = (
              f: Field,
              text: string,
              props: React.InputHTMLAttributes<HTMLInputElement> = {},
            ) => {
              const flagged = !err[f] && r.flags.includes(f) && !r.skip;
              return (
                <div className="flex flex-col gap-1">
                  <label htmlFor={id(f)} className="text-xs font-medium text-steel-600">
                    {text}
                    {flagged && (
                      <>
                        <span aria-hidden className="font-bold text-[#8a3f00]">
                          {" "}
                          *
                        </span>
                        <span className="sr-only"> (დასაზუსტებელი)</span>
                      </>
                    )}
                  </label>
                  <input
                    id={id(f)}
                    value={r[f]}
                    disabled={r.skip}
                    onChange={(e) =>
                      update(i, { [f]: e.target.value, flags: r.flags.filter((x) => x !== f) })
                    }
                    aria-invalid={err[f] ? true : undefined}
                    aria-describedby={err[f] ? id(`${f}-err`) : undefined}
                    className={`${inputClass} ${flagged ? flaggedClass : ""}`}
                    {...props}
                  />
                  {err[f] && (
                    <p id={id(`${f}-err`)} className="text-sm text-red-800">
                      {err[f]}
                    </p>
                  )}
                </div>
              );
            };
            return (
              <li
                key={r.key}
                aria-label={label}
                className={`rounded-md border p-3 ${r.skip ? "border-dashed border-steel bg-offwhite" : "border-line"}`}
              >
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="min-w-0 text-xs text-steel-600">
                    <span className="font-semibold text-navy">#{i + 1}</span>
                    {r.lineNo !== null ? (
                      <>
                        {" "}
                        · ხაზი {r.lineNo}: <q className="break-words">{lineText.get(r.lineNo)}</q>
                      </>
                    ) : (
                      " · ხელით დამატებული"
                    )}
                  </p>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => update(i, { skip: !r.skip })}
                      className="rounded px-2 py-1 text-sm underline underline-offset-4"
                      aria-label={`${label}: ${r.skip ? "დაბრუნება" : "გამოტოვება"}`}
                    >
                      {r.skip ? "დაბრუნება" : "გამოტოვება"}
                    </button>
                    {!r.skip && (
                      <button
                        type="button"
                        onClick={() =>
                          insertAfter(i, {
                            ...blankRow(r.lineNo, r.name),
                            spec: r.spec,
                            unit: r.unit,
                            flags: ["quantity"],
                          })
                        }
                        className="rounded px-2 py-1 text-sm underline underline-offset-4"
                        aria-label={`${label}: გაყოფა ორ პოზიციად`}
                      >
                        გაყოფა
                      </button>
                    )}
                  </div>
                </div>
                {!r.skip && r.issues.length > 0 && (
                  <ul className="mb-2 text-xs font-medium text-[#8a3f00]">
                    {r.issues.map((m) => (
                      <li key={m}>{m}</li>
                    ))}
                  </ul>
                )}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-[2fr_1.2fr_0.8fr_0.9fr]">
                  {field("name", "დასახელება", { maxLength: 200 })}
                  {field("spec", "ზომა / სპეციფიკაცია", { maxLength: 200 })}
                  {field("quantity", "რაოდენობა", { inputMode: "decimal", maxLength: 16 })}
                  {field("unit", "ერთეული", { list: `${uid}-units`, maxLength: 30 })}
                </div>
                {!r.skip && (
                  <div className="mt-3">{field("note", "შენიშვნა", { maxLength: 500 })}</div>
                )}
              </li>
            );
          })}
        </ol>
        <Button
          type="button"
          variant="secondary"
          className="mt-4"
          onClick={() => insertAfter(rows.length - 1, blankRow(null))}
        >
          + პოზიციის დამატება
        </Button>
      </section>

      {skippedLines.length > 0 && (
        <details className="rounded-lg border border-line bg-white p-4 sm:p-6">
          <summary className="cursor-pointer font-semibold">
            გამოტოვებული ხაზები ({skippedLines.length})
          </summary>
          <ul className="mt-3 flex flex-col gap-2 text-sm">
            {skippedLines.map((l) => (
              <li key={l.lineNo} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="text-steel-600">ხაზი {l.lineNo}:</span>
                <q className="min-w-0 break-words">{l.text}</q>
                <span className="text-xs text-steel-600">
                  ({l.kind === "skipped" ? l.reason : ""})
                </span>
                <button
                  type="button"
                  disabled={added.has(l.lineNo)}
                  onClick={() => insertAfter(rows.length - 1, blankRow(l.lineNo, l.text))}
                  className="rounded px-1 text-sm underline underline-offset-4 disabled:no-underline disabled:opacity-60"
                >
                  {added.has(l.lineNo) ? "დამატებულია" : "პოზიციად დამატება"}
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}

      {!state.fieldErrors && <FormMessage ok={state.ok} message={state.message} />}
      {state.fieldErrors && !fe.allowRepeat && (
        <FormMessage ok={false} message="შეასწორეთ მონიშნული ველები და სცადეთ თავიდან." />
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending || active === 0 || (needsRepeat && !allowRepeat)}>
          {pending ? "იქმნება…" : "მონახაზის შექმნა"}
        </Button>
        {unresolved > 0 && (
          <span className="text-sm text-[#8a3f00]">დასაზუსტებელი პოზიციები: {unresolved}</span>
        )}
      </div>
    </form>
  );
}
