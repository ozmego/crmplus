import "server-only";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { can, guestScopeWhere, type Principal } from "@/server/auth/rbac";
import { audit, logAccess } from "@/server/audit";
import { blindIndex, decrypt, encrypt } from "@/server/crypto/field-encryption";
import { putEncrypted } from "@/server/storage";
import { scanBuffer } from "@/server/scan";
import { financeView } from "@/server/services/finance";
import { DOCUMENT_KINDS, DOCUMENT_MAX_BYTES, DOCUMENT_MIME, GAMES, isValidTcNo, maskId, normalizePassportNo, profileGaps } from "@/lib/identity";

/**
 * Casino müşteri profili: casinoya gönderilen oyuncunun kimlik, belge, tercih/limit, casino oyuncu numaraları,
 * trip bazında seyahat ve (finans) ön yatırım/kredi hattı bilgileri. Yalnız sistem içinde tutulur, dışa aktarılmaz.
 *  - Görüntüleme: oyuncuyu görme yetkisi (kapsamıyla). Kimlik ve belgeler: field.identity (erişim kaydıyla).
 *  - Düzenleme: guest.edit; kimlik ve belge için ayrıca field.identity. Ön yatırım/kredi: finance.result.edit.
 *  - Denetim kaydına değişen alan adları yazılır, kimlik değerleri yazılmaz.
 */

export class ProfileEditError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

async function guestInScope(user: Principal, guestId: string) {
  const g = await db.guest.findFirst({ where: { AND: [{ id: guestId }, guestScopeWhere(user, "guest.view")] }, select: { id: true, crmNo: true, firstName: true, lastName: true, country: true } });
  if (!g) throw new ProfileEditError("NOT_FOUND");
  return g;
}

function need(user: Principal, ...perms: Parameters<typeof can>[1][]) {
  for (const p of perms) if (!can(user, p)) throw new ProfileEditError("FORBIDDEN");
}

const dateOrNull = (s: string | null | undefined) => {
  if (!s) return null;
  const d = new Date(`${s}T00:00:00Z`);
  if (isNaN(d.getTime())) throw new ProfileEditError("BAD_DATE");
  return d;
};

