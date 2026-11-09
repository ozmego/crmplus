import "server-only";
import ExcelJS from "exceljs";
import type { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { audit, logAccess } from "@/server/audit";
import type { Principal } from "@/server/auth/rbac";
import { hrParams } from "@/server/services/settings";
import { canActOnScope, DEPARTMENTS, employeeScopeWhere, HrError, scopeKeyOf } from "@/server/services/hr";
import { computeDay, deriveTimes, monthTotals, weeklyOvertime, type DayPlan, type LeaveCode, type WorkEvent } from "@/lib/hr/attendance";
import { addDays, daysOfMonth, dbDate, fromDbDate, istDate, weekStartOf } from "@/lib/hr/time";

/**
 * Puantaj: sistem olaylarından otomatik hesap + gerekçeli düzeltme + aylık onay/kilit (docs/11).
 * Düzeltmeler değiştirilemez kayıttır ve her yeniden hesapta sistem değerinin üzerine yeniden uygulanır.
 */

type Employee = Prisma.EmployeeGetPayload<object>;
const ADJUSTABLE = ["firstIn", "lastOut", "breakMin", "code"] as const;
export type AdjustField = (typeof ADJUSTABLE)[number];

async function periodStatus(month: string, scope: string) {
  return (await db.timesheetPeriod.findUnique({ where: { month_scope: { month, scope } } }))?.status ?? "OPEN";
}

/** Olay kaynakları: oturum açma/son etkinlik/kapatma, çağrı merkezi durumları, saha check-in/out. */
async function eventsFor(e: Employee, from: Date, to: Date): Promise<WorkEvent[]> {
  const ev: WorkEvent[] = [];
  if (e.userId) {
    const [sessions, statuses] = await Promise.all([
      db.session.findMany({ where: { userId: e.userId, OR: [{ createdAt: { gte: from, lt: to } }, { lastSeenAt: { gte: from, lt: to } }] }, select: { createdAt: true, lastSeenAt: true, revokedAt: true } }),
      db.agentStatusLog.findMany({ where: { userId: e.userId, at: { gte: from, lt: to } }, select: { at: true, status: true } }),
    ]);
    for (const s of sessions) {
      ev.push({ at: s.createdAt, type: "LOGIN" });
      if (s.lastSeenAt > s.createdAt) ev.push({ at: s.lastSeenAt, type: "ACTIVITY" });
      if (s.revokedAt) ev.push({ at: s.revokedAt, type: "LOGOUT" });
    }
    for (const s of statuses) ev.push({ at: s.at, type: s.status as WorkEvent["type"] });
  }
  const stops = await db.routeStop.findMany({ where: { route: { employeeId: e.id }, OR: [{ checkInAt: { gte: from, lt: to } }, { checkOutAt: { gte: from, lt: to } }] }, select: { checkInAt: true, checkOutAt: true } });
  for (const s of stops) {
    if (s.checkInAt) ev.push({ at: s.checkInAt, type: "CHECK_IN" });
    if (s.checkOutAt) ev.push({ at: s.checkOutAt, type: "CHECK_OUT" });
  }
  return ev.filter((x) => x.at >= from && x.at < to);
}

/** [from, to] günlerini hesaplar; fazla mesai için aralık tam haftalara genişletilir. Kilitli/onaylı aylar atlanır. */
export async function computeEmployeeRange(employeeId: string, fromDate: string, toDate: string) {
  const e = await db.employee.findUniqueOrThrow({ where: { id: employeeId } });
  const params = await hrParams();
  const start = weekStartOf(fromDate);
  const end = addDays(weekStartOf(toDate), 6);
  const hireDate = fromDbDate(e.hireDate);
  const exitDate = e.exitDate ? fromDbDate(e.exitDate) : null;

  const [assignments, leaves, holidays, existing] = await Promise.all([
    db.rosterAssignment.findMany({ where: { employeeId, date: { gte: dbDate(addDays(start, -1)), lte: dbDate(end) }, roster: { publishedAt: { not: null } } } }),
    db.leaveRequest.findMany({ where: { employeeId, status: "APPROVED", startDate: { lte: dbDate(end) }, endDate: { gte: dbDate(start) } }, include: { type: true } }),
    db.publicHoliday.findMany({ where: { date: { gte: dbDate(start), lte: dbDate(end) } } }),
    db.attendanceDay.findMany({ where: { employeeId, date: { gte: dbDate(start), lte: dbDate(end) } }, include: { adjustments: { orderBy: { at: "asc" } } } }),
  ]);
  const events = await eventsFor(e, new Date(Date.parse(`${addDays(start, -1)}T00:00:00+03:00`)), new Date(Date.parse(`${addDays(end, 2)}T00:00:00+03:00`)));
  const planOf = new Map(assignments.map((a) => [fromDbDate(a.date), { kind: a.kind, startMin: a.startMin, endMin: a.endMin, breakMin: a.breakMin } as DayPlan]));
  const holidayOf = new Map(holidays.map((h) => [fromDbDate(h.date), { name: h.name, halfDay: h.halfDay }]));
  const existingOf = new Map(existing.map((d) => [fromDbDate(d.date), d]));
  const frozen = new Map<string, boolean>();
  const isFrozen = async (date: string) => {
    const m = date.slice(0, 7);
    if (!frozen.has(m)) frozen.set(m, ["APPROVED", "LOCKED"].includes(await periodStatus(m, scopeKeyOf(e))));
    return frozen.get(m)!;
  };

  // Önceki günün gece devreden vardiyası
  const prev = computeDay({ date: addDays(start, -1), plan: planOf.get(addDays(start, -1)) ?? null, events, windowMin: params.windowMin });
  let claimedUntil = prev.windowEnd;
  const rows: { date: string; r: ReturnType<typeof computeDay> & { overtimeMin?: number }; adjusted: boolean }[] = [];

  for (let date = start; date <= end; date = addDays(date, 1)) {
    if (date < hireDate || (exitDate && date > exitDate)) {
      claimedUntil = null;
      continue;
    }
    const leave = leaves.find((l) => fromDbDate(l.startDate) <= date && date <= fromDbDate(l.endDate));
    const r = computeDay({
      date, plan: planOf.get(date) ?? null, events, claimedUntil,
      leave: leave ? { code: leave.type.code as LeaveCode, halfDay: leave.halfDay } : null,
      holiday: holidayOf.get(date) ?? null, toleranceMin: params.toleranceMin, windowMin: params.windowMin,
    });
    claimedUntil = r.windowEnd;
    // Düzeltmeleri sistem değerinin üzerine yeniden uygula
    const adj = existingOf.get(date)?.adjustments ?? [];
    let source: string = r.source;
    for (const a of adj) {
      if (a.field === "firstIn") r.firstIn = a.newValue ? new Date(a.newValue) : null;
      if (a.field === "lastOut") r.lastOut = a.newValue ? new Date(a.newValue) : null;
      if (a.field === "breakMin") r.breakMin = Number(a.newValue);
      if (a.field === "code") r.code = a.newValue;
      if (a.field === "firstIn" || a.field === "lastOut") source = "MANUAL";
    }
    if (adj.length) {
      Object.assign(r, deriveTimes({ firstIn: r.firstIn, lastOut: r.lastOut, breakMin: r.breakMin, planStart: r.planStart, planEnd: r.planEnd, toleranceMin: params.toleranceMin }));
      if (adj.some((a) => a.field === "code")) r.flags = r.flags.filter((f) => f !== "ABSENT_SUGGESTED");
      if (holidayOf.get(date) && !holidayOf.get(date)!.halfDay) r.holidayWorkMin = r.workedMin;
    }
    r.source = source as "SYSTEM";
    rows.push({ date, r, adjusted: adj.length > 0 });
  }

  // Haftalık fazla mesai
  for (let w = start; w <= end; w = addDays(w, 7)) {
    const wk = rows.filter((x) => x.date >= w && x.date <= addDays(w, 6));
    const ot = weeklyOvertime(wk.map((x) => ({ date: x.date, workedMin: x.r.workedMin, holidayWorkMin: x.r.holidayWorkMin })), e.weeklyHours);
    for (const x of wk) x.r.overtimeMin = ot.get(x.date) ?? 0;
  }

  for (const { date, r, adjusted } of rows) {
    if (date < fromDate || date > toDate) continue;
    if (await isFrozen(date)) continue;
    const data = {
      planStart: r.planStart, planEnd: r.planEnd, firstIn: r.firstIn, lastOut: r.lastOut, workedMin: r.workedMin, breakMin: r.breakMin,
      lateMin: r.lateMin, earlyMin: r.earlyMin, overtimeMin: r.overtimeMin ?? 0, holidayWorkMin: r.holidayWorkMin, code: r.code,
      source: r.source, flags: r.flags, adjusted, computedAt: new Date(),
    };
    await db.attendanceDay.upsert({ where: { employeeId_date: { employeeId, date: dbDate(date) } }, update: data, create: { ...data, employeeId, date: dbDate(date) } });
  }
  return rows.length;
}

export async function recomputeMonth(user: Principal | null, month: string, scope: string) {
  if (user && !canActOnScope(user, "attendance.adjust", scope) && !canActOnScope(user, "timesheet.prepare", scope)) throw new HrError("FORBIDDEN");
  const days = daysOfMonth(month);
  const emps = await db.employee.findMany({ where: { teamId: scope === "GENEL" ? null : scope, hireDate: { lte: dbDate(days[days.length - 1]) }, OR: [{ exitDate: null }, { exitDate: { gte: dbDate(days[0]) } }] } });
  const today = istDate(new Date());
  const last = days[days.length - 1] < today ? days[days.length - 1] : addDays(today, -1);
  if (last < days[0]) return 0;
  for (const e of emps) await computeEmployeeRange(e.id, days[0], last);
  return emps.length;
}

/** Gece işi: dün ve önceki gün (gece devreden vardiya) tüm aktif personel için. */
export async function nightlyAttendance(now = new Date()) {
  const y = addDays(istDate(now), -1);
  const emps = await db.employee.findMany({ where: { OR: [{ status: "ACTIVE" }, { exitDate: { gte: dbDate(addDays(y, -1)) } }] }, select: { id: true } });
  for (const e of emps) await computeEmployeeRange(e.id, addDays(y, -1), y);
  return { employees: emps.length, date: y };
}

// ───────────── Düzeltme ─────────────

export async function ensureDay(user: Principal, employeeId: string, date: string) {
  const e = await db.employee.findFirst({ where: { AND: [{ id: employeeId }, employeeScopeWhere(user, "attendance.view")] } });
  if (!e) throw new HrError("FORBIDDEN");
  let day = await db.attendanceDay.findUnique({ where: { employeeId_date: { employeeId, date: dbDate(date) } } });
  if (!day && date < istDate(new Date())) {
    await computeEmployeeRange(employeeId, date, date);
    day = await db.attendanceDay.findUnique({ where: { employeeId_date: { employeeId, date: dbDate(date) } } });
  }
  return { employee: e, day };
}

export async function dayDetail(user: Principal, employeeId: string, date: string) {
  const { employee, day } = await ensureDay(user, employeeId, date);
  const from = new Date(Date.parse(`${date}T00:00:00+03:00`) - 3 * 3600_000);
  const to = new Date(Date.parse(`${addDays(date, 1)}T00:00:00+03:00`) + 9 * 3600_000);
  const [events, adjustments, plan, status] = await Promise.all([
    eventsFor(employee, from, to),
    day ? db.attendanceAdjustment.findMany({ where: { dayId: day.id }, orderBy: { at: "asc" } }) : [],
    db.rosterAssignment.findUnique({ where: { employeeId_date: { employeeId, date: dbDate(date) } }, include: { roster: { select: { publishedAt: true, version: true } } } }),
    periodStatus(date.slice(0, 7), scopeKeyOf(employee)),
  ]);
  const actors = new Map((await db.user.findMany({ where: { id: { in: adjustments.map((a) => a.actorId) } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  return { employee, day, events: events.sort((a, b) => a.at.getTime() - b.at.getTime()), adjustments: adjustments.map((a) => ({ ...a, actorName: actors.get(a.actorId) ?? "—" })), plan, periodStatus: status };
}

export async function adjustDay(user: Principal, a: { employeeId: string; date: string; field: AdjustField; value: string; reason: string }) {
  if (!ADJUSTABLE.includes(a.field)) throw new HrError("BAD_FIELD");
  if (a.reason.trim().length < 5) throw new HrError("REASON_REQUIRED");
  const e = await db.employee.findFirst({ where: { AND: [{ id: a.employeeId }, employeeScopeWhere(user, "attendance.adjust")] } });
  if (!e) throw new HrError("FORBIDDEN");
  if (e.userId === user.id) throw new HrError("SELF_ADJUST");
  const st = await periodStatus(a.date.slice(0, 7), scopeKeyOf(e));
  if (st === "LOCKED") throw new HrError("PERIOD_LOCKED");
  if (st === "APPROVED") throw new HrError("PERIOD_APPROVED");
  if (a.date >= istDate(new Date())) throw new HrError("FUTURE_DAY");

  let newValue: string;
  if (a.field === "firstIn" || a.field === "lastOut") {
    const m = /^(\d{1,2}):(\d{2})(\+1)?$/.exec(a.value.trim());
    if (!m) throw new HrError("BAD_TIME");
    const base = a.field === "lastOut" && m[3] ? addDays(a.date, 1) : a.date;
    newValue = new Date(`${base}T${m[1].padStart(2, "0")}:${m[2]}:00+03:00`).toISOString();
  } else if (a.field === "breakMin") {
    const n = Number(a.value);
    if (!Number.isInteger(n) || n < 0 || n > 600) throw new HrError("BAD_NUMBER");
    newValue = String(n);
  } else {
    if (!["Ç", "Y", "İ", "R", "Ü", "M", "İD", "HT", "RT", "RTÇ", "D", "E", "S"].includes(a.value)) throw new HrError("BAD_CODE");
    newValue = a.value;
  }

  const { day } = await ensureDay(user, a.employeeId, a.date);
  const d = day ?? (await db.attendanceDay.create({ data: { employeeId: a.employeeId, date: dbDate(a.date), source: "MANUAL" } }));
  const old = a.field === "firstIn" ? d.firstIn?.toISOString() : a.field === "lastOut" ? d.lastOut?.toISOString() : a.field === "breakMin" ? String(d.breakMin) : d.code;
  await db.attendanceAdjustment.create({ data: { dayId: d.id, field: a.field, oldValue: old ?? null, newValue, reason: a.reason.trim(), actorId: user.id } });
  await computeEmployeeRange(a.employeeId, a.date, a.date);
  // Fazla mesai haftalık olduğundan haftanın kalanı da güncellenir
  const ws = weekStartOf(a.date);
  await computeEmployeeRange(a.employeeId, ws, addDays(ws, 6) < istDate(new Date()) ? addDays(ws, 6) : addDays(istDate(new Date()), -1));
  await audit({ actorId: user.id, action: "hr.attendance.adjust", entity: "AttendanceDay", entityId: d.id, reason: a.reason, diff: { field: a.field, old, new: newValue } });
}

// ───────────── Aylık ızgara ve dönem ─────────────

export async function monthGrid(user: Principal, month: string, scope: string) {
  const days = daysOfMonth(month);
  const employees = await db.employee.findMany({
    where: {
      AND: [
        employeeScopeWhere(user, "attendance.view"),
        { teamId: scope === "GENEL" ? null : scope },
        { hireDate: { lte: dbDate(days[days.length - 1]) } },
        { OR: [{ exitDate: null }, { exitDate: { gte: dbDate(days[0]) } }] },
      ],
    },
    orderBy: [{ department: "asc" }, { lastName: "asc" }],
  });
  const rows = await db.attendanceDay.findMany({ where: { employeeId: { in: employees.map((e) => e.id) }, date: { gte: dbDate(days[0]), lte: dbDate(days[days.length - 1]) } } });
  const holidays = await db.publicHoliday.findMany({ where: { date: { gte: dbDate(days[0]), lte: dbDate(days[days.length - 1]) } } });
  const period = await db.timesheetPeriod.findUnique({ where: { month_scope: { month, scope } } });
  const byEmp = new Map<string, Map<string, (typeof rows)[number]>>();
  for (const r of rows) {
    if (!byEmp.has(r.employeeId)) byEmp.set(r.employeeId, new Map());
    byEmp.get(r.employeeId)!.set(fromDbDate(r.date), r);
  }
  return {
    days,
    holidays: new Map(holidays.map((h) => [fromDbDate(h.date), h])),
    period,
    status: period?.status ?? "OPEN",
    employees: employees.map((e) => {
      const m = byEmp.get(e.id) ?? new Map();
      return { employee: e, days: m, totals: monthTotals([...m.values()]), review: [...m.values()].filter((d) => d.flags.some((f: string) => ["LEAVE_CONFLICT", "ABSENT_SUGGESTED", "SINGLE_EVENT", "UNPLANNED_WORK"].includes(f))).length };
    }),
  };
}

export async function transitionPeriod(user: Principal, month: string, scope: string, action: "PREPARE" | "APPROVE" | "REOPEN" | "LOCK", reason?: string) {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new HrError("BAD_MONTH");
  const p = await db.timesheetPeriod.upsert({ where: { month_scope: { month, scope } }, update: {}, create: { month, scope } });
  const need = { PREPARE: "timesheet.prepare", APPROVE: "timesheet.approve", REOPEN: "timesheet.approve", LOCK: "timesheet.lock" } as const;
  if (!canActOnScope(user, need[action], scope)) throw new HrError("FORBIDDEN");
  const now = new Date();
  if (action === "PREPARE") {
    if (p.status !== "OPEN") throw new HrError("BAD_STATE");
    const last = daysOfMonth(month).at(-1)!;
    if (last >= istDate(now)) throw new HrError("MONTH_NOT_OVER");
    await recomputeMonth(null, month, scope);
    await db.timesheetPeriod.update({ where: { id: p.id }, data: { status: "IN_REVIEW", preparedBy: user.id, preparedAt: now } });
  } else if (action === "APPROVE") {
    if (p.status !== "IN_REVIEW") throw new HrError("BAD_STATE");
    if (p.preparedBy === user.id) throw new HrError("SAME_PERSON");
    await db.timesheetPeriod.update({ where: { id: p.id }, data: { status: "APPROVED", approvedBy: user.id, approvedAt: now } });
  } else if (action === "REOPEN") {
    if (!["IN_REVIEW", "APPROVED"].includes(p.status)) throw new HrError("BAD_STATE");
    if ((reason ?? "").trim().length < 5) throw new HrError("REASON_REQUIRED");
    await db.timesheetPeriod.update({ where: { id: p.id }, data: { status: "OPEN", approvedBy: null, approvedAt: null, note: reason } });
  } else {
    if (p.status !== "APPROVED") throw new HrError("BAD_STATE");
    await db.timesheetPeriod.update({ where: { id: p.id }, data: { status: "LOCKED", lockedAt: now } });
  }
  await audit({ actorId: user.id, action: `hr.timesheet.${action.toLowerCase()}`, entity: "TimesheetPeriod", entityId: p.id, reason, diff: { month, scope } });
}

/** Bordro Excel'i (docs/11 §9): sicil no, ad, departman, gün kodları ve toplamlar — ızgarayla aynı veri. */
export async function exportMonth(user: Principal, month: string, scope: string, reason: string) {
  if (reason.trim().length < 5) throw new HrError("REASON_REQUIRED");
  if (!canActOnScope(user, "timesheet.export", scope)) throw new HrError("FORBIDDEN");
  const g = await monthGrid(user, month, scope);
  const wb = new ExcelJS.Workbook();
  wb.creator = "crmPlus";
  const ws = wb.addWorksheet(`Puantaj ${month}`, { views: [{ state: "frozen", xSplit: 4, ySplit: 1 }] });
  const totalCols = ["Çalışılan gün", "Çalışılan saat", "Fazla mesai saati", "Resmi tatil çalışma saati", "Yıllık izin", "Raporlu", "Ücretsiz izin", "Mazeret izni", "Devamsız", "Hafta tatili"];
  ws.addRow(["Sicil no", "Ad", "Soyad", "Departman", ...g.days.map((d) => Number(d.slice(8))), ...totalCols]);
  ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF12252F" } };
  const h = (m: number) => Number((m / 60).toFixed(2));
  for (const r of g.employees) {
    const t = r.totals;
    ws.addRow([
      r.employee.sicilNo, r.employee.firstName, r.employee.lastName, DEPARTMENTS[r.employee.department as keyof typeof DEPARTMENTS] ?? r.employee.department,
      ...g.days.map((d) => r.days.get(d)?.code ?? ""),
      t.workedDays, h(t.workedMin), h(t.overtimeMin), h(t.holidayWorkMin),
      t.byCode["İ"] ?? 0, t.byCode["R"] ?? 0, t.byCode["Ü"] ?? 0, t.byCode["M"] ?? 0, t.byCode["D"] ?? 0, t.byCode["HT"] ?? 0,
    ]);
  }
  ws.columns.forEach((c, i) => (c.width = i < 4 ? 14 : i < 4 + g.days.length ? 4.5 : 12));
  const info = wb.addWorksheet("Bilgi");
  info.addRow(["Dönem", month]);
  info.addRow(["Kapsam", scope]);
  info.addRow(["Durum", g.status]);
  info.addRow(["Oluşturan", user.name]);
  info.addRow(["Oluşturma", new Date().toISOString()]);
  info.addRow(["Not", g.status === "LOCKED" ? "Kilitli dönem" : "Dönem kilitli değil — bordroya aktarmadan önce onay ve kilit gerekir"]);
  await logAccess({ actorId: user.id, action: "export", resource: "timesheet", reason, meta: { month, scope, rows: g.employees.length, status: g.status } });
  return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), fileName: `puantaj-${month}-${scope === "GENEL" ? "genel" : scope.slice(-6)}.xlsx`, grid: g };
}
