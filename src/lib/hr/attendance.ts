/**
 * Puantaj hesaplama — saf fonksiyonlar (plan v4 “Puantaj hesaplama”, docs/11 §3, §6).
 * Kaynak olaylar: oturum açma, çağrı merkezi durumları, saha check-in/out. Çağrı içeriği veya performansla birleşmez.
 */
import { atMinute, minutesBetween } from "./time";

export type EventType = "LOGIN" | "ACTIVITY" | "READY" | "BREAK" | "ON_CALL" | "WRAP_UP" | "OFFLINE" | "LOGOUT" | "CHECK_IN" | "CHECK_OUT";
export interface WorkEvent {
  at: Date;
  type: EventType;
}

export type PlanKind = "WORK" | "OFF" | "LEAVE" | "TRAINING" | "FIELD";
export interface DayPlan {
  kind: PlanKind;
  startMin?: number | null;
  endMin?: number | null; // startMin'den küçükse ertesi güne devreder
  breakMin?: number | null;
}

export type LeaveCode = "İ" | "R" | "Ü" | "M" | "İD";
export interface DayInput {
  date: string;
  plan: DayPlan | null;
  events: WorkEvent[];
  leave?: { code: LeaveCode; halfDay: boolean } | null;
  holiday?: { name: string; halfDay: boolean } | null;
  /** Önceki günün (gece devreden) vardiya penceresinin bittiği an: bundan önceki olaylar bu güne yazılmaz. */
  claimedUntil?: Date | null;
  toleranceMin?: number; // geç kalma / erken çıkış toleransı (vars. 10)
  windowMin?: number; // vardiya ±pencere (vars. 120)
}

export type Flag =
  | "OUT_OF_PLAN_ACTIVITY" // pencere dışında tekil etkinlik, sayılmadı
  | "LEAVE_CONFLICT" // izinliyken etkinlik → inceleme
  | "ABSENT_SUGGESTED" // planlı gün, etkinlik yok → yönetici onayı olmadan kesinleşmez
  | "UNPLANNED_WORK" // plansız / tatil gününde çalışma
  | "OVER_11H" // günlük 11 saat üstü
  | "SINGLE_EVENT"; // tek olay: süre hesaplanamadı

export interface DayResult {
  planStart: Date | null;
  planEnd: Date | null;
  firstIn: Date | null;
  lastOut: Date | null;
  workedMin: number;
  breakMin: number;
  lateMin: number;
  earlyMin: number;
  holidayWorkMin: number;
  code: string;
  source: "SYSTEM" | "FIELD";
  flags: Flag[];
  windowEnd: Date | null;
}

const OUT_TYPES: EventType[] = ["OFFLINE", "LOGOUT", "CHECK_OUT"];

export function planWindow(date: string, plan: DayPlan | null): { start: Date; end: Date } | null {
  if (!plan || plan.startMin == null || plan.endMin == null) return null;
  if (!["WORK", "TRAINING", "FIELD"].includes(plan.kind)) return null;
  const endMin = plan.endMin <= plan.startMin ? plan.endMin + 1440 : plan.endMin;
  return { start: atMinute(date, plan.startMin), end: atMinute(date, endMin) };
}

/** Mola: BREAK olayından sonraki ilk BREAK olmayan olaya kadar geçen süreler toplamı. */
export function breakMinutes(events: WorkEvent[]): number {
  let total = 0;
  let since: Date | null = null;
  for (const e of events) {
    if (e.type === "BREAK") since ??= e.at;
    else if (since) {
      total += minutesBetween(since, e.at);
      since = null;
    }
  }
  return total;
}

/** Giriş/çıkış ve plana göre türetilen süreler (düzeltme sonrasında da kullanılır). */
export function deriveTimes(a: {
  firstIn: Date | null; lastOut: Date | null; breakMin: number; planStart: Date | null; planEnd: Date | null; toleranceMin?: number;
}) {
  const tol = a.toleranceMin ?? 10;
  if (!a.firstIn || !a.lastOut || a.lastOut <= a.firstIn) return { workedMin: 0, lateMin: 0, earlyMin: 0 };
  const workedMin = Math.max(0, minutesBetween(a.firstIn, a.lastOut) - a.breakMin);
  const late = a.planStart ? minutesBetween(a.planStart, a.firstIn) : 0;
  const early = a.planEnd ? minutesBetween(a.lastOut, a.planEnd) : 0;
  return { workedMin, lateMin: late > tol ? late : 0, earlyMin: early > tol ? early : 0 };
}

