import "server-only";
import { randomUUID } from "node:crypto";

/**
 * WhatsApp Business Platform sağlayıcısı (resmi Cloud API). Kişisel hesap otomasyonu yoktur.
 *   WA_PROVIDER = meta-cloud | mock (yalnız geliştirme)
 *   WA_PHONE_NUMBER_ID, WA_ACCESS_TOKEN, WA_GRAPH_VERSION (vars. v21.0)
 *   WA_APP_SECRET   webhook imzası (X-Hub-Signature-256)
 *   WA_VERIFY_TOKEN webhook doğrulama (GET hub.challenge)
 */
export interface WaProvider {
  readonly name: string;
  sendTemplate(a: { to: string; name: string; language: string; params: string[] }): Promise<{ id: string }>;
  sendText(a: { to: string; text: string }): Promise<{ id: string }>;
  /** Şablonu Meta onayına gönderir; sahte sağlayıcı anında onaylar. */
  submitTemplate(a: { name: string; language: string; category: string; body: string; optOutButton: boolean }): Promise<{ status: "PENDING" | "APPROVED" }>;
}

const mock: WaProvider = {
  name: "mock",
  async sendTemplate() {
    return { id: `wamid.mock-${randomUUID()}` };
  },
  async sendText() {
    return { id: `wamid.mock-${randomUUID()}` };
  },
  async submitTemplate() {
    return { status: "APPROVED" };
  },
};

async function graph(path: string, body: unknown) {
  const v = process.env.WA_GRAPH_VERSION ?? "v21.0";
  const res = await fetch(`https://graph.facebook.com/${v}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.WA_ACCESS_TOKEN ?? ""}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const j = (await res.json().catch(() => ({}))) as { messages?: { id: string }[]; id?: string; error?: { message?: string; code?: number } };
  if (!res.ok) throw new Error(`WhatsApp API ${res.status}${j.error?.code ? ` (${j.error.code})` : ""}`);
  return j;
}

const metaCloud: WaProvider = {
  name: "meta-cloud",
  async sendTemplate({ to, name, language, params }) {
    const j = await graph(`${process.env.WA_PHONE_NUMBER_ID}/messages`, {
      messaging_product: "whatsapp", to: to.replace(/^\+/, ""), type: "template",
      template: { name, language: { code: language }, components: params.length ? [{ type: "body", parameters: params.map((text) => ({ type: "text", text })) }] : [] },
    });
    const id = j.messages?.[0]?.id;
    if (!id) throw new Error("WhatsApp API mesaj kimliği döndürmedi");
    return { id };
  },
  async sendText({ to, text }) {
    const j = await graph(`${process.env.WA_PHONE_NUMBER_ID}/messages`, { messaging_product: "whatsapp", to: to.replace(/^\+/, ""), type: "text", text: { body: text } });
    const id = j.messages?.[0]?.id;
    if (!id) throw new Error("WhatsApp API mesaj kimliği döndürmedi");
    return { id };
  },
  async submitTemplate({ name, language, category, body, optOutButton }) {
    await graph(`${process.env.WA_BUSINESS_ACCOUNT_ID}/message_templates`, {
      name, language, category,
      components: [{ type: "BODY", text: body }, ...(optOutButton ? [{ type: "BUTTONS", buttons: [{ type: "QUICK_REPLY", text: "Aboneliği iptal et" }] }] : [])],
    });
    return { status: "PENDING" };
  },
};

export function waProvider(): WaProvider {
  const p = process.env.WA_PROVIDER ?? (process.env.NODE_ENV === "production" ? "" : "mock");
  if (p === "meta-cloud") return metaCloud;
  if (p === "mock" && process.env.NODE_ENV !== "production") return mock;
  throw new Error("WhatsApp sağlayıcısı yapılandırılmamış");
}
