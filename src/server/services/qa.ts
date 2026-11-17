import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { scopeOf, type Principal } from "@/server/auth/rbac";
import { getSetting } from "@/server/services/settings";
import { pickSamples } from "@/lib/speech-metrics";
import { DEFAULT_CRITERIA, type Criterion, type CriterionResult } from "@/lib/qa-criteria";
import { addDays, dbDate, istDate, weekStartOf } from "@/lib/hr/time";

/**
 * Kalite örneklemesi (plan v4 §5): takım lideri tanımlı örneklemi ortak kriter setiyle inceler, koçluk notu yazar;
 * personel açıklama veya itiraz ekler. Otomatik puan, sıralama veya yaptırım YOKTUR. Analiz yalnız aday önerir.
 * Sonuçlar puantaj veya performans sıralamasıyla birleştirilmez.
 */
export class QaError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

export type { Criterion, CriterionResult } from "@/lib/qa-criteria";

export interface QaParams {
  perAgent: number; // temsilci başına haftalık örneklem
  flagged: number; // bunun en fazla kaçı analiz adayı olabilir
  minTalkSec: number;
}
export const qaParams = () => getSetting<QaParams>("qa.params", { perAgent: 3, flagged: 2, minTalkSec: 30 });

export async function activeCriteriaSet(actorId = "system") {
  const s = await db.qaCriteriaSet.findFirst({ where: { active: true }, orderBy: { version: "desc" } });
  if (s) return s;
  return db.qaCriteriaSet.create({ data: { name: "Görüşme kalite kriterleri", version: 1, criteria: DEFAULT_CRITERIA as unknown as Prisma.InputJsonValue, createdBy: actorId } });
}

/** Lider ekibi; operasyon tümü; personel kendi (yalnız incelenmiş örneklemler). */
export function sampleScopeWhere(user: Principal): Prisma.QaSampleWhereInput {
  const s = scopeOf(user, "qa.review");
  if (s === "all") return {};
  if (s === "team") return { teamId: { in: [...new Set([...user.ledTeamIds, ...(user.teamId ? [user.teamId] : [])])] }, NOT: { agentId: user.id } };
  if (scopeOf(user, "qa.respond")) return { agentId: user.id, status: { not: "OPEN" } };
  return { id: "__none__" };
}

/** Haftalık örneklem (hafta: Pazartesi başlangıçlı, Europe/Istanbul). Daha önce seçilen çağrı tekrar seçilmez. */
export async function generateSamples(weekStartInput: string, onlyTeamIds?: string[]) {
  const weekStart = weekStartOf(weekStartInput);
  const p = await qaParams();
  const from = new Date(`${weekStart}T00:00:00+03:00`);
  const to = new Date(`${addDays(weekStart, 7)}T00:00:00+03:00`);
  const calls = await db.call.findMany({
    where: {
      startedAt: { gte: from, lt: to }, closedAt: { not: null }, talkSec: { gte: p.minTalkSec },
      agent: { status: "ACTIVE", ...(onlyTeamIds ? { teamId: { in: onlyTeamIds } } : {}) },
    },
    select: { id: true, agentId: true, agent: { select: { teamId: true } } },
  });
  const ids = calls.map((c) => c.id);
  const [analyses, transcripts, existing] = await Promise.all([
    db.callAnalysis.findMany({ where: { callId: { in: ids } }, select: { callId: true, dispositionMismatch: true, processFlags: true } }),
    db.transcript.findMany({ where: { callId: { in: ids } }, select: { callId: true, status: true } }),
    db.qaSample.findMany({ where: { callId: { in: ids } }, select: { callId: true, agentId: true } }),
  ]);
  const a = new Map(analyses.map((x) => [x.callId, x]));
  const t = new Map(transcripts.map((x) => [x.callId, x.status]));
  // Bu hafta için zaten örneklemi olan temsilcinin kotası düşülür
  const already = new Map<string, number>();
  for (const e of existing) already.set(e.agentId, (already.get(e.agentId) ?? 0) + 1);
  const teamOf = new Map(calls.map((c) => [c.id, c.agent.teamId]));

  const picked = pickSamples(
    calls.filter((c) => (already.get(c.agentId) ?? 0) < p.perAgent).map((c) => ({
      callId: c.id, agentId: c.agentId, mismatch: !!a.get(c.id)?.dispositionMismatch,
      processFlags: Array.isArray(a.get(c.id)?.processFlags) ? (a.get(c.id)!.processFlags as unknown[]).length : 0,
      lowConfidence: t.get(c.id) === "LOW_CONFIDENCE",
    })),
    { perAgent: p.perAgent, flagged: p.flagged, seed: weekStart, exclude: new Set(existing.map((e) => e.callId)) },
  );
  const quota = new Map<string, number>();
  let created = 0;
  for (const s of picked) {
    const n = (quota.get(s.agentId) ?? already.get(s.agentId) ?? 0);
    if (n >= p.perAgent) continue;
    quota.set(s.agentId, n + 1);
    await db.qaSample.create({ data: { callId: s.callId, agentId: s.agentId, teamId: teamOf.get(s.callId) ?? null, reason: s.reason, weekStart: dbDate(weekStart) } });
    created++;
  }
  await audit({ actorId: null, action: "qa.sample.generate", diff: { weekStart, created, candidates: calls.length } });
  return { weekStart, created };
}

