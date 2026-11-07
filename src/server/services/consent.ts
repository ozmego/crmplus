import "server-only";
import type { ConsentChannel, ConsentStatus, Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { can, guestScopeWhere, type Principal } from "@/server/auth/rbac";
import { audit } from "@/server/audit";

type Tx = Prisma.TransactionClient;

export const CONTACT_CHANNELS = ["CALL", "SMS", "WHATSAPP", "EMAIL"] as const;

/**
 * İletişim durdurma (docs/04 §4). Aynı transaction içinde: izinler DENIED, açık görevler ve
 * geri aramalar iptal. Çağrı ekranı, misafir kartı ve mesaj RET yanıtı bu fonksiyonu kullanır.
 */
export async function applyContactBlock(
  tx: Tx,
  args: {
    guestId: string;
    allChannels: boolean;
    channel?: (typeof CONTACT_CHANNELS)[number];
    requestedAt: Date;
    actorId: string | null;
    reason: "GUEST_REQUEST" | "LEGAL" | "DNC_LIST";
    proof?: string;
    source: string;
  },
) {
  const now = new Date();
  const block = await tx.contactBlock.create({
    data: {
      guestId: args.guestId,
      allChannels: args.allChannels,
      channel: args.allChannels ? null : args.channel,
      reason: args.reason,
      requestedAt: args.requestedAt,
      recordedBy: args.actorId,
      proof: args.proof,
    },
  });
  const channels = args.allChannels ? CONTACT_CHANNELS : ([args.channel ?? "CALL"] as const);
  for (const channel of channels) {
    const prev = await tx.consentRecord.findUnique({ where: { guestId_channel: { guestId: args.guestId, channel } } });
    await tx.consentRecord.upsert({
      where: { guestId_channel: { guestId: args.guestId, channel } },
      update: { status: "DENIED", deniedAt: now, source: args.source, sourceSystem: "CRM", updatedBy: args.actorId },
      create: { guestId: args.guestId, channel, status: "DENIED", deniedAt: now, source: args.source, sourceSystem: "CRM", updatedBy: args.actorId },
    });
    await tx.consentHistory.create({
      data: { guestId: args.guestId, channel, oldStatus: prev?.status ?? null, newStatus: "DENIED", source: args.proof ?? args.source, actorId: args.actorId },
    });
  }
  if (args.allChannels || (args.channel ?? "CALL") === "CALL") {
    await tx.task.updateMany({
      where: { guestId: args.guestId, status: { in: ["OPEN", "IN_PROGRESS", "BLOCKED"] } },
      data: { status: "CANCELLED", closeReason: "DO_NOT_CONTACT" },
    });
    await tx.callback.updateMany({ where: { guestId: args.guestId, status: "PENDING" }, data: { status: "CANCELLED" } });
  }
  return block;
}

export class ConsentError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

/** Misafir kartından durdurma kaydı (block.create — herkes açabilir, kapsam dahilindeki misafire). */
export async function createBlock(
  user: Principal,
  input: { guestId: string; allChannels: boolean; channel?: (typeof CONTACT_CHANNELS)[number]; requestedAt: Date; proof?: string },
) {
  const visible = await db.guest.count({ where: { AND: [{ id: input.guestId }, guestScopeWhere(user, "guest.view")] } });
  if (!visible) throw new ConsentError("NOT_FOUND");
  if (input.requestedAt > new Date()) throw new ConsentError("FUTURE_DATE");
  const block = await db.$transaction((tx) =>
    applyContactBlock(tx, { ...input, actorId: user.id, reason: "GUEST_REQUEST", source: "Misafir talebi (manuel kayıt)" }),
  );
  await audit({
    actorId: user.id, action: "block.create", entity: "Guest", entityId: input.guestId,
    diff: { allChannels: input.allChannels, channel: input.channel ?? null, requestedAt: input.requestedAt.toISOString() },
  });
  return block;
}

/**
 * Kanal izni güncelleme (docs/04 §2). consent.edit olmadan yalnız ret yönünde değişiklik yapılabilir.
 * İzin vermek kaynak ve kanıt ister; aktif durdurma kaydı varken izin verilemez.
 */
export async function setConsent(
  user: Principal,
  input: {
    guestId: string;
    channel: ConsentChannel;
    status: ConsentStatus;
    scope: "MARKETING" | "SERVICE";
    source?: string;
    proofRef?: string;
    validUntil?: Date | null;
  },
) {
  const visible = await db.guest.count({ where: { AND: [{ id: input.guestId }, guestScopeWhere(user, "guest.view")] } });
  if (!visible) throw new ConsentError("NOT_FOUND");
  if (input.status !== "DENIED" && !can(user, "consent.edit")) throw new ConsentError("FORBIDDEN");
  if (input.status === "GRANTED") {
    if (!input.source?.trim() || !input.proofRef?.trim()) throw new ConsentError("PROOF_REQUIRED");
    const blocked = await db.contactBlock.count({
      where: { guestId: input.guestId, removedAt: null, OR: [{ allChannels: true }, { channel: input.channel }] },
    });
    if (blocked && input.channel !== "RECORDING") throw new ConsentError("BLOCK_ACTIVE");
  }
  const now = new Date();
  await db.$transaction(async (tx) => {
    const prev = await tx.consentRecord.findUnique({ where: { guestId_channel: { guestId: input.guestId, channel: input.channel } } });
    const data = {
      status: input.status,
      scope: input.scope,
      source: input.source,
      proofRef: input.proofRef,
      sourceSystem: "CRM",
      validUntil: input.validUntil ?? null,
      grantedAt: input.status === "GRANTED" ? now : prev?.grantedAt ?? null,
      deniedAt: input.status === "DENIED" ? now : prev?.deniedAt ?? null,
      updatedBy: user.id,
    };
    await tx.consentRecord.upsert({
      where: { guestId_channel: { guestId: input.guestId, channel: input.channel } },
      update: data,
      create: { guestId: input.guestId, channel: input.channel, ...data },
    });
    await tx.consentHistory.create({
      data: { guestId: input.guestId, channel: input.channel, oldStatus: prev?.status ?? null, newStatus: input.status, source: input.source, actorId: user.id },
    });
  });
  await audit({ actorId: user.id, action: "consent.set", entity: "Guest", entityId: input.guestId, diff: { channel: input.channel, status: input.status, scope: input.scope } });
}
