import "server-only";
import { db } from "@/server/db";
import { can, scopeOf, type Principal } from "@/server/auth/rbac";
import { opsPanel, todayIso } from "@/server/services/reports";

/**
 * Role göre ana sayfa (dashboard). Her bölüm yalnız kullanıcının yetkisi olan veriyi okur:
 * kendi işi (call.make), operasyon (report.product), içe aktarma (import.view), finans (finance.view — yalnız
 * durum sayıları, tutar yok), personel (hr), yönetim (user.view / audit.view). Finansal veri hiçbir zaman
 * finans dışı bölümlere taşınmaz.
 */

export interface DayPoint {
  day: string; // YYYY-MM-DD (İstanbul)
  value: number;
}

/** Son `days` günün İstanbul günlerine göre çağrı sayısı (boş günler 0). */
async function callsPerDay(days: number, agentId?: string): Promise<DayPoint[]> {
  const since = new Date(Date.now() - days * 86_400_000);
  const rows = agentId
    ? await db.$queryRaw<{ d: string; n: bigint }[]>`
        SELECT to_char(("startedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Istanbul', 'YYYY-MM-DD') AS d, count(*) AS n
        FROM public."Call" WHERE "startedAt" >= ${since} AND "agentId" = ${agentId} GROUP BY 1`
    : await db.$queryRaw<{ d: string; n: bigint }[]>`
        SELECT to_char(("startedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Istanbul', 'YYYY-MM-DD') AS d, count(*) AS n
        FROM public."Call" WHERE "startedAt" >= ${since} GROUP BY 1`;
  const byDay = new Map(rows.map((r) => [r.d, Number(r.n)]));
  const out: DayPoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = todayIso(new Date(Date.now() - i * 86_400_000));
    out.push({ day, value: byDay.get(day) ?? 0 });
  }
  return out;
}

export async function dashboardData(user: Principal) {
  const today = todayIso();
  const dayStart = new Date(`${today}T00:00:00+03:00`);
  const dayEnd = new Date(`${today}T23:59:59.999+03:00`);
  const since24h = new Date(Date.now() - 86_400_000);

  const [myDay, ops, imports, finance, hr, admin] = await Promise.all([
    can(user, "call.make")
      ? (async () => {
          const [openTasks, callbacksToday, lateCallbacks, calls, trend] = await Promise.all([
            db.task.count({ where: { assigneeId: user.id, status: { in: ["OPEN", "IN_PROGRESS"] } } }),
            db.callback.count({ where: { assigneeId: user.id, status: "PENDING", scheduledAt: { gte: dayStart, lte: dayEnd } } }),
            db.callback.count({ where: { assigneeId: user.id, status: "PENDING", scheduledAt: { lt: new Date(Date.now() - 15 * 60_000) } } }),
            db.call.findMany({ where: { agentId: user.id, startedAt: { gte: dayStart } }, select: { talkSec: true, answeredAt: true } }),
            callsPerDay(14, user.id),
          ]);
          return {
            openTasks,
            callbacksToday,
            lateCallbacks,
            callsToday: calls.length,
            answeredToday: calls.filter((c) => c.answeredAt).length,
            talkSecToday: calls.reduce((s, c) => s + (c.talkSec ?? 0), 0),
            trend,
          };
        })()
      : null,
    can(user, "report.product")
      ? (async () => {
          const [panel, trend] = await Promise.all([opsPanel(), callsPerDay(14)]);
          return { cards: panel.cards, product: panel.product, teams: panel.teams, trend };
        })()
      : null,
    can(user, "import.view")
      ? (async () => {
          const [recent, reviewOpen] = await Promise.all([
            db.importBatch.findMany({ orderBy: { createdAt: "desc" }, take: 5, select: { id: true, fileName: true, status: true, createdAt: true, summary: true } }),
            db.reviewItem.count({ where: { status: "OPEN" } }),
          ]);
          return { recent, reviewOpen };
        })()
      : null,
    can(user, "finance.view")
      ? (async () => {
          const [periods, inReview, statementsPending, upcomingTrips, casinos] = await Promise.all([
            db.commissionPeriod.groupBy({ by: ["status"], _count: true }),
            db.commissionCalculation.count({ where: { status: "IN_REVIEW" } }),
            db.casinoStatement.count({ where: { appliedAt: null } }),
            db.trip.findMany({
              where: { startDate: { gte: dayStart, lte: new Date(Date.now() + 30 * 86_400_000) }, status: { not: "CANCELLED" } },
              orderBy: { startDate: "asc" },
              take: 5,
              select: { id: true, name: true, startDate: true, casino: { select: { id: true, name: true } }, _count: { select: { guests: true } } },
            }),
            db.casino.count(),
          ]);
          return { periods: Object.fromEntries(periods.map((p) => [p.status, p._count])) as Record<string, number>, inReview, statementsPending, upcomingTrips, casinos };
        })()
      : null,
    can(user, "hr.employee.view") || scopeOf(user, "attendance.view") === "all" || scopeOf(user, "attendance.view") === "team"
      ? (async () => {
          const todayDate = new Date(`${today}T00:00:00Z`);
          const [leavePending, shiftsToday, employees] = await Promise.all([
            db.leaveRequest.count({ where: { status: { notIn: ["APPROVED", "REJECTED", "CANCELLED"] } } }),
            db.rosterAssignment.count({ where: { date: todayDate, kind: { in: ["WORK", "FIELD"] }, roster: { publishedAt: { not: null } } } }),
            db.employee.count({ where: { status: "ACTIVE" } }),
          ]);
          return { leavePending, shiftsToday, employees };
        })()
      : null,
    can(user, "user.view") || can(user, "audit.view")
      ? (async () => {
          const [usersActive, noMfa, alertsOpen, denied24h] = await Promise.all([
            db.user.count({ where: { status: "ACTIVE" } }),
            db.user.count({ where: { status: "ACTIVE", mfaEnabledAt: null } }),
            db.accessAlert.count({ where: { resolvedAt: null } }),
            db.accessLog.count({ where: { action: "denied", at: { gte: since24h } } }),
          ]);
          return { usersActive, noMfa, alertsOpen, denied24h };
        })()
      : null,
  ]);

  return { today, myDay, ops, imports, finance, hr, admin };
}
