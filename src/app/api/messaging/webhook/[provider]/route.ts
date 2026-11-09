import { NextResponse } from "next/server";
import { verifySignature } from "@/lib/webhook-signature";
import { handleMessagingEvent, inboundSchema } from "@/server/services/messaging";

/**
 * SMS sağlayıcı webhook'u: gelen mesaj (RET işleme) ve teslim raporu. İmza santral webhook'uyla aynı biçimde:
 *   x-crmplus-timestamp, x-crmplus-signature = hex HMAC-SHA256(SMS_WEBHOOK_SECRET, `${timestamp}.${gövde}`)
 */
export async function POST(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  if (!/^[a-z0-9-]{2,32}$/.test(provider)) return new NextResponse("Bilinmeyen sağlayıcı", { status: 404 });
  const raw = await req.text();
  if (raw.length > 32_000) return new NextResponse("Gövde çok büyük", { status: 413 });

  const sig = verifySignature({
    secret: process.env.SMS_WEBHOOK_SECRET,
    timestamp: req.headers.get("x-crmplus-timestamp"),
    signature: req.headers.get("x-crmplus-signature"),
    rawBody: raw,
  });
  if (!sig.ok) return new NextResponse("İmza geçersiz", { status: 401 });

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return new NextResponse("JSON okunamadı", { status: 400 });
  }
  const parsed = inboundSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Geçersiz olay", issues: parsed.error.issues.map((i) => i.path.join(".")) }, { status: 400 });

  const r = await handleMessagingEvent(provider, parsed.data);
  return NextResponse.json(r, { status: r.status === "unknown_message" ? 202 : 200 });
}
