import Link from "next/link";
import { notFound } from "next/navigation";
import { can, requirePage } from "@/server/auth/rbac";
import { getGuestCard } from "@/server/services/guests";
import { ConsentBadge, PhoneStateBadge } from "@/components/badges";
import { BlockForm, ConsentEditor, RevealPhone } from "@/components/guest-actions";
import { FinanceForm } from "@/components/finance-form";
import { db } from "@/server/db";
import { sendSingleAction } from "@/app/(app)/messages/actions";

export const dynamic = "force-dynamic";

const CHANNEL_LABEL: Record<string, string> = { CALL: "Arama", SMS: "SMS", WHATSAPP: "WhatsApp", EMAIL: "E-posta", RECORDING: "Görüşme kaydı", VISIT: "Saha ziyareti", NOTE: "Not", IMPORT: "İçe aktarma" };
const fmt = (d: Date | null | undefined) => (d ? d.toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Istanbul" }) : "—");

export default async function GuestCardPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePage("guest.view");
  const { id } = await params;
  const g = await getGuestCard(user, id);
  if (!g) notFound();
  const activeBlocks = g.blocks.filter((b) => !b.removedAt);
  const consentByChannel = new Map(g.consents.map((c) => [c.channel, c]));
  const canGrant = can(user, "consent.edit");
  const smsTemplates = can(user, "message.send.single") ? await db.messageTemplate.findMany({ where: { status: "APPROVED", channel: "SMS" }, orderBy: { name: "asc" }, select: { id: true, name: true, category: true } }) : [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">MİSAFİR · CRM-{String(g.crmNo).padStart(6, "0")}</p>
          <h1 className="page-title text-3xl">{g.firstName} {g.lastName}</h1>
          <p className="mt-1 text-sm text-muted">
            {g.language.toUpperCase()} · {g.timezone}{g.country ? ` · ${g.country}` : ""}{g.city ? ` · ${g.city}` : ""}
            {g.vipLevel ? ` · ${g.vipLevel}` : ""} · Sahip: {g.owner?.name ?? "atanmamış"}
          </p>
        </div>
        {can(user, "block.create") && activeBlocks.length === 0 && <BlockForm guestId={g.id} />}
      </div>

      {activeBlocks.length > 0 && (
        <p className="callout-critical">
          <b>İletişim durduruldu</b> · {activeBlocks.map((b) => `${b.allChannels ? "tüm kanallar" : CHANNEL_LABEL[b.channel ?? ""]} (talep: ${fmt(b.requestedAt)})`).join(", ")}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card">
          <h2 className="card-title">İletişim bilgileri</h2>
          <ul className="flex flex-col gap-3">
            {g.phones.map((p) => (
              <li key={p.id} className="flex flex-col gap-1 border-b border-line pb-3 last:border-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono">{p.masked}</span>
                  {p.isPrimary && <span className="pill border-ink text-ink">Birincil</span>}
                  {p.ownership === "DISPUTED" && <span className="pill border-critical text-critical">Tartışmalı (yanlış kişi)</span>}
                  {can(user, "field.contact.full") && <RevealPhone phoneId={p.id} />}
                </div>
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
          {g.externalIds.length > 0 && (
            <p className="mt-3 text-xs text-muted">Dış kimlikler: {g.externalIds.map((x) => `${x.source}: ${x.value}`).join(" · ")}</p>
          )}
          {smsTemplates.length > 0 && g.phones.length > 0 && (
            <details className="mt-4">
              <summary className="cursor-pointer text-sm font-semibold text-teal-ink">Şablonlu SMS gönder</summary>
              <p className="mt-1 text-xs text-muted">SMS izni, durdurma kaydı ve İYS kontrolü gönderim anında yapılır.</p>
              <div className="mt-2">
                <FinanceForm action={sendSingleAction} submit="Gönder" inline fields={[{ name: "guestId", type: "hidden", value: g.id }, { name: "templateId", label: "Onaylı şablon", type: "select", required: true, options: smsTemplates.map((t) => ({ value: t.id, label: `${t.name} (${t.category === "MARKETING" ? "pazarlama" : "bilgilendirme"})` })) }]} />
              </div>
            </details>
          )}
        </section>

        <section className="card">
          <h2 className="card-title">İletişim izinleri</h2>
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
        <section className="card">
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

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card">
          <h2 className="card-title">İletişim geçmişi</h2>
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

        <section className="card">
          <h2 className="card-title">Değişiklik geçmişi</h2>
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
                      <td>
                        {h.importBatchId ? <Link className="text-teal-ink hover:underline" href={`/imports/${h.importBatchId}`}>import</Link> : h.sourceId ?? "manuel"}
                      </td>
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
        <section className="card">
          <h2 className="card-title">Notlar</h2>
          <ul className="flex flex-col gap-2 text-sm">
            {g.notes.map((n) => (
              <li key={n.id}><span className="text-xs text-muted">{fmt(n.createdAt)}</span> · {n.body}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
