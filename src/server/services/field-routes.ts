import "server-only";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import type { Principal } from "@/server/auth/rbac";
import { employeeScopeWhere, HrError, myEmployee } from "@/server/services/hr";
import { dbDate, fromDbDate, istDate, parseHhmm, weekStartOf } from "@/lib/hr/time";

/**
 * Saha ziyaret rotası: haftalık plan (durak = gün, sıra, saat, lokasyon, amaç, opsiyonel misafir) ve
 * personelin “Bugünkü rotam” ekranında vardım / ayrıldım / yapılamadı işaretleri. Konum (GPS) toplanmaz.
 * Misafir yalnız adıyla görünür; finans yok. Durdurma kaydı olan misafire durak eklenmez.
 */

export const LOCATION_KINDS = { CASINO: "Casino", HOTEL: "Otel", AIRPORT: "Havalimanı", OFFICE: "Ofis", OTHER: "Diğer" } as const;

export async function createLocation(user: Principal, a: { name: string; kind: string; city?: string }) {
  if (a.name.trim().length < 2 || !(a.kind in LOCATION_KINDS)) throw new HrError("BAD_VALUE");
  if (await db.location.findUnique({ where: { name: a.name.trim() } })) throw new HrError("LOCATION_EXISTS");
  const l = await db.location.create({ data: { name: a.name.trim(), kind: a.kind, city: a.city?.trim() || null } });
  await audit({ actorId: user.id, action: "hr.location.create", entity: "Location", entityId: l.id });
  return l;
}

export async function routesWeek(user: Principal, weekStartInput: string) {
  const weekStart = weekStartOf(weekStartInput);
  const employees = await db.employee.findMany({
    where: { AND: [employeeScopeWhere(user, "route.manage"), { status: "ACTIVE", department: "FIELD" }] },
    orderBy: { lastName: "asc" },
    include: { routes: { where: { weekStart: dbDate(weekStart) }, include: { stops: { include: { location: true }, orderBy: [{ date: "asc" }, { seq: "asc" }] } } } },
  });
  const locations = await db.location.findMany({ where: { active: true }, orderBy: { name: "asc" } });
  return { weekStart, employees, locations };
}

export async function addStop(user: Principal, a: { employeeId: string; date: string; time?: string; locationId: string; purpose: string; guestCrmNo?: string }) {
  const emp = await db.employee.findFirst({ where: { AND: [{ id: a.employeeId }, employeeScopeWhere(user, "route.manage")] } });
  if (!emp) throw new HrError("FORBIDDEN");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a.date)) throw new HrError("BAD_DATE");
  if (a.purpose.trim().length < 3) throw new HrError("PURPOSE_REQUIRED");
  const plannedMin = a.time ? parseHhmm(a.time) : null;
  if (a.time && plannedMin === null) throw new HrError("BAD_TIME");
  if (!(await db.location.findUnique({ where: { id: a.locationId } }))) throw new HrError("BAD_LOCATION");

  let guestId: string | null = null;
  let guestName: string | null = null;
  if (a.guestCrmNo) {
    const crmNo = Number(a.guestCrmNo.replace(/\D/g, ""));
    const g = await db.guest.findFirst({ where: { crmNo, anonymizedAt: null }, select: { id: true, firstName: true, lastName: true, blocks: { where: { removedAt: null }, select: { id: true } } } });
    if (!g) throw new HrError("GUEST_NOT_FOUND");
    if (g.blocks.length) throw new HrError("GUEST_BLOCKED");
    guestId = g.id;
    guestName = `${g.firstName} ${g.lastName}`;
  }
  const weekStart = weekStartOf(a.date);
  const route = await db.fieldRoute.upsert({
    where: { employeeId_weekStart: { employeeId: emp.id, weekStart: dbDate(weekStart) } },
    update: {},
    create: { employeeId: emp.id, weekStart: dbDate(weekStart), createdBy: user.id },
  });
  const seq = (await db.routeStop.count({ where: { routeId: route.id, date: dbDate(a.date) } })) + 1;
  const s = await db.routeStop.create({ data: { routeId: route.id, date: dbDate(a.date), seq, plannedMin, locationId: a.locationId, purpose: a.purpose.trim(), guestId, guestName } });
  await audit({ actorId: user.id, action: "hr.route.stop.add", entity: "RouteStop", entityId: s.id, diff: { date: a.date, withGuest: !!guestId } });
  return s;
}

