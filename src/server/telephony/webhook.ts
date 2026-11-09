import "server-only";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { registerRecording } from "@/server/services/recordings";

/**
 * Santral webhook olayları (plan v4 §3–4). Santral süreleri esas alınır; temsilcinin elle ölçtüğü süre
 * farklıysa fark denetim kaydına yazılır. Aynı olay iki kez gelirse tek kez işlenir.
 */
export const eventSchema = z.object({
  eventId: z.string().min(1).max(128),
  event: z.enum(["answered", "ended", "recording.ready"]),
  reference: z.string().max(64).optional(), // crmPlus Call.id (arama başlatılırken santrale verilir)
  externalId: z.string().max(128).optional(), // santral çağrı kimliği
  at: z.string().datetime({ offset: true }),
  talkSec: z.number().int().min(0).max(86_400).optional(),
  ringSec: z.number().int().min(0).max(3_600).optional(),
  recordingUrl: z.string().url().optional(),
  channels: z.number().int().min(1).max(2).optional(),
  durationSec: z.number().int().min(0).max(86_400).optional(),
});
export type TelephonyEventInput = z.infer<typeof eventSchema>;

export async function handleTelephonyEvent(provider: string, e: TelephonyEventInput) {
  try {
    await db.telephonyEvent.create({ data: { provider, eventId: e.eventId, type: e.event, callId: e.reference ?? null, payload: e as unknown as Prisma.InputJsonValue } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return { status: "duplicate" as const };
    throw err;
  }

  const call = e.reference
    ? await db.call.findUnique({ where: { id: e.reference } })
    : e.externalId
      ? await db.call.findFirst({ where: { provider, externalId: e.externalId } })
      : null;
  if (!call) {
    await db.telephonyIncident.create({ data: { provider, kind: "WEBHOOK_UNKNOWN_CALL", detail: `Olay ${e.eventId} hiçbir çağrıyla eşleşmedi` } });
    return { status: "unknown_call" as const };
  }
  const at = new Date(e.at);

  if (e.event === "answered") {
    if (!call.answeredAt) await db.call.update({ where: { id: call.id }, data: { answeredAt: at } });
  } else if (e.event === "ended") {
    const answeredAt = call.answeredAt ?? (e.talkSec ? new Date(at.getTime() - e.talkSec * 1000) : null);
    const talkSec = e.talkSec ?? (answeredAt ? Math.max(0, Math.round((at.getTime() - answeredAt.getTime()) / 1000)) : 0);
    const ringSec = e.ringSec ?? Math.max(0, Math.round(((answeredAt ?? at).getTime() - call.startedAt.getTime()) / 1000));
    if (call.endedAt && call.talkSec !== null && Math.abs((call.talkSec ?? 0) - talkSec) > 5) {
      await audit({ actorId: null, action: "call.duration_mismatch", entity: "Call", entityId: call.id, diff: { manualTalkSec: call.talkSec, pbxTalkSec: talkSec } });
    }
    await db.call.update({ where: { id: call.id }, data: { endedAt: at, talkSec, ringSec, answeredAt, ...(e.externalId && !call.externalId ? { externalId: e.externalId } : {}) } });
  } else if (e.event === "recording.ready" && e.recordingUrl) {
    await registerRecording(call.id, { provider, url: e.recordingUrl, channels: e.channels ?? 1, durationSec: e.durationSec ?? null });
  }
  return { status: "processed" as const, callId: call.id };
}
