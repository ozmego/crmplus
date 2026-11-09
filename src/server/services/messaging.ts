import "server-only";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { guestScopeWhere, type Principal } from "@/server/auth/rbac";
import { audit } from "@/server/audit";
import { blindIndex, decrypt, encrypt } from "@/server/crypto/field-encryption";
import { enqueue } from "@/server/queue";
import { iysCheck, optOutText, smsProvider } from "@/server/messaging/provider";
import { applyContactBlock } from "@/server/services/consent";
import { checkEligibility, INELIGIBLE_LABEL_TR, type IneligibleReason } from "@/lib/eligibility";
import { checkTemplate, isOptOut, renderTemplate, segmentSchema, smsSegments, withOptOut, type Segment } from "@/lib/sms";
export { segmentSchema };
import { normalizePhone } from "@/lib/phone";

/**
 * SMS — Aşama 1 (docs/10): şablon, kanal bazlı izin kontrolü, kontrollü kampanya taslağı, iki kişili onay,
 * test gönderimi, hız sınırlı gönderim, gelen RET işleme. Segmentasyon yalnız izinli alanlarla yapılır;
 * kayıp/kazanç, komisyon veya analiz skoru kullanılamaz (alan beyaz listesi).
 */

export class MessagingError extends Error {
  constructor(public code: string, detail?: string) {
    super(detail ?? code);
  }
}

export type Category = "MARKETING" | "INFORMATIONAL";
export type ExclusionReason = IneligibleReason | "IYS_UNAVAILABLE" | "IYS_DENIED" | "FREQ_CAP" | "NO_PHONE";
export const EXCLUSION_LABEL_TR: Record<ExclusionReason, string> = {
  ...INELIGIBLE_LABEL_TR,
  IYS_UNAVAILABLE: "İYS bağlantısı yok (Türkiye numarası gönderilmez)",
  IYS_DENIED: "İYS ret kaydı",
  FREQ_CAP: "Son 24 saatte pazarlama mesajı aldı",
  NO_PHONE: "Telefon yok",
};


function segmentWhere(s: Segment): Prisma.GuestWhereInput {
  const and: Prisma.GuestWhereInput[] = [{ anonymizedAt: null }];
  if (s.languages?.length) and.push({ language: { in: s.languages } });
  if (s.countries?.length) and.push({ country: { in: s.countries } });
  if (s.tags?.length) and.push({ tags: { hasSome: s.tags } });
  if (s.lastContactBeforeDays !== undefined) {
    and.push({ NOT: { interactions: { some: { at: { gte: new Date(Date.now() - s.lastContactBeforeDays * 86_400_000) } } } } });
  }
  return { AND: and };
}

// ───────────── Şablonlar ─────────────

export async function createTemplate(user: Principal, input: { name: string; category: Category; body: string }) {
  const chk = checkTemplate(input.body, input.category);
  if (chk.errors.length) throw new MessagingError("TEMPLATE_INVALID", chk.errors.join(" "));
  const t = await db.messageTemplate.create({ data: { name: input.name.trim(), category: input.category, body: input.body.trim(), warnings: chk.warnings, createdBy: user.id } });
  await audit({ actorId: user.id, action: "message.template.create", entity: "MessageTemplate", entityId: t.id, diff: { category: input.category, warnings: chk.warnings } });
  return t;
}

export async function approveTemplate(user: Principal, id: string) {
  const t = await db.messageTemplate.findUniqueOrThrow({ where: { id } });
  if (t.status !== "DRAFT") throw new MessagingError("BAD_STATE");
  if (t.createdBy === user.id) throw new MessagingError("SAME_PERSON");
  await db.messageTemplate.update({ where: { id }, data: { status: "APPROVED", approvedBy: user.id, approvedAt: new Date() } });
  await audit({ actorId: user.id, action: "message.template.approve", entity: "MessageTemplate", entityId: id });
}

// ───────────── Uygunluk ─────────────

interface Recipient {
  guestId: string;
  phoneId: string;
  e164: string;
  values: { ad: string; soyad: string; sehir: string; temsilci_adi: string };
}

