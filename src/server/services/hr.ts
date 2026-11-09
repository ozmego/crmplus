import "server-only";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { scopeOf, type Principal } from "@/server/auth/rbac";
import type { Permission } from "@/server/auth/permissions";
import { disableUserNow } from "@/server/auth/account";
import { decrypt, encrypt } from "@/server/crypto/field-encryption";
import { dbDate, fromDbDate } from "@/lib/hr/time";
import { annualEntitlement, completedYears, leaveDays } from "@/lib/hr/leave";

/**
 * Personel kayıtları (Aşama 1B, docs/11). Personel verisi `hr` şemasındadır; misafir/finans sorgularından ayrıdır.
 * Kapsam: own = kendi personel kaydı · team = yönettiği/üyesi olduğu ekip · all = tümü.
 */
export class HrError extends Error {
  constructor(public code: string, detail?: string) {
    super(detail ?? code);
  }
}

export const DEPARTMENTS = { CALL_CENTER: "Çağrı merkezi", FIELD: "Saha / host", OFFICE: "Ofis", FINANCE: "Finans", MANAGEMENT: "Yönetim" } as const;
export type Department = keyof typeof DEPARTMENTS;

export function teamIdsOf(p: Principal): string[] {
  return [...new Set([...p.ledTeamIds, ...(p.teamId ? [p.teamId] : [])])];
}

export function employeeScopeWhere(p: Principal, perm: Permission): Prisma.EmployeeWhereInput {
  const scope = scopeOf(p, perm);
  if (!scope) return { id: "__none__" };
  if (scope === "all") return {};
  if (scope === "own") return { userId: p.id };
  return { OR: [{ userId: p.id }, { teamId: { in: teamIdsOf(p) } }] };
}

/** Çizelge/puantaj kapsam anahtarı: ekip kimliği veya ekipsiz personel için "GENEL". */
export const scopeKeyOf = (e: { teamId: string | null }) => e.teamId ?? "GENEL";

export function canActOnScope(p: Principal, perm: Permission, scopeKey: string): boolean {
  const s = scopeOf(p, perm);
  if (s === "all") return true;
  if (s === "team") return teamIdsOf(p).includes(scopeKey);
  return false;
}

export async function assertEmployeeInScope(p: Principal, perm: Permission, employeeId: string) {
  const e = await db.employee.findFirst({ where: { AND: [{ id: employeeId }, employeeScopeWhere(p, perm)] } });
  if (!e) throw new HrError("FORBIDDEN");
  return e;
}

export const myEmployee = (userId: string) => db.employee.findUnique({ where: { userId } });

/** Kullanıcının görebileceği kapsam seçenekleri (ekipler + GENEL). */
export async function scopeOptions(p: Principal, perm: Permission) {
  const s = scopeOf(p, perm);
  const teams = await db.team.findMany({ where: s === "all" ? {} : { id: { in: teamIdsOf(p) } }, orderBy: { name: "asc" }, select: { id: true, name: true } });
  const opts = teams.map((t) => ({ value: t.id, label: t.name }));
  if (s === "all") opts.push({ value: "GENEL", label: "Ekipsiz personel" });
  return opts;
}

const employeeSchema = z.object({
  sicilNo: z.string().trim().min(1, "Sicil no girin").max(20),
  firstName: z.string().trim().min(1, "Ad girin").max(60),
  lastName: z.string().trim().min(1, "Soyad girin").max(60),
  department: z.enum(Object.keys(DEPARTMENTS) as [Department, ...Department[]], { message: "Departman seçin" }),
  title: z.string().trim().max(80).optional(),
  teamId: z.string().optional(),
  employmentType: z.enum(["FULL", "PART"]).default("FULL"),
  weeklyHours: z.coerce.number().int().min(1).max(45, "Haftalık en fazla 45 saat"),
  hireDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "İşe giriş tarihi seçin"),
  userEmail: z.string().email("Geçersiz e-posta").optional(),
  phone: z.string().max(30).optional(),
  email: z.string().email("Geçersiz e-posta").optional(),
});
export type EmployeeInput = z.input<typeof employeeSchema>;

async function resolveUser(email?: string, exceptEmployeeId?: string) {
  if (!email) return null;
  const u = await db.user.findUnique({ where: { email: email.toLowerCase() }, select: { id: true } });
  if (!u) throw new HrError("USER_NOT_FOUND");
  const linked = await db.employee.findUnique({ where: { userId: u.id } });
  if (linked && linked.id !== exceptEmployeeId) throw new HrError("USER_ALREADY_LINKED");
  return u.id;
}

export async function createEmployee(user: Principal, input: EmployeeInput) {
  const v = employeeSchema.parse(input);
  if (await db.employee.findUnique({ where: { sicilNo: v.sicilNo } })) throw new HrError("SICIL_EXISTS");
  const userId = await resolveUser(v.userEmail);
  const e = await db.employee.create({
    data: {
      sicilNo: v.sicilNo, firstName: v.firstName, lastName: v.lastName, department: v.department, title: v.title || null,
      teamId: v.teamId || null, employmentType: v.employmentType, weeklyHours: v.weeklyHours, hireDate: dbDate(v.hireDate), userId,
      phoneEnc: v.phone ? encrypt(v.phone) : null, emailEnc: v.email ? encrypt(v.email) : null,
    },
  });
  await audit({ actorId: user.id, action: "hr.employee.create", entity: "Employee", entityId: e.id, diff: { sicilNo: e.sicilNo, department: e.department, linkedUser: !!userId } });
  return e;
}

