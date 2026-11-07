"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ForbiddenError, requirePermission } from "@/server/auth/rbac";
import {
  createUser,
  disableUser,
  enableUser,
  resetMfa,
  resetPassword,
  setUserRoles,
  setUserTeam,
  upsertTeam,
  UserAdminError,
} from "@/server/services/users";

type R<T = true> = { ok: true; data: T } | { ok: false; error: string };
const reason = z.string().trim().min(5).max(300);

async function run<T>(fn: () => Promise<T>): Promise<R<T>> {
  try {
    const data = await fn();
    revalidatePath("/admin/users");
    return { ok: true, data };
  } catch (e) {
    if (e instanceof UserAdminError) return { ok: false, error: e.code };
    if (e instanceof ForbiddenError) return { ok: false, error: "FORBIDDEN" };
    if (e instanceof z.ZodError) return { ok: false, error: "INVALID_INPUT" };
    throw e;
  }
}

export async function createUserAction(input: { email: string; name: string; teamId?: string; roleKeys: string[]; reason: string }) {
  return run(async () => {
    const actor = await requirePermission("user.manage");
    const p = z
      .object({ email: z.string().email(), name: z.string().trim().min(2).max(120), teamId: z.string().optional(), roleKeys: z.array(z.string()).min(1), reason })
      .parse(input);
    if (p.roleKeys.length) await requirePermission("role.assign");
    return createUser(actor, p);
  });
}

export async function setRolesAction(userId: string, roleKeys: string[], why: string) {
  return run(async () => setUserRoles(await requirePermission("role.assign"), userId, z.array(z.string()).parse(roleKeys), reason.parse(why)));
}

export async function setTeamAction(userId: string, teamId: string | null, why: string) {
  return run(async () => setUserTeam(await requirePermission("team.manage"), userId, teamId, reason.parse(why)));
}

export async function userStatusAction(userId: string, op: "disable" | "enable" | "reset_password" | "reset_mfa", why: string) {
  return run(async () => {
    const actor = await requirePermission("user.manage");
    const r = reason.parse(why);
    if (op === "disable") await disableUser(actor, userId, r);
    else if (op === "enable") await enableUser(actor, userId, r);
    else if (op === "reset_mfa") await resetMfa(actor, userId, r);
    else return resetPassword(actor, userId, r);
    return null;
  });
}

export async function upsertTeamAction(input: { id?: string; name: string; leaderId?: string | null }, why: string) {
  return run(async () => {
    const actor = await requirePermission("team.manage");
    const p = z.object({ id: z.string().optional(), name: z.string().trim().min(2).max(80), leaderId: z.string().nullable().optional() }).parse(input);
    await upsertTeam(actor, p, reason.parse(why));
    return true;
  });
}
