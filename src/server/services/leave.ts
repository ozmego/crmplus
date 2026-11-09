import "server-only";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import type { Principal } from "@/server/auth/rbac";
import { employeeScopeWhere, HrError, myEmployee } from "@/server/services/hr";
import { computeEmployeeRange } from "@/server/services/timesheet";
import { addDays, dbDate, fromDbDate, istDate } from "@/lib/hr/time";

/**
 * İzin: personel talep eder → takım lideri ön onay (isteğe bağlı) → İK son onay. Talep eden onaylayamaz.
 * Teşhis/sağlık bilgisi tutulmaz; raporlu izinde yalnız belge referansı (docs/11 §4).
 */

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function requestLeave(user: Principal, a: { typeCode: string; from: string; to: string; halfDay: boolean; note?: string; documentRef?: string }) {
  const emp = await myEmployee(user.id);
  if (!emp || emp.status !== "ACTIVE") throw new HrError("NO_EMPLOYEE");
  if (!DATE.test(a.from) || !DATE.test(a.to) || a.to < a.from) throw new HrError("BAD_DATES");
  if (a.halfDay && a.from !== a.to) throw new HrError("HALF_DAY_SINGLE");
  const type = await db.leaveType.findUnique({ where: { code: a.typeCode } });
  if (!type) throw new HrError("BAD_TYPE");
  if (type.needsDocument && !a.documentRef?.trim()) throw new HrError("DOCUMENT_REQUIRED");
  const overlap = await db.leaveRequest.count({ where: { employeeId: emp.id, status: { in: ["REQUESTED", "PRE_APPROVED", "APPROVED"] }, startDate: { lte: dbDate(a.to) }, endDate: { gte: dbDate(a.from) } } });
  if (overlap) throw new HrError("OVERLAP");
  // Not alanına sağlık bilgisi yazılmaması uyarısı formda; burada uzunluk sınırı
  const l = await db.leaveRequest.create({
    data: { employeeId: emp.id, typeId: type.id, startDate: dbDate(a.from), endDate: dbDate(a.to), halfDay: a.halfDay, note: a.note?.trim().slice(0, 200) || null, documentRef: a.documentRef?.trim().slice(0, 60) || null, requestedBy: user.id },
  });
  await audit({ actorId: user.id, action: "hr.leave.request", entity: "LeaveRequest", entityId: l.id, diff: { type: type.code, from: a.from, to: a.to } });
  return l;
}

async function loadFor(user: Principal, id: string, perm: "leave.preapprove" | "leave.approve") {
  const l = await db.leaveRequest.findUniqueOrThrow({ where: { id }, include: { employee: true, type: true } });
  const ok = await db.employee.count({ where: { AND: [{ id: l.employeeId }, employeeScopeWhere(user, perm)] } });
  if (!ok) throw new HrError("FORBIDDEN");
  if (l.requestedBy === user.id || l.employee.userId === user.id) throw new HrError("SAME_PERSON");
  return l;
}

export async function preApproveLeave(user: Principal, id: string) {
  const l = await loadFor(user, id, "leave.preapprove");
  if (l.status !== "REQUESTED") throw new HrError("BAD_STATE");
  await db.leaveRequest.update({ where: { id }, data: { status: "PRE_APPROVED", preApprovedBy: user.id } });
  await audit({ actorId: user.id, action: "hr.leave.preapprove", entity: "LeaveRequest", entityId: id });
}

export async function approveLeave(user: Principal, id: string) {
  const l = await loadFor(user, id, "leave.approve");
  if (!["REQUESTED", "PRE_APPROVED"].includes(l.status)) throw new HrError("BAD_STATE");
  await db.leaveRequest.update({ where: { id }, data: { status: "APPROVED", approvedBy: user.id, decidedAt: new Date() } });
  await audit({ actorId: user.id, action: "hr.leave.approve", entity: "LeaveRequest", entityId: id, diff: { type: l.type.code, from: fromDbDate(l.startDate), to: fromDbDate(l.endDate) } });
  // Geçmiş günler etkilendiyse puantaj güncellenir (kilitli dönemler atlanır)
  const yesterday = addDays(istDate(new Date()), -1);
  const from = fromDbDate(l.startDate);
  if (from <= yesterday) await computeEmployeeRange(l.employeeId, from, fromDbDate(l.endDate) < yesterday ? fromDbDate(l.endDate) : yesterday);
}

export async function rejectLeave(user: Principal, id: string, reason: string) {
  if (reason.trim().length < 5) throw new HrError("REASON_REQUIRED");
  const perm = (await db.employee.count({ where: { AND: [{ leaves: { some: { id } } }, employeeScopeWhere(user, "leave.approve")] } })) ? "leave.approve" : "leave.preapprove";
  const l = await loadFor(user, id, perm);
  if (!["REQUESTED", "PRE_APPROVED"].includes(l.status)) throw new HrError("BAD_STATE");
  await db.leaveRequest.update({ where: { id }, data: { status: "REJECTED", rejectReason: reason.trim(), decidedAt: new Date() } });
  await audit({ actorId: user.id, action: "hr.leave.reject", entity: "LeaveRequest", entityId: id, reason });
}

export async function cancelLeave(user: Principal, id: string) {
  const l = await db.leaveRequest.findUniqueOrThrow({ where: { id } });
  if (l.requestedBy !== user.id) throw new HrError("FORBIDDEN");
  if (!["REQUESTED", "PRE_APPROVED"].includes(l.status)) throw new HrError("BAD_STATE");
  await db.leaveRequest.update({ where: { id }, data: { status: "CANCELLED", decidedAt: new Date() } });
  await audit({ actorId: user.id, action: "hr.leave.cancel", entity: "LeaveRequest", entityId: id });
}

export async function leaveLists(user: Principal) {
  const emp = await myEmployee(user.id);
  const include = { employee: { select: { firstName: true, lastName: true, sicilNo: true } }, type: true } as const;
  const [mine, toPre, toApprove] = await Promise.all([
    emp ? db.leaveRequest.findMany({ where: { employeeId: emp.id }, include, orderBy: { startDate: "desc" }, take: 50 }) : [],
    db.leaveRequest.findMany({ where: { status: "REQUESTED", employee: employeeScopeWhere(user, "leave.preapprove"), NOT: { requestedBy: user.id } }, include, orderBy: { startDate: "asc" } }),
    db.leaveRequest.findMany({ where: { status: { in: ["REQUESTED", "PRE_APPROVED"] }, employee: employeeScopeWhere(user, "leave.approve"), NOT: { requestedBy: user.id } }, include, orderBy: { startDate: "asc" } }),
  ]);
  return { employee: emp, mine, toPre, toApprove };
}

export async function addHoliday(user: Principal, date: string, name: string, halfDay: boolean) {
  if (!DATE.test(date) || name.trim().length < 2) throw new HrError("BAD_VALUE");
  await db.publicHoliday.upsert({ where: { date: dbDate(date) }, update: { name: name.trim(), halfDay }, create: { date: dbDate(date), name: name.trim(), halfDay } });
  await audit({ actorId: user.id, action: "hr.holiday.set", diff: { date, name, halfDay } });
}
