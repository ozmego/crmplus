import Link from "next/link";
import { can, requirePage, requireUser } from "@/server/auth/rbac";
import { db } from "@/server/db";
import { transferAssessment } from "@/server/services/whatsapp";
import { FinanceForm } from "@/components/finance-form";
import { ALLOWED_VARS } from "@/lib/sms";
import { approveWaTemplateAction, createWaTemplateAction, transferAction } from "@/app/(app)/inbox/actions";

export const dynamic = "force-dynamic";

const META: Record<string, string> = { DRAFT: "Taslak (iç onay bekliyor)", PENDING: "Meta onayında", APPROVED: "Onaylı", REJECTED: "Reddedildi", PAUSED: "Duraklatıldı" };

export default async function WaTemplatesPage() {
  // Kampanya hazırlayanlar katalog için, sistem yöneticisi (integration.manage) kanal kapısı için girer
  const user = await requirePage(can(await requireUser(), "integration.manage") ? "integration.manage" : "message.campaign.prepare");
  const [templates, ta] = await Promise.all([db.waTemplate.findMany({ orderBy: [{ name: "asc" }, { version: "desc" }] }), transferAssessment()]);
  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="eyebrow">MESAJLAR · WHATSAPP</p>
        <h1 className="page-title">WhatsApp şablon kataloğu</h1>
        <p className="mt-1 text-sm text-muted">
          Resmi Business Platform; kişisel hesap otomasyonu yok. Pencere dışında yalnız Meta’da onaylı şablon gönderilir. Pazarlama şablonunda “Aboneliği iptal et” düğmesi zorunlu. Fiziksel casino/etkinlik bilgilendirmesi yapılır; çevrimiçi kumar tanıtımı yapılmaz.{" "}
          <Link href="/inbox" className="font-semibold text-teal-ink underline">Gelen kutusu</Link> · <Link href="/messages" className="text-teal-ink underline">SMS</Link>
        </p>
      </div>

      <section className={ta.assessedAt ? "callout-info" : "callout-warn"} data-testid="transfer">
        {ta.assessedAt ? (
          <>KVKK yurt dışı aktarım değerlendirmesi: {ta.assessedAt} · {ta.approvedBy} · belge {ta.documentRef}. Kanal açık.</>
        ) : (
          <>WhatsApp kanalı <b>kapalı</b>: Meta’ya (yurt dışı) veri aktarımı için KVKK değerlendirmesi kaydı girilmeden açılmaz (docs/10 §7).</>
        )}
        {!ta.assessedAt && can(user, "integration.manage") && (
          <div className="mt-3">
            <FinanceForm action={transferAction} submit="Değerlendirmeyi kaydet" inline fields={[{ name: "assessedAt", label: "Değerlendirme tarihi", type: "date", required: true }, { name: "documentRef", label: "Belge referansı", required: true }, { name: "reason", label: "Gerekçe", required: true }]} />
          </div>
        )}
      </section>

      {can(user, "message.template.manage") && (
        <section className="card">
          <h2 className="card-title">Yeni şablon / yeni sürüm</h2>
          <FinanceForm
            action={createWaTemplateAction}
            submit="Taslağı kaydet"
            fields={[
              { name: "name", label: "Meta şablon adı", required: true, placeholder: "kasim_gezisi_hatirlatma" },
              { name: "language", label: "Dil", type: "select", defaultValue: "tr", options: [{ value: "tr", label: "Türkçe" }, { value: "en", label: "İngilizce" }, { value: "de", label: "Almanca" }, { value: "ru", label: "Rusça" }] },
              { name: "category", label: "Kategori", type: "select", required: true, defaultValue: "UTILITY", options: [{ value: "UTILITY", label: "Bilgilendirme (UTILITY)" }, { value: "MARKETING", label: "Pazarlama (MARKETING)" }] },
              { name: "optOutButton", label: "“Aboneliği iptal et” düğmesi", type: "select", defaultValue: "0", options: [{ value: "0", label: "Yok" }, { value: "1", label: "Var" }] },
              { name: "variables", label: `Değişkenler sırayla ({{1}}, {{2}}…): ${ALLOWED_VARS.join(", ")}`, placeholder: "ad, temsilci_adi" },
              { name: "body", label: "Metin", type: "textarea", required: true, rows: 3, placeholder: "Merhaba {{1}}, temsilciniz {{2}} programı paylaşacak." },
            ]}
          />
        </section>
      )}

      <section className="card bg-white">
        <table className="table-ink" data-testid="wa-templates">
          <thead><tr><th>Ad</th><th>Sürüm</th><th>Dil</th><th>Kategori</th><th>Metin</th><th>Durum</th><th></th></tr></thead>
          <tbody>
            {templates.map((x) => (
              <tr key={x.id}>
                <td className="font-semibold">{x.name}</td>
                <td>v{x.version}</td>
                <td>{x.language}</td>
                <td>{x.category === "MARKETING" ? "Pazarlama" : "Bilgilendirme"}{x.optOutButton ? " · iptal düğmesi" : ""}</td>
                <td className="max-w-md whitespace-pre-wrap">{x.body}<span className="block text-xs text-muted">{x.variables.map((v, i) => `{{${i + 1}}}=${v}`).join(" · ")}</span></td>
                <td><span className="pill">{META[x.metaStatus]}</span></td>
                <td>
                  {x.metaStatus === "DRAFT" && can(user, "message.campaign.approve") && x.createdBy !== user.id && (
                    <FinanceForm action={approveWaTemplateAction} submit="Onayla ve Meta’ya gönder" tone="secondary" inline fields={[{ name: "id", type: "hidden", value: x.id }]} />
                  )}
                </td>
              </tr>
            ))}
            {templates.length === 0 && <tr><td colSpan={7} className="text-muted">Şablon yok.</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  );
}
