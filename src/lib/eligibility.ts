/**
 * İletişim uygunluğu — docs/04 §3. Tek kaynak: görev oluşturma, kuyruk listeleme ve
 * "Ara"/"Gönder" anında aynı fonksiyon çağrılır. Saf fonksiyon; veriyi çağıran yükler.
 *
 * Bilinçli olarak finansal veri girdisi YOKTUR (ürün sınırı: kayıp/kazanç uygunluğu veya önceliği etkilemez).
 */

export type Channel = "CALL" | "SMS" | "WHATSAPP" | "EMAIL";
export type Purpose = "MARKETING" | "SERVICE";

export type IneligibleReason =
  | "NO_CONSENT"
  | "CONSENT_DENIED"
  | "CONSENT_EXPIRED"
  | "CONSENT_SCOPE"
  | "BLOCKED"
  | "INVALID_PHONE"
  | "DISPUTED_PHONE"
  | "UNREACHABLE_PHONE"
  | "NOT_SMS_CAPABLE"
  | "ANONYMIZED";

export interface EligibilityInput {
  channel: Channel;
  purpose: Purpose;
  now: Date;
  guest: { anonymizedAt?: Date | null };
  consent?: {
    status: "GRANTED" | "DENIED" | "UNKNOWN";
    scope: string; // MARKETING | SERVICE
    validUntil?: Date | null;
  } | null;
  blocks: { allChannels: boolean; channel?: string | null; removedAt?: Date | null }[];
  phone?: {
    formatStatus: "VALID" | "INVALID" | "COUNTRY_MISMATCH";
    ownership: "CONFIRMED" | "UNCONFIRMED" | "DISPUTED";
    reachability: "UNVERIFIED" | "REACHED" | "UNREACHED" | "UNREACHABLE";
    lineType?: string | null;
  } | null;
  /** Onaylı, süresi geçmemiş istisna (yalnız SERVICE amacı için). */
  exception?: { validUntil: Date } | null;
}

export type EligibilityResult = { ok: true } | { ok: false; reason: IneligibleReason };

export function checkEligibility(i: EligibilityInput): EligibilityResult {
  if (i.guest.anonymizedAt) return { ok: false, reason: "ANONYMIZED" };

  const activeBlock = i.blocks.some((b) => !b.removedAt && (b.allChannels || b.channel === i.channel));
  if (activeBlock) return { ok: false, reason: "BLOCKED" };

  const exceptionValid = i.purpose === "SERVICE" && !!i.exception && i.exception.validUntil > i.now;
  if (!exceptionValid) {
    const c = i.consent;
    if (!c || c.status === "UNKNOWN") return { ok: false, reason: "NO_CONSENT" };
    if (c.status === "DENIED") return { ok: false, reason: "CONSENT_DENIED" };
    if (c.validUntil && c.validUntil <= i.now) return { ok: false, reason: "CONSENT_EXPIRED" };
    // SERVICE kapsamlı izin pazarlama için yetmez; MARKETING izni hizmet iletişimini de kapsar.
    if (i.purpose === "MARKETING" && c.scope !== "MARKETING") return { ok: false, reason: "CONSENT_SCOPE" };
  }

  if (i.channel !== "EMAIL") {
    const p = i.phone;
    if (!p || p.formatStatus === "INVALID") return { ok: false, reason: "INVALID_PHONE" };
    if (p.ownership === "DISPUTED") return { ok: false, reason: "DISPUTED_PHONE" };
    if (p.reachability === "UNREACHABLE") return { ok: false, reason: "UNREACHABLE_PHONE" };
    if (i.channel === "SMS" && p.lineType && !["MOBILE", "FIXED_LINE_OR_MOBILE", "UNKNOWN"].includes(p.lineType)) {
      return { ok: false, reason: "NOT_SMS_CAPABLE" };
    }
  }

  return { ok: true };
}

export const INELIGIBLE_LABEL_TR: Record<IneligibleReason, string> = {
  NO_CONSENT: "İzin durumu bilinmiyor",
  CONSENT_DENIED: "İzin reddedilmiş",
  CONSENT_EXPIRED: "İzin süresi dolmuş",
  CONSENT_SCOPE: "İzin kapsamı pazarlamayı içermiyor",
  BLOCKED: "İletişim durdurulmuş",
  INVALID_PHONE: "Geçerli telefon yok",
  DISPUTED_PHONE: "Numara tartışmalı (yanlış kişi)",
  UNREACHABLE_PHONE: "Numara ulaşılamıyor",
  NOT_SMS_CAPABLE: "Hat SMS almıyor",
  ANONYMIZED: "Kayıt anonimleştirilmiş",
};
