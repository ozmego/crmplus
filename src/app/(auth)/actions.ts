"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { z } from "zod";
import { db } from "@/server/db";
import { hashPassword, passwordPolicyError, verifyPassword } from "@/server/auth/password";
import { hashRecoveryCode, newRecoveryCodes, verifyTotp } from "@/server/auth/mfa";
import { clientInfo, createSession, destroySession, markSessionMfaVerified, readSession } from "@/server/auth/session";
import { burnPasswordCheck } from "@/server/auth/account";
import { decrypt } from "@/server/crypto/field-encryption";
import { audit } from "@/server/audit";
import { LOCALE_COOKIE } from "@/i18n/request";

export type FormState = { error?: string; errorParams?: Record<string, string | number>; codes?: string[] } | undefined;

const LOCK_AFTER = 5;
const DISABLE_AFTER = 10;
const LOCK_MINUTES = 15;

export async function loginAction(_: FormState, formData: FormData): Promise<FormState> {
  const parsed = z
    .object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1).max(200) })
    .safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return { error: "invalid" };
  const { email, password } = parsed.data;
  const { ip } = await clientInfo();

  const since = new Date(Date.now() - LOCK_MINUTES * 60_000);
  const recentFails = await db.loginAttempt.count({
    where: { success: false, createdAt: { gte: since }, OR: [{ email }, ...(ip ? [{ ip }] : [])] },
  });
  if (recentFails >= 20) return { error: "rateLimited" };

  const user = await db.user.findUnique({ where: { email } });
  if (!user) {
    await burnPasswordCheck(password);
    await db.loginAttempt.create({ data: { email, ip, success: false, reason: "unknown_user" } });
    return { error: "invalid" };
  }
  if (user.status === "DISABLED" || user.status === "LOCKED") {
    await db.loginAttempt.create({ data: { email, ip, success: false, reason: user.status.toLowerCase() } });
    return { error: "disabled" };
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    const minutes = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000);
    return { error: "locked", errorParams: { minutes } };
  }

  if (!(await verifyPassword(user.passwordHash, password))) {
    const fails = user.failedLogins + 1;
    await db.user.update({
      where: { id: user.id },
      data: {
        failedLogins: fails,
        lockedUntil: fails >= LOCK_AFTER ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null,
        status: fails >= DISABLE_AFTER ? "LOCKED" : undefined,
      },
    });
    await db.loginAttempt.create({ data: { email, ip, success: false, reason: "bad_password" } });
    if (fails >= DISABLE_AFTER) await audit({ actorId: null, action: "user.auto_locked", entity: "User", entityId: user.id });
    return { error: "invalid" };
  }

  await db.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() } });
  await db.loginAttempt.create({ data: { email, ip, success: true } });
  await createSession(user.id, false);
  await audit({ actorId: user.id, action: "auth.password_ok", entity: "User", entityId: user.id });
  redirect(user.mustChangePassword ? "/change-password" : "/mfa");
}

export async function changePasswordAction(_: FormState, formData: FormData): Promise<FormState> {
  const session = await readSession();
  if (!session) redirect("/login");
  const pw = String(formData.get("password") ?? "");
  const pw2 = String(formData.get("password2") ?? "");
  if (pw !== pw2) return { error: "mismatch" };
  const policy = passwordPolicyError(pw);
  if (policy) return { error: "policy", errorParams: { message: policy } };
  if (await verifyPassword(session.user.passwordHash, pw)) return { error: "samePassword" };
  // İlk giriş dışında şifre değişimi MFA doğrulaması ister
  if (!session.user.mustChangePassword && !session.mfaVerified) redirect("/mfa");

  await db.user.update({ where: { id: session.userId }, data: { passwordHash: await hashPassword(pw), mustChangePassword: false } });
  await db.session.updateMany({
    where: { userId: session.userId, revokedAt: null, NOT: { id: session.id } },
    data: { revokedAt: new Date() },
  });
  await audit({ actorId: session.userId, action: "auth.password_changed", entity: "User", entityId: session.userId });
  redirect(session.mfaVerified ? "/" : "/mfa");
}

export async function setupMfaAction(_: FormState, formData: FormData): Promise<FormState> {
  const session = await readSession();
  if (!session) redirect("/login");
  if (session.user.mustChangePassword) redirect("/change-password");
  if (session.user.mfaEnabledAt || !session.user.mfaSecretEnc) redirect("/mfa");
  const secret = decrypt(session.user.mfaSecretEnc);
  if (!verifyTotp(secret, String(formData.get("code") ?? ""))) return { error: "mfaInvalid" };

  const { plain, hashes } = newRecoveryCodes();
  await db.$transaction([
    db.user.update({ where: { id: session.userId }, data: { mfaEnabledAt: new Date() } }),
    db.mfaRecoveryCode.deleteMany({ where: { userId: session.userId } }),
    db.mfaRecoveryCode.createMany({ data: hashes.map((codeHash) => ({ userId: session.userId, codeHash })) }),
  ]);
  await markSessionMfaVerified();
  await audit({ actorId: session.userId, action: "auth.mfa_enabled", entity: "User", entityId: session.userId });
  return { codes: plain };
}

export async function verifyMfaAction(_: FormState, formData: FormData): Promise<FormState> {
  const session = await readSession();
  if (!session) redirect("/login");
  if (session.user.mustChangePassword) redirect("/change-password");
  if (!session.user.mfaEnabledAt || !session.user.mfaSecretEnc) redirect("/mfa");

  const code = String(formData.get("code") ?? "").trim();
  let ok = verifyTotp(decrypt(session.user.mfaSecretEnc), code);
  if (!ok && code.length >= 8) {
    const rc = await db.mfaRecoveryCode.findFirst({
      where: { userId: session.userId, codeHash: hashRecoveryCode(code), usedAt: null },
    });
    if (rc) {
      await db.mfaRecoveryCode.update({ where: { id: rc.id }, data: { usedAt: new Date() } });
      await audit({ actorId: session.userId, action: "auth.recovery_code_used", entity: "User", entityId: session.userId });
      ok = true;
    }
  }
  if (!ok) {
    await audit({ actorId: session.userId, action: "auth.mfa_failed", entity: "User", entityId: session.userId });
    return { error: "mfaInvalid" };
  }
  await markSessionMfaVerified();
  await audit({ actorId: session.userId, action: "auth.login", entity: "User", entityId: session.userId });
  redirect("/");
}

export async function logoutAction() {
  const session = await readSession();
  if (session) await audit({ actorId: session.userId, action: "auth.logout", entity: "User", entityId: session.userId });
  await destroySession();
  redirect("/login");
}

export async function setLocaleAction(formData: FormData) {
  const locale = formData.get("locale") === "en" ? "en" : "tr";
  (await cookies()).set(LOCALE_COOKIE, locale, { path: "/", sameSite: "lax", maxAge: 60 * 60 * 24 * 365 });
}
