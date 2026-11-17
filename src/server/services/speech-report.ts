import "server-only";
import { db } from "@/server/db";
import { percentile, ratio, wordErrorRate } from "@/lib/speech-metrics";

/**
 * Ses analizi raporları ve analiz doğruluk paneli (docs/05 §7a). Yalnız toplulaştırılmış göstergeler;
 * kişi bazlı içerik yok, temsilci sıralaması yok.
 */
export async function speechReport(from: Date, to: Date, now = new Date()) {
  const range = { gte: from, lte: to };
  const [recStored, recDiscarded, recFailed, transcripts, analyses, reviews, pending, edits, segTotal, qa] = await Promise.all([
    db.recording.count({ where: { createdAt: range, status: { in: ["STORED", "DELETED"] } } }),
    db.recording.groupBy({ by: ["discardReason"], where: { createdAt: range, status: "DISCARDED" }, _count: true }),
    db.recording.count({ where: { createdAt: range, status: "FAILED" } }),
    db.transcript.groupBy({ by: ["status"], where: { createdAt: range }, _count: true }),
    db.callAnalysis.findMany({ where: { createdAt: range }, select: { topics: true, reviewStatus: true, dispositionMismatch: true } }),
    db.analysisReview.findMany({ where: { at: range }, select: { decision: true, changes: true } }),
    db.callAnalysis.findMany({ where: { reviewStatus: "PENDING" }, select: { createdAt: true } }),
    db.transcriptEdit.findMany({ where: { at: range }, select: { before: true, after: true, transcriptId: true } }),
    db.transcript.findMany({ where: { createdAt: range, status: { in: ["DONE", "LOW_CONFIDENCE"] } }, select: { segments: true } }),
    db.qaSample.groupBy({ by: ["status"], where: { createdAt: range }, _count: true }),
  ]);
  const tBy = Object.fromEntries(transcripts.map((t) => [t.status, t._count])) as Record<string, number>;
  const done = (tBy.DONE ?? 0) + (tBy.LOW_CONFIDENCE ?? 0);

  const topics = new Map<string, number>();
  for (const a of analyses) if (a.reviewStatus === "APPROVED" || a.reviewStatus === "CORRECTED") for (const t of a.topics) topics.set(t, (topics.get(t) ?? 0) + 1);

  // Takip aksiyonu tamamlanma: onaylanan öneriden oluşan geri aramalar
  const cbIds = reviews.flatMap((r) => ((r.changes as { callbacksCreated?: string[] } | null)?.callbacksCreated ?? []));
  const cbs = cbIds.length ? await db.callback.findMany({ where: { id: { in: cbIds } }, select: { status: true } }) : [];
  const ages = pending.map((p) => (now.getTime() - p.createdAt.getTime()) / 3_600_000);
  const totalSegments = segTotal.reduce((s, t) => s + (Array.isArray(t.segments) ? t.segments.length : 0), 0);

  return {
    recordings: { stored: recStored, failed: recFailed, discarded: Object.fromEntries(recDiscarded.map((d) => [d.discardReason ?? "—", d._count])) as Record<string, number> },
    transcriptRate: ratio(done, recStored),
    lowConfidenceRate: ratio(tBy.LOW_CONFIDENCE ?? 0, done),
    transcriptFailed: tBy.FAILED ?? 0,
    labelCorrectionRate: ratio(reviews.filter((r) => r.decision === "CORRECT").length, reviews.length),
    disputeRate: ratio(reviews.filter((r) => r.decision === "DISPUTE").length, reviews.length),
    reviewed: reviews.length,
    mismatchRate: ratio(analyses.filter((a) => a.dispositionMismatch).length, analyses.length),
    analyses: analyses.length,
    queue: { pending: pending.length, medianHours: percentile(ages, 50), p95Hours: percentile(ages, 95) },
    topics: [...topics.entries()].sort((a, b) => b[1] - a[1]),
    followUp: { created: cbs.length, done: cbs.filter((c) => c.status === "DONE").length, rate: ratio(cbs.filter((c) => c.status === "DONE").length, cbs.length) },
    wer: wordErrorRate(edits),
    editedSegments: edits.length,
    editedTranscripts: new Set(edits.map((e) => e.transcriptId)).size,
    totalSegments,
    qa: Object.fromEntries(qa.map((q) => [q.status, q._count])) as Record<string, number>,
  };
}
