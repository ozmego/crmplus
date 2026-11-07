import { describe, expect, it } from "vitest";
import { agentKpi, callbackKpi, percentiles, type CallFact, type DispositionMeta } from "@/lib/kpi";

const D: DispositionMeta[] = [
  { code: "REACHED", category: "REACHED", noteRequired: true },
  { code: "NO_ANSWER", category: "UNREACHED", noteRequired: false },
  { code: "BUSY", category: "UNREACHED", noteRequired: false },
  { code: "WRONG_PERSON", category: "REACHED", noteRequired: true },
  { code: "DO_NOT_CONTACT", category: "REACHED", noteRequired: false },
  { code: "CALLBACK_REQUESTED", category: "REACHED", noteRequired: false },
];
const call = (o: Partial<CallFact>): CallFact => ({
  agentId: "a", phoneId: "p1", taskId: "t1", answered: false, disposition: "NO_ANSWER", talkSec: 0, ringSec: 20, wrapSec: 5, autoClosed: false, noteLength: 0, ...o,
});

describe("agentKpi (docs/05 §3)", () => {
  const calls = [
    call({ answered: true, disposition: "REACHED", talkSec: 120, phoneId: "p1", noteLength: 30 }),
    call({ answered: true, disposition: "REACHED", talkSec: 60, phoneId: "p2", taskId: "t2", noteLength: 3 }),
    call({ disposition: "NO_ANSWER", phoneId: "p3", taskId: "t3" }),
    call({ disposition: "BUSY", phoneId: "p3", taskId: "t3" }),
    call({ answered: true, disposition: "DO_NOT_CONTACT", talkSec: 30, phoneId: "p4", taskId: "t4" }),
    call({ answered: true, disposition: "WRONG_PERSON", talkSec: 10, phoneId: "p5", taskId: "t5", noteLength: 20 }),
    call({ answered: true, disposition: null, talkSec: 999, autoClosed: true, phoneId: "p6", taskId: "t6" }),
  ];
  const k = agentKpi(calls, D);

  it("adet ve tekil sayılar", () => {
    expect(k.attempts).toBe(7);
    expect(k.uniqueNumbers).toBe(6);
    expect(k.tasksCalled).toBe(6);
  });
  it("otomatik kapatılan çağrı süre metriklerine girmez", () => {
    expect(k.talkSecTotal).toBe(220);
    expect(k.talkSecAvg).toBe(220 / 4);
  });
  it("ulaşma: yanlış kişi ulaşıldı sayılmaz; ret oranı ulaşılanlar içinde", () => {
    expect(k.reachRate).toBeCloseTo(3 / 7); // REACHED×2 + DNC
    expect(k.unreachRate).toBeCloseTo(2 / 7);
    expect(k.rejectRate).toBeCloseTo(1 / 3);
    expect(k.wrongPersonRate).toBeCloseTo(1 / 5);
  });
  it("eksik sonuç kodu ve eksik not oranları", () => {
    expect(k.missingDispositionRate).toBeCloseTo(1 / 7);
    expect(k.missingNoteRate).toBeCloseTo(1 / 3); // not zorunlu 3 çağrıdan 1'i kısa
  });
  it("payda 0 ise null", () => {
    const e = agentKpi([], D);
    expect(e.reachRate).toBeNull();
    expect(e.talkSecAvg).toBeNull();
  });
});

describe("callbackKpi", () => {
  const at = new Date("2026-11-07T10:00:00Z");
  it("zamanında = ±15 dk; iptal paydaya girmez", () => {
    const r = callbackKpi([
      { assigneeId: "a", scheduledAt: at, status: "DONE", firstAttemptAt: new Date("2026-11-07T10:10:00Z") },
      { assigneeId: "a", scheduledAt: at, status: "DONE", firstAttemptAt: new Date("2026-11-07T11:00:00Z") },
      { assigneeId: "a", scheduledAt: at, status: "PENDING", firstAttemptAt: null },
      { assigneeId: "a", scheduledAt: at, status: "CANCELLED", firstAttemptAt: null },
    ]);
    expect(r).toEqual({ total: 3, done: 2, completionRate: 2 / 3, onTimeRate: 1 / 3 });
  });
});

describe("percentiles", () => {
  it("medyan ve P95", () => {
    expect(percentiles([5, 1, 3, 2, 4])).toEqual({ median: 3, p95: 5 });
    expect(percentiles([])).toEqual({ median: null, p95: null });
  });
});
