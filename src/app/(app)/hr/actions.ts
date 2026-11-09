"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { ForbiddenError, requirePermission } from "@/server/auth/rbac";
import type { Permission } from "@/server/auth/permissions";
import { createEmployee, exitEmployee, HrError, updateEmployee, type EmployeeInput } from "@/server/services/hr";
import { copyPreviousWeek, publishRoster, setCell } from "@/server/services/roster";
import { adjustDay, recomputeMonth, transitionPeriod, type AdjustField } from "@/server/services/timesheet";
import { addHoliday, approveLeave, cancelLeave, preApproveLeave, rejectLeave, requestLeave } from "@/server/services/leave";
import { addStop, cancelStop, createLocation, publishRoute, setWorkStatus, stopAction } from "@/server/services/field-routes";
import type { FormState } from "@/app/(app)/finance/actions";

const ERR: Record<string, string> = {
  FORBIDDEN: "Bu işlem için yetkiniz yok.",
  SICIL_EXISTS: "Bu sicil numarası kullanılıyor.",
  USER_NOT_FOUND: "Bu e-postayla CRM kullanıcısı yok.",
  USER_ALREADY_LINKED: "Bu CRM kullanıcısı başka bir personel kaydına bağlı.",
  EXITED: "Personel işten çıkmış; kayıt değiştirilemez.",
  SELF: "Kendi kaydınız için bu işlemi yapamazsınız.",
  REASON_REQUIRED: "Gerekçe zorunlu (en az 5 karakter).",
  BAD_DATE: "Tarih geçersiz.",
  BAD_DATES: "Tarih aralığı geçersiz.",
  BAD_VALUE: "Değer geçersiz.",
  EMPTY_ROSTER: "Çizelge boş.",
  ALREADY_PUBLISHED: "Çizelge zaten yayında; değişiklik yapınca yeniden yayınlanabilir.",
  WARNINGS_NEED_REASON: "Kural uyarıları var: yayınlamak için gerekçe yazın.",
  NOTHING_TO_COPY: "Önceki haftada kopyalanacak vardiya yok.",
  PERIOD_LOCKED: "Dönem kilitli; düzeltme yapılamaz.",
  PERIOD_APPROVED: "Dönem onaylı; düzeltme için önce dönemi yeniden açın.",
  SELF_ADJUST: "Kendi puantajınızı düzeltemezsiniz.",
  FUTURE_DAY: "Bugün ve sonrası düzeltilemez.",
  BAD_TIME: "Saat SS:DD biçiminde olmalı (ertesi gün için sonuna +1).",
  BAD_NUMBER: "Dakika 0–600 arası tam sayı olmalı.",
  BAD_CODE: "Gün kodu geçersiz.",
  BAD_STATE: "Kayıt bu işlem için uygun durumda değil.",
  SAME_PERSON: "Hazırlayan / talep eden kişi onaylayamaz.",
  MONTH_NOT_OVER: "Ay bitmeden dönem hazırlanamaz.",
  NO_EMPLOYEE: "Personel kaydınız yok; İK ile görüşün.",
  HALF_DAY_SINGLE: "Yarım gün izin tek gün için seçilebilir.",
  BAD_TYPE: "İzin türü seçin.",
  DOCUMENT_REQUIRED: "Bu izin türü için belge referansı zorunlu.",
  OVERLAP: "Bu tarihlerde başka bir izin talebiniz var.",
  LOCATION_EXISTS: "Bu adla lokasyon var.",
  PURPOSE_REQUIRED: "Ziyaret amacını yazın.",
  BAD_LOCATION: "Lokasyon seçin.",
  GUEST_NOT_FOUND: "Bu CRM numarasıyla misafir yok.",
  GUEST_BLOCKED: "Misafir için iletişim durdurma kaydı var; ziyaret durağı eklenemez.",
  EMPTY_ROUTE: "Rotada durak yok.",
  NOT_TODAY: "Yalnız bugünkü duraklar işaretlenebilir.",
  CHECKIN_FIRST: "Önce “Vardım” işaretleyin.",
  NOTE_REQUIRED: "Yapılamama nedenini yazın.",
  OPEN_CALL: "Açık çağrınız var; önce çağrıyı kapatın.",
};

