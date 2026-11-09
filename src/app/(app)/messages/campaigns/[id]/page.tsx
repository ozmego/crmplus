import Link from "next/link";
import { notFound } from "next/navigation";
import { can, requirePage } from "@/server/auth/rbac";
import { db } from "@/server/db";
import { EXCLUSION_LABEL_TR, type ExclusionReason } from "@/server/services/messaging";
import { FinanceForm } from "@/components/finance-form";
import { AutoRefresh } from "@/components/auto-refresh";
import { CampaignApprove } from "@/components/campaign-approve";
import { CAMPAIGN_STATUS } from "@/lib/sms";
import { campaignAction } from "../../actions";

export const dynamic = "force-dynamic";

type Estimate = {
  total: number; eligible: number; excluded: Partial<Record<ExclusionReason, number>>; segmentsPerMessage: number;
  estimatedCost: number; unitCost: number; preview: string[]; computedAt: string;
};
type Segment = { languages?: string[]; countries?: string[]; tags?: string[]; lastContactBeforeDays?: number };

const fmt = (d: Date | null) => (d ? d.toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" }) : "—");

export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePage("message.campaign.prepare");
  const { id } = await params;
  const c = await db.messageCampaign.findUnique({ where: { id } });
  if (!c) notFound();
  const [tpl, tests, counts, people] = await Promise.all([
    db.messageTemplate.findUnique({ where: { id: c.templateId } }),
    db.message.findMany({ where: { campaignId: id, isTest: true }, orderBy: { createdAt: "desc" }, take: 5 }),
    db.message.groupBy({ by: ["status"], where: { campaignId: id, isTest: false }, _count: true }),
    db.user.findMany({ where: { id: { in: [c.preparedBy, c.approvedBy ?? ""] } }, select: { id: true, name: true } }),
  ]);
  const name = new Map(people.map((p) => [p.id, p.name]));
  const est = c.estimate as Estimate | null;
  const seg = c.segment as Segment;
  const isPreparer = c.preparedBy === user.id;
  const id_ = { name: "id", type: "hidden" as const, value: c.id };
  const act = (a: string) => ({ name: "action", type: "hidden" as const, value: a });

  return (
    <div className="flex flex-col gap-6">
      {c.status === "SENDING" && <AutoRefresh seconds={3} />}
      <div>
        <p className="eyebrow">MESAJLAR · KAMPANYA</p>
        <h1 className="page-title">{c.name}</h1>
        <p className="mt-1 text-sm text-muted">
          <span className="pill" data-testid="campaign-status">{CAMPAIGN_STATUS[c.status]}</span> · {c.category === "MARKETING" ? "Pazarlama" : "Bilgilendirme"} · Hazırlayan: {name.get(c.preparedBy) ?? "—"}
          {c.approvedBy && ` · Onaylayan: ${name.get(c.approvedBy) ?? "—"} (${fmt(c.approvedAt)})`} · <Link href="/messages" className="text-teal-ink underline">Tüm kampanyalar</Link>
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card">
          <h2 className="card-title">1 · Segment ve izin</h2>
          <ul className="text-sm">
            <li>Dil: {seg.languages?.join(", ") || "tümü"}</li>
            <li>Ülke: {seg.countries?.join(", ") || "tümü"}</li>
            <li>Etiket: {seg.tags?.join(", ") || "—"}</li>
            <li>Son iletişimden bu yana en az: {seg.lastContactBeforeDays !== undefined ? `${seg.lastContactBeforeDays} gün` : "—"}</li>
          </ul>
          {est && (
            <div className="mt-3 text-sm">
              <p>
                Segmentte <b className="tabular-nums">{est.total}</b> misafir · uygun <b className="tabular-nums" data-testid="eligible-count">{est.eligible}</b> · hariç{" "}
                <b className="tabular-nums">{est.total - est.eligible}</b>
              </p>
              <ul className="mt-1 list-disc pl-5 text-muted">
                {Object.entries(est.excluded).map(([k, v]) => (
                  <li key={k}>{EXCLUSION_LABEL_TR[k as ExclusionReason] ?? k}: {v}</li>
                ))}
              </ul>
              <p className="mt-2">
                Mesaj başına {est.segmentsPerMessage} parça · tahmini maliyet <b className="tabular-nums">{est.estimatedCost.toLocaleString("tr-TR")} ₺</b> (parça başı {est.unitCost} ₺)
              </p>
              <p className="text-xs text-muted">Hesaplandı: {new Date(est.computedAt).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" })} · uygunluk gönderim anında yeniden kontrol edilir.</p>
            </div>
          )}
          {["DRAFT", "PENDING_APPROVAL", "APPROVED"].includes(c.status) && (
            <div className="mt-3"><FinanceForm action={campaignAction} submit="Önizlemeyi yenile" tone="secondary" inline fields={[id_, act("REFRESH")]} /></div>
          )}
        </section>

        <section className="card">
          <h2 className="card-title">2 · Şablon ve test</h2>
          <p className="whitespace-pre-wrap text-sm">{tpl?.body}</p>
          {est?.preview.length ? (
            <div className="mt-2 text-sm">
              <p className="label">Örnek alıcı önizlemesi</p>
              {est.preview.slice(0, 3).map((p, i) => <p key={i} className="rounded border border-line bg-white p-2">{p}</p>)}
            </div>
          ) : null}
          {c.status === "DRAFT" && isPreparer && (
            <div className="mt-3">
              <FinanceForm action={campaignAction} submit="Test gönder" tone="secondary" inline fields={[id_, act("TEST"), { name: "phone", label: "Test numarası", required: true, placeholder: "+49 151 …" }]} />
            </div>
          )}
          {tests.length > 0 && (
            <ul className="mt-2 text-xs text-muted" data-testid="test-sends">
              {tests.map((t) => <li key={t.id}>Test gönderildi · {fmt(t.sentAt)}</li>)}
            </ul>
          )}
        </section>
      </div>

      <section className="card">
        <h2 className="card-title">3 · Onay ve gönderim</h2>
        {c.status === "DRAFT" && isPreparer && (
          <FinanceForm action={campaignAction} submit="Onaya gönder" fields={[id_, act("SUBMIT")]} />
        )}
        {c.status === "PENDING_APPROVAL" && (
          isPreparer ? (
            <p className="text-sm text-muted">Onay bekleniyor. Hazırlayan kendi kampanyasını onaylayamaz.</p>
          ) : can(user, "message.campaign.approve") ? (
            <CampaignApprove id={c.id} />
          ) : (
            <p className="text-sm text-muted">Onay yetkiniz yok.</p>
          )
        )}
        {c.status === "APPROVED" && can(user, "message.campaign.approve") && (
          <FinanceForm action={campaignAction} submit="Gönderimi başlat" fields={[id_, act("START")]} />
        )}
        {(c.status === "SENDING" || c.status === "DONE" || c.status === "CANCELLED") && (
          <div className="text-sm">
            <p>Başlangıç: {fmt(c.startedAt)} · Bitiş: {fmt(c.finishedAt)}</p>
            <ul className="mt-1 flex flex-wrap gap-3" data-testid="send-stats">
              {counts.map((s) => <li key={s.status} className="pill">{s.status === "SENT" ? "Gönderildi" : s.status === "DELIVERED" ? "Teslim edildi" : s.status === "FAILED" ? "Başarısız" : s.status}: {s._count}</li>)}
            </ul>
            {c.cancelReason && <p className="mt-1 text-muted">İptal gerekçesi: {c.cancelReason}</p>}
          </div>
        )}
        {["DRAFT", "PENDING_APPROVAL", "APPROVED", "SENDING"].includes(c.status) && (
          <details className="mt-4">
            <summary className="cursor-pointer text-sm font-semibold text-critical">Kampanyayı iptal et</summary>
            <div className="mt-2"><FinanceForm action={campaignAction} submit="İptal et" tone="danger" inline fields={[id_, act("CANCEL"), { name: "reason", label: "Gerekçe", required: true }]} /></div>
          </details>
        )}
      </section>
    </div>
  );
}
