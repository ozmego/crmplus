/**
 * Alan sözlüğü — docs/02 §3–4. Sütun eşleme önerileri başlık eşanlamlılarından üretilir.
 * sensitivity: G genel · K kişisel · I iletişim · KM kimlik · F finansal · N not
 */

export type Sensitivity = "G" | "K" | "I" | "KM" | "F" | "N";

export interface FieldDef {
  key: string;
  label: string;
  synonyms: string[];
  sensitivity: Sensitivity;
  /** CRM'e yazılmayan, yalnız tanınıp ayrıştırılan alanlar (finansal sütunlar finans modülüne aittir). */
  ignoredInCrm?: boolean;
}

export const FIELDS: FieldDef[] = [
  { key: "crmId", label: "CRM ID", synonyms: ["crm id", "crmid", "crm no", "misafir no", "guest id", "crm"], sensitivity: "G" },
  { key: "externalId", label: "Dış kimlik (casino oyuncu no)", synonyms: ["casino id", "player id", "oyuncu no", "oyuncu id", "player no", "member id", "üye no"], sensitivity: "G" },
  { key: "externalSource", label: "Dış kimlik kaynağı", synonyms: ["kaynak", "casino", "source", "partner", "iş ortağı"], sensitivity: "G" },
  { key: "firstName", label: "Ad", synonyms: ["ad", "adı", "isim", "first name", "firstname", "name", "given name"], sensitivity: "K" },
  { key: "lastName", label: "Soyad", synonyms: ["soyad", "soyadı", "soy ad", "last name", "lastname", "surname", "family name"], sensitivity: "K" },
  { key: "fullName", label: "Ad soyad (birleşik)", synonyms: ["ad soyad", "adı soyadı", "full name", "fullname", "misafir", "guest", "müşteri"], sensitivity: "K" },
  { key: "phone1", label: "Telefon 1", synonyms: ["telefon", "tel", "cep", "gsm", "phone", "mobile", "cep telefonu", "telefon 1", "phone 1"], sensitivity: "I" },
  { key: "phone2", label: "Telefon 2", synonyms: ["telefon 2", "tel 2", "ev tel", "iş tel", "phone 2", "home phone", "work phone"], sensitivity: "I" },
  { key: "email", label: "E-posta", synonyms: ["e-posta", "eposta", "email", "e-mail", "mail"], sensitivity: "I" },
  { key: "language", label: "Dil", synonyms: ["dil", "language", "lang"], sensitivity: "K" },
  { key: "country", label: "Ülke", synonyms: ["ülke", "uyruk", "country", "nationality"], sensitivity: "K" },
  { key: "city", label: "Şehir", synonyms: ["şehir", "il", "city"], sensitivity: "K" },
  { key: "birthYear", label: "Doğum yılı", synonyms: ["doğum yılı", "birth year", "yob"], sensitivity: "KM" },
  { key: "birthDate", label: "Doğum tarihi", synonyms: ["doğum tarihi", "dob", "birth date", "date of birth"], sensitivity: "KM" },
  { key: "vipLevel", label: "VIP seviyesi", synonyms: ["vip", "seviye", "segment", "tier", "level"], sensitivity: "G" },
  { key: "tags", label: "Etiketler", synonyms: ["etiket", "etiketler", "tags", "tag"], sensitivity: "G" },
  { key: "ownerAgent", label: "Sahip temsilci", synonyms: ["temsilci", "sorumlu", "agent", "owner", "host"], sensitivity: "G" },
  { key: "notes", label: "Not", synonyms: ["not", "notlar", "açıklama", "notes", "note", "comment"], sensitivity: "N" },
  { key: "consentCall", label: "Arama izni", synonyms: ["arama izni", "call consent", "telefon izni"], sensitivity: "G" },
  { key: "consentSms", label: "SMS izni", synonyms: ["sms izni", "sms consent"], sensitivity: "G" },
  { key: "consentWhatsapp", label: "WhatsApp izni", synonyms: ["whatsapp izni", "whatsapp consent", "wa izni"], sensitivity: "G" },
  { key: "consentEmail", label: "E-posta izni", synonyms: ["e-posta izni", "email consent", "mail izni"], sensitivity: "G" },
  { key: "consentDate", label: "İzin tarihi", synonyms: ["izin tarihi", "consent date"], sensitivity: "G" },
  { key: "consentSource", label: "İzin kaynağı", synonyms: ["izin kaynağı", "consent source"], sensitivity: "G" },
  { key: "consentProofRef", label: "İzin kanıtı", synonyms: ["izin kanıtı", "consent proof", "kanıt"], sensitivity: "G" },
  {
    key: "financial",
    label: "Finansal sütun (CRM'e alınmaz)",
    synonyms: ["kayıp", "kazanç", "net", "rolling", "turnover", "buy-in", "buyin", "cash-out", "cashout", "drop", "win", "loss", "komisyon", "limit", "bakiye"],
    sensitivity: "F",
    ignoredInCrm: true,
  },
];

export const FIELD_BY_KEY = new Map(FIELDS.map((f) => [f.key, f]));

/** Karşılaştırma için normalize: küçük harf (Türkçe), aksan ve noktalama sadeleştirme. */
export function normHeader(s: string): string {
  return s
    .toLocaleLowerCase("tr-TR")
    .replace(/[ç]/g, "c").replace(/[ğ]/g, "g").replace(/[ı]/g, "i").replace(/[ö]/g, "o").replace(/[ş]/g, "s").replace(/[ü]/g, "u")
    .replace(/[_\-./]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export type Mapping = Record<string, string | null>; // başlık -> alan anahtarı (null = yok say)

/** Başlıklardan eşleme önerisi. Her alan en fazla bir sütuna atanır (finansal hariç). */
export function suggestMapping(headers: string[]): Mapping {
  const map: Mapping = {};
  const used = new Set<string>();
  // Önce tam eşleşmeler, sonra içerme
  for (const pass of ["exact", "contains"] as const) {
    for (const h of headers) {
      if (map[h] !== undefined && map[h] !== null) continue;
      const nh = normHeader(h);
      for (const f of FIELDS) {
        if (f.key !== "financial" && used.has(f.key)) continue;
        const hit = f.synonyms.some((s) => {
          const ns = normHeader(s);
          return pass === "exact" ? nh === ns : nh.split(" ").includes(ns) || (ns.includes(" ") && nh.includes(ns));
        });
        if (hit) {
          map[h] = f.key;
          used.add(f.key);
          break;
        }
      }
    }
  }
  for (const h of headers) if (map[h] === undefined) map[h] = null;
  return map;
}
