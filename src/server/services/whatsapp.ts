import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { guestScopeWhere, scopeOf, type Principal } from "@/server/auth/rbac";
import { blindIndex, decrypt, encrypt } from "@/server/crypto/field-encryption";
import { waProvider } from "@/server/messaging/whatsapp";
import { iysCheck } from "@/server/messaging/provider";
import { applyContactBlock } from "@/server/services/consent";
import { getSetting, setSetting } from "@/server/services/settings";
import { checkEligibility } from "@/lib/eligibility";
import { isOptOut } from "@/lib/sms";
import { checkWaTemplate, NOT_ON_WHATSAPP, OPT_OUT_PAYLOAD, optOutSuspect, renderWaTemplate, windowState, type WaEvent } from "@/lib/whatsapp";
import { normalizePhone } from "@/lib/phone";

/**
 * WhatsApp Business (Aşama 2, docs/10): onaylı şablon kataloğu, 24 saat penceresi, ortak gelen kutusu,
 * ret işleme, teslim/okundu durumları. Kanal, KVKK yurt dışı aktarım değerlendirmesi kaydı girilmeden açılmaz.
 */
export class WaError extends Error {
  constructor(public code: string, detail?: string) {
    super(detail ?? code);
  }
}

// ───────────── Kanal kapısı (docs/10 §7) ─────────────

export interface TransferAssessment {
  assessedAt: string | null;
  approvedBy: string | null;
  documentRef: string | null;
}
const NO_ASSESSMENT: TransferAssessment = { assessedAt: null, approvedBy: null, documentRef: null };
export const transferAssessment = () => getSetting<TransferAssessment>("whatsapp.transfer", NO_ASSESSMENT);
export async function waEnabled() {
  return !!(await transferAssessment()).assessedAt;
}

export async function setTransferAssessment(user: Principal, a: { assessedAt: string; documentRef: string; reason: string }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a.assessedAt) || a.documentRef.trim().length < 3) throw new WaError("BAD_VALUE");
  if (a.reason.trim().length < 5) throw new WaError("REASON_REQUIRED");
  await setSetting(user.id, "whatsapp.transfer", { assessedAt: a.assessedAt, approvedBy: user.name, documentRef: a.documentRef.trim() }, a.reason);
}

async function assertEnabled() {
  if (!(await waEnabled())) throw new WaError("CHANNEL_DISABLED");
}

// ───────────── Şablon kataloğu ─────────────

export async function createWaTemplate(user: Principal, t: { name: string; language: string; category: "MARKETING" | "UTILITY"; body: string; variables: string[]; optOutButton: boolean }) {
  const chk = checkWaTemplate(t);
  if (chk.errors.length) throw new WaError("TEMPLATE_INVALID", chk.errors.join(" "));
  const prev = await db.waTemplate.findFirst({ where: { name: t.name, language: t.language }, orderBy: { version: "desc" } });
  const tpl = await db.waTemplate.create({ data: { ...t, version: (prev?.version ?? 0) + 1, createdBy: user.id } });
  await audit({ actorId: user.id, action: "whatsapp.template.create", entity: "WaTemplate", entityId: tpl.id, diff: { name: t.name, version: tpl.version, warnings: chk.warnings } });
  return tpl;
}

/** İç onay (hazırlayan ≠ onaylayan) → Meta onayına gönderim. */
export async function approveWaTemplate(user: Principal, id: string) {
  await assertEnabled();
  const t = await db.waTemplate.findUniqueOrThrow({ where: { id } });
  if (t.metaStatus !== "DRAFT") throw new WaError("BAD_STATE");
  if (t.createdBy === user.id) throw new WaError("SAME_PERSON");
  const r = await waProvider().submitTemplate({ name: t.name, language: t.language, category: t.category, body: t.body, optOutButton: t.optOutButton });
  await db.waTemplate.update({ where: { id }, data: { internalApprovedBy: user.id, metaStatus: r.status, statusAt: new Date() } });
  await audit({ actorId: user.id, action: "whatsapp.template.submit", entity: "WaTemplate", entityId: id, diff: { metaStatus: r.status } });
}

