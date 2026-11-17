import "server-only";
import { activeVocabulary } from "@/server/services/qa";
import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { audit, logAccess } from "@/server/audit";
import { decrypt, encrypt } from "@/server/crypto/field-encryption";
import { getDecrypted, putEncrypted, removeObject } from "@/server/storage";
import { enqueue } from "@/server/queue";
import { gateOpen, getRecordingGate, getRetention } from "@/server/services/settings";
import { redactSensitive, type RedactionKind } from "@/lib/redact";
import { analyzeTranscript, type Segment } from "@/lib/speech-analysis";
import { transcribe } from "@/server/speech/transcriber";
import { llmSummary } from "@/server/speech/llm";

/**
 * Ses kaydı hattı (plan v4 §4): kapı → kayıt → indirme ve şifreli saklama → transkript → maskeleme → öneri.
 * Analiz yalnız öneri üretir; düzeltme, onay ve itiraz insan tarafından yapılır.
 */

export const MAX_RECORDING_BYTES = 200 * 1024 * 1024;
export const LOW_CONFIDENCE = 0.6;

/** Santral "kayıt hazır" bildirdiğinde çağrılır. Kapı kapalıysa veya misafir istemediyse kayıt saklanmaz. */
export async function registerRecording(callId: string, src: { provider: string; url: string; channels: number; durationSec: number | null }) {
  const existing = await db.recording.findUnique({ where: { callId } });
  if (existing) return existing;
  const call = await db.call.findUniqueOrThrow({ where: { id: callId } });
  const declined =
    call.recordingPreference === "DECLINED" ||
    (await db.consentRecord.count({ where: { guestId: call.guestId, channel: "RECORDING", status: "DENIED" } })) > 0;
  const gate = await getRecordingGate();
  const discardReason = !gateOpen(gate) ? "GATE_CLOSED" : declined ? "GUEST_DECLINED" : null;

  const rec = await db.recording.create({
    data: {
      callId,
      provider: src.provider,
      channels: src.channels,
      durationSec: src.durationSec,
      status: discardReason ? "DISCARDED" : "PENDING_FETCH",
      discardReason,
      sourceUrlEnc: discardReason ? null : encrypt(src.url),
    },
  });
  await audit({ actorId: null, action: discardReason ? "recording.discarded" : "recording.registered", entity: "Recording", entityId: rec.id, diff: { callId, reason: discardReason } });
  if (!discardReason) await enqueue("recordings", "fetch", { recordingId: rec.id }, { jobId: `fetch-${rec.id}` });
  return rec;
}

