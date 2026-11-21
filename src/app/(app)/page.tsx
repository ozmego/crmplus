import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  ClipboardCheck,
  FileUp,
  Gem,
  Headphones,
  Landmark,
  PhoneCall,
  ShieldAlert,
  UserCog,
  type LucideIcon,
} from "lucide-react";
import { can, requireUser } from "@/server/auth/rbac";
import { dashboardData } from "@/server/services/dashboard";
import { mfaRequired } from "@/server/auth/policy";
import { DailyBarChart } from "@/components/bar-chart";
import { hm, pct } from "@/lib/kpi";

export const dynamic = "force-dynamic";

const IMPORT_STATUS: Record<string, string> = {
  UPLOADED: "Yüklendi", MAPPED: "Eşlendi", PREVIEWED: "Önizlendi", APPLYING: "Uygulanıyor", APPLIED: "Uygulandı", ROLLED_BACK: "Geri alındı", FAILED: "Başarısız", REJECTED: "Reddedildi",
};
const PERIOD_STATUS: Record<string, string> = { OPEN: "Açık", LOCKED: "Kilitli", CLOSED: "Kapalı" };

function Tile({ label, value, sub, href, tone, icon: Icon }: { label: string; value: string | number; sub?: string; href?: string; tone?: "warn" | "critical"; icon?: LucideIcon }) {
  const ring = tone === "warn" ? "border-warn/70" : tone === "critical" ? "border-critical/60" : "border-line";
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-bold uppercase tracking-wider text-muted">{label}</p>
        {Icon && <Icon className={"h-4 w-4 " + (tone === "critical" ? "text-critical" : tone === "warn" ? "text-warn-ink" : "text-teal-ink")} aria-hidden />}
      </div>
      <p className="stat-value mt-1">{typeof value === "number" ? value.toLocaleString("tr-TR") : value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
      {tone && <p className="sr-only">{tone === "critical" ? "Kritik" : "Dikkat"}</p>}
    </>
  );
  const cls = `rounded-xl border ${ring} bg-white p-4 shadow-[0_1px_2px_rgb(18_18_20/0.04)]`;
  return href ? <Link href={href} className={cls + " transition-colors hover:border-teal-ink/50"}>{body}</Link> : <div className={cls}>{body}</div>;
}

