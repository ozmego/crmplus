import { z } from "zod";

/**
 * Finans kuralları — docs/06. Saf: doğrulama ve durum geçişleri.
 * Aşama 1: kurallar kayıt altına alınır, komisyon tutarı elle girilir; otomatik hesap Aşama 3'te.
 */

export const tierSchema = z
  .object({
    from: z.number().min(0),
    to: z.number().positive().nullable(), // null = üst sınır yok
    rate: z.number().min(0).max(1).optional(), // 0.10 = %10
    amount: z.number().min(0).optional(), // sabit tutar
  })
  .refine((t) => (t.rate === undefined) !== (t.amount === undefined), "Kademe ya oran ya tutar içermeli")
  .refine((t) => t.to === null || t.to > t.from, "Kademe üst sınırı alt sınırdan büyük olmalı");

export const ruleSchema = z.object({
  name: z.string().trim().min(1).max(80),
  basis: z.enum(["NET_LOSS", "ROLLING", "GUEST_COUNT", "TRIP_COUNT"]),
  scope: z.enum(["PER_GUEST", "PER_TRIP", "PERIOD_TOTAL"]),
  tierMode: z.enum(["MARGINAL", "WHOLE"]),
  tiers: z.array(tierSchema).min(1),
  min: z.number().min(0).nullable().default(null),
  max: z.number().min(0).nullable().default(null),
  currency: z.string().regex(/^[A-Z]{3}$/),
  priority: z.number().int().min(1).default(1),
  netWinBehavior: z.enum(["ZERO", "CARRY_OVER", "NEGATIVE"]),
  condition: z.string().max(200).optional(), // serbest açıklama (hesaba girmez); hesap `filter` ile yapılır
  // Aşama 3: nitelikli misafir filtresi — ülke / iş ortağı bazlı kurallar (docs/06 §4)
  filter: z
    .object({
      countries: z.array(z.string().regex(/^[A-Z]{2}$/, "Ülke kodu iki büyük harf (ör. TR, DE)")).max(50).optional(),
      minRollingPerGuest: z.number().min(0).optional(),
      minNetLossPerGuest: z.number().min(0).optional(),
    })
    .strict()
    .optional(),
});

export const contractVersionSchema = z
  .object({
    validFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    validTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    combine: z.enum(["SUM", "MAX", "PRIORITY"]),
    rules: z.array(ruleSchema).min(1),
    note: z.string().max(500).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.validTo && v.validTo < v.validFrom) ctx.addIssue({ code: "custom", message: "Bitiş tarihi başlangıçtan önce olamaz" });
    for (const [i, r] of v.rules.entries()) {
      const sorted = [...r.tiers].sort((a, b) => a.from - b.from);
      for (let k = 1; k < sorted.length; k++) {
        const prev = sorted[k - 1];
        if (prev.to === null || prev.to > sorted[k].from) ctx.addIssue({ code: "custom", message: `Kural ${i + 1}: kademeler çakışıyor` });
      }
      if (r.min !== null && r.max !== null && r.min > r.max) ctx.addIssue({ code: "custom", message: `Kural ${i + 1}: taban tavandan büyük` });
    }
  });

export type ContractVersionInput = z.infer<typeof contractVersionSchema>;

export type CalcStatus = "DRAFT" | "IN_REVIEW" | "APPROVED" | "RECONCILED" | "CANCELLED";
export type CalcAction = "SUBMIT" | "APPROVE" | "REJECT" | "RECONCILE" | "CANCEL";

const TRANSITIONS: Record<CalcAction, { from: CalcStatus[]; to: CalcStatus }> = {
  SUBMIT: { from: ["DRAFT"], to: "IN_REVIEW" },
  APPROVE: { from: ["IN_REVIEW"], to: "APPROVED" },
  REJECT: { from: ["IN_REVIEW"], to: "DRAFT" },
  RECONCILE: { from: ["APPROVED"], to: "RECONCILED" },
  CANCEL: { from: ["DRAFT", "IN_REVIEW"], to: "CANCELLED" },
};

export type TransitionError = "BAD_STATE" | "SAME_PERSON" | "PERIOD_LOCKED" | "REASON_REQUIRED" | "STATEMENT_REQUIRED";

/** Durum geçişi kontrolü: hazırlayan onaylayamaz/reddedemez; kilitli dönemde hesap değişmez. */
export function checkTransition(
  calc: { status: CalcStatus; preparedBy: string },
  action: CalcAction,
  ctx: { actorId: string; periodLocked: boolean; reason?: string; statementRef?: string },
): { ok: true; to: CalcStatus } | { ok: false; error: TransitionError } {
  const t = TRANSITIONS[action];
  if (!t.from.includes(calc.status)) return { ok: false, error: "BAD_STATE" };
  if (ctx.periodLocked) return { ok: false, error: "PERIOD_LOCKED" };
  if ((action === "APPROVE" || action === "REJECT") && ctx.actorId === calc.preparedBy) return { ok: false, error: "SAME_PERSON" };
  if ((action === "REJECT" || action === "CANCEL") && !(ctx.reason && ctx.reason.trim().length >= 5)) return { ok: false, error: "REASON_REQUIRED" };
  if (action === "RECONCILE" && !ctx.statementRef?.trim()) return { ok: false, error: "STATEMENT_REQUIRED" };
  return { ok: true, to: t.to };
}

/** Dönem kilidi: tüm hesaplamalar sonuçlanmış olmalı (onaylı, mutabık veya iptal). */
export function canLockPeriod(calcStatuses: CalcStatus[]): { ok: true } | { ok: false; error: "OPEN_CALCULATIONS" | "NO_CALCULATION" } {
  if (!calcStatuses.some((s) => s === "APPROVED" || s === "RECONCILED")) return { ok: false, error: "NO_CALCULATION" };
  if (calcStatuses.some((s) => s === "DRAFT" || s === "IN_REVIEW")) return { ok: false, error: "OPEN_CALCULATIONS" };
  return { ok: true };
}

/** "2026-11" — sonucun ait olduğu dönem, İstanbul saatine göre. */
export function periodOf(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit" }).format(d).slice(0, 7);
}

export function nextPeriod(p: string): string {
  const [y, m] = p.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}
