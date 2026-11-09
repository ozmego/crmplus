import "server-only";
import { db } from "@/server/db";

/**
 * Santral soyutlaması (plan v4 §3). Aşama 1 hedefi bulut santral (3CX / SIP sağlayıcı):
 * arama santral API'siyle başlatılır, numara tarayıcıya gönderilmez; süreler webhook'tan gelir.
 * Santral yapılandırılmamışsa veya hata verirse "manual" yedeğe düşülür ve TelephonyIncident açılır.
 *
 * Ortam değişkenleri:
 *   PBX_PROVIDER       manual | pbx-http   (varsayılan manual)
 *   PBX_DIAL_URL       santralin "çağrı başlat" uç noktası (pbx-http)
 *   PBX_API_TOKEN      Bearer belirteç
 *   PBX_WEBHOOK_SECRET webhook imza sırrı (HMAC-SHA256)
 */
export interface DialResult {
  provider: string;
  externalId?: string;
  /** Yalnız manuel modda: temsilcinin softphone'unu açan bağlantı. */
  dialUri?: string;
  fallback?: boolean;
}

export interface TelephonyProvider {
  readonly name: string;
  dial(args: { e164: string; agentExtension?: string | null; callId: string }): Promise<DialResult>;
}

export const manualProvider: TelephonyProvider = {
  name: "manual",
  async dial({ e164 }) {
    return { provider: "manual", dialUri: `tel:${e164}` };
  },
};

/**
 * Genel HTTP santral adaptörü. Beklenen sözleşme:
 *   POST PBX_DIAL_URL  {destination, extension, reference}  →  200 {id}
 * 3CX Call Control API'si veya SIP sağlayıcısının REST API'si için ince bir eşleme katmanı yeterlidir.
 */
export const httpPbxProvider: TelephonyProvider = {
  name: "pbx-http",
  async dial({ e164, agentExtension, callId }) {
    const url = process.env.PBX_DIAL_URL;
    if (!url) throw new Error("PBX_DIAL_URL tanımlı değil");
    if (!agentExtension) throw new Error("Temsilcinin santral dahili numarası tanımlı değil");
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.PBX_API_TOKEN ?? ""}` },
      body: JSON.stringify({ destination: e164, extension: agentExtension, reference: callId }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`Santral ${res.status} döndü`);
    const json = (await res.json().catch(() => ({}))) as { id?: string; callId?: string };
    const externalId = json.id ?? json.callId;
    if (!externalId) throw new Error("Santral çağrı kimliği döndürmedi");
    return { provider: "pbx-http", externalId };
  },
};

export function configuredProvider(): TelephonyProvider {
  return process.env.PBX_PROVIDER === "pbx-http" ? httpPbxProvider : manualProvider;
}

/** Santral ile ara; hata olursa manuel yedeğe düş ve olay kaydı aç. */
export async function dialWithFallback(args: { e164: string; agentExtension?: string | null; callId: string }): Promise<DialResult> {
  const provider = configuredProvider();
  if (provider.name === "manual") return manualProvider.dial(args);
  try {
    return await provider.dial(args);
  } catch (e) {
    await db.telephonyIncident.create({ data: { provider: provider.name, kind: "DIAL_FAILED", detail: (e as Error).message.slice(0, 500), callId: args.callId } });
    return { ...(await manualProvider.dial(args)), fallback: true };
  }
}

export function isPbxMode() {
  return configuredProvider().name !== "manual";
}
