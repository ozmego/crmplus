import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser, scopeOf } from "@/server/auth/rbac";
import { getSample, QaError, type Criterion } from "@/server/services/qa";
import { FinanceForm } from "@/components/finance-form";
import { QaReviewForm } from "@/components/qa-review-form";
import { closeAction, respondAction } from "../actions";
import { QA_STATUS } from "@/lib/qa-labels";

export const dynamic = "force-dynamic";

const RES: Record<string, string> = { MET: "Karşılandı", NOT_MET: "Karşılanmadı", NA: "Uygulanmaz" };

export default async function QaSamplePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  let d;
  try {
    d = await getSample(user, id);
  } catch (e) {
    if (e instanceof QaError) notFound();
    throw e;
  }
  const { sample: s, call, analysis, criteriaSet, reviewers } = d;
  const reviewer = !!scopeOf(user, "qa.review") && s.agentId !== user.id;
  const isAgent = s.agentId === user.id;
  const last = s.reviews[0];
  const labelOf = new Map(((last?.criteriaSet.criteria ?? criteriaSet.criteria) as unknown as Criterion[]).map((c) => [c.key, c.label]));

  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="eyebrow">KALİTE ÖRNEKLEMİ</p>
        <h1 className="page-title">{call?.agent.name} · {call?.startedAt.toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Istanbul" })}</h1>
        <p className="mt-1 text-sm text-muted">
          <span className="pill" data-testid="qa-status">{QA_STATUS[s.status]}</span> · Sonuç kodu {call?.disposition ?? "—"} · {call?.talkSec ?? 0} sn ·{" "}
          <Link href={`/calls/${s.callId}`} className="text-teal-ink underline">Görüşme ayrıntısı (transkript, gerekçeli dinleme)</Link> · <Link href="/qa" className="text-teal-ink underline">Örneklem listesi</Link>
        </p>
      </div>

      {analysis && (
        <section className="card">
          <h2 className="card-title">Analiz önerisi (yalnız bilgi)</h2>
          <p className="text-sm">{analysis.summary}</p>
          <p className="mt-1 text-xs text-muted">Konular: {analysis.topics.join(", ") || "—"}{analysis.dispositionMismatch ? " · sonuç/özet uyuşmazlığı" : ""} · inceleme: {analysis.reviewStatus}</p>
        </section>
      )}

      {last && (
        <section className="card bg-white" data-testid="qa-review">
          <h2 className="card-title">İnceleme · {reviewers.get(last.reviewerId) ?? "—"} · {last.criteriaSet.name} v{last.criteriaSet.version}</h2>
          <ul className="text-sm">
            {(last.results as unknown as { key: string; result: string; note?: string }[]).map((r) => (
              <li key={r.key} className="border-b border-line py-1 last:border-0"><b>{labelOf.get(r.key) ?? r.key}</b>: {RES[r.result]}{r.note ? ` — ${r.note}` : ""}</li>
            ))}
          </ul>
          <p className="mt-3 whitespace-pre-wrap text-sm"><b>Koçluk notu:</b> {last.coachingNote}</p>
          {s.agentComment && <p className="mt-3 text-sm"><b>Personelin {s.status === "DISPUTED" || s.resolution ? "itirazı / açıklaması" : "açıklaması"}:</b> {s.agentComment}</p>}
          {s.resolution && <p className="mt-2 text-sm"><b>Sonuç:</b> {s.resolution}</p>}
        </section>
      )}

      {reviewer && ["OPEN", "REVIEWED"].includes(s.status) && (
        <section className="card">
          <h2 className="card-title">{s.status === "OPEN" ? "İncele" : "İncelemeyi güncelle"}</h2>
          <QaReviewForm id={s.id} criteria={criteriaSet.criteria as unknown as Criterion[]} />
        </section>
      )}

      {isAgent && s.status === "REVIEWED" && (
        <section className="card">
          <h2 className="card-title">Yanıtınız</h2>
          <p className="text-sm text-muted">İncelemeyi okuduğunuzu bildirebilir veya gerekçeyle itiraz edebilirsiniz. İtirazlar takım lideri tarafından yanıtlanır.</p>
          <div className="mt-3 flex flex-col gap-4">
            <FinanceForm action={respondAction} submit="Okudum" tone="secondary" fields={[{ name: "id", type: "hidden", value: s.id }, { name: "kind", type: "hidden", value: "ACK" }, { name: "comment", label: "Açıklama (isteğe bağlı)" }]} />
            <FinanceForm action={respondAction} submit="İtiraz et" tone="danger" fields={[{ name: "id", type: "hidden", value: s.id }, { name: "kind", type: "hidden", value: "DISPUTE" }, { name: "comment", label: "İtiraz gerekçesi", required: true }]} />
          </div>
        </section>
      )}

      {reviewer && ["ACKNOWLEDGED", "DISPUTED"].includes(s.status) && (
        <section className="card">
          <h2 className="card-title">{s.status === "DISPUTED" ? "İtirazı yanıtla ve kapat" : "Kapat"}</h2>
          <FinanceForm action={closeAction} submit="Kapat" fields={[{ name: "id", type: "hidden", value: s.id }, { name: "resolution", label: s.status === "DISPUTED" ? "İtiraz sonucu" : "Not (isteğe bağlı)", required: s.status === "DISPUTED" }]} />
        </section>
      )}
    </div>
  );
}