/** Kampanya alıcıları: SMS izni, durdurma, hat türü, İYS, sıklık sınırı (docs/10 §3). Her gönderimde yeniden çağrılır. */
export async function evaluateRecipients(category: Category, where: Prisma.GuestWhereInput, limit = 50_000) {
  const now = new Date();
  const guests = await db.guest.findMany({
    where,
    take: limit,
    select: {
      id: true, firstName: true, lastName: true, city: true, anonymizedAt: true,
      owner: { select: { name: true } },
      phones: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] },
      consents: { where: { channel: "SMS" } },
      blocks: { where: { removedAt: null } },
    },
  });
  const recentMarketing = new Set(
    category === "MARKETING"
      ? (await db.message.findMany({
          where: { direction: "OUT", isTest: false, createdAt: { gte: new Date(now.getTime() - 86_400_000) }, campaignId: { not: null }, status: { in: ["SENT", "DELIVERED"] } },
          select: { guestId: true },
        })).map((m) => m.guestId)
      : [],
  );
  const eligible: Recipient[] = [];
  const excluded: Partial<Record<ExclusionReason, number>> = {};
  const exclude = (r: ExclusionReason) => (excluded[r] = (excluded[r] ?? 0) + 1);

  for (const g of guests) {
    if (!g.phones.length) {
      exclude("NO_PHONE");
      continue;
    }
    let reason: ExclusionReason | null = null;
    let chosen: (typeof g.phones)[number] | null = null;
    for (const ph of g.phones) {
      const r = checkEligibility({
        channel: "SMS", purpose: category === "MARKETING" ? "MARKETING" : "SERVICE", now, guest: g, consent: g.consents[0] ?? null, blocks: g.blocks,
        phone: { formatStatus: ph.formatStatus, ownership: ph.ownership, reachability: ph.reachability, lineType: ph.lineType },
      });
      if (r.ok) {
        chosen = ph;
        break;
      }
      reason ??= r.reason;
    }
    if (!chosen) {
      exclude(reason ?? "INVALID_PHONE");
      continue;
    }
    // Bilgilendirme muafiyeti hukuk teyidine kadar uygulanmaz: her iki kategori de İYS'den geçer (docs/10 §2)
    if (chosen.country === "TR") {
      const iys = await iysCheck(chosen.phoneHash);
      if (iys === "UNAVAILABLE") {
        exclude("IYS_UNAVAILABLE");
        continue;
      }
      if (iys === "RET") {
        exclude("IYS_DENIED");
        continue;
      }
    }
    if (category === "MARKETING" && recentMarketing.has(g.id)) {
      exclude("FREQ_CAP");
      continue;
    }
    eligible.push({
      guestId: g.id,
      phoneId: chosen.id,
      e164: decrypt(chosen.e164Enc),
      values: { ad: g.firstName, soyad: g.lastName, sehir: g.city ?? "", temsilci_adi: g.owner?.name ?? "" },
    });
  }
  return { total: guests.length, eligible, excluded };
}

// ───────────── Kampanya ─────────────

async function estimateFor(category: Category, segment: Segment, templateBody: string) {
  const { total, eligible, excluded } = await evaluateRecipients(category, segmentWhere(segment));
  const sample = eligible.slice(0, 5).map((r) => withOptOut(renderTemplate(templateBody, r.values), category, optOutText()));
  const seg = sample.length ? Math.max(...sample.map((s) => smsSegments(s).segments)) : smsSegments(withOptOut(templateBody, category, optOutText())).segments;
  const unitCost = Number(process.env.SMS_UNIT_COST ?? 0.2);
  return {
    total, eligible: eligible.length, excluded, segmentsPerMessage: seg,
    estimatedCost: Number((eligible.length * seg * unitCost).toFixed(2)), unitCost,
    preview: sample.map((s) => s.replace(/\d{6,}/g, "•••")),
    computedAt: new Date().toISOString(),
  };
}

export async function createCampaign(user: Principal, input: { name: string; category: Category; templateId: string; segment: Segment }) {
  const tpl = await db.messageTemplate.findUniqueOrThrow({ where: { id: input.templateId } });
  if (tpl.status !== "APPROVED") throw new MessagingError("TEMPLATE_NOT_APPROVED");
  if (tpl.category !== input.category) throw new MessagingError("CATEGORY_MISMATCH");
  const segment = segmentSchema.parse(input.segment);
  const estimate = await estimateFor(input.category, segment, tpl.body);
  const c = await db.messageCampaign.create({
    data: { name: input.name.trim(), category: input.category, templateId: tpl.id, segment, estimate: estimate as unknown as Prisma.InputJsonValue, preparedBy: user.id },
  });
  await audit({ actorId: user.id, action: "message.campaign.create", entity: "MessageCampaign", entityId: c.id, diff: { segment, eligible: estimate.eligible } });
  return c;
}

