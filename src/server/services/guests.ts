import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { can, guestScopeWhere, type Principal } from "@/server/auth/rbac";
import { decrypt } from "@/server/crypto/field-encryption";
import { logAccess } from "@/server/audit";
import { blindIndex } from "@/server/crypto/field-encryption";
import { normalizePhone } from "@/lib/phone";

/**
 * Misafir okuma servisi. Yanıtlar alan politikasına göre kurulur (docs/01 §3):
 * finansal alanlar hiç seçilmez; notlar yalnız field.notes ile; maskesiz iletişim yalnız reveal ile.
 */

export const PAGE_SIZE = 50;

export async function listGuests(user: Principal, opts: { q?: string; consent?: string; page?: number }) {
  const where: Prisma.GuestWhereInput = { AND: [guestScopeWhere(user, "guest.view")] };
  const and = where.AND as Prisma.GuestWhereInput[];
  const q = opts.q?.trim();
  if (q) {
    const crm = /^crm-?(\d+)$/i.exec(q) ?? /^(\d{1,9})$/.exec(q);
    const phone = normalizePhone(q, process.env.DEFAULT_PHONE_COUNTRY ?? "TR");
    and.push({
      OR: [
        { firstName: { contains: q, mode: "insensitive" } },
        { lastName: { contains: q, mode: "insensitive" } },
        ...(crm ? [{ crmNo: Number(crm[1]) }] : []),
        ...(phone.ok && phone.e164 ? [{ phones: { some: { phoneHash: blindIndex(phone.e164) } } }] : []),
        { externalIds: { some: { value: q } } },
      ],
    });
  }
  if (opts.consent === "GRANTED" || opts.consent === "DENIED") {
    and.push({ consents: { some: { channel: "CALL", status: opts.consent } } });
  } else if (opts.consent === "UNKNOWN") {
    and.push({ NOT: { consents: { some: { channel: "CALL", status: { in: ["GRANTED", "DENIED"] } } } } });
  } else if (opts.consent === "BLOCKED") {
    and.push({ blocks: { some: { removedAt: null } } });
  }

  const page = Math.max(1, opts.page ?? 1);
  const [total, rows] = await Promise.all([
    db.guest.count({ where }),
    db.guest.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true, crmNo: true, firstName: true, lastName: true, language: true, country: true, vipLevel: true, updatedAt: true,
        owner: { select: { name: true } },
        phones: { where: { isPrimary: true }, select: { masked: true, reachability: true, formatStatus: true }, take: 1 },
        consents: { where: { channel: "CALL" }, select: { status: true } },
        blocks: { where: { removedAt: null }, select: { id: true }, take: 1 },
      },
    }),
  ]);
  return { total, page, pageSize: PAGE_SIZE, rows };
}

export async function getGuestCard(user: Principal, id: string) {
  const guest = await db.guest.findFirst({
    where: { AND: [{ id }, guestScopeWhere(user, "guest.view")] },
    select: {
      id: true, crmNo: true, firstName: true, lastName: true, language: true, timezone: true, country: true, city: true,
      vipLevel: true, tags: true, createdAt: true, updatedAt: true, fieldSources: true,
      birthYear: can(user, "field.identity"),
      owner: { select: { id: true, name: true } },
      phones: {
        orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
        select: {
          id: true, masked: true, country: true, lineType: true, isPrimary: true, formatStatus: true, reachability: true,
          ownership: true, lastReachedAt: true, lastFailedAt: true, lastCheckedAt: true,
        },
      },
      emails: { select: { id: true, masked: true, isPrimary: true } },
      externalIds: { select: { source: true, value: true } },
      consents: { orderBy: { channel: "asc" } },
      blocks: { orderBy: { recordedAt: "desc" } },
      interactions: { orderBy: { at: "desc" }, take: 50 },
      history: { orderBy: { at: "desc" }, take: 100 },
      notes: can(user, "field.notes") ? { orderBy: { createdAt: "desc" }, take: 20 } : false,
      tasks: { where: { status: { in: ["OPEN", "IN_PROGRESS", "BLOCKED"] } }, select: { id: true, reason: true, status: true, assignee: { select: { name: true } }, closeReason: true } },
    },
  });
  if (!guest) return null;
  await logAccess({ actorId: user.id, action: "view", resource: "Guest", resourceId: id });
  return {
    ...guest,
    notes: guest.notes ? guest.notes.map((n) => ({ id: n.id, createdAt: n.createdAt, authorId: n.authorId, body: decrypt(n.bodyEnc) })) : null,
  };
}

/** Maskesiz telefon: izin + gerekçe + erişim kaydı (docs/01 §6). */
export async function revealPhone(user: Principal, phoneId: string, reason: string) {
  const phone = await db.guestPhone.findUnique({ where: { id: phoneId }, select: { e164Enc: true, guestId: true } });
  if (!phone) return null;
  const visible = await db.guest.count({ where: { AND: [{ id: phone.guestId }, guestScopeWhere(user, "guest.view")] } });
  if (!visible) return null;
  await logAccess({ actorId: user.id, action: "reveal", resource: "GuestPhone", resourceId: phoneId, reason, meta: { guestId: phone.guestId } });
  return decrypt(phone.e164Enc);
}
