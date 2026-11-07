import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import type { Principal } from "@/server/auth/rbac";
import { audit } from "@/server/audit";
import { createGuestFromRow, mergeRowIntoGuest, type StoredRow } from "@/server/services/imports";

/**
 * İnceleme kuyruğu (plan v4 §1). Otomatik birleştirme yerine insan kararı.
 * Kararlar: tür başına izinli eylemler; her karar gerekçeli ve denetim kaydına yazılır.
 */

export const REVIEW_KINDS = ["POSSIBLE_DUPLICATE", "MULTI_MATCH", "FIELD_CONFLICT", "CONSENT_CONFLICT", "DISPUTED_PHONE"] as const;
export type ReviewKind = (typeof REVIEW_KINDS)[number];

export const ALLOWED: Record<ReviewKind, string[]> = {
  POSSIBLE_DUPLICATE: ["MERGE", "CREATE_NEW", "DISMISS"],
  MULTI_MATCH: ["MERGE", "CREATE_NEW", "DISMISS"],
  FIELD_CONFLICT: ["KEEP_CURRENT", "USE_INCOMING"],
  CONSENT_CONFLICT: ["KEEP_CURRENT", "ACCEPT_INCOMING"],
  DISPUTED_PHONE: ["REMOVE_PHONE", "CONFIRM_OWNER", "DISMISS"],
};

export class ReviewError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

export async function listReview(opts: { kind?: string; status?: string; take?: number }) {
  const where: Prisma.ReviewItemWhereInput = {
    status: opts.status === "RESOLVED" ? { in: ["RESOLVED", "DISMISSED"] } : "OPEN",
    ...(opts.kind && (REVIEW_KINDS as readonly string[]).includes(opts.kind) ? { kind: opts.kind } : {}),
  };
  const [items, counts] = await Promise.all([
    db.reviewItem.findMany({ where, orderBy: { createdAt: "asc" }, take: opts.take ?? 50 }),
    db.reviewItem.groupBy({ by: ["kind"], where: { status: "OPEN" }, _count: true }),
  ]);
  const ids = new Set<string>();
  for (const it of items) {
    if (it.guestId) ids.add(it.guestId);
    if (Array.isArray(it.candidates)) for (const c of it.candidates) if (typeof c === "string") ids.add(c);
  }
  const guests = await db.guest.findMany({
    where: { id: { in: [...ids] } },
    select: {
      id: true, crmNo: true, firstName: true, lastName: true, birthYear: true, city: true, language: true,
      phones: { select: { id: true, masked: true, ownership: true } },
      consents: { select: { channel: true, status: true } },
      blocks: { where: { removedAt: null }, select: { id: true } },
    },
  });
  return { items, counts: Object.fromEntries(counts.map((c) => [c.kind, c._count])), guests: new Map(guests.map((g) => [g.id, g])) };
}

async function loadSourceRow(sourceRef: string | null, rowNo: unknown): Promise<StoredRow> {
  const batchId = sourceRef?.startsWith("import:") ? sourceRef.slice(7) : null;
  if (!batchId || typeof rowNo !== "number") throw new ReviewError("SOURCE_MISSING");
  const row = await db.importRow.findFirst({ where: { batchId, rowNo } });
  if (!row?.normalized) throw new ReviewError("SOURCE_MISSING");
  return row.normalized as unknown as StoredRow;
}

