import { describe, expect, it } from "vitest";
import { planDisposition, type DispositionInput } from "@/lib/disposition";

const now = new Date("2026-11-07T10:00:00Z");
const base = (over: Partial<DispositionInput>): DispositionInput => ({
  code: "REACHED",
  now,
  attempts: 1,
  priorNoAnswer: 0,
  phoneConsecutiveFails: 0,
  note: "Aralık tripi için tarih teyidi istedi.",
  noteRequired: false,
  ...over,
});

const plan = (o: Partial<DispositionInput>) => {
  const r = planDisposition(base(o));
  if (!r.ok) throw new Error(r.error);
  return r.plan;
};

describe("planDisposition (docs/03)", () => {
  it("not zorunlu kodlarda kısa not reddedilir", () => {
    expect(planDisposition(base({ noteRequired: true, note: "kısa" }))).toEqual({ ok: false, error: "NOTE_REQUIRED" });
  });

  it("ulaşıldı: görev biter, telefon olumlu kanıt alır", () => {
    const p = plan({ code: "REACHED" });
    expect(p.task.status).toBe("DONE");
    expect(p.phone?.reachability).toBe("REACHED");
  });

  it("cevap yok: ilkinde +4 saat, sonrakinde +24 saat; 5. denemede tükenir", () => {
    expect(plan({ code: "NO_ANSWER" }).task.nextAttemptAt).toEqual(new Date("2026-11-07T14:00:00Z"));
    expect(plan({ code: "NO_ANSWER", priorNoAnswer: 1, attempts: 2 }).task.nextAttemptAt).toEqual(new Date("2026-11-08T10:00:00Z"));
    expect(plan({ code: "NO_ANSWER", attempts: 5 }).task.status).toBe("EXHAUSTED");
  });

  it("meşgul: +30 dk", () => {
    expect(plan({ code: "BUSY" }).task.nextAttemptAt).toEqual(new Date("2026-11-07T10:30:00Z"));
  });

  it("numara hatalı: ikinci kez olunca numara ulaşılamıyor ve görev bloklanır", () => {
    expect(plan({ code: "INVALID_NUMBER" }).phone?.reachability).toBe("UNREACHED");
    const p = plan({ code: "INVALID_NUMBER", phoneConsecutiveFails: 1 });
    expect(p.phone?.reachability).toBe("UNREACHABLE");
    expect(p.task.status).toBe("BLOCKED");
  });

  it("geri arama: zaman zorunlu ve gelecekte olmalı", () => {
    expect(planDisposition(base({ code: "CALLBACK_REQUESTED" }))).toEqual({ ok: false, error: "CALLBACK_TIME_REQUIRED" });
    expect(planDisposition(base({ code: "CALLBACK_REQUESTED", callbackAt: new Date("2026-11-07T09:00:00Z") }))).toEqual({
      ok: false,
      error: "CALLBACK_IN_PAST",
    });
    const at = new Date("2026-11-07T14:30:00Z");
    expect(plan({ code: "CALLBACK_REQUESTED", callbackAt: at }).createCallbackAt).toEqual(at);
  });

  it("iletişim istemiyor: durdurma kaydı ve görev iptali", () => {
    const p = plan({ code: "DO_NOT_CONTACT" });
    expect(p.block).toEqual({ allChannels: true });
    expect(p.task.status).toBe("CANCELLED");
  });

  it("yanlış kişi: numara tartışmalı, inceleme açılır", () => {
    const p = plan({ code: "WRONG_PERSON" });
    expect(p.phone?.ownership).toBe("DISPUTED");
    expect(p.review).toBe("DISPUTED_PHONE");
  });

  it("dil desteği: dil zorunlu, lidere yeniden atanır", () => {
    expect(planDisposition(base({ code: "LANGUAGE_SUPPORT" }))).toEqual({ ok: false, error: "LANGUAGE_REQUIRED" });
    const p = plan({ code: "LANGUAGE_SUPPORT", language: "ru" });
    expect(p.setLanguage).toBe("ru");
    expect(p.reassignToLead).toBe(true);
  });
});
