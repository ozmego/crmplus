"use server";

import { revalidatePath } from "next/cache";
import { ForbiddenError, requirePermission } from "@/server/auth/rbac";
import { checkPhone, PhoneCheckError, setPhoneCheckApproval } from "@/server/telephony/phone-validation";
import type { FormState } from "@/app/(app)/finance/actions";
import { db } from "@/server/db";
import { setUserExtension, UserAdminError } from "@/server/services/users";
import { testThreeCx, threecxConfig, ThreeCxError } from "@/server/telephony/threecx";

const ERR: Record<string, string> = {
  BAD_VALUE: "Tarih ve belge referansı girin.",
  REASON_REQUIRED: "Gerekçe zorunlu (en az 5 karakter).",
  NOT_CONFIGURED: "Telefon doğrulama servisi yapılandırılmamış.",
  NOT_APPROVED: "Dış servise numara aktarımı için güvenlik/hukuk onayı kaydı yok.",
  NOT_FOUND: "Kayıt bulunamadı.",
  PROVIDER_ERROR: "Servis yanıt vermedi; sonuç kaydedilmedi.",
  FORBIDDEN: "Bu işlem için yetkiniz yok.",
};

const f = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

async function run(perm: "integration.manage" | "phone.check", fn: (u: Awaited<ReturnType<typeof requirePermission>>) => Promise<unknown>, ok: string, path: string): Promise<FormState> {
  try {
    const u = await requirePermission(perm, "integrations");
    await fn(u);
    revalidatePath(path);
    return { ok };
  } catch (e) {
    if (e instanceof PhoneCheckError) return { error: ERR[e.code] ?? e.code };
    if (e instanceof ForbiddenError) return { error: ERR.FORBIDDEN };
    throw e;
  }
}

export async function phoneApprovalAction(_: FormState, fd: FormData) {
  return run("integration.manage", (u) => setPhoneCheckApproval(u, { approvedAt: f(fd, "approvedAt"), documentRef: f(fd, "documentRef"), reason: f(fd, "reason") }), "Onay kaydedildi.", "/admin/integrations");
}

const UERR: Record<string, string> = {
  BAD_EXTENSION: "Dahili numara 2–8 rakam olmalı.",
  EXTENSION_TAKEN: "Bu dahili başka bir etkin kullanıcıda.",
  NOT_FOUND: "Kullanıcı bulunamadı.",
};

export async function extensionAction(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const u = await requirePermission("integration.manage", "integrations");
    if (f(fd, "reason").length < 5) return { error: ERR.REASON_REQUIRED };
    await setUserExtension(u, f(fd, "userId"), f(fd, "extension") || null, f(fd, "reason"));
    revalidatePath("/admin/integrations");
    return { ok: "Dahili numara kaydedildi." };
  } catch (e) {
    if (e instanceof UserAdminError) return { error: UERR[e.code] ?? e.code };
    if (e instanceof ForbiddenError) return { error: ERR.FORBIDDEN };
    throw e;
  }
}

export async function testThreeCxAction(): Promise<FormState> {
  try {
    await requirePermission("integration.manage", "integrations");
    if (!threecxConfig().configured) return { error: "3CX yapılandırılmamış: THREECX_URL, THREECX_CLIENT_ID, THREECX_CLIENT_SECRET." };
    const exts = (await db.user.findMany({ where: { status: "ACTIVE", extension: { not: null } }, select: { extension: true } })).map((x) => x.extension!);
    const r = await testThreeCx(exts);
    return r.missing.length
      ? { error: `Bağlantı tamam (${r.ms} ms, ${r.dnCount} dahili görünüyor) ama şu dahililer API istemcisinde izlenmiyor: ${r.missing.join(", ")}` }
      : { ok: `Bağlantı tamam: ${r.ms} ms · ${r.dnCount} dahili görünüyor · tanımlı ${exts.length} temsilci dahilisinin tümü izleniyor.` };
  } catch (e) {
    if (e instanceof ThreeCxError) return { error: `3CX: ${e.message}` };
    if (e instanceof ForbiddenError) return { error: ERR.FORBIDDEN };
    return { error: `3CX'e ulaşılamadı: ${(e as Error).message}` };
  }
}

export async function checkPhoneAction(_: FormState, fd: FormData) {
  return run("phone.check", (u) => checkPhone(u, f(fd, "phoneId")), "Hat durumu sorgulandı.", `/guests/${f(fd, "guestId")}`);
}
