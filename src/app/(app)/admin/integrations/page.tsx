import Link from "next/link";
import { requirePage } from "@/server/auth/rbac";
import { db } from "@/server/db";
import { iysMode } from "@/server/messaging/iys";
import { phoneCheckApproval, phoneCheckMode } from "@/server/telephony/phone-validation";
import { transferAssessment } from "@/server/services/whatsapp";
import { FinanceForm } from "@/components/finance-form";
import { phoneApprovalAction } from "./actions";

export const dynamic = "force-dynamic";

const MODE: Record<string, string> = { none: "bağlı değil", http: "bağlı (HTTP)", mock: "sahte sağlayıcı (yalnız geliştirme)" };
const t = (d: Date | null) => (d ? d.toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Istanbul" }) : "—");

export default async function IntegrationsPage() {
  await requirePage("integration.manage");
  const [iysCounts, outbox, q24, pc, wa] = await Promise.all([
    db.iysOutbox.groupBy({ by: ["status"], _count: true }),
    db.iysOutbox.findMany({ where: { status: { in: ["PENDING", "FAILED"] } }, orderBy: { createdAt: "asc" }, take: 50 }),
    db.iysQueryLog.groupBy({ by: ["result"], where: { at: { gte: new Date(Date.now() - 86_400_000) } }, _count: true }),
    phoneCheckApproval(),
    transferAssessment(),
  ]);
  const guests = new Map((await db.guest.findMany({ where: { id: { in: outbox.map((o) => o.guestId) } }, select: { id: true, crmNo: true } })).map((g) => [g.id, g.crmNo]));
  const cnt = Object.fromEntries(iysCounts.map((c) => [c.status, c._count])) as Record<string, number>;
  const qc = Object.fromEntries(q24.map((c) => [c.result, c._count])) as Record<string, number>;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="eyebrow">YÖNETİM · ENTEGRASYONLAR</p>
        <h1 className="page-title">Dış servisler</h1>
        <p className="mt-1 text-sm text-muted">Sağlayıcı anahtarları ortam değişkenlerindedir ve ekranda gösterilmez. Her dış servis, veri aktarımı onaylanmadan veya bağlantı kurulmadan güvenli varsayılanla çalışır (gönderim yok).</p>
      </div>

      <section className="card" data-testid="iys">
        <h2 className="card-title">İYS — İleti Yönetim Sistemi</h2>
        <p className="text-sm">Durum: <b>{MODE[iysMode()]}</b>. Bağlı değilken Türkiye numaralarına SMS ve WhatsApp gönderilmez; retler aşağıdaki listede bekler.</p>
        <p className="mt-1 text-sm">Son 24 saat sorgu: onay {qc.ONAY ?? 0} · ret {qc.RET ?? 0} · yanıtsız {qc.UNAVAILABLE ?? 0}</p>
        <p className="mt-1 text-sm">Ret bildirimi: bekleyen <b data-testid="iys-pending">{cnt.PENDING ?? 0}</b> · gönderilen {cnt.SENT ?? 0} · hatalı {cnt.FAILED ?? 0}</p>
        {outbox.length > 0 && (
          <table className="table-ink mt-3">
            <thead><tr><th>Misafir</th><th>Tür</th><th>Durum</th><th>Deneme</th><th>Oluşma</th></tr></thead>
            <tbody>
              {outbox.map((o) => (
                <tr key={o.id}>
                  <td>CRM-{String(guests.get(o.guestId) ?? 0).padStart(6, "0")}</td>
                  <td>{o.type === "MESAJ" ? "Mesaj" : "Arama"}</td>
                  <td>{o.status === "PENDING" ? "Bekliyor" : "Hatalı"}{o.error ? ` · ${o.error}` : ""}</td>
                  <td className="tabular-nums">{o.attempts}</td>
                  <td>{t(o.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card" data-testid="phone-check">
        <h2 className="card-title">Telefon doğrulama (hat durumu)</h2>
        <p className="text-sm">Durum: <b>{MODE[phoneCheckMode()]}</b>. Sonuç “aktif” kesinliği değildir; kaynak, tarih ve güven düzeyiyle kanıt olarak saklanır. Ulaşılabilirlik durumunu değiştirmez.</p>
        {pc.approvedAt ? (
          <p className="mt-1 text-sm text-teal-ink">Güvenlik ve hukuk incelemesi: {pc.approvedAt} · {pc.approvedBy} · belge {pc.documentRef}</p>
        ) : (
          <div className="mt-3">
            <p className="text-sm text-warn-ink">Numaralar dış servise yalnız güvenlik ve hukuk incelemesi kaydı girildikten sonra gönderilir.</p>
            <div className="mt-2"><FinanceForm action={phoneApprovalAction} submit="Onayı kaydet" inline fields={[{ name: "approvedAt", label: "İnceleme tarihi", type: "date", required: true }, { name: "documentRef", label: "Belge referansı", required: true }, { name: "reason", label: "Gerekçe", required: true }]} /></div>
          </div>
        )}
      </section>

      <section className="card">
        <h2 className="card-title">WhatsApp Business</h2>
        <p className="text-sm">{wa.assessedAt ? `Yurt dışı aktarım değerlendirmesi ${wa.assessedAt} · ${wa.approvedBy}. Kanal açık.` : "Kanal kapalı: yurt dışı aktarım değerlendirmesi yok."} <Link href="/messages/whatsapp" className="text-teal-ink underline">WhatsApp şablonları</Link></p>
      </section>
    </div>
  );
}