/** Meta'dan gelen şablon durumu (message_template_status_update). */
export async function templateStatusUpdate(name: string, language: string, status: string) {
  const map: Record<string, string> = { APPROVED: "APPROVED", REJECTED: "REJECTED", PAUSED: "PAUSED", DISABLED: "PAUSED", PENDING: "PENDING" };
  const t = await db.waTemplate.findFirst({ where: { name, language, metaStatus: { in: ["PENDING", "APPROVED", "PAUSED"] } }, orderBy: { version: "desc" } });
  if (!t || !map[status]) return;
  await db.waTemplate.update({ where: { id: t.id }, data: { metaStatus: map[status], statusAt: new Date() } });
}

// ───────────── Uygunluk ─────────────

/** Şablon gönderimi: WhatsApp kanal izni, durdurma, telefon; TR numarada İYS (bağlı değilse gönderilmez). */
async function eligibleTarget(guestId: string, category: "MARKETING" | "UTILITY") {
  const g = await db.guest.findUnique({
    where: { id: guestId },
    select: { id: true, firstName: true, lastName: true, city: true, ownerId: true, anonymizedAt: true, owner: { select: { name: true, teamId: true } }, phones: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] }, consents: { where: { channel: "WHATSAPP" } }, blocks: { where: { removedAt: null } } },
  });
  if (!g) throw new WaError("NOT_FOUND");
  let reason: string | null = null;
  for (const ph of g.phones) {
    const r = checkEligibility({
      channel: "WHATSAPP", purpose: category === "MARKETING" ? "MARKETING" : "SERVICE", now: new Date(), guest: g, consent: g.consents[0] ?? null, blocks: g.blocks,
      phone: { formatStatus: ph.formatStatus, ownership: ph.ownership, reachability: ph.reachability, lineType: ph.lineType },
    });
    if (!r.ok) {
      reason ??= r.reason;
      continue;
    }
    if (ph.country === "TR" && (await iysCheck(decrypt(ph.e164Enc), "MESAJ")) !== "ONAY") {
      reason ??= "IYS_UNAVAILABLE";
      continue;
    }
    return { guest: g, phone: ph, e164: decrypt(ph.e164Enc) };
  }
  throw new WaError("NOT_ELIGIBLE", reason ?? "NO_PHONE");
}

export async function openConversation(a: { phoneHash: string; e164: string; guestId: string | null; teamId: string | null; assigneeId?: string | null }) {
  const c = await db.conversation.findFirst({ where: { phoneHash: a.phoneHash, status: "OPEN" } });
  if (c) return c;
  return db.conversation.create({ data: { phoneHash: a.phoneHash, phoneEnc: encrypt(a.e164), guestId: a.guestId, teamId: a.teamId, assigneeId: a.assigneeId ?? null } });
}

// ───────────── Gönderim ─────────────

/** Onaylı şablonla misafire mesaj (pencere dışında tek yol). Konuşma açılır, gönderen atanır. */
export async function sendWaTemplate(user: Principal, guestId: string, templateId: string) {
  await assertEnabled();
  const t = await db.waTemplate.findUniqueOrThrow({ where: { id: templateId } });
  if (t.metaStatus !== "APPROVED") throw new WaError("TEMPLATE_NOT_APPROVED");
  const inScope = await db.guest.count({ where: { AND: [{ id: guestId }, guestScopeWhere(user, "guest.view")] } });
  if (!inScope) throw new WaError("NOT_FOUND");
  const { guest, phone, e164 } = await eligibleTarget(guestId, t.category as "MARKETING");
  const values = { ad: guest.firstName, soyad: guest.lastName, sehir: guest.city ?? "", temsilci_adi: user.name };
  const params = t.variables.map((v) => (values as Record<string, string>)[v] ?? "");
  const text = renderWaTemplate(t.body, t.variables, values);
  const res = await waProvider().sendTemplate({ to: e164, name: t.name, language: t.language, params });
  const conv = await openConversation({ phoneHash: phone.phoneHash, e164, guestId, teamId: guest.owner?.teamId ?? null, assigneeId: user.id });
  const now = new Date();
  await db.$transaction([
    db.message.create({ data: { conversationId: conv.id, guestId, phoneId: phone.id, phoneHash: phone.phoneHash, channel: "WHATSAPP", direction: "OUT", waTemplateId: t.id, bodyEnc: encrypt(text), provider: waProvider().name, providerMessageId: res.id, status: "SENT", sentById: user.id, sentAt: now } }),
    db.conversation.update({ where: { id: conv.id }, data: { lastOutboundAt: now, assigneeId: conv.assigneeId ?? user.id } }),
    db.interaction.create({ data: { guestId, channel: "WHATSAPP", direction: "OUT", refId: conv.id, summary: `WhatsApp şablon: ${t.name}`, actorId: user.id } }),
  ]);
  await audit({ actorId: user.id, action: "whatsapp.send.template", entity: "Conversation", entityId: conv.id, diff: { template: t.name, version: t.version } });
  return conv;
}

