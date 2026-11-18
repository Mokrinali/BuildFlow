"use client";

import { useActionState, useId, useMemo, useState } from "react";
import { Button, FormMessage } from "@/components/ui";
import type { Currency } from "@/generated/prisma/enums";
import { formatMoney, formatQuantity } from "@/lib/format";
import { normalizePrice, normalizeQuantity } from "@/lib/quantity";
import { currencyLabel } from "@/lib/i18n/ka";
import { initialActionState } from "@/server/action-state";
import { createOrderAction } from "../actions";

type DraftItem = {
  id: string;
  position: number;
  name: string;
  spec: string | null;
  unit: string;
  approved: string;
  ordered: string;
  available: string;
};

type Line = { include: boolean; quantity: string; unitPrice: string; note: string };

const CURRENCIES: Currency[] = ["GEL", "USD", "EUR"];
const NEW_SUPPLIER = "__new__";
const inputClass =
  "min-h-10 w-full rounded-md border border-steel bg-white px-3 text-base text-navy aria-invalid:border-red-700";

export function OrderForm({
  requestId,
  items,
  suppliers,
  today,
}: {
  requestId: string;
  items: DraftItem[];
  suppliers: { id: string; name: string }[];
  today: string;
}) {
  const [state, action, pending] = useActionState(createOrderAction, initialActionState);
  const uid = useId();
  const [supplier, setSupplier] = useState(suppliers[0]?.id ?? NEW_SUPPLIER);
  const [supplierName, setSupplierName] = useState("");
  const [supplierTaxId, setSupplierTaxId] = useState("");
  const [currency, setCurrency] = useState<Currency>("GEL");
  const [plannedDeliveryDate, setPlannedDeliveryDate] = useState("");
  // Prefill each line with what is still available to order.
  const [lines, setLines] = useState<Line[]>(() =>
    items.map((it) => ({
      include: it.available !== "0",
      // Decimal comma, as users type it; the server accepts both.
      quantity: it.available !== "0" ? it.available.replace(".", ",") : "",
      unitPrice: "",
      note: "",
    })),
  );

  // Only included lines are sent; map sent index → item index for error messages.
  const { payload, sentToItem } = useMemo(() => {
    const sent: { requestItemId: string; quantity: string; unitPrice: string; note: string }[] = [];
    const map: number[] = [];
    lines.forEach((l, i) => {
      if (!l.include) return;
      sent.push({
        requestItemId: items[i]!.id,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        note: l.note,
      });
      map.push(i);
    });
    return {
      payload: JSON.stringify({
        requestId,
        supplierId: supplier === NEW_SUPPLIER ? "" : supplier,
        supplierName: supplier === NEW_SUPPLIER ? supplierName : "",
        supplierTaxId: supplier === NEW_SUPPLIER ? supplierTaxId : "",
        currency,
        plannedDeliveryDate,
        items: sent,
      }),
      sentToItem: map,
    };
  }, [
    lines,
    items,
    requestId,
    supplier,
    supplierName,
    supplierTaxId,
    currency,
    plannedDeliveryDate,
  ]);

  const lineErrors = useMemo(() => {
    const out: Record<number, Partial<Record<keyof Line, string>>> = {};
    for (const [key, msg] of Object.entries(state.fieldErrors ?? {})) {
      const m = /^items\.(\d+)\.(\w+)$/.exec(key);
      if (!m) continue;
      const idx = sentToItem[Number(m[1])];
      if (idx === undefined) continue;
      (out[idx] ??= {})[m[2] as keyof Line] = msg;
    }
    return out;
    // Errors refer to the payload of the last submit; recompute only when they change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.fieldErrors]);

  const update = (i: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const fe = state.fieldErrors ?? {};

  // Preview of the order total; the server computes the stored amounts exactly.
  const total = useMemo(() => {
    let sum = 0;
    for (const l of lines) {
      if (!l.include) continue;
      const q = normalizeQuantity(l.quantity);
      const p = normalizePrice(l.unitPrice);
      if (q === null || p === null) return null;
      sum += Number(q) * Number(p);
    }
    return sum;
  }, [lines]);

  return (
    <form action={action} className="flex flex-col gap-6">
      <input type="hidden" name="payload" value={payload} />

      <section className="grid grid-cols-1 gap-4 rounded-lg border border-line bg-white p-4 sm:grid-cols-2 sm:p-6">
        <div className="flex flex-col gap-1">
          <label htmlFor={`${uid}-supplier`} className="text-sm font-medium">
            მომწოდებელი
          </label>
          <select
            id={`${uid}-supplier`}
            value={supplier}
            onChange={(e) => setSupplier(e.target.value)}
            aria-invalid={fe.supplier ? true : undefined}
            aria-describedby={fe.supplier ? `${uid}-supplier-err` : undefined}
            className={inputClass}
          >
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
            <option value={NEW_SUPPLIER}>+ ახალი მომწოდებელი</option>
          </select>
          {fe.supplier && supplier !== NEW_SUPPLIER && (
            <p id={`${uid}-supplier-err`} className="text-sm text-red-800">
              {fe.supplier}
            </p>
          )}
        </div>
        {supplier === NEW_SUPPLIER && (
          <div className="flex flex-col gap-1">
            <label htmlFor={`${uid}-supplier-name`} className="text-sm font-medium">
              ახალი მომწოდებლის სახელი
            </label>
            <input
              id={`${uid}-supplier-name`}
              value={supplierName}
              onChange={(e) => setSupplierName(e.target.value)}
              maxLength={200}
              required
              aria-invalid={fe.supplier || fe.supplierName ? true : undefined}
              aria-describedby={
                fe.supplier || fe.supplierName ? `${uid}-supplier-name-err` : undefined
              }
              className={inputClass}
            />
            {(fe.supplier || fe.supplierName) && (
              <p id={`${uid}-supplier-name-err`} className="text-sm text-red-800">
                {fe.supplier ?? fe.supplierName}
              </p>
            )}
          </div>
        )}
        {supplier === NEW_SUPPLIER && (
          <div className="flex flex-col gap-1">
            <label htmlFor={`${uid}-supplier-tax`} className="text-sm font-medium">
              საიდენტიფიკაციო კოდი (არასავალდებულო)
            </label>
            <input
              id={`${uid}-supplier-tax`}
              inputMode="numeric"
              maxLength={11}
              value={supplierTaxId}
              onChange={(e) => setSupplierTaxId(e.target.value)}
              aria-invalid={fe.supplierTaxId ? true : undefined}
              aria-describedby={fe.supplierTaxId ? `${uid}-supplier-tax-err` : undefined}
              className={inputClass}
            />
            {fe.supplierTaxId && (
              <p id={`${uid}-supplier-tax-err`} className="text-sm text-red-800">
                {fe.supplierTaxId}
              </p>
            )}
          </div>
        )}
        <div className="flex flex-col gap-1">
          <label htmlFor={`${uid}-currency`} className="text-sm font-medium">
            ვალუტა
          </label>
          <select
            id={`${uid}-currency`}
            value={currency}
            onChange={(e) => setCurrency(e.target.value as Currency)}
            className={inputClass}
          >
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {currencyLabel[c]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${uid}-date`} className="text-sm font-medium">
            დაგეგმილი მიწოდების თარიღი
          </label>
          <input
            id={`${uid}-date`}
            type="date"
            min={today}
            value={plannedDeliveryDate}
            onChange={(e) => setPlannedDeliveryDate(e.target.value)}
            aria-invalid={fe.plannedDeliveryDate ? true : undefined}
            aria-describedby={fe.plannedDeliveryDate ? `${uid}-date-err` : undefined}
            className={inputClass}
          />
          {fe.plannedDeliveryDate && (
            <p id={`${uid}-date-err`} className="text-sm text-red-800">
              {fe.plannedDeliveryDate}
            </p>
          )}
        </div>
      </section>

      <section className="rounded-lg border border-line bg-white p-4 sm:p-6">
        <h2 className="mb-1 text-lg font-semibold">პოზიციები</h2>
        <p className="mb-4 text-sm text-steel-600">
          მონიშნეთ ამ მომწოდებლისგან შესაკვეთი პოზიციები. დარჩენილი რაოდენობა შეგიძლიათ სხვა
          შეკვეთით გააფორმოთ. ფასი ერთეულზეა, {currencyLabel[currency]}.
        </p>
        <ol className="flex flex-col gap-4">
          {items.map((it, i) => {
            const l = lines[i]!;
            const err = lineErrors[i] ?? {};
            const id = (f: string) => `${uid}-${it.id}-${f}`;
            const none = it.available === "0";
            return (
              <li key={it.id} className="rounded-md border border-line p-3">
                <div className="flex flex-wrap items-start gap-3">
                  <input
                    id={id("include")}
                    type="checkbox"
                    checked={l.include}
                    disabled={none}
                    onChange={(e) => update(i, { include: e.target.checked })}
                    className="mt-1 h-5 w-5 accent-navy"
                  />
                  <label htmlFor={id("include")} className="min-w-0 flex-1 text-sm">
                    <span className="font-semibold">
                      {it.position}. {it.name}
                    </span>
                    {it.spec && <span className="text-steel-600"> · {it.spec}</span>}
                    <span className="block text-xs text-steel-600">
                      დამტკიცებული {formatQuantity(it.approved)} {it.unit} · შეკვეთილი{" "}
                      {formatQuantity(it.ordered)} · დარჩენილი {formatQuantity(it.available)}
                    </span>
                  </label>
                </div>
                {l.include && (
                  <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-[0.8fr_0.8fr_1.6fr]">
                    <div className="flex flex-col gap-1">
                      <label htmlFor={id("q")} className="text-xs font-medium text-steel-600">
                        რაოდენობა ({it.unit})
                      </label>
                      <input
                        id={id("q")}
                        inputMode="decimal"
                        maxLength={16}
                        value={l.quantity}
                        onChange={(e) => update(i, { quantity: e.target.value })}
                        aria-invalid={err.quantity ? true : undefined}
                        aria-describedby={err.quantity ? id("q-err") : undefined}
                        className={inputClass}
                      />
                      {err.quantity && (
                        <p id={id("q-err")} className="text-sm text-red-800">
                          {err.quantity}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-col gap-1">
                      <label htmlFor={id("p")} className="text-xs font-medium text-steel-600">
                        ერთეულის ფასი
                      </label>
                      <input
                        id={id("p")}
                        inputMode="decimal"
                        maxLength={16}
                        value={l.unitPrice}
                        onChange={(e) => update(i, { unitPrice: e.target.value })}
                        aria-invalid={err.unitPrice ? true : undefined}
                        aria-describedby={err.unitPrice ? id("p-err") : undefined}
                        className={inputClass}
                      />
                      {err.unitPrice && (
                        <p id={id("p-err")} className="text-sm text-red-800">
                          {err.unitPrice}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-col gap-1">
                      <label htmlFor={id("n")} className="text-xs font-medium text-steel-600">
                        შენიშვნა
                      </label>
                      <input
                        id={id("n")}
                        maxLength={500}
                        value={l.note}
                        onChange={(e) => update(i, { note: e.target.value })}
                        className={inputClass}
                      />
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      </section>

      <p className="text-base" aria-live="polite">
        ჯამი:{" "}
        <span className="font-semibold">
          {total === null ? "შეავსეთ რაოდენობა და ფასი" : formatMoney(total.toFixed(2), currency)}
        </span>
      </p>
      <FormMessage ok={state.ok} message={state.message} />
      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={pending}>
          შეკვეთის გაფორმება
        </Button>
      </div>
    </form>
  );
}
