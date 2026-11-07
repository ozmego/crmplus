import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { clientInfo } from "@/server/auth/session";

type Tx = Prisma.TransactionClient | typeof db;

/** Yazma işlemi kaydı (değiştirilemez tablo). */
export async function audit(
  entry: {
    actorId: string | null;
    action: string;
    entity?: string;
    entityId?: string;
    reason?: string | null;
    diff?: Prisma.InputJsonValue;
  },
  tx: Tx = db,
) {
  const { ip } = await clientInfo().catch(() => ({ ip: null }));
  await tx.auditLog.create({ data: { ...entry, reason: entry.reason ?? undefined, ip } });
}

/** Okuma/erişim kaydı: görüntüleme, maskesiz açma, export, dinleme, reddedilen erişim. */
export async function logAccess(entry: {
  actorId: string | null;
  action: "view" | "reveal" | "export" | "listen" | "download" | "denied";
  resource: string;
  resourceId?: string;
  reason?: string | null;
  meta?: Prisma.InputJsonValue;
}) {
  const { ip } = await clientInfo().catch(() => ({ ip: null }));
  await db.accessLog.create({ data: { ...entry, reason: entry.reason ?? undefined, ip } });
}
