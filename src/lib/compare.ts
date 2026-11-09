import { NAME_THRESHOLD, normName, trigramSimilarity } from "./import/match";

/**
 * Liste karşılaştırma — plan v4 §1 "Dosya karşılaştırma". Saf fonksiyon.
 * Sol = taban (önceki dosya veya CRM'in güncel hali), sağ = yeni dosya.
 * Telefon tek başına kimlik sayılmaz: telefon eşleşip isim tutmuyorsa "kaynaklar arası çelişki".
 * "Dosyada yok" yalnız etikettir; silme anlamına gelmez.
 */

export type CompareStatus = "NEW" | "SAME" | "CONTACT_CHANGED" | "OTHER_CHANGED" | "MULTI_MATCH" | "CONFLICT" | "MISSING_IN_FILE";

export interface CompRow {
  ref: string; // satır no ("r12") veya misafir id
  crmNo?: number;
  ext?: string; // "kaynak\u0000değer"
  phoneHashes: string[];
  phonesMasked: string[];
  emailHash?: string;
  fields: Record<string, string>;
  consent: Record<string, string>;
}

export interface FieldDelta {
  field: string;
  left: string | null;
  right: string | null;
}

export interface CompareResult {
  status: CompareStatus;
  leftRef: string | null;
  rightRef: string | null;
  candidateRefs?: string[];
  deltas: FieldDelta[];
  reason?: string;
}

const COMPARED_FIELDS = ["firstName", "lastName", "language", "country", "city", "birthYear", "vipLevel"];

function fullName(r: CompRow) {
  return `${r.fields.firstName ?? ""} ${r.fields.lastName ?? ""}`.trim();
}

export function compareRowSets(left: CompRow[], right: CompRow[]): CompareResult[] {
  const byCrm = new Map<number, CompRow[]>();
  const byExt = new Map<string, CompRow[]>();
  const byPhone = new Map<string, CompRow[]>();
  const add = <K,>(m: Map<K, CompRow[]>, k: K, r: CompRow) => m.set(k, [...(m.get(k) ?? []), r]);
  for (const l of left) {
    if (l.crmNo !== undefined) add(byCrm, l.crmNo, l);
    if (l.ext) add(byExt, l.ext, l);
    for (const h of l.phoneHashes) add(byPhone, h, l);
  }

  const matchedLeft = new Set<string>();
  const out: CompareResult[] = [];

  for (const r of right) {
    let candidates: CompRow[] = [];
    let via: "crm" | "ext" | "phone" | null = null;
    if (r.crmNo !== undefined && byCrm.has(r.crmNo)) [candidates, via] = [byCrm.get(r.crmNo)!, "crm"];
    else if (r.ext && byExt.has(r.ext)) [candidates, via] = [byExt.get(r.ext)!, "ext"];
    else {
      const seen = new Map<string, CompRow>();
      for (const h of r.phoneHashes) for (const l of byPhone.get(h) ?? []) seen.set(l.ref, l);
      candidates = [...seen.values()];
      via = candidates.length ? "phone" : null;
    }

    if (!via) {
      out.push({ status: "NEW", leftRef: null, rightRef: r.ref, deltas: [] });
      continue;
    }

    if (via === "phone") {
      const named = candidates.filter((l) => trigramSimilarity(fullName(l), fullName(r)) >= NAME_THRESHOLD);
      if (named.length === 0) {
        candidates.forEach((l) => matchedLeft.add(l.ref));
        out.push({
          status: "CONFLICT",
          leftRef: candidates[0].ref,
          rightRef: r.ref,
          candidateRefs: candidates.map((l) => l.ref),
          deltas: [{ field: "fullName", left: fullName(candidates[0]), right: fullName(r) }],
          reason: "Aynı telefon farklı isimle; telefon tek başına kimlik sayılmaz.",
        });
        continue;
      }
      candidates = named;
    }

    if (candidates.length > 1) {
      candidates.forEach((l) => matchedLeft.add(l.ref));
      out.push({ status: "MULTI_MATCH", leftRef: null, rightRef: r.ref, candidateRefs: candidates.map((l) => l.ref), deltas: [] });
      continue;
    }

    const l = candidates[0];
    matchedLeft.add(l.ref);

    // İzin çelişkisi: bir kaynak izin, diğeri ret diyorsa
    const consentClash = Object.keys({ ...l.consent, ...r.consent }).filter(
      (ch) => (l.consent[ch] === "GRANTED" && r.consent[ch] === "DENIED") || (l.consent[ch] === "DENIED" && r.consent[ch] === "GRANTED"),
    );
    const deltas: FieldDelta[] = [];
    for (const f of COMPARED_FIELDS) {
      const a = l.fields[f] ?? null;
      const b = r.fields[f] ?? null;
      if (b === null || b === "") continue; // yeni dosyada boş alan "değişiklik" değildir
      if (a === null || normName(a) !== normName(b)) deltas.push({ field: f, left: a, right: b });
    }
    const newPhones = r.phoneHashes.filter((h) => !l.phoneHashes.includes(h));
    const contactDeltas: FieldDelta[] = [];
    if (newPhones.length) {
      contactDeltas.push({
        field: "phone",
        left: l.phonesMasked.join(", ") || null,
        right: r.phonesMasked.filter((_, i) => newPhones.includes(r.phoneHashes[i])).join(", ") || null,
      });
    }
    if (r.emailHash && r.emailHash !== l.emailHash) contactDeltas.push({ field: "email", left: l.emailHash ? "mevcut" : null, right: "farklı" });

    if (consentClash.length) {
      out.push({
        status: "CONFLICT",
        leftRef: l.ref,
        rightRef: r.ref,
        deltas: [...consentClash.map((ch) => ({ field: `consent.${ch}`, left: l.consent[ch], right: r.consent[ch] })), ...deltas, ...contactDeltas],
        reason: "Kaynaklar izin konusunda çelişiyor; ret kaydı yeni kanıt olmadan değişmez.",
      });
    } else if (contactDeltas.length) {
      out.push({ status: "CONTACT_CHANGED", leftRef: l.ref, rightRef: r.ref, deltas: [...contactDeltas, ...deltas] });
    } else if (deltas.length) {
      out.push({ status: "OTHER_CHANGED", leftRef: l.ref, rightRef: r.ref, deltas });
    } else {
      out.push({ status: "SAME", leftRef: l.ref, rightRef: r.ref, deltas: [] });
    }
  }

  for (const l of left) {
    if (!matchedLeft.has(l.ref)) out.push({ status: "MISSING_IN_FILE", leftRef: l.ref, rightRef: null, deltas: [] });
  }
  return out;
}
