/**
 * Ses analizi doğruluk göstergeleri (docs/05 §7a) ve kalite örneklemi seçimi — saf fonksiyonlar.
 * Göstergeler toplulaştırılmıştır; kişi sıralaması veya puanı üretmez.
 */

const words = (s: string) =>
  s
    .toLocaleLowerCase("tr-TR")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);

/** Kelime düzeyinde düzenleme mesafesi (Levenshtein). */
export function wordEditDistance(a: string, b: string): { distance: number; reference: number } {
  const x = words(a);
  const y = words(b);
  const prev = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= y.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (x[i - 1] === y[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return { distance: prev[y.length], reference: y.length };
}

/**
 * WER: insan düzeltmesi (after) referans kabul edilir. Yalnız düzeltilen bölütlerden hesaplanır;
 * düzeltilmemiş bölütler doğru varsayılmaz, hesaba katılmaz (iyimser yanlılığı önlemek için ayrıca raporlanır).
 */
export function wordErrorRate(edits: { before: string; after: string }[]): number | null {
  let d = 0;
  let n = 0;
  for (const e of edits) {
    const r = wordEditDistance(e.before, e.after);
    d += r.distance;
    n += r.reference;
  }
  return n ? d / n : null;
}

export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1));
  return s[idx];
}

export const ratio = (a: number, b: number) => (b ? a / b : null);

/** Tekrarlanabilir rastgele seçim (seed: hafta + temsilci) — örneklemin kime düşeceği önceden bilinmez ama denetlenebilir. */
export function seededShuffle<T>(items: T[], seed: string): T[] {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  const rnd = () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export type SampleReason = "RANDOM" | "PROCESS_FLAG" | "MISMATCH" | "LOW_CONFIDENCE";
export interface Candidate {
  callId: string;
  agentId: string;
  mismatch: boolean;
  processFlags: number;
  lowConfidence: boolean;
}

/**
 * Temsilci başına haftalık örneklem: önce analizin önerdiği adaylar (en fazla `flagged`), kalanı rastgele.
 * Aday önerisi incelemeye yönlendirir; sonuç insan kararıdır.
 */
export function pickSamples(cands: Candidate[], opts: { perAgent: number; flagged: number; seed: string; exclude?: Set<string> }) {
  const out: { callId: string; agentId: string; reason: SampleReason }[] = [];
  const byAgent = new Map<string, Candidate[]>();
  for (const c of cands) {
    if (opts.exclude?.has(c.callId)) continue;
    if (!byAgent.has(c.agentId)) byAgent.set(c.agentId, []);
    byAgent.get(c.agentId)!.push(c);
  }
  for (const [agentId, list] of byAgent) {
    const shuffled = seededShuffle(list, `${opts.seed}:${agentId}`);
    const reasonOf = (c: Candidate): SampleReason | null => (c.mismatch ? "MISMATCH" : c.processFlags ? "PROCESS_FLAG" : c.lowConfidence ? "LOW_CONFIDENCE" : null);
    const flagged = shuffled.filter((c) => reasonOf(c)).slice(0, Math.min(opts.flagged, opts.perAgent));
    const taken = new Set(flagged.map((c) => c.callId));
    const random = shuffled.filter((c) => !taken.has(c.callId)).slice(0, opts.perAgent - flagged.length);
    for (const c of flagged) out.push({ callId: c.callId, agentId, reason: reasonOf(c)! });
    for (const c of random) out.push({ callId: c.callId, agentId, reason: "RANDOM" });
  }
  return out;
}
