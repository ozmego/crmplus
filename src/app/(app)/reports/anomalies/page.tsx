import Link from "next/link";
import { requirePage } from "@/server/auth/rbac";
import { opsAnomalies } from "@/server/services/finance-engine";

export const dynamic = "force-dynamic";

const KIND: Record<string, { label: string; why: string }> = {
  REACHED_ZERO_TALK: { label: "“Ulaşıldı” ama konuşma süresi 0", why: "Sonuç kodu veya “Bağlandı” adımı hatalı girilmiş olabilir (docs/03)." },
  AUTO_CLOSED: { label: "Otomatik kapanan çağrı", why: "Çağrı 4 saatten uzun açık kalmış; süre ve sonuç verisi eksik." },
  OUTSIDE_SHIFT: { label: "Yayınlanmış vardiya dışında çağrı", why: "Çizelge güncel değil veya plan dışı çalışma; puantajla birlikte incelenmeli." },
};

/** Operasyon anomali raporu (Aşama 3): ekip + gün bazında süreç ve veri kalitesi bulguları; kişi bazlı değil. */
export default async function AnomaliesPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  await requirePage("report.product");
  const { days } = await searchParams;
  const d = Math.min(60, Math.max(1, Number(days ?? 14) || 14));
  const findings = await opsAnomalies(d);
  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="eyebrow">RAPORLAR · ANOMALİ</p>
        <h1 className="page-title">Operasyon anomalileri · son {d} gün</h1>
        <p className="mt-1 text-sm text-muted">
          Ekip ve gün bazında; çağrıların en az %10’unda ve en az 3 kez görülen durumlar. Bulgular inceleme içindir — personel puanı, sıralama veya yaptırım için kullanılmaz.
          Finans bulguları her komisyon döneminin sayfasındadır. <Link href="/reports" className="text-teal-ink underline">Raporlar</Link>
        </p>
      </div>
      <form className="flex items-end gap-2 text-sm">
        <div><label htmlFor="days" className="label">Gün</label><input id="days" name="days" defaultValue={d} inputMode="numeric" className="input min-h-9 w-20" /></div>
        <button className="btn-secondary min-h-9">Göster</button>
      </form>
      <section className="card bg-white">
        <table className="table-ink" data-testid="ops-anomalies">
          <thead><tr><th>Gün</th><th>Ekip</th><th>Bulgu</th><th>Adet</th><th>Oran</th><th>Neden önemli</th></tr></thead>
          <tbody>
            {findings.map((f, i) => (
              <tr key={i}>
                <td>{f.day}</td>
                <td>{f.teamName}</td>
                <td>{KIND[f.kind].label}</td>
                <td className="tabular-nums">{f.count}</td>
                <td className="tabular-nums">%{Math.round(f.rate * 100)}</td>
                <td className="text-xs text-muted">{KIND[f.kind].why}</td>
              </tr>
            ))}
            {findings.length === 0 && <tr><td colSpan={6} className="text-muted">Bulgu yok.</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  );
}
