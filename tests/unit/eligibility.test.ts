import { describe, expect, it } from "vitest";
import { checkEligibility, type EligibilityInput } from "@/lib/eligibility";

const now = new Date("2026-11-07T12:00:00Z");
const base = (): EligibilityInput => ({
  channel: "CALL",
  purpose: "MARKETING",
  now,
  guest: { anonymizedAt: null },
  consent: { status: "GRANTED", scope: "MARKETING", validUntil: null },
  blocks: [],
  phone: { formatStatus: "VALID", ownership: "UNCONFIRMED", reachability: "UNVERIFIED", lineType: "MOBILE" },
});

describe("checkEligibility (docs/04 §3)", () => {
  it("izinli ve geçerli kayıt uygundur", () => {
    expect(checkEligibility(base())).toEqual({ ok: true });
  });

  it("izin bilinmiyorsa (veya hiç kayıt yoksa) aranamaz — MVP kabul ölçütü", () => {
    expect(checkEligibility({ ...base(), consent: { status: "UNKNOWN", scope: "MARKETING" } })).toEqual({ ok: false, reason: "NO_CONSENT" });
    expect(checkEligibility({ ...base(), consent: null })).toEqual({ ok: false, reason: "NO_CONSENT" });
  });

  it("ret ve süresi dolmuş izin", () => {
    expect(checkEligibility({ ...base(), consent: { status: "DENIED", scope: "MARKETING" } }).ok).toBe(false);
    expect(
      checkEligibility({ ...base(), consent: { status: "GRANTED", scope: "MARKETING", validUntil: new Date("2026-01-01") } }),
    ).toEqual({ ok: false, reason: "CONSENT_EXPIRED" });
  });

  it("aktif durdurma kaydı her şeyi geçersiz kılar; kaldırılmış kayıt etkisizdir", () => {
    expect(checkEligibility({ ...base(), blocks: [{ allChannels: true }] })).toEqual({ ok: false, reason: "BLOCKED" });
    expect(checkEligibility({ ...base(), blocks: [{ allChannels: false, channel: "SMS" }] }).ok).toBe(true);
    expect(checkEligibility({ ...base(), blocks: [{ allChannels: true, removedAt: now }] }).ok).toBe(true);
  });

  it("hizmet kapsamlı izin pazarlama için yetmez", () => {
    expect(checkEligibility({ ...base(), consent: { status: "GRANTED", scope: "SERVICE" } })).toEqual({
      ok: false,
      reason: "CONSENT_SCOPE",
    });
  });

  it("istisna yalnız hizmet amacında ve durdurma yoksa geçerli", () => {
    const exc = { exception: { validUntil: new Date("2026-11-10") }, consent: null };
    expect(checkEligibility({ ...base(), ...exc, purpose: "SERVICE" }).ok).toBe(true);
    expect(checkEligibility({ ...base(), ...exc, purpose: "MARKETING" }).ok).toBe(false);
    expect(checkEligibility({ ...base(), ...exc, purpose: "SERVICE", blocks: [{ allChannels: true }] }).ok).toBe(false);
  });

  it("telefon durumları", () => {
    const p = base().phone!;
    expect(checkEligibility({ ...base(), phone: { ...p, formatStatus: "INVALID" } }).ok).toBe(false);
    expect(checkEligibility({ ...base(), phone: { ...p, ownership: "DISPUTED" } }).ok).toBe(false);
    expect(checkEligibility({ ...base(), phone: { ...p, reachability: "UNREACHABLE" } }).ok).toBe(false);
    expect(checkEligibility({ ...base(), channel: "SMS", consent: { status: "GRANTED", scope: "MARKETING" }, phone: { ...p, lineType: "FIXED_LINE" } })).toEqual({
      ok: false,
      reason: "NOT_SMS_CAPABLE",
    });
  });
});
