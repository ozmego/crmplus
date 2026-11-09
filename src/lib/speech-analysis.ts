/**
 * Konuşma analizi — kural tabanlı ilk sürüm (plan v4 §4). Saf fonksiyon, yalnız ÖNERİ üretir.
 * ÜRETİLMEZ: duygu, kişilik, ikna edilebilirlik, kumar davranışı, kayıp temelli risk/değer skoru, kalite puanı.
 */

export interface Segment {
  speaker: "AGENT" | "GUEST";
  start: number; // sn
  end: number;
  text: string;
}

export type Topic = "TRIP_INTEREST" | "OFFER_PRICE" | "RESERVATION" | "COMPLAINT" | "CALLBACK_REQUEST" | "WRONG_PERSON" | "NOT_INTERESTED";
export interface ProcessFlag {
  code: "RECORDING_NOTICE_MISSING" | "SELF_INTRO_MISSING" | "OPT_OUT_NOT_RECORDED" | "CALLBACK_NOT_RECORDED" | "WRONG_PERSON_NOT_RECORDED";
  severity: "critical" | "warning" | "info";
  message: string;
  evidence?: string;
}
export interface SuggestedAction {
  type: "CALLBACK" | "FOLLOW_UP";
  at?: string; // ISO
  note: string;
}
export interface AnalysisResult {
  summary: string;
  topics: Topic[];
  actions: SuggestedAction[];
  processFlags: ProcessFlag[];
  dispositionMismatch: boolean;
  model: "rules";
  modelVersion: string;
}

export const RULES_VERSION = "rules-tr-1";

