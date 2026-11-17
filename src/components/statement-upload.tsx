"use client";

import { useActionState } from "react";
import { uploadStatementAction } from "@/app/(app)/finance/actions";

/** Casino ekstresi yükleme (xlsx/csv). Dosya şifreli saklanır, SHA-256 özeti kaynak kanıtıdır. */
export function StatementUpload({ casinoId, period, casinos }: { casinoId?: string; period?: string; casinos?: { id: string; name: string }[] }) {
  const [state, act, pending] = useActionState(uploadStatementAction, undefined);
  return (
    <form action={act} className="flex flex-col gap-3 text-sm">
      {casinoId && <input type="hidden" name="casinoId" value={casinoId} />}
      {period && <input type="hidden" name="period" value={period} />}
      <div className="flex flex-wrap items-end gap-3">
        {casinos && (
          <>
            <div>
              <label htmlFor="stmt-casino" className="label">Casino</label>
              <select id="stmt-casino" name="casinoId" required defaultValue="" className="input min-h-10">
                <option value="" disabled>Seçin…</option>
                {casinos.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="stmt-period" className="label">Dönem</label>
              <input id="stmt-period" name="period" type="month" required className="input min-h-10" />
            </div>
          </>
        )}
        <div>
          <label htmlFor="stmt-file" className="label">Ekstre dosyası (xlsx, csv)</label>
          <input id="stmt-file" name="file" type="file" accept=".xlsx,.csv" required className="input min-h-10 py-1.5" />
        </div>
        <div>
          <label htmlFor="stmt-sign" className="label">Net tutar işareti</label>
          <select id="stmt-sign" name="invertSign" defaultValue="0" className="input min-h-10">
            <option value="0">Pozitif = misafir kaybı (kasa kazancı)</option>
            <option value="1">Pozitif = misafir kazancı (çevir)</option>
          </select>
        </div>
        <button className="btn-primary min-h-10" disabled={pending}>Yükle ve eşle</button>
      </div>
      <p className="text-xs text-muted">Tanınan sütunlar: CRM no veya casino oyuncu no, ad, tarih, net kayıp (ör. “Net Kayıp”, “House Win”), rolling. Eşleme bu casinonun dönem triplerindeki misafirlerle yapılır.</p>
      {state?.error && <p role="alert" className="font-semibold text-critical">{state.error}</p>}
      {state?.ok && <p role="status" className="text-teal-ink">{state.ok}</p>}
    </form>
  );
}
