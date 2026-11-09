import Link from "next/link";
import { can, requirePage } from "@/server/auth/rbac";
import { db } from "@/server/db";
import { FinanceForm } from "@/components/finance-form";
import { CAMPAIGN_STATUS } from "@/lib/sms";
import { createCampaignAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function MessagesPage() {
  const user = await requirePage("message.campaign.prepare");
  const [campaigns, templates] = await Promise.all([
    db.messageCampaign.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
    db.messageTemplate.findMany({ where: { status: "APPROVED" }, orderBy: { name: "asc" } }),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="eyebrow">MESAJLAR · SMS</p>
        <h1 className="page-title">SMS kampanyaları</h1>
        <p className="mt-1 text-sm text-muted">
          Kapılar: amaç ve kanal → segment ve izin → şablon ve test → iki kişili onay → gönderim. Segment yalnız dil, ülke, etiket ve son iletişim tarihiyle kurulur; finansal veri kullanılamaz.{" "}
          <Link href="/messages/templates" className="font-semibold text-teal-ink underline">Şablonlar</Link>
        </p>
      </div>

      <div className="rounded-md border-l-4 border-warn bg-warn-bg p-3 text-sm text-warn-ink">
        İYS bağlantısı Aşama 2’de kurulacak. O zamana kadar Türkiye numaralarına SMS gönderilmez; bu alıcılar “İYS bağlantısı yok” nedeniyle hariç tutulur.
      </div>

      {can(user, "message.campaign.prepare") && (
        <section className="card">
          <h2 className="card-title">Yeni kampanya taslağı</h2>
          {templates.length === 0 ? (
            <p className="text-sm text-muted">Önce onaylı bir şablon gerekir.</p>
          ) : (
            <FinanceForm
              action={createCampaignAction}
              submit="Taslağı oluştur ve önizle"
              fields={[
                { name: "name", label: "Kampanya adı", required: true },
                { name: "category", label: "Kategori", type: "select", required: true, defaultValue: "MARKETING", options: [{ value: "MARKETING", label: "Pazarlama" }, { value: "INFORMATIONAL", label: "Bilgilendirme" }] },
                { name: "templateId", label: "Onaylı şablon", type: "select", required: true, options: templates.map((t) => ({ value: t.id, label: `${t.name} (${t.category === "MARKETING" ? "pazarlama" : "bilgilendirme"})` })) },
                { name: "languages", label: "Dil (ör. tr, en)", placeholder: "boş = tümü" },
                { name: "countries", label: "Ülke kodu (ör. DE, GB)", placeholder: "boş = tümü" },
                { name: "tags", label: "Etiket", placeholder: "virgülle ayırın" },
                { name: "lastContactBeforeDays", label: "Son iletişimden bu yana en az (gün)", type: "number" },
              ]}
            />
          )}
        </section>
      )}

      <section className="card bg-white">
        <h2 className="card-title">Kampanyalar</h2>
        {campaigns.length === 0 ? (
          <p className="text-sm text-muted">Henüz kampanya yok.</p>
        ) : (
          <table className="table-ink w-full text-sm">
            <thead>
              <tr><th>Ad</th><th>Kategori</th><th>Durum</th><th>Uygun alıcı</th><th>Oluşturma</th></tr>
            </thead>
            <tbody>
              {campaigns.map((c) => {
                const est = c.estimate as { eligible?: number } | null;
                return (
                  <tr key={c.id}>
                    <td><Link href={`/messages/campaigns/${c.id}`} className="font-semibold text-teal-ink underline">{c.name}</Link></td>
                    <td>{c.category === "MARKETING" ? "Pazarlama" : "Bilgilendirme"}</td>
                    <td><span className="pill">{CAMPAIGN_STATUS[c.status]}</span></td>
                    <td className="tabular-nums">{est?.eligible ?? "—"}</td>
                    <td>{c.createdAt.toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" })}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
