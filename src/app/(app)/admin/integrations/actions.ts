"use server";

import { revalidatePath } from "next/cache";
import { ForbiddenError, requirePermission } from "@/server/auth/rbac";
import { checkPhone, PhoneCheckError, setPhoneCheckApproval } from "@/server/telephony/phone-validation";
import type { FormState } from "@/app/(app)/finance/actions";

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

export async function checkPhoneAction(_: FormState, fd: FormData) {
  return run("phone.check", (u) => checkPhone(u, f(fd, "phoneId")), "Hat durumu sorgulandı.", `/guests/${f(fd, "guestId")}`);
}
