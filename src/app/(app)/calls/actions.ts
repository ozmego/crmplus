"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/server/db";
import { ForbiddenError, requirePermission } from "@/server/auth/rbac";
import { CallDetailError, callScopeWhere, editSegment, reviewAnalysis, setRecordingPreference } from "@/server/services/call-detail";
import { grantListen } from "@/server/services/recordings";

type R<T = true> = { ok: true; data: T } | { ok: false; error: string };
async function run<T>(fn: () => Promise<T>, path?: string): Promise<R<T>> {
  try {
    const data = await fn();
    if (path) revalidatePath(path);
    return { ok: true, data };
  } catch (e) {
    if (e instanceof CallDetailError) return { ok: false, error: e.code };
    if (e instanceof ForbiddenError) return { ok: false, error: "FORBIDDEN" };
    if (e instanceof z.ZodError) return { ok: false, error: "INVALID_INPUT" };
    throw e;
  }
}

export async function recordingPreferenceAction(callId: string, pref: "NOTICE_GIVEN" | "DECLINED") {
  return run(async () => setRecordingPreference(await requirePermission("call.make"), z.string().min(1).parse(callId), z.enum(["NOTICE_GIVEN", "DECLINED"]).parse(pref)));
}

/** Santral modunda çağrı durumunu (webhook ile gelen zaman damgaları) okur. */
export async function callStateAction(callId: string) {
  return run(async () => {
    const user = await requirePermission("call.make");
    const c = await db.call.findFirst({ where: { id: callId, agentId: user.id }, select: { answeredAt: true, endedAt: true, talkSec: true } });
    if (!c) throw new CallDetailError("NOT_FOUND");
    return { answeredAt: c.answeredAt?.toISOString() ?? null, endedAt: c.endedAt?.toISOString() ?? null, talkSec: c.talkSec };
  });
}

export async function listenAction(callId: string, reason: string) {
  return run(async () => {
    const user = await requirePermission("recording.listen", "Recording");
    const visible = await db.call.count({ where: { AND: [{ id: callId }, callScopeWhere(user)] } });
    if (!visible) throw new CallDetailError("NOT_FOUND");
    const g = await grantListen(user.id, callId, z.string().trim().min(5).max(300).parse(reason));
    return { expiresAt: g.expiresAt.toISOString() };
  }, `/calls/${callId}`);
}

export async function editSegmentAction(callId: string, index: number, text: string) {
  return run(async () => editSegment(await requirePermission("transcript.edit"), callId, z.number().int().parse(index), z.string().max(2000).parse(text)), `/calls/${callId}`);
}

export async function reviewAnalysisAction(callId: string, input: { decision: "APPROVE" | "CORRECT" | "DISPUTE"; summary?: string; topics?: string[]; comment?: string }) {
  return run(async () =>
    reviewAnalysis(await requirePermission("analysis.review"), callId, z.object({
      decision: z.enum(["APPROVE", "CORRECT", "DISPUTE"]),
      summary: z.string().max(800).optional(),
      topics: z.array(z.string().max(40)).max(10).optional(),
      comment: z.string().max(500).optional(),
    }).parse(input)), `/calls/${callId}`);
}
