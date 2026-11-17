"use server";

import { revalidatePath } from "next/cache";
import { ForbiddenError, requirePermission } from "@/server/auth/rbac";
import type { Permission } from "@/server/auth/permissions";
import {
  approveWaTemplate,
  assignConversation,
  closeConversation,
  confirmOptOut,
  createWaTemplate,
  dismissSuspect,
  replyText,
  sendWaTemplate,
  setTransferAssessment,
  WaError,
} from "@/server/services/whatsapp";
import { EXCLUSION_LABEL_TR } from "@/server/services/messaging";
import type { FormState } from "@/app/(app)/finance/actions";

const ERR: Record<string, string> = {
  FORBIDDEN: "Bu işlem için yetkiniz yok.",
  NOT_FOUND: "Kayıt bulunamadı.",
  CHANNEL_DISABLED: "WhatsApp kanalı kapalı: yurt dışı aktarım değerlendirmesi kaydı girilmemiş.",
  TEMPLATE_INVALID: "Şablon geçersiz.",
  TEMPLATE_NOT_APPROVED: "Şablon Meta tarafından onaylanmamış.",
  SAME_PERSON: "Şablonu hazırlayan onaylayamaz (iki kişili onay).",
  BAD_STATE: "Kayıt bu işlem için uygun durumda değil.",
  WINDOW_CLOSED: "24 saat penceresi kapalı: yalnız onaylı şablon gönderilebilir.",
  CLOSED: "Konuşma kapalı.",
  BAD_TEXT: "Mesaj 1–1000 karakter olmalı.",
  BLOCKED: "Misafir bu kanaldan iletişimi durdurdu; mesaj gönderilemez.",
  BAD_ASSIGNEE: "Atanacak kullanıcı geçersiz.",
  NO_GUEST: "Konuşma bir misafire bağlı değil.",
  BAD_VALUE: "Tarih ve belge referansı girin.",
  REASON_REQUIRED: "Gerekçe zorunlu (en az 5 karakter).",
  NOT_ELIGIBLE: "Misafire WhatsApp gönderilemez",
};

async function run(perm: Permission, fn: (u: Awaited<ReturnType<typeof requirePermission>>) => Promise<unknown>, okMsg: string, path = "/inbox"): Promise<FormState> {
  try {
    const user = await requirePermission(perm, "whatsapp");
    await fn(user);
    revalidatePath(path, "layout");
    return { ok: okMsg };
  } catch (e) {
    if (e instanceof WaError) {
      if (e.code === "NOT_ELIGIBLE") return { error: `${ERR.NOT_ELIGIBLE}: ${(EXCLUSION_LABEL_TR as Record<string, string>)[e.message] ?? e.message}.` };
      if (e.code === "TEMPLATE_INVALID") return { error: `${ERR.TEMPLATE_INVALID} ${e.message}` };
      return { error: ERR[e.code] ?? e.code };
    }
    if (e instanceof ForbiddenError) return { error: ERR.FORBIDDEN };
    throw e;
  }
}
const f = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

export async function replyAction(_: FormState, fd: FormData) {
  return run("message.reply", (u) => replyText(u, f(fd, "id"), f(fd, "text")), "Gönderildi.");
}
export async function sendTemplateInConvAction(_: FormState, fd: FormData) {
  return run("message.send.single", (u) => sendWaTemplate(u, f(fd, "guestId"), f(fd, "templateId")), "Şablon gönderildi.");
}
export async function convAction(_: FormState, fd: FormData) {
  const id = f(fd, "id");
  const a = f(fd, "action");
  if (a === "TAKE") return run("inbox.view", (u) => assignConversation(u, id, u.id), "Konuşma size atandı.");
  if (a === "RELEASE") return run("inbox.view", (u) => assignConversation(u, id, null), "Atama kaldırıldı.");
  if (a === "CLOSE") return run("inbox.view", (u) => closeConversation(u, id), "Konuşma kapatıldı.");
  if (a === "OPT_OUT") return run("inbox.view", (u) => confirmOptOut(u, id), "Durdurma kaydı açıldı.");
  return run("inbox.view", (u) => dismissSuspect(u, id), "Ret şüphesi kaldırıldı.");
}
export async function guestWaAction(_: FormState, fd: FormData) {
  const r = await run("message.send.single", (u) => sendWaTemplate(u, f(fd, "guestId"), f(fd, "templateId")), "WhatsApp şablonu gönderildi.");
  revalidatePath(`/guests/${f(fd, "guestId")}`);
  return r;
}
export async function createWaTemplateAction(_: FormState, fd: FormData) {
  return run("message.template.manage", (u) =>
    createWaTemplate(u, {
      name: f(fd, "name"), language: f(fd, "language") || "tr", category: (f(fd, "category") || "UTILITY") as "UTILITY", body: f(fd, "body"),
      variables: f(fd, "variables").split(/[,\s]+/).filter(Boolean), optOutButton: f(fd, "optOutButton") === "1",
    }), "Şablon taslağı kaydedildi; başka bir yetkili onaylayıp Meta'ya göndermeli.", "/messages/whatsapp");
}
export async function approveWaTemplateAction(_: FormState, fd: FormData) {
  return run("message.campaign.approve", (u) => approveWaTemplate(u, f(fd, "id")), "Şablon onaylandı ve Meta'ya gönderildi.", "/messages/whatsapp");
}
export async function transferAction(_: FormState, fd: FormData) {
  return run("integration.manage", (u) => setTransferAssessment(u, { assessedAt: f(fd, "assessedAt"), documentRef: f(fd, "documentRef"), reason: f(fd, "reason") }), "Değerlendirme kaydedildi; WhatsApp kanalı açıldı.", "/messages/whatsapp");
}