/** İşçi: kaydı santralden indirir, şifreli saklar, transkript işini kuyruğa alır. */
export async function fetchRecording(recordingId: string) {
  const rec = await db.recording.findUniqueOrThrow({ where: { id: recordingId } });
  if (rec.status !== "PENDING_FETCH" || !rec.sourceUrlEnc) return;
  try {
    const res = await fetch(decrypt(rec.sourceUrlEnc), {
      headers: process.env.PBX_API_TOKEN ? { Authorization: `Bearer ${process.env.PBX_API_TOKEN}` } : {},
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`İndirme ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > MAX_RECORDING_BYTES) throw new Error(`Geçersiz boyut: ${buf.length}`);
    const storageKey = await putEncrypted("recordings", buf);
    const retention = await getRetention();
    await db.$transaction([
      db.recording.update({
        where: { id: rec.id },
        data: {
          status: "STORED", storageKey, sizeBytes: buf.length, sha256: createHash("sha256").update(buf).digest("hex"),
          mimeType: res.headers.get("content-type")?.split(";")[0] ?? "audio/mpeg", sourceUrlEnc: null, storedAt: new Date(),
          retentionUntil: new Date(Date.now() + retention.audioDays * 86_400_000), attempts: { increment: 1 }, error: null,
        },
      }),
      db.transcript.create({ data: { recordingId: rec.id, callId: rec.callId } }),
    ]);
    await enqueue("speech", "transcribe", { recordingId: rec.id }, { jobId: `speech-${rec.id}` });
  } catch (e) {
    const attempts = rec.attempts + 1;
    await db.recording.update({ where: { id: rec.id }, data: { attempts, error: (e as Error).message.slice(0, 300), ...(attempts >= 3 ? { status: "FAILED" } : {}) } });
    if (attempts >= 3) await db.telephonyIncident.create({ data: { provider: rec.provider, kind: "RECORDING_FETCH_FAILED", detail: (e as Error).message.slice(0, 300), callId: rec.callId } });
    throw e;
  }
}

/** İşçi: Türkçe transkript → maskeleme → analiz önerisi. */
export async function transcribeRecording(recordingId: string) {
  const rec = await db.recording.findUniqueOrThrow({ where: { id: recordingId }, include: { transcript: true } });
  if (rec.status !== "STORED" || !rec.storageKey || !rec.transcript) return;
  const t = rec.transcript;
  await db.transcript.update({ where: { id: t.id }, data: { status: "PROCESSING" } });
  try {
    const audio = await getDecrypted(rec.storageKey);
    const vocabulary = await activeVocabulary(); // Türkçe kurum sözlüğü (Aşama 2)
    const out = await transcribe({ audio, mimeType: rec.mimeType ?? "audio/mpeg", channels: rec.channels, language: "tr", vocabulary });

    const kinds = new Set<RedactionKind>();
    const redacted: Segment[] = out.segments.map((s) => {
      const r = redactSensitive(s.text);
      r.found.forEach((k) => kinds.add(k));
      return { ...s, text: r.text };
    });
    const retention = await getRetention();
    const call = await db.call.findUniqueOrThrow({ where: { id: rec.callId }, select: { disposition: true } });
    const analysis = analyzeTranscript(redacted, call.disposition);
    const llm = await llmSummary(redacted).catch(() => null);

    await db.$transaction([
      db.transcript.update({
        where: { id: t.id },
        data: {
          status: out.confidence < LOW_CONFIDENCE ? "LOW_CONFIDENCE" : "DONE",
          language: out.language, model: out.model, modelVersion: out.modelVersion, confidence: out.confidence,
          rawEnc: encrypt(JSON.stringify(out.segments)), rawExpiresAt: new Date(Date.now() + retention.rawTranscriptDays * 86_400_000),
          segments: redacted as unknown as Prisma.InputJsonValue, redactedKinds: [...kinds], completedAt: new Date(), error: null,
        },
      }),
      db.callAnalysis.create({
        data: {
          transcriptId: t.id, callId: rec.callId,
          summary: llm?.summary ?? analysis.summary,
          topics: analysis.topics,
          actions: analysis.actions as unknown as Prisma.InputJsonValue,
          processFlags: analysis.processFlags as unknown as Prisma.InputJsonValue,
          dispositionMismatch: analysis.dispositionMismatch,
          model: llm ? `${llm.model}+${analysis.model}` : analysis.model,
          modelVersion: llm ? `${llm.modelVersion}/${analysis.modelVersion}` : analysis.modelVersion,
          confidence: out.confidence,
        },
      }),
    ]);
  } catch (e) {
    await db.transcript.update({ where: { id: t.id }, data: { status: "FAILED", error: (e as Error).message.slice(0, 300) } });
    throw e;
  }
}

// ───────────── Erişim: süreli ve gerekçeli dinleme ─────────────

export async function grantListen(userId: string, callId: string, reason: string) {
  const { listenGrantHours } = await getRetention();
  const g = await db.recordingAccessGrant.create({ data: { userId, callId, reason, expiresAt: new Date(Date.now() + listenGrantHours * 3_600_000) } });
  await logAccess({ actorId: userId, action: "listen", resource: "Recording", resourceId: callId, reason, meta: { grantId: g.id, expiresAt: g.expiresAt.toISOString() } });
  return g;
}

export async function activeGrant(userId: string, callId: string) {
  return db.recordingAccessGrant.findFirst({ where: { userId, callId, expiresAt: { gt: new Date() } }, orderBy: { expiresAt: "desc" } });
}

// ───────────── Saklama süresi temizliği ─────────────

export async function purgeExpiredRecordings(now = new Date()) {
  const audio = await db.recording.findMany({ where: { status: "STORED", retentionUntil: { lte: now } }, select: { id: true, storageKey: true } });
  for (const r of audio) {
    if (r.storageKey) await removeObject(r.storageKey);
    await db.recording.update({ where: { id: r.id }, data: { status: "DELETED", storageKey: null, deletedAt: now } });
  }
  const raw = await db.transcript.updateMany({ where: { rawEnc: { not: null }, rawExpiresAt: { lte: now } }, data: { rawEnc: null } });
  if (audio.length || raw.count) await audit({ actorId: null, action: "retention.recordings", diff: { audioDeleted: audio.length, rawTranscriptsDeleted: raw.count } });
  return { audioDeleted: audio.length, rawTranscriptsDeleted: raw.count };
}
