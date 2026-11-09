import { describe, expect, it } from "vitest";
import { checkTemplate, isOptOut, renderTemplate, segmentSchema, smsSegments, toGsmFriendly, withOptOut } from "@/lib/sms";

describe("smsSegments", () => {
  it("GSM-7: 160 tek parça, 161 iki parça (153'lük)", () => {
    expect(smsSegments("a".repeat(160))).toMatchObject({ encoding: "GSM7", segments: 1 });
    expect(smsSegments("a".repeat(161))).toMatchObject({ encoding: "GSM7", segments: 2, perSegment: 153 });
  });
  it("genişletme karakteri 2 sayılır", () => expect(smsSegments("€").length).toBe(2));
  it("Türkçe ş/ğ/ı UCS-2'ye düşürür: 70 tek parça, 71 iki parça", () => {
    expect(smsSegments("ş".repeat(70))).toMatchObject({ encoding: "UCS2", segments: 1 });
    expect(smsSegments("ş".repeat(71))).toMatchObject({ encoding: "UCS2", segments: 2, perSegment: 67 });
  });
  it("tek parça modu Türkçe karakterleri dönüştürür", () => expect(smsSegments(toGsmFriendly("Şişli'de buluşalım")).encoding).toBe("GSM7"));
});

describe("checkTemplate (docs/10 §4)", () => {
  it("izinli değişkenler geçer", () => expect(checkTemplate("Merhaba {ad}, temsilciniz {temsilci_adi}.", "MARKETING").errors).toEqual([]));
  it("finansal ve bilinmeyen değişken reddedilir", () => {
    const r = checkTemplate("Merhaba {ad}, kaybınız {kayip_tutari}, {pasaport_no}", "MARKETING");
    expect(r.errors).toHaveLength(2);
    expect(r.errors[0]).toContain("finansal");
  });
  it("riskli ifade uyarı verir (engellemez)", () => {
    const r = checkTemplate("Son şans! Kesin kazanacaksınız.", "MARKETING");
    expect(r.errors).toEqual([]);
    expect(r.warnings.length).toBeGreaterThanOrEqual(2);
  });
});

describe("render + ret metni", () => {
  it("değişkenleri doldurur, pazarlamaya ret metni ekler", () => {
    const t = renderTemplate("Merhaba {ad} {soyad}", { ad: "Ayşe", soyad: "Kaya" });
    expect(withOptOut(t, "MARKETING", "RET yazıp 3000'e gönderin.")).toBe("Merhaba Ayşe Kaya RET yazıp 3000'e gönderin.");
    expect(withOptOut(t, "INFORMATIONAL", "RET")).toBe("Merhaba Ayşe Kaya");
  });
});

describe("isOptOut (docs/10 §6)", () => {
  it.each(["RET", "ret", "İptal", "STOP lütfen", "iptal.", "Mesaj atmayın"])("%s → ret", (t) => expect(isOptOut(t)).toBe(true));
  it.each(["Teşekkürler", "Ne zaman?", "Retro gece var mı"])("%s → ret değil", (t) => expect(isOptOut(t)).toBe(false));
});

describe("segmentSchema (plan v4 §6 alan beyaz listesi)", () => {
  it("izinli alanlar geçer", () => expect(segmentSchema.parse({ languages: ["tr"], countries: ["DE"], tags: ["vip-gece"], lastContactBeforeDays: 30 })).toBeTruthy());
  it.each([{ netLoss: { gte: 1000 } }, { commission: 1 }, { vipLevel: "GOLD" }, { analysisScore: 0.9 }])("finansal/skor alanı reddedilir: %o", (s) =>
    expect(segmentSchema.safeParse(s).success).toBe(false));
});