export function convScopeWhere(user: Principal): Prisma.ConversationWhereInput {
  const s = scopeOf(user, "inbox.view");
  if (s === "all") return {};
  if (s === "team") return { OR: [{ assigneeId: user.id }, { teamId: { in: [...new Set([...user.ledTeamIds, ...(user.teamId ? [user.teamId] : [])])] } }] };
  if (s === "own") return { OR: [{ assigneeId: user.id }, { assigneeId: null, teamId: user.teamId ?? "__none__" }] };
  return { id: "__none__" };
}

async function loadConv(user: Principal, id: string) {
  const c = await db.conversation.findFirst({ where: { AND: [{ id }, convScopeWhere(user)] } });
  if (!c) throw new WaError("NOT_FOUND");
  return c;
}

/** Serbest yanıt: yalnız misafirin son mesajından sonraki 24 saat içinde; durdurma kaydı varsa yanıt verilmez. */
export async function replyText(user: Principal, convId: string, text: string) {
  await assertEnabled();
  const c = await loadConv(user, convId);
  if (c.status !== "OPEN") throw new WaError("CLOSED");
  if (!windowState(c.lastInboundAt).open) throw new WaError("WINDOW_CLOSED");
  const body = text.trim();
  if (!body || body.length > 1000) throw new WaError("BAD_TEXT");
  if (c.guestId && (await db.contactBlock.count({ where: { guestId: c.guestId, removedAt: null, OR: [{ allChannels: true }, { channel: "WHATSAPP" }] } }))) throw new WaError("BLOCKED");
  const res = await waProvider().sendText({ to: decrypt(c.phoneEnc), text: body });
  const now = new Date();
  await db.$transaction([
    db.message.create({ data: { conversationId: c.id, guestId: c.guestId, phoneHash: c.phoneHash, channel: "WHATSAPP", direction: "OUT", bodyEnc: encrypt(body), provider: waProvider().name, providerMessageId: res.id, status: "SENT", sentById: user.id, sentAt: now } }),
    db.conversation.update({ where: { id: c.id }, data: { lastOutboundAt: now, unread: 0, assigneeId: c.assigneeId ?? user.id } }),
  ]);
  await audit({ actorId: user.id, action: "whatsapp.reply", entity: "Conversation", entityId: c.id });
}

export async function assignConversation(user: Principal, convId: string, assigneeId: string | null) {
  const c = await loadConv(user, convId);
  if (assigneeId) {
    const u = await db.user.findFirst({ where: { id: assigneeId, status: "ACTIVE" } });
    if (!u) throw new WaError("BAD_ASSIGNEE");
    if (scopeOf(user, "inbox.view") === "own" && assigneeId !== user.id) throw new WaError("FORBIDDEN");
  }
  await db.conversation.update({ where: { id: c.id }, data: { assigneeId } });
  await audit({ actorId: user.id, action: "whatsapp.assign", entity: "Conversation", entityId: c.id, diff: { assigneeId } });
}

export async function closeConversation(user: Principal, convId: string) {
  const c = await loadConv(user, convId);
  await db.conversation.update({ where: { id: c.id }, data: { status: "CLOSED", closedAt: new Date(), unread: 0 } });
  await audit({ actorId: user.id, action: "whatsapp.close", entity: "Conversation", entityId: c.id });
}

