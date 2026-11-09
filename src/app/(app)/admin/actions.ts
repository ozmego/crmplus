"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ForbiddenError, requirePermission } from "@/server/auth/rbac";
import { DEFAULT_GATE, getRecordingGate, setSetting, type RecordingGate } from "@/server/services/settings";
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

// ───────────── Ayarlar: karar kapısı ve saklama süreleri ─────────────

const gateSchema = z.object({
  checklist: z.object({
    legalBasis: z.boolean(), noticeText: z.boolean(), retention: z.boolean(),
    vendorDataUse: z.boolean(), accessMatrix: z.boolean(), guestPreferenceFlow: z.boolean(),
  }),
  noticeText: z.string().trim().min(20).max(500),
  legalRef: z.string().trim().max(300),
});

/** Karar kapısı: altı onayın tamamı işaretlenince açılır; herhangi biri kaldırılırsa anında kapanır. */
export async function saveGateAction(input: z.input<typeof gateSchema>, why: string) {
  return run(async () => {
    const actor = await requirePermission("settings.manage");
    const p = gateSchema.parse(input);
    const prev = await getRecordingGate();
    const allChecked = Object.values(p.checklist).every(Boolean);
    const next: RecordingGate = {
      ...DEFAULT_GATE, ...p,
      approvedAt: allChecked ? prev.approvedAt ?? new Date().toISOString() : null,
      approvedBy: allChecked ? prev.approvedBy ?? actor.id : null,
    };
    await setSetting(actor.id, "recording.gate", next, reason.parse(why));
    return { open: allChecked };
  });
}

const retentionSchema = z.object({
  audioDays: z.number().int().min(1).max(3650),
  rawTranscriptDays: z.number().int().min(1).max(365),
  importFileDays: z.number().int().min(1).max(365),
  listenGrantHours: z.number().int().min(1).max(168),
});

export async function saveRetentionAction(input: z.input<typeof retentionSchema>, why: string) {
  return run(async () => {
    const actor = await requirePermission("settings.manage");
    await setSetting(actor.id, "retention", retentionSchema.parse(input), reason.parse(why));
    return true;
  });
}
