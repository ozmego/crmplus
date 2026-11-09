import { describe, expect, it } from "vitest";
import { canLockPeriod, checkTransition, contractVersionSchema, nextPeriod, periodOf } from "@/lib/finance";

const rule = {
  name: "Net kayıp kademeli",
  basis: "NET_LOSS",
  scope: "PERIOD_TOTAL",
  tierMode: "MARGINAL",
  tiers: [
    { from: 0, to: 1_000_000, rate: 0.1 },
    { from: 1_000_000, to: 5_000_000, rate: 0.12 },
    { from: 5_000_000, to: null, rate: 0.15 },
  ],
  min: null,
  max: null,
  currency: "TRY",
  priority: 1,
  netWinBehavior: "CARRY_OVER",
};

describe("contractVersionSchema (docs/06 §4)", () => {
  it("docs/06 örnek sözleşmesini kabul eder", () => {
    const r = contractVersionSchema.safeParse({
      validFrom: "2026-01-01", validTo: null, combine: "SUM",
      rules: [rule, { ...rule, name: "Misafir başı", basis: "GUEST_COUNT", scope: "PER_GUEST", tierMode: "WHOLE", tiers: [{ from: 0, to: null, amount: 5000 }] }],
    });
    expect(r.success).toBe(true);
  });
  it("çakışan kademe, oran+tutar birlikte ve ters tarih reddedilir", () => {
    expect(contractVersionSchema.safeParse({ validFrom: "2026-01-01", validTo: null, combine: "SUM", rules: [{ ...rule, tiers: [{ from: 0, to: 2, rate: 0.1 }, { from: 1, to: null, rate: 0.2 }] }] }).success).toBe(false);
    expect(contractVersionSchema.safeParse({ validFrom: "2026-01-01", validTo: null, combine: "SUM", rules: [{ ...rule, tiers: [{ from: 0, to: null, rate: 0.1, amount: 5 }] }] }).success).toBe(false);
    expect(contractVersionSchema.safeParse({ validFrom: "2026-05-01", validTo: "2026-01-01", combine: "SUM", rules: [rule] }).success).toBe(false);
  });
});

describe("checkTransition — iki kişili onay ve dönem kilidi", () => {
  const draft = { status: "DRAFT" as const, preparedBy: "u1" };
  const review = { status: "IN_REVIEW" as const, preparedBy: "u1" };
  const ctx = { actorId: "u2", periodLocked: false };

  it("taslak → incelemede → onaylandı → mutabık", () => {
    expect(checkTransition(draft, "SUBMIT", { ...ctx, actorId: "u1" })).toEqual({ ok: true, to: "IN_REVIEW" });
    expect(checkTransition(review, "APPROVE", ctx)).toEqual({ ok: true, to: "APPROVED" });
    expect(checkTransition({ status: "APPROVED", preparedBy: "u1" }, "RECONCILE", { ...ctx, statementRef: "EKS-2026-11" })).toEqual({ ok: true, to: "RECONCILED" });
  });
  it("hazırlayan onaylayamaz ve reddedemez", () => {
    expect(checkTransition(review, "APPROVE", { ...ctx, actorId: "u1" })).toEqual({ ok: false, error: "SAME_PERSON" });
    expect(checkTransition(review, "REJECT", { ...ctx, actorId: "u1", reason: "tutar hatalı" })).toEqual({ ok: false, error: "SAME_PERSON" });
  });
  it("kilitli dönemde geçiş yok; ret ve iptal gerekçe ister; mutabakat ekstre ister", () => {
    expect(checkTransition(review, "APPROVE", { ...ctx, periodLocked: true })).toEqual({ ok: false, error: "PERIOD_LOCKED" });
    expect(checkTransition(review, "REJECT", ctx)).toEqual({ ok: false, error: "REASON_REQUIRED" });
    expect(checkTransition({ status: "APPROVED", preparedBy: "u1" }, "RECONCILE", ctx)).toEqual({ ok: false, error: "STATEMENT_REQUIRED" });
  });
  it("onaylı hesap iptal edilemez (düzeltme kaydı gerekir)", () => {
    expect(checkTransition({ status: "APPROVED", preparedBy: "u1" }, "CANCEL", { ...ctx, reason: "yanlış dönem" })).toEqual({ ok: false, error: "BAD_STATE" });
  });
});

describe("canLockPeriod", () => {
  it("açık hesap varken veya hiç onaylı hesap yokken kilitlenmez", () => {
    expect(canLockPeriod(["APPROVED", "IN_REVIEW"])).toEqual({ ok: false, error: "OPEN_CALCULATIONS" });
    expect(canLockPeriod(["CANCELLED"])).toEqual({ ok: false, error: "NO_CALCULATION" });
    expect(canLockPeriod(["APPROVED", "CANCELLED"])).toEqual({ ok: true });
  });
});

describe("dönem yardımcıları", () => {
  it("İstanbul saatine göre ay; yıl devri", () => {
    expect(periodOf(new Date("2026-11-30T22:30:00Z"))).toBe("2026-12"); // İstanbul'da 1 Aralık 01:30
    expect(nextPeriod("2026-12")).toBe("2027-01");
  });
});
