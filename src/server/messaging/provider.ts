import "server-only";
import { randomUUID } from "node:crypto";

/**
 * SMS sağlayıcı soyutlaması (docs/10). Sağlayıcı seçilince (Netgsm / İleti Merkezi) yalnız ayar girilir.
 *   SMS_PROVIDER = mock | sms-http      (üretimde mock kullanılamaz)
 *   SMS_SEND_URL, SMS_API_TOKEN, SMS_SENDER (BTK onaylı başlık)
 *   SMS_OPT_OUT_TEXT  pazarlama mesajlarına eklenecek ret metni
 *   SMS_WEBHOOK_SECRET  gelen mesaj / teslim raporu webhook imzası
 *   SMS_TPS  saniyedeki en fazla gönderim
 */
export interface SmsSendResult {
  provider: string;
  providerMessageId: string;
}
export interface SmsProvider {
  readonly name: string;
  send(args: { to: string; text: string; reference: string }): Promise<SmsSendResult>;
}

const mockProvider: SmsProvider = {
  name: "mock",
  async send() {
    return { provider: "mock", providerMessageId: `mock-${randomUUID()}` };
  },
};

/** Genel HTTP adaptörü: POST SMS_SEND_URL {to, text, sender, reference} → 200 {id}. */
const httpProvider: SmsProvider = {
  name: "sms-http",
  async send({ to, text, reference }) {
    const url = process.env.SMS_SEND_URL;
    if (!url) throw new Error("SMS_SEND_URL tanımlı değil");
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.SMS_API_TOKEN ?? ""}` },
      body: JSON.stringify({ to, text, sender: process.env.SMS_SENDER, reference }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`SMS sağlayıcısı ${res.status}`);
    const j = (await res.json().catch(() => ({}))) as { id?: string; messageId?: string };
    const id = j.id ?? j.messageId;
    if (!id) throw new Error("SMS sağlayıcısı mesaj kimliği döndürmedi");
    return { provider: "sms-http", providerMessageId: id };
  },
};

export function smsProvider(): SmsProvider {
  const p = process.env.SMS_PROVIDER ?? (process.env.NODE_ENV === "production" ? "" : "mock");
  if (p === "sms-http") return httpProvider;
  if (p === "mock" && process.env.NODE_ENV !== "production") return mockProvider;
  throw new Error("SMS sağlayıcısı yapılandırılmamış");
}

export const optOutText = () => process.env.SMS_OPT_OUT_TEXT ?? "Listeden çıkmak için RET yazıp gönderin.";

// İYS adaptörü ayrı modüldedir: src/server/messaging/iys.ts
export { iysCheck, type IysResult } from "@/server/messaging/iys";