export async function getCasinoProfile(user: Principal, guestId: string) {
  await guestInScope(user, guestId);
  const seeIdentity = can(user, "field.identity");
  const [p, docs, ext, casinos, tgs] = await Promise.all([
    db.guestProfile.findUnique({ where: { guestId } }),
    db.guestDocument.findMany({ where: { guestId, deletedAt: null }, orderBy: { createdAt: "desc" }, select: { id: true, kind: true, fileName: true, mime: true, size: true, createdAt: true, uploadedBy: true } }),
    db.guestExternalId.findMany({ where: { guestId }, select: { id: true, source: true, value: true } }),
    db.casino.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, currency: true } }),
    db.tripGuest.findMany({
      where: { guestId },
      select: { id: true, trip: { select: { id: true, name: true, startDate: true, endDate: true, status: true, casino: { select: { name: true } } } }, travel: true },
    }),
  ]);
  const casinoNames = new Set(casinos.map((c) => c.name));
  const host = p?.hostUserId ? await db.user.findUnique({ where: { id: p.hostUserId }, select: { id: true, name: true } }) : null;

  if (seeIdentity && (p?.tcNoEnc || p?.passportNoEnc || p?.addressEnc || p?.birthDate)) {
    await logAccess({ actorId: user.id, action: "view", resource: "guest.identity", resourceId: guestId });
  }
  const identity = p
    ? {
        nationality: p.nationality,
        gender: p.gender,
        birthDate: seeIdentity ? p.birthDate : null,
        tcNo: p.tcNoEnc ? (seeIdentity ? decrypt(p.tcNoEnc) : null) : null,
        tcNoMasked: p.tcNoEnc ? maskId(decrypt(p.tcNoEnc)) : null,
        passportNo: p.passportNoEnc ? (seeIdentity ? decrypt(p.passportNoEnc) : null) : null,
        passportNoMasked: p.passportNoEnc ? maskId(decrypt(p.passportNoEnc)) : null,
        passportCountry: p.passportCountry,
        passportExpiry: p.passportExpiry,
        address: p.addressEnc && seeIdentity ? decrypt(p.addressEnc) : null,
        hasAddress: !!p.addressEnc,
      }
    : null;

  const trips = tgs.map((t) => ({ tripGuestId: t.id, ...t.trip, casino: t.trip.casino.name, travel: t.travel })).sort((a, b) => b.startDate.getTime() - a.startDate.getTime());
  const next = trips.filter((t) => t.status === "PLANNED" && t.startDate >= new Date()).sort((a, b) => a.startDate.getTime() - b.startDate.getTime())[0];
  const gaps = profileGaps({
    hasIdentity: !!(p?.tcNoEnc || p?.passportNoEnc),
    hasBirthDate: !!p?.birthDate,
    hasNationality: !!p?.nationality,
    passportExpiry: p?.passportExpiry ?? null,
    hasPassportDoc: docs.some((d) => d.kind === "PASSPORT" || d.kind === "ID_CARD"),
    hasPhoto: docs.some((d) => d.kind === "PHOTO"),
    hasPreferences: !!(p && p.games.length && (p.tableMin || p.tableMax)),
    nextTripStart: next?.startDate ?? null,
    nextTripHasTravel: !!next?.travel,
  });

  return {
    identity,
    seeIdentity,
    preferences: p ? { games: p.games, tableMin: p.tableMin, tableMax: p.tableMax, limitCurrency: p.limitCurrency, host, preferences: p.preferences, updatedAt: p.updatedAt } : null,
    documents: seeIdentity ? docs : null,
    documentCount: docs.length,
    casinoNumbers: ext.filter((e) => casinoNames.has(e.source)),
    casinos,
    trips,
    gaps,
  };
}

/** Ön yatırım / kredi hattı: yalnız finans yetkisiyle, erişim kaydıyla. */
export async function guestCreditLines(user: Principal, guestId: string) {
  need(user, "finance.view");
  await financeView(user, "guest.credit", guestId);
  const [rows, casinos] = await Promise.all([
    db.guestCreditLine.findMany({ where: { guestId }, include: { casino: { select: { name: true } } }, orderBy: { updatedAt: "desc" } }),
    db.casino.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, currency: true } }),
  ]);
  return {
    lines: rows.map((c) => ({ casinoId: c.casinoId, casino: c.casino.name, frontMoney: c.frontMoney?.toString() ?? null, creditLimit: c.creditLimit?.toString() ?? null, currency: c.currency, note: c.note, updatedAt: c.updatedAt })),
    casinos,
  };
}

