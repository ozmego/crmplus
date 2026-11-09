import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { can, userScopeWhere, type Principal } from "@/server/auth/rbac";
import { audit, logAccess } from "@/server/audit";
import { removeObject } from "@/server/storage";
import { redactSensitive } from "@/lib/redact";
import type { Segment, SuggestedAction } from "@/lib/speech-analysis";

/**
 * Çağrı detayı, kayıt tercihi, transkript düzeltme ve analiz incelemesi (plan v4 §4–5).
 * Kapsam: call.view → own (kendi çağrıları) / team / all. Finansal veri okunmaz.
 */

export class CallDetailError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

export function callScopeWhere(user: Principal): Prisma.CallWhereInput {
  return { agent: userScopeWhere(user, "call.view") };
}

export async function getCallDetail(user: Principal, callId: string) {
  const call = await db.call.findFirst({
    where: { AND: [{ id: callId }, callScopeWhere(user)] },
    select: {
      id: true, startedAt: true, answeredAt: true, endedAt: true, talkSec: true, ringSec: true, disposition: true, provider: true,
      recordingNotice: true, recordingPreference: true, autoClosed: true,
      agent: { select: { id: true, name: true } },
      guest: { select: { id: true, crmNo: true, firstName: true, lastName: true } },
    },
  });
  if (!call) return null;
  const [recording, transcript] = await Promise.all([
    db.recording.findUnique({ where: { callId }, select: { id: true, status: true, discardReason: true, durationSec: true, retentionUntil: true, storedAt: true, mimeType: true } }),
    can(user, "transcript.view")
      ? db.transcript.findUnique({
          where: { callId },
          select: {
            id: true, status: true, language: true, model: true, modelVersion: true, confidence: true, segments: true, redactedKinds: true, completedAt: true, error: true,
            edits: { orderBy: { at: "desc" }, take: 20 },
            analysis: { include: { reviews: { orderBy: { at: "desc" } } } },
          },
        })
      : null,
  ]);
  await logAccess({ actorId: user.id, action: "view", resource: "Call", resourceId: callId });
  return { call, recording, transcript };
}

/** Çağrı sırasında: kayıt bildirimi yapıldı / misafir kayıt istemiyor (yalnız kendi açık çağrısı). */
export async function setRecordingPreference(user: Principal, callId: string, pref: "NOTICE_GIVEN" | "DECLINED") {
  const call = await db.call.findFirst({ where: { id: callId, agentId: user.id } });
  if (!call) throw new CallDetailError("NOT_FOUND");
  if (pref === "NOTICE_GIVEN") {
    await db.call.update({ where: { id: callId }, data: { recordingNotice: true, recordingPreference: call.recordingPreference === "DECLINED" ? "DECLINED" : "ACCEPTED" } });
    await audit({ actorId: user.id, action: "call.recording_notice", entity: "Call", entityId: callId });
    return;
  }
  const now = new Date();
  await db.$transaction(async (tx) => {
    await tx.call.update({ where: { id: callId }, data: { recordingNotice: true, recordingPreference: "DECLINED" } });
    const prev = await tx.consentRecord.findUnique({ where: { guestId_channel: { guestId: call.guestId, channel: "RECORDING" } } });
    await tx.consentRecord.upsert({
      where: { guestId_channel: { guestId: call.guestId, channel: "RECORDING" } },
      update: { status: "DENIED", deniedAt: now, source: "Çağrıda misafir talebi", sourceSystem: "CRM", proofRef: `call:${callId}`, updatedBy: user.id },
      create: { guestId: call.guestId, channel: "RECORDING", status: "DENIED", deniedAt: now, source: "Çağrıda misafir talebi", sourceSystem: "CRM", proofRef: `call:${callId}`, updatedBy: user.id },
    });
    await tx.consentHistory.create({ data: { guestId: call.guestId, channel: "RECORDING", oldStatus: prev?.status ?? null, newStatus: "DENIED", source: `call:${callId}`, actorId: user.id } });
    // Kayıt zaten geldiyse saklanmaz
    const rec = await tx.recording.findUnique({ where: { callId } });
    if (rec && rec.status !== "DISCARDED" && rec.status !== "DELETED") {
      if (rec.storageKey) await removeObject(rec.storageKey);
      await tx.recording.update({ where: { id: rec.id }, data: { status: "DISCARDED", discardReason: "GUEST_DECLINED", storageKey: null, sourceUrlEnc: null } });
      await tx.transcript.deleteMany({ where: { recordingId: rec.id } });
    }
  });
  await audit({ actorId: user.id, action: "call.recording_declined", entity: "Call", entityId: callId });
}

