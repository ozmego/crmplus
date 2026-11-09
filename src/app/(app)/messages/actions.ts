"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { ForbiddenError, requirePermission } from "@/server/auth/rbac";
import type { Permission } from "@/server/auth/permissions";
import {
  approveCampaign,
  approveTemplate,
  cancelCampaign,
  createCampaign,
  createTemplate,
  EXCLUSION_LABEL_TR,
  MessagingError,
  refreshEstimate,
  segmentSchema,
  sendSingle,
  startCampaign,
  submitCampaign,
  testSend,
} from "@/server/services/messaging";
import type { FormState } from "@/app/(app)/finance/actions";

const ERR: Record<string, string> = {
  TEMPLATE_INVALID: "Şablon geçersiz.",
  TEMPLATE_NOT_APPROVED: "Şablon onaylanmamış.",
  CATEGORY_MISMATCH: "Kampanya kategorisi şablonla aynı olmalı.",
  BAD_STATE: "Kayıt bu işlem için uygun durumda değil.",
  SAME_PERSON: "Hazırlayan kişi onaylayamaz (iki kişili onay).",
  NOT_PREPARER: "Yalnız hazırlayan onaya gönderebilir.",
  TEST_REQUIRED: "Onaya göndermeden önce test gönderimi yapın.",
  LEGAL_REQUIRED: "Ülke, içerik ve yerel hukuk uygunluğunu onaylayın.",
  REASON_REQUIRED: "Gerekçe zorunlu (en az 5 karakter).",
  BAD_PHONE: "Telefon numarası geçersiz.",
  NOT_ELIGIBLE: "Misafire SMS gönderilemez",
  FORBIDDEN: "Bu işlem için yetkiniz yok.",
};


async function run(perm: Permission, fn: (u: Awaited<ReturnType<typeof requirePermission>>) => Promise<unknown>, okMsg: string): Promise<FormState> {
  try {
    const user = await requirePermission(perm, "messages");
    await fn(user);
    revalidatePath("/messages", "layout");
    return { ok: okMsg };
  } catch (e) {
    if (e instanceof MessagingError) {
      const base = ERR[e.code] ?? e.message;
      if (e.code === "NOT_ELIGIBLE") return { error: `${base}: ${(EXCLUSION_LABEL_TR as Record<string, string>)[e.message] ?? e.message}.` };
      if (e.code === "TEMPLATE_INVALID") return { error: `${base} ${e.message}` };
      return { error: base };
    }
    if (e instanceof ForbiddenError) return { error: ERR.FORBIDDEN };
    if (e instanceof z.ZodError) return { error: e.issues.map((i) => i.message).join(" · ") };
    throw e;
  }
}

const f = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const list = (s: string) => s.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean);
const category = z.enum(["MARKETING", "INFORMATIONAL"], { message: "Kategori seçin" });

export async function createTemplateAction(_: FormState, fd: FormData) {
  return run("message.template.manage", (u) =>
    createTemplate(u, z.object({ name: z.string().min(2, "Ad en az 2 karakter"), category, body: z.string().min(5, "Metin en az 5 karakter").max(900) }).parse({
      name: f(fd, "name"), category: f(fd, "category"), body: f(fd, "body"),
    })), "Şablon taslağı kaydedildi; başka bir yetkili onaylamalı.");
}

export async function approveTemplateAction(_: FormState, fd: FormData) {
  return run("message.campaign.approve", (u) => approveTemplate(u, f(fd, "id")), "Şablon onaylandı.");
}

export async function createCampaignAction(_: FormState, fd: FormData) {
  let id = "";
  const r = await run("message.campaign.prepare", async (u) => {
    const days = f(fd, "lastContactBeforeDays");
    const segment = segmentSchema.parse({
      languages: list(f(fd, "languages").toLowerCase()).length ? list(f(fd, "languages").toLowerCase()) : undefined,
      countries: list(f(fd, "countries").toUpperCase()).length ? list(f(fd, "countries").toUpperCase()) : undefined,
      tags: list(f(fd, "tags")).length ? list(f(fd, "tags")) : undefined,
      lastContactBeforeDays: days ? Number(days) : undefined,
    });
    const c = await createCampaign(u, {
      ...z.object({ name: z.string().min(3, "Kampanya adı en az 3 karakter"), category, templateId: z.string().min(1, "Şablon seçin") }).parse({
        name: f(fd, "name"), category: f(fd, "category"), templateId: f(fd, "templateId"),
      }),
      segment,
    });
    id = c.id;
  }, "Kampanya taslağı oluşturuldu.");
  if (id) redirect(`/messages/campaigns/${id}`);
  return r;
}

export async function campaignAction(_: FormState, fd: FormData) {
  const id = f(fd, "id");
  const action = z.enum(["REFRESH", "TEST", "SUBMIT", "APPROVE", "START", "CANCEL"]).parse(f(fd, "action"));
  switch (action) {
    case "REFRESH":
      return run("message.campaign.prepare", () => refreshEstimate(id), "Önizleme güncellendi.");
    case "TEST":
      return run("message.campaign.prepare", (u) => testSend(u, id, f(fd, "phone")), "Test mesajı gönderildi.");
    case "SUBMIT":
      return run("message.campaign.prepare", (u) => submitCampaign(u, id), "Kampanya onaya gönderildi.");
    case "APPROVE":
      return run("message.campaign.approve", (u) => approveCampaign(u, id, fd.get("legal") === "on", f(fd, "reason")), "Kampanya onaylandı.");
    case "START":
      return run("message.campaign.approve", (u) => startCampaign(u, id), "Gönderim başlatıldı.");
    case "CANCEL":
      return run("message.campaign.prepare", (u) => cancelCampaign(u, id, f(fd, "reason")), "Kampanya iptal edildi.");
  }
}

export async function sendSingleAction(_: FormState, fd: FormData) {
  const guestId = f(fd, "guestId");
  const r = await run("message.send.single", (u) => sendSingle(u, guestId, f(fd, "templateId")), "SMS gönderildi.");
  revalidatePath(`/guests/${guestId}`);
  return r;
}
