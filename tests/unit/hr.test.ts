import { describe, expect, it } from "vitest";
import { computeDay, monthTotals, weeklyOvertime, type WorkEvent } from "@/lib/hr/attendance";
import { checkRoster } from "@/lib/hr/roster";
import { annualEntitlement, leaveDays } from "@/lib/hr/leave";
import { addDays, atMinute, daysOfMonth, weekStartOf } from "@/lib/hr/time";

const D = "2026-11-10"; // Salı
const at = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+03:00`);
const ev = (date: string, hhmm: string, type: WorkEvent["type"]): WorkEvent => ({ at: at(date, hhmm), type });
const WORK = { kind: "WORK" as const, startMin: 9 * 60, endMin: 18 * 60, breakMin: 60 };

describe("time", () => {
  it("hafta başı Pazartesi", () => expect(weekStartOf("2026-11-15")).toBe("2026-11-09"));
  it("ay günleri", () => expect(daysOfMonth("2026-02")).toHaveLength(28));
  it("gece yarısını aşan dakika ertesi güne düşer", () => expect(atMinute(D, 1500).toISOString()).toBe("2026-11-10T22:00:00.000Z"));
});

describe("computeDay", () => {
  it("normal gün: mola düşülür, geç kalma toleransı içinde", () => {
    const r = computeDay({
      date: D, plan: WORK,
      events: [ev(D, "09:08", "LOGIN"), ev(D, "09:09", "READY"), ev(D, "12:30", "BREAK"), ev(D, "13:30", "READY"), ev(D, "18:02", "OFFLINE")],
    });
    expect(r.code).toBe("Ç");
    expect(r.breakMin).toBe(60);
    expect(r.workedMin).toBe(534 - 60); // 09:08–18:02 = 534 dk − 60 mola
    expect(r.lateMin).toBe(0);
    expect(r.flags).toEqual([]);
  });

  it("tolerans aşılırsa geç kalma tam süreyle yazılır; kısa mola planlanan molaya tamamlanır", () => {
    const r = computeDay({ date: D, plan: WORK, events: [ev(D, "09:25", "READY"), ev(D, "12:00", "BREAK"), ev(D, "12:20", "READY"), ev(D, "17:30", "OFFLINE")] });
    expect(r.lateMin).toBe(25);
    expect(r.earlyMin).toBe(30);
    expect(r.breakMin).toBe(60);
  });

  it("gece devreden vardiya başladığı güne yazılır", () => {
    const night = { kind: "WORK" as const, startMin: 22 * 60, endMin: 6 * 60, breakMin: 30 };
    const next = addDays(D, 1);
    const r = computeDay({ date: D, plan: night, events: [ev(D, "21:55", "READY"), ev(next, "06:05", "OFFLINE")] });
    expect(r.code).toBe("Ç");
    expect(r.workedMin).toBe(8 * 60 + 10 - 30);
    // Ertesi gün bu vardiyanın olaylarını tekrar saymaz
    const r2 = computeDay({ date: next, plan: null, events: [ev(next, "06:05", "OFFLINE")], claimedUntil: r.windowEnd });
    expect(r2.workedMin).toBe(0);
    expect(r2.flags).not.toContain("OUT_OF_PLAN_ACTIVITY");
  });

  it("vardiya dışı tekil etkinlik sayılmaz, işaretlenir", () => {
    const r = computeDay({ date: D, plan: WORK, events: [ev(D, "02:00", "LOGIN"), ev(D, "09:00", "READY"), ev(D, "18:00", "OFFLINE")] });
    expect(r.flags).toContain("OUT_OF_PLAN_ACTIVITY");
    expect(r.firstIn?.toISOString()).toBe(at(D, "09:00").toISOString());
  });

  it("planlı gün + etkinlik yok → devamsızlık önerisi (kesin değil)", () => {
    const r = computeDay({ date: D, plan: WORK, events: [] });
    expect(r.code).toBe("D");
    expect(r.flags).toContain("ABSENT_SUGGESTED");
  });

  it("onaylı izin sistem etkinliğinden önceliklidir; izinliyken giriş incelemeye düşer", () => {
    const r = computeDay({ date: D, plan: WORK, leave: { code: "İ", halfDay: false }, events: [ev(D, "10:00", "LOGIN"), ev(D, "10:30", "OFFLINE")] });
    expect(r.code).toBe("İ");
    expect(r.flags).toContain("LEAVE_CONFLICT");
  });

  it("resmi tatilde çalışma ayrı sayılır", () => {
    const r = computeDay({ date: "2026-10-29", plan: WORK, holiday: { name: "Cumhuriyet Bayramı", halfDay: false }, events: [ev("2026-10-29", "09:00", "READY"), ev("2026-10-29", "13:00", "OFFLINE")] });
    expect(r.code).toBe("RTÇ");
    expect(r.holidayWorkMin).toBe(240);
  });

  it("saha günü check-in/out ile hesaplanır", () => {
    const r = computeDay({ date: D, plan: { kind: "FIELD", startMin: 10 * 60, endMin: 17 * 60, breakMin: 0 }, events: [ev(D, "10:05", "CHECK_IN"), ev(D, "16:50", "CHECK_OUT")] });
    expect(r.code).toBe("S");
    expect(r.source).toBe("FIELD");
    expect(r.workedMin).toBe(405);
  });

  it("11 saat üstü uyarı", () => {
    const r = computeDay({ date: D, plan: { ...WORK, startMin: 8 * 60, endMin: 19 * 60 }, events: [ev(D, "07:30", "READY"), ev(D, "20:30", "OFFLINE")] });
    expect(r.flags).toContain("OVER_11H");
  });
});

describe("weeklyOvertime", () => {
  it("45 saati aşan kısım haftanın son günlerine yazılır; resmi tatil çalışması hariç", () => {
    const days = ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14"].map((date) => ({ date, workedMin: 8 * 60, holidayWorkMin: 0 }));
    const ot = weeklyOvertime(days, 45); // 48 saat → 3 saat fazla
    expect([...ot.entries()]).toEqual([["2026-11-14", 180]]);
    expect(weeklyOvertime([{ date: D, workedMin: 600, holidayWorkMin: 600 }], 0).size).toBe(0);
  });
});

describe("monthTotals", () => {
  it("gün kodları ve yarım gün", () => {
    const t = monthTotals([
      { code: "Ç", workedMin: 480, overtimeMin: 0, holidayWorkMin: 0 },
      { code: "Y", workedMin: 240, overtimeMin: 0, holidayWorkMin: 0 },
      { code: "İ", workedMin: 0, overtimeMin: 0, holidayWorkMin: 0 },
    ]);
    expect(t.workedDays).toBe(1.5);
    expect(t.byCode).toEqual({ Ç: 1, Y: 0.5, İ: 1 });
  });
});

describe("checkRoster", () => {
  const ws = "2026-11-09";
  const emp = { id: "e1", name: "Ayşe", weeklyHours: 45, department: "CALL_CENTER" };
  const day = (i: number, s: number, e: number, kind: "WORK" | "OFF" = "WORK") => ({ employeeId: "e1", date: addDays(ws, i), kind, startMin: s, endMin: e, breakMin: 60 });

  it("dinlenme < 11 saat, sözleşme aşımı, haftalık tatil yok", () => {
    const cells = [day(0, 14 * 60, 23 * 60), day(1, 7 * 60, 16 * 60), ...[2, 3, 4, 5, 6].map((i) => day(i, 9 * 60, 18 * 60))];
    const codes = checkRoster({ weekStart: ws, employees: [emp], cells, leaves: [] }).warnings.map((w) => w.code);
    expect(codes).toContain("REST_LT_11H");
    expect(codes).toContain("OVER_CONTRACT"); // 7 × 8 = 56 saat
    expect(codes).toContain("NO_WEEKLY_24H");
  });

  it("uygun hafta uyarı vermez; izin çakışması ve kapsama", () => {
    const cells = [0, 1, 2, 3, 4].map((i) => day(i, 9 * 60, 18 * 60)).concat([day(5, 0, 0, "OFF"), day(6, 0, 0, "OFF")]);
    expect(checkRoster({ weekStart: ws, employees: [emp], cells, leaves: [] }).warnings).toEqual([]);
    const r = checkRoster({ weekStart: ws, employees: [emp], cells, leaves: [{ employeeId: "e1", from: ws, to: ws }], coverageTarget: 2 });
    expect(r.warnings.map((w) => w.code)).toEqual(expect.arrayContaining(["LEAVE_CONFLICT", "COVERAGE_LOW"]));
    expect(r.coverage[0].hours[10]).toBe(1);
  });
});

describe("izin", () => {
  it("kıdeme göre yıllık izin", () => {
    expect(annualEntitlement("2026-01-15", "2026-11-10")).toBe(0);
    expect(annualEntitlement("2024-01-15", "2026-11-10")).toBe(14);
    expect(annualEntitlement("2019-11-10", "2026-11-10")).toBe(20);
    expect(annualEntitlement("2005-01-01", "2026-11-10")).toBe(26);
  });
  it("Pazar ve resmi tatil izin süresinden sayılmaz", () => {
    expect(leaveDays("2026-10-26", "2026-11-01", { holidays: new Set(["2026-10-29"]) })).toBe(5);
    expect(leaveDays(D, D, { halfDay: true })).toBe(0.5);
  });
});
