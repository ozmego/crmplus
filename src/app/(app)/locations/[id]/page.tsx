import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CalendarClock, FileSpreadsheet, Gem, Landmark, Lock, MapPin, Users } from "lucide-react";
import { can, requireUser } from "@/server/auth/rbac";
import { logAccess } from "@/server/audit";
import { canSeeLocations, locationProfile } from "@/server/services/profiles";

export const dynamic = "force-dynamic";
const day = (d: Date | null) => (d ? d.toLocaleDateString("tr-TR", { timeZone: "Europe/Istanbul" }) : "—");
const money = (v: string) => Number(v).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const TRIP_STATUS: Record<string, string> = { PLANNED: "Planlı", DONE: "Tamamlandı", CANCELLED: "İptal" };
const PERIOD_STATUS: Record<string, string> = { OPEN: "Açık", LOCKED: "Kilitli", CLOSED: "Kapalı" };

export default async function LocationProfile({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!canSeeLocations(user)) {
    await logAccess({ actorId: user.id, action: "denied", resource: "page:locations", meta: { permission: "finance.view|report.product" } });
    redirect("/forbidden");
  }
  const { id } = await params;
  const p = await locationProfile(user, id);
  if (!p) notFound();
  const { casino, finance } = p;
  const upcoming = casino.trips.filter((t) => t.status === "PLANNED" && t.startDate >= new Date()).length;

  return (
    <div className="flex flex-col gap-6">
      <Link href="/locations" className="text-sm text-teal-ink hover:underline">‹ Casinolar</Link>

      <header className="relative overflow-hidden rounded-2xl bg-ink px-6 py-7 text-cream md:px-8">
        <div aria-hidden className="pointer-events-none absolute -right-20 -top-28 h-72 w-72 rounded-full bg-[radial-gradient(circle,rgb(201_162_74/0.25),transparent_65%)]" />
        <div className="flex flex-wrap items-center gap-4">
          <span className="grid h-14 w-14 place-items-center rounded-2xl border border-[#c9a24a]/50 bg-gradient-to-br from-[#2a2416] to-[#121214]">
            <Gem className="h-7 w-7 text-[#e8cf8a]" strokeWidth={1.5} aria-hidden />
          </span>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-[#d8b45c]">CASINO PROFİLİ</p>
            <h1 className="font-display text-4xl font-semibold">{casino.name}</h1>
            <p className="flex items-center gap-1 text-sm text-cream/70"><MapPin className="h-3.5 w-3.5" aria-hidden /> {casino.country ?? "ülke yok"} · para birimi {casino.currency} · kayıt {day(casino.createdAt)}</p>
          </div>
        </div>
        <dl className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ["Trip", casino.trips.filter((t) => t.status !== "CANCELLED").length],
            ["Planlı trip", upcoming],
            ["Oyuncu", p.playerCount],
            ["Sözleşme", finance ? finance.contracts.length : "—"],
          ].map(([k, v]) => (
            <div key={String(k)} className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3">
              <dt className="text-[10px] font-bold uppercase tracking-wider text-cream/60">{k}</dt>
              <dd className="text-2xl font-bold tabular-nums text-[#f3dc9a]">{typeof v === "number" ? v.toLocaleString("tr-TR") : v}</dd>
            </div>
          ))}
        </dl>
      </header>

      <div className="grid gap-6 xl:grid-cols-2">
        <section className="card bg-white">
          <h2 className="card-title flex items-center gap-2"><CalendarClock className="h-4 w-4" aria-hidden /> Tripler</h2>
          {casino.trips.length === 0 ? (
            <p className="text-sm text-muted">Trip yok.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-line text-sm">
              {casino.trips.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-3 py-2">
                  {can(user, "finance.view") ? (
                    <Link href={`/finance/trips/${t.id}`} className="font-medium text-ink hover:underline">{t.name}</Link>
                  ) : (
                    <span className="font-medium text-ink">{t.name}</span>
                  )}
                  <span className="shrink-0 text-xs text-muted">{day(t.startDate)} – {day(t.endDate)} · {t._count.guests} oyuncu · {TRIP_STATUS[t.status] ?? t.status}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card bg-white">
          <h2 className="card-title flex items-center gap-2"><Users className="h-4 w-4" aria-hidden /> Oyuncular</h2>
          {p.players.length === 0 ? (
            <p className="text-sm text-muted">{p.playerCount ? `${p.playerCount} oyuncu (adlar yetkinizin kapsamında değil).` : "Bu casinoya trip yapan oyuncu yok."}</p>
          ) : (
            <ul className="flex max-h-96 flex-col divide-y divide-line overflow-y-auto text-sm">
              {p.players.map((g) => (
                <li key={g.guestId} className="flex items-center justify-between gap-3 py-2">
                  {g.linkable ? (
                    <Link href={`/guests/${g.guestId}`} className="font-medium text-ink hover:underline">{g.name}</Link>
                  ) : (
                    <span className="font-medium text-ink">{g.name}</span>
                  )}
                  <span className="shrink-0 text-xs text-muted">CRM-{String(g.crmNo).padStart(6, "0")} · {g.trips} trip · son {day(g.lastTrip)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {finance ? (
        <section className="flex flex-col gap-4 rounded-2xl border-l-4 border-warn bg-warn-bg/60 p-5">
          <h2 className="flex items-center gap-2 font-display text-2xl font-semibold text-ink">
            <Lock className="h-5 w-5 text-warn-ink" aria-hidden /> Finans
            <span className="text-xs font-sans font-normal text-warn-ink">· bu bölümün görüntülenmesi erişim kaydına yazıldı</span>
          </h2>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-line bg-white p-4">
              <p className="text-[11px] font-bold uppercase tracking-wider text-muted">Net kayıp (+) / kazanç (−)</p>
              {finance.totals.netLoss.length === 0 ? <p className="stat-value">—</p> : finance.totals.netLoss.map((t) => <p key={t.currency} className="text-xl font-bold tabular-nums text-ink">{money(t.total)} {t.currency}</p>)}
            </div>
            <div className="rounded-xl border border-line bg-white p-4">
              <p className="text-[11px] font-bold uppercase tracking-wider text-muted">Rolling</p>
              {finance.totals.rolling.length === 0 ? <p className="stat-value">—</p> : finance.totals.rolling.map((t) => <p key={t.currency} className="text-xl font-bold tabular-nums text-ink">{money(t.total)} {t.currency}</p>)}
            </div>
            <div className="rounded-xl border border-line bg-white p-4">
              <p className="text-[11px] font-bold uppercase tracking-wider text-muted">Sonuç kaydı</p>
              <p className="stat-value">{finance.totals.results.toLocaleString("tr-TR")}</p>
            </div>
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="rounded-xl border border-line bg-white p-4">
              <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-ink"><Landmark className="h-4 w-4 text-teal-ink" aria-hidden /> Sözleşmeler</h3>
              <ul className="flex flex-col gap-1 text-sm">
                {finance.contracts.length === 0 && <li className="text-muted">Sözleşme yok.</li>}
                {finance.contracts.map((c) => (
                  <li key={c.id}>{c.name} <span className="text-xs text-muted">· sürüm {c.version ?? "—"} · {day(c.validFrom)} · {c.combine ?? ""}</span></li>
                ))}
              </ul>
              <Link href="/finance/contracts" className="mt-2 inline-block text-xs font-semibold text-teal-ink hover:underline">Sözleşmeleri yönet</Link>
            </div>
            <div className="rounded-xl border border-line bg-white p-4">
              <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-ink"><CalendarClock className="h-4 w-4 text-teal-ink" aria-hidden /> Komisyon dönemleri</h3>
              <ul className="flex flex-col gap-1 text-sm">
                {finance.periods.length === 0 && <li className="text-muted">Dönem yok.</li>}
                {finance.periods.map((d) => (
                  <li key={d.id}><Link href={`/finance/periods/${d.id}`} className="hover:underline">{d.period}</Link> <span className="text-xs text-muted">· {PERIOD_STATUS[d.status] ?? d.status}</span></li>
                ))}
              </ul>
            </div>
            <div className="rounded-xl border border-line bg-white p-4">
              <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-ink"><FileSpreadsheet className="h-4 w-4 text-teal-ink" aria-hidden /> Ekstreler</h3>
              <ul className="flex flex-col gap-1 text-sm">
                {finance.statements.length === 0 && <li className="text-muted">Ekstre yok.</li>}
                {finance.statements.map((s) => (
                  <li key={s.id}><Link href={`/finance/statements/${s.id}`} className="hover:underline">{s.period}</Link> <span className="text-xs text-muted">· {s.fileName} · {s.appliedAt ? "işlendi" : "işlenmedi"}</span></li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      ) : (
        <p className="callout-info flex items-center gap-2"><Lock className="h-4 w-4" aria-hidden /> Sözleşme, dönem ve oyun sonuçları yalnız finans yetkisiyle görünür.</p>
      )}
    </div>
  );
}
