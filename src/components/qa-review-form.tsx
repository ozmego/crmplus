"use client";

import { useActionState, useState } from "react";
import { reviewAction } from "@/app/(app)/qa/actions";

type R = "MET" | "NOT_MET" | "NA";
const LABEL: Record<R, string> = { MET: "Karşılandı", NOT_MET: "Karşılanmadı", NA: "Uygulanmaz" };

/** Kriter başına üç seçenek + not; toplam puan hesaplanmaz ve gösterilmez. */
export function QaReviewForm({ id, criteria }: { id: string; criteria: { key: string; label: string; description: string }[] }) {
  const [state, act, pending] = useActionState(reviewAction, undefined);
  const [values, setValues] = useState<Record<string, R>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [coaching, setCoaching] = useState("");
  return (
    <form action={act} className="flex flex-col gap-4">
      <input type="hidden" name="id" value={id} />
      {criteria.map((c) => (
        <fieldset key={c.key} className="rounded-md border border-line bg-white p-3">
          <legend className="px-1 text-sm font-semibold">{c.label}</legend>
          <p className="text-xs text-muted">{c.description}</p>
          <div className="mt-2 flex flex-wrap gap-4 text-sm">
            {(Object.keys(LABEL) as R[]).map((r) => (
              <label key={r} className="flex items-center gap-1">
                <input type="radio" name={`r:${c.key}`} value={r} checked={values[c.key] === r} onChange={() => setValues((v) => ({ ...v, [c.key]: r }))} />
                {LABEL[r]}
              </label>
            ))}
          </div>
          {values[c.key] === "NOT_MET" && (
            <input
              aria-label={`${c.label} açıklama`}
              name={`n:${c.key}`}
              value={notes[c.key] ?? ""}
              onChange={(e) => setNotes((n) => ({ ...n, [c.key]: e.target.value }))}
              placeholder="Kısa açıklama (zorunlu)"
              className="input mt-2 min-h-9"
            />
          )}
        </fieldset>
      ))}
      <div>
        <label htmlFor="coaching" className="label">Koçluk notu</label>
        <textarea id="coaching" name="coachingNote" rows={4} value={coaching} onChange={(e) => setCoaching(e.target.value)} className="input py-2" placeholder="Güçlü yönler ve bir sonraki görüşme için somut öneri" />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn-primary min-h-10" disabled={pending}>İncelemeyi kaydet</button>
        {state?.error && <p role="alert" className="text-sm font-semibold text-critical">{state.error}</p>}
        {state?.ok && <p role="status" className="text-sm text-teal-ink">{state.ok}</p>}
      </div>
    </form>
  );
}
