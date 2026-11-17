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
import { renderWaTemplate } from "@/lib/whatsapp";
import { waProvider } from "@/server/messaging/whatsapp";
import { openConversation, waEnabled } from "@/server/services/whatsapp";

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
  phoneHash: string;
  e164: string;
  ownerId: string | null;
  teamId: string | null;
  values: { ad: string; soyad: string; sehir: string; temsilci_adi: string };
}

export type MsgChannel = "SMS" | "WHATSAPP";

/**
 * Kampanya alıcıları: kanal izni, durdurma, hat türü, İYS, kanal bazında sıklık sınırı (docs/10 §3).
 * Her gönderimde yeniden çağrılır.
 */
export async function evaluateRecipients(category: Category, where: Prisma.GuestWhereInput, limit = 50_000, channel: MsgChannel = "SMS") {
  const now = new Date();
  const guests = await db.guest.findMany({
    where,
    take: limit,
    select: {
      id: true, firstName: true, lastName: true, city: true, anonymizedAt: true, ownerId: true,
      owner: { select: { name: true, teamId: true } },
      phones: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] },
      consents: { where: { channel } },
      blocks: { where: { removedAt: null } },
    },
  });
  const recentMarketing = new Set(
    category === "MARKETING"
      ? (await db.message.findMany({
          where: { channel, direction: "OUT", isTest: false, createdAt: { gte: new Date(now.getTime() - 86_400_000) }, campaignId: { not: null }, status: { in: ["SENT", "DELIVERED", "READ"] } },
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
        channel, purpose: category === "MARKETING" ? "MARKETING" : "SERVICE", now, guest: g, consent: g.consents[0] ?? null, blocks: g.blocks,
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
      const iys = await iysCheck(decrypt(chosen.e164Enc), "MESAJ");
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
      phoneHash: chosen.phoneHash,
      e164: decrypt(chosen.e164Enc),
      ownerId: g.ownerId,
      teamId: g.owner?.teamId ?? null,
      values: { ad: g.firstName, soyad: g.lastName, sehir: g.city ?? "", temsilci_adi: g.owner?.name ?? "" },
    });
  }
  return { total: guests.length, eligible, excluded };
}

// ───────────── Kampanya (SMS ve WhatsApp) ─────────────

/**
 * Kanal içeriği: şablonu yükler, metni üretir ve gönderir. SMS: onaylı SMS şablonu + ret metni + parça hesabı.
 * WhatsApp: Meta'da onaylı şablon (pencere dışı tek yol); yanıtlar ortak gelen kutusuna düşsün diye konuşma açılır.
 */
async function channelContent(channel: MsgChannel, templateId: string, category: Category) {
  if (channel === "WHATSAPP") {
    if (!(await waEnabled())) throw new MessagingError("CHANNEL_DISABLED");
    const t = await db.waTemplate.findUnique({ where: { id: templateId } });
    if (!t) throw new MessagingError("TEMPLATE_NOT_APPROVED");
    const tplCategory: Category = t.category === "MARKETING" ? "MARKETING" : "INFORMATIONAL";
    return {
      approved: t.metaStatus === "APPROVED",
      category: tplCategory,
      body: t.body,
      render: (v: Recipient["values"]) => renderWaTemplate(t.body, t.variables, v),
      segments: () => 1,
      unitCost: Number(process.env.WA_UNIT_COST ?? 0.6),
      templateRef: { waTemplateId: t.id },
      send: async (to: string, v: Recipient["values"]) => {
        const p = waProvider();
        const r = await p.sendTemplate({ to, name: t.name, language: t.language, params: t.variables.map((x) => (v as Record<string, string>)[x] ?? "") });
        return { provider: p.name, id: r.id };
      },
    };
  }
  const t = await db.messageTemplate.findUnique({ where: { id: templateId } });
  if (!t) throw new MessagingError("TEMPLATE_NOT_APPROVED");
  const render = (v: Recipient["values"]) => withOptOut(renderTemplate(t.body, v), category, optOutText());
  return {
    approved: t.status === "APPROVED",
    category: t.category as Category,
    body: t.body,
    render,
    segments: (text: string) => smsSegments(text).segments,
    unitCost: Number(process.env.SMS_UNIT_COST ?? 0.2),
    templateRef: { templateId: t.id },
    send: async (to: string, v: Recipient["values"], ref: string) => {
      const r = await smsProvider().send({ to, text: render(v), reference: ref });
      return { provider: r.provider, id: r.providerMessageId };
    },
  };
}
type Content = Awaited<ReturnType<typeof channelContent>>;
const channelOf = (c: { channel: string }) => (c.channel === "WHATSAPP" ? "WHATSAPP" : "SMS") as MsgChannel;

async function estimateFor(channel: MsgChannel, category: Category, segment: Segment, content: Content) {
  const { total, eligible, excluded } = await evaluateRecipients(category, segmentWhere(segment), 50_000, channel);
  const sample = eligible.slice(0, 5).map((r) => content.render(r.values));
  const seg = sample.length ? Math.max(...sample.map((s) => content.segments(s))) : content.segments(content.body);
  return {
    total, eligible: eligible.length, excluded, segmentsPerMessage: seg,
    estimatedCost: Number((eligible.length * seg * content.unitCost).toFixed(2)), unitCost: content.unitCost,
    preview: sample.map((s) => s.replace(/\d{6,}/g, "•••")),
    computedAt: new Date().toISOString(),
  };
}

