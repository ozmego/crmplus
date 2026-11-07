import { normalizePhone, type NormalizedPhone } from "@/lib/phone";
import type { Mapping } from "./fields";

/** Satır hata kodları — docs/02 §8 */
export type RowErrorCode =
  | "E_REQUIRED"
  | "E_PHONE_INVALID"
  | "E_PHONE_SCIENTIFIC"
  | "E_DATE_INVALID"
  | "E_UNDERAGE"
  | "E_ENUM"
  | "E_TOO_LONG"
  | "E_CONSENT_INCOMPLETE";

export interface RowIssue {
  code: RowErrorCode;
  field: string;
  message: string;
  /** Uyarı satırı düşürmez; hata satırı uygulanmaz. */
  severity: "error" | "warning";
}

export type ConsentValue = "GRANTED" | "DENIED" | "UNKNOWN";

export interface NormalizedRow {
  crmNo?: number;
  externalId?: string;
  externalSource?: string;
  firstName?: string;
  lastName?: string;
  phones: (NormalizedPhone & { field: string })[];
  email?: string;
  language?: string;
  country?: string;
  city?: string;
  birthYear?: number;
  vipLevel?: string;
  tags?: string[];
  ownerAgent?: string;
  notes?: string;
  consent: { CALL?: ConsentValue; SMS?: ConsentValue; WHATSAPP?: ConsentValue; EMAIL?: ConsentValue };
  consentDate?: string;
  consentSource?: string;
  consentProofRef?: string;
  hasFinancial: boolean;
}

const LANG_NAMES: Record<string, string> = {
  türkçe: "tr", turkce: "tr", turkish: "tr", ingilizce: "en", english: "en", rusça: "ru", rusca: "ru", russian: "ru",
  arapça: "ar", arapca: "ar", arabic: "ar", farsça: "fa", farsca: "fa", persian: "fa", almanca: "de", german: "de",
};
const COUNTRY_NAMES: Record<string, string> = {
  türkiye: "TR", turkiye: "TR", turkey: "TR", rusya: "RU", russia: "RU", almanya: "DE", germany: "DE", ingiltere: "GB",
  "united kingdom": "GB", iran: "IR", irak: "IQ", iraq: "IQ", azerbaycan: "AZ", azerbaijan: "AZ", gürcistan: "GE", georgia: "GE",
  "birleşik arap emirlikleri": "AE", bae: "AE", uae: "AE", israil: "IL", israel: "IL", yunanistan: "GR", greece: "GR",
};
const VIP_MAP: Record<string, string> = {
  standard: "STANDARD", standart: "STANDARD", silver: "SILVER", gümüş: "SILVER", gold: "GOLD", altın: "GOLD",
  platinum: "PLATINUM", platin: "PLATINUM", diamond: "DIAMOND", elmas: "DIAMOND",
};

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());

function titleCaseTr(s: string): string {
  return s
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((w) => (w ? w.charAt(0).toLocaleUpperCase("tr-TR") + w.slice(1).toLocaleLowerCase("tr-TR") : w))
    .join(" ");
}

function parseConsent(v: string): ConsentValue | null {
  const s = v.toLocaleLowerCase("tr-TR");
  if (!s) return "UNKNOWN";
  if (["evet", "e", "yes", "y", "var", "1", "true", "onay", "izinli", "granted"].includes(s)) return "GRANTED";
  if (["hayır", "hayir", "h", "no", "n", "yok", "0", "false", "ret", "red", "denied"].includes(s)) return "DENIED";
  if (["bilinmiyor", "unknown", "?", "-"].includes(s)) return "UNKNOWN";
  return null;
}