export async function refreshEstimate(id: string) {
  const c = await db.messageCampaign.findUniqueOrThrow({ where: { id } });
  const tpl = await db.messageTemplate.findUniqueOrThrow({ where: { id: c.templateId } });
  const estimate = await estimateFor(c.category as Category, c.segment as Segment, tpl.body);
  await db.messageCampaign.update({ where: { id }, data: { estimate: estimate as unknown as Prisma.InputJsonValue } });
  return estimate;
}

/** Test gönderimi: hazırlayanın girdiği numaraya, örnek değerlerle (docs/10 §5 adım 3). */
export async function testSend(user: Principal, id: string, rawPhone: string) {
  const c = await db.messageCampaign.findUniqueOrThrow({ where: { id } });
  if (c.status === "DONE" || c.status === "CANCELLED") throw new MessagingError("BAD_STATE");
  const n = normalizePhone(rawPhone, "TR");
  if (!n.ok || !n.e164) throw new MessagingError("BAD_PHONE");
  const tpl = await db.messageTemplate.findUniqueOrThrow({ where: { id: c.templateId } });
  const text = withOptOut(renderTemplate(tpl.body, { ad: "Örnek", soyad: "Misafir", sehir: "İstanbul", temsilci_adi: user.name }), c.category as Category, optOutText());
  const sent = await smsProvider().send({ to: n.e164, text, reference: `test-${c.id}` });
  await db.message.create({
    data: { campaignId: c.id, channel: "SMS", direction: "OUT", templateId: tpl.id, bodyEnc: encrypt(text), segments: smsSegments(text).segments, provider: sent.provider, providerMessageId: sent.providerMessageId, status: "SENT", sentById: user.id, isTest: true, sentAt: new Date(), phoneHash: blindIndex(n.e164) },
  });
  await audit({ actorId: user.id, action: "message.campaign.test", entity: "MessageCampaign", entityId: c.id, diff: { to: n.masked } });
  return { to: n.masked };
}

export async function submitCampaign(user: Principal, id: string) {
  const c = await db.messageCampaign.findUniqueOrThrow({ where: { id } });
  if (c.status !== "DRAFT") throw new MessagingError("BAD_STATE");
  if (c.preparedBy !== user.id) throw new MessagingError("NOT_PREPARER");
  const tests = await db.message.count({ where: { campaignId: id, isTest: true } });
  if (!tests) throw new MessagingError("TEST_REQUIRED");
  await refreshEstimate(id);
  await db.messageCampaign.update({ where: { id }, data: { status: "PENDING_APPROVAL", submittedAt: new Date() } });
  await audit({ actorId: user.id, action: "message.campaign.submit", entity: "MessageCampaign", entityId: id });
}

/** Onay: hazırlayan onaylayamaz; ülke/içerik/yerel hukuk uygunluğu teyidi zorunlu (plan v4 §6). */
export async function approveCampaign(user: Principal, id: string, legalConfirmed: boolean, reason: string) {
  const c = await db.messageCampaign.findUniqueOrThrow({ where: { id } });
  if (c.status !== "PENDING_APPROVAL") throw new MessagingError("BAD_STATE");
  if (c.preparedBy === user.id) throw new MessagingError("SAME_PERSON");
  if (!legalConfirmed) throw new MessagingError("LEGAL_REQUIRED");
  if (reason.trim().length < 5) throw new MessagingError("REASON_REQUIRED");
  await db.messageCampaign.update({ where: { id }, data: { status: "APPROVED", approvedBy: user.id, approvedAt: new Date(), legalConfirmed: true } });
  await audit({ actorId: user.id, action: "message.campaign.approve", entity: "MessageCampaign", entityId: id, reason });
}

export async function startCampaign(user: Principal, id: string) {
  const c = await db.messageCampaign.findUniqueOrThrow({ where: { id } });
  if (c.status !== "APPROVED") throw new MessagingError("BAD_STATE");
  await db.messageCampaign.update({ where: { id }, data: { status: "SENDING", startedAt: new Date() } });
  await enqueue("messages", "send-campaign", { campaignId: id }, { jobId: `campaign-${id}` });
  await audit({ actorId: user.id, action: "message.campaign.start", entity: "MessageCampaign", entityId: id });
}

