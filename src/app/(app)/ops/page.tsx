import Link from "next/link";
import { requirePage } from "@/server/auth/rbac";
import { opsPanel } from "@/server/services/reports";
import { hm, pct } from "@/lib/kpi";

export const dynamic = "force-dynamic";

const KIND: Record<string, string> = {
  POSSIBLE_DUPLICATE: "olası mükerrer", MULTI_MATCH: "çoklu eşleşme", FIELD_CONFLICT: "alan çakışması", CONSENT_CONFLICT: "izin çakışması", DISPUTED_PHONE: "tartışmalı numara",
};

function Card({ label, value, sub, href, tone }: { label: string; value: string | number; sub?: string; href?: string; tone?: "warn" | "critical" }) {
  const border = tone === "warn" ? "border-warn" : tone === "critical" ? "border-critical/60" : "border-line";
  const body = (
    <>
      <p className="text-[11px] font-bold uppercase tracking-wider text-muted">{label}</p>
      <p className="stat-value">{typeof value === "number" ? value.toLocaleString("tr-TR") : value}</p>
      {sub && <p className="text-xs text-muted">{sub}</p>}
    </>
  );
  return href ? (
    <Link href={href} className={`rounded-lg border ${border} bg-card p-4 hover:bg-white`}>{body}</Link>
  ) : (
    <div className={`rounded-lg border ${border} bg-card p-4`}>{body}</div>
  );
}

