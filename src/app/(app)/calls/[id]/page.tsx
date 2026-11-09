import Link from "next/link";
import { notFound } from "next/navigation";
import { can, requirePage } from "@/server/auth/rbac";
import { db } from "@/server/db";
import { getCallDetail } from "@/server/services/call-detail";
import { activeGrant } from "@/server/services/recordings";
import { gateOpen, getRecordingGate } from "@/server/services/settings";
import { AnalysisReview, ListenPanel, TranscriptView } from "@/components/call-detail";
import type { ProcessFlag, SuggestedAction } from "@/lib/speech-analysis";

export const dynamic = "force-dynamic";

const TOPIC: Record<string, string> = {
  TRIP_INTEREST: "Trip ilgisi", OFFER_PRICE: "Teklif/fiyat", RESERVATION: "Rezervasyon", COMPLAINT: "Şikâyet",
  CALLBACK_REQUEST: "Geri arama talebi", WRONG_PERSON: "Yanlış kişi", NOT_INTERESTED: "İlgisiz",
};
const REC: Record<string, string> = {
  PENDING_FETCH: "Santralden alınıyor", STORED: "Şifreli saklanıyor", FAILED: "Alınamadı", DISCARDED: "Saklanmadı", DELETED: "Saklama süresi doldu, silindi",
};
const DISCARD: Record<string, string> = { GATE_CLOSED: "karar kapısı onaylanmadığı için", GUEST_DECLINED: "misafir kayıt istemediği için" };
const fmt = (d: Date | null | undefined) => (d ? d.toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" }) : "—");

export default async function CallDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePage("call.view");
  const { id } = await params;
  const d = await getCallDetail(user, id);
  if (!d) notFound();
  const { call, recording, transcript } = d;
  const [gate, grant, disp] = await Promise.all([
    getRecordingGate(),
    can(user, "recording.listen") ? activeGrant(user.id, id) : null,
    call.disposition ? db.disposition.findUnique({ where: { code: call.disposition } }) : null,
  ]);
  const a = transcript?.analysis;
  const flags = (a?.processFlags as unknown as ProcessFlag[]) ?? [];
  const actions = (a?.actions as unknown as SuggestedAction[]) ?? [];

  return (
    <div className="flex flex-col gap-5">
      <Link href="/calls" className="text-sm text-teal-ink hover:underline">‹ Çağrılar</Link>
      <div>
        <p className="eyebrow">ÇAĞRI · {fmt(call.startedAt)}</p>
        <h1 className="page-title">
          {call.guest.firstName} {call.guest.lastName} <span className="text-base font-normal text-muted">CRM-{String(call.guest.crmNo).padStart(6, "0")}</span>
        </h1>
        <p className="text-sm text-muted">
          Temsilci {call.agent.name} · sonuç: {disp?.labelTr ?? "—"} · konuşma {call.talkSec ?? 0} sn · {call.provider === "manual" ? "manuel mod" : `santral (${call.provider})`}
          {call.autoClosed ? " · otomatik kapatıldı" : ""} · kayıt bildirimi: {call.recordingNotice ? "yapıldı" : "işaretlenmedi"}{call.recordingPreference === "DECLINED" ? " · misafir kayıt istemedi" : ""}
        </p>
      </div>

      {!gateOpen(gate) && <p className="callout-warn">Karar kapısı onaylanmadı: görüşme kayıtları saklanmıyor ve analiz yapılmıyor (Yönetim › Ayarlar).</p>}

      <section className="card bg-white">
        <h2 className="card-title">Ses kaydı</h2>
        {!recording ? (
          <p className="text-sm text-muted">Bu çağrı için kayıt yok.</p>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-sm">
              {REC[recording.status]}{recording.discardReason ? ` (${DISCARD[recording.discardReason] ?? recording.discardReason})` : ""}
              {recording.status === "STORED" && ` · süre ${recording.durationSec ?? "?"} sn · saklama sonu ${fmt(recording.retentionUntil)}`}
            </p>
            {recording.status === "STORED" && can(user, "recording.listen") && <ListenPanel callId={call.id} hasGrant={!!grant} expiresAt={grant?.expiresAt.toISOString()} />}
            {recording.status === "STORED" && !can(user, "recording.listen") && <p className="text-xs text-muted">Kayıt dinleme yetkiniz yok.</p>}
          </div>
        )}
      </section>

      {transcript && (
        <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
          <section className="card bg-white">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="card-title">Türkçe transkript (maskelenmiş)</h2>
              <span className="text-xs text-muted">
                {transcript.model} · güven {transcript.confidence !== null ? `%${Math.round(transcript.confidence * 100)}` : "—"}
                {transcript.redactedKinds.length ? ` · maskelenen: ${transcript.redactedKinds.join(", ")}` : ""}
              </span>
            </div>
            {transcript.status === "LOW_CONFIDENCE" && <p className="callout-warn mb-3">Düşük güvenli transkript: insan incelemesi gerekli.</p>}
            {transcript.status === "FAILED" && <p className="callout-critical">Transkript üretilemedi: {transcript.error}</p>}
            {(transcript.status === "QUEUED" || transcript.status === "PROCESSING") && <p className="text-sm text-muted">Transkript hazırlanıyor…</p>}
            {transcript.segments && (
              <TranscriptView callId={call.id} segments={transcript.segments as unknown as { speaker: string; start: number; text: string }[]} canEdit={can(user, "transcript.edit")} />
            )}
            {transcript.edits.length > 0 && <p className="mt-2 text-xs text-muted">{transcript.edits.length} insan düzeltmesi (doğruluk ölçümüne girer).</p>}
          </section>

          {a && (
            <section className="card bg-white">
              <h2 className="card-title">Analiz önerisi</h2>
              <p className="mb-2 text-xs text-muted">Öneridir; onay, düzeltme veya itiraz bir kişi tarafından verilir. Duygu, kişilik veya skor üretilmez. Model: {a.model} ({a.modelVersion})</p>
              <p className="text-sm">{a.summary}</p>
              {a.topics.length > 0 && <div className="mt-2 flex flex-wrap gap-1">{a.topics.map((t) => <span key={t} className="pill border-line">{TOPIC[t] ?? t}</span>)}</div>}
              {actions.length > 0 && (
                <ul className="mt-3 list-disc pl-5 text-sm">
                  {actions.map((x, i) => <li key={i}>{x.type === "CALLBACK" ? "Geri arama" : "Takip"}{x.at ? ` · ${fmt(new Date(x.at))}` : " · zaman belirsiz"}</li>)}
                </ul>
              )}
              {flags.length > 0 && (
                <ul className="mt-3 flex flex-col gap-1">
                  {flags.map((f, i) => (
                    <li key={i} className={f.severity === "critical" ? "callout-critical" : f.severity === "warning" ? "callout-warn" : "callout-info"}>
                      {f.message}{f.evidence ? <span className="block text-xs opacity-80">“{f.evidence}”</span> : null}
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-2 text-xs text-muted">
                İnceleme: {{ PENDING: "bekliyor", APPROVED: "onaylandı", CORRECTED: "düzeltildi", DISPUTED: "itiraz edildi" }[a.reviewStatus]}
                {a.reviews[0]?.comment ? ` · “${a.reviews[0].comment}”` : ""}
              </p>
              {can(user, "analysis.review") && <AnalysisReview callId={call.id} summary={a.summary} topics={a.topics} status={a.reviewStatus} />}
            </section>
          )}
        </div>
      )}
    </div>
  );
}