export async function cancelCampaign(user: Principal, id: string, reason: string) {
  const c = await db.messageCampaign.findUniqueOrThrow({ where: { id } });
  if (!["DRAFT", "PENDING_APPROVAL", "APPROVED", "SENDING"].includes(c.status)) throw new MessagingError("BAD_STATE");
  if (reason.trim().length < 5) throw new MessagingError("REASON_REQUIRED");
  await db.messageCampaign.update({ where: { id }, data: { status: "CANCELLED", cancelReason: reason, finishedAt: new Date() } });
  await audit({ actorId: user.id, action: "message.campaign.cancel", entity: "MessageCampaign", entityId: id, reason });
}

/** İşçi: uygunluk her mesajda yeniden kontrol edilir; hız sınırı SMS_TPS; iptal edilirse durur. */
export async function sendCampaignJob(id: string) {
  const c = await db.messageCampaign.findUniqueOrThrow({ where: { id } });
  if (c.status !== "SENDING") return;
  const tpl = await db.messageTemplate.findUniqueOrThrow({ where: { id: c.templateId } });
  const { eligible, excluded } = await evaluateRecipients(c.category as Category, segmentWhere(c.segment as Segment));
  const provider = smsProvider();
  const tps = Math.max(1, Number(process.env.SMS_TPS ?? 10));
  let sent = 0;
  let failed = 0;
  for (let i = 0; i < eligible.length; i++) {
    if (i % 50 === 0) {
      const cur = await db.messageCampaign.findUnique({ where: { id }, select: { status: true } });
      if (cur?.status !== "SENDING") break;
    }
    const r = eligible[i];
    const text = withOptOut(renderTemplate(tpl.body, r.values), c.category as Category, optOutText());
    try {
      const res = await provider.send({ to: r.e164, text, reference: `${c.id}:${r.guestId}` });
      await db.$transaction([
        db.message.create({
          data: { campaignId: c.id, guestId: r.guestId, phoneId: r.phoneId, phoneHash: blindIndex(r.e164), channel: "SMS", direction: "OUT", templateId: tpl.id, bodyEnc: encrypt(text), segments: smsSegments(text).segments, provider: res.provider, providerMessageId: res.providerMessageId, status: "SENT", sentAt: new Date() },
        }),
        db.interaction.create({ data: { guestId: r.guestId, channel: "SMS", direction: "OUT", refId: c.id, summary: `Kampanya: ${c.name}` } }),
      ]);
      sent++;
    } catch (e) {
      await db.message.create({
        data: { campaignId: c.id, guestId: r.guestId, phoneId: r.phoneId, channel: "SMS", direction: "OUT", templateId: tpl.id, bodyEnc: encrypt(text), provider: provider.name, status: "FAILED", error: (e as Error).message.slice(0, 200) },
      });
      failed++;
    }
    await new Promise((res) => setTimeout(res, 1000 / tps));
  }
  const final = await db.messageCampaign.findUniqueOrThrow({ where: { id }, select: { status: true } });
  await db.messageCampaign.update({
    where: { id },
    data: { stats: { sent, failed, excluded }, ...(final.status === "SENDING" ? { status: "DONE", finishedAt: new Date() } : {}) },
  });
  await audit({ actorId: null, action: "message.campaign.finished", entity: "MessageCampaign", entityId: id, diff: { sent, failed } });
  return { sent, failed };
}

// ───────────── Tekil SMS (misafir kartı) ─────────────

