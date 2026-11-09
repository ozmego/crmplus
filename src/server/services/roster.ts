import "server-only";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import type { Principal } from "@/server/auth/rbac";
import { hrParams } from "@/server/services/settings";
import { canActOnScope, HrError, myEmployee } from "@/server/services/hr";
import { checkRoster, type Cell } from "@/lib/hr/roster";
import type { PlanKind } from "@/lib/hr/attendance";
import { addDays, dbDate, fromDbDate, weekStartOf } from "@/lib/hr/time";

/**
 * Haftalık vardiya çizelgesi: kapsam (ekip / GENEL) × hafta. Taslak düzenlenir, kurallar uyarır, yayınlanır.
 * Yayınlanmış çizelgede değişiklik durumu CHANGED yapar; yeniden yayınlama yeni sürüm üretir ve değişen
 * hücreler personelin “Çizelgem” ekranında işaretlenir.
 */

const employeesFor = (scope: string) =>
  db.employee.findMany({ where: { status: "ACTIVE", teamId: scope === "GENEL" ? null : scope }, orderBy: [{ department: "asc" }, { lastName: "asc" }] });

export async function coverageTarget(): Promise<number> {
  return (await hrParams()).coverageTarget;
}

export async function getRosterWeek(weekStartInput: string, scope: string) {
  const weekStart = weekStartOf(weekStartInput);
  const weekEnd = addDays(weekStart, 6);
  const [employees, roster, templates] = await Promise.all([
    employeesFor(scope),
    db.roster.findUnique({ where: { weekStart_scope: { weekStart: dbDate(weekStart), scope } } }),
    db.shiftTemplate.findMany({ where: { active: true }, orderBy: { startMin: "asc" } }),
  ]);
  const ids = employees.map((e) => e.id);
  const [assignments, prevLast, leaves] = await Promise.all([
    db.rosterAssignment.findMany({ where: { employeeId: { in: ids }, date: { gte: dbDate(weekStart), lte: dbDate(weekEnd) } } }),
    db.rosterAssignment.findMany({ where: { employeeId: { in: ids }, date: dbDate(addDays(weekStart, -1)) } }),
    db.leaveRequest.findMany({ where: { employeeId: { in: ids }, status: "APPROVED", startDate: { lte: dbDate(weekEnd) }, endDate: { gte: dbDate(weekStart) } } }),
  ]);
  const toCell = (a: (typeof assignments)[number]): Cell => ({ employeeId: a.employeeId, date: fromDbDate(a.date), kind: a.kind as PlanKind, startMin: a.startMin, endMin: a.endMin, breakMin: a.breakMin });
  const check = checkRoster({
    weekStart,
    employees: employees.map((e) => ({ id: e.id, name: `${e.firstName} ${e.lastName}`, weeklyHours: e.weeklyHours, department: e.department })),
    cells: assignments.map(toCell),
    prevWeekLast: prevLast.map(toCell),
    leaves: leaves.map((l) => ({ employeeId: l.employeeId, from: fromDbDate(l.startDate), to: fromDbDate(l.endDate) })),
    coverageTarget: await coverageTarget(),
  });
  return { weekStart, employees, roster, templates, assignments, leaves, ...check };
}

function assertScope(user: Principal, scope: string) {
  if (!canActOnScope(user, "roster.manage", scope)) throw new HrError("FORBIDDEN");
}

async function ensureRoster(user: Principal, weekStart: string, scope: string) {
  return db.roster.upsert({
    where: { weekStart_scope: { weekStart: dbDate(weekStart), scope } },
    update: {},
    create: { weekStart: dbDate(weekStart), scope, createdBy: user.id },
  });
}

/** Hücre değeri: "" (boş) · OFF · LEAVE · W:<şablon> (iş) · E:<şablon> (eğitim) · S:<şablon> (saha) */
export async function setCell(user: Principal, a: { weekStart: string; scope: string; employeeId: string; date: string; value: string }) {
  assertScope(user, a.scope);
  const weekStart = weekStartOf(a.weekStart);
  if (a.date < weekStart || a.date > addDays(weekStart, 6)) throw new HrError("BAD_DATE");
  const emp = await db.employee.findUniqueOrThrow({ where: { id: a.employeeId } });
  if ((emp.teamId ?? "GENEL") !== a.scope) throw new HrError("FORBIDDEN");
  const roster = await ensureRoster(user, weekStart, a.scope);
  const key = { employeeId_date: { employeeId: a.employeeId, date: dbDate(a.date) } };

  if (!a.value) {
    await db.rosterAssignment.deleteMany({ where: { employeeId: a.employeeId, date: dbDate(a.date) } });
  } else {
    let data: { kind: string; templateId: string | null; startMin: number | null; endMin: number | null; breakMin: number | null };
    if (a.value === "OFF" || a.value === "LEAVE") data = { kind: a.value, templateId: null, startMin: null, endMin: null, breakMin: null };
    else {
      const [k, tid] = a.value.split(":");
      const kind = ({ W: "WORK", E: "TRAINING", S: "FIELD" } as Record<string, string>)[k];
      const t = tid ? await db.shiftTemplate.findUnique({ where: { id: tid } }) : null;
      if (!kind || !t) throw new HrError("BAD_VALUE");
      data = { kind, templateId: t.id, startMin: t.startMin, endMin: t.endMin, breakMin: t.breakMin };
    }
    await db.rosterAssignment.upsert({ where: key, update: { ...data, rosterId: roster.id }, create: { ...data, rosterId: roster.id, employeeId: a.employeeId, date: dbDate(a.date) } });
  }
  if (roster.status === "PUBLISHED") await db.roster.update({ where: { id: roster.id }, data: { status: "CHANGED" } });
}