function Section({ title, href, linkLabel, children }: { title: string; href?: string; linkLabel?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="font-display text-2xl font-semibold text-ink">{title}</h2>
        {href && (
          <Link href={href} className="inline-flex items-center gap-1 text-sm font-semibold text-teal-ink hover:underline">
            {linkLabel ?? "Tümü"} <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

export default async function Dashboard() {
  const user = await requireUser();
  const d = await dashboardData(user);
  const hour = Number(new Intl.DateTimeFormat("tr-TR", { hour: "numeric", hour12: false, timeZone: "Europe/Istanbul" }).format(new Date()));
  const greet = hour < 11 ? "Günaydın" : hour < 18 ? "İyi günler" : "İyi akşamlar";
  const firstName = user.name.split(/\s+/)[0];
  const dateLabel = new Date().toLocaleDateString("tr-TR", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Istanbul" });

  const actions: { href: string; label: string; icon: LucideIcon }[] = [];
  if (can(user, "call.make")) actions.push({ href: "/queue", label: "Arama kuyruğu", icon: PhoneCall });
  if (can(user, "import.create")) actions.push({ href: "/imports", label: "Liste yükle", icon: FileUp });
  if (can(user, "review.view")) actions.push({ href: "/review", label: "İnceleme kuyruğu", icon: ClipboardCheck });
  if (can(user, "finance.view")) actions.push({ href: "/finance", label: "Finans dönemleri", icon: Landmark });
  if (can(user, "finance.view") || can(user, "report.product")) actions.push({ href: "/locations", label: "Casinolar", icon: Gem });
  if (can(user, "hr.employee.view")) actions.push({ href: "/hr/employees", label: "Personel", icon: CalendarClock });
  else if (can(user, "route.checkin")) actions.push({ href: "/hr/my-route", label: "Bugünkü rotam", icon: CalendarClock });
  else if (can(user, "attendance.view")) actions.push({ href: "/hr", label: "Çizelgem", icon: CalendarClock });
  if (can(user, "user.view")) actions.push({ href: "/admin/users", label: "Kullanıcılar", icon: UserCog });
  const nothing = !d.myDay && !d.ops && !d.imports && !d.finance && !d.hr && !d.admin;
  // Özet: aktif personeli olan ekipler; mesaide/aramada olanlar önce (tam liste operasyon panelinde)
  const activeTeams = (d.ops?.teams ?? []).filter((t) => t.activeAgents > 0).sort((a, b) => b.onShiftNow - a.onShiftNow || b.callsToday - a.callsToday || a.name.localeCompare(b.name, "tr"));
  const teamsShown = activeTeams.slice(0, 6);

  return (
    <div className="flex flex-col gap-8">
      <header className="relative overflow-hidden rounded-2xl bg-ink px-6 py-7 text-cream md:px-8">
        <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-[radial-gradient(circle,rgb(201_162_74/0.25),transparent_65%)]" />
        <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-[#d8b45c]">DASHBOARD · {dateLabel}</p>
        <h1 className="mt-2 font-display text-4xl font-semibold">
          {greet}, <span className="text-gilded">{firstName}</span>
        </h1>
        {actions.length > 0 && (
          <nav aria-label="Hızlı erişim" className="mt-5 flex flex-wrap gap-2">
            {actions.map(({ href, label, icon: Icon }) => (
              <Link key={href} href={href} className="inline-flex items-center gap-2 rounded-lg border border-[#c9a24a]/35 bg-white/[0.04] px-3 py-2 text-sm font-semibold text-cream hover:border-[#c9a24a]/80 hover:bg-white/[0.08]">
                <Icon className="h-4 w-4 text-[#e0c072]" aria-hidden /> {label}
              </Link>
            ))}
          </nav>
        )}
      </header>

      {nothing && <p className="callout-info">Hesabınıza henüz bir rol atanmamış. Yöneticinize başvurun.</p>}

      {d.myDay && (
        <Section title="Benim günüm" href="/queue" linkLabel="Kuyruğa git">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Tile label="Açık görev" value={d.myDay.openTasks} icon={PhoneCall} href="/queue" />
            <Tile label="Bugünkü geri arama" value={d.myDay.callbacksToday} sub={d.myDay.lateCallbacks ? `${d.myDay.lateCallbacks} gecikmiş` : "gecikme yok"} tone={d.myDay.lateCallbacks ? "warn" : undefined} icon={CalendarClock} />
            <Tile label="Bugünkü arama" value={d.myDay.callsToday} sub={`${d.myDay.answeredToday} bağlandı`} icon={Headphones} />
            <Tile label="Konuşma süresi" value={hm(d.myDay.talkSecToday)} sub="bugün, santral/manuel süre" icon={Headphones} />
          </div>
          <div className="card bg-white">
            <DailyBarChart title="Aramalarım · son 14 gün" unit="arama" data={d.myDay.trend} />
          </div>
        </Section>
      )}

      {d.ops && (
        <Section title="Operasyon" href="/ops" linkLabel="Operasyon paneli">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Tile label="Bugün bekleyen arama" value={d.ops.cards.pendingToday} sub={`${d.ops.cards.openTasksToday} görev · ${d.ops.cards.callbacksToday} geri arama`} icon={PhoneCall} href="/ops" />
            <Tile label="Geciken geri arama" value={d.ops.cards.lateCallbacks + d.ops.cards.missedCallbacks} sub={`${d.ops.cards.missedCallbacks} kaçırıldı (> 24 sa)`} tone={d.ops.cards.lateCallbacks + d.ops.cards.missedCallbacks ? "warn" : undefined} icon={AlertTriangle} />
            <Tile label="İzin durumu eksik" value={d.ops.cards.consentUnknown} sub={`${d.ops.cards.guestsActive.toLocaleString("tr-TR")} aktif oyuncudan`} href="/guests?consent=UNKNOWN" icon={ShieldAlert} />
            <Tile label="Geri arama zamanında" value={pct(d.ops.product.callbackOnTime)} sub="son 30 gün · hedef > %85" icon={CalendarClock} />
          </div>
          <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
            <div className="card bg-white">
              <DailyBarChart title="Tüm aramalar · son 14 gün" unit="arama" data={d.ops.trend} />
            </div>
            <div className="card bg-white">
              <p className="mb-2 text-sm font-semibold text-ink">Ekipler · bugün</p>
              {teamsShown.length === 0 ? (
                <p className="text-sm text-muted">Aktif personeli olan ekip yok.</p>
              ) : (
                <ul className="flex flex-col divide-y divide-line text-sm">
                  {teamsShown.map((t) => (
                    <li key={t.name} className="flex items-center justify-between gap-2 py-2">
                      <span className="font-semibold text-ink">{t.name}</span>
                      <span className="text-xs text-muted tabular-nums">{t.onShiftNow}/{t.activeAgents} mesaide · {t.callsToday} arama · ulaşma {pct(t.reachRate)}</span>
                    </li>
                  ))}
                </ul>
              )}
              {activeTeams.length > teamsShown.length && (
                <Link href="/ops" className="mt-2 inline-block text-xs font-semibold text-teal-ink hover:underline">
                  +{activeTeams.length - teamsShown.length} ekip daha · operasyon paneli
                </Link>
              )}
            </div>
          </div>
        </Section>
      )}

      <div className="grid gap-8 xl:grid-cols-2">
        {d.imports && (
          <Section title="Veri ve inceleme" href="/imports" linkLabel="İçe aktarma">
            <div className="grid gap-3 sm:grid-cols-2">
              <Tile label="Açık inceleme" value={d.imports.reviewOpen} href="/review" tone={d.imports.reviewOpen ? "warn" : undefined} icon={ClipboardCheck} />
              <Tile label="Son yüklemeler" value={d.imports.recent.length} sub="son 5 dosya aşağıda" icon={FileUp} />
            </div>
            <ul className="card flex flex-col divide-y divide-line bg-white p-0 text-sm">
              {d.imports.recent.length === 0 && <li className="p-4 text-muted">Henüz dosya yok.</li>}
              {d.imports.recent.map((b) => (
                <li key={b.id}>
                  <Link href={`/imports/${b.id}`} className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-card">
                    <span className="truncate font-medium text-ink">{b.fileName}</span>
                    <span className="shrink-0 text-xs text-muted">{IMPORT_STATUS[b.status] ?? b.status} · {b.createdAt.toLocaleDateString("tr-TR", { timeZone: "Europe/Istanbul" })}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {d.finance && (
          <Section title="Finans" href="/finance" linkLabel="Dönemler">
            <div className="grid gap-3 sm:grid-cols-3">
              <Tile label="Onay bekleyen hesap" value={d.finance.inReview} tone={d.finance.inReview ? "warn" : undefined} icon={Landmark} href="/finance" />
              <Tile label="İşlenmemiş ekstre" value={d.finance.statementsPending} icon={FileUp} href="/finance" />
              <Tile label="Casino" value={d.finance.casinos} icon={Gem} href="/locations" />
            </div>
            <div className="card bg-white">
              <p className="mb-2 text-sm font-semibold text-ink">Dönemler</p>
              <p className="text-sm text-muted">
                {Object.entries(d.finance.periods).map(([s, n]) => `${PERIOD_STATUS[s] ?? s}: ${n}`).join(" · ") || "Dönem yok."}
              </p>
              <p className="mb-2 mt-4 text-sm font-semibold text-ink">Yaklaşan tripler · 30 gün</p>
              <ul className="flex flex-col divide-y divide-line text-sm">
                {d.finance.upcomingTrips.length === 0 && <li className="py-2 text-muted">Planlı trip yok.</li>}
                {d.finance.upcomingTrips.map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-2 py-2">
                    <Link href={`/finance/trips/${t.id}`} className="font-medium text-ink hover:underline">{t.name}</Link>
                    <span className="text-xs text-muted">{t.casino.name} · {t.startDate.toLocaleDateString("tr-TR", { timeZone: "Europe/Istanbul" })} · {t._count.guests} oyuncu</span>
                  </li>
                ))}
              </ul>
            </div>
          </Section>
        )}

        {d.hr && (
          <Section title="Personel" href="/hr" linkLabel="Personel modülü">
            <div className="grid gap-3 sm:grid-cols-3">
              <Tile label="Aktif personel" value={d.hr.employees} icon={UserCog} />
              <Tile label="Bugün vardiyada" value={d.hr.shiftsToday} sub="yayınlanmış çizelge" icon={CalendarClock} />
              <Tile label="Bekleyen izin" value={d.hr.leavePending} tone={d.hr.leavePending ? "warn" : undefined} icon={CalendarClock} href="/hr/leave" />
            </div>
          </Section>
        )}

        {d.admin && (
          <Section title="Güvenlik ve yönetim" href={can(user, "audit.view") ? "/admin/audit" : "/admin/users"} linkLabel={can(user, "audit.view") ? "Denetim" : "Kullanıcılar"}>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Tile label="Aktif kullanıcı" value={d.admin.usersActive} icon={UserCog} href={can(user, "user.view") ? "/admin/users" : undefined} />
              {mfaRequired() && <Tile label="MFA kurulmamış" value={d.admin.noMfa} tone={d.admin.noMfa ? "warn" : undefined} icon={ShieldAlert} />}
              <Tile label="Açık erişim uyarısı" value={d.admin.alertsOpen} tone={d.admin.alertsOpen ? "critical" : undefined} icon={AlertTriangle} />
              <Tile label="Yetkisiz deneme · 24 sa" value={d.admin.denied24h} tone={d.admin.denied24h ? "warn" : undefined} icon={ShieldAlert} />
            </div>
          </Section>
        )}
      </div>
    </div>
  );
}
