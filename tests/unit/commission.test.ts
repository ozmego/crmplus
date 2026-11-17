import { describe, expect, it } from "vitest";
import { applyTiers, computeCommission, evaluateRule, evaluateVersion, shadowDiff, toKurus, type EngineResult, type EngineRule } from "@/lib/commission";

const base: Omit<EngineRule, "name" | "basis" | "scope" | "tiers"> = { tierMode: "MARGINAL", min: null, max: null, currency: "TRY", priority: 1, netWinBehavior: "ZERO" };
const lossRule: EngineRule = { ...base, name: "Net kayıp kademeli", basis: "NET_LOSS", scope: "PERIOD_TOTAL", netWinBehavior: "CARRY_OVER", tiers: [{ from: 0, to: 1_000_000, rate: 0.1 }, { from: 1_000_000, to: 5_000_000, rate: 0.12 }, { from: 5_000_000, to: null, rate: 0.15 }] };
const guestRule: EngineRule = { ...base, name: "Nitelikli misafir", basis: "GUEST_COUNT", scope: "PERIOD_TOTAL", priority: 2, tiers: [{ from: 0, to: null, amount: 5000 }], filter: { minRollingPerGuest: 500_000 } };

/** docs/06 §4 örneği: 3,2M net kayıp, 12 nitelikli misafir (rolling ≥ 500k) + 3 niteliksiz */
function docExample(): EngineResult[] {
  const rs: EngineResult[] = [];
  for (let i = 0; i < 12; i++) rs.push({ id: `q${i}`, guestKey: `${1000 + i}`, tripId: "t1", country: "TR", netLoss: toKurus(250_000), rolling: toKurus(600_000) });
  for (let i = 0; i < 3; i++) rs.push({ id: `n${i}`, guestKey: `${2000 + i}`, tripId: "t1", country: "DE", netLoss: toKurus(i < 2 ? 66_666.67 : 66_666.66), rolling: toKurus(100_000) });
  return rs;
}

describe("applyTiers", () => {
  it("marjinal: 3,2M → 364.000", () => expect(applyTiers(toKurus(3_200_000), lossRule).commission).toBe(toKurus(364_000)));
  it("bütün: ulaşılan kademe oranı tüm tutara", () => expect(applyTiers(toKurus(3_200_000), { ...lossRule, tierMode: "WHOLE" }).commission).toBe(toKurus(384_000)));
  it("adet tabanında adet başı tutar", () => expect(applyTiers(12, guestRule).commission).toBe(toKurus(60_000)));
  it("sıfır/negatif değerde kademe uygulanmaz", () => expect(applyTiers(0, lossRule).commission).toBe(0));
});

describe("docs/06 örneği (SUM)", () => {
  it("364.000 + 60.000 = 424.000 TL", () => {
    const rs = docExample();
    const total = rs.reduce((s, r) => s + r.netLoss, 0);
    expect(total).toBe(toKurus(3_200_000));
    const v = evaluateVersion({ versionId: "v1", label: "Sürüm 1", combine: "SUM", rules: [lossRule, guestRule] }, rs);
    expect(v.rules[1].qualifyingGuests).toBe(12);
    expect(v.total).toBe(toKurus(424_000));
  });
  it("MAX ve PRIORITY birleştirme", () => {
    const rs = docExample();
    expect(evaluateVersion({ versionId: "v", label: "", combine: "MAX", rules: [lossRule, guestRule] }, rs).total).toBe(toKurus(364_000));
    const p = evaluateVersion({ versionId: "v", label: "", combine: "PRIORITY", rules: [{ ...guestRule, priority: 1 }, { ...lossRule, priority: 2 }] }, rs);
    expect(p.chosen).toEqual(["Nitelikli misafir"]);
    expect(p.total).toBe(toKurus(60_000));
  });
});

describe("net kazanç davranışı", () => {
  const win: EngineResult[] = [{ id: "w", guestKey: "1", tripId: "t", country: "TR", netLoss: toKurus(-200_000), rolling: 0 }];
  it("ZERO → 0", () => expect(evaluateRule({ ...lossRule, netWinBehavior: "ZERO" }, win).total).toBe(0));
  it("NEGATIVE → ilk kademe oranıyla negatif", () => expect(evaluateRule({ ...lossRule, netWinBehavior: "NEGATIVE" }, win).total).toBe(toKurus(-20_000)));
  it("CARRY_OVER → bu dönem 0, kazanç devreder; sonraki dönemde kayıptan düşülür", () => {
    const r1 = evaluateRule(lossRule, win);
    expect(r1.total).toBe(0);
    expect(r1.carryOut).toEqual({ DONEM: toKurus(-200_000) });
    const next: EngineResult[] = [{ id: "x", guestKey: "1", tripId: "t2", country: "TR", netLoss: toKurus(1_200_000), rolling: 0 }];
    const r2 = evaluateRule(lossRule, next, r1.carryOut);
    expect(r2.units[0].value).toBe(toKurus(1_200_000));
    expect(r2.total).toBe(toKurus(100_000)); // (1,2M − 0,2M) = 1M × %10
  });
});

describe("filtre, taban/tavan, kapsam", () => {
  it("ülke bazlı kural yalnız o ülkenin misafirlerini sayar", () => {
    const r = evaluateRule({ ...guestRule, filter: { countries: ["DE"] } }, docExample());
    expect(r.qualifyingGuests).toBe(3);
    expect(r.total).toBe(toKurus(15_000));
  });
  it("tavan uygulanır ve işaretlenir", () => {
    const r = evaluateRule({ ...lossRule, max: 300_000 }, docExample());
    expect(r.total).toBe(toKurus(300_000));
    expect(r.capped).toBe("MAX");
  });
  it("misafir başı kapsam: her misafir kendi kademesinden", () => {
    const rs: EngineResult[] = [
      { id: "a", guestKey: "1", tripId: "t", country: "TR", netLoss: toKurus(1_500_000), rolling: 0 },
      { id: "b", guestKey: "2", tripId: "t", country: "TR", netLoss: toKurus(500_000), rolling: 0 },
    ];
    const r = evaluateRule({ ...lossRule, scope: "PER_GUEST" }, rs);
    expect(r.units.find((u) => u.key === "1")!.commission).toBe(toKurus(160_000)); // 1M×%10 + 0,5M×%12
    expect(r.units.find((u) => u.key === "2")!.commission).toBe(toKurus(50_000));
  });
});

describe("computeCommission", () => {
  it("ay ortası sürüm değişikliği: her sürüm kendi sonuçlarıyla; para birimi uyuşmazlığı uyarısı", () => {
    const rs = docExample();
    const out = computeCommission({
      currency: "TRY",
      parts: [
        { version: { versionId: "v1", label: "Sürüm 1", combine: "SUM", rules: [lossRule] }, results: rs.slice(0, 4) },
        { version: { versionId: "v2", label: "Sürüm 2", combine: "SUM", rules: [lossRule, { ...guestRule, currency: "EUR" }] }, results: rs.slice(4) },
      ],
      unassigned: 1,
    });
    expect(out.versions).toHaveLength(2);
    expect(out.total).toBe(out.versions[0].total + out.versions[1].total);
    expect(out.warnings.join(" ")).toContain("EUR");
    expect(out.warnings.join(" ")).toContain("1 sonuç");
    expect(out.inputs.guests).toBe(15);
  });
  it("gölge fark", () => expect(shadowDiff(toKurus(424_000), toKurus(424_000)).match).toBe(true));
});