export async function createCampaign(user: Principal, input: { name: string; category: Category; templateId: string; segment: Segment; channel?: MsgChannel }) {
  const channel = input.channel ?? "SMS";
  const content = await channelContent(channel, input.templateId, input.category);
  if (!content.approved) throw new MessagingError("TEMPLATE_NOT_APPROVED");
  if (content.category !== input.category) throw new MessagingError("CATEGORY_MISMATCH");
  const segment = segmentSchema.parse(input.segment);
  const estimate = await estimateFor(channel, input.category, segment, content);
  const c = await db.messageCampaign.create({
    data: { name: input.name.trim(), channel, category: input.category, templateId: input.templateId, segment, estimate: estimate as unknown as Prisma.InputJsonValue, preparedBy: user.id },
  });
  await audit({ actorId: user.id, action: "message.campaign.create", entity: "MessageCampaign", entityId: c.id, diff: { channel, segment, eligible: estimate.eligible } });
  return c;
}

export async function campaignTemplateBody(c: { channel: string; templateId: string; category: string }) {
  return (await channelContent(channelOf(c), c.templateId, c.category as Category)).body;
}

export async function refreshEstimate(id: string) {
  const c = await db.messageCampaign.findUniqueOrThrow({ where: { id } });
  const content = await channelContent(channelOf(c), c.templateId, c.category as Category);
  const estimate = await estimateFor(channelOf(c), c.category as Category, c.segment as Segment, content);
  await db.messageCampaign.update({ where: { id }, data: { estimate: estimate as unknown as Prisma.InputJsonValue } });
  return estimate;
}

/** Test gönderimi: hazırlayanın girdiği numaraya, örnek değerlerle (docs/10 §5 adım 3). */
export async function testSend(user: Principal, id: string, rawPhone: string) {
  const c = await db.messageCampaign.findUniqueOrThrow({ where: { id } });
  if (c.status === "DONE" || c.status === "CANCELLED") throw new MessagingError("BAD_STATE");
  const n = normalizePhone(rawPhone, "TR");
  if (!n.ok || !n.e164) throw new MessagingError("BAD_PHONE");
  const content = await channelContent(channelOf(c), c.templateId, c.category as Category);
  const values = { ad: "Örnek", soyad: "Misafir", sehir: "İstanbul", temsilci_adi: user.name };
  const text = content.render(values);
  const sent = await content.send(n.e164, values, `test-${c.id}`);
  await db.message.create({
    data: { campaignId: c.id, channel: channelOf(c), direction: "OUT", ...content.templateRef, bodyEnc: encrypt(text), segments: content.segments(text), provider: sent.provider, providerMessageId: sent.id, status: "SENT", sentById: user.id, isTest: true, sentAt: new Date(), phoneHash: blindIndex(n.e164) },
  });
  await audit({ actorId: user.id, action: "message.campaign.test", entity: "MessageCampaign", entityId: c.id, diff: { to: n.masked, channel: channelOf(c) } });
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

/** İşçi: uygunluk her mesajda yeniden kontrol edilir; hız sınırı (SMS_TPS / WA_TPS); iptal edilirse durur. */
export async function sendCampaignJob(id: string) {
  const c = await db.messageCampaign.findUniqueOrThrow({ where: { id } });
  if (c.status !== "SENDING") return;
  const channel = channelOf(c);
  const content = await channelContent(channel, c.templateId, c.category as Category);
  if (!content.approved) {
    await db.messageCampaign.update({ where: { id }, data: { status: "CANCELLED", cancelReason: "Şablon artık onaylı değil (Meta durumu değişti)", finishedAt: new Date() } });
    return { sent: 0, failed: 0 };
  }
  const { eligible, excluded } = await evaluateRecipients(c.category as Category, segmentWhere(c.segment as Segment), 50_000, channel);
  const tps = Math.max(1, Number((channel === "WHATSAPP" ? process.env.WA_TPS : process.env.SMS_TPS) ?? 10));
  let sent = 0;
  let failed = 0;
  for (let i = 0; i < eligible.length; i++) {
    if (i % 50 === 0) {
      const cur = await db.messageCampaign.findUnique({ where: { id }, select: { status: true } });
      if (cur?.status !== "SENDING") break;
    }
    const r = eligible[i];
    const text = content.render(r.values);
    try {
      const res = await content.send(r.e164, r.values, `${c.id}:${r.guestId}`);
      const conv = channel === "WHATSAPP" ? await openConversation({ phoneHash: r.phoneHash, e164: r.e164, guestId: r.guestId, teamId: r.teamId, assigneeId: r.ownerId }) : null;
      await db.$transaction([
        db.message.create({
          data: { campaignId: c.id, conversationId: conv?.id, guestId: r.guestId, phoneId: r.phoneId, phoneHash: r.phoneHash, channel, direction: "OUT", ...content.templateRef, bodyEnc: encrypt(text), segments: content.segments(text), provider: res.provider, providerMessageId: res.id, status: "SENT", sentAt: new Date() },
        }),
        db.interaction.create({ data: { guestId: r.guestId, channel, direction: "OUT", refId: c.id, summary: `Kampanya: ${c.name}` } }),
        ...(conv ? [db.conversation.update({ where: { id: conv.id }, data: { lastOutboundAt: new Date() } })] : []),
      ]);
      sent++;
    } catch (e) {
      await db.message.create({
        data: { campaignId: c.id, guestId: r.guestId, phoneId: r.phoneId, channel, direction: "OUT", ...content.templateRef, bodyEnc: encrypt(text), provider: channel === "WHATSAPP" ? "whatsapp" : "sms", status: "FAILED", error: (e as Error).message.slice(0, 200) },
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
  await audit({ actorId: null, action: "message.campaign.finished", entity: "MessageCampaign", entityId: id, diff: { sent, failed, channel } });
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