const norm = (s: string) =>
  s.toLocaleLowerCase("tr-TR").replace(/[’'`]/g, "").replace(/\s+/g, " ").trim();

const TOPIC_WORDS: Record<Exclude<Topic, "CALLBACK_REQUEST" | "WRONG_PERSON" | "NOT_INTERESTED">, RegExp> = {
  TRIP_INTEREST: /\b(trip|tatil|seyahat|gelmek ist|gelebilirim|katılmak|kıbrıs|batum|otel)/,
  OFFER_PRICE: /\b(fiyat|teklif|indirim|ücret|kampanya|ne kadar)/,
  RESERVATION: /\b(rezervasyon|oda|uçuş|bilet|transfer|tarih)/,
  COMPLAINT: /\b(şikayet|şikâyet|memnun değil|sorun yaşadım|rahatsız oldum|kötüydü)/,
};
const OPT_OUT = /\b(bir daha aramayın|beni aramayın|aramayın|listeden çıkar|rahatsız etmeyin|iletişim istemiyorum|numaramı sil)/;
const NOT_INTERESTED = /\b(ilgilenmiyorum|istemiyorum|gerek yok|düşünmüyorum)/;
const CALLBACK = /\b(sonra ara|tekrar ara|daha sonra|müsait değilim|şu an konuşamam|yarın ara|akşam ara|bir saat sonra)/;
const WRONG = /\b(yanlış numara|tanımıyorum|ben değilim|öyle biri yok|yanlış kişi)/;
const NOTICE = /(kayıt altına|kaydedil|kayıt alın|kayda alın)/;
const INTRO = /\b(ben \p{L}+|adım \p{L}+|arıyorum|crmplus|şirketinden|adına arıyorum)/u;

const DAYS: Record<string, number> = { pazar: 0, pazartesi: 1, salı: 2, çarşamba: 3, perşembe: 4, cuma: 5, cumartesi: 6 };

/** "yarın saat 15:30", "pazartesi saat 2'de" → İstanbul saatine göre ISO. Saat 1–7 öğleden sonra kabul edilir. */
export function extractCallbackTime(text: string, now: Date): string | undefined {
  const t = norm(text);
  const m = /saat (\d{1,2})(?:[:.](\d{2}))?/.exec(t);
  if (!m) return undefined;
  let hour = Number(m[1]);
  const minute = m[2] ? Number(m[2]) : 0;
  if (hour > 23 || minute > 59) return undefined;
  if (hour >= 1 && hour <= 7) hour += 12;
  // İstanbul (UTC+3, yaz saati yok) yerel tarih
  const local = new Date(now.getTime() + 3 * 3_600_000);
  let addDays = 0;
  if (/\byarın\b/.test(t)) addDays = 1;
  else {
    const day = Object.keys(DAYS).sort((a, b) => b.length - a.length).find((d) => new RegExp(`\\b${d}\\b`).test(t));
    if (day) addDays = (DAYS[day] - local.getUTCDay() + 7) % 7 || 7;
  }
  const target = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + addDays, hour - 3, minute);
  if (addDays === 0 && target <= now.getTime()) return undefined; // bugün ve geçmiş saat → belirsiz
  return new Date(target).toISOString();
}

export function analyzeTranscript(segments: Segment[], disposition: string | null, now: Date = new Date()): AnalysisResult {
  const agentEarly = segments.filter((s) => s.speaker === "AGENT" && s.start <= 60).map((s) => norm(s.text)).join(" ");
  const guest = segments.filter((s) => s.speaker === "GUEST");
  const topics = new Set<Topic>();
  const flags: ProcessFlag[] = [];
  const actions: SuggestedAction[] = [];

  for (const g of guest) {
    const t = norm(g.text);
    for (const [topic, re] of Object.entries(TOPIC_WORDS)) if (re.test(t)) topics.add(topic as Topic);
    if (NOT_INTERESTED.test(t)) topics.add("NOT_INTERESTED");
    if (WRONG.test(t)) topics.add("WRONG_PERSON");
    if (CALLBACK.test(t) || /saat \d/.test(t)) {
      if (CALLBACK.test(t)) topics.add("CALLBACK_REQUEST");
      const at = extractCallbackTime(g.text, now);
      if (CALLBACK.test(t) || at) actions.push({ type: "CALLBACK", at, note: g.text.slice(0, 160) });
    }
  }

  if (!NOTICE.test(agentEarly)) flags.push({ code: "RECORDING_NOTICE_MISSING", severity: "warning", message: "İlk 60 saniyede kayıt bildirimi duyulmadı (anons santralden yapıldıysa yok sayın)." });
  if (!INTRO.test(agentEarly)) flags.push({ code: "SELF_INTRO_MISSING", severity: "info", message: "İlk 60 saniyede temsilcinin kendini tanıttığı duyulmadı." });

  let mismatch = false;
  const optOut = guest.find((g) => OPT_OUT.test(norm(g.text)));
  if (optOut && disposition !== "DO_NOT_CONTACT") {
    mismatch = true;
    flags.push({ code: "OPT_OUT_NOT_RECORDED", severity: "critical", message: "Misafir iletişim istemediğini söylemiş görünüyor, sonuç kodu “İletişim istemiyor” değil. Kontrol edin.", evidence: optOut.text.slice(0, 160) });
  }
  if (topics.has("CALLBACK_REQUEST") && disposition && !["CALLBACK_REQUESTED", "DO_NOT_CONTACT"].includes(disposition)) {
    mismatch = true;
    flags.push({ code: "CALLBACK_NOT_RECORDED", severity: "warning", message: "Misafir geri arama istemiş görünüyor, sonuç kodu farklı." });
  }
  if (topics.has("WRONG_PERSON") && disposition && disposition !== "WRONG_PERSON") {
    mismatch = true;
    flags.push({ code: "WRONG_PERSON_NOT_RECORDED", severity: "warning", message: "“Yanlış kişi” ifadesi geçiyor, sonuç kodu farklı." });
  }

  const LABEL: Record<Topic, string> = {
    TRIP_INTEREST: "trip ilgisi", OFFER_PRICE: "teklif/fiyat", RESERVATION: "rezervasyon", COMPLAINT: "şikâyet",
    CALLBACK_REQUEST: "geri arama talebi", WRONG_PERSON: "yanlış kişi", NOT_INTERESTED: "ilgisiz",
  };
  const firstGuest = guest.find((g) => g.text.trim().length > 15)?.text.trim();
  const parts = [
    topics.size ? `Konular: ${[...topics].map((t) => LABEL[t]).join(", ")}.` : "Belirgin konu bulunamadı.",
    firstGuest ? `Misafirin ilk ifadesi: “${firstGuest.slice(0, 140)}${firstGuest.length > 140 ? "…" : ""}”` : "",
    actions.length ? `Öneri: ${actions[0].at ? "planlı " : ""}geri arama.` : "",
  ].filter(Boolean);

  return {
    summary: parts.join(" "),
    topics: [...topics],
    actions: actions.slice(0, 3),
    processFlags: flags,
    dispositionMismatch: mismatch,
    model: "rules",
    modelVersion: RULES_VERSION,
  };
}
