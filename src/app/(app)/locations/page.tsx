import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowUpRight, CalendarClock, Gem, MapPin } from "lucide-react";
import { can, requireUser } from "@/server/auth/rbac";
import { logAccess } from "@/server/audit";
import { canSeeLocations, locationList } from "@/server/services/profiles";

export const dynamic = "force-dynamic";
const day = (d: Date | null) => (d ? d.toLocaleDateString("tr-TR", { timeZone: "Europe/Istanbul" }) : "—");

export default async function LocationsPage() {
  const user = await requireUser();
  if (!canSeeLocations(user)) {
    await logAccess({ actorId: user.id, action: "denied", resource: "page:locations", meta: { permission: "finance.view|report.product" } });
    redirect("/forbidden");
  }
  const rows = await locationList();
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">OYUNCULAR · LOKASYONLAR</p>
          <h1 className="page-title">Casinolar</h1>
          <p className="mt-1 text-sm text-muted">Casino bazında tripler ve oyuncular. Sözleşme, dönem ve sonuçlar yalnız finans yetkisiyle görünür.</p>
        </div>
        {can(user, "finance.contract.manage") && (
          <Link href="/finance/contracts" className="btn-secondary">Casino ekle / sözleşmeler</Link>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="callout-info">Henüz casino tanımlı değil.{can(user, "finance.contract.manage") ? " Finans > Casinolar ve sözleşmeler ekranından ekleyebilirsiniz." : ""}</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((c) => (
            <Link key={c.id} href={`/locations/${c.id}`} className="group relative overflow-hidden rounded-2xl border border-line bg-white p-5 shadow-[0_1px_2px_rgb(18_18_20/0.04)] transition-colors hover:border-teal-ink/50">
              <div aria-hidden className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[#e8cf8a] via-[#c9a24a] to-[#8a6a1e] opacity-80" />
              <div className="flex items-start justify-between gap-3">
                <span className="grid h-11 w-11 place-items-center rounded-xl bg-ink">
                  <Gem className="h-5 w-5 text-[#e8cf8a]" strokeWidth={1.7} aria-hidden />
                </span>
                <ArrowUpRight className="h-4 w-4 text-muted group-hover:text-teal-ink" aria-hidden />
              </div>
              <h2 className="mt-3 font-display text-2xl font-semibold text-ink">{c.name}</h2>
              <p className="flex items-center gap-1 text-sm text-muted"><MapPin className="h-3.5 w-3.5" aria-hidden /> {c.country ?? "ülke yok"} · {c.currency}</p>
              <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-line pt-3 text-center">
                <div><dt className="text-[10px] font-bold uppercase tracking-wider text-muted">Trip</dt><dd className="text-lg font-bold tabular-nums text-ink">{c.trips}</dd></div>
                <div><dt className="text-[10px] font-bold uppercase tracking-wider text-muted">Oyuncu</dt><dd className="text-lg font-bold tabular-nums text-ink">{c.players}</dd></div>
                <div><dt className="text-[10px] font-bold uppercase tracking-wider text-muted">Planlı</dt><dd className="text-lg font-bold tabular-nums text-ink">{c.upcoming}</dd></div>
              </dl>
              <p className="mt-3 flex items-center gap-1 text-xs text-muted">
                <CalendarClock className="h-3.5 w-3.5" aria-hidden /> Sonraki trip: {day(c.nextTrip)} · son: {day(c.lastTrip)}
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
