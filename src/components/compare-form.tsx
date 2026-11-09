"use client";

import { useActionState, useState } from "react";
import { runCompareAction } from "@/app/(app)/compare/actions";

const ERR: Record<string, string> = {
  SAME_BATCH: "Aynı dosyayı kendisiyle karşılaştıramazsınız.",
  BATCH_NOT_READY: "Seçilen dosyanın önizlemesi henüz oluşturulmamış.",
  FORBIDDEN: "Bu işlem için yetkiniz yok.",
  INVALID_INPUT: "İki dosyayı da seçin.",
};

export function CompareForm({ batches }: { batches: { id: string; label: string; applied: boolean }[] }) {
  const [state, action, pending] = useActionState(runCompareAction, undefined);
  const [mode, setMode] = useState<"FILE" | "CRM">("FILE");
  const leftOptions = mode === "CRM" ? batches.filter((b) => b.applied) : batches;
  return (
    <form action={action} className="card flex flex-col gap-4">
      <h2 className="card-title">Yeni karşılaştırma</h2>
      <fieldset className="flex flex-wrap gap-4 text-sm">
        <legend className="label">Taban (sol taraf)</legend>
        <label className="flex items-center gap-2">
          <input type="radio" name="mode" value="FILE" checked={mode === "FILE"} onChange={() => setMode("FILE")} /> Önceki dosya
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="mode" value="CRM" checked={mode === "CRM"} onChange={() => setMode("CRM")} /> CRM’deki güncel hali (önceki dosyanın misafirleri)
        </label>
      </fieldset>
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <label htmlFor="left" className="label">{mode === "FILE" ? "Önceki dosya" : "Hangi içe aktarmanın misafirleri"}</label>
          <select id="left" name="leftBatchId" required className="input" defaultValue="">
            <option value="" disabled>Seçin…</option>
            {leftOptions.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="right" className="label">Yeni dosya</label>
          <select id="right" name="rightBatchId" required className="input" defaultValue="">
            <option value="" disabled>Seçin…</option>
            {batches.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
          </select>
        </div>
      </div>
      <p className="text-xs text-muted">
        Dosyalar önce İçe aktarma ekranından yüklenip önizlenmelidir (amaç “Yalnız karşılaştır” seçilebilir). Karşılaştırma hiçbir kaydı değiştirmez.
      </p>
      {state?.error && <p role="alert" className="callout-critical">{ERR[state.error] ?? state.error}</p>}
      <button className="btn-primary self-start" disabled={pending}>{pending ? "Karşılaştırılıyor…" : "Karşılaştır"}</button>
    </form>
  );
}
