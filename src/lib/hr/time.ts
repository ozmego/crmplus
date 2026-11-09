/**
 * Europe/Istanbul takvim günü yardımcıları. Türkiye 2016'dan beri sabit UTC+3 kullanır (yaz saati yok).
 * Tarihler "YYYY-MM-DD" dizgisi olarak taşınır; DB'de @db.Date (UTC gece yarısı) olarak saklanır.
 */
export const TZ_OFFSET_MIN = 180;

export function istDate(d: Date): string {
  return new Date(d.getTime() + TZ_OFFSET_MIN * 60_000).toISOString().slice(0, 10);
}

/** Gün başlangıcı + dakika → mutlak an. Dakika 1440'ı aşabilir (ertesi güne devreden vardiya). */
export function atMinute(date: string, minute: number): Date {
  return new Date(Date.parse(`${date}T00:00:00+03:00`) + minute * 60_000);
}

export function addDays(date: string, n: number): string {
  const t = Date.parse(`${date}T00:00:00Z`) + n * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** Pazartesi = 0 … Pazar = 6 */
export function weekday(date: string): number {
  return (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
}

export function weekStartOf(date: string): string {
  return addDays(date, -weekday(date));
}

export function daysOfWeek(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

export function daysOfMonth(month: string): string[] {
  const [y, m] = month.split("-").map(Number);
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
}

/** @db.Date alanı için: "YYYY-MM-DD" → UTC gece yarısı Date */
export const dbDate = (date: string) => new Date(`${date}T00:00:00Z`);
export const fromDbDate = (d: Date) => d.toISOString().slice(0, 10);

export const minutesBetween = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 60_000);

export function fmtMin(min: number): string {
  const s = min < 0 ? "-" : "";
  const m = Math.abs(min);
  return `${s}${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
}

export const hhmm = (minute: number) => fmtMin(((minute % 1440) + 1440) % 1440);

export function parseHhmm(s: string): number | null {
  const m = /^(\d{1,2})[:.](\d{2})$/.exec(s.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (h > 23 || mm > 59) return null;
  return h * 60 + mm;
}
