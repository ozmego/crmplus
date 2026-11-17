import { describe, expect, it } from "vitest";
import { capacityGrid, forecast, hourlyBuckets, requiredAgents, slotOf } from "@/lib/capacity";

describe("slotOf (İstanbul saati)", () => {
  it("Pazartesi 09:30 İstanbul = UTC 06:30", () => expect(slotOf(new Date("2026-11-09T06:30:00Z"))).toEqual({ dow: 0, hour: 9 }));
  it("Pazar 23:10 İstanbul", () => expect(slotOf(new Date("2026-11-15T20:10:00Z"))).toEqual({ dow: 6, hour: 23 }));
});

describe("requiredAgents", () => {
  it("iş yükü / doluluk, yukarı yuvarlama", () => {
    // 60 çağrı × 180 sn = 3 temsilci-saat; %80 doluluk → 3,75 → 4
    expect(requiredAgents(60, 180, 0.8)).toBe(4);
    expect(requiredAgents(0, 180)).toBe(0);
    expect(requiredAgents(10, 0)).toBe(0);
  });
  it("doluluk sınırlanır (0,5–0,95)", () => expect(requiredAgents(60, 180, 2)).toBe(requiredAgents(60, 180, 0.95)));
});

describe("forecast + capacityGrid", () => {
  const mon10 = (week: number, i: number) => new Date(Date.parse("2026-11-02T07:00:00Z") + week * 7 * 86_400_000 + i * 60_000);
  const samples = [0, 1].flatMap((w) => Array.from({ length: 40 }, (_, i) => ({ startedAt: mon10(w, i), handleSec: 270 })));
  it("haftalık ortalama ve AHT", () => {
    const f = forecast(samples, 2);
    expect(f.calls[0][10]).toBe(40);
    expect(f.ahtSec).toBe(270);
  });
  it("plan ile karşılaştırma: eksik saat negatif fark", () => {
    const f = forecast(samples, 2);
    const planned = Array.from({ length: 7 }, () => Array(24).fill(0));
    planned[0][10] = 2;
    const cell = capacityGrid(f, planned, 0.8).find((c) => c.dow === 0 && c.hour === 10)!;
    expect(cell.required).toBe(4); // 40 × 270 / 3600 / 0,8 = 3,75
    expect(cell.gap).toBe(-2);
  });
  it("saatlik kova", () => expect(hourlyBuckets([new Date("2026-11-14T07:05:00Z"), new Date("2026-11-14T07:55:00Z")])[10]).toBe(2));
});