/** Lider: kendi ekibi için geçen haftanın örneklemini oluşturur (zamanlanmış iş de her Pazartesi çalışır). */
export async function generateForUser(user: Principal, weekStart?: string) {
  const s = scopeOf(user, "qa.review");
  if (s !== "team" && s !== "all") throw new QaError("FORBIDDEN");
  const teams = s === "all" ? undefined : [...new Set([...user.ledTeamIds, ...(user.teamId ? [user.teamId] : [])])];
  return generateSamples(weekStart ?? addDays(weekStartOf(istDate(new Date())), -7), teams);
}

export async function addManualSample(user: Principal, callId: string) {
  const call = await db.call.findUnique({ where: { id: callId }, select: { id: true, agentId: true, startedAt: true, agent: { select: { teamId: true } } } });
  if (!call) throw new QaError("NOT_FOUND");
  const s = sampleScopeWhere(user);
  if (scopeOf(user, "qa.review") === "team" && !(user.ledTeamIds.includes(call.agent.teamId ?? "") || user.teamId === call.agent.teamId)) throw new QaError("FORBIDDEN");
  if (!scopeOf(user, "qa.review") || ("id" in s && s.id === "__none__")) throw new QaError("FORBIDDEN");
  if (call.agentId === user.id) throw new QaError("OWN_CALL");
  if (await db.qaSample.findUnique({ where: { callId } })) throw new QaError("ALREADY_SAMPLED");
  return db.qaSample.create({ data: { callId, agentId: call.agentId, teamId: call.agent.teamId, reason: "MANUAL", weekStart: dbDate(weekStartOf(istDate(call.startedAt))) } });
}

async function loadSample(user: Principal, id: string) {
  const s = await db.qaSample.findFirst({ where: { AND: [{ id }, sampleScopeWhere(user)] }, include: { reviews: { orderBy: { at: "desc" }, include: { criteriaSet: true } } } });
  if (!s) throw new QaError("NOT_FOUND");
  return s;
}

