import { describe, expect, it } from "vitest";
import { maskE164, normalizePhone } from "@/lib/phone";

describe("normalizePhone (docs/02 §5)", () => {
  it.each([
    ["0532 410 22 17", "+905324102217"],
    ["5324102217", "+905324102217"],
    ["905324102217", "+905324102217"],
    ["+90 (532) 410-22-17", "+905324102217"],
    ["00905324102217", "+905324102217"],
    ["'05324102217", "+905324102217"],
    ["004915123456789", "+4915123456789"],
  ])("%s → %s", (input, expected) => {
    const r = normalizePhone(input, "TR");
    expect(r.ok).toBe(true);
    expect(r.e164).toBe(expected);
  });

  it("bilimsel gösterimi ayrı hata koduyla işaretler", () => {
    expect(normalizePhone("9.05E+11").error).toBe("E_PHONE_SCIENTIFIC");
  });

  it("boş ve geçersiz numaraları reddeder", () => {
    expect(normalizePhone("").error).toBe("E_PHONE_EMPTY");
    expect(normalizePhone("12345").error).toBe("E_PHONE_INVALID");
  });

  it("hat türünü ve ülkeyi döndürür", () => {
    const r = normalizePhone("05324102217");
    expect(r.country).toBe("TR");
    expect(r.lineType).toBe("MOBILE");
  });

  it("beklenen ülkeyle uyuşmazlığı işaretler", () => {
    expect(normalizePhone("+4915123456789", "TR", "TR").countryMismatch).toBe(true);
  });
});

describe("maskE164", () => {
  it("ülke kodu, ilk 3 ve son 2 hane görünür", () => {
    expect(maskE164("+905324102218", "90")).toBe("+90 532 *** ** 18");
  });
});
