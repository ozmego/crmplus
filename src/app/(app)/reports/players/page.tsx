import Link from "next/link";
import { redirect } from "next/navigation";
import { Gem, Plane, Repeat, UserPlus, Users } from "lucide-react";
import { can, requireUser } from "@/server/auth/rbac";
import { logAccess } from "@/server/audit";
import { db } from "@/server/db";
import { canPlayerReports, playersReport } from "@/server/services/analytics";
import { DailyBarChart } from "@/components/bar-chart";
import { RangeForm, ReportHeader, StatTile, readRange } from "@/components/report-ui";

export const dynamic = "force-dynamic";
const day = (d: Date) => d.toLocaleDateString("tr-TR", { timeZone: "Europe/Istanbul" });

export default async function PlayersReport({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; casino?: string; country?: string }> }) {
  const user = await requireUser();
  if (!canPlayerReports(user)) {
    await logAccess({ actorId: user.id, action: "denied", resource: "page:report.players" });
    redirect("/forbidden");
  }
  const sp = await searchParams;
  const { from, to } = readRange(sp, 180);
  const country = /^[A-Z]{2}$/.test(sp.country ?? "") ? sp.country : undefined;
  const casinos = await db.casino.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } });
  const casinoId = casinos.some((c) => c.id === sp.casino) ? sp.casino : undefined;
  const r = await playersReport(user, { from, to, casinoId, country });
  const exportable = can(user, "export.basic") || can(user, "export.bulk");
  const qs = new URLSearchParams({ from, to, ...(casinoId ? { casino: casinoId } : {}), ...(country ? { country } : {}) }).toString();

  return (
    <div className="flex flex-col gap-6">
      <ReportHeader title="Oyuncu ve trip raporu" sub={`Casinoya gönderilen oyuncular · trip başlangıcı ${from} – ${to} · iptal edilen tripler hariç`} />
      <RangeForm from={from} to={to}>
        <div>
          <label htmlFor="casino" className="label">Casino</label>
          <select id="casino" name="casino" defaultValue={casinoId ?? ""} className="input min-h-11">
            <option value="">Tümü</option>
            {casinos.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div><label htmlFor="country" className="label">Ülke (ISO)</label><input id="country" name="country" maxLength={2} defaultValue={country ?? ""} className="input w-24 uppercase" placeholder="TR" /></div>
      </RangeForm>

      <section aria-label="Özet" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatTile label="Oyuncu" value={r.kpi.players} sub="tekil" icon={Users} />
        <StatTile label="Gönderim" value={r.kpi.sends} sub="oyuncu × trip" icon={Plane} />
        <StatTile label="Trip" value={r.kpi.trips} icon={Gem} />
        <StatTile label="Yeni oyuncu" value={r.kpi.newPlayers} sub="ilk tripi bu dönemde" icon={UserPlus} />
        <StatTile label="Tekrar gelen" value={r.kpi.returning} icon={Repeat} />
      </section>

      <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <div className="card bg-white">
          <DailyBarChart title="Casinoya gönderilen oyuncu · aylık" unit="oyuncu" data={r.byMonth} format="month" />
        </div>
        <div className="card bg-white">
          <p className="mb-2 text-sm font-semibold text-ink">Ülkeye göre oyuncu</p>
          {r.byCountry.length === 0 ? <p className="text-sm text-muted">Veri yok.</p> : (
            <ul className="flex flex-col gap-1.5 text-sm">
              {r.byCountry.slice(0, 10).map((c) => (
                <li key={c.country} className="flex items-center gap-3">
                  <span className="w-10 font-semibold text-ink">{c.country}</span>
                  <span className="h-2 flex-1 overflow-hidden rounded-full bg-card" aria-hidden><span className="block h-full rounded-full bg-[#a07a1c]" style={{ width: `${(c.players / r.byCountry[0].players) * 100}%` }} /></span>
                  <span className="w-12 text-right tabular-nums">{c.players}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <section className="card bg-white">
        <h2 className="card-title">Casinoya göre</h2>
        <table className="table-ink">
          <thead><tr><th scope="col">Casino</th><th scope="col">Trip</th><th scope="col">Oyuncu</th></tr></thead>
          <tbody className="tabular-nums">
            {r.byCasino.length === 0 && <tr><td colSpan={3} className="text-muted">Bu dönemde trip yok.</td></tr>}
            {r.byCasino.map((c) => (
              <tr key={c.casinoId}><td><Link href={`/locations/${c.casinoId}`} className="hover:underline">{c.casino}</Link></td><td>{c.trips}</td><td>{c.players}</td></tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card bg-white">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="card-title">Oyuncular</h2>
          {exportable && r.players && (
            <form action="/api/reports/players" method="get" className="flex flex-wrap items-end gap-2">
              {Object.entries(Object.fromEntries(new URLSearchParams(qs))).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
              <div><label htmlFor="exp-reason" className="label">Dışa aktarma gerekçesi</label><input id="exp-reason" name="reason" required minLength={5} maxLength={300} className="input" placeholder="ör. aylık casino mutabakatı" /></div>
              <button className="btn-secondary">Excel olarak indir</button>
            </form>
          )}
        </div>
        {!r.players ? (
          <p className="text-sm text-muted">Oyuncu adları yalnız oyuncu görüntüleme yetkisiyle listelenir; bu raporda toplam sayılar gösteriliyor.</p>
        ) : r.players.length === 0 ? (
          <p className="text-sm text-muted">Kayıt yok.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table-ink min-w-[760px]">
              <thead><tr><th scope="col">Oyuncu</th><th scope="col">CRM</th><th scope="col">Ülke</th><th scope="col">Trip</th><th scope="col">Son trip</th><th scope="col">Casinolar</th><th scope="col">Durum</th></tr></thead>
              <tbody className="tabular-nums">
                {r.players.map((p) => (
                  <tr key={p.guestId}>
                    <td><Link href={`/guests/${p.guestId}?tab=casino`} className="font-medium hover:underline">{p.name}</Link></td>
                    <td>CRM-{String(p.crmNo).padStart(6, "0")}</td>
                    <td>{p.country ?? "—"}</td>
                    <td>{p.trips}</td>
                    <td>{day(p.lastTrip)}</td>
                    <td>{p.casinos.join(", ")}</td>
                    <td>{p.isNew ? <span className="pill border-teal-ink text-teal-ink">Yeni</span> : "Tekrar"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