export async function saveIdentity(
  user: Principal,
  guestId: string,
  input: { nationality?: string; gender?: string; birthDate?: string; tcNo?: string; passportNo?: string; passportCountry?: string; passportExpiry?: string; address?: string },
) {
  need(user, "guest.edit", "field.identity");
  await guestInScope(user, guestId);
  const data: Prisma.GuestProfileUncheckedCreateInput = { guestId, updatedBy: user.id };
  const changed: string[] = [];
  if (input.nationality !== undefined) {
    const n = input.nationality.trim().toUpperCase();
    if (n && !/^[A-Z]{2}$/.test(n)) throw new ProfileEditError("BAD_COUNTRY");
    data.nationality = n || null;
    changed.push("nationality");
  }
  if (input.gender !== undefined) {
    if (input.gender && !["F", "M", "X"].includes(input.gender)) throw new ProfileEditError("BAD_VALUE");
    data.gender = input.gender || null;
    changed.push("gender");
  }
  if (input.birthDate !== undefined) {
    const d = dateOrNull(input.birthDate);
    if (d && (d > new Date(Date.now() - 18 * 365.25 * 86_400_000) || d.getUTCFullYear() < 1920)) throw new ProfileEditError("UNDERAGE");
    data.birthDate = d;
    changed.push("birthDate");
  }
  if (input.tcNo !== undefined && input.tcNo.trim()) {
    const t = input.tcNo.trim();
    if (!isValidTcNo(t)) throw new ProfileEditError("BAD_TCNO");
    data.tcNoEnc = encrypt(t);
    data.tcNoHash = blindIndex(t);
    changed.push("tcNo");
  }
  if (input.passportNo !== undefined && input.passportNo.trim()) {
    const pn = normalizePassportNo(input.passportNo);
    if (!pn) throw new ProfileEditError("BAD_PASSPORT");
    data.passportNoEnc = encrypt(pn);
    data.passportNoHash = blindIndex(pn);
    changed.push("passportNo");
  }
  if (input.passportCountry !== undefined) {
    const c = input.passportCountry.trim().toUpperCase();
    if (c && !/^[A-Z]{2}$/.test(c)) throw new ProfileEditError("BAD_COUNTRY");
    data.passportCountry = c || null;
    changed.push("passportCountry");
  }
  if (input.passportExpiry !== undefined) {
    data.passportExpiry = dateOrNull(input.passportExpiry);
    changed.push("passportExpiry");
  }
  if (input.address !== undefined && input.address.trim()) {
    if (input.address.length > 500) throw new ProfileEditError("TOO_LONG");
    data.addressEnc = encrypt(input.address.trim());
    changed.push("address");
  }
  const update: Prisma.GuestProfileUncheckedUpdateInput = { ...data };
  delete update.guestId;
  await db.guestProfile.upsert({ where: { guestId }, create: data, update });
  await audit({ actorId: user.id, action: "guest.identity.update", entity: "Guest", entityId: guestId, diff: { fields: changed } });
}

export async function savePreferences(user: Principal, guestId: string, input: { games: string[]; tableMin?: string; tableMax?: string; limitCurrency?: string; hostUserId?: string; preferences?: string }) {
  need(user, "guest.edit");
  await guestInScope(user, guestId);
  const games = input.games.filter((g) => g in GAMES);
  const num = (s?: string) => (s && s.trim() ? Number(s.replace(/\./g, "").replace(",", ".")) : null);
  const tableMin = num(input.tableMin);
  const tableMax = num(input.tableMax);
  for (const v of [tableMin, tableMax]) if (v !== null && (!Number.isFinite(v) || v < 0 || v > 1e10)) throw new ProfileEditError("BAD_VALUE");
  if (tableMin !== null && tableMax !== null && tableMin > tableMax) throw new ProfileEditError("MIN_GT_MAX");
  if (input.hostUserId && !(await db.user.findFirst({ where: { id: input.hostUserId, status: "ACTIVE" } }))) throw new ProfileEditError("BAD_HOST");
  if ((input.preferences ?? "").length > 1000) throw new ProfileEditError("TOO_LONG");
  const data = {
    games,
    tableMin: tableMin === null ? null : Math.round(tableMin),
    tableMax: tableMax === null ? null : Math.round(tableMax),
    limitCurrency: (input.limitCurrency || "").toUpperCase() || null,
    hostUserId: input.hostUserId || null,
    preferences: input.preferences?.trim() || null,
    updatedBy: user.id,
  };
  await db.guestProfile.upsert({ where: { guestId }, create: { guestId, ...data }, update: data });
  await audit({ actorId: user.id, action: "guest.preferences.update", entity: "Guest", entityId: guestId, diff: { games, tableMin: data.tableMin, tableMax: data.tableMax, host: data.hostUserId } });
}

