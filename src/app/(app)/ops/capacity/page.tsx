import Link from "next/link";
import { requirePage } from "@/server/auth/rbac";
import { capacityPlan } from "@/server/services/ops-live";
import { addDays, istDate, weekStartOf } from "@/lib/hr/time";

export const dynamic = "force-dynamic";

const DOW = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];

export default async function CapacityPage({ searchParams }: { searchParams: Promise<{ week?: string; occ?: string; weeks?: string }> }) {
  await requirePage("report.product");
  const sp = await searchParams;
  const week = weekStartOf(/^\d{4}-\d{2}-\d{2}$/.test(sp.week ?? "") ? sp.week! : addDays(istDate(new Date()), 7));
  const occupancy = Math.min(0.95, Math.max(0.5, Number(sp.occ ?? 0.8) || 0.8));
  const weeks = Math.min(12, Math.max(1, Number(sp.weeks ?? 4) || 4));
  const p = await capacityPlan(week, { weeks, occupancy });
  const hours = Array.from({ length: 15 }, (_, i) => i + 8); // 08–22
  const cell = (d: number, h: number) => p.grid.find((c) => c.dow === d && c.hour === h)!;
  const short = p.grid.filter((c) => c.gap < 0);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="eyebrow">OPERASYON · KAPASİTE PLANI</p>
        <h1 className="page-title">Hafta {week}</h1>
        <p className="mt-1 text-sm text-muted">
          Son {p.weeks} haftanın {p.sampleCalls} çağrı denemesi ve ortalama işlem süresi ({Math.round(p.ahtSec / 6) / 10} dk: çalma + konuşma + çağrı sonrası) ile saatlik gereken temsilci,
          hedef doluluk %{Math.round(p.occupancy * 100)}. Plan: yayınlanmış çizelgedeki çağrı merkezi vardiyaları. Öneri niteliğindedir; çizelgeyi lider düzenler.{" "}
          <Link href="/hr/roster" className="text-teal-ink underline">Vardiya çizelgesi</Link> · <Link href="/ops/live" className="text-teal-ink underline">Canlı pano</Link>
        </p>
      </div>
      <form className="flex flex-wrap items-end gap-2 text-sm">
        <div><label htmlFor="week" className="label">Hafta (herhangi bir gün)</label><input id="week" type="date" name="week" defaultValue={week} className="input min-h-9" /></div>
        <div><label htmlFor="weeks" className="label">Geçmiş (hafta)</label><input id="weeks" name="weeks" defaultValue={weeks} inputMode="numeric" className="input min-h-9 w-20" /></div>
        <div><label htmlFor="occ" className="label">Hedef doluluk</label><input id="occ" name="occ" defaultValue={occupancy} inputMode="decimal" className="input min-h-9 w-20" /></div>
        <button className="btn-secondary min-h-9">Hesapla</button>
      </form>

      <section className="card bg-white">
        <div className="overflow-x-auto">
          <table className="text-xs tabular-nums" data-testid="capacity">
            <thead>
              <tr><th className="pr-2 text-left">Gün</th>{hours.map((h) => <th key={h} className="w-14 text-center">{h}:00</th>)}</tr>
            </thead>
            <tbody>
              {DOW.map((d, i) => (
                <tr key={d}>
                  <td className="pr-2 font-semibold">{d} {addDays(week, i).slice(8)}</td>
                  {hours.map((h) => {
                    const c = cell(i, h);
                    const tone = c.required === 0 && c.planned === 0 ? "" : c.gap < 0 ? "bg-critical-bg text-critical font-bold" : c.gap > 1 ? "bg-warn-bg" : "bg-info-bg";
                    return (
                      <td key={h} className={"border border-line text-center " + tone} title={`tahmini ${c.forecastCalls} deneme · gereken ${c.required} · planlanan ${c.planned}`}>
                        {c.required || c.planned ? `${c.planned}/${c.required}` : ""}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-muted">Hücre: planlanan / gereken. Kırmızı: eksik · turuncu: 2+ fazla · yeşilimsi: karşılanıyor.</p>
      </section>

      <section className="card">
        <h2 className="card-title">Eksik saatler ({short.length})</h2>
        <p className="text-sm" data-testid="capacity-short">
          {short.length ? short.slice(0, 30).map((c) => `${DOW[c.dow]} ${c.hour}:00 (−${-c.gap})`).join(" · ") : "Plan tahmini karşılıyor."}
        </p>
      </section>
    </div>
  );
}