export async function sendSingle(user: Principal, guestId: string, templateId: string) {
  const tpl = await db.messageTemplate.findUniqueOrThrow({ where: { id: templateId } });
  if (tpl.status !== "APPROVED") throw new MessagingError("TEMPLATE_NOT_APPROVED");
  const where: Prisma.GuestWhereInput = { AND: [{ id: guestId }, guestScopeWhere(user, "guest.view")] };
  const { eligible, excluded } = await evaluateRecipients(tpl.category as Category, where, 1);
  if (!eligible.length) throw new MessagingError("NOT_ELIGIBLE", Object.keys(excluded)[0] ?? "NOT_FOUND");
  const r = eligible[0];
  const text = withOptOut(renderTemplate(tpl.body, { ...r.values, temsilci_adi: user.name }), tpl.category as Category, optOutText());
  const res = await smsProvider().send({ to: r.e164, text, reference: `single:${guestId}` });
  await db.$transaction([
    db.message.create({
      data: { guestId, phoneId: r.phoneId, phoneHash: blindIndex(r.e164), channel: "SMS", direction: "OUT", templateId: tpl.id, bodyEnc: encrypt(text), segments: smsSegments(text).segments, provider: res.provider, providerMessageId: res.providerMessageId, status: "SENT", sentById: user.id, sentAt: new Date() },
    }),
    db.interaction.create({ data: { guestId, channel: "SMS", direction: "OUT", summary: `SMS: ${tpl.name}`, actorId: user.id } }),
  ]);
  await audit({ actorId: user.id, action: "message.send.single", entity: "Guest", entityId: guestId, diff: { templateId } });
}

// ───────────── Gelen mesaj / teslim raporu ─────────────

export const inboundSchema = z.object({
  eventId: z.string().min(1).max(128),
  type: z.enum(["inbound", "status"]),
  from: z.string().max(32).optional(),
  text: z.string().max(1000).optional(),
  providerMessageId: z.string().max(128).optional(),
  status: z.enum(["DELIVERED", "FAILED", "UNDELIVERABLE"]).optional(),
  at: z.string().datetime({ offset: true }),
});

/** RET → o kanal için anında durdurma (docs/10 §6); teslim raporu → telefon erişilebilirlik kanıtı. */
export async function handleMessagingEvent(provider: string, e: z.infer<typeof inboundSchema>) {
  if (e.type === "inbound") {
    const n = normalizePhone(e.from ?? "", "TR");
    if (!n.ok || !n.e164) return { status: "bad_number" as const };
    const hash = blindIndex(n.e164);
    const phones = await db.guestPhone.findMany({ where: { phoneHash: hash }, select: { guestId: true } });
    const guestIds = [...new Set(phones.map((p) => p.guestId))];
    const dup = await db.message.findFirst({ where: { provider, providerMessageId: e.eventId }, select: { id: true } });
    if (dup) return { status: "duplicate" as const };
    await db.message.create({ data: { guestId: guestIds[0] ?? null, phoneHash: hash, channel: "SMS", direction: "IN", bodyEnc: encrypt(e.text ?? ""), provider, providerMessageId: e.eventId, status: "RECEIVED" } });
    if (isOptOut(e.text ?? "")) {
      const at = new Date(e.at);
      for (const gid of guestIds) {
        const already = await db.contactBlock.count({ where: { guestId: gid, removedAt: null, OR: [{ allChannels: true }, { channel: "SMS" }] } });
        if (already) continue;
        await db.$transaction((tx) => applyContactBlock(tx, { guestId: gid, allChannels: false, channel: "SMS", requestedAt: at, actorId: null, reason: "GUEST_REQUEST", proof: `sms:${e.eventId}`, source: "SMS ile RET" }));
      }
      await db.optOutEvent.create({ data: { channel: "SMS", phoneHash: hash, keyword: (e.text ?? "").trim().slice(0, 40), guestIds, receivedAt: at } });
      await audit({ actorId: null, action: "message.opt_out", diff: { guests: guestIds.length, channel: "SMS" } });
      return { status: "opt_out" as const, guests: guestIds.length };
    }
    return { status: "received" as const };
  }
  if (!e.providerMessageId || !e.status) return { status: "ignored" as const };
  const msg = await db.message.findFirst({ where: { provider, providerMessageId: e.providerMessageId } });
  if (!msg) return { status: "unknown_message" as const };
  await db.message.update({ where: { id: msg.id }, data: { status: e.status === "DELIVERED" ? "DELIVERED" : "FAILED", deliveredAt: e.status === "DELIVERED" ? new Date(e.at) : null, error: e.status === "DELIVERED" ? null : e.status } });
  if (msg.phoneId) {
    await db.phoneCheck.create({ data: { phoneId: msg.phoneId, kind: "REACHABILITY", result: e.status === "DELIVERED" ? "REACHED" : "UNREACHED", source: "sms_dlr" } });
    if (e.status === "DELIVERED") await db.guestPhone.update({ where: { id: msg.phoneId }, data: { lastReachedAt: new Date(e.at), lastCheckedAt: new Date() } });
  }
  return { status: "updated" as const };
}
