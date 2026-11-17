/**
 * Kapasite planlama — saf fonksiyonlar (plan v4 Aşama 2 “kapasite planlama”).
 * Yöntem (bilinçli olarak basit ve açıklanabilir): geçmiş haftaların aynı gün+saatindeki çağrı denemesi ortalaması ×
 * ortalama işlem süresi (konuşma + çağrı sonrası + çalma) / hedef doluluk → saatlik gereken temsilci.
 * Erlang-C kullanılmaz: dış arama ağırlıklı bir çağrı merkezinde gelen çağrı kuyruğu varsayımı geçerli değildir.
 * Sonuç öneri niteliğindedir; çizelgeyi lider düzenler. Kişi bazlı performans kullanılmaz.
 */

export interface CallSample {
  startedAt: Date;
  handleSec: number; // çalma + konuşma + çağrı sonrası
}

/** Europe/Istanbul (UTC+3) gün-saat anahtarı: Pazartesi=0 … Pazar=6, saat 0–23. */
export function slotOf(d: Date): { dow: number; hour: number } {
  const t = new Date(d.getTime() + 3 * 3600_000);
  return { dow: (t.getUTCDay() + 6) % 7, hour: t.getUTCHours() };
}

export interface Forecast {
  calls: number[][]; // [dow][hour] haftalık ortalama deneme
  ahtSec: number; // ortalama işlem süresi
  weeks: number;
}

export function forecast(samples: CallSample[], weeks: number): Forecast {
  const calls = Array.from({ length: 7 }, () => Array(24).fill(0));
  let handle = 0;
  for (const s of samples) {
    const { dow, hour } = slotOf(s.startedAt);
    calls[dow][hour] += 1;
    handle += s.handleSec;
  }
  const w = Math.max(1, weeks);
  return {
    calls: calls.map((row) => row.map((n) => n / w)),
    ahtSec: samples.length ? handle / samples.length : 0,
    weeks: w,
  };
}

/** Saatlik iş yükü (temsilci-saat) / hedef doluluk, yukarı yuvarlanır. Çağrı yoksa 0. */
export function requiredAgents(callsPerHour: number, ahtSec: number, occupancy = 0.8): number {
  if (callsPerHour <= 0 || ahtSec <= 0) return 0;
  const occ = Math.min(0.95, Math.max(0.5, occupancy));
  return Math.ceil((callsPerHour * ahtSec) / 3600 / occ);
}

export interface CapacityCell {
  dow: number;
  hour: number;
  forecastCalls: number;
  required: number;
  planned: number;
  gap: number; // planned − required (negatif = eksik)
}

export function capacityGrid(f: Forecast, planned: number[][], occupancy = 0.8): CapacityCell[] {
  const out: CapacityCell[] = [];
  for (let dow = 0; dow < 7; dow++) {
    for (let hour = 0; hour < 24; hour++) {
      const required = requiredAgents(f.calls[dow][hour], f.ahtSec, occupancy);
      const p = planned[dow]?.[hour] ?? 0;
      out.push({ dow, hour, forecastCalls: Number(f.calls[dow][hour].toFixed(1)), required, planned: p, gap: p - required });
    }
  }
  return out;
}

/** Saatlik kova (bugün, İstanbul saati) — canlı pano için. */
export function hourlyBuckets(dates: Date[]): number[] {
  const out = Array(24).fill(0);
  for (const d of dates) out[slotOf(d).hour] += 1;
  return out;
}
