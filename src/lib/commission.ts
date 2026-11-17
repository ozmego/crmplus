/**
 * Komisyon hesaplama motoru — saf fonksiyonlar (docs/06 §4, Aşama 3).
 * Para tutarları KURUŞ cinsinden tam sayıdır (kayan nokta hatası yok); oranlar 0–1.
 *
 * Kural bileşeni:
 *   basis   NET_LOSS | ROLLING (tutar) · GUEST_COUNT | TRIP_COUNT (adet)
 *   scope   PER_GUEST | PER_TRIP | PERIOD_TOTAL — hesap birimi
 *   tiers   {from, to|null, rate|amount}; tutar tabanlarında from/to TL, adet tabanlarında adet
 *   tierMode MARGINAL: her dilime kendi oranı · WHOLE: ulaşılan kademenin oranı tüm değere
 *     amount kademesi: adet tabanında “adet başı tutar”, tutar tabanında “kademeye ulaşınca sabit tutar”
 *   filter  {countries?, minRollingPerGuest?, minNetLossPerGuest?} — nitelikli misafir (ülke/iş ortağı bazlı kurallar)
 *   min/max bileşen toplamına taban/tavan
 *   netWinBehavior (yalnız NET_LOSS): ZERO → 0 · NEGATIVE → negatif komisyon · CARRY_OVER → kazanç sonraki döneme devreder
 * Sözleşme: combine SUM (topla) · MAX (en yüksek) · PRIORITY (öncelik sırasına göre ilk uygulanabilen)
 */

export interface EngineTier {
  from: number;
  to: number | null;
  rate?: number;
  amount?: number;
}
export interface EngineRule {
  name: string;
  basis: "NET_LOSS" | "ROLLING" | "GUEST_COUNT" | "TRIP_COUNT";
  scope: "PER_GUEST" | "PER_TRIP" | "PERIOD_TOTAL";
  tierMode: "MARGINAL" | "WHOLE";
  tiers: EngineTier[];
  min: number | null;
  max: number | null;
  currency: string;
  priority: number;
  netWinBehavior: "ZERO" | "CARRY_OVER" | "NEGATIVE";
  filter?: { countries?: string[]; minRollingPerGuest?: number; minNetLossPerGuest?: number };
}
export interface EngineVersion {
  versionId: string;
  label: string;
  combine: "SUM" | "MAX" | "PRIORITY";
  rules: EngineRule[];
}
export interface EngineResult {
  id: string;
  guestKey: string; // crmNo
  tripId: string;
  country: string | null;
  netLoss: number; // kuruş; + kayıp, − kazanç
  rolling: number; // kuruş
}

