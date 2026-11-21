import { describe, expect, it } from "vitest";
import { isValidTcNo, maskId, normalizePassportNo, profileGaps } from "@/lib/identity";

describe("kimlik yardımcıları", () => {
  it("TC kimlik no sağlama kuralları", () => {
    expect(isValidTcNo("10000000146")).toBe(true);
    expect(isValidTcNo("10000000145")).toBe(false); // 11. hane yanlış
    expect(isValidTcNo("01234567890")).toBe(false); // 0 ile başlayamaz
    expect(isValidTcNo("1234567890")).toBe(false); // 10 hane
    expect(isValidTcNo("1000000014a")).toBe(false);
  });

  it("pasaport no normalize edilir", () => {
    expect(normalizePassportNo("u 123-4567")).toBe("U1234567");
    expect(normalizePassportNo("ab1")).toBeNull();
    expect(normalizePassportNo("ÜÇ12345")).toBeNull();
  });

  it("maskeleme yalnız son 2 haneyi gösterir", () => {
    expect(maskId("10000000146")).toBe("•••••••••46");
    expect(maskId("U1234567")).toBe("••••••67");
  });

  it("profil eksikleri: pasaport 6 ay kuralı tripe göre, seyahat bilgisi", () => {
    const now = new Date("2026-11-20T00:00:00Z");
    const base = { hasIdentity: true, hasBirthDate: true, hasNationality: true, hasPassportDoc: true, hasPhoto: true, hasPreferences: true, now };
    expect(profileGaps({ ...base, passportExpiry: new Date("2028-01-01"), nextTripStart: null, nextTripHasTravel: false })).toEqual([]);
    expect(profileGaps({ ...base, passportExpiry: new Date("2027-03-01"), nextTripStart: null, nextTripHasTravel: false })).toContain("Pasaport geçerliliği 6 aydan kısa");
    // trip Aralık sonunda: pasaport tripten itibaren 6 ay geçerli olmalı
    expect(profileGaps({ ...base, passportExpiry: new Date("2027-06-01"), nextTripStart: new Date("2026-12-28"), nextTripHasTravel: true })).toContain("Pasaport geçerliliği 6 aydan kısa");
    expect(profileGaps({ ...base, passportExpiry: null, nextTripStart: new Date("2026-12-01"), nextTripHasTravel: false })).toEqual(["Yaklaşan trip için seyahat bilgisi"]);
    expect(profileGaps({ ...base, hasIdentity: false, hasPhoto: false, passportExpiry: null, nextTripStart: null, nextTripHasTravel: false })).toEqual(["Kimlik veya pasaport numarası", "Vesikalık"]);
  });
});
