import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { readSession } from "@/server/auth/session";
import { logAccess } from "@/server/audit";
import { SCOPE_RANK, type Permission, type Scope } from "@/server/auth/permissions";

export interface Principal {
  id: string;
  name: string;
  email: string;
  teamId: string | null;
  ledTeamIds: string[];
  roles: string[];
  grants: Map<string, Scope>;
}

export class ForbiddenError extends Error {
  constructor(public permission: string) {
    super(`Yetkisiz işlem: ${permission}`);
  }
}

async function loadPrincipal(userId: string): Promise<Principal | null> {
  const user = await db.user.findUnique({
    where: { id: userId },
    include: { roles: { include: { role: { include: { permissions: true } } } }, ledTeams: { select: { id: true } } },
  });
  if (!user || user.status !== "ACTIVE") return null;
  const grants = new Map<string, Scope>();
  for (const ur of user.roles) {
    for (const rp of ur.role.permissions) {
      const s = rp.scope as Scope;
      const cur = grants.get(rp.permission);
      if (!cur || SCOPE_RANK[s] > SCOPE_RANK[cur]) grants.set(rp.permission, s);
    }
  }
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    teamId: user.teamId,
    ledTeamIds: user.ledTeams.map((t) => t.id),
    roles: user.roles.map((r) => r.role.key),
    grants,
  };
}

/** Oturum + MFA doğrulanmış kullanıcı; yoksa null. İstek başına önbelleklidir. */
export const getPrincipal = cache(async (): Promise<Principal | null> => {
  const session = await readSession();
  if (!session || !session.mfaVerified) return null;
  return loadPrincipal(session.userId);
});

/** Sayfa düzeyi: giriş yoksa login'e yönlendirir. */
export async function requireUser(): Promise<Principal> {
  const p = await getPrincipal();
  if (!p) redirect("/login");
  return p;
}

export function can(p: Principal, perm: Permission): boolean {
  return p.grants.has(perm);
}

export function scopeOf(p: Principal, perm: Permission): Scope | null {
  return p.grants.get(perm) ?? null;
}

/** İzin yoksa erişim kaydı yazar ve ForbiddenError fırlatır. */
export async function requirePermission(perm: Permission, resource?: string): Promise<Principal> {
  const p = await requireUser();
  if (!can(p, perm)) {
    await logAccess({ actorId: p.id, action: "denied", resource: resource ?? perm, meta: { permission: perm } });
    throw new ForbiddenError(perm);
  }
  return p;
}

/** Sayfa düzeyi: izin yoksa erişim kaydı yazar ve açıklamalı "yetkiniz yok" sayfasına yönlendirir. */
export async function requirePage(perm: Permission): Promise<Principal> {
  const p = await requireUser();
  if (!can(p, perm)) {
    await logAccess({ actorId: p.id, action: "denied", resource: `page:${perm}`, meta: { permission: perm } });
    redirect("/forbidden");
  }
  return p;
}

/**
 * Misafir kayıt kapsamı (docs/01 §2): own = sahibi olduğu veya açık görevi atanmış misafirler,
 * team = lideri olduğu ekiplerin üyelerine ait misafirler, all = hepsi.
 */
export function guestScopeWhere(p: Principal, perm: Permission): Prisma.GuestWhereInput {
  const scope = scopeOf(p, perm);
  if (!scope) return { id: "__none__" };
  if (scope === "all") return { anonymizedAt: null };
  const own: Prisma.GuestWhereInput[] = [
    { ownerId: p.id },
    { tasks: { some: { assigneeId: p.id, status: { in: ["OPEN", "IN_PROGRESS"] } } } },
  ];
  if (scope === "own") return { anonymizedAt: null, OR: own };
  const teamIds = p.ledTeamIds.length ? p.ledTeamIds : p.teamId ? [p.teamId] : [];
  return {
    anonymizedAt: null,
    OR: [
      ...own,
      { owner: { teamId: { in: teamIds } } },
      { tasks: { some: { assignee: { teamId: { in: teamIds } }, status: { in: ["OPEN", "IN_PROGRESS"] } } } },
    ],
  };
}

/** Kullanıcı kapsamı (raporlar, kuyruk): own = kendisi, team = ekip üyeleri, all = herkes. */
export function userScopeWhere(p: Principal, perm: Permission): Prisma.UserWhereInput {
  const scope = scopeOf(p, perm);
  if (!scope) return { id: "__none__" };
  if (scope === "all") return {};
  if (scope === "own") return { id: p.id };
  const teamIds = p.ledTeamIds.length ? p.ledTeamIds : p.teamId ? [p.teamId] : [];
  return { OR: [{ id: p.id }, { teamId: { in: teamIds } }] };
}
