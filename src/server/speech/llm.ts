import "server-only";
import type { Segment } from "@/lib/speech-analysis";

/**
 * Yerel dil modeliyle özet (Ollama, şirket içi). Yalnız MASKELENMİŞ metin gönderilir.
 * OLLAMA_URL tanımsızsa null döner; özet kural tabanlı üretilir.
 * Talimat: yalnız olgusal özet; duygu, kişilik, ikna edilebilirlik, kumar davranışı veya skor üretme.
 */
export async function llmSummary(segments: Segment[]): Promise<{ summary: string; model: string; modelVersion: string } | null> {
  const url = process.env.OLLAMA_URL;
  const model = process.env.OLLAMA_MODEL ?? "qwen2.5:14b-instruct";
  if (!url) return null;
  const transcript = segments.map((s) => `${s.speaker === "AGENT" ? "Temsilci" : "Misafir"}: ${s.text}`).join("\n").slice(0, 12_000);
  const prompt = [
    "Aşağıdaki çağrı merkezi görüşmesini Türkçe olarak en fazla 3 cümleyle, yalnız olgulara dayanarak özetle.",
    "Misafirin taleplerini ve verilen sözleri yaz. Duygu, kişilik, ikna edilebilirlik, kumar davranışı veya herhangi bir skor ÜRETME.",
    'Yanıtı yalnız şu JSON biçiminde ver: {"summary": "..."}',
    "",
    transcript,
  ].join("\n");
  const res = await fetch(`${url.replace(/\/$/, "")}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, prompt, format: "json", stream: false, options: { temperature: 0 } }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`LLM ${res.status}`);
  const j = (await res.json()) as { response?: string };
  const parsed = JSON.parse(j.response ?? "{}") as { summary?: unknown };
  if (typeof parsed.summary !== "string" || !parsed.summary.trim()) throw new Error("LLM geçersiz yanıt");
  return { summary: parsed.summary.trim().slice(0, 800), model: `ollama:${model}`, modelVersion: model };
}
