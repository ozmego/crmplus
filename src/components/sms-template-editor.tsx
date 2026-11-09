"use client";

import { useActionState, useState } from "react";
import type { FormState } from "@/app/(app)/finance/actions";
import { ALLOWED_VARS, checkTemplate, smsSegments, toGsmFriendly, withOptOut } from "@/lib/sms";

/** Şablon taslağı: canlı karakter/kodlama/parça sayacı ve kural kontrolü (docs/10 §4). */
export function SmsTemplateEditor({ action, optOut }: { action: (s: FormState, fd: FormData) => Promise<FormState>; optOut: string }) {
  const [state, act, pending] = useActionState(action, undefined);
  const [body, setBody] = useState("");
  const [category, setCategory] = useState<"MARKETING" | "INFORMATIONAL">("MARKETING");
  const full = withOptOut(body, category, optOut);
  const seg = smsSegments(full);
  const chk = checkTemplate(body, category);

  return (
    <form action={act} className="flex flex-col gap-3">
      <div className="grid gap-3 md:grid-cols-3">
        <div>
          <label htmlFor="tpl-name" className="label">Şablon adı</label>
          <input id="tpl-name" name="name" required className="input min-h-10" />
        </div>
        <div>
          <label htmlFor="tpl-cat" className="label">Kategori</label>
          <select id="tpl-cat" name="category" value={category} onChange={(e) => setCategory(e.target.value as "MARKETING")} className="input min-h-10">
            <option value="MARKETING">Pazarlama (ret metni eklenir)</option>
            <option value="INFORMATIONAL">Bilgilendirme</option>
          </select>
        </div>
      </div>
      <div>
        <label htmlFor="tpl-body" className="label">Metin</label>
        <textarea id="tpl-body" name="body" required rows={4} value={body} onChange={(e) => setBody(e.target.value)} className="input py-2" />
        <p className="mt-1 text-xs text-muted">
          Değişkenler: {ALLOWED_VARS.map((v) => `{${v}}`).join(" · ")} · finansal veya kimlik değişkeni kullanılamaz.
        </p>
      </div>
      <div className="rounded-md border border-line bg-white p-3 text-sm" aria-live="polite">
        <p data-testid="sms-counter">
          <b>{seg.length}</b> karakter · {seg.encoding === "GSM7" ? "GSM-7" : "Unicode (UCS-2)"} · <b>{seg.segments}</b> parça
          {seg.encoding === "UCS2" && (
            <button type="button" className="ml-3 text-xs font-semibold text-teal-ink underline" onClick={() => setBody(toGsmFriendly(body))}>
              Türkçe karakterleri dönüştür (daha az parça)
            </button>
          )}
        </p>
        {category === "MARKETING" && <p className="mt-1 text-xs text-muted">Sona eklenecek ret metni: “{optOut}”</p>}
        {chk.errors.map((e) => <p key={e} className="mt-1 font-semibold text-critical">{e}</p>)}
        {chk.warnings.map((w) => <p key={w} className="mt-1 text-warn-ink">⚠ {w}</p>)}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn-primary min-h-10" disabled={pending || chk.errors.length > 0}>Taslağı kaydet</button>
        {state?.error && <p role="alert" className="text-sm font-semibold text-critical">{state.error}</p>}
        {state?.ok && <p role="status" className="text-sm text-teal-ink">{state.ok}</p>}
      </div>
    </form>
  );
}
