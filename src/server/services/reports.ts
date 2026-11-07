import "server-only";
import { db } from "@/server/db";
import { userScopeWhere, type Principal } from "@/server/auth/rbac";
import { agentKpi, callbackKpi, percentiles, type AgentKpi, type CallFact } from "@/lib/kpi";

/**
 * Rapor ve panel verisi (docs/05). Günler İstanbul saatine göre; çağrı startedAt gününe aittir.
 * Kapsam: report.view → own/team/all. Finansal veri okunmaz.
 */

export function istanbulDayRange(fromIso: string, toIso: string) {
  return { gte: new Date(`${fromIso}T00:00:00+03:00`), lte: new Date(`${toIso}T23:59:59.999+03:00`) };
}

export function todayIso(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(now);
}

async function dispositionsMeta() {
  return (await db.disposition.findMany()).map((d) => ({ code: d.code, category: d.category, noteRequired: d.noteRequired }));
}

export interface AgentRow {
  userId: string;
  name: string;
  team: string | null;
  kpi: AgentKpi;
  assignedTasks: number;
  doneTasks: number;
  callbacks: ReturnType<typeof callbackKpi>;
}

/** Personel/ekip raporu: kapsamdaki her kullanıcı için docs/05 §3 KPI'ları. */
export async function agentReport(user: Principal, from: string, to: string) {
  const range = istanbulDayRange(from, to);
  const agents = await db.user.findMany({
    where: { AND: [userScopeWhere(user, "report.view"), { roles: { some: { role: { permissions: { some: { permission: "call.make" } } } } } }] },
    select: { id: true, name: true, team: { select: { name: true } } },
    orderBy: { name: "asc" },
  });
  const ids = agents.map((a) => a.id);
  const [calls, callbacks, assigned, done, meta] = await Promise.all([
    db.call.findMany({
      where: { agentId: { in: ids }, startedAt: range },
      select: { agentId: true, phoneId: true, taskId: true, answeredAt: true, disposition: true, talkSec: true, ringSec: true, wrapSec: true, autoClosed: true, noteLength: true },
    }),
    db.callback.findMany({ where: { assigneeId: { in: ids }, scheduledAt: range }, select: { assigneeId: true, scheduledAt: true, status: true, doneCallId: true } }),
    db.task.groupBy({ by: ["assigneeId"], where: { assigneeId: { in: ids }, assignedAt: range }, _count: true }),
    db.task.groupBy({ by: ["assigneeId"], where: { assigneeId: { in: ids }, status: "DONE", updatedAt: range }, _count: true }),
    dispositionsMeta(),
  ]);
  const doneCallIds = callbacks.map((c) => c.doneCallId).filter((x): x is string => !!x);
  const doneCalls = new Map(
    (await db.call.findMany({ where: { id: { in: doneCallIds } }, select: { id: true, startedAt: true } })).map((c) => [c.id, c.startedAt]),
  );

  const facts: CallFact[] = calls.map((c) => ({
    agentId: c.agentId, phoneId: c.phoneId, taskId: c.taskId, answered: !!c.answeredAt, disposition: c.disposition,
    talkSec: c.talkSec, ringSec: c.ringSec, wrapSec: c.wrapSec, autoClosed: c.autoClosed, noteLength: c.noteLength,
  }));
  const rows: AgentRow[] = agents.map((a) => ({
    userId: a.id,
    name: a.name,
    team: a.team?.name ?? null,
    kpi: agentKpi(facts.filter((f) => f.agentId === a.id), meta),
    assignedTasks: assigned.find((x) => x.assigneeId === a.id)?._count ?? 0,
    doneTasks: done.find((x) => x.assigneeId === a.id)?._count ?? 0,
    callbacks: callbackKpi(
      callbacks
        .filter((c) => c.assigneeId === a.id)
        .map((c) => ({ assigneeId: c.assigneeId, scheduledAt: c.scheduledAt, status: c.status, firstAttemptAt: c.doneCallId ? doneCalls.get(c.doneCallId) ?? null : null })),
    ),
  }));
  const total = {
    kpi: agentKpi(facts, meta),
    callbacks: callbackKpi(callbacks.map((c) => ({ ...c, firstAttemptAt: c.doneCallId ? doneCalls.get(c.doneCallId) ?? null : null }))),
    assignedTasks: rows.reduce((s, r) => s + r.assignedTasks, 0),
    doneTasks: rows.reduce((s, r) => s + r.doneTasks, 0),
  };
  return { rows, total };
}

