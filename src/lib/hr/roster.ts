/**
 * Vardiya çizelgesi kuralları — yayınlamadan önce uyarı (plan v4 “Vardiya çizelgesi kuralları”, docs/11 §6).
 * Kurallar engellemez; ihlal gerekçesiyle yayınlanabilir.
 */
import { addDays, atMinute, minutesBetween } from "./time";
import type { PlanKind } from "./attendance";

export interface Cell {
  employeeId: string;
  date: string;
  kind: PlanKind;
  startMin?: number | null;
  endMin?: number | null;
  breakMin?: number | null;
}
export interface RosterEmployee {
  id: string;
  name: string;
  weeklyHours: number;
  department: string;
}
export interface ApprovedLeave {
  employeeId: string;
  from: string;
  to: string;
}

export type RuleCode = "REST_LT_11H" | "NO_WEEKLY_24H" | "OVER_CONTRACT" | "LEAVE_CONFLICT" | "COVERAGE_LOW" | "MISSING_TIMES";
export interface Warning {
  code: RuleCode;
  employeeId?: string;
  date?: string;
  hour?: number;
  message: string;
}

const WORKING: PlanKind[] = ["WORK", "TRAINING", "FIELD"];

function span(c: Cell) {
  if (!WORKING.includes(c.kind) || c.startMin == null || c.endMin == null) return null;
  const end = c.endMin <= c.startMin ? c.endMin + 1440 : c.endMin;
  return { start: atMinute(c.date, c.startMin), end: atMinute(c.date, end), netMin: end - c.startMin - (c.breakMin ?? 0) };
}

/**
 * @param prevWeekLast önceki haftanın son günündeki hücreler (dinlenme kontrolü için)
 * @param coverageTarget çağrı merkezi için saat başına hedef temsilci sayısı (0 = kontrol yok)
 */
export function checkRoster(args: {
  weekStart: string;
  employees: RosterEmployee[];
  cells: Cell[];
  leaves: ApprovedLeave[];
  prevWeekLast?: Cell[];
  coverageTarget?: number;
  coverageHours?: [number, number]; // [başlangıç, bitiş) saat — vars. 9–21
}): { warnings: Warning[]; coverage: { date: string; hours: number[] }[] } {
  const warnings: Warning[] = [];
  const days = Array.from({ length: 7 }, (_, i) => addDays(args.weekStart, i));
  const weekEnd = atMinute(addDays(args.weekStart, 7), 0);
  const weekBegin = atMinute(args.weekStart, 0);

  for (const e of args.employees) {
    const mine = args.cells.filter((c) => c.employeeId === e.id).sort((a, b) => a.date.localeCompare(b.date));
    const spans = [...(args.prevWeekLast ?? []).filter((c) => c.employeeId === e.id), ...mine].map((c) => ({ c, s: span(c) })).filter((x) => x.s);

    for (const c of mine) {
      if (WORKING.includes(c.kind) && (c.startMin == null || c.endMin == null)) {
        warnings.push({ code: "MISSING_TIMES", employeeId: e.id, date: c.date, message: `${e.name} · ${c.date}: vardiya saati girilmemiş` });
      }
      const onLeave = args.leaves.some((l) => l.employeeId === e.id && l.from <= c.date && c.date <= l.to);
      if (onLeave && WORKING.includes(c.kind)) {
        warnings.push({ code: "LEAVE_CONFLICT", employeeId: e.id, date: c.date, message: `${e.name} · ${c.date}: onaylı izinle çakışan vardiya` });
      }
    }

    // Günlük dinlenme < 11 saat
    for (let k = 1; k < spans.length; k++) {
      const rest = minutesBetween(spans[k - 1].s!.end, spans[k].s!.start);
      if (rest < 11 * 60 && spans[k].s!.start >= weekBegin) {
        warnings.push({ code: "REST_LT_11H", employeeId: e.id, date: spans[k].c.date, message: `${e.name} · ${spans[k].c.date}: iki vardiya arası dinlenme ${Math.floor(rest / 60)} saat (< 11)` });
      }
    }

    // Haftalık 24 saat kesintisiz tatil
    const weekSpans = spans.filter((x) => x.s!.end > weekBegin && x.s!.start < weekEnd).map((x) => x.s!);
    let cursor = weekBegin;
    let longest = 0;
    for (const s of weekSpans) {
      longest = Math.max(longest, minutesBetween(cursor, s.start));
      if (s.end > cursor) cursor = s.end;
    }
    longest = Math.max(longest, minutesBetween(cursor, weekEnd));
    if (longest < 24 * 60) {
      warnings.push({ code: "NO_WEEKLY_24H", employeeId: e.id, message: `${e.name}: haftada 24 saat kesintisiz tatil yok` });
    }

    // Sözleşme saati
    const planned = mine.map(span).filter(Boolean).reduce((s, x) => s + x!.netMin, 0);
    if (planned > e.weeklyHours * 60) {
      warnings.push({ code: "OVER_CONTRACT", employeeId: e.id, message: `${e.name}: haftalık plan ${(planned / 60).toFixed(1)} saat > sözleşme ${e.weeklyHours} saat` });
    }
  }

  // Saatlik kapsama (yalnız çağrı merkezi)
  const [h0, h1] = args.coverageHours ?? [9, 21];
  const cc = new Set(args.employees.filter((e) => e.department === "CALL_CENTER").map((e) => e.id));
  const coverage = days.map((date) => {
    const hours = Array.from({ length: 24 }, (_, h) => {
      const t0 = atMinute(date, h * 60);
      const t1 = atMinute(date, h * 60 + 60);
      return args.cells.filter((c) => cc.has(c.employeeId) && c.kind === "WORK").map(span).filter((s) => s && s.start < t1 && s.end > t0).length;
    });
    return { date, hours };
  });
  if (args.coverageTarget && cc.size) {
    for (const d of coverage) {
      const low = d.hours.map((n, h) => ({ n, h })).filter(({ n, h }) => h >= h0 && h < h1 && n < args.coverageTarget!);
      if (low.length) {
        warnings.push({ code: "COVERAGE_LOW", date: d.date, hour: low[0].h, message: `${d.date}: ${low.map((x) => `${String(x.h).padStart(2, "0")}:00`).join(", ")} saatlerinde hedef ${args.coverageTarget} temsilcinin altında` });
      }
    }
  }
  return { warnings, coverage };
}
