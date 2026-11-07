import "server-only";
import { db } from "@/server/db";
import type { Principal } from "@/server/auth/rbac";
import { audit } from "@/server/audit";
import { decrypt, encrypt } from "@/server/crypto/field-encryption";
import { checkEligibility } from "@/lib/eligibility";
import { planDisposition, type DispositionCode } from "@/lib/disposition";
import { redactSensitive } from "@/lib/redact";
import { getTelephonyProvider } from "@/server/telephony/provider";
import { applyContactBlock } from "@/server/services/consent";

export class CallError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

const secs = (a: Date, b: Date) => Math.max(0, Math.round((b.getTime() - a.getTime()) / 1000));

/** "Ara": uygunluğu son kez kontrol eder, çağrıyı açar, santrale/softphone'a iletir. */
export async function startCall(user: Principal, taskId: string) {
  const open = await db.call.findFirst({ where: { agentId: user.id, closedAt: null } });
  if (open) throw new CallError("OPEN_CALL_EXISTS");

  const task = await db.task.findFirst({
    where: { id: taskId, assigneeId: user.id, status: { in: ["OPEN", "IN_PROGRESS"] } },
    include: {
      guest: {
        include: {
          phones: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] },
          consents: { where: { channel: "CALL" } },
          blocks: { where: { removedAt: null } },
        },
      },
    },
  });
  if (!task) throw new CallError("TASK_NOT_FOUND");

  const now = new Date();
  const g = task.guest;
  const phone = g.phones.find(
    (ph) =>
      checkEligibility({
        channel: "CALL", purpose: "MARKETING", now, guest: g, consent: g.consents[0] ?? null, blocks: g.blocks,
        phone: { formatStatus: ph.formatStatus, ownership: ph.ownership, reachability: ph.reachability, lineType: ph.lineType },
      }).ok,
  );
  if (!phone) {
    await db.task.update({ where: { id: task.id }, data: { status: "BLOCKED", closeReason: "NOT_ELIGIBLE_AT_DIAL" } });
    throw new CallError("NOT_ELIGIBLE");
  }

  const call = await db.call.create({
    data: { guestId: g.id, phoneId: phone.id, agentId: user.id, taskId: task.id, startedAt: now, recordingPreference: "NOT_ASKED" },
  });
  await db.task.update({ where: { id: task.id }, data: { status: "IN_PROGRESS", attempts: { increment: 1 } } });
  await db.agentStatusLog.create({ data: { userId: user.id, status: "ON_CALL" } });

  const dial = await getTelephonyProvider().dial({ e164: decrypt(phone.e164Enc), callId: call.id });
  if (dial.externalId) {
    await db.call.update({ where: { id: call.id }, data: { provider: dial.provider, externalId: dial.externalId } });
  }
  return { callId: call.id, startedAt: now.toISOString(), dialUri: dial.dialUri ?? null, provider: dial.provider };
}

async function ownOpenCall(user: Principal, callId: string) {
  const call = await db.call.findFirst({ where: { id: callId, agentId: user.id, closedAt: null } });
  if (!call) throw new CallError("CALL_NOT_FOUND");
  return call;
}

/** Manuel mod: temsilci "Bağlandı" dediğinde. Santral modunda webhook yazar. */
export async function markAnswered(user: Principal, callId: string) {
  const call = await ownOpenCall(user, callId);
  if (call.answeredAt || call.endedAt) return { answeredAt: (call.answeredAt ?? new Date()).toISOString() };
  const at = new Date();
  await db.call.update({ where: { id: call.id }, data: { answeredAt: at } });
  return { answeredAt: at.toISOString() };
}

export async function endCall(user: Principal, callId: string) {
  const call = await ownOpenCall(user, callId);
  if (call.endedAt) return { endedAt: call.endedAt.toISOString(), talkSec: call.talkSec ?? 0 };
  const at = new Date();
  const ringSec = secs(call.startedAt, call.answeredAt ?? at);
  const talkSec = call.answeredAt ? secs(call.answeredAt, at) : 0;
  await db.call.update({ where: { id: call.id }, data: { endedAt: at, ringSec, talkSec } });
  await db.agentStatusLog.create({ data: { userId: user.id, status: "WRAP_UP" } });
  return { endedAt: at.toISOString(), talkSec };
}

export interface CloseInput {
  callId: string;
  disposition: DispositionCode;
  note: string;
  callbackAt?: Date | null;
  language?: string | null;
  dncAllChannels?: boolean;
}

