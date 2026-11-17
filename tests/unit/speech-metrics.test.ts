import { describe, expect, it } from "vitest";
import { percentile, pickSamples, seededShuffle, wordEditDistance, wordErrorRate } from "@/lib/speech-metrics";

describe("WER", () => {
  it("kelime düzeyinde mesafe; noktalama ve büyük harf yok sayılır", () => {
    expect(wordEditDistance("Merit royal otel", "Merit Royal oteli")).toEqual({ distance: 1, reference: 3 });
    expect(wordEditDistance("İstanbul'a gidiyoruz.", "istanbul a gidiyoruz")).toEqual({ distance: 0, reference: 3 });
  });
  it("yalnız düzeltilen bölütlerden", () => {
    expect(wordErrorRate([{ before: "a b c d", after: "a x c d" }, { before: "e f", after: "e f g" }])).toBeCloseTo(2 / 7);
    expect(wordErrorRate([])).toBeNull();
  });
});

describe("percentile", () => {
  it("medyan ve P95", () => {
    const v = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(v, 50)).toBe(50);
    expect(percentile(v, 95)).toBe(95);
    expect(percentile([], 50)).toBeNull();
  });
});

describe("pickSamples", () => {
  const cands = Array.from({ length: 10 }, (_, i) => ({ callId: `c${i}`, agentId: i < 6 ? "a1" : "a2", mismatch: i === 2, processFlags: i === 4 ? 1 : 0, lowConfidence: false }));
  it("temsilci başına sınır, önce adaylar, sonra rastgele; tekrarlanabilir", () => {
    const r = pickSamples(cands, { perAgent: 3, flagged: 2, seed: "2026-11-09" });
    expect(r.filter((x) => x.agentId === "a1")).toHaveLength(3);
    expect(r.filter((x) => x.agentId === "a2")).toHaveLength(3);
    expect(r.filter((x) => x.agentId === "a1" && x.reason !== "RANDOM").map((x) => x.reason).sort()).toEqual(["MISMATCH", "PROCESS_FLAG"]);
    expect(pickSamples(cands, { perAgent: 3, flagged: 2, seed: "2026-11-09" })).toEqual(r);
  });
  it("daha önce seçilen çağrılar dışlanır", () => {
    const r = pickSamples(cands, { perAgent: 10, flagged: 0, seed: "x", exclude: new Set(["c0", "c1"]) });
    expect(r.map((x) => x.callId)).not.toContain("c0");
    expect(r).toHaveLength(8);
  });
  it("karıştırma elemanları korur", () => expect(seededShuffle([1, 2, 3, 4], "s").sort()).toEqual([1, 2, 3, 4]));
});
