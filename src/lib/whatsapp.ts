/**
 * WhatsApp Business kuralları — saf fonksiyonlar (docs/10 §3, §4, §6; plan v4 §6).
 * - Misafirin son mesajından sonraki 24 saat içinde serbest yanıt; dışında yalnız Meta'da onaylı şablon.
 * - Şablon değişkenleri SMS ile aynı beyaz listeden; finansal değişken yok.
 * - Pazarlama şablonunda “Aboneliği iptal et” hızlı yanıtı zorunlu.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { ALLOWED_VARS, checkTemplate, isOptOut } from "./sms";

export const WINDOW_MS = 24 * 3600_000;
export const OPT_OUT_PAYLOAD = "OPT_OUT";

export function windowState(lastInboundAt: Date | null | undefined, now = new Date()) {
  if (!lastInboundAt) return { open: false, closesAt: null as Date | null };
  const closesAt = new Date(lastInboundAt.getTime() + WINDOW_MS);
  return { open: closesAt > now, closesAt };
}

/** {{1}} … {{n}} yer tutucuları sırayla `variables` listesindeki alanlara karşılık gelir. */
export function placeholders(body: string): number[] {
  return [...body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
}

export function checkWaTemplate(t: { name: string; body: string; variables: string[]; category: "MARKETING" | "UTILITY"; optOutButton: boolean }) {
  const errors: string[] = [];
  if (!/^[a-z0-9_]{3,100}$/.test(t.name)) errors.push("Şablon adı yalnız küçük harf, rakam ve alt çizgi içermeli (Meta kuralı).");
  const ph = placeholders(t.body);
  const uniq = [...new Set(ph)].sort((a, b) => a - b);
  if (uniq.some((n, i) => n !== i + 1)) errors.push("Yer tutucular {{1}}'den başlayıp sırayla artmalı.");
  if (uniq.length !== t.variables.length) errors.push(`${uniq.length} yer tutucu var, ${t.variables.length} değişken tanımlı.`);
  for (const v of t.variables) if (!(ALLOWED_VARS as readonly string[]).includes(v)) errors.push(`{${v}} izinli değişken değil.`);
  if (t.category === "MARKETING" && !t.optOutButton) errors.push("Pazarlama şablonunda “Aboneliği iptal et” hızlı yanıtı zorunlu.");
  // İçerik kuralları SMS ile ortak (finansal değişken, riskli ifade)
  const asSms = t.body.replace(/\{\{(\d+)\}\}/g, (_, n) => `{${t.variables[Number(n) - 1] ?? "bilinmeyen"}}`);
  const c = checkTemplate(asSms, t.category === "MARKETING" ? "MARKETING" : "INFORMATIONAL");
  return { errors: [...errors, ...c.errors.filter((e) => !errors.some((x) => x.includes(e)))], warnings: c.warnings };
}

export function renderWaTemplate(body: string, variables: string[], values: Record<string, string>): string {
  return body.replace(/\{\{(\d+)\}\}/g, (_, n) => values[variables[Number(n) - 1]] ?? "");
}

/**
 * Belirsiz ret ifadeleri (docs/10 §6): kesin ret değil ama gelen kutusunda en üste alınır;
 * temsilci tek tıkla durdurma kaydı açar.
 */
const SUSPECT = [/yazmay[ıi]n/i, /rahats[ıi]z\s+etme/i, /bir\s+daha\s+(yazma|arama|mesaj)/i, /engelle/i, /numaram[ıi]\s+sil/i, /listeden\s+[çc][ıi]kar/i, /ilgilenmiyorum/i];
export function optOutSuspect(text: string): boolean {
  return !isOptOut(text) && SUSPECT.some((r) => r.test(text));
}

// ───────────── Meta Cloud API webhook ─────────────

/** X-Hub-Signature-256: "sha256=" + hex HMAC-SHA256(app secret, ham gövde). */
export function verifyMetaSignature(secret: string | undefined, rawBody: string, header: string | null): boolean {
  if (!secret || !header?.startsWith("sha256=")) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(rawBody).digest("hex"));
  const got = Buffer.from(header.slice(7));
  return expected.length === got.length && timingSafeEqual(expected, got);
}

export type WaEvent =
  | { kind: "message"; id: string; from: string; at: Date; text: string; buttonPayload?: string; type: string }
  | { kind: "status"; id: string; status: "sent" | "delivered" | "read" | "failed"; at: Date; recipient: string; errorCode?: number };

interface MetaPayload {
  entry?: {
    changes?: {
      value?: {
        messages?: { id: string; from: string; timestamp: string; type: string; text?: { body: string }; button?: { payload?: string; text?: string }; interactive?: { button_reply?: { id: string; title: string } } }[];
        statuses?: { id: string; status: string; timestamp: string; recipient_id: string; errors?: { code: number }[] }[];
      };
    }[];
  }[];
}

export function parseMetaWebhook(p: MetaPayload): WaEvent[] {
  const out: WaEvent[] = [];
  for (const e of p.entry ?? []) {
    for (const ch of e.changes ?? []) {
      for (const m of ch.value?.messages ?? []) {
        const buttonPayload = m.button?.payload ?? m.interactive?.button_reply?.id;
        const text = m.text?.body ?? m.button?.text ?? m.interactive?.button_reply?.title ?? `[${m.type}]`;
        out.push({ kind: "message", id: m.id, from: m.from.startsWith("+") ? m.from : `+${m.from}`, at: new Date(Number(m.timestamp) * 1000), text, buttonPayload, type: m.type });
      }
      for (const s of ch.value?.statuses ?? []) {
        if (!["sent", "delivered", "read", "failed"].includes(s.status)) continue;
        out.push({ kind: "status", id: s.id, status: s.status as "sent", at: new Date(Number(s.timestamp) * 1000), recipient: s.recipient_id, errorCode: s.errors?.[0]?.code });
      }
    }
  }
  return out;
}

/** Meta hata kodları: 131026 = alıcı WhatsApp kullanmıyor/ulaşılamıyor → yalnız WhatsApp için uygun değil. */
export const NOT_ON_WHATSAPP = new Set([131026]);