/** Sonuç kodu ile çağrıyı kapatır ve etkileri tek transaction'da uygular (docs/03). */
export async function closeCall(user: Principal, input: CloseInput) {
  const call = await ownOpenCall(user, input.callId);
  if (!call.endedAt) await endCall(user, call.id);
  const fresh = await db.call.findUniqueOrThrow({ where: { id: call.id } });

  const disp = await db.disposition.findUnique({ where: { code: input.disposition } });
  if (!disp) throw new CallError("BAD_DISPOSITION");

  const [task, phone, priorNoAnswer] = await Promise.all([
    fresh.taskId ? db.task.findUnique({ where: { id: fresh.taskId } }) : null,
    db.guestPhone.findUniqueOrThrow({ where: { id: fresh.phoneId } }),
    fresh.taskId
      ? db.call.count({ where: { taskId: fresh.taskId, disposition: "NO_ANSWER", NOT: { id: fresh.id } } })
      : Promise.resolve(0),
  ]);

  const now = new Date();
  const result = planDisposition({
    code: input.disposition,
    now,
    attempts: task?.attempts ?? 1,
    priorNoAnswer,
    phoneConsecutiveFails: phone.consecutiveFails,
    note: input.note,
    noteRequired: disp.noteRequired,
    callbackAt: input.callbackAt ?? null,
    language: input.language ?? null,
    dncAllChannels: input.dncAllChannels,
  });
  if (!result.ok) throw new CallError(result.error);
  const plan = result.plan;

  const redacted = input.note.trim() ? redactSensitive(input.note.trim()) : null;
  const guest = await db.guest.findUniqueOrThrow({ where: { id: fresh.guestId }, include: { owner: { include: { team: true } } } });
  const agent = await db.user.findUniqueOrThrow({ where: { id: user.id }, include: { team: true } });
  const leaderId = agent.team?.leaderId ?? guest.owner?.team?.leaderId ?? null;

  await db.$transaction(async (tx) => {
    await tx.call.update({
      where: { id: fresh.id },
      data: {
        disposition: input.disposition,
        noteEnc: redacted ? encrypt(redacted.text) : null,
        noteLength: redacted?.text.length ?? 0,
        closedAt: now,
        wrapSec: fresh.endedAt ? secs(fresh.endedAt, now) : 0,
      },
    });

    if (task) {
      await tx.task.update({
        where: { id: task.id },
        data: {
          status: plan.task.status,
          nextAttemptAt: plan.task.nextAttemptAt ?? null,
          closeReason: plan.task.closeReason,
          lastDisposition: input.disposition,
          ...(plan.reassignToLead && leaderId ? { assigneeId: leaderId, reason: `${task.reason} · dil desteği: ${plan.setLanguage}` } : {}),
        },
      });
    }

    if (plan.phone) {
      await tx.guestPhone.update({
        where: { id: phone.id },
        data: {
          reachability: plan.phone.reachability,
          ownership: plan.phone.ownership,
          consecutiveFails: plan.phone.consecutiveFails,
          lastCheckedAt: now,
          ...(plan.phone.reached ? { lastReachedAt: now } : {}),
          ...(plan.phone.reachability === "UNREACHED" || plan.phone.reachability === "UNREACHABLE" ? { lastFailedAt: now } : {}),
        },
      });
      await tx.phoneCheck.create({
        data: { phoneId: phone.id, kind: "REACHABILITY", result: plan.phone.ownership ?? plan.phone.reachability ?? "BUSY", source: "call" },
      });
    }

    // Zamanı gelmiş geri arama bu çağrıyla karşılanır
    await tx.callback.updateMany({
      where: { guestId: guest.id, assigneeId: user.id, status: "PENDING", scheduledAt: { lte: new Date(now.getTime() + 15 * 60_000) } },
      data: { status: "DONE", doneCallId: fresh.id },
    });
    if (plan.createCallbackAt) {
      await tx.callback.create({
        data: { guestId: guest.id, assigneeId: user.id, scheduledAt: plan.createCallbackAt, sourceCallId: fresh.id },
      });
    }

    if (plan.block) {
      await applyContactBlock(tx, {
        guestId: guest.id,
        allChannels: plan.block.allChannels,
        channel: "CALL",
        requestedAt: fresh.answeredAt ?? fresh.startedAt,
        actorId: user.id,
        reason: "GUEST_REQUEST",
        proof: "call:" + fresh.id,
        source: "Çağrıda misafir talebi",
      });
    }

    if (plan.review) {
      await tx.reviewItem.create({
        data: { kind: plan.review, guestId: guest.id, candidates: { phoneId: phone.id, masked: phone.masked }, sourceRef: `call:${fresh.id}` },
      });
    }

    if (plan.setLanguage) {
      await tx.guest.update({ where: { id: guest.id }, data: { language: plan.setLanguage } });
      await tx.fieldHistory.create({
        data: { guestId: guest.id, field: "language", oldValue: guest.language, newValue: plan.setLanguage, actorId: user.id, sourceId: `call:${fresh.id}` },
      });
    }

    if (plan.escalateToLead && leaderId) {
      await tx.task.create({
        data: { type: "FOLLOW_UP", reason: "Yönetici incelemesi istendi (çağrı)", guestId: guest.id, assigneeId: leaderId, priority: 1 },
      });
    }

    await tx.interaction.create({
      data: { guestId: guest.id, channel: "CALL", direction: "OUT", refId: fresh.id, summary: disp.labelTr, actorId: user.id },
    });
    await tx.agentStatusLog.create({ data: { userId: user.id, status: "READY" } });
  });

  await audit({
    actorId: user.id,
    action: "call.close",
    entity: "Call",
    entityId: fresh.id,
    diff: { disposition: input.disposition, task: plan.task.status, block: plan.block ?? null, redacted: redacted?.found ?? [] },
  });
  return { redactedKinds: redacted?.found ?? [] };
}
