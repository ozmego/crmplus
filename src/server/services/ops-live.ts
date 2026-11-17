import "server-only";
import { db } from "@/server/db";
import { capacityGrid, forecast, hourlyBuckets } from "@/lib/capacity";
import { addDays, atMinute, dbDate, fromDbDate, istDate, weekStartOf } from "@/lib/hr/time";

/**
 * Gerçek zamanlı kanal panosu (Aşama 2): çağrı, SMS ve WhatsApp için toplulaştırılmış anlık durum.
 * Kişi bazlı içerik, misafir adı veya temsilci sıralaması yoktur.
 */
export async function liveChannels(now = new Date()) {
  const today = istDate(now);
  const dayStart = new Date(`${today}T00:00:00+03:00`);
  const hourAgo = new Date(now.getTime() - 3600_000);
  const nextHour = new Date(now.getTime() + 3600_000);

  const [statuses, openCalls, callsToday, openTasks, cbDue, cbLate, sms, smsIn, wa, waIn, convs, optOuts, incidents] = await Promise.all([
    db.agentStatusLog.findMany({ where: { at: { gte: dayStart } }, orderBy: { at: "desc" }, distinct: ["userId"], select: { status: true } }),
    db.call.count({ where: { startedAt: { gte: dayStart }, closedAt: null, endedAt: null } }),
    db.call.findMany({ where: { startedAt: { gte: dayStart } }, select: { startedAt: true, talkSec: true, disposition: true, autoClosed: true } }),
    db.task.count({ where: { status: { in: ["OPEN", "IN_PROGRESS"] } } }),
    db.callback.count({ where: { status: "PENDING", scheduledAt: { gte: now, lt: nextHour } } }),
    db.callback.count({ where: { status: "PENDING", scheduledAt: { lt: new Date(now.getTime() - 15 * 60_000), gte: dayStart } } }),
    db.message.groupBy({ by: ["status"], where: { channel: "SMS", direction: "OUT", isTest: false, createdAt: { gte: dayStart } }, _count: true }),
    db.message.count({ where: { channel: "SMS", direction: "IN", createdAt: { gte: dayStart } } }),
    db.message.groupBy({ by: ["status"], where: { channel: "WHATSAPP", direction: "OUT", isTest: false, createdAt: { gte: dayStart } }, _count: true }),
    db.message.count({ where: { channel: "WHATSAPP", direction: "IN", createdAt: { gte: dayStart } } }),
    db.conversation.findMany({ where: { status: "OPEN" }, select: { unread: true, lastInboundAt: true, optOutSuspect: true, assigneeId: true } }),
    db.optOutEvent.groupBy({ by: ["channel"], where: { receivedAt: { gte: dayStart } }, _count: true }),
    db.telephonyIncident.count({ where: { at: { gte: hourAgo } } }),
  ]);
  const agentBy = (s: string) => statuses.filter((x) => x.status === s).length;
  const by = (rows: { status: string; _count: number }[]) => Object.fromEntries(rows.map((r) => [r.status, r._count])) as Record<string, number>;
  const windowOpen = convs.filter((c) => c.lastInboundAt && c.lastInboundAt.getTime() > now.getTime() - 86_400_000).length;

  return {
    at: now,
    agents: { ready: agentBy("READY"), onCall: agentBy("ON_CALL") + agentBy("WRAP_UP"), onBreak: agentBy("BREAK"), offline: agentBy("OFFLINE") },
    calls: {
      open: openCalls,
      today: callsToday.length,
      talkSec: callsToday.filter((c) => !c.autoClosed).reduce((s, c) => s + (c.talkSec ?? 0), 0),
      byHour: hourlyBuckets(callsToday.map((c) => c.startedAt)),
      openTasks,
      callbacksNextHour: cbDue,
      callbacksLate: cbLate,
      incidentsLastHour: incidents,
    },
    sms: { status: by(sms), inbound: smsIn },
    whatsapp: {
      status: by(wa),
      inbound: waIn,
      openConversations: convs.length,
      unread: convs.reduce((s, c) => s + c.unread, 0),
      unassigned: convs.filter((c) => !c.assigneeId).length,
      windowOpen,
      optOutSuspect: convs.filter((c) => c.optOutSuspect).length,
    },
    optOuts: Object.fromEntries(optOuts.map((o) => [o.channel, o._count])) as Record<string, number>,
  };
}

/**
 * Kapasite planı: son `weeks` haftanın çağrı denemeleri ve ortalama işlem süresinden saatlik gereken temsilci;
 * hedef haftanın yayınlanmış çizelgesindeki çağrı merkezi vardiyalarıyla karşılaştırılır.
 */
export async function capacityPlan(weekStartInput: string, opts: { weeks?: number; occupancy?: number } = {}) {
  const weekStart = weekStartOf(weekStartInput);
  const weeks = opts.weeks ?? 4;
  const histEnd = new Date(`${weekStartOf(istDate(new Date()))}T00:00:00+03:00`);
  const histStart = new Date(histEnd.getTime() - weeks * 7 * 86_400_000);
  const calls = await db.call.findMany({
    where: { startedAt: { gte: histStart, lt: histEnd }, closedAt: { not: null }, autoClosed: false },
    select: { startedAt: true, ringSec: true, talkSec: true, wrapSec: true },
  });
  const f = forecast(calls.map((c) => ({ startedAt: c.startedAt, handleSec: (c.ringSec ?? 0) + (c.talkSec ?? 0) + Math.min(c.wrapSec ?? 0, 600) })), weeks);

  const assignments = await db.rosterAssignment.findMany({
    where: { date: { gte: dbDate(weekStart), lte: dbDate(addDays(weekStart, 6)) }, kind: "WORK", roster: { publishedAt: { not: null } }, employee: { department: "CALL_CENTER", status: "ACTIVE" } },
    select: { date: true, startMin: true, endMin: true },
  });
  const planned = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const a of assignments) {
    if (a.startMin == null || a.endMin == null) continue;
    const date = fromDbDate(a.date);
    const end = a.endMin <= a.startMin ? a.endMin + 1440 : a.endMin;
    const s = atMinute(date, a.startMin).getTime();
    const e = atMinute(date, end).getTime();
    for (let d = 0; d < 7; d++) {
      for (let h = 0; h < 24; h++) {
        const t0 = atMinute(addDays(weekStart, d), h * 60).getTime();
        if (s < t0 + 3600_000 && e > t0) planned[d][h] += 1;
      }
    }
  }
  return { weekStart, weeks, sampleCalls: calls.length, ahtSec: Math.round(f.ahtSec), occupancy: opts.occupancy ?? 0.8, grid: capacityGrid(f, planned, opts.occupancy ?? 0.8) };
}