export function computeDay(i: DayInput): DayResult {
  const win = i.windowMin ?? 120;
  const flags: Flag[] = [];
  const pw = planWindow(i.date, i.plan);
  const dayStart = atMinute(i.date, 0);
  const dayEnd = atMinute(i.date, 1440);

  // Bu güne ait olaylar: plan penceresi ±win; plansız günde takvim günü
  const from = pw ? new Date(pw.start.getTime() - win * 60_000) : dayStart;
  const to = pw ? new Date(pw.end.getTime() + win * 60_000) : dayEnd;
  const lower = i.claimedUntil && i.claimedUntil > from ? i.claimedUntil : from;
  const sorted = [...i.events].sort((a, b) => a.at.getTime() - b.at.getTime());
  const inside = sorted.filter((e) => e.at >= lower && e.at < to);
  const outsideSameDay = sorted.filter((e) => (e.at < lower || e.at >= to) && e.at >= dayStart && e.at < dayEnd && (!i.claimedUntil || e.at >= i.claimedUntil));
  if (outsideSameDay.length) flags.push("OUT_OF_PLAN_ACTIVITY");

  const isField = inside.some((e) => e.type === "CHECK_IN" || e.type === "CHECK_OUT");
  const ins = inside.filter((e) => !OUT_TYPES.includes(e.type));
  const firstIn = ins[0]?.at ?? null;
  const lastOut = inside.length ? inside[inside.length - 1].at : null;
  if (inside.length === 1) flags.push("SINGLE_EVENT");

  const actualBreak = breakMinutes(inside);
  const planned = i.plan?.breakMin ?? 0;
  const spanMin = firstIn && lastOut ? minutesBetween(firstIn, lastOut) : 0;
  // Planlanan mola, çalışma 4 saati geçtiyse en az o kadar düşülür (yasal ara dinlenmesi; docs/11 §6)
  const breakMin = spanMin > 240 ? Math.max(actualBreak, planned) : actualBreak;
  const t = deriveTimes({ firstIn, lastOut, breakMin, planStart: pw?.start ?? null, planEnd: pw?.end ?? null, toleranceMin: i.toleranceMin });
  if (t.workedMin > 11 * 60) flags.push("OVER_11H");

  let code = "";
  let holidayWorkMin = 0;
  const worked = t.workedMin > 0;
  if (i.leave) {
    code = i.leave.halfDay ? "Y" : i.leave.code;
    if (worked && !i.leave.halfDay) flags.push("LEAVE_CONFLICT");
  } else if (i.holiday && !i.holiday.halfDay) {
    code = worked ? "RTÇ" : "RT";
    if (worked) holidayWorkMin = t.workedMin;
  } else if (i.plan?.kind === "TRAINING") {
    code = "E";
  } else if (i.plan?.kind === "FIELD") {
    code = worked || !pw ? "S" : "D";
    if (!worked && pw) flags.push("ABSENT_SUGGESTED");
  } else if (i.plan?.kind === "WORK") {
    if (worked) code = i.holiday?.halfDay ? "Y" : "Ç";
    else {
      code = "D";
      flags.push("ABSENT_SUGGESTED");
    }
  } else if (i.plan?.kind === "OFF" || !i.plan) {
    if (worked) {
      code = "Ç";
      flags.push("UNPLANNED_WORK");
    } else code = i.plan?.kind === "OFF" ? "HT" : "";
  } else if (i.plan?.kind === "LEAVE") {
    code = worked ? "Ç" : "İ";
    if (worked) flags.push("LEAVE_CONFLICT");
  }

  return {
    planStart: pw?.start ?? null,
    planEnd: pw?.end ?? null,
    firstIn,
    lastOut,
    workedMin: t.workedMin,
    breakMin,
    lateMin: t.lateMin,
    earlyMin: t.earlyMin,
    holidayWorkMin,
    code,
    source: isField ? "FIELD" : "SYSTEM",
    flags: [...new Set(flags)],
    windowEnd: pw ? to : null,
  };
}

/**
 * Haftalık fazla mesai: hafta (Pzt–Paz) içinde resmi tatil dışı çalışma, sözleşme saatini aşarsa aşan kısım.
 * Fazla dakika haftanın son çalışılan günlerine (geriye doğru) yazılır. ⚖️ md. 41 — denkleştirme Aşama 2.
 */
export function weeklyOvertime(days: { date: string; workedMin: number; holidayWorkMin: number }[], weeklyHours: number): Map<string, number> {
  const out = new Map<string, number>();
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const regular = sorted.map((d) => Math.max(0, d.workedMin - d.holidayWorkMin));
  let excess = regular.reduce((s, m) => s + m, 0) - weeklyHours * 60;
  for (let k = sorted.length - 1; k >= 0 && excess > 0; k--) {
    const take = Math.min(excess, regular[k]);
    if (take > 0) out.set(sorted[k].date, take);
    excess -= take;
  }
  return out;
}

export interface MonthTotals {
  workedDays: number;
  workedMin: number;
  overtimeMin: number;
  holidayWorkMin: number;
  byCode: Record<string, number>;
}

export function monthTotals(days: { code: string; workedMin: number; overtimeMin: number; holidayWorkMin: number }[]): MonthTotals {
  const byCode: Record<string, number> = {};
  let workedDays = 0;
  for (const d of days) {
    if (!d.code) continue;
    byCode[d.code] = (byCode[d.code] ?? 0) + (d.code === "Y" ? 0.5 : 1);
    if (["Ç", "RTÇ", "S", "E"].includes(d.code)) workedDays += 1;
    if (d.code === "Y") workedDays += 0.5;
  }
  return {
    workedDays,
    workedMin: days.reduce((s, d) => s + d.workedMin, 0),
    overtimeMin: days.reduce((s, d) => s + d.overtimeMin, 0),
    holidayWorkMin: days.reduce((s, d) => s + d.holidayWorkMin, 0),
    byCode,
  };
}

export const DAY_CODES: Record<string, string> = {
  Ç: "Çalıştı", Y: "Yarım gün", İ: "Yıllık izin", R: "Raporlu", Ü: "Ücretsiz izin", M: "Mazeret izni", İD: "İdari izin",
  HT: "Hafta tatili", RT: "Resmi tatil", RTÇ: "Resmi tatilde çalıştı", D: "Devamsız (öneri)", E: "Eğitim", S: "Saha",
};

export const FLAG_LABEL: Record<Flag, string> = {
  OUT_OF_PLAN_ACTIVITY: "Plan dışı etkinlik (sayılmadı)",
  LEAVE_CONFLICT: "İzinliyken etkinlik — inceleme",
  ABSENT_SUGGESTED: "Devamsızlık önerisi — yönetici onayı gerekir",
  UNPLANNED_WORK: "Plansız çalışma",
  OVER_11H: "Günlük 11 saat üstü",
  SINGLE_EVENT: "Tek olay — süre hesaplanamadı",
};
