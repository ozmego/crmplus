import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CalendarClock, Clock, Gem, History, IdCard, Landmark, Lock, MapPin, MessageSquareText, Phone, ShieldCheck, UserRound, type LucideIcon } from "lucide-react";
import { CasinoTab, CreditLines } from "./casino-tab";
import { can, requireUser } from "@/server/auth/rbac";
import { logAccess } from "@/server/audit";
import { getGuestCard } from "@/server/services/guests";
import { guestFinance, profileHeader, tripAttendance } from "@/server/services/profiles";
import { ConsentBadge, PhoneStateBadge } from "@/components/badges";
import { BlockForm, ConsentEditor, RevealPhone } from "@/components/guest-actions";
import { FinanceForm } from "@/components/finance-form";
import { db } from "@/server/db";
import { sendSingleAction } from "@/app/(app)/messages/actions";
import { guestWaAction } from "@/app/(app)/inbox/actions";
import { checkPhoneAction } from "@/app/(app)/admin/integrations/actions";
import { lastLineStatus, phoneCheckApproval, phoneCheckMode } from "@/server/telephony/phone-validation";
import { waEnabled, waTemplatesForSend } from "@/server/services/whatsapp";

export const dynamic = "force-dynamic";

const CHANNEL_LABEL: Record<string, string> = { CALL: "Arama", SMS: "SMS", WHATSAPP: "WhatsApp", EMAIL: "E-posta", RECORDING: "Görüşme kaydı", VISIT: "Saha ziyareti", NOTE: "Not", IMPORT: "İçe aktarma" };
const TRIP_STATUS: Record<string, string> = { PLANNED: "Planlı", DONE: "Tamamlandı", CANCELLED: "İptal" };
const fmt = (d: Date | null | undefined) => (d ? d.toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Istanbul" }) : "—");
const day = (d: Date | null | undefined) => (d ? d.toLocaleDateString("tr-TR", { timeZone: "Europe/Istanbul" }) : "—");
const money = (v: { toString(): string } | null) => (v === null ? "—" : Number(v.toString()).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

type Tab = "genel" | "casino" | "tripler" | "gecmis" | "finans";

function Tabs({ id, active, tabs }: { id: string; active: Tab; tabs: { key: Tab; label: string; icon: LucideIcon; locked?: boolean }[] }) {
  return (
    <nav aria-label="Profil bölümleri" className="flex flex-wrap gap-1 border-b border-line">
      {tabs.map(({ key, label, icon: Icon, locked }) => {
        const on = key === active;
        return (
          <Link
            key={key}
            href={key === "genel" ? `/guests/${id}` : `/guests/${id}?tab=${key}`}
            aria-current={on ? "page" : undefined}
            className={
              "-mb-px inline-flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors " +
              (on ? "border-teal-ink text-ink" : "border-transparent text-muted hover:text-ink")
            }
          >
            <Icon className="h-4 w-4" aria-hidden /> {label}
            {locked && <Lock className="h-3 w-3 text-warn-ink" aria-label="finans yetkisi" />}
          </Link>
        );
      })}
    </nav>
  );
}

export default async function PlayerProfile({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const user = await requireUser();
  if (!can(user, "guest.view") && !can(user, "finance.view")) {
    await logAccess({ actorId: user.id, action: "denied", resource: "page:guest.view", meta: { permission: "guest.view" } });
    redirect("/forbidden");
  }
  const { id } = await params;
  const sp = await searchParams;
  const header = await profileHeader(user, id);
  if (!header) notFound();
  const canFinance = can(user, "finance.view");
  const requested = (["genel", "casino", "tripler", "gecmis", "finans"] as const).find((t) => t === sp.tab);
  // Yalnız finans yetkisiyle gelen kullanıcı yalnız finans sekmesini görür (misafir verisinden ad + CRM no)
  const tab: Tab = header.viaFinanceOnly ? "finans" : requested === "finans" && !canFinance ? "genel" : requested ?? "genel";
  const crm = `CRM-${String(header.crmNo).padStart(6, "0")}`;

  const tabs: { key: Tab; label: string; icon: LucideIcon; locked?: boolean }[] = header.viaFinanceOnly
    ? [{ key: "finans", label: "Finans", icon: Landmark, locked: true }]
    : [
        { key: "genel", label: "Genel", icon: UserRound },
        { key: "casino", label: "Casino profili", icon: IdCard },
        { key: "tripler", label: "Tripler", icon: Gem },
        { key: "gecmis", label: "Geçmiş", icon: History },
        ...(canFinance ? [{ key: "finans" as const, label: "Finans", icon: Landmark, locked: true }] : []),
      ];

  if (header.viaFinanceOnly) {
    return (
      <div className="flex flex-col gap-6">
        <ProfileHero eyebrow={`OYUNCU PROFİLİ · ${crm}`} name={`${header.firstName} ${header.lastName}`} sub="Finans görünümü: oyuncu kartının iletişim ve izin bilgileri bu rolde görünmez." />
        <Tabs id={id} active={tab} tabs={tabs} />
        <FinanceTab userGuestId={id} user={user} />
      </div>
    );
  }

  const g = await getGuestCard(user, id);
  if (!g) notFound();
  const trips = await tripAttendance(id);
  const activeBlocks = g.blocks.filter((b) => !b.removedAt);
  const consentByChannel = new Map(g.consents.map((c) => [c.channel, c]));
  const lastContact = g.interactions[0]?.at ?? null;
  const callConsent = consentByChannel.get("CALL")?.status ?? "UNKNOWN";
  const nextTrip = trips.filter((t) => t.status === "PLANNED" && t.startDate >= new Date()).sort((a, b) => a.startDate.getTime() - b.startDate.getTime())[0];

  return (
    <div className="flex flex-col gap-6">
      <ProfileHero
        eyebrow={`OYUNCU PROFİLİ · ${crm}`}
        name={`${g.firstName} ${g.lastName}`}
        sub={`${g.language.toUpperCase()} · ${g.timezone}${g.country ? ` · ${g.country}` : ""}${g.city ? ` · ${g.city}` : ""} · Sahip: ${g.owner?.name ?? "atanmamış"}`}
        vip={g.vipLevel}
        action={can(user, "block.create") && activeBlocks.length === 0 ? <BlockForm guestId={g.id} /> : null}
        stats={[
          { label: "Arama izni", value: callConsent === "GRANTED" ? "Var" : callConsent === "DENIED" ? "Ret" : "Bilinmiyor", icon: ShieldCheck },
          { label: "Son iletişim", value: day(lastContact), icon: Clock },
          { label: "Trip", value: String(trips.filter((t) => t.status !== "CANCELLED").length), icon: Gem },
          { label: "Sonraki trip", value: nextTrip ? day(nextTrip.startDate) : "—", icon: CalendarClock },
        ]}
      />

      {activeBlocks.length > 0 && (
        <p className="callout-critical">
          <b>İletişim durduruldu</b> · {activeBlocks.map((b) => `${b.allChannels ? "tüm kanallar" : CHANNEL_LABEL[b.channel ?? ""]} (talep: ${fmt(b.requestedAt)})`).join(", ")}
        </p>
      )}

      <Tabs id={id} active={tab} tabs={tabs} />

      {tab === "genel" && <GeneralTab user={user} g={g} consentByChannel={consentByChannel} />}

      {tab === "casino" && <CasinoTab user={user} guestId={id} />}

      {tab === "tripler" && (
        <section className="card bg-white">
          <h2 className="card-title flex items-center gap-2"><Gem className="h-4 w-4" aria-hidden /> Trip katılımları</h2>
          <p className="mb-3 text-xs text-muted">Yalnız katılım bilgisi; oyun sonuçları ve tutarlar Finans sekmesindedir (finans yetkisiyle).</p>
          {trips.length === 0 ? (
            <p className="text-sm text-muted">Trip katılımı yok.</p>
          ) : (
            <ol className="relative flex flex-col gap-4 border-r-0 pl-5 before:absolute before:bottom-1 before:left-1.5 before:top-1 before:w-px before:bg-line">
              {trips.map((t) => (
                <li key={t.id} className="relative">
                  <span className="absolute -left-[18px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-teal-ink ring-1 ring-teal-ink" aria-hidden />
                  <p className="font-semibold text-ink">{t.name}</p>
                  <p className="text-sm text-muted">
                    {can(user, "finance.view") || can(user, "report.product") ? (
                      <Link href={`/locations/${t.casino.id}`} className="text-teal-ink hover:underline">{t.casino.name}</Link>
                    ) : (
                      t.casino.name
                    )}{" "}
                    · {day(t.startDate)} – {day(t.endDate)} · {TRIP_STATUS[t.status] ?? t.status}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </section>
      )}

      {tab === "gecmis" && <HistoryTab g={g} />}

      {tab === "finans" && canFinance && <FinanceTab userGuestId={id} user={user} />}
    </div>
  );
}

function ProfileHero({ eyebrow, name, sub, vip, action, stats }: { eyebrow: string; name: string; sub: string; vip?: string | null; action?: React.ReactNode; stats?: { label: string; value: string; icon: LucideIcon }[] }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toLocaleUpperCase("tr-TR")).join("");
  return (
    <header className="relative overflow-hidden rounded-2xl bg-ink px-6 py-7 text-cream md:px-8">
      <div aria-hidden className="pointer-events-none absolute -right-24 -top-28 h-80 w-80 rounded-full bg-[radial-gradient(circle,rgb(201_162_74/0.22),transparent_65%)]" />
      <div className="relative flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <span className="grid h-16 w-16 shrink-0 place-items-center rounded-full border-2 border-[#c9a24a]/70 bg-gradient-to-br from-[#2a2416] to-[#121214] font-display text-2xl font-semibold text-[#f3dc9a]" aria-hidden>
            {initials}
          </span>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-[#d8b45c]">{eyebrow}</p>
            <h1 className="font-display text-4xl font-semibold leading-tight">
              {name}
              {vip && <span className="ml-3 inline-flex translate-y-[-4px] items-center gap-1 rounded-full border border-[#c9a24a]/60 bg-[#c9a24a]/15 px-2.5 py-0.5 align-middle font-sans text-xs font-bold tracking-wide text-[#f3dc9a]"><Gem className="h-3 w-3" aria-hidden /> {vip}</span>}
            </h1>
            <p className="mt-1 flex items-center gap-1 text-sm text-cream/70"><MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden /> {sub}</p>
          </div>
        </div>
        {action && <div className="rounded-lg bg-white/[0.06] p-2 [&_.btn-secondary]:border-white/20 [&_.btn-secondary]:bg-transparent [&_.btn-secondary]:text-cream">{action}</div>}
      </div>
      {stats && (
        <dl className="relative mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {stats.map(({ label, value, icon: Icon }) => (
            <div key={label} className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3">
              <dt className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-cream/60"><Icon className="h-3.5 w-3.5 text-[#d8b45c]" aria-hidden /> {label}</dt>
              <dd className="mt-0.5 text-lg font-bold tabular-nums text-[#f3dc9a]">{value}</dd>
            </div>
          ))}
        </dl>
      )}
    </header>
  );
}

type Card = NonNullable<Awaited<ReturnType<typeof getGuestCard>>>;

async function GeneralTab({ user, g, consentByChannel }: { user: Awaited<ReturnType<typeof requireUser>>; g: Card; consentByChannel: Map<string, Card["consents"][number]> }) {
  const canGrant = can(user, "consent.edit");
  const phoneCheckOn = can(user, "phone.check") && phoneCheckMode() !== "none" && !!(await phoneCheckApproval()).approvedAt;
  const lineStatus = await lastLineStatus(g.phones.map((p) => p.id));
  const waTemplates = can(user, "message.send.single") && (await waEnabled()) ? await waTemplatesForSend() : [];
  const smsTemplates = can(user, "message.send.single") ? await db.messageTemplate.findMany({ where: { status: "APPROVED", channel: "SMS" }, orderBy: { name: "asc" }, select: { id: true, name: true, category: true } }) : [];

  return (
    <>
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card bg-white">
          <h2 className="card-title flex items-center gap-2"><Phone className="h-4 w-4" aria-hidden /> İletişim bilgileri</h2>
          <ul className="flex flex-col gap-3">
            {g.phones.map((p) => (
              <li key={p.id} className="flex flex-col gap-1 border-b border-line pb-3 last:border-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono">{p.masked}</span>
                  {p.isPrimary && <span className="pill border-ink text-ink">Birincil</span>}
                  {p.ownership === "DISPUTED" && <span className="pill border-critical text-critical">Tartışmalı (yanlış kişi)</span>}
                  {can(user, "field.contact.full") && <RevealPhone phoneId={p.id} />}
                  {phoneCheckOn && <FinanceForm action={checkPhoneAction} submit="Hat durumunu sorgula" tone="secondary" inline fields={[{ name: "phoneId", type: "hidden", value: p.id }, { name: "guestId", type: "hidden", value: g.id }]} />}
                </div>
                {lineStatus.get(p.id) && (
                  <p className="text-xs text-muted" data-testid="line-status">
                    Hat durumu (dış servis, kesin değildir): <b>{({ ACTIVE: "aktif görünüyor", INACTIVE: "kapalı görünüyor", UNKNOWN: "bilinmiyor" } as Record<string, string>)[lineStatus.get(p.id)!.result] ?? lineStatus.get(p.id)!.result}</b> · {lineStatus.get(p.id)!.source} · güven {(lineStatus.get(p.id)!.raw as { confidence?: string } | null)?.confidence ?? "—"} · {fmt(lineStatus.get(p.id)!.at)}
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                  <PhoneStateBadge formatStatus={p.formatStatus} reachability={p.reachability} />
                  <span>Hat: {p.lineType ?? "bilinmiyor"} · Son kontrol: {fmt(p.lastCheckedAt)}</span>
                  {p.lastReachedAt && <span>· Son ulaşılma: {fmt(p.lastReachedAt)}</span>}
                </div>
              </li>
            ))}
            {g.emails.map((e) => (
              <li key={e.id} className="font-mono text-sm">{e.masked}</li>
            ))}
            {g.phones.length === 0 && g.emails.length === 0 && <li className="text-sm text-muted">İletişim bilgisi yok.</li>}
          </ul>
          {g.externalIds.length > 0 && <p className="mt-3 text-xs text-muted">Dış kimlikler: {g.externalIds.map((x) => `${x.source}: ${x.value}`).join(" · ")}</p>}
          {smsTemplates.length > 0 && g.phones.length > 0 && (
            <details className="mt-4">
              <summary className="cursor-pointer text-sm font-semibold text-teal-ink">Şablonlu SMS gönder</summary>
              <p className="mt-1 text-xs text-muted">SMS izni, durdurma kaydı ve İYS kontrolü gönderim anında yapılır.</p>
              <div className="mt-2">
                <FinanceForm action={sendSingleAction} submit="Gönder" inline fields={[{ name: "guestId", type: "hidden", value: g.id }, { name: "templateId", label: "Onaylı şablon", type: "select", required: true, options: smsTemplates.map((t) => ({ value: t.id, label: `${t.name} (${t.category === "MARKETING" ? "pazarlama" : "bilgilendirme"})` })) }]} />
              </div>
            </details>
          )}
          {waTemplates.length > 0 && g.phones.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer text-sm font-semibold text-teal-ink">WhatsApp şablonu gönder</summary>
              <p className="mt-1 text-xs text-muted">WhatsApp izni, durdurma kaydı ve İYS kontrolü gönderim anında yapılır; yanıtlar gelen kutusuna düşer.</p>
              <div className="mt-2">
                <FinanceForm action={guestWaAction} submit="WhatsApp gönder" inline fields={[{ name: "guestId", type: "hidden", value: g.id }, { name: "templateId", label: "Onaylı WhatsApp şablonu", type: "select", required: true, options: waTemplates.map((t) => ({ value: t.id, label: `${t.name} (${t.language})` })) }]} />
              </div>
            </details>
          )}
        </section>

        <section className="card bg-white">
          <h2 className="card-title flex items-center gap-2"><ShieldCheck className="h-4 w-4" aria-hidden /> İletişim izinleri</h2>
          <table className="w-full text-sm">
            <tbody>
              {(["CALL", "SMS", "WHATSAPP", "EMAIL", "RECORDING"] as const).map((ch) => {
                const c = consentByChannel.get(ch);
                return (
                  <tr key={ch} className="border-b border-line align-top last:border-0">
                    <th scope="row" className="py-2 pr-3 text-left font-semibold text-ink">{CHANNEL_LABEL[ch]}</th>
                    <td className="py-2 pr-3"><ConsentBadge status={c?.status ?? "UNKNOWN"} /></td>
                    <td className="py-2 text-xs text-muted">
                      {c ? (
                        <>
                          {c.scope === "SERVICE" ? "Hizmet" : "Pazarlama"} · {c.source ?? "kaynak yok"}
                          {c.sourceSystem ? ` (${c.sourceSystem})` : ""}
                          {c.proofRef ? ` · kanıt: ${c.proofRef}` : ""} · {fmt(c.updatedAt)}
                        </>
                      ) : (
                        "Kayıt yok"
                      )}
                      {can(user, "consent.view") && <div><ConsentEditor guestId={g.id} channel={ch} canGrant={canGrant} /></div>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      </div>

      {g.tasks.length > 0 && (
        <section className="card bg-white">
          <h2 className="card-title">Açık görevler</h2>
          <ul className="text-sm">
            {g.tasks.map((t) => (
              <li key={t.id}>
                {t.reason} · {t.assignee?.name ?? "atanmamış"} · <span className="font-mono text-xs">{t.status}</span>
                {t.closeReason ? <span className="text-xs text-muted"> ({t.closeReason})</span> : null}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function HistoryTab({ g }: { g: Card }) {
  return (
    <>
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card bg-white">
          <h2 className="card-title flex items-center gap-2"><MessageSquareText className="h-4 w-4" aria-hidden /> İletişim geçmişi</h2>
          {g.interactions.length === 0 ? (
            <p className="text-sm text-muted">Henüz iletişim yok.</p>
          ) : (
            <ol className="flex flex-col gap-2 text-sm">
              {g.interactions.map((i) => (
                <li key={i.id} className="flex gap-3">
                  <span className="w-28 shrink-0 text-xs text-muted">{fmt(i.at)}</span>
                  <span><b>{CHANNEL_LABEL[i.channel] ?? i.channel}</b> · {i.summary}</span>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="card bg-white">
          <h2 className="card-title flex items-center gap-2"><History className="h-4 w-4" aria-hidden /> Değişiklik geçmişi</h2>
          {g.history.length === 0 ? (
            <p className="text-sm text-muted">Değişiklik yok.</p>
          ) : (
            <div className="max-h-80 overflow-y-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-muted">
                    <th scope="col" className="py-1">Alan</th>
                    <th scope="col">Eski → yeni</th>
                    <th scope="col">Kaynak</th>
                    <th scope="col">Tarih</th>
                  </tr>
                </thead>
                <tbody>
                  {g.history.map((h) => (
                    <tr key={String(h.id)} className="border-t border-line align-top">
                      <td className="py-1 font-semibold">{h.field}</td>
                      <td>{h.oldValue ?? "∅"} → {h.newValue ?? "∅"}</td>
                      <td>{h.importBatchId ? <Link className="text-teal-ink hover:underline" href={`/imports/${h.importBatchId}`}>import</Link> : h.sourceId ?? "manuel"}</td>
                      <td>{fmt(h.at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {g.notes && g.notes.length > 0 && (
        <section className="card bg-white">
          <h2 className="card-title">Notlar</h2>
          <ul className="flex flex-col gap-2 text-sm">
            {g.notes.map((n) => (
              <li key={n.id}><span className="text-xs text-muted">{fmt(n.createdAt)}</span> · {n.body}</li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

async function FinanceTab({ user, userGuestId }: { user: Awaited<ReturnType<typeof requireUser>>; userGuestId: string }) {
  const f = await guestFinance(user, userGuestId);
  return (
    <section className="flex flex-col gap-4 rounded-2xl border-l-4 border-warn bg-warn-bg/60 p-5">
      <p className="flex items-center gap-2 text-sm text-warn-ink">
        <Lock className="h-4 w-4" aria-hidden /> <b>Finansal veri</b> — bu görüntüleme erişim kaydına yazıldı. Kayıp/kazanç hedefleme, öncelik veya segment için kullanılmaz.
      </p>
      <CreditLines user={user} guestId={userGuestId} />
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-line bg-white p-4">
          <p className="text-[11px] font-bold uppercase tracking-wider text-muted">Net kayıp (+) / kazanç (−)</p>
          {f.totals.netLoss.length === 0 ? <p className="stat-value">—</p> : f.totals.netLoss.map((t) => <p key={t.currency} className="text-xl font-bold tabular-nums text-ink">{money(t.total)} {t.currency}</p>)}
        </div>
        <div className="rounded-xl border border-line bg-white p-4">
          <p className="text-[11px] font-bold uppercase tracking-wider text-muted">Rolling</p>
          {f.totals.rolling.length === 0 ? <p className="stat-value">—</p> : f.totals.rolling.map((t) => <p key={t.currency} className="text-xl font-bold tabular-nums text-ink">{money(t.total)} {t.currency}</p>)}
        </div>
        <div className="rounded-xl border border-line bg-white p-4">
          <p className="text-[11px] font-bold uppercase tracking-wider text-muted">Sonuç kaydı</p>
          <p className="stat-value">{f.totals.results.toLocaleString("tr-TR")}</p>
        </div>
      </div>
      {f.trips.length === 0 ? (
        <p className="text-sm text-muted">Bu oyuncunun trip kaydı yok.</p>
      ) : (
        f.trips.map((t) => (
          <div key={t.id} className="overflow-x-auto rounded-xl border border-line bg-white">
            <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3">
              <Link href={`/finance/trips/${t.trip.id}`} className="font-semibold text-ink hover:underline">{t.trip.name}</Link>
              <span className="text-xs text-muted">{t.trip.casino.name} · {day(t.trip.startDate)}</span>
            </div>
            <table className="table-ink min-w-[640px]">
              <thead>
                <tr><th scope="col">Tarih</th><th scope="col">Net kayıp (+) / kazanç (−)</th><th scope="col">Rolling</th><th scope="col">Buy-in</th><th scope="col">Cash-out</th><th scope="col">Dönem</th><th scope="col">Kaynak</th></tr>
              </thead>
              <tbody className="tabular-nums">
                {t.results.length === 0 && <tr><td colSpan={7} className="text-muted">Sonuç girilmemiş.</td></tr>}
                {t.results.map((r) => (
                  <tr key={r.id}>
                    <td>{day(r.playedOn)}</td>
                    <td>{money(r.netLoss)} {r.currency}</td>
                    <td>{money(r.rolling)}</td>
                    <td>{money(r.buyIn)}</td>
                    <td>{money(r.cashOut)}</td>
                    <td><Link href={`/finance/periods/${r.period.id}`} className="text-teal-ink hover:underline">{r.period.period}</Link></td>
                    <td className="text-xs">{r.source === "STATEMENT" ? "ekstre" : r.source === "IMPORT" ? "içe aktarma" : "elle"}{r.sourceRef ? ` · ${r.sourceRef}` : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))
      )}
    </section>
  );
}
