import "server-only";
import { db } from "@/server/db";
import { readSession, revokeAllSessions } from "@/server/auth/session";
import { newMfaSecret } from "@/server/auth/mfa";
import { decrypt, encrypt } from "@/server/crypto/field-encryption";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { audit } from "@/server/audit";

let dummyHash: Promise<string> | null = null;
/** Bilinmeyen kullanıcıda da gerçek bir doğrulama süresi harcanır (kullanıcı varlığı sızmaz). */
export function burnPasswordCheck(password: string) {
  dummyHash ??= hashPassword("crmplus-timing-equalizer");
  return dummyHash.then((h) => verifyPassword(h, password));
}

/** MFA kurulum ekranı için sırrı üretir veya mevcut (henüz onaylanmamış) sırrı döndürür. */
export async function ensureMfaSecret(): Promise<string | null> {
  const session = await readSession();
  if (!session || session.user.mfaEnabledAt) return null;
  if (session.user.mfaSecretEnc) return decrypt(session.user.mfaSecretEnc);
  const secret = newMfaSecret();
  await db.user.update({ where: { id: session.userId }, data: { mfaSecretEnc: encrypt(secret) } });
  return secret;
}

/** Kullanıcıyı pasifleştirir, tüm oturumları anında kapatır, açık işleri ekip liderine aktarır. */
export async function disableUserNow(userId: string, actorId: string, reason: string) {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId }, include: { team: true } });
  const leaderId = user.team?.leaderId && user.team.leaderId !== userId ? user.team.leaderId : null;
  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { status: "DISABLED", disabledAt: new Date() } });
    if (leaderId) {
      await tx.task.updateMany({ where: { assigneeId: userId, status: { in: ["OPEN", "IN_PROGRESS"] } }, data: { assigneeId: leaderId } });
      await tx.callback.updateMany({ where: { assigneeId: userId, status: "PENDING" }, data: { assigneeId: leaderId } });
    }
  });
  await revokeAllSessions(userId);
  await audit({ actorId, action: "user.disabled", entity: "User", entityId: userId, reason, diff: { reassignedTo: leaderId } });
}