/** Ret şüphesinde temsilcinin tek tıkla durdurma kaydı (docs/10 §6). */
export async function confirmOptOut(user: Principal, convId: string) {
  const c = await loadConv(user, convId);
  if (!c.guestId) throw new WaError("NO_GUEST");
  await db.$transaction((tx) => applyContactBlock(tx, { guestId: c.guestId!, allChannels: false, channel: "WHATSAPP", requestedAt: c.lastInboundAt ?? new Date(), actorId: user.id, reason: "GUEST_REQUEST", proof: `whatsapp:${c.id}`, source: "WhatsApp gelen kutusu (temsilci teyidi)" }));
  await db.conversation.update({ where: { id: c.id }, data: { optOutSuspect: false } });
  await audit({ actorId: user.id, action: "whatsapp.opt_out.confirm", entity: "Conversation", entityId: c.id });
}

export async function dismissSuspect(user: Principal, convId: string) {
  const c = await loadConv(user, convId);
  await db.conversation.update({ where: { id: c.id }, data: { optOutSuspect: false } });
}

export async function inboxList(user: Principal, status = "OPEN") {
  const convs = await db.conversation.findMany({
    where: { AND: [convScopeWhere(user), { status }] },
    orderBy: [{ optOutSuspect: "desc" }, { unread: "desc" }, { lastInboundAt: "desc" }],
    take: 200,
  });
  const [guests, users] = await Promise.all([
    db.guest.findMany({ where: { id: { in: convs.map((c) => c.guestId).filter((x): x is string => !!x) } }, select: { id: true, firstName: true, lastName: true, crmNo: true } }),
    db.user.findMany({ where: { id: { in: convs.map((c) => c.assigneeId).filter((x): x is string => !!x) } }, select: { id: true, name: true } }),
  ]);
  const gm = new Map(guests.map((g) => [g.id, g]));
  const um = new Map(users.map((u) => [u.id, u.name]));
  return convs.map((c) => ({ ...c, guest: c.guestId ? gm.get(c.guestId) ?? null : null, assigneeName: c.assigneeId ? um.get(c.assigneeId) ?? null : null, window: windowState(c.lastInboundAt) }));
}

export async function conversationDetail(user: Principal, id: string) {
  const c = await loadConv(user, id);
  const [messages, guest, blocked] = await Promise.all([
    db.message.findMany({ where: { conversationId: id }, orderBy: { createdAt: "asc" }, take: 500 }),
    c.guestId ? db.guest.findUnique({ where: { id: c.guestId }, select: { id: true, firstName: true, lastName: true, crmNo: true, language: true } }) : null,
    c.guestId ? db.contactBlock.count({ where: { guestId: c.guestId, removedAt: null, OR: [{ allChannels: true }, { channel: "WHATSAPP" }] } }) : 0,
  ]);
  if (c.unread) await db.conversation.update({ where: { id }, data: { unread: 0 } });
  return {
    conversation: c,
    guest,
    blocked: blocked > 0,
    window: windowState(c.lastInboundAt),
    messages: messages.map((m) => ({ id: m.id, direction: m.direction, status: m.status, at: m.sentAt ?? m.createdAt, text: decrypt(m.bodyEnc), readAt: m.readAt, template: !!m.waTemplateId })),
  };
}

// ───────────── Gelen olaylar ─────────────

