import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { handleWaEvents, templateStatusUpdate } from "@/server/services/whatsapp";
import { parseMetaWebhook, verifyMetaSignature } from "@/lib/whatsapp";

/**
 * WhatsApp Cloud API webhook'u.
 *   GET  : Meta abonelik doğrulaması (hub.mode=subscribe, hub.verify_token = WA_VERIFY_TOKEN → hub.challenge)
 *   POST : X-Hub-Signature-256 = "sha256=" + HMAC-SHA256(WA_APP_SECRET, ham gövde)
 */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const token = u.searchParams.get("hub.verify_token") ?? "";
  const expected = process.env.WA_VERIFY_TOKEN ?? "";
  const ok = u.searchParams.get("hub.mode") === "subscribe" && expected.length > 0 && token.length === expected.length && timingSafeEqual(Buffer.from(token), Buffer.from(expected));
  if (!ok) return new NextResponse("Doğrulanamadı", { status: 403 });
  return new NextResponse(u.searchParams.get("hub.challenge") ?? "", { status: 200 });
}

export async function POST(req: Request) {
  const raw = await req.text();
  if (raw.length > 256_000) return new NextResponse("Gövde çok büyük", { status: 413 });
  if (!verifyMetaSignature(process.env.WA_APP_SECRET, raw, req.headers.get("x-hub-signature-256"))) return new NextResponse("İmza geçersiz", { status: 401 });
  let body: { entry?: { changes?: { field?: string; value?: { event?: string; message_template_name?: string; message_template_language?: string } }[] }[] };
  try {
    body = JSON.parse(raw);
  } catch {
    return new NextResponse("JSON okunamadı", { status: 400 });
  }
  // Şablon onay durumu
  for (const e of body.entry ?? []) {
    for (const ch of e.changes ?? []) {
      if (ch.field === "message_template_status_update" && ch.value?.message_template_name && ch.value.event) {
        await templateStatusUpdate(ch.value.message_template_name, ch.value.message_template_language ?? "tr", ch.value.event);
      }
    }
  }
  const provider = process.env.WA_PROVIDER === "meta-cloud" ? "meta-cloud" : "mock";
  const r = await handleWaEvents(provider, parseMetaWebhook(body as never));
  // Meta 200 bekler; aksi halde yeniden dener
  return NextResponse.json(r);
}
