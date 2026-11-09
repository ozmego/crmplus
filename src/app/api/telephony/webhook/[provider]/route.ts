import { NextResponse } from "next/server";
import { db } from "@/server/db";
import { verifySignature } from "@/lib/webhook-signature";
import { eventSchema, handleTelephonyEvent } from "@/server/telephony/webhook";

/**
 * Santral webhook'u. Başlıklar:
 *   x-crmplus-timestamp: unix saniye
 *   x-crmplus-signature: hex HMAC-SHA256(PBX_WEBHOOK_SECRET, `${timestamp}.${gövde}`)
 */
export async function POST(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  if (!/^[a-z0-9-]{2,32}$/.test(provider)) return new NextResponse("Bilinmeyen sağlayıcı", { status: 404 });
  const raw = await req.text();
  if (raw.length > 64_000) return new NextResponse("Gövde çok büyük", { status: 413 });

  const sig = verifySignature({
    secret: process.env.PBX_WEBHOOK_SECRET,
    timestamp: req.headers.get("x-crmplus-timestamp"),
    signature: req.headers.get("x-crmplus-signature"),
    rawBody: raw,
  });
  if (!sig.ok) {
    await db.telephonyIncident.create({ data: { provider, kind: "WEBHOOK_INVALID", detail: `İmza doğrulanamadı: ${sig.error}` } });
    return new NextResponse("İmza geçersiz", { status: 401 });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return new NextResponse("JSON okunamadı", { status: 400 });
  }
  const parsed = eventSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Geçersiz olay", issues: parsed.error.issues.map((i) => i.path.join(".")) }, { status: 400 });

  const r = await handleTelephonyEvent(provider, parsed.data);
  return NextResponse.json(r, { status: r.status === "unknown_call" ? 202 : 200 });
}