export async function handleWaEvents(provider: string, events: WaEvent[]) {
  const out = { received: 0, duplicates: 0, optOuts: 0, statuses: 0 };
  for (const e of events) {
    if (e.kind === "message") {
      if (await db.message.findFirst({ where: { provider, providerMessageId: e.id }, select: { id: true } })) {
        out.duplicates++;
        continue;
      }
      const n = normalizePhone(e.from, "TR");
      if (!n.ok || !n.e164) continue;
      const hash = blindIndex(n.e164);
      const phones = await db.guestPhone.findMany({ where: { phoneHash: hash }, select: { guestId: true, guest: { select: { owner: { select: { teamId: true } }, ownerId: true } } } });
      const guestIds = [...new Set(phones.map((p) => p.guestId))];
      // Telefon tek başına kimlik değildir: birden fazla misafir eşleşirse konuşma misafire bağlanmaz
      const guestId = guestIds.length === 1 ? guestIds[0] : null;
      const conv = await openConversation({ phoneHash: hash, e164: n.e164, guestId, teamId: phones[0]?.guest.owner?.teamId ?? null, assigneeId: guestId ? phones[0]?.guest.ownerId ?? null : null });
      const optOut = e.buttonPayload === OPT_OUT_PAYLOAD || isOptOut(e.text);
      const suspect = !optOut && optOutSuspect(e.text);
      await db.$transaction([
        db.message.create({ data: { conversationId: conv.id, guestId, phoneHash: hash, channel: "WHATSAPP", direction: "IN", bodyEnc: encrypt(e.text), provider, providerMessageId: e.id, status: "RECEIVED", createdAt: e.at } }),
        db.conversation.update({ where: { id: conv.id }, data: { lastInboundAt: e.at, unread: { increment: 1 }, ...(suspect ? { optOutSuspect: true } : {}) } }),
        ...(guestId ? [db.interaction.create({ data: { guestId, channel: "WHATSAPP", direction: "IN", refId: conv.id, summary: "WhatsApp mesajı", at: e.at } })] : []),
      ]);
      out.received++;
      if (optOut) {
        for (const gid of guestIds) {
          const already = await db.contactBlock.count({ where: { guestId: gid, removedAt: null, OR: [{ allChannels: true }, { channel: "WHATSAPP" }] } });
          if (!already) await db.$transaction((tx) => applyContactBlock(tx, { guestId: gid, allChannels: false, channel: "WHATSAPP", requestedAt: e.at, actorId: null, reason: "GUEST_REQUEST", proof: `whatsapp:${e.id}`, source: "WhatsApp ile ret" }));
        }
        await db.optOutEvent.create({ data: { channel: "WHATSAPP", phoneHash: hash, keyword: e.text.trim().slice(0, 40), guestIds, receivedAt: e.at } });
        // Pencere açık olduğundan tek seferlik onay metni gönderilebilir (docs/10 §6)
        try {
          const confirm = "Talebiniz alınmıştır, size bu kanaldan ileti gönderilmeyecektir.";
          const r = await waProvider().sendText({ to: n.e164, text: confirm });
          await db.message.create({ data: { conversationId: conv.id, guestId, phoneHash: hash, channel: "WHATSAPP", direction: "OUT", bodyEnc: encrypt(confirm), provider, providerMessageId: r.id, status: "SENT", sentAt: new Date() } });
        } catch {
          /* onay mesajı gönderilemese de durdurma geçerlidir */
        }
        await audit({ actorId: null, action: "message.opt_out", diff: { channel: "WHATSAPP", guests: guestIds.length } });
        out.optOuts++;
      }
    } else {
      const m = await db.message.findFirst({ where: { provider, providerMessageId: e.id } });
      if (!m) continue;
      out.statuses++;
      const order = { SENT: 1, DELIVERED: 2, READ: 3 } as Record<string, number>;
      const next = e.status === "failed" ? "FAILED" : e.status.toUpperCase();
      if (next !== "FAILED" && (order[m.status] ?? 0) >= (order[next] ?? 0)) continue; // geç gelen eski durum geri almaz
      await db.message.update({
        where: { id: m.id },
        data: {
          status: next,
          ...(next === "DELIVERED" || next === "READ" ? { deliveredAt: m.deliveredAt ?? e.at } : {}),
          ...(next === "READ" ? { readAt: e.at } : {}),
          ...(next === "FAILED" ? { error: e.errorCode && NOT_ON_WHATSAPP.has(e.errorCode) ? "WhatsApp'ta kayıtlı değil" : `Hata ${e.errorCode ?? ""}`.trim() } : {}),
        },
      });
      // WhatsApp'ta olmama yalnız bu kanal için uygunsuzluktur; telefonun genel durumunu etkilemez (docs/10 §8)
      if ((next === "DELIVERED" || next === "READ") && m.phoneId) {
        await db.guestPhone.update({ where: { id: m.phoneId }, data: { lastReachedAt: e.at, lastCheckedAt: new Date() } });
      }
    }
  }
  return out;
}

export async function waTemplatesForSend() {
  return db.waTemplate.findMany({ where: { metaStatus: "APPROVED" }, orderBy: [{ name: "asc" }, { version: "desc" }], distinct: ["name", "language"] });
}