export default async function OpsPage() {
  await requirePage("report.product");
  const { cards, teams, product } = await opsPanel();
  const reviewTotal = Object.values(cards.review).reduce((a, b) => a + b, 0);
  const reflection = (s: number | null) => (s === null ? "—" : s < 60 ? `${Math.round(s)} sn` : s < 3600 ? `${Math.round(s / 60)} dk` : `${(s / 3600).toFixed(1).replace(".", ",")} sa`);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="eyebrow">OPERASYON</p>
        <h1 className="page-title">Operasyon paneli</h1>
        <p className="mt-1 text-sm text-muted">Bugün · tüm ekipler · İstanbul saati. Formüller: docs/05. · <Link href="/ops/live" className="font-semibold text-teal-ink underline">Canlı kanal panosu</Link> · <Link href="/ops/capacity" className="font-semibold text-teal-ink underline">Kapasite planı</Link></p>
      </div>

      <section aria-label="Bekleyen işler" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <Card label="Bugün bekleyen arama" value={cards.pendingToday} sub={`${cards.openTasksToday} görev · ${cards.callbacksToday} geri arama`} />
        <Card label="Geciken geri arama" value={cards.lateCallbacks + cards.missedCallbacks} sub={`${cards.lateCallbacks} geç · ${cards.missedCallbacks} kaçırıldı (> 24 sa)`} tone={cards.lateCallbacks + cards.missedCallbacks ? "warn" : undefined} />
        <Card label="İzin durumu eksik" value={cards.consentUnknown} sub={`${cards.guestsActive.toLocaleString("tr-TR")} aktif misafirden · kuyruğa giremez`} href="/guests?consent=UNKNOWN" />
        <Card label="İçe aktarma hata kuyruğu" value={cards.importIssues.length} sub="son 30 gün, hatalı satırlı dosya" href="/imports" />
        <Card label="İnceleme kuyruğu" value={reviewTotal} sub={Object.entries(cards.review).map(([k, v]) => `${v} ${KIND[k] ?? k}`).join(" · ") || "boş"} href="/review" tone={reviewTotal ? "warn" : undefined} />
        <Card label="Erişim uyarıları" value={cards.alertsOpen} sub={`son 24 saatte ${cards.denied24h} yetkisiz deneme`} href="/admin/audit?tab=access&action=denied" tone={cards.denied24h ? "critical" : undefined} />
        <Card label="Transkript sorunları" value={cards.speech.transcriptFailed + cards.speech.recordingFailed + cards.speech.transcriptLow} sub={`son 30 gün · ${cards.speech.transcriptFailed} başarısız · ${cards.speech.recordingFailed} kayıt alınamadı · ${cards.speech.transcriptLow} düşük güven`} href="/calls?f=low" tone={cards.speech.transcriptFailed + cards.speech.recordingFailed ? "warn" : undefined} />
        <Card label="İnsan incelemesi bekleyen" value={cards.speech.analysisPending} sub={`${cards.speech.analysisMismatch} sonuç/özet uyuşmazlığı`} href="/calls?f=pending" tone={cards.speech.analysisMismatch ? "warn" : undefined} />
      </section>

      <section className="card bg-white">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="card-title">Ekip kapasitesi ve kalite · bugün</h2>
          <span className="text-xs text-muted">Hacim, kalite göstergeleriyle birlikte okunur; tek metriğe göre sıralama yok.</span>
        </div>
        <div className="overflow-x-auto">
          <table className="table-ink min-w-[860px]">
            <thead>
              <tr>
                <th scope="col">Ekip</th>
                <th scope="col">Aktif personel</th>
                <th scope="col">Vardiyada (plan / şu an)</th>
                <th scope="col">Açık görev / kişi</th>
                <th scope="col">Arama</th>
                <th scope="col">Konuşma</th>
                <th scope="col">Ulaşma</th>
                <th scope="col">Ret</th>
                <th scope="col">Eksik kayıt</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {teams.length === 0 && <tr><td colSpan={9} className="py-4 text-center text-muted">Ekip tanımlı değil.</td></tr>}
              {teams.map((t) => (
                <tr key={t.name}>
                  <th scope="row" className="px-3 py-2 text-left font-semibold">{t.name}</th>
                  <td>{t.activeAgents}</td>
                  <td className="tabular-nums">{t.plannedToday} / {t.onShiftNow}</td>
                  <td>{t.tasksPerAgent === null ? "—" : t.tasksPerAgent.toFixed(1).replace(".", ",")}</td>
                  <td>{t.callsToday}</td>
                  <td>{hm(t.talkSecToday)}</td>
                  <td>{pct(t.reachRate)}</td>
                  <td className={t.rejectRate !== null && t.rejectRate > 0.05 ? "text-critical" : ""}>{pct(t.rejectRate, 1)}</td>
                  <td className={t.missingRate !== null && t.missingRate > 0.02 ? "text-critical" : ""}>{pct(t.missingRate, 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-lg border border-line bg-card p-4">
        <h2 className="card-title">Ürün metrikleri · son 30 gün</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Metric label="Hatalı/eşleşmemiş satır" value={pct(product.badRowRate, 1)} target="hedef < %5" ok={product.badRowRate === null || product.badRowRate < 0.05} />
          <Metric label="Dosya içi mükerrer oranı" value={pct(product.dupRate, 1)} target="hedef < %2" ok={product.dupRate === null || product.dupRate < 0.02} />
          <Metric label="Sonuç kaydı eksiksizliği" value={pct(product.completeness, 1)} target="hedef > %98" ok={product.completeness === null || product.completeness > 0.98} />
          <Metric label="Geri arama zamanında" value={pct(product.callbackOnTime)} target="hedef > %85" ok={product.callbackOnTime === null || product.callbackOnTime > 0.85} />
          <Metric label="Durdurma yansıma süresi" value={`medyan ${reflection(product.reflection.median)} · P95 ${reflection(product.reflection.p95)}`} target="medyan < 1 dk, P95 < 24 sa" ok={(product.reflection.median ?? 0) < 60 && (product.reflection.p95 ?? 0) < 86400} />
          <Metric label="Yetkisiz dışa aktarma girişimi" value={String(product.exportDenied30)} target="hedef 0" ok={product.exportDenied30 === 0} />
        </div>
      </section>
    </div>
  );
}

function Metric({ label, value, target, ok }: { label: string; value: string; target: string; ok: boolean }) {
  return (
    <div>
      <p className="text-sm text-muted">{label}</p>
      <p className="text-xl font-bold tabular-nums text-ink">{value}</p>
      <p className={"text-xs " + (ok ? "text-teal-ink" : "text-warn-ink")}>{target}</p>
    </div>
  );
}
