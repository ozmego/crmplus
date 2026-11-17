import { NextResponse } from "next/server";
import { db } from "@/server/db";
import { redisConnection } from "@/server/queue";

/**
 * Sağlık kontrolü (Docker/Caddy/izleme). Kimlik doğrulama istemez; yalnız bileşen durumunu döner,
 * sürüm, yapılandırma veya veri bilgisi vermez.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const checks: Record<string, "ok" | "fail"> = {};
  try {
    await db.$queryRaw`SELECT 1`;
    checks.db = "ok";
  } catch {
    checks.db = "fail";
  }
  try {
    const r = redisConnection();
    checks.redis = (await Promise.race([r.ping(), new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 2000))])) === "PONG" ? "ok" : "fail";
  } catch {
    checks.redis = "fail";
  }
  const ok = Object.values(checks).every((v) => v === "ok");
  return NextResponse.json({ status: ok ? "ok" : "degraded", checks }, { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
