/**
 * Operasyon ve finans anomali raporu — saf fonksiyonlar (Aşama 3).
 * Amaç veri kalitesi ve süreç kontrolüdür: bulgular İNCELEME içindir; misafir hedeflemesi, öncelik,
 * pazarlama segmenti veya personel puanı için kullanılmaz (plan v4 ürün sınırları).
 */

export interface ResultRow {
  id: string;
  tripGuestId: string;
  crmNo: number;
  playedOn: string; // yyyy-aa-gg
  netLoss: number; // kuruş
  source: string;
  sourceRef: string | null;
  enteredAt: Date;
}

export type FinanceFinding =
  | { kind: "NO_SOURCE_REF"; resultId: string; crmNo: number }
  | { kind: "DUPLICATE_DAY"; resultIds: string[]; crmNo: number; playedOn: string }
  | { kind: "OUTLIER"; resultId: string; crmNo: number; netLoss: number; median: number }
  | { kind: "LATE_ENTRY"; resultId: string; crmNo: number; days: number };

function median(xs: number[]) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

/**
 * - Kaynak referansı olmayan sonuç (docs/06 §5: incelemeye gönderilmeden önce tümünde olmalı)
 * - Aynı misafir + aynı gün için birden fazla sonuç (mükerrer giriş şüphesi)
 * - Mutlak tutarı dönem medyanının `outlierFactor` katından büyük sonuç (yazım hatası şüphesi; en az 5 sonuçta)
 * - Oyun tarihinden `lateDays` gün sonra girilen sonuç
 */
export function financeFindings(rows: ResultRow[], opts: { outlierFactor?: number; lateDays?: number } = {}): FinanceFinding[] {
  const out: FinanceFinding[] = [];
  const factor = opts.outlierFactor ?? 10;
  const late = opts.lateDays ?? 30;
  for (const r of rows) if (!r.sourceRef?.trim()) out.push({ kind: "NO_SOURCE_REF", resultId: r.id, crmNo: r.crmNo });
  const byDay = new Map<string, ResultRow[]>();
  for (const r of rows) byDay.set(`${r.tripGuestId}|${r.playedOn}`, [...(byDay.get(`${r.tripGuestId}|${r.playedOn}`) ?? []), r]);
  for (const list of byDay.values()) if (list.length > 1) out.push({ kind: "DUPLICATE_DAY", resultIds: list.map((r) => r.id), crmNo: list[0].crmNo, playedOn: list[0].playedOn });
  if (rows.length >= 5) {
    const med = median(rows.map((r) => Math.abs(r.netLoss)).filter((x) => x > 0));
    if (med > 0) for (const r of rows) if (Math.abs(r.netLoss) > med * factor) out.push({ kind: "OUTLIER", resultId: r.id, crmNo: r.crmNo, netLoss: r.netLoss, median: med });
  }
  for (const r of rows) {
    const days = Math.floor((r.enteredAt.getTime() - new Date(`${r.playedOn}T12:00:00+03:00`).getTime()) / 86_400_000);
    if (days > late) out.push({ kind: "LATE_ENTRY", resultId: r.id, crmNo: r.crmNo, days });
  }
  return out;
}

export interface CallDayRow {
  day: string;
  teamId: string | null;
  calls: number;
  reachedZeroTalk: number; // “ulaşıldı” ama konuşma 0 sn
  autoClosed: number;
  outsideShift: number; // yayınlanmış vardiya dışında başlatılan
}

export type OpsFinding = { kind: "REACHED_ZERO_TALK" | "AUTO_CLOSED" | "OUTSIDE_SHIFT"; day: string; teamId: string | null; count: number; rate: number };

/** Ekip+gün bazında süreç anomalileri (eşik oranı ve en az adet); kişi bazlı değil. */
export function opsFindings(rows: CallDayRow[], opts: { minCount?: number; rate?: number } = {}): OpsFinding[] {
  const min = opts.minCount ?? 3;
  const rate = opts.rate ?? 0.1;
  const out: OpsFinding[] = [];
  for (const r of rows) {
    if (!r.calls) continue;
    for (const [kind, n] of [["REACHED_ZERO_TALK", r.reachedZeroTalk], ["AUTO_CLOSED", r.autoClosed], ["OUTSIDE_SHIFT", r.outsideShift]] as const) {
      if (n >= min && n / r.calls >= rate) out.push({ kind, day: r.day, teamId: r.teamId, count: n, rate: n / r.calls });
    }
  }
  return out;
}