async function run(perm: Permission, fn: (u: Awaited<ReturnType<typeof requirePermission>>) => Promise<unknown>, okMsg: string, path = "/hr"): Promise<FormState> {
  try {
    const user = await requirePermission(perm, "hr");
    await fn(user);
    revalidatePath(path, "layout");
    return { ok: okMsg };
  } catch (e) {
    if (e instanceof HrError) return { error: ERR[e.code] ?? e.message };
    if (e instanceof ForbiddenError) return { error: ERR.FORBIDDEN };
    if (e instanceof z.ZodError) return { error: e.issues.map((i) => i.message).join(" · ") };
    throw e;
  }
}

const f = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const opt = (fd: FormData, k: string) => f(fd, k) || undefined;

function employeeInput(fd: FormData): EmployeeInput {
  return {
    sicilNo: f(fd, "sicilNo"), firstName: f(fd, "firstName"), lastName: f(fd, "lastName"), department: f(fd, "department") as never,
    title: opt(fd, "title"), teamId: opt(fd, "teamId"), employmentType: (f(fd, "employmentType") || "FULL") as "FULL",
    weeklyHours: f(fd, "weeklyHours") || "45", hireDate: f(fd, "hireDate"), userEmail: opt(fd, "userEmail"), phone: opt(fd, "phone"), email: opt(fd, "email"),
  };
}

export async function createEmployeeAction(_: FormState, fd: FormData) {
  let id = "";
  const r = await run("hr.employee.edit", async (u) => (id = (await createEmployee(u, employeeInput(fd))).id), "Personel eklendi.");
  if (id) redirect(`/hr/employees/${id}`);
  return r;
}

export async function updateEmployeeAction(_: FormState, fd: FormData) {
  return run("hr.employee.edit", (u) => updateEmployee(u, f(fd, "id"), employeeInput(fd)), "Kaydedildi.");
}

export async function exitEmployeeAction(_: FormState, fd: FormData) {
  return run("hr.employee.edit", (u) => exitEmployee(u, f(fd, "id"), f(fd, "exitDate"), f(fd, "reason")), "İşten çıkış kaydedildi; CRM erişimi kapatıldı.");
}

export async function setCellAction(input: { weekStart: string; scope: string; employeeId: string; date: string; value: string }): Promise<FormState> {
  return run("roster.manage", (u) => setCell(u, input), "Kaydedildi.", "/hr/roster");
}

export async function copyWeekAction(_: FormState, fd: FormData) {
  return run("roster.manage", (u) => copyPreviousWeek(u, f(fd, "weekStart"), f(fd, "scope")), "Önceki hafta kopyalandı.", "/hr/roster");
}

export async function publishRosterAction(_: FormState, fd: FormData) {
  return run("roster.publish", (u) => publishRoster(u, f(fd, "weekStart"), f(fd, "scope"), opt(fd, "reason")), "Çizelge yayınlandı.", "/hr/roster");
}

export async function addLocationAction(_: FormState, fd: FormData) {
  return run("route.manage", (u) => createLocation(u, { name: f(fd, "name"), kind: f(fd, "kind"), city: opt(fd, "city") }), "Lokasyon eklendi.", "/hr/routes");
}

export async function addStopAction(_: FormState, fd: FormData) {
  return run("route.manage", (u) =>
    addStop(u, { employeeId: f(fd, "employeeId"), date: f(fd, "date"), time: opt(fd, "time"), locationId: f(fd, "locationId"), purpose: f(fd, "purpose"), guestCrmNo: opt(fd, "guestCrmNo") }), "Durak eklendi.", "/hr/routes");
}

export async function publishRouteAction(_: FormState, fd: FormData) {
  return run("route.manage", (u) => publishRoute(u, f(fd, "routeId")), "Rota yayınlandı.", "/hr/routes");
}

