import "server-only";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { guestScopeWhere, type Principal } from "@/server/auth/rbac";
import { decrypt } from "@/server/crypto/field-encryption";
import { getSetting, setSetting } from "@/server/services/settings";

/**
 * Telefon doğrulama servisi (HLR/numara sorgu) adaptörü — plan v4 §2.
 *   PHONE_CHECK_PROVIDER = none (vars.) | http | mock (yalnız geliştirme)
 *   PHONE_CHECK_URL, PHONE_CHECK_TOKEN
 * Kurallar: numara üçüncü tarafa yalnız güvenlik + hukuk incelemesi kaydı girildikten sonra gönderilir;
 * sonuç “aktif” kesinliği iddia etmez — kaynak, tarih ve güven düzeyiyle kanıt olarak saklanır.
 * Ulaşılabilirlik durumu (çağrı sonuçlarından türetilen) bu sorguyla değiştirilmez.
 */
export class PhoneCheckError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

export interface LineStatus {
  lineType: "MOBILE" | "FIXED_LINE" | "VOIP" | "UNKNOWN";
  status: "ACTIVE" | "INACTIVE" | "UNKNOWN";
  carrier: string | null;
  ported: boolean | null;
  confidence: "HIGH" | "MEDIUM" | "LOW";
}

export const phoneCheckMode = () => (process.env.PHONE_CHECK_PROVIDER ?? "none") as "none" | "http" | "mock";

export interface PhoneCheckApproval {
  approvedAt: string | null;
  approvedBy: string | null;
  documentRef: string | null;
}
export const phoneCheckApproval = () => getSetting<PhoneCheckApproval>("phone.validation", { approvedAt: null, approvedBy: null, documentRef: null });

export async function setPhoneCheckApproval(user: Principal, a: { approvedAt: string; documentRef: string; reason: string }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a.approvedAt) || a.documentRef.trim().length < 3) throw new PhoneCheckError("BAD_VALUE");
  if (a.reason.trim().length < 5) throw new PhoneCheckError("REASON_REQUIRED");
  await setSetting(user.id, "phone.validation", { approvedAt: a.approvedAt, approvedBy: user.name, documentRef: a.documentRef.trim() }, a.reason);
}

async function lookup(e164: string): Promise<LineStatus> {
  const mode = phoneCheckMode();
  if (mode === "mock" && process.env.NODE_ENV !== "production") {
    const d = Number(e164.at(-1));
    return { lineType: "MOBILE", status: d === 0 ? "INACTIVE" : "ACTIVE", carrier: "Örnek Operatör", ported: d % 3 === 0, confidence: "MEDIUM" };
  }
  if (mode !== "http" || !process.env.PHONE_CHECK_URL) throw new PhoneCheckError("NOT_CONFIGURED");
  const res = await fetch(`${process.env.PHONE_CHECK_URL.replace(/\/$/, "")}/lookup?msisdn=${encodeURIComponent(e164)}`, {
    headers: { Authorization: `Bearer ${process.env.PHONE_CHECK_TOKEN ?? ""}` },
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) throw new PhoneCheckError("PROVIDER_ERROR");
  const j = (await res.json().catch(() => ({}))) as Partial<LineStatus>;
  return {
    lineType: (["MOBILE", "FIXED_LINE", "VOIP"] as const).find((x) => x === j.lineType) ?? "UNKNOWN",
    status: j.status === "ACTIVE" || j.status === "INACTIVE" ? j.status : "UNKNOWN",
    carrier: typeof j.carrier === "string" ? j.carrier.slice(0, 60) : null,
    ported: typeof j.ported === "boolean" ? j.ported : null,
    confidence: j.confidence === "HIGH" || j.confidence === "LOW" ? j.confidence : "MEDIUM",
  };
}

export async function checkPhone(user: Principal, phoneId: string) {
  if (phoneCheckMode() === "none") throw new PhoneCheckError("NOT_CONFIGURED");
  if (!(await phoneCheckApproval()).approvedAt) throw new PhoneCheckError("NOT_APPROVED");
  const p = await db.guestPhone.findUnique({ where: { id: phoneId }, select: { id: true, e164Enc: true, guestId: true } });
  if (!p) throw new PhoneCheckError("NOT_FOUND");
  if (!(await db.guest.count({ where: { AND: [{ id: p.guestId }, guestScopeWhere(user, "guest.view")] } }))) throw new PhoneCheckError("NOT_FOUND");
  const r = await lookup(decrypt(p.e164Enc));
  const source = `hlr:${phoneCheckMode()}`;
  await db.$transaction([
    db.phoneCheck.create({ data: { phoneId, kind: "LINE_TYPE", result: r.lineType, source, raw: { carrier: r.carrier, ported: r.ported, confidence: r.confidence } } }),
    db.phoneCheck.create({ data: { phoneId, kind: "LINE_STATUS", result: r.status, source, raw: { confidence: r.confidence } } }),
    db.guestPhone.update({ where: { id: phoneId }, data: { lastCheckedAt: new Date(), ...(r.lineType !== "UNKNOWN" ? { lineType: r.lineType } : {}) } }),
  ]);
  await audit({ actorId: user.id, action: "phone.check", entity: "GuestPhone", entityId: phoneId, diff: { source, status: r.status, lineType: r.lineType } });
  return r;
}

export async function lastLineStatus(phoneIds: string[]) {
  const rows = await db.phoneCheck.findMany({ where: { phoneId: { in: phoneIds }, kind: "LINE_STATUS" }, orderBy: { at: "desc" } });
  const m = new Map<string, (typeof rows)[number]>();
  for (const r of rows) if (!m.has(r.phoneId)) m.set(r.phoneId, r);
  return m;
}