/** Operasyon paneli kartları (docs/05 §7) ve ürün metrikleri (§6). */
export async function opsPanel(now = new Date()) {
  const today = todayIso(now);
  const dayEnd = new Date(`${today}T23:59:59.999+03:00`);
  const late = new Date(now.getTime() - 15 * 60_000);
  const since30 = new Date(now.getTime() - 30 * 86_400_000);
  const since24h = new Date(now.getTime() - 86_400_000);

  const [
    openTasksToday, callbacksToday, lateCallbacks, missedCallbacks, consentUnknown, guestsActive, importIssues, reviewOpen, alertsOpen, denied24h,
    teams, blocks30, imports30, callbacks30, calls30,
  ] = await Promise.all([
    db.task.count({ where: { type: "CALL", status: { in: ["OPEN", "IN_PROGRESS"] }, OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: dayEnd } }] } }),
    db.callback.count({ where: { status: "PENDING", scheduledAt: { gte: new Date(`${today}T00:00:00+03:00`), lte: dayEnd } } }),
    db.callback.count({ where: { status: "PENDING", scheduledAt: { lt: late, gte: since24h } } }),
    db.callback.count({ where: { status: "PENDING", scheduledAt: { lt: since24h } } }),
    db.guest.count({ where: { anonymizedAt: null, NOT: { consents: { some: { channel: "CALL", status: { in: ["GRANTED", "DENIED"] } } } } } }),
    db.guest.count({ where: { anonymizedAt: null } }),
    db.importBatch.findMany({
      where: { createdAt: { gte: since30 }, status: { in: ["PREVIEWED", "APPLIED"] } },
      select: { id: true, fileName: true, summary: true, status: true },
      orderBy: { createdAt: "desc" },
    }),
    db.reviewItem.groupBy({ by: ["kind"], where: { status: "OPEN" }, _count: true }),
    db.accessAlert.count({ where: { resolvedAt: null } }),
    db.accessLog.count({ where: { action: "denied", at: { gte: since24h } } }),
    db.team.findMany({
      select: {
        id: true, name: true,
        members: {
          where: { status: "ACTIVE" },
          select: {
            id: true,
            tasks: { where: { status: { in: ["OPEN", "IN_PROGRESS"] } }, select: { id: true } },
            calls: { where: { startedAt: { gte: new Date(`${today}T00:00:00+03:00`) } }, select: { talkSec: true, disposition: true, autoClosed: true } },
          },
        },
      },
      orderBy: { name: "asc" },
    }),
    db.contactBlock.findMany({ where: { recordedAt: { gte: since30 } }, select: { requestedAt: true, recordedAt: true } }),
    db.importBatch.findMany({ where: { createdAt: { gte: since30 }, status: { in: ["PREVIEWED", "APPLIED", "ROLLED_BACK"] } }, select: { summary: true } }),
    db.callback.findMany({ where: { scheduledAt: { gte: since30, lte: now } }, select: { assigneeId: true, scheduledAt: true, status: true, doneCallId: true } }),
    db.call.findMany({ where: { startedAt: { gte: since30 } }, select: { disposition: true, autoClosed: true, noteLength: true } }),
  ]);

  const meta = await dispositionsMeta();
  const reachedCodes = new Set(meta.filter((m) => m.category === "REACHED").map((m) => m.code));
  const noteReq = new Set(meta.filter((m) => m.noteRequired).map((m) => m.code));

  const teamRows = teams.map((t) => {
    const calls = t.members.flatMap((m) => m.calls);
    const openTasks = t.members.reduce((s, m) => s + m.tasks.length, 0);
    const reached = calls.filter((c) => c.disposition && reachedCodes.has(c.disposition) && c.disposition !== "WRONG_PERSON").length;
    const dnc = calls.filter((c) => c.disposition === "DO_NOT_CONTACT").length;
    return {
      name: t.name,
      activeAgents: t.members.length,
      openTasks,
      tasksPerAgent: t.members.length ? openTasks / t.members.length : null,
      callsToday: calls.length,
      talkSecToday: calls.filter((c) => !c.autoClosed).reduce((s, c) => s + (c.talkSec ?? 0), 0),
      reachRate: calls.length ? reached / calls.length : null,
      rejectRate: reached ? dnc / reached : null,
      missingRate: calls.length ? calls.filter((c) => c.autoClosed && !c.disposition).length / calls.length : null,
    };
  });

  const doneIds = callbacks30.map((c) => c.doneCallId).filter((x): x is string => !!x);
  const doneAt = new Map((await db.call.findMany({ where: { id: { in: doneIds } }, select: { id: true, startedAt: true } })).map((c) => [c.id, c.startedAt]));
  const cb30 = callbackKpi(callbacks30.map((c) => ({ ...c, firstAttemptAt: c.doneCallId ? doneAt.get(c.doneCallId) ?? null : null })));

  const sums = imports30.reduce(
    (a, b) => {
      const s = (b.summary ?? {}) as Record<string, number>;
      a.rows += s.rowCount ?? 0;
      a.bad += (s.invalid ?? 0) + (s.multi ?? 0) + (s.possible ?? 0);
      a.dup += s.dupInFile ?? 0;
      return a;
    },
    { rows: 0, bad: 0, dup: 0 },
  );
  const withNoteReq = calls30.filter((c) => c.disposition && noteReq.has(c.disposition));
  const missingDisp = calls30.filter((c) => c.autoClosed && !c.disposition).length;
  const missingNote = withNoteReq.filter((c) => c.noteLength < 10).length;
  const reflection = percentiles(blocks30.map((b) => Math.max(0, (b.recordedAt.getTime() - b.requestedAt.getTime()) / 1000)));
  const exportDenied30 = await db.accessLog.count({ where: { action: "denied", at: { gte: since30 }, resource: { contains: "export" } } });

  return {
    cards: {
      pendingToday: openTasksToday + callbacksToday,
      openTasksToday,
      callbacksToday,
      lateCallbacks,
      missedCallbacks,
      consentUnknown,
      guestsActive,
      importIssues: importIssues.filter((b) => ((b.summary ?? {}) as Record<string, number>).invalid > 0),
      review: Object.fromEntries(reviewOpen.map((r) => [r.kind, r._count])) as Record<string, number>,
      alertsOpen,
      denied24h,
    },
    teams: teamRows,
    product: {
      badRowRate: sums.rows ? sums.bad / sums.rows : null,
      dupRate: sums.rows ? sums.dup / sums.rows : null,
      // docs/05 §6: 1 − (eksik sonuç kodu oranı + eksik not oranı)
      completeness: calls30.length ? 1 - (missingDisp / calls30.length + (withNoteReq.length ? missingNote / withNoteReq.length : 0)) : null,
      callbackOnTime: cb30.onTimeRate,
      reflection,
      exportDenied30,
    },
  };
}
