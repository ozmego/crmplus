import "server-only";
import type { Segment } from "@/lib/speech-analysis";

/**
 * Transkript motoru soyutlaması. Ses şirket dışına çıkmaz.
 *   TRANSCRIBER=remote  → SPEECH_URL (şirket içi Python servisi: faster-whisper, speech/ klasörü)
 *   TRANSCRIBER=mock    → geliştirme/test için sabit Türkçe görüşme (gerçek tanıma yapmaz)
 * Üretimde TRANSCRIBER tanımsızsa açık hata verilir; sahte transkript üretilmez.
 */
export interface TranscribeInput {
  audio: Buffer;
  mimeType: string;
  channels: number;
  language: "tr";
  vocabulary: string[];
}
export interface TranscribeOutput {
  language: string;
  model: string;
  modelVersion: string;
  confidence: number; // 0–1, ortalama
  segments: Segment[];
}

export async function transcribe(input: TranscribeInput): Promise<TranscribeOutput> {
  const engine = process.env.TRANSCRIBER ?? (process.env.NODE_ENV === "production" ? "" : "mock");
  if (engine === "remote") return remoteTranscribe(input);
  if (engine === "mock") return mockTranscribe(input);
  throw new Error("TRANSCRIBER yapılandırılmamış (remote | mock)");
}

async function remoteTranscribe(input: TranscribeInput): Promise<TranscribeOutput> {
  const url = process.env.SPEECH_URL;
  if (!url) throw new Error("SPEECH_URL tanımlı değil");
  const form = new FormData();
  form.append("audio", new Blob([new Uint8Array(input.audio)], { type: input.mimeType }), "call");
  form.append("channels", String(input.channels));
  form.append("language", input.language);
  form.append("vocabulary", input.vocabulary.join(","));
  const res = await fetch(`${url.replace(/\/$/, "")}/transcribe`, {
    method: "POST",
    body: form,
    headers: process.env.SPEECH_TOKEN ? { Authorization: `Bearer ${process.env.SPEECH_TOKEN}` } : {},
    signal: AbortSignal.timeout(15 * 60_000),
  });
  if (!res.ok) throw new Error(`Transkript servisi ${res.status}`);
  const j = (await res.json()) as TranscribeOutput;
  if (!Array.isArray(j.segments)) throw new Error("Transkript servisi geçersiz yanıt döndü");
  return j;
}

/** Sabit görüşme: maskeleme (telefon, kart), iletişim istememe ve geri arama kurallarını sınamak için. */
function mockTranscribe(input: TranscribeInput): TranscribeOutput {
  const seed = input.audio.subarray(0, 4).toString("hex");
  return {
    language: "tr",
    model: "mock",
    modelVersion: `mock-1:${seed}`,
    confidence: 0.92,
    segments: [
      { speaker: "AGENT", start: 0, end: 6, text: "Merhaba, ben Deniz, crmPlus adına arıyorum. Görüşmemiz kalite için kayıt altına alınmaktadır." },
      { speaker: "GUEST", start: 7, end: 14, text: "Merhaba. Aralık'taki Kıbrıs tripi için otel ve fiyat bilgisi almak istiyorum." },
      { speaker: "AGENT", start: 15, end: 20, text: "Tabii, size uygun tarihleri iletebilirim." },
      { speaker: "GUEST", start: 21, end: 30, text: "Numaram 0532 410 22 17, kartım 4111 1111 1111 1111 ama şu an müsait değilim, yarın saat 15:30'da tekrar arayın." },
      { speaker: "GUEST", start: 31, end: 36, text: "Bir de lütfen kampanya için beni bir daha aramayın, sadece bu trip için konuşalım." },
    ],
  };
}
