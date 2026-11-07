import "server-only";
import { db } from "@/server/db";
import type { Principal } from "@/server/auth/rbac";
import { checkEligibility, type IneligibleReason } from "@/lib/eligibility";

/**
 * Arama kuyruğu (plan v4 §3). Yalnız kullanıcıya atanmış ve uygun görevler.
 * Sıralama: zamanı gelen geri aramalar → geciken geri aramalar → öncelik → atanma tarihi.
 * Finansal veri hiçbir şekilde okunmaz.
 */

export interface QueueItem {
  taskId: string;
  guestId: string;
  crmNo: number;
  name: string;
  language: string;
  timezone: string;
  phoneId: string;
  phoneMasked: string;
  phoneReachability: string;
  consentSource: string | null;
  recordingPref: string | null;
  reason: string;
  assignedAt: Date;
  priority: number;
  callbackAt: Date | null;
  callbackState: "DUE" | "LATE" | "MISSED" | "PENDING" | null;
  lastCall: { at: Date; disposition: string | null; talkSec: number | null } | null;
}

export function callbackState(at: Date, now: Date): "PENDING" | "DUE" | "LATE" | "MISSED" {
  const diff = now.getTime() - at.getTime();
  if (diff < -15 * 60_000) return "PENDING";
  if (diff <= 15 * 60_000) return "DUE";
  if (diff <= 24 * 3_600_000) return "LATE";
  return "MISSED";
}

export async function loadQueue(user: Principal, now = new Date()): Promise<{ items: QueueItem[]; blocked: number }> {
  const tasks = await db.task.findMany({
    where: {
      assigneeId: user.id,
      type: "CALL",
      status: { in: ["OPEN", "IN_PROGRESS"] },
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date(now.getTime() + 15 * 60_000) } }],
    },
    include: {
      guest: {
        select: {
          id: true, crmNo: true, firstName: true, lastName: true, language: true, timezone: true, anonymizedAt: true,
          phones: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] },
          consents: { where: { channel: { in: ["CALL", "RECORDING"] } } },
          blocks: { where: { removedAt: null } },
          callbacks: { where: { status: "PENDING", assigneeId: user.id }, orderBy: { scheduledAt: "asc" }, take: 1 },
          calls: { orderBy: { startedAt: "desc" }, take: 1, select: { startedAt: true, disposition: true, talkSec: true } },
        },
      },
    },
    take: 300,
  });

  const items: QueueItem[] = [];
  const toBlock: { id: string; reason: IneligibleReason }[] = [];

  for (const t of tasks) {
    const g = t.guest;
    const callConsent = g.consents.find((c) => c.channel === "CALL") ?? null;
    // Uygun ilk numarayı seç (birincil önce)
    let chosen: (typeof g.phones)[number] | null = null;
    let lastReason: IneligibleReason = "INVALID_PHONE";
    for (const ph of g.phones) {
      const r = checkEligibility({
        channel: "CALL", purpose: "MARKETING", now,
        guest: g, consent: callConsent, blocks: g.blocks,
        phone: { formatStatus: ph.formatStatus, ownership: ph.ownership, reachability: ph.reachability, lineType: ph.lineType },
      });
      if (r.ok) { chosen = ph; break; }
      lastReason = r.reason;
    }
    if (!chosen) {
      if (g.phones.length === 0) lastReason = "INVALID_PHONE";
      toBlock.push({ id: t.id, reason: lastReason });
      continue;
    }
    const cb = g.callbacks[0] ?? null;
    items.push({
      taskId: t.id,
      guestId: g.id,
      crmNo: g.crmNo,
      name: `${g.firstName} ${g.lastName}`,
      language: g.language,
      timezone: g.timezone,
      phoneId: chosen.id,
      phoneMasked: chosen.masked,
      phoneReachability: chosen.reachability,
      consentSource: callConsent?.source ?? null,
      recordingPref: g.consents.find((c) => c.channel === "RECORDING")?.status ?? null,
      reason: t.reason,
      assignedAt: t.assignedAt,
      priority: t.priority,
      callbackAt: cb?.scheduledAt ?? null,
      callbackState: cb ? callbackState(cb.scheduledAt, now) : null,
      lastCall: g.calls[0] ? { at: g.calls[0].startedAt, disposition: g.calls[0].disposition, talkSec: g.calls[0].talkSec } : null,
    });
  }

  if (toBlock.length) {
    for (const b of toBlock) {
      await db.task.update({ where: { id: b.id }, data: { status: "BLOCKED", closeReason: b.reason } });
    }
  }

  const rank = (i: QueueItem) => (i.callbackState === "DUE" ? 0 : i.callbackState === "LATE" || i.callbackState === "MISSED" ? 1 : 2);
  items.sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (a.callbackAt && b.callbackAt ? a.callbackAt.getTime() - b.callbackAt.getTime() : 0) ||
      a.priority - b.priority ||
      a.assignedAt.getTime() - b.assignedAt.getTime(),
  );
  return { items, blocked: toBlock.length };
}
