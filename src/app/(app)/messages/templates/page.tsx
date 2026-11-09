import Link from "next/link";
import { can, requirePage } from "@/server/auth/rbac";
import { db } from "@/server/db";
import { optOutText } from "@/server/messaging/provider";
import { FinanceForm } from "@/components/finance-form";
import { SmsTemplateEditor } from "@/components/sms-template-editor";
import { approveTemplateAction, createTemplateAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function TemplatesPage() {
  const user = await requirePage("message.campaign.prepare");
  const templates = await db.messageTemplate.findMany({ orderBy: { createdAt: "desc" }, take: 200 });
  const users = new Map((await db.user.findMany({ where: { id: { in: templates.flatMap((t) => [t.createdBy, t.approvedBy ?? ""]) } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="eyebrow">MESAJLAR · ŞABLONLAR</p>
        <h1 className="page-title">SMS şablonları</h1>
        <p className="mt-1 text-sm text-muted">
          Şablonu hazırlayan onaylayamaz. Kayıp/kazanç, komisyon veya kimlik bilgisi içeren değişken reddedilir. <Link href="/messages" className="text-teal-ink underline">Kampanyalara dön</Link>
        </p>
      </div>
      {can(user, "message.template.manage") && (
        <section className="card">
          <h2 className="card-title">Yeni şablon</h2>
          <SmsTemplateEditor action={createTemplateAction} optOut={optOutText()} />
        </section>
      )}
      <section className="card bg-white">
        <h2 className="card-title">Şablonlar</h2>
        {templates.length === 0 && <p className="text-sm text-muted">Henüz şablon yok.</p>}
        <ul className="flex flex-col gap-3">
          {templates.map((t) => (
            <li key={t.id} className="rounded-md border border-line p-3 text-sm" data-testid="template-row">
              <p className="font-semibold">
                {t.name} · <span className="pill">{t.category === "MARKETING" ? "Pazarlama" : "Bilgilendirme"}</span>{" "}
                <span className="pill">{t.status === "APPROVED" ? "Onaylı" : t.status === "DRAFT" ? "Taslak" : "Arşiv"}</span>
              </p>
              <p className="mt-1 whitespace-pre-wrap">{t.body}</p>
              {t.warnings.map((w) => <p key={w} className="text-xs text-warn-ink">⚠ {w}</p>)}
              <p className="mt-1 text-xs text-muted">
                Hazırlayan: {users.get(t.createdBy) ?? "—"}
                {t.approvedBy && ` · Onaylayan: ${users.get(t.approvedBy) ?? "—"}`}
              </p>
              {t.status === "DRAFT" && can(user, "message.campaign.approve") && t.createdBy !== user.id && (
                <div className="mt-2">
                  <FinanceForm action={approveTemplateAction} submit="Şablonu onayla" tone="secondary" inline fields={[{ name: "id", type: "hidden", value: t.id }]} />
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