export async function resolveReview(
  user: Principal,
  input: { id: string; action: string; reason: string; targetGuestId?: string; proofRef?: string },
) {
  const item = await db.reviewItem.findUnique({ where: { id: input.id } });
  if (!item || item.status !== "OPEN") throw new ReviewError("NOT_OPEN");
  const kind = item.kind as ReviewKind;
  if (!ALLOWED[kind]?.includes(input.action)) throw new ReviewError("BAD_ACTION");
  const payload = (item.payload ?? {}) as Record<string, unknown>;
  const source = `review:${item.id}`;
  const result: Record<string, unknown> = {};

  await db.$transaction(async (tx) => {
    switch (kind) {
      case "POSSIBLE_DUPLICATE":
      case "MULTI_MATCH": {
        if (input.action === "DISMISS") break;
        const s = await loadSourceRow(item.sourceRef, payload.rowNo);
        if (input.action === "MERGE") {
          const candidates = (item.candidates as string[]) ?? [];
          if (!input.targetGuestId || !candidates.includes(input.targetGuestId)) throw new ReviewError("TARGET_REQUIRED");
          result.merge = await mergeRowIntoGuest(tx, input.targetGuestId, s, { actorId: user.id, source });
          result.guestId = input.targetGuestId;
        } else {
          const g = await createGuestFromRow(tx, s, { actorId: user.id, source, label: "İnceleme kuyruğundan yeni kayıt", refId: item.id });
          result.guestId = g.id;
        }
        break;
      }
      case "FIELD_CONFLICT": {
        if (input.action === "KEEP_CURRENT") break;
        const field = String(payload.field);
        if (!["firstName", "lastName", "language", "country", "city", "birthYear", "vipLevel"].includes(field) || !item.guestId) throw new ReviewError("BAD_PAYLOAD");
        const g = await tx.guest.findUniqueOrThrow({ where: { id: item.guestId } });
        const cur = (g as Record<string, unknown>)[field];
        const incoming = String(payload.incoming);
        await tx.guest.update({
          where: { id: g.id },
          data: {
            [field]: field === "birthYear" ? Number(incoming) : incoming,
            fieldSources: { ...((g.fieldSources as object) ?? {}), [field]: { source, at: new Date().toISOString() } },
          },
        });
        await tx.fieldHistory.create({
          data: { guestId: g.id, field, oldValue: cur === null || cur === undefined ? null : String(cur), newValue: incoming, sourceId: source, actorId: user.id },
        });
        break;
      }
      case "CONSENT_CONFLICT": {
        if (input.action === "KEEP_CURRENT") break;
        // Kanıtsız izin kabul edilmez; aktif durdurma kaydı varken hiç kabul edilmez (docs/04 §4.6)
        if (!input.proofRef?.trim()) throw new ReviewError("PROOF_REQUIRED");
        const channel = String(payload.channel) as "CALL";
        const blocked = await tx.contactBlock.count({ where: { guestId: item.guestId!, removedAt: null, OR: [{ allChannels: true }, { channel }] } });
        if (blocked) throw new ReviewError("BLOCK_ACTIVE");
        const prev = await tx.consentRecord.findUnique({ where: { guestId_channel: { guestId: item.guestId!, channel } } });
        await tx.consentRecord.upsert({
          where: { guestId_channel: { guestId: item.guestId!, channel } },
          update: { status: "GRANTED", grantedAt: new Date(), proofRef: input.proofRef, source: "İnceleme kararı", sourceSystem: source, updatedBy: user.id },
          create: { guestId: item.guestId!, channel, status: "GRANTED", grantedAt: new Date(), proofRef: input.proofRef, source: "İnceleme kararı", sourceSystem: source, updatedBy: user.id },
        });
        await tx.consentHistory.create({ data: { guestId: item.guestId!, channel, oldStatus: prev?.status ?? null, newStatus: "GRANTED", source, actorId: user.id } });
        break;
      }
      case "DISPUTED_PHONE": {
        const phoneId = (item.candidates as { phoneId?: string })?.phoneId;
        if (!phoneId) throw new ReviewError("BAD_PAYLOAD");
        if (input.action === "REMOVE_PHONE") {
          const ph = await tx.guestPhone.findUnique({ where: { id: phoneId } });
          if (ph) {
            await tx.guestPhone.delete({ where: { id: phoneId } });
            await tx.fieldHistory.create({ data: { guestId: ph.guestId, field: "phone", oldValue: ph.masked, newValue: null, sourceId: source, actorId: user.id } });
          }
        } else if (input.action === "CONFIRM_OWNER") {
          await tx.guestPhone.update({ where: { id: phoneId }, data: { ownership: "CONFIRMED", reachability: "UNVERIFIED" } });
          // Yanlış kişi nedeniyle bloklanan görevler yeniden açılır
          if (item.guestId) {
            await tx.task.updateMany({ where: { guestId: item.guestId, status: "BLOCKED", closeReason: "WRONG_PERSON" }, data: { status: "OPEN", closeReason: null } });
          }
        }
        break;
      }
    }
    await tx.reviewItem.update({
      where: { id: item.id },
      data: {
        status: input.action === "DISMISS" ? "DISMISSED" : "RESOLVED",
        decision: input.action,
        decidedBy: user.id,
        decidedAt: new Date(),
        reason: input.reason,
      },
    });
  });

  await audit({ actorId: user.id, action: "review.resolve", entity: "ReviewItem", entityId: item.id, reason: input.reason, diff: { kind, action: input.action, ...result } as Prisma.InputJsonValue });
  return result;
}