export async function cancelStopAction(_: FormState, fd: FormData) {
  return run("route.manage", (u) => cancelStop(u, f(fd, "stopId")), "Durak iptal edildi.", "/hr/routes");
}

export async function stopActionAction(_: FormState, fd: FormData) {
  const a = z.enum(["IN", "OUT", "SKIP"]).parse(f(fd, "action"));
  return run("route.checkin", (u) => stopAction(u, f(fd, "stopId"), a, opt(fd, "note")), a === "IN" ? "Varış kaydedildi." : a === "OUT" ? "Ayrılış kaydedildi." : "Yapılamadı olarak işaretlendi.", "/hr/my-route");
}

export async function workStatusAction(_: FormState, fd: FormData) {
  const s = z.enum(["READY", "BREAK", "OFFLINE"]).parse(f(fd, "status"));
  return run("attendance.view", (u) => setWorkStatus(u, s), { READY: "Mesaidesiniz.", BREAK: "Moladasınız.", OFFLINE: "Mesai bitti." }[s]);
}

export async function adjustDayAction(_: FormState, fd: FormData) {
  return run("attendance.adjust", (u) =>
    adjustDay(u, { employeeId: f(fd, "employeeId"), date: f(fd, "date"), field: f(fd, "field") as AdjustField, value: f(fd, "value"), reason: f(fd, "reason") }), "Düzeltme kaydedildi.", "/hr/timesheet");
}

export async function recomputeAction(_: FormState, fd: FormData) {
  return run("attendance.view", (u) => recomputeMonth(u, f(fd, "month"), f(fd, "scope")), "Puantaj yeniden hesaplandı.", "/hr/timesheet");
}

export async function periodAction(_: FormState, fd: FormData) {
  const a = z.enum(["PREPARE", "APPROVE", "REOPEN", "LOCK"]).parse(f(fd, "action"));
  const perm: Permission = { PREPARE: "timesheet.prepare", APPROVE: "timesheet.approve", REOPEN: "timesheet.approve", LOCK: "timesheet.lock" }[a] as Permission;
  return run(perm, (u) => transitionPeriod(u, f(fd, "month"), f(fd, "scope"), a, opt(fd, "reason")), { PREPARE: "Dönem onaya gönderildi.", APPROVE: "Dönem onaylandı.", REOPEN: "Dönem yeniden açıldı.", LOCK: "Dönem kilitlendi." }[a], "/hr/timesheet");
}

export async function requestLeaveAction(_: FormState, fd: FormData) {
  return run("leave.request", (u) =>
    requestLeave(u, { typeCode: f(fd, "typeCode"), from: f(fd, "from"), to: f(fd, "to") || f(fd, "from"), halfDay: f(fd, "halfDay") === "1", note: opt(fd, "note"), documentRef: opt(fd, "documentRef") }), "İzin talebi gönderildi.", "/hr/leave");
}

export async function leaveDecisionAction(_: FormState, fd: FormData) {
  const a = z.enum(["PRE", "APPROVE", "REJECT", "CANCEL"]).parse(f(fd, "action"));
  const id = f(fd, "id");
  if (a === "PRE") return run("leave.preapprove", (u) => preApproveLeave(u, id), "Ön onay verildi.", "/hr/leave");
  if (a === "APPROVE") return run("leave.approve", (u) => approveLeave(u, id), "İzin onaylandı.", "/hr/leave");
  if (a === "CANCEL") return run("leave.request", (u) => cancelLeave(u, id), "Talep geri çekildi.", "/hr/leave");
  return run("leave.request", (u) => rejectLeave(u, id, f(fd, "reason")), "Talep reddedildi.", "/hr/leave");
}

export async function addHolidayAction(_: FormState, fd: FormData) {
  return run("hr.employee.edit", (u) => addHoliday(u, f(fd, "date"), f(fd, "name"), f(fd, "halfDay") === "1"), "Tatil kaydedildi.", "/hr/leave");
}
