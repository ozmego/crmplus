import { describe, expect, it } from "vitest";
import { redactSensitive, tcknValid } from "@/lib/redact";

describe("redactSensitive", () => {
  it("geçerli kart numarasını (Luhn) maskeler", () => {
    const r = redactSensitive("kart 4111 1111 1111 1111 ile ödeyecek");
    expect(r.text).toBe("kart [KART] ile ödeyecek");
    expect(r.found).toContain("CARD");
  });

  it("geçerli IBAN'ı (mod-97) maskeler", () => {
    const r = redactSensitive("IBAN: TR33 0006 1005 1978 6457 8413 26");
    expect(r.text).toBe("IBAN: [IBAN]");
  });

  it("geçerli TC kimlik numarasını maskeler, rastgele 11 haneyi maskelemez", () => {
    expect(tcknValid("10000000146")).toBe(true);
    expect(redactSensitive("TC 10000000146").text).toBe("TC [TC KİMLİK]");
    expect(redactSensitive("ref 12345678901").found).not.toContain("TCKN");
  });

  it("telefon ve e-postayı maskeler", () => {
    const r = redactSensitive("Ara: 0532 410 22 17, mail ali@ornek.com");
    expect(r.text).toBe("Ara: [TELEFON], mail [E-POSTA]");
  });

  it("normal metne dokunmaz", () => {
    const s = "Aralık tripi için 12-15 tarihlerini teyit etti, 2 kişi.";
    expect(redactSensitive(s)).toEqual({ text: s, found: [] });
  });
});
