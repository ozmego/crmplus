import { describe, expect, it } from "vitest";
import { suggestMapping } from "@/lib/import/fields";
import { normalizeRow, parseDate, trLower, trUpper } from "@/lib/import/normalize";
import { classifyMatch, fieldDiff, trigramSimilarity, type Candidate } from "@/lib/import/match";

describe("trLower / trUpper", () => {
  it("ICU tr-TR dönüşümüyle aynı sonucu verir (Latin, Kiril, Yunan harfleri ve örnekler)", () => {
    const chars: string[] = [];
    for (let c = 0x41; c <= 0x24f; c++) chars.push(String.fromCharCode(c));
    for (let c = 0x370; c <= 0x4ff; c++) chars.push(String.fromCharCode(c));
    const samples = [...chars, "IŞIK", "İSTANBUL", "ılık İçel", "ŞÜKRÜ ÇAĞLAR", "Müller", "STRAßE", "i̇", "ÖzİşIı", "Иван", "ΣΟΦΊΑ"];
    for (const s of samples) {
      expect(trLower(s), s).toBe(s.toLocaleLowerCase("tr-TR"));
      expect(trUpper(s), s).toBe(s.toLocaleUpperCase("tr-TR"));
    }
  });
});

describe("suggestMapping", () => {
  it("Türkçe ve İngilizce başlıkları alanlara eşler, finansal sütunu tanır", () => {
    const m = suggestMapping(["Adı", "Soyadı", "Cep Telefonu", "E-Mail", "Uyruk", "Arama İzni", "Net Kayıp", "Bilinmeyen"]);
    expect(m).toMatchObject({
      Adı: "firstName",
      Soyadı: "lastName",
      "Cep Telefonu": "phone1",
      "E-Mail": "email",
      Uyruk: "country",
      "Arama İzni": "consentCall",
      "Net Kayıp": "financial",
      Bilinmeyen: null,
    });
  });
});

describe("normalizeRow (docs/02)", () => {
  const today = new Date("2026-11-07");
  const mapping = { Ad: "firstName", Soyad: "lastName", Tel: "phone1", İzin: "consentCall", "İzin Tarihi": "consentDate", "İzin Kaynağı": "consentSource", Kayıp: "financial" };

  it("ad-soyadı düzeltir, telefonu E.164 yapar, finansal sütunu işaretler", () => {
    const { row, issues } = normalizeRow(
      { Ad: "  aYŞE ", Soyad: "yılmaz", Tel: "0532 410 22 17", İzin: "Evet", "İzin Tarihi": "01.06.2026", "İzin Kaynağı": "Form", Kayıp: "12000" },
      mapping,
      { defaultCountry: "TR", today },
    );
    expect(row.firstName).toBe("Ayşe");
    expect(row.lastName).toBe("Yılmaz");
    expect(row.phones[0].e164).toBe("+905324102217");
    expect(row.consent.CALL).toBe("GRANTED");
    expect(row.hasFinancial).toBe(true);
    expect(issues).toEqual([]);
  });

  it("izin evet ama tarih/kaynak yoksa bilinmiyor sayılır", () => {
    const { row, issues } = normalizeRow({ Ad: "Can", Soyad: "Kurt", Tel: "05324102217", İzin: "evet" }, mapping, { defaultCountry: "TR", today });
    expect(row.consent.CALL).toBe("UNKNOWN");
    expect(issues.map((i) => i.code)).toContain("E_CONSENT_INCOMPLETE");
  });

  it("zorunlu alan, bozuk telefon ve 18 yaş altı", () => {
    const m = { ...mapping, "Doğum Yılı": "birthYear" };
    const r = normalizeRow({ Ad: "", Soyad: "X", Tel: "9.05E+11", "Doğum Yılı": "2015" }, m, { defaultCountry: "TR", today });
    const codes = r.issues.map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(["E_REQUIRED", "E_PHONE_SCIENTIFIC", "E_UNDERAGE"]));
  });

  it("tarih biçimleri", () => {
    expect(parseDate("01.06.2026")).toBe("2026-06-01");
    expect(parseDate("2026-06-01")).toBe("2026-06-01");
    expect(parseDate("45658")).toBe("2025-01-01"); // Excel seri tarihi
    expect(parseDate("46174")).toBe("2026-06-01");
    expect(parseDate("31.02.2026")).toBeNull();
  });
});

describe("classifyMatch (docs/02 §6)", () => {
  const c = (id: string, first: string, last: string, via: Candidate["via"], birthYear?: number): Candidate => ({ id, firstName: first, lastName: last, via, birthYear });

  it("CRM ID kesin eşleşir; bulunamazsa hata", () => {
    expect(classifyMatch({ crmNo: 5 }, [c("g1", "A", "B", "CRM_ID")])).toMatchObject({ kind: "MATCHED", guestId: "g1", confidence: "EXACT" });
    expect(classifyMatch({ crmNo: 5 }, [])).toEqual({ kind: "CRM_ID_NOT_FOUND" });
  });

  it("telefon + benzer isim → güçlü eşleşme", () => {
    expect(classifyMatch({ firstName: "Ayse", lastName: "Yilmaz" }, [c("g1", "Ayşe", "Yılmaz", "PHONE")])).toMatchObject({
      kind: "MATCHED",
      confidence: "STRONG",
    });
  });

  it("telefon tek başına kimlik değildir → inceleme", () => {
    expect(classifyMatch({ firstName: "Ayten", lastName: "Demir" }, [c("g1", "Ayşe", "Yılmaz", "PHONE")])).toMatchObject({ kind: "POSSIBLE" });
  });

  it("doğum yılı çelişkisi isim benzer olsa da eşleşmeyi engeller", () => {
    expect(classifyMatch({ firstName: "Ayşe", lastName: "Yılmaz", birthYear: 1980 }, [c("g1", "Ayşe", "Yılmaz", "PHONE", 1975)])).toMatchObject({
      kind: "POSSIBLE",
    });
  });

  it("aynı telefonda iki doğrulanmış aday → çoklu eşleşme", () => {
    expect(classifyMatch({ firstName: "Ali", lastName: "Kaya" }, [c("g1", "Ali", "Kaya", "PHONE"), c("g2", "Ali", "Kaya", "PHONE")])).toMatchObject({
      kind: "MULTI_MATCH",
    });
  });

  it("trigram benzerliği Türkçe karakterlere duyarsız", () => {
    expect(trigramSimilarity("Şükrü Öztürk", "sukru ozturk")).toBe(1);
  });
});

describe("fieldDiff — sessiz ezme yok", () => {
  it("boşu doldurur, farklı doluyu çakışma yapar, aynıyı ve dosyadaki boşu atlar", () => {
    expect(fieldDiff({ city: null, lastName: "Kaya", language: "tr", vipLevel: "GOLD" }, { city: "İstanbul", lastName: "Kayalı", language: "tr", vipLevel: "" })).toEqual([
      { field: "city", old: null, new: "İstanbul", action: "FILL" },
      { field: "lastName", old: "Kaya", new: "Kayalı", action: "CONFLICT" },
    ]);
  });
});
