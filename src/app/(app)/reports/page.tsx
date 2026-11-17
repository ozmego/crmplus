import Link from "next/link";
import { can, requirePage, scopeOf } from "@/server/auth/rbac";
import { agentReport, todayIso } from "@/server/services/reports";
import { hm, mmss, pct } from "@/lib/kpi";

export const dynamic = "force-dynamic";

const SCOPE = { own: "Kendi performansınız", team: "Ekibiniz", all: "Tüm personel" } as const;

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const user = await requirePage("report.view");
  const sp = await searchParams;
  const today = todayIso();
  const from = /^\d{4}-\d{2}-\d{2}$/.test(sp.from ?? "") ? sp.from! : today;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(sp.to ?? "") ? sp.to! : today;
  const { rows, total } = await agentReport(user, from, to);
  const exportable = can(user, "export.basic") || can(user, "export.bulk");

  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="eyebrow">RAPORLAR</p>
        <h1 className="page-title">Personel ve ekip raporu</h1>
        <p className="mt-1 text-sm text-muted">{SCOPE[scopeOf(user, "report.view") ?? "own"]} · {from === to ? from : `${from} – ${to}`} · İstanbul saati{can(user, "report.product") && <> · <Link href="/reports/speech" className="font-semibold text-teal-ink underline">Ses analizi doğruluk paneli</Link> · <Link href="/reports/anomalies" className="font-semibold text-teal-ink underline">Operasyon anomalileri</Link></>}</p>
      </div>

      <form className="flex flex-wrap items-end gap-3">
        <div><label htmlFor="from" className="label">Başlangıç</label><input id="from" name="from" type="date" defaultValue={from} className="input" /></div>
        <div><label htmlFor="to" className="label">Bitiş</label><input id="to" name="to" type="date" defaultValue={to} className="input" /></div>
        <button className="btn-primary">Uygula</button>
      </form>
      {exportable && (
        <form action="/api/reports/agents" method="get" className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="from" value={from} />
          <input type="hidden" name="to" value={to} />
          <div className="min-w-72">
            <label htmlFor="exp-reason" className="label">Dışa aktarma gerekçesi (kayıt altına alınır)</label>
            <input id="exp-reason" name="reason" required minLength={5} maxLength={300} className="input" placeholder="ör. haftalık ekip toplantısı" />
          </div>
          <button className="btn-secondary">Excel olarak indir</button>
        </form>
      )}

      <p className="callout-info">
        Arama adedi ve konuşma süresi tek başına başarı ölçütü değildir; ulaşma, ret, eksik kayıt ve geri arama oranlarıyla birlikte okunur.
        Tablo isme göre sıralıdır.
      </p>

      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="table-ink min-w-[1200px]">
          <thead>
            <tr>
              <th scope="col">Personel</th>
              <th scope="col">Ekip</th>
              <th scope="col">Atanan / tamamlanan görev</th>
              <th scope="col">Arama denemesi</th>
              <th scope="col">Tekil numara</th>
              <th scope="col">Toplam konuşma</th>
              <th scope="col">Ort. konuşma</th>
              <th scope="col">Ulaşılan</th>
              <th scope="col">Ulaşılamayan</th>
              <th scope="col">Geri arama talebi</th>
              <th scope="col">Geri arama zamanında</th>
              <th scope="col">İletişim istemiyor</th>
              <th scope="col">Eksik sonuç / not</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {rows.length === 0 && <tr><td colSpan={13} className="py-6 text-center text-muted">Kapsamınızda çağrı yapan personel yok.</td></tr>}
            {rows.map((r) => (
              <tr key={r.userId}>
                <th scope="row" className="px-3 py-2 text-left font-semibold text-ink">{r.name}</th>
                <td>{r.team ?? "—"}</td>
                <td>{r.assignedTasks} / {r.doneTasks}</td>
                <td>{r.kpi.attempts}</td>
                <td>{r.kpi.uniqueNumbers}</td>
                <td>{hm(r.kpi.talkSecTotal)}</td>
                <td>{mmss(r.kpi.talkSecAvg)}</td>
                <td>{pct(r.kpi.reachRate)}</td>
                <td>{pct(r.kpi.unreachRate)}</td>
                <td>{r.kpi.callbackRequests}</td>
                <td>{pct(r.callbacks.onTimeRate)} <span className="text-xs text-muted">({r.callbacks.done}/{r.callbacks.total})</span></td>
                <td>{r.kpi.dncCount} <span className="text-xs text-muted">({pct(r.kpi.rejectRate, 1)})</span></td>
                <td className={(r.kpi.missingDispositionRate ?? 0) + (r.kpi.missingNoteRate ?? 0) > 0.02 ? "text-critical" : ""}>
                  {pct(r.kpi.missingDispositionRate, 1)} / {pct(r.kpi.missingNoteRate, 1)}
                </td>
              </tr>
            ))}
          </tbody>
          {rows.length > 1 && (
            <tfoot>
              <tr className="border-t-2 border-ink font-semibold tabular-nums">
                <th scope="row" className="px-3 py-2 text-left">Toplam</th>
                <td />
                <td className="px-3">{total.assignedTasks} / {total.doneTasks}</td>
                <td className="px-3">{total.kpi.attempts}</td>
                <td className="px-3">{total.kpi.uniqueNumbers}</td>
                <td className="px-3">{hm(total.kpi.talkSecTotal)}</td>
                <td className="px-3">{mmss(total.kpi.talkSecAvg)}</td>
                <td className="px-3">{pct(total.kpi.reachRate)}</td>
                <td className="px-3">{pct(total.kpi.unreachRate)}</td>
                <td className="px-3">{total.kpi.callbackRequests}</td>
                <td className="px-3">{pct(total.callbacks.onTimeRate)}</td>
                <td className="px-3">{total.kpi.dncCount}</td>
                <td className="px-3">{pct(total.kpi.missingDispositionRate, 1)} / {pct(total.kpi.missingNoteRate, 1)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <p className="text-xs text-muted">
        Tanımlar (docs/05): ulaşılan = “Ulaşıldı” kategorisindeki sonuçlar (yanlış kişi hariç) / tüm denemeler · ort. konuşma yalnız bağlanan çağrılar ·
        geri arama zamanında = planlanan ±15 dk içinde ilk deneme · otomatik kapatılan çağrılar süre metriklerine girmez.
      </p>
    </div>
  );
}
