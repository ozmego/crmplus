/**
 * Yıllık izin hak edişi ve izin günü sayımı (docs/11 §6, ⚖️ İş Kanunu md. 53 — İK teyidi).
 */
import { addDays, weekday } from "./time";

/** Kıdem yılı tamamlandıkça hak edilen yıllık izin günü: 1–5 yıl 14, 5–15 yıl 20, 15+ yıl 26. */
export function annualEntitlement(hireDate: string, asOf: string): number {
  const years = completedYears(hireDate, asOf);
  if (years < 1) return 0;
  if (years < 5) return 14;
  if (years < 15) return 20;
  return 26;
}

export function completedYears(from: string, to: string): number {
  const [y1, m1, d1] = from.split("-").map(Number);
  const [y2, m2, d2] = to.split("-").map(Number);
  let y = y2 - y1;
  if (m2 < m1 || (m2 === m1 && d2 < d1)) y -= 1;
  return Math.max(0, y);
}

/**
 * İzin süresine sayılan gün: hafta tatili (varsayılan Pazar) ve resmi tatiller sayılmaz (md. 56). Yarım gün 0,5.
 */
export function leaveDays(from: string, to: string, opts: { holidays?: Set<string>; weeklyOff?: number[]; halfDay?: boolean } = {}): number {
  if (to < from) return 0;
  if (opts.halfDay) return 0.5;
  const off = new Set(opts.weeklyOff ?? [6]);
  let n = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) {
    if (off.has(weekday(d))) continue;
    if (opts.holidays?.has(d)) continue;
    n += 1;
  }
  return n;
}

/** Türkiye resmi tatilleri (yönetimden düzenlenebilir; dini bayramlar Diyanet takvimine göre teyit edilmeli). */
export const TR_HOLIDAYS: { date: string; name: string; halfDay?: boolean }[] = [
  { date: "2026-01-01", name: "Yılbaşı" },
  { date: "2026-03-19", name: "Ramazan Bayramı arifesi", halfDay: true },
  { date: "2026-03-20", name: "Ramazan Bayramı 1. gün" },
  { date: "2026-03-21", name: "Ramazan Bayramı 2. gün" },
  { date: "2026-03-22", name: "Ramazan Bayramı 3. gün" },
  { date: "2026-04-23", name: "Ulusal Egemenlik ve Çocuk Bayramı" },
  { date: "2026-05-01", name: "Emek ve Dayanışma Günü" },
  { date: "2026-05-19", name: "Atatürk'ü Anma, Gençlik ve Spor Bayramı" },
  { date: "2026-05-26", name: "Kurban Bayramı arifesi", halfDay: true },
  { date: "2026-05-27", name: "Kurban Bayramı 1. gün" },
  { date: "2026-05-28", name: "Kurban Bayramı 2. gün" },
  { date: "2026-05-29", name: "Kurban Bayramı 3. gün" },
  { date: "2026-05-30", name: "Kurban Bayramı 4. gün" },
  { date: "2026-07-15", name: "Demokrasi ve Milli Birlik Günü" },
  { date: "2026-08-30", name: "Zafer Bayramı" },
  { date: "2026-10-28", name: "Cumhuriyet Bayramı arifesi", halfDay: true },
  { date: "2026-10-29", name: "Cumhuriyet Bayramı" },
  { date: "2027-01-01", name: "Yılbaşı" },
  { date: "2027-03-08", name: "Ramazan Bayramı arifesi", halfDay: true },
  { date: "2027-03-09", name: "Ramazan Bayramı 1. gün" },
  { date: "2027-03-10", name: "Ramazan Bayramı 2. gün" },
  { date: "2027-03-11", name: "Ramazan Bayramı 3. gün" },
  { date: "2027-04-23", name: "Ulusal Egemenlik ve Çocuk Bayramı" },
  { date: "2027-05-01", name: "Emek ve Dayanışma Günü" },
  { date: "2027-05-15", name: "Kurban Bayramı arifesi", halfDay: true },
  { date: "2027-05-16", name: "Kurban Bayramı 1. gün" },
  { date: "2027-05-17", name: "Kurban Bayramı 2. gün" },
  { date: "2027-05-18", name: "Kurban Bayramı 3. gün" },
  { date: "2027-05-19", name: "Kurban Bayramı 4. gün / Gençlik ve Spor Bayramı" },
  { date: "2027-07-15", name: "Demokrasi ve Milli Birlik Günü" },
  { date: "2027-08-30", name: "Zafer Bayramı" },
  { date: "2027-10-28", name: "Cumhuriyet Bayramı arifesi", halfDay: true },
  { date: "2027-10-29", name: "Cumhuriyet Bayramı" },
];
