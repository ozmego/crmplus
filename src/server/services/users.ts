import "server-only";
import { randomBytes } from "node:crypto";
import { db } from "@/server/db";
import type { Principal } from "@/server/auth/rbac";
import { audit } from "@/server/audit";
import { hashPassword } from "@/server/auth/password";
import { disableUserNow } from "@/server/auth/account";
import { revokeAllSessions } from "@/server/auth/session";

/** Kullanıcı ve ekip yönetimi (docs/01 §6–7). Tüm işlemler gerekçeli ve denetim kayıtlı. */

export class UserAdminError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

/** Okunaklı geçici şifre: karışmayan harf/rakam, 16 karakter. Politika (harf + rakam) garanti. */
export function tempPassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz";
  const digits = "23456789";
  const bytes = randomBytes(16);
  const chars = [...bytes].map((b, i) => (i % 4 === 3 ? digits[b % digits.length] : alphabet[b % alphabet.length]));
  return chars.join("");
}

export async function listUsers() {
  return db.user.findMany({
    orderBy: [{ status: "asc" }, { name: "asc" }],
    select: {
      id: true, email: true, name: true, status: true, lastLoginAt: true, mfaEnabledAt: true, lockedUntil: true, failedLogins: true,
      team: { select: { id: true, name: true } },
      roles: { select: { role: { select: { id: true, key: true, name: true } } } },
    },
  });
}

export async function createUser(actor: Principal, input: { email: string; name: string; teamId?: string | null; roleKeys: string[]; reason: string }) {
  const email = input.email.trim().toLowerCase();
  if (await db.user.findUnique({ where: { email } })) throw new UserAdminError("EMAIL_EXISTS");
  const roles = await db.role.findMany({ where: { key: { in: input.roleKeys } } });
  if (roles.length !== input.roleKeys.length) throw new UserAdminError("UNKNOWN_ROLE");
  const password = tempPassword();
  const user = await db.user.create({
    data: {
      email, name: input.name.trim(), teamId: input.teamId || null, passwordHash: await hashPassword(password), mustChangePassword: true,
      roles: { create: roles.map((r) => ({ roleId: r.id, assignedBy: actor.id })) },
    },
  });
  await audit({ actorId: actor.id, action: "user.create", entity: "User", entityId: user.id, reason: input.reason, diff: { email, roles: input.roleKeys, teamId: input.teamId ?? null } });
  return { id: user.id, tempPassword: password };
}

export async function setUserRoles(actor: Principal, userId: string, roleKeys: string[], reason: string) {
  if (userId === actor.id) throw new UserAdminError("SELF_ASSIGN");
  const user = await db.user.findUnique({ where: { id: userId }, include: { roles: { include: { role: true } } } });
  if (!user) throw new UserAdminError("NOT_FOUND");
  const roles = await db.role.findMany({ where: { key: { in: roleKeys } } });
  if (roles.length !== roleKeys.length) throw new UserAdminError("UNKNOWN_ROLE");
  const before = user.roles.map((r) => r.role.key).sort();
  await db.$transaction([
    db.userRole.deleteMany({ where: { userId } }),
    db.userRole.createMany({ data: roles.map((r) => ({ userId, roleId: r.id, assignedBy: actor.id })) }),
  ]);
  // Yetki değişince açık oturumlar yeniden giriş ister (yeni izinler hemen ve kesin uygulansın)
  await revokeAllSessions(userId);
  await audit({ actorId: actor.id, action: "role.assign", entity: "User", entityId: userId, reason, diff: { before, after: [...roleKeys].sort() } });
}

export async function setUserTeam(actor: Principal, userId: string, teamId: string | null, reason: string) {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) throw new UserAdminError("NOT_FOUND");
  await db.user.update({ where: { id: userId }, data: { teamId } });
  await audit({ actorId: actor.id, action: "user.team", entity: "User", entityId: userId, reason, diff: { before: user.teamId, after: teamId } });
}

/** Santral dahili numarası (3CX makecall bu dahiliyi çaldırır). Aynı dahili iki etkin kullanıcıya verilemez. */
export async function setUserExtension(actor: Principal, userId: string, extension: string | null, reason: string) {
  const ext = extension?.trim() || null;
  if (ext && !/^\d{2,8}$/.test(ext)) throw new UserAdminError("BAD_EXTENSION");
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) throw new UserAdminError("NOT_FOUND");
  if (ext && (await db.user.findFirst({ where: { extension: ext, status: "ACTIVE", NOT: { id: userId } } }))) throw new UserAdminError("EXTENSION_TAKEN");
  await db.user.update({ where: { id: userId }, data: { extension: ext } });
  await audit({ actorId: actor.id, action: "user.extension", entity: "User", entityId: userId, reason, diff: { before: user.extension, after: ext } });
}

export async function disableUser(actor: Principal, userId: string, reason: string) {
  if (userId === actor.id) throw new UserAdminError("SELF_DISABLE");
  await disableUserNow(userId, actor.id, reason);
}

export async function enableUser(actor: Principal, userId: string, reason: string) {
  await db.user.update({ where: { id: userId }, data: { status: "ACTIVE", disabledAt: null, failedLogins: 0, lockedUntil: null } });
  await audit({ actorId: actor.id, action: "user.enable", entity: "User", entityId: userId, reason });
}

/** Kilit açma + geçici şifre (kullanıcı ilk girişte değiştirir). */
export async function resetPassword(actor: Principal, userId: string, reason: string) {
  if (userId === actor.id) throw new UserAdminError("SELF_RESET");
  const password = tempPassword();
  await db.user.update({
    where: { id: userId },
    data: { passwordHash: await hashPassword(password), mustChangePassword: true, failedLogins: 0, lockedUntil: null, status: "ACTIVE" },
  });
  await revokeAllSessions(userId);
  await audit({ actorId: actor.id, action: "user.password_reset", entity: "User", entityId: userId, reason });
  return password;
}

export async function resetMfa(actor: Principal, userId: string, reason: string) {
  if (userId === actor.id) throw new UserAdminError("SELF_RESET");
  await db.$transaction([
    db.user.update({ where: { id: userId }, data: { mfaSecretEnc: null, mfaEnabledAt: null } }),
    db.mfaRecoveryCode.deleteMany({ where: { userId } }),
  ]);
  await revokeAllSessions(userId);
  await audit({ actorId: actor.id, action: "user.mfa_reset", entity: "User", entityId: userId, reason });
}

export async function upsertTeam(actor: Principal, input: { id?: string; name: string; leaderId?: string | null }, reason: string) {
  const data = { name: input.name.trim(), leaderId: input.leaderId || null };
  const team = input.id ? await db.team.update({ where: { id: input.id }, data }) : await db.team.create({ data });
  if (data.leaderId) await db.user.update({ where: { id: data.leaderId }, data: { teamId: team.id } });
  await audit({ actorId: actor.id, action: input.id ? "team.update" : "team.create", entity: "Team", entityId: team.id, reason, diff: data });
  return team;
}