export async function publishRoute(user: Principal, routeId: string) {
  const r = await db.fieldRoute.findUniqueOrThrow({ where: { id: routeId }, include: { _count: { select: { stops: true } } } });
  const ok = await db.employee.count({ where: { AND: [{ id: r.employeeId }, employeeScopeWhere(user, "route.manage")] } });
  if (!ok) throw new HrError("FORBIDDEN");
  if (!r._count.stops) throw new HrError("EMPTY_ROUTE");
  await db.fieldRoute.update({ where: { id: routeId }, data: { status: "PUBLISHED", publishedAt: new Date() } });
  await audit({ actorId: user.id, action: "hr.route.publish", entity: "FieldRoute", entityId: routeId });
}

export async function cancelStop(user: Principal, stopId: string) {
  const s = await db.routeStop.findUniqueOrThrow({ where: { id: stopId }, include: { route: true } });
  const ok = await db.employee.count({ where: { AND: [{ id: s.route.employeeId }, employeeScopeWhere(user, "route.manage")] } });
  if (!ok) throw new HrError("FORBIDDEN");
  if (s.status !== "PLANNED") throw new HrError("BAD_STATE");
  await db.routeStop.update({ where: { id: stopId }, data: { status: "CANCELLED" } });
  await audit({ actorId: user.id, action: "hr.route.stop.cancel", entity: "RouteStop", entityId: stopId });
}

export async function myStops(user: Principal, date = istDate(new Date())) {
  const emp = await myEmployee(user.id);
  if (!emp) return null;
  const stops = await db.routeStop.findMany({
    where: { date: dbDate(date), route: { employeeId: emp.id, status: "PUBLISHED" } },
    include: { location: true },
    orderBy: { seq: "asc" },
  });
  return { employee: emp, date, stops };
}

/** Saha personeli kendi durağı için: IN (vardım), OUT (ayrıldım), SKIP (yapılamadı). */
export async function stopAction(user: Principal, stopId: string, action: "IN" | "OUT" | "SKIP", note?: string) {
  const emp = await myEmployee(user.id);
  const s = await db.routeStop.findUniqueOrThrow({ where: { id: stopId }, include: { route: true, location: true } });
  if (!emp || s.route.employeeId !== emp.id || s.route.status !== "PUBLISHED") throw new HrError("FORBIDDEN");
  if (fromDbDate(s.date) !== istDate(new Date())) throw new HrError("NOT_TODAY");
  const now = new Date();
  if (action === "IN") {
    if (s.status !== "PLANNED" || s.checkInAt) throw new HrError("BAD_STATE");
    await db.routeStop.update({ where: { id: stopId }, data: { checkInAt: now } });
  } else if (action === "OUT") {
    if (s.status !== "PLANNED" || !s.checkInAt) throw new HrError("CHECKIN_FIRST");
    await db.routeStop.update({ where: { id: stopId }, data: { checkOutAt: now, status: "DONE", resultNote: note?.trim().slice(0, 300) || null } });
    if (s.guestId) {
      await db.interaction.create({ data: { guestId: s.guestId, channel: "VISIT", direction: "OUT", refId: s.id, summary: `Saha ziyareti: ${s.location.name}`, actorId: user.id } });
    }
  } else {
    if (s.status !== "PLANNED") throw new HrError("BAD_STATE");
    if ((note ?? "").trim().length < 3) throw new HrError("NOTE_REQUIRED");
    await db.routeStop.update({ where: { id: stopId }, data: { status: "SKIPPED", resultNote: note!.trim().slice(0, 300) } });
  }
  await audit({ actorId: user.id, action: `hr.route.stop.${action.toLowerCase()}`, entity: "RouteStop", entityId: stopId });
}

/** Mesai durumu (çağrı merkezi ve diğer CRM kullanıcıları): puantajın kaynağıdır. */
export async function setWorkStatus(user: Principal, status: "READY" | "BREAK" | "OFFLINE") {
  const open = await db.call.count({ where: { agentId: user.id, closedAt: null } });
  if (open && status !== "READY") throw new HrError("OPEN_CALL");
  await db.agentStatusLog.create({ data: { userId: user.id, status } });
}

export async function currentWorkStatus(userId: string) {
  const since = new Date(Date.parse(`${istDate(new Date())}T00:00:00+03:00`));
  const last = await db.agentStatusLog.findFirst({ where: { userId, at: { gte: since } }, orderBy: { at: "desc" } });
  const first = await db.agentStatusLog.findFirst({ where: { userId, at: { gte: since } }, orderBy: { at: "asc" } });
  return { status: last?.status ?? "OFFLINE", since: last?.at ?? null, startedAt: first?.at ?? null };
}