/** İnsan düzeltmesi: düzeltilen metin yeniden maskelenir; önce/sonra kaydı tutulur (doğruluk ölçümü için). */
export async function editSegment(user: Principal, callId: string, index: number, text: string) {
  const call = await db.call.findFirst({ where: { AND: [{ id: callId }, callScopeWhere(user)] }, select: { id: true } });
  if (!call) throw new CallDetailError("NOT_FOUND");
  const t = await db.transcript.findUnique({ where: { callId } });
  if (!t?.segments) throw new CallDetailError("NO_TRANSCRIPT");
  const segs = t.segments as unknown as Segment[];
  if (index < 0 || index >= segs.length) throw new CallDetailError("BAD_INDEX");
  const after = redactSensitive(text.trim()).text;
  if (!after) throw new CallDetailError("EMPTY");
  const before = segs[index].text;
  if (before === after) return;
  segs[index] = { ...segs[index], text: after };
  await db.$transaction([
    db.transcript.update({ where: { id: t.id }, data: { segments: segs as unknown as Prisma.InputJsonValue } }),
    db.transcriptEdit.create({ data: { transcriptId: t.id, segmentIndex: index, before, after, editorId: user.id } }),
  ]);
  await audit({ actorId: user.id, action: "transcript.edit", entity: "Transcript", entityId: t.id, diff: { index } });
}

/**
 * Analiz önerisini insan inceler: APPROVE (öneriler uygulanır: zamanlı geri arama oluşur),
 * CORRECT (özet/etiket düzeltilir), DISPUTE (itiraz + açıklama). Otomatik karar yok.
 */
export async function reviewAnalysis(
  user: Principal,
  callId: string,
  input: { decision: "APPROVE" | "CORRECT" | "DISPUTE"; summary?: string; topics?: string[]; comment?: string },
) {
  const call = await db.call.findFirst({ where: { AND: [{ id: callId }, callScopeWhere(user)] }, select: { id: true, agentId: true, guestId: true } });
  if (!call) throw new CallDetailError("NOT_FOUND");
  const a = await db.callAnalysis.findUnique({ where: { callId } });
  if (!a) throw new CallDetailError("NO_ANALYSIS");
  if (input.decision === "DISPUTE" && !(input.comment && input.comment.trim().length >= 5)) throw new CallDetailError("COMMENT_REQUIRED");
  const created: string[] = [];
  await db.$transaction(async (tx) => {
    if (input.decision === "APPROVE") {
      for (const act of (a.actions as unknown as SuggestedAction[]) ?? []) {
        if (act.type !== "CALLBACK" || !act.at || new Date(act.at) <= new Date()) continue;
        const exists = await tx.callback.findFirst({ where: { guestId: call.guestId, status: "PENDING", scheduledAt: new Date(act.at) } });
        if (exists) continue;
        const cb = await tx.callback.create({ data: { guestId: call.guestId, assigneeId: call.agentId, scheduledAt: new Date(act.at), sourceCallId: call.id } });
        created.push(cb.id);
      }
    }
    await tx.callAnalysis.update({
      where: { id: a.id },
      data: {
        reviewStatus: input.decision === "APPROVE" ? "APPROVED" : input.decision === "CORRECT" ? "CORRECTED" : "DISPUTED",
        ...(input.decision === "CORRECT" ? { summary: input.summary?.trim() || a.summary, topics: input.topics ?? a.topics } : {}),
      },
    });
    await tx.analysisReview.create({
      data: {
        analysisId: a.id, reviewerId: user.id, decision: input.decision, comment: input.comment?.trim() || null,
        changes: (input.decision === "CORRECT" ? { summaryBefore: a.summary, topicsBefore: a.topics } : created.length ? { callbacksCreated: created } : undefined) as Prisma.InputJsonValue | undefined,
      },
    });
  });
  await audit({ actorId: user.id, action: "analysis.review", entity: "CallAnalysis", entityId: a.id, reason: input.comment, diff: { decision: input.decision, callbacksCreated: created.length } });
  return { callbacksCreated: created.length };
}

/** İnceleme gereken çağrılar: düşük güven, başarısız transkript, uyuşmazlık, bekleyen öneri. */
export async function reviewQueue(user: Principal, filter: "all" | "mismatch" | "low" | "pending") {
  const scope = callScopeWhere(user);
  const where: Prisma.CallWhereInput = { AND: [scope] };
  const and = where.AND as Prisma.CallWhereInput[];
  const ids = async (w: Prisma.TranscriptWhereInput | Prisma.CallAnalysisWhereInput, kind: "t" | "a") =>
    (kind === "t"
      ? await db.transcript.findMany({ where: w as Prisma.TranscriptWhereInput, select: { callId: true }, take: 500 })
      : await db.callAnalysis.findMany({ where: w as Prisma.CallAnalysisWhereInput, select: { callId: true }, take: 500 })
    ).map((x) => x.callId);
  if (filter === "mismatch") and.push({ id: { in: await ids({ dispositionMismatch: true, reviewStatus: "PENDING" }, "a") } });
  else if (filter === "low") and.push({ id: { in: await ids({ status: { in: ["LOW_CONFIDENCE", "FAILED"] } }, "t") } });
  else if (filter === "pending") and.push({ id: { in: await ids({ reviewStatus: "PENDING" }, "a") } });
  else and.push({ id: { in: await ids({}, "t") } });
  return db.call.findMany({
    where,
    orderBy: { startedAt: "desc" },
    take: 100,
    select: {
      id: true, startedAt: true, talkSec: true, disposition: true,
      agent: { select: { name: true } },
      guest: { select: { crmNo: true, firstName: true, lastName: true } },
    },
  });
}