/** "GG.AA.YYYY", "YYYY-MM-DD" veya Excel seri tarihi → ISO tarih (YYYY-MM-DD). */
export function parseDate(v: unknown): string | null {
  if (v instanceof Date && !isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  const s = str(v);
  if (!s) return null;
  let m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(s);
  if (m) {
    const d = new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
    return d.getUTCDate() === +m[1] ? d.toISOString().slice(0, 10) : null;
  }
  m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) {
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return d.getUTCDate() === +m[3] ? d.toISOString().slice(0, 10) : null;
  }
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(s)) * 86_400_000);
    return d.toISOString().slice(0, 10);
  }
  return null;
}

export function normalizeRow(
  raw: Record<string, unknown>,
  mapping: Mapping,
  opts: { defaultCountry: string; today?: Date },
): { row: NormalizedRow; issues: RowIssue[] } {
  const issues: RowIssue[] = [];
  const today = opts.today ?? new Date();
  const get = (key: string): unknown[] =>
    Object.entries(mapping)
      .filter(([, k]) => k === key)
      .map(([h]) => raw[h]);
  const one = (key: string) => str(get(key)[0]);
  const row: NormalizedRow = { phones: [], consent: {}, hasFinancial: get("financial").some((v) => str(v) !== "") };

  const crm = one("crmId");
  if (crm) {
    const n = /^(?:crm-?)?0*(\d+)$/i.exec(crm);
    if (n) row.crmNo = Number(n[1]);
    else issues.push({ code: "E_ENUM", field: "crmId", message: `CRM ID okunamadı: ${crm}`, severity: "error" });
  }
  if (one("externalId")) row.externalId = one("externalId");
  if (one("externalSource")) row.externalSource = one("externalSource");

  let first = one("firstName");
  let last = one("lastName");
  const full = one("fullName");
  if (full && !first && !last) {
    const parts = full.replace(/\s+/g, " ").split(" ");
    last = parts.length > 1 ? parts.pop()! : "";
    first = parts.join(" ");
  }
  if (first) row.firstName = titleCaseTr(first);
  if (last) row.lastName = titleCaseTr(last);
  if (!row.crmNo && (!row.firstName || !row.lastName)) {
    issues.push({ code: "E_REQUIRED", field: !row.firstName ? "firstName" : "lastName", message: "Ad ve soyad zorunlu.", severity: "error" });
  }
  for (const [f, max] of [["firstName", 80], ["lastName", 80]] as const) {
    if ((row[f]?.length ?? 0) > max) issues.push({ code: "E_TOO_LONG", field: f, message: `${f} ${max} karakteri aşıyor.`, severity: "error" });
  }

  const country = one("country");
  if (country) {
    const c = country.length === 2 ? country.toUpperCase() : COUNTRY_NAMES[country.toLocaleLowerCase("tr-TR")];
    if (c) row.country = c;
    else issues.push({ code: "E_ENUM", field: "country", message: `Ülke tanınmadı: ${country}`, severity: "warning" });
  }

  for (const field of ["phone1", "phone2"]) {
    const v = one(field);
    if (!v) continue;
    const p = normalizePhone(v, opts.defaultCountry, row.country);
    row.phones.push({ ...p, field });
    if (p.error === "E_PHONE_SCIENTIFIC") {
      issues.push({ code: "E_PHONE_SCIENTIFIC", field, message: "Hücre sayı olarak biçimlenmiş; numara bozulmuş olabilir.", severity: "warning" });
    } else if (!p.ok) {
      issues.push({ code: "E_PHONE_INVALID", field, message: `Geçersiz telefon: ${v}`, severity: "warning" });
    }
  }

  const email = one("email").toLowerCase();
  if (email) {
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) row.email = email;
    else issues.push({ code: "E_ENUM", field: "email", message: `Geçersiz e-posta: ${email}`, severity: "warning" });
  }
  if (!row.crmNo && !row.phones.some((p) => p.ok) && !row.email) {
    issues.push({ code: "E_REQUIRED", field: "phone1", message: "Geçerli telefon veya e-posta gerekli.", severity: "warning" });
  }

  const lang = one("language").toLocaleLowerCase("tr-TR");
  if (lang) {
    const l = lang.length === 2 ? lang : LANG_NAMES[lang];
    if (l) row.language = l;
    else issues.push({ code: "E_ENUM", field: "language", message: `Dil tanınmadı: ${lang}`, severity: "warning" });
  }
  if (one("city")) row.city = titleCaseTr(one("city"));

  const by = one("birthYear");
  const bd = one("birthDate") || (get("birthDate")[0] instanceof Date ? (get("birthDate")[0] as Date) : "");
  let year: number | undefined;
  if (by) {
    year = Number(by);
    if (!Number.isInteger(year) || year < 1920 || year > today.getUTCFullYear()) {
      issues.push({ code: "E_DATE_INVALID", field: "birthYear", message: `Doğum yılı geçersiz: ${by}`, severity: "error" });
      year = undefined;
    }
  } else if (bd) {
    const iso = parseDate(get("birthDate")[0]);
    if (iso) year = Number(iso.slice(0, 4));
    else issues.push({ code: "E_DATE_INVALID", field: "birthDate", message: `Doğum tarihi okunamadı: ${bd}`, severity: "error" });
  }
  if (year !== undefined) {
    if (today.getUTCFullYear() - year < 18) issues.push({ code: "E_UNDERAGE", field: "birthYear", message: "18 yaş altı kayıt alınamaz.", severity: "error" });
    else row.birthYear = year;
  }

  const vip = one("vipLevel");
  if (vip) {
    const v = VIP_MAP[vip.toLocaleLowerCase("tr-TR")];
    if (v) row.vipLevel = v;
    else issues.push({ code: "E_ENUM", field: "vipLevel", message: `VIP seviyesi tanınmadı: ${vip}`, severity: "warning" });
  }
  const tags = one("tags");
  if (tags) row.tags = tags.split(/[;,]/).map((t) => t.trim()).filter(Boolean);
  if (one("ownerAgent")) row.ownerAgent = one("ownerAgent").toLowerCase();
  const notes = one("notes");
  if (notes) {
    if (notes.length > 2000) issues.push({ code: "E_TOO_LONG", field: "notes", message: "Not 2000 karakteri aşıyor.", severity: "error" });
    else row.notes = notes;
  }

  const consentCols = [["consentCall", "CALL"], ["consentSms", "SMS"], ["consentWhatsapp", "WHATSAPP"], ["consentEmail", "EMAIL"]] as const;
  for (const [field, ch] of consentCols) {
    if (!Object.values(mapping).includes(field)) continue;
    const v = parseConsent(one(field));
    if (v === null) issues.push({ code: "E_ENUM", field, message: `İzin değeri tanınmadı: ${one(field)}`, severity: "warning" });
    else row.consent[ch] = v;
  }
  const cd = get("consentDate")[0];
  if (str(cd)) {
    const iso = parseDate(cd);
    if (!iso) issues.push({ code: "E_DATE_INVALID", field: "consentDate", message: `İzin tarihi okunamadı: ${str(cd)}`, severity: "warning" });
    else if (new Date(iso) > today) issues.push({ code: "E_DATE_INVALID", field: "consentDate", message: "İzin tarihi gelecekte olamaz.", severity: "warning" });
    else row.consentDate = iso;
  }
  if (one("consentSource")) row.consentSource = one("consentSource");
  if (one("consentProofRef")) row.consentProofRef = one("consentProofRef");

  // İzin "EVET" ama tarih veya kaynak yoksa izin kaydedilmez (docs/02 §4)
  const granted = Object.entries(row.consent).filter(([, v]) => v === "GRANTED");
  if (granted.length && (!row.consentDate || !row.consentSource)) {
    for (const [ch] of granted) row.consent[ch as keyof NormalizedRow["consent"]] = "UNKNOWN";
    issues.push({ code: "E_CONSENT_INCOMPLETE", field: "consentDate", message: "İzin “evet” ama tarih/kaynak eksik; bilinmiyor olarak alınır.", severity: "warning" });
  }

  return { row, issues };
}