export async function updateEmployee(user: Principal, id: string, input: EmployeeInput) {
  const v = employeeSchema.parse(input);
  const before = await db.employee.findUniqueOrThrow({ where: { id } });
  if (before.status === "EXITED") throw new HrError("EXITED");
  const dup = await db.employee.findUnique({ where: { sicilNo: v.sicilNo } });
  if (dup && dup.id !== id) throw new HrError("SICIL_EXISTS");
  const userId = await resolveUser(v.userEmail, id);
  const data = {
    sicilNo: v.sicilNo, firstName: v.firstName, lastName: v.lastName, department: v.department, title: v.title || null,
    teamId: v.teamId || null, employmentType: v.employmentType, weeklyHours: v.weeklyHours, hireDate: dbDate(v.hireDate), userId,
    phoneEnc: v.phone ? encrypt(v.phone) : null, emailEnc: v.email ? encrypt(v.email) : null,
  };
  await db.employee.update({ where: { id }, data });
  const changed = (["sicilNo", "firstName", "lastName", "department", "title", "teamId", "employmentType", "weeklyHours", "userId"] as const).filter((k) => before[k] !== data[k]);
  await audit({ actorId: user.id, action: "hr.employee.update", entity: "Employee", entityId: id, diff: { changed } });
}

/** İşten çıkış: personel kaydı kapanır, bağlı CRM kullanıcısı anında pasifleşir (tüm oturumlar düşer). */
export async function exitEmployee(user: Principal, id: string, exitDate: string, reason: string) {
  if (reason.trim().length < 5) throw new HrError("REASON_REQUIRED");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(exitDate)) throw new HrError("BAD_DATE");
  const e = await db.employee.findUniqueOrThrow({ where: { id } });
  if (e.status === "EXITED") throw new HrError("EXITED");
  if (e.userId === user.id) throw new HrError("SELF");
  await db.employee.update({ where: { id }, data: { status: "EXITED", exitDate: dbDate(exitDate) } });
  if (e.userId) {
    const u = await db.user.findUnique({ where: { id: e.userId }, select: { status: true } });
    if (u && u.status !== "DISABLED") await disableUserNow(e.userId, user.id, `İşten çıkış: ${reason}`);
  }
  await audit({ actorId: user.id, action: "hr.employee.exit", entity: "Employee", entityId: id, reason, diff: { exitDate, crmUserDisabled: !!e.userId } });
}

export async function listEmployees(user: Principal, q?: { status?: string; department?: string; search?: string }) {
  const and: Prisma.EmployeeWhereInput[] = [employeeScopeWhere(user, "hr.employee.view")];
  if (q?.status) and.push({ status: q.status });
  if (q?.department) and.push({ department: q.department });
  if (q?.search) and.push({ OR: [{ firstName: { contains: q.search, mode: "insensitive" } }, { lastName: { contains: q.search, mode: "insensitive" } }, { sicilNo: { contains: q.search } }] });
  return db.employee.findMany({ where: { AND: and }, orderBy: [{ status: "asc" }, { lastName: "asc" }], take: 500 });
}

export async function getEmployeeCard(user: Principal, id: string) {
  const e = await db.employee.findFirst({ where: { AND: [{ id }, employeeScopeWhere(user, "hr.employee.view")] }, include: { manager: true } });
  if (!e) return null;
  const linkedUser = e.userId ? await db.user.findUnique({ where: { id: e.userId }, select: { email: true, status: true } }) : null;
  const team = e.teamId ? await db.team.findUnique({ where: { id: e.teamId }, select: { name: true } }) : null;
  return {
    ...e,
    phone: e.phoneEnc ? decrypt(e.phoneEnc) : null,
    email: e.emailEnc ? decrypt(e.emailEnc) : null,
    linkedUser,
    teamName: team?.name ?? null,
    balance: await leaveBalance(e.id),
  };
}

/** Yıllık izin bakiyesi: içinde bulunulan kıdem yılının hakkı − bu kıdem yılında onaylanan yıllık izin günleri. */
export async function leaveBalance(employeeId: string, today = new Date().toISOString().slice(0, 10)) {
  const e = await db.employee.findUniqueOrThrow({ where: { id: employeeId } });
  const hire = fromDbDate(e.hireDate);
  const years = completedYears(hire, today);
  const entitlement = annualEntitlement(hire, today);
  const yearStart = years >= 1 ? `${Number(hire.slice(0, 4)) + years}${hire.slice(4)}` : hire;
  const holidays = new Set((await db.publicHoliday.findMany({ where: { halfDay: false } })).map((h) => fromDbDate(h.date)));
  const used = (
    await db.leaveRequest.findMany({ where: { employeeId, status: "APPROVED", type: { code: "İ" }, endDate: { gte: dbDate(yearStart) } } })
  ).reduce((s, l) => s + leaveDays(fromDbDate(l.startDate) < yearStart ? yearStart : fromDbDate(l.startDate), fromDbDate(l.endDate), { holidays, halfDay: l.halfDay }), 0);
  return { entitlement, used, remaining: entitlement - used, yearStart, seniorityYears: years };
}