export async function getSample(user: Principal, id: string) {
  const s = await loadSample(user, id);
  const call = await db.call.findUnique({
    where: { id: s.callId },
    select: { id: true, startedAt: true, talkSec: true, disposition: true, agent: { select: { name: true } }, guest: { select: { crmNo: true } } },
  });
  const analysis = await db.callAnalysis.findUnique({ where: { callId: s.callId }, select: { summary: true, topics: true, processFlags: true, dispositionMismatch: true, reviewStatus: true } });
  const set = await activeCriteriaSet();
  const reviewers = new Map((await db.user.findMany({ where: { id: { in: s.reviews.map((r) => r.reviewerId) } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  return { sample: s, call, analysis, criteriaSet: set, reviewers };
}

export async function reviewSample(user: Principal, id: string, input: { results: Record<string, { result: CriterionResult; note?: string }>; coachingNote: string }) {
  if (!scopeOf(user, "qa.review")) throw new QaError("FORBIDDEN");
  const s = await loadSample(user, id);
  if (s.agentId === user.id) throw new QaError("OWN_CALL");
  if (!["OPEN", "REVIEWED"].includes(s.status)) throw new QaError("BAD_STATE");
  if (input.coachingNote.trim().length < 10) throw new QaError("NOTE_REQUIRED");
  const set = await activeCriteriaSet(user.id);
  const criteria = set.criteria as unknown as Criterion[];
  const results = criteria.map((c) => {
    const r = input.results[c.key];
    if (!r || !["MET", "NOT_MET", "NA"].includes(r.result)) throw new QaError("INCOMPLETE");
    if (r.result === "NOT_MET" && !(r.note && r.note.trim().length >= 3)) throw new QaError("NOT_MET_NOTE");
    return { key: c.key, result: r.result, note: r.note?.trim().slice(0, 300) || undefined };
  });
  await db.$transaction([
    db.qaReview.create({ data: { sampleId: id, criteriaSetId: set.id, reviewerId: user.id, results: results as unknown as Prisma.InputJsonValue, coachingNote: input.coachingNote.trim().slice(0, 2000) } }),
    db.qaSample.update({ where: { id }, data: { status: "REVIEWED" } }),
  ]);
  await audit({ actorId: user.id, action: "qa.review", entity: "QaSample", entityId: id, diff: { criteriaSet: `${set.name} v${set.version}`, notMet: results.filter((r) => r.result === "NOT_MET").map((r) => r.key) } });
}

export async function respondSample(user: Principal, id: string, comment: string, dispute: boolean) {
  const s = await loadSample(user, id);
  if (s.agentId !== user.id) throw new QaError("FORBIDDEN");
  if (s.status !== "REVIEWED") throw new QaError("BAD_STATE");
  if (dispute && comment.trim().length < 10) throw new QaError("DISPUTE_REASON");
  await db.qaSample.update({ where: { id }, data: { status: dispute ? "DISPUTED" : "ACKNOWLEDGED", agentComment: comment.trim().slice(0, 1000) || null, agentRespondedAt: new Date() } });
  await audit({ actorId: user.id, action: dispute ? "qa.dispute" : "qa.acknowledge", entity: "QaSample", entityId: id });
}

export async function closeSample(user: Principal, id: string, resolution: string) {
  if (!scopeOf(user, "qa.review")) throw new QaError("FORBIDDEN");
  const s = await loadSample(user, id);
  if (!["ACKNOWLEDGED", "DISPUTED"].includes(s.status)) throw new QaError("BAD_STATE");
  if (s.status === "DISPUTED" && resolution.trim().length < 10) throw new QaError("RESOLUTION_REQUIRED");
  await db.qaSample.update({ where: { id }, data: { status: "CLOSED", resolution: resolution.trim() || null, closedBy: user.id, closedAt: new Date() } });
  await audit({ actorId: user.id, action: "qa.close", entity: "QaSample", entityId: id, reason: resolution || undefined });
}

export async function listSamples(user: Principal, status?: string) {
  const samples = await db.qaSample.findMany({
    where: { AND: [sampleScopeWhere(user), status ? { status } : {}] },
    orderBy: [{ weekStart: "desc" }, { createdAt: "desc" }],
    take: 200,
  });
  const [agents, calls] = await Promise.all([
    db.user.findMany({ where: { id: { in: [...new Set(samples.map((s) => s.agentId))] } }, select: { id: true, name: true } }),
    db.call.findMany({ where: { id: { in: samples.map((s) => s.callId) } }, select: { id: true, startedAt: true, disposition: true, talkSec: true } }),
  ]);
  const an = new Map(agents.map((a) => [a.id, a.name]));
  const cn = new Map(calls.map((c) => [c.id, c]));
  return samples.map((s) => ({ ...s, agentName: an.get(s.agentId) ?? "—", call: cn.get(s.callId) }));
}

// ───────────── Kurum sözlüğü ─────────────

export const VOCAB_KINDS = { CASINO: "Casino", HOTEL: "Otel", PERSON: "Kişi adı", PLACE: "Yer", OTHER: "Diğer" } as const;

export async function addTerm(user: Principal, term: string, kind: string) {
  const t = term.trim();
  if (t.length < 2 || t.length > 60 || !(kind in VOCAB_KINDS)) throw new QaError("BAD_TERM");
  // Numara/kimlik sözlüğe girmez: boşluk veya noktalamayla bölünmüş yazımlar da (ör. "0532 111 22 33") sayılır
  if (t.replace(/\D/g, "").length >= 6) throw new QaError("BAD_TERM");
  await db.vocabularyTerm.upsert({ where: { term: t }, update: { active: true, kind }, create: { term: t, kind, createdBy: user.id } });
  await audit({ actorId: user.id, action: "vocabulary.add", diff: { term: t, kind } });
}

export async function toggleTerm(user: Principal, id: string) {
  const v = await db.vocabularyTerm.findUniqueOrThrow({ where: { id } });
  await db.vocabularyTerm.update({ where: { id }, data: { active: !v.active } });
  await audit({ actorId: user.id, action: "vocabulary.toggle", diff: { term: v.term, active: !v.active } });
}

/** Transkript motoruna verilen sözlük: etkin terimler (en fazla 200). */
export async function activeVocabulary(): Promise<string[]> {
  return (await db.vocabularyTerm.findMany({ where: { active: true }, orderBy: { term: "asc" }, take: 200, select: { term: true } })).map((t) => t.term);
}
