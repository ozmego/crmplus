import Link from "next/link";
import { redirect } from "next/navigation";
import { Lock } from "lucide-react";
import { requireUser } from "@/server/auth/rbac";
import { logAccess } from "@/server/audit";
import { canPlayerReports, casinoReport } from "@/server/services/analytics";
import { RangeForm, ReportHeader, money, moneyList, readRange } from "@/components/report-ui";

export const dynamic = "force-dynamic";

export default async function CasinoReport({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const user = await requireUser();
  if (!canPlayerReports(user)) {
    await logAccess({ actorId: user.id, action: "denied", resource: "page:report.casinos" });
    redirect("/forbidden");
  }
  const { from, to } = readRange(await searchParams, 365);
  const r = await casinoReport(user, { from, to });

  return (
    <div className="flex flex-col gap-6">
      <ReportHeader title="Casino performans raporu" sub={`Trip başlangıcı ${from} – ${to} · finans kolonları yalnız finans yetkisiyle (erişim kaydına yazılır)`} />
      <RangeForm from={from} to={to} />

      <section className="card bg-white">
        <h2 className="card-title">Trip ve oyuncu</h2>
        <div className="overflow-x-auto">
          <table className="table-ink min-w-[640px]">
            <thead><tr><th scope="col">Casino</th><th scope="col">Ülke</th><th scope="col">Trip</th><th scope="col">Gönderim</th><th scope="col">Tekil oyuncu</th></tr></thead>
            <tbody className="tabular-nums">
              {r.rows.length === 0 && <tr><td colSpan={5} className="text-muted">Casino yok.</td></tr>}
              {r.rows.map((c) => (
                <tr key={c.casinoId}><td><Link href={`/locations/${c.casinoId}`} className="font-medium hover:underline">{c.casino}</Link></td><td>{c.country ?? "—"}</td><td>{c.trips}</td><td>{c.sends}</td><td>{c.players}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {r.finance ? (
        <section className="flex flex-col gap-4 rounded-2xl border-l-4 border-warn bg-warn-bg/60 p-5">
          <h2 className="flex items-center gap-2 font-display text-2xl font-semibold text-ink"><Lock className="h-5 w-5 text-warn-ink" aria-hidden /> Finans</h2>
          <p className="text-xs text-warn-ink">Oyun tarihi {from} – {to}. Komisyon: onaylı/mutabık hesaplar (dönem ayına göre). Kayıp/kazanç hedefleme veya segment için kullanılmaz.</p>
          <div className="overflow-x-auto rounded-xl border border-line bg-white">
            <table className="table-ink min-w-[760px]">
              <thead><tr><th scope="col">Casino</th><th scope="col">Net kayıp (+) / kazanç (−)</th><th scope="col">Rolling</th><th scope="col">Sonuç kaydı</th><th scope="col">Onaylı komisyon</th></tr></thead>
              <tbody className="tabular-nums">
                {r.finance.byCasino.map((c) => (
                  <tr key={c.casinoId}><td>{c.casino}</td><td>{moneyList(c.netLoss)}</td><td>{moneyList(c.rolling)}</td><td>{c.results}</td><td>{moneyList(c.commission)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          {r.finance.byMonth.length > 0 && (
            <div className="overflow-x-auto rounded-xl border border-line bg-white">
              <table className="table-ink min-w-[520px]">
                <thead><tr><th scope="col">Ay</th><th scope="col">Casino</th><th scope="col">Net kayıp (+) / kazanç (−)</th></tr></thead>
                <tbody className="tabular-nums">
                  {r.finance.byMonth.map((m) => <tr key={`${m.month}-${m.casino}-${m.currency}`}><td>{m.month}</td><td>{m.casino}</td><td>{money(m.netLoss)} {m.currency}</td></tr>)}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : (
        <p className="callout-info flex items-center gap-2"><Lock className="h-4 w-4" aria-hidden /> Kayıp/kazanç, rolling ve komisyon kolonları yalnız finans yetkisiyle görünür.</p>
      )}
    </div>
  );
}
