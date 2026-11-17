import Link from "next/link";
import { notFound } from "next/navigation";
import { can, requirePage } from "@/server/auth/rbac";
import { conversationDetail, waTemplatesForSend, WaError } from "@/server/services/whatsapp";
import { FinanceForm } from "@/components/finance-form";
import { convAction, replyAction, sendTemplateInConvAction } from "../actions";

export const dynamic = "force-dynamic";

const STATUS: Record<string, string> = { SENT: "gönderildi", DELIVERED: "teslim edildi", READ: "okundu", FAILED: "başarısız", RECEIVED: "" };
const t = (d: Date | null) => (d ? d.toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Istanbul" }) : "—");

export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePage("inbox.view");
  const { id } = await params;
  let d;
  try {
    d = await conversationDetail(user, id);
  } catch (e) {
    if (e instanceof WaError) notFound();
    throw e;
  }
  const { conversation: c, guest, blocked, window, messages } = d;
  const templates = can(user, "message.send.single") && guest && !blocked ? await waTemplatesForSend() : [];
  const hid = [{ name: "id", type: "hidden" as const, value: c.id }];

  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="eyebrow">WHATSAPP · KONUŞMA</p>
        <h1 className="page-title">{guest ? `${guest.firstName} ${guest.lastName}` : "Eşleşmeyen numara"}</h1>
        <p className="mt-1 text-sm text-muted">
          {guest && <><Link href={`/guests/${guest.id}`} className="text-teal-ink underline">CRM-{String(guest.crmNo).padStart(6, "0")}</Link> · </>}
          Pencere: <b data-testid="window">{window.open ? `açık (${t(window.closesAt)}’e kadar)` : "kapalı — yalnız onaylı şablon"}</b> · {c.status === "OPEN" ? "açık" : "kapalı"} konuşma ·{" "}
          <Link href="/inbox" className="text-teal-ink underline">Gelen kutusu</Link>
        </p>
        {!guest && <p className="mt-1 text-xs text-muted">Numara tek bir misafirle eşleşmediği için konuşma misafire bağlanmadı (telefon tek başına kimlik değildir).</p>}
      </div>

      {blocked && <p className="callout-critical"><b>İletişim durduruldu</b> · bu misafire WhatsApp ile mesaj gönderilmez.</p>}
      {c.optOutSuspect && !blocked && (
        <div className="callout-warn flex flex-wrap items-center gap-3" data-testid="suspect">
          <span>Misafirin mesajı ret talebi olabilir. Doğrulayıp durdurma kaydı açın.</span>
          <FinanceForm action={convAction} submit="Durdurma kaydı aç" tone="danger" inline fields={[...hid, { name: "action", type: "hidden", value: "OPT_OUT" }]} />
          <FinanceForm action={convAction} submit="Ret değil" tone="secondary" inline fields={[...hid, { name: "action", type: "hidden", value: "DISMISS" }]} />
        </div>
      )}

      <section className="card bg-white">
        <ol className="flex flex-col gap-2" data-testid="thread">
          {messages.map((m) => (
            <li key={m.id} className={"max-w-[75%] rounded-lg border p-2 text-sm " + (m.direction === "IN" ? "self-start border-line bg-card" : "self-end border-teal bg-info-bg")}>
              <p className="whitespace-pre-wrap">{m.text}</p>
              <p className="mt-1 text-right text-[11px] text-muted">{t(m.at)}{m.template ? " · şablon" : ""}{m.direction === "OUT" && STATUS[m.status] ? ` · ${STATUS[m.status]}` : ""}</p>
            </li>
          ))}
          {messages.length === 0 && <li className="text-muted">Mesaj yok.</li>}
        </ol>
      </section>

      {c.status === "OPEN" && !blocked && (
        <section className="card">
          {window.open && can(user, "message.reply") ? (
            <FinanceForm action={replyAction} submit="Gönder" fields={[...hid, { name: "text", label: "Yanıt", type: "textarea", required: true, rows: 3 }]} />
          ) : (
            <p className="text-sm text-muted">24 saat penceresi kapalı; serbest mesaj gönderilemez.</p>
          )}
          {guest && templates.length > 0 && (
            <div className="mt-4">
              <FinanceForm action={sendTemplateInConvAction} submit="Şablon gönder" tone="secondary" inline fields={[{ name: "guestId", type: "hidden", value: guest.id }, { name: "templateId", label: "Onaylı şablon", type: "select", required: true, options: templates.map((x) => ({ value: x.id, label: `${x.name} (${x.language}, ${x.category === "MARKETING" ? "pazarlama" : "bilgilendirme"})` })) }]} />
            </div>
          )}
        </section>
      )}

      <section className="flex flex-wrap gap-2">
        {c.assigneeId !== user.id && <FinanceForm action={convAction} submit="Bana ata" tone="secondary" inline fields={[...hid, { name: "action", type: "hidden", value: "TAKE" }]} />}
        {c.assigneeId === user.id && <FinanceForm action={convAction} submit="Atamayı bırak" tone="secondary" inline fields={[...hid, { name: "action", type: "hidden", value: "RELEASE" }]} />}
        {c.status === "OPEN" && <FinanceForm action={convAction} submit="Konuşmayı kapat" tone="secondary" inline fields={[...hid, { name: "action", type: "hidden", value: "CLOSE" }]} />}
      </section>
    </div>
  );
}