export const toKurus = (tl: number | string) => Math.round(Number(tl) * 100);
export const fromKurus = (k: number) => (k / 100).toFixed(2);
const tl = (k: number) => (k / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const isMoney = (b: EngineRule["basis"]) => b === "NET_LOSS" || b === "ROLLING";

/** Kademeleri tek bir değere uygular. Tutar tabanında değer kuruş, kademe sınırları TL. */
export function applyTiers(value: number, rule: Pick<EngineRule, "basis" | "tiers" | "tierMode">): { commission: number; lines: string[] } {
  const money = isMoney(rule.basis);
  const unit = money ? 100 : 1;
  const tiers = [...rule.tiers].sort((a, b) => a.from - b.from);
  const lines: string[] = [];
  const fmt = (v: number) => (money ? `${tl(v)} TL` : `${v}`);
  if (value <= 0) return { commission: 0, lines };

  if (rule.tierMode === "WHOLE") {
    const t = [...tiers].reverse().find((x) => value >= x.from * unit);
    if (!t) return { commission: 0, lines: [`${fmt(value)} hiçbir kademeye ulaşmadı`] };
    if (t.rate !== undefined) {
      const c = Math.round(value * t.rate);
      return { commission: c, lines: [`${fmt(value)} × %${(t.rate * 100).toLocaleString("tr-TR")} (ulaşılan kademe ${t.from}+) = ${tl(c)} TL`] };
    }
    const c = money ? Math.round((t.amount ?? 0) * 100) : Math.round(value * (t.amount ?? 0) * 100);
    return { commission: c, lines: [money ? `kademe ${t.from}+ sabit ${tl(c)} TL` : `${value} × ${tl((t.amount ?? 0) * 100)} TL = ${tl(c)} TL`] };
  }

  let total = 0;
  for (const t of tiers) {
    const lo = t.from * unit;
    const hi = t.to === null ? Infinity : t.to * unit;
    if (value <= lo) continue;
    const slice = Math.min(value, hi) - lo;
    let c: number;
    if (t.rate !== undefined) {
      c = Math.round(slice * t.rate);
      lines.push(`${fmt(slice)} × %${(t.rate * 100).toLocaleString("tr-TR")} = ${tl(c)} TL`);
    } else if (money) {
      c = Math.round((t.amount ?? 0) * 100);
      lines.push(`kademe ${t.from}–${t.to ?? "∞"} sabit ${tl(c)} TL`);
    } else {
      c = Math.round(slice * (t.amount ?? 0) * 100);
      lines.push(`${slice} × ${tl((t.amount ?? 0) * 100)} TL = ${tl(c)} TL`);
    }
    total += c;
  }
  return { commission: total, lines };
}

export interface RuleOutcome {
  rule: string;
  priority: number;
  qualifyingGuests: number;
  units: { key: string; value: number; commission: number; carryIn: number; carryOut: number; lines: string[] }[];
  subtotal: number;
  total: number; // taban/tavan sonrası
  capped: "MIN" | "MAX" | null;
  carryOut: Record<string, number>; // birim anahtarı → devreden (negatif) net
  applicable: boolean;
}

export interface VersionOutcome {
  versionId: string;
  label: string;
  combine: EngineVersion["combine"];
  rules: RuleOutcome[];
  total: number;
  chosen: string[]; // birleştirmede sayılan bileşenler
}

export interface EngineOutput {
  total: number;
  currency: string;
  versions: VersionOutcome[];
  warnings: string[];
  carryOut: Record<string, Record<string, number>>; // "versiyon:kural" → birim → devreden
  inputs: { results: number; guests: number; trips: number; netLoss: number; rolling: number };
}

/** Misafir bazında toplanıp filtre uygulanarak nitelikli misafirler bulunur. */
function qualifying(results: EngineResult[], f: EngineRule["filter"]): Set<string> {
  const byGuest = new Map<string, { netLoss: number; rolling: number; country: string | null }>();
  for (const r of results) {
    const g = byGuest.get(r.guestKey) ?? { netLoss: 0, rolling: 0, country: r.country };
    g.netLoss += r.netLoss;
    g.rolling += r.rolling;
    g.country ??= r.country;
    byGuest.set(r.guestKey, g);
  }
  const out = new Set<string>();
  for (const [k, g] of byGuest) {
    if (f?.countries?.length && !(g.country && f.countries.includes(g.country))) continue;
    if (f?.minRollingPerGuest !== undefined && g.rolling < f.minRollingPerGuest * 100) continue;
    if (f?.minNetLossPerGuest !== undefined && g.netLoss < f.minNetLossPerGuest * 100) continue;
    out.add(k);
  }
  return out;
}

export function evaluateRule(rule: EngineRule, results: EngineResult[], carryIn: Record<string, number> = {}): RuleOutcome {
  const q = qualifying(results, rule.filter);
  const rows = results.filter((r) => q.has(r.guestKey));
  const unitKey = (r: EngineResult) => (rule.scope === "PER_GUEST" ? r.guestKey : rule.scope === "PER_TRIP" ? r.tripId : "DONEM");
  const groups = new Map<string, EngineResult[]>();
  for (const r of rows) groups.set(unitKey(r), [...(groups.get(unitKey(r)) ?? []), r]);
  // Önceki dönemden devri olan ama bu dönem sonucu olmayan birim de taşınır
  if (rule.basis === "NET_LOSS" && rule.netWinBehavior === "CARRY_OVER") for (const k of Object.keys(carryIn)) if (!groups.has(k) && (rule.scope === "PERIOD_TOTAL" ? k === "DONEM" : true)) groups.set(k, []);

  const units: RuleOutcome["units"] = [];
  const carryOut: Record<string, number> = {};
  for (const [key, rs] of groups) {
    let value: number;
    if (rule.basis === "NET_LOSS") value = rs.reduce((s, r) => s + r.netLoss, 0);
    else if (rule.basis === "ROLLING") value = rs.reduce((s, r) => s + r.rolling, 0);
    else if (rule.basis === "GUEST_COUNT") value = new Set(rs.map((r) => r.guestKey)).size;
    else value = new Set(rs.map((r) => r.tripId)).size;

    const cin = rule.basis === "NET_LOSS" && rule.netWinBehavior === "CARRY_OVER" ? carryIn[key] ?? 0 : 0;
    const v = value + cin;
    let commission = 0;
    let cout = 0;
    let lines: string[] = [];
    if (cin) lines.push(`önceki dönemden devreden net kazanç ${tl(cin)} TL`);
    if (v < 0 && rule.basis === "NET_LOSS") {
      if (rule.netWinBehavior === "CARRY_OVER") {
        cout = v;
        lines.push(`net kazanç ${tl(v)} TL sonraki döneme devreder`);
      } else if (rule.netWinBehavior === "NEGATIVE") {
        const first = [...rule.tiers].sort((a, b) => a.from - b.from)[0];
        commission = first?.rate !== undefined ? Math.round(v * first.rate) : 0;
        lines.push(`net kazanç ${tl(v)} TL × ilk kademe oranı = ${tl(commission)} TL (negatif komisyon)`);
      } else {
        lines.push(`net kazanç ${tl(v)} TL → komisyon 0`);
      }
    } else {
      const a = applyTiers(v, rule);
      commission = a.commission;
      lines = [...lines, ...a.lines];
    }
    if (cout) carryOut[key] = cout;
    units.push({ key, value, commission, carryIn: cin, carryOut: cout, lines });
  }
  const subtotal = units.reduce((s, u) => s + u.commission, 0);
  let total = subtotal;
  let capped: RuleOutcome["capped"] = null;
  if (rule.min !== null && units.length && total < rule.min * 100) {
    total = Math.round(rule.min * 100);
    capped = "MIN";
  }
  if (rule.max !== null && total > rule.max * 100) {
    total = Math.round(rule.max * 100);
    capped = "MAX";
  }
  return { rule: rule.name, priority: rule.priority, qualifyingGuests: q.size, units, subtotal, total, capped, carryOut, applicable: q.size > 0 && units.some((u) => u.value !== 0 || u.carryIn !== 0) };
}

export function evaluateVersion(v: EngineVersion, results: EngineResult[], carryIn: Record<string, Record<string, number>> = {}): VersionOutcome {
  const rules = v.rules.map((r) => evaluateRule(r, results, carryIn[`${v.versionId}:${r.name}`]));
  let total = 0;
  let chosen: string[] = [];
  if (v.combine === "SUM") {
    total = rules.reduce((s, r) => s + r.total, 0);
    chosen = rules.map((r) => r.rule);
  } else if (v.combine === "MAX") {
    const best = rules.reduce<RuleOutcome | null>((b, r) => (!b || r.total > b.total ? r : b), null);
    total = best?.total ?? 0;
    chosen = best ? [best.rule] : [];
  } else {
    const first = [...rules].sort((a, b) => a.priority - b.priority).find((r) => r.applicable && r.total !== 0);
    total = first?.total ?? 0;
    chosen = first ? [first.rule] : [];
  }
  return { versionId: v.versionId, label: v.label, combine: v.combine, rules, total, chosen };
}

/**
 * Dönem hesabı: sonuçlar oynanma tarihine göre geçerli sözleşme sürümüne ayrılmış olarak gelir
 * (ay ortası sürüm değişikliği). Para birimi uyuşmayan kural hesaplanmaz, uyarı verilir.
 */
export function computeCommission(a: {
  currency: string;
  parts: { version: EngineVersion; results: EngineResult[] }[];
  carryIn?: Record<string, Record<string, number>>;
  unassigned?: number; // hiçbir sürüme düşmeyen sonuç sayısı
}): EngineOutput {
  const warnings: string[] = [];
  const versions: VersionOutcome[] = [];
  const carryOut: EngineOutput["carryOut"] = {};
  for (const p of a.parts) {
    const ok = p.version.rules.filter((r) => {
      if (r.currency !== a.currency) {
        warnings.push(`${p.version.label} · “${r.name}”: kural para birimi ${r.currency}, casino ${a.currency} — hesaplanmadı (kur dönüşümü yok).`);
        return false;
      }
      return true;
    });
    const out = evaluateVersion({ ...p.version, rules: ok }, p.results, a.carryIn);
    versions.push(out);
    for (const r of out.rules) if (Object.keys(r.carryOut).length) carryOut[`${p.version.versionId}:${r.rule}`] = r.carryOut;
  }
  if (a.unassigned) warnings.push(`${a.unassigned} sonuç hiçbir sözleşme sürümünün geçerlilik aralığına düşmüyor — hesaba katılmadı.`);
  const all = a.parts.flatMap((p) => p.results);
  return {
    total: versions.reduce((s, v) => s + v.total, 0),
    currency: a.currency,
    versions,
    warnings,
    carryOut,
    inputs: {
      results: all.length,
      guests: new Set(all.map((r) => r.guestKey)).size,
      trips: new Set(all.map((r) => r.tripId)).size,
      netLoss: all.reduce((s, r) => s + r.netLoss, 0),
      rolling: all.reduce((s, r) => s + r.rolling, 0),
    },
  };
}

/** Gölge mod karşılaştırması: elle girilen ile motor sonucu arasındaki fark (kuruş) ve yüzde. */
export function shadowDiff(manual: number, engine: number) {
  const diff = manual - engine;
  return { diff, pct: engine ? diff / engine : manual ? 1 : 0, match: diff === 0 };
}