export async function addCasinoNumber(user: Principal, guestId: string, casinoId: string, value: string) {
  need(user, "guest.edit");
  await guestInScope(user, guestId);
  const casino = await db.casino.findUnique({ where: { id: casinoId } });
  if (!casino) throw new ProfileEditError("NOT_FOUND");
  const v = value.trim();
  if (!/^[A-Za-z0-9._\-/]{2,40}$/.test(v)) throw new ProfileEditError("BAD_VALUE");
  const exists = await db.guestExternalId.findUnique({ where: { source_value: { source: casino.name, value: v } } });
  if (exists && exists.guestId !== guestId) throw new ProfileEditError("NUMBER_TAKEN");
  if (!exists) await db.guestExternalId.create({ data: { guestId, source: casino.name, value: v } });
  await audit({ actorId: user.id, action: "guest.casino_number.add", entity: "Guest", entityId: guestId, diff: { casino: casino.name, value: v } });
}

export async function saveTravel(
  user: Principal,
  tripGuestId: string,
  input: { outFlight?: string; outAt?: string; outRoute?: string; retFlight?: string; retAt?: string; retRoute?: string; pnr?: string; hotel?: string; roomType?: string; checkIn?: string; checkOut?: string; transfer?: string; companion?: string; note?: string },
) {
  if (!can(user, "guest.edit") && !can(user, "finance.result.edit")) throw new ProfileEditError("FORBIDDEN");
  const tg = await db.tripGuest.findUnique({ where: { id: tripGuestId }, select: { guestId: true } });
  if (!tg) throw new ProfileEditError("NOT_FOUND");
  if (can(user, "guest.view")) await guestInScope(user, tg.guestId);
  else if (!can(user, "finance.view")) throw new ProfileEditError("FORBIDDEN");
  const s = (v?: string) => (v && v.trim() ? v.trim().slice(0, 200) : null);
  const dt = (v?: string) => {
    if (!v) return null;
    const d = new Date(v.length === 16 ? `${v}:00+03:00` : v);
    if (isNaN(d.getTime())) throw new ProfileEditError("BAD_DATE");
    return d;
  };
  const checkIn = dateOrNull(input.checkIn);
  const checkOut = dateOrNull(input.checkOut);
  if (checkIn && checkOut && checkIn > checkOut) throw new ProfileEditError("BAD_DATE");
  const data = {
    outFlight: s(input.outFlight), outAt: dt(input.outAt), outRoute: s(input.outRoute),
    retFlight: s(input.retFlight), retAt: dt(input.retAt), retRoute: s(input.retRoute),
    pnr: s(input.pnr), hotel: s(input.hotel), roomType: s(input.roomType), checkIn, checkOut,
    transfer: s(input.transfer), companion: s(input.companion), note: s(input.note), updatedBy: user.id,
  };
  await db.tripGuestTravel.upsert({ where: { tripGuestId }, create: { tripGuestId, ...data }, update: data });
  await audit({ actorId: user.id, action: "trip.travel.update", entity: "TripGuest", entityId: tripGuestId, diff: { guestId: tg.guestId, fields: Object.keys(data).filter((k) => data[k as keyof typeof data] !== null) } });
}

export async function saveCreditLine(user: Principal, guestId: string, input: { casinoId: string; frontMoney?: string; creditLimit?: string; note?: string }) {
  need(user, "finance.view", "finance.result.edit");
  // Finans yalnız tripte yer alan (casinoya gönderilen) oyuncular için kayıt tutar
  if (!(await db.tripGuest.findFirst({ where: { guestId }, select: { id: true } }))) throw new ProfileEditError("NOT_FOUND");
  const casino = await db.casino.findUnique({ where: { id: input.casinoId } });
  if (!casino) throw new ProfileEditError("NOT_FOUND");
  const dec = (v?: string) => {
    if (!v || !v.trim()) return null;
    const n = v.replace(/\s/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".");
    if (!/^\d+(\.\d{1,2})?$/.test(n)) throw new ProfileEditError("BAD_VALUE");
    return new Prisma.Decimal(n);
  };
  const data = { frontMoney: dec(input.frontMoney), creditLimit: dec(input.creditLimit), currency: casino.currency, note: input.note?.trim().slice(0, 300) || null, updatedBy: user.id };
  await db.guestCreditLine.upsert({ where: { guestId_casinoId: { guestId, casinoId: casino.id } }, create: { guestId, casinoId: casino.id, ...data }, update: data });
  await audit({ actorId: user.id, action: "finance.credit_line.update", entity: "Guest", entityId: guestId, diff: { casino: casino.name, frontMoney: data.frontMoney?.toString() ?? null, creditLimit: data.creditLimit?.toString() ?? null } });
}

