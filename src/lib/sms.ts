import { z } from "zod";
/**
 * SMS kuralları — docs/10. Saf fonksiyonlar: parça sayısı, şablon doğrulama, değişken doldurma, ret tanıma.
 */

// GSM 03.38 temel ve genişletme karakterleri (genişletme 2 karakter sayılır)
const GSM_BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM_EXT = "^{}\\[~]|€\f";

export interface SegmentInfo {
  encoding: "GSM7" | "UCS2";
  length: number; // kodlama birimi
  segments: number;
  perSegment: number;
}

export function smsSegments(text: string): SegmentInfo {
  let gsm = true;
  let len = 0;
  for (const ch of text) {
    if (GSM_BASIC.includes(ch)) len += 1;
    else if (GSM_EXT.includes(ch)) len += 2;
    else {
      gsm = false;
      break;
    }
  }
  if (gsm) {
    const per = len <= 160 ? 160 : 153;
    return { encoding: "GSM7", length: len, segments: len === 0 ? 0 : Math.ceil(len / per), perSegment: per };
  }
  const units = [...text].reduce((n, ch) => n + (ch.codePointAt(0)! > 0xffff ? 2 : 1), 0);
  const per = units <= 70 ? 70 : 67;
  return { encoding: "UCS2", length: units, segments: units === 0 ? 0 : Math.ceil(units / per), perSegment: per };
}

/** Türkçe karakterleri GSM-7'ye uygun karşılıklarıyla değiştirir (“tek parça modu”, isteğe bağlı). */
export function toGsmFriendly(text: string): string {
  return text
    .replace(/ç/g, "c").replace(/ğ/g, "g").replace(/ı/g, "i").replace(/ş/g, "s")
    .replace(/Ğ/g, "G").replace(/İ/g, "I").replace(/Ş/g, "S");
}

/** Şablonda kullanılabilecek değişkenler (docs/10 §4). Finansal ve kimlik alanları YOK. */
export const ALLOWED_VARS = ["ad", "soyad", "temsilci_adi", "sehir"] as const;
export type TemplateVar = (typeof ALLOWED_VARS)[number];

const FINANCIAL_HINT = /(kay[ıi]p|kazan[çc]|rolling|komisyon|limit|bakiye|tutar|bor[çc]|net|buy.?in|cash.?out)/i;
const RISKY = [
  /kesin kazan/i, /garanti(li)? kazan/i, /son şans/i, /kaçırma(yın)?/i, /hemen şimdi/i, /borç/i, /kredi/i, /bedava para/i,
];

export interface TemplateCheck {
  errors: string[];
  warnings: string[];
  vars: string[];
}

export function checkTemplate(body: string, category: "MARKETING" | "INFORMATIONAL"): TemplateCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  const vars = [...body.matchAll(/\{([^{}]+)\}/g)].map((m) => m[1].trim());
  for (const v of vars) {
    if (FINANCIAL_HINT.test(v)) errors.push(`{${v}}: finansal alan şablonda kullanılamaz.`);
    else if (!(ALLOWED_VARS as readonly string[]).includes(v)) errors.push(`{${v}}: izin verilmeyen değişken. Kullanılabilir: ${ALLOWED_VARS.map((x) => `{${x}}`).join(", ")}`);
  }
  if (!body.trim()) errors.push("Şablon boş olamaz.");
  if (body.length > 900) errors.push("Şablon çok uzun (en fazla 900 karakter).");
  for (const re of RISKY) if (re.test(body)) warnings.push(`Riskli ifade: “${body.match(re)![0]}” (kazanç vaadi, baskı veya borç dili). Onaylayan kişi değerlendirmeli.`);
  if (category === "MARKETING" && /\bRET\b/.test(body)) warnings.push("Ret metni sistem tarafından otomatik eklenir; şablonda ayrıca yazmaya gerek yok.");
  return { errors, warnings, vars };
}

export function renderTemplate(body: string, values: Partial<Record<TemplateVar, string>>): string {
  return body.replace(/\{([^{}]+)\}/g, (_, k: string) => values[k.trim() as TemplateVar] ?? "");
}

/** Pazarlama mesajlarına zorunlu ret metni eklenir (docs/10 §4). */
export function withOptOut(text: string, category: "MARKETING" | "INFORMATIONAL", optOutText: string): string {
  return category === "MARKETING" ? `${text.trim()} ${optOutText.trim()}` : text.trim();
}

/** Gelen mesajın ret talebi olup olmadığı (docs/10 §6). */
const OPT_OUT_WORDS = ["RET", "IPTAL", "İPTAL", "STOP", "DUR", "UNSUBSCRIBE", "ABONELIK IPTAL", "ARAMAYIN", "MESAJ ATMAYIN", "ISTEMIYORUM", "İSTEMİYORUM"];
export function isOptOut(text: string): boolean {
  const t = text.trim().toLocaleUpperCase("tr-TR").replace(/[.!?,]/g, "").replace(/\s+/g, " ");
  return OPT_OUT_WORDS.some((w) => t === w || t.startsWith(`${w} `));
}

export const CAMPAIGN_STATUS: Record<string, string> = {
  DRAFT: "Taslak",
  PENDING_APPROVAL: "Onay bekliyor",
  APPROVED: "Onaylandı",
  SENDING: "Gönderiliyor",
  DONE: "Tamamlandı",
  CANCELLED: "İptal",
};

/** Segment alanları beyaz listesi (plan v4 §6): dil, ülke, etiket, son iletişim tarihi. */
export const segmentSchema = z
  .object({
    languages: z.array(z.string().regex(/^[a-z]{2}$/)).max(10).optional(),
    countries: z.array(z.string().regex(/^[A-Z]{2}$/)).max(20).optional(),
    tags: z.array(z.string().min(1).max(40)).max(10).optional(),
    lastContactBeforeDays: z.number().int().min(0).max(3650).optional(),
  })
  .strict(); // bilinmeyen (ör. finansal) alan reddedilir

export type Segment = z.infer<typeof segmentSchema>;