export async function copyPreviousWeek(user: Principal, weekStartInput: string, scope: string) {
  assertScope(user, scope);
  const weekStart = weekStartOf(weekStartInput);
  const prevStart = addDays(weekStart, -7);
  const employees = await employeesFor(scope);
  const prev = await db.rosterAssignment.findMany({ where: { employeeId: { in: employees.map((e) => e.id) }, date: { gte: dbDate(prevStart), lte: dbDate(addDays(prevStart, 6)) } } });
  if (!prev.length) throw new HrError("NOTHING_TO_COPY");
  const roster = await ensureRoster(user, weekStart, scope);
  const leaves = await db.leaveRequest.findMany({ where: { employeeId: { in: employees.map((e) => e.id) }, status: "APPROVED", startDate: { lte: dbDate(addDays(weekStart, 6)) }, endDate: { gte: dbDate(weekStart) } } });
  let n = 0;
  for (const p of prev) {
    const date = addDays(fromDbDate(p.date), 7);
    // Onaylı izin günlerine vardiya kopyalanmaz; izin olarak işaretlenir
    const onLeave = leaves.some((l) => l.employeeId === p.employeeId && fromDbDate(l.startDate) <= date && date <= fromDbDate(l.endDate));
    const data = onLeave
      ? { kind: "LEAVE", templateId: null, startMin: null, endMin: null, breakMin: null }
      : { kind: p.kind, templateId: p.templateId, startMin: p.startMin, endMin: p.endMin, breakMin: p.breakMin };
    await db.rosterAssignment.upsert({
      where: { employeeId_date: { employeeId: p.employeeId, date: dbDate(date) } },
      update: { ...data, rosterId: roster.id },
      create: { ...data, rosterId: roster.id, employeeId: p.employeeId, date: dbDate(date) },
    });
    n++;
  }
  if (roster.status === "PUBLISHED") await db.roster.update({ where: { id: roster.id }, data: { status: "CHANGED" } });
  return n;
}

/** Yayınla: kural uyarısı varsa gerekçe zorunlu; her yayın sürüm numarasını artırır. */
export async function publishRoster(user: Principal, weekStartInput: string, scope: string, reason?: string) {
  if (!canActOnScope(user, "roster.publish", scope)) throw new HrError("FORBIDDEN");
  const week = await getRosterWeek(weekStartInput, scope);
  if (!week.roster || !week.assignments.length) throw new HrError("EMPTY_ROSTER");
  if (week.roster.status === "PUBLISHED") throw new HrError("ALREADY_PUBLISHED");
  if (week.warnings.length && (reason ?? "").trim().length < 5) throw new HrError("WARNINGS_NEED_REASON");
  const r = await db.roster.update({
    where: { id: week.roster.id },
    data: { status: "PUBLISHED", version: { increment: 1 }, prevPublishedAt: week.roster.publishedAt, publishedAt: new Date(), publishedBy: user.id, overrideReason: week.warnings.length ? reason!.trim() : null },
  });
  await audit({
    actorId: user.id, action: "hr.roster.publish", entity: "Roster", entityId: r.id, reason: reason || undefined,
    diff: { weekStart: week.weekStart, scope, version: r.version, warnings: week.warnings.map((w) => w.code) },
  });
  return r;
}

/** Çizelgem: yalnız yayınlanmış sürüm; son yayından önceki sürüme göre değişen günler işaretlenir. */
export async function myWeek(userId: string, weekStartInput: string) {
  const emp = await myEmployee(userId);
  if (!emp) return null;
  const weekStart = weekStartOf(weekStartInput);
  const rows = await db.rosterAssignment.findMany({
    where: { employeeId: emp.id, date: { gte: dbDate(weekStart), lte: dbDate(addDays(weekStart, 6)) }, roster: { publishedAt: { not: null } } },
    include: { roster: true },
  });
  const templates = new Map((await db.shiftTemplate.findMany()).map((t) => [t.id, t.name]));
  return {
    employee: emp,
    weekStart,
    days: rows.map((a) => ({
      date: fromDbDate(a.date),
      kind: a.kind,
      startMin: a.startMin,
      endMin: a.endMin,
      template: a.templateId ? templates.get(a.templateId) ?? null : null,
      // Yalnız yayınlanmış hâliyle gösterilir; yeniden yayından sonra güncellenen hücre “değişti” sayılır
      pendingChange: a.roster.status === "CHANGED" && a.updatedAt > (a.roster.publishedAt ?? new Date(0)),
      changed: !!a.roster.prevPublishedAt && a.roster.status === "PUBLISHED" && a.updatedAt > a.roster.prevPublishedAt,
      version: a.roster.version,
    })),
  };
}
