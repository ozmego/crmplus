import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import { db } from "@/server/db";

export const SESSION_COOKIE = "crm_session";

const idleMs = () => Number(process.env.SESSION_IDLE_MINUTES ?? 30) * 60_000;
const maxMs = () => Number(process.env.SESSION_MAX_HOURS ?? 12) * 3_600_000;

const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

export async function clientInfo() {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? null;
  return { ip, userAgent: h.get("user-agent") };
}

/** Yeni oturum açar ve çerezi yazar. Yalnız Server Action / Route Handler içinden çağrılır. */
export async function createSession(userId: string, mfaVerified: boolean) {
  const token = randomBytes(32).toString("base64url");
  const { ip, userAgent } = await clientInfo();
  const expiresAt = new Date(Date.now() + maxMs());
  await db.session.create({
    data: { id: hashToken(token), userId, mfaVerified, expiresAt, ip, userAgent },
  });
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    expires: expiresAt,
  });
}

export async function markSessionMfaVerified() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return;
  await db.session.update({ where: { id: hashToken(token) }, data: { mfaVerified: true } });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    await db.session.updateMany({ where: { id: hashToken(token) }, data: { revokedAt: new Date() } });
  }
  jar.delete(SESSION_COOKIE);
}

/** Tüm oturumları kapatır (pasifleştirme, şifre değişimi). */
export async function revokeAllSessions(userId: string) {
  await db.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
}

/** Geçerli oturumu döndürür; süresi dolmuş/iptal edilmiş/hareketsiz oturum null döner. */
export async function readSession() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await db.session.findUnique({ where: { id: hashToken(token) }, include: { user: true } });
  if (!session || session.revokedAt) return null;
  const now = Date.now();
  if (session.expiresAt.getTime() < now) return null;
  if (now - session.lastSeenAt.getTime() > idleMs()) return null;
  if (session.user.status !== "ACTIVE") return null;
  if (now - session.lastSeenAt.getTime() > 60_000) {
    await db.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } });
  }
  return session;
}