export async function uploadDocument(user: Principal, guestId: string, kind: string, file: File) {
  need(user, "guest.edit", "field.identity");
  await guestInScope(user, guestId);
  if (!(kind in DOCUMENT_KINDS)) throw new ProfileEditError("BAD_VALUE");
  if (!file || file.size === 0) throw new ProfileEditError("NO_FILE");
  if (file.size > DOCUMENT_MAX_BYTES) throw new ProfileEditError("TOO_LARGE");
  if (!(DOCUMENT_MIME as readonly string[]).includes(file.type)) throw new ProfileEditError("BAD_TYPE");
  const data = Buffer.from(await file.arrayBuffer());
  // İçerik imzası beyan edilen türle uyuşmalı (uzantı/ad değiştirilmiş dosyalar reddedilir)
  const sig = data.subarray(0, 4).toString("hex");
  const okSig = (file.type === "image/jpeg" && sig.startsWith("ffd8ff")) || (file.type === "image/png" && sig === "89504e47") || (file.type === "application/pdf" && sig === "25504446");
  if (!okSig) throw new ProfileEditError("BAD_TYPE");
  const scan = await scanBuffer(data);
  if (scan.status === "INFECTED") {
    await audit({ actorId: user.id, action: "guest.document.infected", entity: "Guest", entityId: guestId, diff: { signature: scan.signature } });
    throw new ProfileEditError("INFECTED");
  }
  if (scan.status === "ERROR") throw new ProfileEditError("SCAN_FAILED");
  const storageKey = await putEncrypted("documents", data);
  const doc = await db.guestDocument.create({
    data: {
      guestId, kind, fileName: file.name.replace(/[^\p{L}\p{N}._ -]/gu, "_").slice(0, 120) || "belge", mime: file.type, size: file.size,
      sha256: createHash("sha256").update(data).digest("hex"), storageKey, scanResult: scan.status, uploadedBy: user.id,
    },
  });
  await audit({ actorId: user.id, action: "guest.document.upload", entity: "Guest", entityId: guestId, diff: { documentId: doc.id, kind, size: file.size } });
  return doc.id;
}

export async function deleteDocument(user: Principal, documentId: string, reason: string) {
  need(user, "guest.edit", "field.identity");
  if (reason.trim().length < 5) throw new ProfileEditError("REASON_REQUIRED");
  const doc = await db.guestDocument.findUnique({ where: { id: documentId } });
  if (!doc || doc.deletedAt) throw new ProfileEditError("NOT_FOUND");
  await guestInScope(user, doc.guestId);
  await db.guestDocument.update({ where: { id: documentId }, data: { deletedAt: new Date(), deletedBy: user.id } });
  await audit({ actorId: user.id, action: "guest.document.delete", entity: "Guest", entityId: doc.guestId, reason, diff: { documentId } });
  return doc.guestId;
}

/** Belge görüntüleme (rota): field.identity + kapsam + gerekçe; erişim kaydı. */
export async function openDocument(user: Principal, documentId: string, reason: string) {
  if (!can(user, "field.identity")) throw new ProfileEditError("FORBIDDEN");
  if (reason.trim().length < 5) throw new ProfileEditError("REASON_REQUIRED");
  const doc = await db.guestDocument.findUnique({ where: { id: documentId } });
  if (!doc || doc.deletedAt) throw new ProfileEditError("NOT_FOUND");
  await guestInScope(user, doc.guestId);
  await logAccess({ actorId: user.id, action: "view", resource: "guest.document", resourceId: doc.id, reason, meta: { guestId: doc.guestId, kind: doc.kind } });
  return doc;
}
