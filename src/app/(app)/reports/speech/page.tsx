import Link from "next/link";
import { requirePage } from "@/server/auth/rbac";
import { speechReport } from "@/server/services/speech-report";
import { addDays, istDate } from "@/lib/hr/time";

export const dynamic = "force-dynamic";

const pct = (v: number | null) => (v === null ? "—" : `%${(v * 100).toLocaleString("tr-TR", { maximumFractionDigits: 1 })}`);
const hrs = (v: number | null) => (v === null ? "—" : `${v.toLocaleString("tr-TR", { maximumFractionDigits: 1 })} sa`);
const TOPIC: Record<string, string> = {};

function Metric({ label, value, formula, testId }: { label: string; value: string; formula: string; testId?: string }) {
  return (
    <div className="card">
      <p className="text-xs font-semibold uppercase tracking-wider text-teal-ink">{label}</p>
      <p className="stat-value" data-testid={testId}>{value}</p>
      <p className="mt-1 text-xs text-muted">{formula}</p>
    </div>
  );
}

/** Ses analizi raporları ve analiz doğruluk paneli (docs/05 §7a). Toplulaştırılmış; kişi bazlı içerik yok. */
export default async function SpeechReportPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  await requirePage("report.product");
  const sp = await searchParams;
  const today = istDate(new Date());
  const from = /^\d{4}-\d{2}-\d{2}$/.test(sp.from ?? "") ? sp.from! : addDays(today, -30);
  const to = /^\d{4}-\d{2}-\d{2}$/.test(sp.to ?? "") ? sp.to! : today;
  const r = await speechReport(new Date(`${from}T00:00:00+03:00`), new Date(`${to}T23:59:59.999+03:00`));

  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="eyebrow">RAPORLAR · SES ANALİZİ</p>
        <h1 className="page-title">Analiz doğruluk paneli</h1>
        <p className="mt-1 text-sm text-muted">Toplulaştırılmış göstergeler; kişi bazlı içerik ve temsilci sıralaması yoktur. Formüller docs/05 §7a ile aynıdır. <Link href="/reports" className="text-teal-ink underline">Rapor merkezi</Link></p>
      </div>
      <form className="flex flex-wrap items-end gap-2 text-sm">
        <div><label htmlFor="from" className="label">Başlangıç</label><input id="from" type="date" name="from" defaultValue={from} className="input min-h-9" /></div>
        <div><label htmlFor="to" className="label">Bitiş</label><input id="to" type="date" name="to" defaultValue={to} className="input min-h-9" /></div>
        <button className="btn-secondary min-h-9">Göster</button>
      </form>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Metric label="Transkript oranı" value={pct(r.transcriptRate)} formula={`Tamamlanan transkript / saklanan kayıt (${r.recordings.stored}). Atılan kayıtlar hariç.`} testId="m-transcript" />
        <Metric label="Düşük güven" value={pct(r.lowConfidenceRate)} formula={`Güven < 0,6 / tamamlanan · başarısız: ${r.transcriptFailed}`} />
        <Metric label="Etiket düzeltme oranı" value={pct(r.labelCorrectionRate)} formula={`Düzeltilen / incelenen öneri (${r.reviewed}) · itiraz ${pct(r.disputeRate)}`} />
        <Metric label="Sonuç/özet uyuşmazlığı" value={pct(r.mismatchRate)} formula={`Uyuşmazlık / analiz (${r.analyses})`} />
        <Metric label="İnceleme kuyruğu yaşı" value={hrs(r.queue.medianHours)} formula={`Medyan · P95 ${hrs(r.queue.p95Hours)} · bekleyen ${r.queue.pending}`} />
        <Metric label="Takip aksiyonu tamamlanma" value={pct(r.followUp.rate)} formula={`Onaylanan öneriden doğan geri aramalarda tamamlanan (${r.followUp.done}/${r.followUp.created})`} />
        <Metric label="Kelime hata oranı (WER)" value={pct(r.wer)} formula={`İnsan düzeltmesi yapılan ${r.editedSegments} bölütten (${r.editedTranscripts} transkript, toplam ${r.totalSegments} bölüt). Düzeltilmemiş bölütler hesaba katılmaz.`} testId="m-wer" />
        <Metric label="Kalite örneklemi" value={String(Object.values(r.qa).reduce((s, n) => s + n, 0))} formula={Object.entries(r.qa).map(([k, v]) => `${k} ${v}`).join(" · ") || "örneklem yok"} />
      </div>

      <section className="card bg-white">
        <h2 className="card-title">Konu dağılımı (onaylanan/düzeltilen öneriler)</h2>
        {r.topics.length === 0 ? <p className="text-sm text-muted">Veri yok.</p> : (
          <ul className="flex flex-col gap-1 text-sm">
            {r.topics.map(([t, n]) => {
              const max = r.topics[0][1];
              return (
                <li key={t} className="flex items-center gap-2">
                  <span className="w-48 shrink-0">{TOPIC[t] ?? t}</span>
                  <span className="h-3 rounded bg-teal" style={{ width: `${(n / max) * 60}%` }} aria-hidden />
                  <span className="tabular-nums">{n}</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="card">
        <h2 className="card-title">Kayıt akışı</h2>
        <p className="text-sm">Saklanan {r.recordings.stored} · alınamayan {r.recordings.failed} · atılan: {Object.entries(r.recordings.discarded).map(([k, v]) => `${k === "GATE_CLOSED" ? "karar kapısı kapalı" : k === "GUEST_DECLINED" ? "misafir istemedi" : k} ${v}`).join(", ") || "0"}</p>
      </section>
    </div>
  );
}
