import { describe, expect, it } from "vitest";
import { compareRowSets, type CompRow } from "@/lib/compare";

const row = (ref: string, o: Partial<CompRow> = {}): CompRow => ({
  ref, phoneHashes: [], phonesMasked: [], fields: { firstName: "Ali", lastName: "Kaya" }, consent: {}, ...o,
});

describe("compareRowSets — 7 durum", () => {
  const left = [
    row("L1", { crmNo: 1 }),
    row("L2", { phoneHashes: ["h2"], phonesMasked: ["+90 532 *** ** 02"], fields: { firstName: "Ayşe", lastName: "Demir", city: "İzmir" } }),
    row("L3", { phoneHashes: ["h3"], fields: { firstName: "Can", lastName: "Kurt" } }),
    row("L4", { phoneHashes: ["h4"], fields: { firstName: "Elif", lastName: "Şahin" } }),
    row("L5", { phoneHashes: ["h5"], fields: { firstName: "Deniz", lastName: "Koç" } }),
    row("L6", { phoneHashes: ["h5"], fields: { firstName: "Deniz", lastName: "Koç" } }),
    row("L7", { ext: "CASA\u0000777", consent: { CALL: "DENIED" } }),
    row("L8", { crmNo: 8 }),
  ];
  const right = [
    row("R1", { crmNo: 1 }), // aynı
    row("R2", { phoneHashes: ["h2"], fields: { firstName: "Ayse", lastName: "Demir", city: "Antalya" } }), // diğer alan
    row("R3", { phoneHashes: ["h3", "h3b"], phonesMasked: ["+90 •3", "+90 •3b"], fields: { firstName: "Can", lastName: "Kurt" } }), // iletişim
    row("R4", { phoneHashes: ["h4"], fields: { firstName: "Murat", lastName: "Aydın" } }), // telefon aynı, isim farklı → çelişki
    row("R5", { phoneHashes: ["h5"], fields: { firstName: "Deniz", lastName: "Koç" } }), // iki aday → çoklu
    row("R7", { ext: "CASA\u0000777", consent: { CALL: "GRANTED" } }), // izin çelişkisi
    row("R9", { phoneHashes: ["h9"] }), // yeni
  ];
  const res = compareRowSets(left, right);
  const by = (ref: string) => res.find((r) => r.rightRef === ref || (r.rightRef === null && r.leftRef === ref))!;

  it("eşleşti, değişiklik yok", () => expect(by("R1").status).toBe("SAME"));
  it("diğer alanlar değişti; Türkçe karakter farkı değişiklik sayılmaz", () => {
    expect(by("R2").status).toBe("OTHER_CHANGED");
    expect(by("R2").deltas).toEqual([{ field: "city", left: "İzmir", right: "Antalya" }]);
  });
  it("telefon/iletişim değişti", () => expect(by("R3").status).toBe("CONTACT_CHANGED"));
  it("telefon tek başına kimlik değildir → çelişki", () => expect(by("R4").status).toBe("CONFLICT"));
  it("birden fazla muhtemel eşleşme", () => expect(by("R5")).toMatchObject({ status: "MULTI_MATCH", candidateRefs: ["L5", "L6"] }));
  it("izin çelişkisi → kaynaklar arası çelişki", () => expect(by("R7")).toMatchObject({ status: "CONFLICT", deltas: [{ field: "consent.CALL", left: "DENIED", right: "GRANTED" }] }));
  it("yeni kayıt", () => expect(by("R9").status).toBe("NEW"));
  it("tabanda var, dosyada yok — yalnız etiket", () => expect(by("L8").status).toBe("MISSING_IN_FILE"));
  it("dosyada boş alan değişiklik sayılmaz", () => {
    const r = compareRowSets([row("A", { crmNo: 3, fields: { firstName: "Ali", lastName: "Kaya", city: "Bursa" } })], [row("B", { crmNo: 3, fields: { firstName: "Ali", lastName: "Kaya", city: "" } })]);
    expect(r[0].status).toBe("SAME");
  });
});
