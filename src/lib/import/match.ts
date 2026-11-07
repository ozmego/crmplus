/**
 * Eşleştirme ve alan farkı — docs/02 §6–7. Saf fonksiyonlar.
 */

/** pg_trgm uyumlu trigram benzerliği (0–1). */
export function trigramSimilarity(a: string, b: string): number {
  const grams = (s: string) => {
    const set = new Set<string>();
    for (const w of normName(s).split(" ").filter(Boolean)) {
      const p = `  ${w} `;
      for (let i = 0; i < p.length - 2; i++) set.add(p.slice(i, i + 3));
    }
    return set;
  };
  const A = grams(a);
  const B = grams(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  return inter / (A.size + B.size - inter);
}

export function normName(s: string): string {
  return s
    .toLocaleLowerCase("tr-TR")
    .replace(/ç/g, "c").replace(/ğ/g, "g").replace(/ı/g, "i").replace(/ö/g, "o").replace(/ş/g, "s").replace(/ü/g, "u")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export const NAME_THRESHOLD = 0.85;

export interface Candidate {
  id: string;
  firstName: string;
  lastName: string;
  birthYear?: number | null;
  emailHash?: string | null;
  via: "CRM_ID" | "EXTERNAL_ID" | "PHONE";
}

export type MatchResult =
  | { kind: "NEW" }
  | { kind: "MATCHED"; guestId: string; via: Candidate["via"]; confidence: "EXACT" | "STRONG" }
  | { kind: "MULTI_MATCH"; candidateIds: string[] }
  | { kind: "POSSIBLE"; candidateIds: string[]; reason: "PHONE_ONLY" | "NAME_CONFLICT" }
  | { kind: "CRM_ID_NOT_FOUND" };

export interface MatchInput {
  crmNo?: number;
  firstName?: string;
  lastName?: string;
  birthYear?: number;
  emailHash?: string;
}

/**
 * Öncelik: CRM ID → dış kimlik → telefon + en az bir doğrulayıcı (ad-soyad ≥ 0,85, doğum yılı veya e-posta).
 * Telefon tek başına kesin kimlik sayılmaz → POSSIBLE (inceleme kuyruğu).
 */
export function classifyMatch(row: MatchInput, candidates: Candidate[]): MatchResult {
  const byCrm = candidates.filter((c) => c.via === "CRM_ID");
  if (row.crmNo !== undefined) {
    if (byCrm.length === 1) return { kind: "MATCHED", guestId: byCrm[0].id, via: "CRM_ID", confidence: "EXACT" };
    return { kind: "CRM_ID_NOT_FOUND" };
  }
  const byExt = candidates.filter((c) => c.via === "EXTERNAL_ID");
  if (byExt.length === 1) return { kind: "MATCHED", guestId: byExt[0].id, via: "EXTERNAL_ID", confidence: "EXACT" };
  if (byExt.length > 1) return { kind: "MULTI_MATCH", candidateIds: byExt.map((c) => c.id) };

  const byPhone = dedupe(candidates.filter((c) => c.via === "PHONE"));
  if (byPhone.length === 0) return { kind: "NEW" };

  const fullName = `${row.firstName ?? ""} ${row.lastName ?? ""}`;
  const verified = byPhone.filter((c) => {
    const nameOk = !!row.firstName && trigramSimilarity(fullName, `${c.firstName} ${c.lastName}`) >= NAME_THRESHOLD;
    const yearOk = !!row.birthYear && !!c.birthYear && row.birthYear === c.birthYear;
    const yearConflict = !!row.birthYear && !!c.birthYear && row.birthYear !== c.birthYear;
    const emailOk = !!row.emailHash && !!c.emailHash && row.emailHash === c.emailHash;
    return (nameOk || yearOk || emailOk) && !yearConflict;
  });
  if (verified.length === 1) return { kind: "MATCHED", guestId: verified[0].id, via: "PHONE", confidence: "STRONG" };
  if (verified.length > 1) return { kind: "MULTI_MATCH", candidateIds: verified.map((c) => c.id) };
  return { kind: "POSSIBLE", candidateIds: byPhone.map((c) => c.id), reason: row.firstName ? "NAME_CONFLICT" : "PHONE_ONLY" };
}

function dedupe(cs: Candidate[]): Candidate[] {
  const seen = new Set<string>();
  return cs.filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)));
}

export type FieldChange = { field: string; old: string | null; new: string; action: "FILL" | "CONFLICT" };

/**
 * Sessiz ezme yok (docs/02 §7): boş → doldur; aynı → değişiklik yok; dolu ve farklı → CONFLICT (kullanıcı karar verir);
 * dosyada boş → mevcut korunur (değişiklik üretmez).
 */
export function fieldDiff(existing: Record<string, string | null | undefined>, incoming: Record<string, string | undefined>): FieldChange[] {
  const out: FieldChange[] = [];
  for (const [field, val] of Object.entries(incoming)) {
    if (val === undefined || val === "") continue;
    const cur = existing[field];
    if (cur === null || cur === undefined || cur === "") out.push({ field, old: null, new: val, action: "FILL" });
    else if (normName(cur) !== normName(val)) out.push({ field, old: cur, new: val, action: "CONFLICT" });
  }
  return out;
}
