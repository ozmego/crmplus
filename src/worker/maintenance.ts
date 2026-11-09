import type { Prisma } from "@prisma/client";
import { nightlyAttendance } from "@/server/services/timesheet";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { removeObject } from "@/server/storage";
import { evaluateAnomalies, type ActorCounts } from "@/lib/anomaly";

/** Zamanlanmış bakım işleri (src/worker/index.ts tarafından çağrılır). */
export async function runMaintenance(name: string, now = new Date()) {
  switch (name) {
    case "callbacks":
      return escalateLateCallbacks(now);
    case "stale-calls":
      return closeStaleCalls(now);
    case "access-anomalies":
      return accessAnomalies(now);
    case "import-files":
      return purgeImportFiles(now);
    case "attendance":
      return nightlyAttendance(now);
    default:
      throw new Error(`Bilinmeyen bakım işi: ${name}`);
  }
}

/** Planlanan saatten 15 dk sonra hâlâ aranmamış geri arama → takım liderine görev (bir kez). */
export async function escalateLateCallbacks(now: Date) {
  const late = await db.callback.findMany({
    where: { status: "PENDING", escalatedAt: null, scheduledAt: { lt: new Date(now.getTime() - 15 * 60_000) } },
    include: { assignee: { select: { name: true, team: { select: { leaderId: true } } } } },
    take: 500,
  });
  let n = 0;
  for (const cb of late) {
    const leaderId = cb.assignee.team?.leaderId;
    await db.$transaction(async (tx) => {
      if (leaderId && leaderId !== cb.assigneeId) {
        await tx.task.create({
          data: { type: "FOLLOW_UP", guestId: cb.guestId, assigneeId: leaderId, priority: 1, reason: `Geciken geri arama (${cb.assignee.name}, planlanan ${cb.scheduledAt.toISOString()})` },
        });
      }
      await tx.callback.update({ where: { id: cb.id }, data: { escalatedAt: now } });
    });
    n++;
  }
  return { escalated: n };
}

/** 4 saatten uzun açık çağrı otomatik kapanır ve veri kalitesi sorunu olarak işaretlenir (docs/03 §1). */
export async function closeStaleCalls(now: Date) {
  const stale = await db.call.findMany({ where: { closedAt: null, startedAt: { lt: new Date(now.getTime() - 4 * 3_600_000) } }, take: 500 });
  for (const c of stale) {
    const endedAt = c.endedAt ?? new Date(c.startedAt.getTime() + 4 * 3_600_000);
    await db.$transaction([
      db.call.update({ where: { id: c.id }, data: { endedAt, closedAt: now, autoClosed: true } }),
      ...(c.taskId ? [db.task.updateMany({ where: { id: c.taskId, status: "IN_PROGRESS" }, data: { status: "OPEN" } })] : []),
    ]);
  }
  if (stale.length) await audit({ actorId: null, action: "call.auto_closed", diff: { count: stale.length } });
  return { autoClosed: stale.length };
}

/** docs/08 §2 kuralları; aynı kural + kullanıcı için günde bir uyarı. */
export async function accessAnomalies(now: Date) {
  const since = (ms: number) => new Date(now.getTime() - ms);
  const logs = await db.accessLog.findMany({
    where: { at: { gte: since(86_400_000) } },
    select: { actorId: true, action: true, resource: true, resourceId: true, meta: true, at: true },
  });
  const byActor = new Map<string | null, ActorCounts>();
  const get = (id: string | null) => {
    let a = byActor.get(id);
    if (!a) byActor.set(id, (a = { actorId: id, distinctGuestViews10m: 0, reveals24h: 0, exports24h: 0, maxExportRows24h: 0, deniedExports1h: 0, denied1h: 0, listens24h: 0 }));
    return a;
  };
  const views = new Map<string | null, Set<string>>();
  for (const l of logs) {
    const a = get(l.actorId);
    if (l.action === "view" && l.resource === "Guest" && l.at >= since(10 * 60_000)) {
      if (!views.has(l.actorId)) views.set(l.actorId, new Set());
      views.get(l.actorId)!.add(l.resourceId ?? "");
    }
    if (l.action === "reveal") a.reveals24h++;
    if (l.action === "export") {
      a.exports24h++;
      a.maxExportRows24h = Math.max(a.maxExportRows24h, Number((l.meta as { rows?: number } | null)?.rows ?? 0));
    }
    if (l.action === "denied" && l.at >= since(3_600_000)) {
      a.denied1h++;
      if (l.resource.includes("export")) a.deniedExports1h++;
    }
    if (l.action === "listen") a.listens24h++;
  }
  for (const [id, set] of views) get(id).distinctGuestViews10m = set.size;

  const failed = await db.loginAttempt.groupBy({ by: ["email"], where: { success: false, createdAt: { gte: since(15 * 60_000) } }, _count: true });
  const alerts = evaluateAnomalies([...byActor.values()], failed.map((f) => ({ key: f.email, failed15m: f._count })));

  const dayStart = new Date(`${new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(now)}T00:00:00+03:00`);
  let created = 0;
  for (const al of alerts) {
    const dup = await db.accessAlert.findFirst({ where: { rule: al.rule, actorId: al.actorId, at: { gte: dayStart } } });
    if (dup) continue;
    await db.accessAlert.create({ data: { rule: al.rule, severity: al.severity, actorId: al.actorId, detail: al.detail as Prisma.InputJsonValue } });
    created++;
  }
  return { evaluated: byActor.size, created };
}

/** İçe aktarma dosyalarının saklama süresi (docs/02 §1: 30 gün); hash ve meta kalır. */
export async function purgeImportFiles(now: Date) {
  const expired = await db.importBatch.findMany({ where: { storageKey: { not: null }, fileExpiresAt: { lte: now } }, select: { id: true, storageKey: true } });
  for (const b of expired) {
    await removeObject(b.storageKey!);
    await db.importBatch.update({ where: { id: b.id }, data: { storageKey: null } });
  }
  if (expired.length) await audit({ actorId: null, action: "retention.import_files", diff: { deleted: expired.length } });
  return { deleted: expired.length };
}
