import { describe, expect, it } from "vitest";
import { mapStatementHeaders, normalizeStatementRows, parseAmount, parseStatementDate, reconcile } from "@/lib/statement";
import { financeFindings, opsFindings } from "@/lib/finance-anomaly";

describe("ekstre ayrıştırma", () => {
  it("sütun tanıma (Türkçe ve İngilizce)", () => {
    expect(mapStatementHeaders(["CRM No", "Ad Soyad", "Tarih", "Net Kayıp", "Rolling"])).toEqual({ crmNo: "CRM No", name: "Ad Soyad", playedOn: "Tarih", netLoss: "Net Kayıp", rolling: "Rolling" });
    expect(mapStatementHeaders(["Player ID", "Player Name", "Gaming Date", "House Win", "Turnover"])).toMatchObject({ playerRef: "Player ID", netLoss: "House Win", rolling: "Turnover" });
  });
  it.each([
    ["1.234.567,89", 123456789],
    ["1,234,567.89", 123456789],
    ["(1.000)", -100000],
    ["-250,5", -25050],
    [1500.25, 150025],
    ["12.500 TL", 1250000],
    ["abc", null],
  ])("tutar %s → %s", (v, k) => expect(parseAmount(v)).toBe(k));
  it("tarih biçimleri", () => {
    expect(parseStatementDate("03.11.2026")).toBe("2026-11-03");
    expect(parseStatementDate(46329)).toBe("2026-11-03");
    expect(parseStatementDate("2026-11-03T00:00:00Z")).toBe("2026-11-03");
  });
  it("satır normalizasyonu, işaret çevirme ve dönem dışı tarih", () => {
    const map = { crmNo: "CRM", netLoss: "Net", playedOn: "Tarih" };
    const r = normalizeStatementRows([{ CRM: "CRM-001234", Net: "1.000,00", Tarih: "05.11.2026" }, { CRM: "", Net: "x", Tarih: "05.10.2026" }], map, { invertSign: true, period: "2026-11" });
    expect(r[0]).toMatchObject({ crmNo: 1234, netLoss: -100000, playedOn: "2026-11-05", issue: null });
    expect(r[1].issue).toContain("CRM no");
    expect(r[1].issue).toContain("dönemi dışında");
  });
});

describe("mutabakat", () => {
  it("eşleşen, farklı, yalnız ekstrede, yalnız girilen", () => {
    const r = reconcile(
      [{ key: "1", name: "A", netLoss: 100000, rolling: 0 }, { key: "2", name: "B", netLoss: 50000, rolling: 0 }, { key: "3", name: "C", netLoss: 1000, rolling: 0 }],
      [{ key: "1", name: "A", netLoss: 100000, rolling: 0 }, { key: "2", name: "B", netLoss: 45000, rolling: 0 }, { key: "4", name: "D", netLoss: 2000, rolling: 0 }],
    );
    expect(r.counts).toEqual({ match: 1, diff: 1, onlyStatement: 1, onlyEntered: 1 });
    expect(r.totalDiff).toBe(151000 - 147000);
    expect(r.clean).toBe(false);
    expect(r.rows.find((x) => x.key === "2")!.diff).toBe(5000);
  });
});

describe("anomali bulguları", () => {
  const base = { tripGuestId: "tg", source: "MANUAL", enteredAt: new Date("2026-11-06T10:00:00Z") };
  it("kaynak yok, aynı gün mükerrer, uç değer, geç giriş", () => {
    const rows = [
      { ...base, id: "a", crmNo: 1, playedOn: "2026-11-05", netLoss: 100000, sourceRef: "EKS-1" },
      { ...base, id: "b", crmNo: 1, playedOn: "2026-11-05", netLoss: 120000, sourceRef: null },
      ...[2, 3, 4, 5].map((n) => ({ ...base, tripGuestId: `t${n}`, id: `c${n}`, crmNo: n, playedOn: "2026-11-02", netLoss: 90000, sourceRef: "EKS" })),
      { ...base, tripGuestId: "t9", id: "big", crmNo: 9, playedOn: "2026-09-01", netLoss: 90_000_000, sourceRef: "EKS" },
    ];
    const kinds = financeFindings(rows).map((f) => f.kind);
    expect(kinds).toContain("NO_SOURCE_REF");
    expect(kinds).toContain("DUPLICATE_DAY");
    expect(kinds).toContain("OUTLIER");
    expect(kinds).toContain("LATE_ENTRY");
  });
  it("operasyon: eşik altı bulgu üretmez, kişi değil ekip+gün", () => {
    const f = opsFindings([{ day: "2026-11-10", teamId: "t1", calls: 40, reachedZeroTalk: 6, autoClosed: 1, outsideShift: 0 }]);
    expect(f).toEqual([{ kind: "REACHED_ZERO_TALK", day: "2026-11-10", teamId: "t1", count: 6, rate: 0.15 }]);
  });
});
