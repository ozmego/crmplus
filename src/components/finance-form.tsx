"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import type { FormState } from "@/app/(app)/finance/actions";

export type Field =
  | { name: string; label: string; type?: "text" | "date" | "number"; required?: boolean; placeholder?: string; defaultValue?: string; hidden?: false }
  | { name: string; type: "hidden"; value: string }
  | { name: string; label: string; type: "select"; options: { value: string; label: string }[]; required?: boolean; defaultValue?: string }
  | { name: string; label: string; type: "textarea"; required?: boolean; placeholder?: string; defaultValue?: string; rows?: number };

/** Finans ekranlarında ortak form: sunucu eylemi + alan listesi, hata/başarı mesajı. */
export function FinanceForm({
  action,
  fields,
  submit,
  tone = "primary",
  inline,
}: {
  action: (s: FormState, fd: FormData) => Promise<FormState>;
  fields: Field[];
  submit: string;
  tone?: "primary" | "danger" | "secondary";
  inline?: boolean;
}) {
  const [state, act, pending] = useActionState(action, undefined);
  const [key] = useState(() => Math.random().toString(36).slice(2, 8));
  const [, startTransition] = useTransition();
  const ref = useRef<HTMLFormElement>(null);
  // Hata durumunda girilen değerler korunur (React'in otomatik form sıfırlaması yerine), başarıda temizlenir.
  useEffect(() => {
    if (state?.ok) ref.current?.reset();
  }, [state]);
  return (
    <form
      ref={ref}
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        startTransition(() => act(fd));
      }}
      className={inline ? "flex flex-wrap items-end gap-2" : "flex flex-col gap-3"}>
      <div className={inline ? "contents" : "grid gap-3 md:grid-cols-2 lg:grid-cols-4"}>
        {fields.map((fl) => {
          if (fl.type === "hidden") return <input key={fl.name} type="hidden" name={fl.name} value={fl.value} />;
          const id = `${key}-${fl.name}`;
          return (
            <div key={fl.name} className={fl.type === "textarea" ? "md:col-span-2 lg:col-span-4" : ""}>
              <label htmlFor={id} className="label">{fl.label}</label>
              {fl.type === "select" ? (
                <select id={id} name={fl.name} required={fl.required} defaultValue={fl.defaultValue ?? ""} className="input min-h-10">
                  <option value="" disabled>Seçin…</option>
                  {fl.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              ) : fl.type === "textarea" ? (
                <textarea id={id} name={fl.name} required={fl.required} placeholder={fl.placeholder} defaultValue={fl.defaultValue} rows={fl.rows ?? 4} className="input py-2 font-mono text-xs" />
              ) : (
                <input
                  id={id}
                  name={fl.name}
                  type={fl.type === "number" ? "text" : fl.type ?? "text"}
                  inputMode={fl.type === "number" ? "decimal" : undefined}
                  required={fl.required}
                  placeholder={fl.placeholder}
                  defaultValue={fl.defaultValue}
                  className="input min-h-10"
                />
              )}
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button className={(tone === "danger" ? "btn-danger" : tone === "secondary" ? "btn-secondary" : "btn-primary") + " min-h-10"} disabled={pending}>
          {submit}
        </button>
        {state?.error && <p role="alert" className="text-sm font-semibold text-critical">{state.error}</p>}
        {state?.ok && <p role="status" className="text-sm text-teal-ink">{state.ok}</p>}
      </div>
    </form>
  );
}
