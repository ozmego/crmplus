import { Headphones, PhoneCall, PhoneIncoming, Target, Timer } from "lucide-react";
import { requirePage } from "@/server/auth/rbac";
import { callsReport } from "@/server/services/analytics";
import { DailyBarChart } from "@/components/bar-chart";
import { RangeForm, ReportHeader, StatTile, readRange } from "@/components/report-ui";
import { hm, pct } from "@/lib/kpi";
import { todayIso } from "@/server/services/reports";

export const dynamic = "force-dynamic";

const STATUS: Record<string, string> = { QUEUED: "Kuyrukta", SENT: "Gönderildi", DELIVERED: "Teslim", READ: "Okundu", FAILED: "Başarısız", SKIPPED: "Hariç/atlandı" };
const CAMPAIGN: Record<string, string> = { DRAFT: "Taslak", PENDING_APPROVAL: "Onay bekliyor", APPROVED: "Onaylı", SENDING: "Gönderiliyor", DONE: "Tamamlandı", CANCELLED: "İptal" };

export default async function CallsReport({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  await requirePage("report.product");
  const { from, to } = readRange(await searchParams, 30);
  const r = await callsReport({ from, to });
  const maxDisp = Math.max(1, ...r.byDisposition.map((d) => d.count));

  return (
    <div className="flex flex-col gap-6">
      <ReportHeader title="Çağrı ve kampanya raporu" sub={`${from} – ${to} · İstanbul saati · tüm ekipler (kişi bazlı sıralama yok; personel raporu ayrı)`} />
      <RangeForm from={from} to={to} />

      <section aria-label="Özet" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatTile label="Arama" value={r.kpi.calls} icon={PhoneCall} />
        <StatTile label="Bağlanan" value={r.kpi.answered} icon={PhoneIncoming} />
        <StatTile label="Ulaşma oranı" value={pct(r.kpi.reachRate)} sub={`${r.kpi.reached} ulaşıldı`} icon={Target} />
        <StatTile label="Konuşma" value={hm(r.kpi.talkSec)} sub={r.kpi.avgTalkSec === null ? undefined : `ortalama ${Math.round(r.kpi.avgTalkSec)} sn`} icon={Timer} />
        <StatTile label="Sonuç kodu eksik" value={r.kpi.missingDisposition} icon={Headphones} />
      </section>

      <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <div className="card bg-white">
          <DailyBarChart title="Günlük arama" unit="arama" data={r.perDay} lastIsToday={to === todayIso()} />
        </div>
        <div className="card bg-white">
          <p className="mb-2 text-sm font-semibold text-ink">Sonuç kodlarına göre</p>
          {r.byDisposition.length === 0 ? <p className="text-sm text-muted">Bu dönemde sonuç kaydı yok.</p> : (
            <ul className="flex flex-col gap-1.5 text-sm">
              {r.byDisposition.map((d) => (
                <li key={d.code} className="flex items-center gap-3">
                  <span className="w-40 truncate text-ink" title={d.label}>{d.label}</span>
                  <span className="h-2 flex-1 overflow-hidden rounded-full bg-card" aria-hidden><span className="block h-full rounded-full bg-[#a07a1c]" style={{ width: `${(d.count / maxDisp) * 100}%` }} /></span>
                  <span className="w-12 text-right tabular-nums">{d.count}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <section className="card bg-white">
        <h2 className="card-title">Kampanyalar</h2>
        <div className="overflow-x-auto">
          <table className="table-ink min-w-[860px]">
            <thead><tr><th scope="col">Kampanya</th><th scope="col">Kanal</th><th scope="col">Durum</th><th scope="col">İleti</th>{Object.values(STATUS).map((s) => <th key={s} scope="col">{s}</th>)}<th scope="col">Teslim oranı</th></tr></thead>
            <tbody className="tabular-nums">
              {r.campaigns.length === 0 && <tr><td colSpan={11} className="text-muted">Bu dönemde kampanya yok.</td></tr>}
              {r.campaigns.map((c) => {
                const sent = (c.counts.SENT ?? 0) + (c.counts.DELIVERED ?? 0) + (c.counts.READ ?? 0) + (c.counts.FAILED ?? 0);
                return (
                  <tr key={c.id}>
                    <td className="font-medium">{c.name}</td><td>{c.channel}</td><td>{CAMPAIGN[c.status] ?? c.status}</td><td>{c.total}</td>
                    {Object.keys(STATUS).map((s) => <td key={s}>{c.counts[s] ?? 0}</td>)}
                    <td>{pct(sent ? ((c.counts.DELIVERED ?? 0) + (c.counts.READ ?? 0)) / sent : null)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
