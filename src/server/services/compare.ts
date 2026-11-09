import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import type { Principal } from "@/server/auth/rbac";
import { audit } from "@/server/audit";
import { compareRowSets, type CompareResult, type CompareStatus, type CompRow } from "@/lib/compare";
import type { StoredRow } from "@/server/services/imports";

/**
 * Liste karşılaştırma servisi.
 * FILE: iki içe aktarmanın satırları. CRM: sol taraf = seçilen önceki içe aktarmanın misafirlerinin CRM'deki güncel hali.
 * Hiçbir kayıt değiştirilmez; değişiklikler yalnız "Güncelleme" amaçlı içe aktarmayla (karar adımıyla) uygulanır.
 */

export class CompareError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

const USABLE = ["PREVIEWED", "APPLIED", "ROLLED_BACK"] as const;

function storedToComp(rowNo: number, s: StoredRow): CompRow {
  return {
    ref: `r${rowNo}`,
    crmNo: s.crmNo,
    ext: s.externalId && s.externalSource ? `${s.externalSource}\u0000${s.externalId}` : undefined,
    phoneHashes: s.phones.map((p) => p.hash).filter((h): h is string => !!h),
    phonesMasked: s.phones.filter((p) => p.hash).map((p) => p.masked ?? ""),
    emailHash: s.email?.hash,
    fields: s.fields as Record<string, string>,
    consent: Object.fromEntries(Object.entries(s.consent).filter(([, v]) => v && v !== "UNKNOWN")) as Record<string, string>,
  };
}

async function fileRows(batchId: string): Promise<CompRow[]> {
  const b = await db.importBatch.findUnique({ where: { id: batchId }, select: { status: true } });
  if (!b || !(USABLE as readonly string[]).includes(b.status)) throw new CompareError("BATCH_NOT_READY");
  const rows = await db.importRow.findMany({ where: { batchId, result: { notIn: ["INVALID", "DUP_IN_FILE"] } }, select: { rowNo: true, normalized: true } });
  return rows.map((r) => storedToComp(r.rowNo, r.normalized as unknown as StoredRow));
}

async function crmRowsFromBatch(batchId: string): Promise<CompRow[]> {
  const ids = (await db.importRow.findMany({ where: { batchId, guestId: { not: null } }, select: { guestId: true } })).map((r) => r.guestId!);
  const guests = await db.guest.findMany({
    where: { id: { in: [...new Set(ids)] }, anonymizedAt: null },
    select: {
      id: true, crmNo: true, firstName: true, lastName: true, language: true, country: true, city: true, birthYear: true, vipLevel: true,
      phones: { select: { phoneHash: true, masked: true } },
      emails: { select: { emailHash: true }, take: 1 },
      externalIds: { select: { source: true, value: true }, take: 1 },
      consents: { select: { channel: true, status: true } },
    },
  });
  return guests.map((g) => ({
    ref: g.id,
    crmNo: g.crmNo,
    ext: g.externalIds[0] ? `${g.externalIds[0].source}\u0000${g.externalIds[0].value}` : undefined,
    phoneHashes: g.phones.map((p) => p.phoneHash),
    phonesMasked: g.phones.map((p) => p.masked),
    emailHash: g.emails[0]?.emailHash,
    fields: Object.fromEntries(
      (["firstName", "lastName", "language", "country", "city", "birthYear", "vipLevel"] as const)
        .filter((f) => g[f] !== null && g[f] !== undefined)
        .map((f) => [f, String(g[f])]),
    ),
    consent: Object.fromEntries(g.consents.filter((c) => c.status !== "UNKNOWN").map((c) => [c.channel, c.status])),
  }));
}

export async function runComparison(user: Principal, input: { mode: "FILE" | "CRM"; leftBatchId: string; rightBatchId: string }) {
  if (input.leftBatchId === input.rightBatchId) throw new CompareError("SAME_BATCH");
  const right = await fileRows(input.rightBatchId);
  const left = input.mode === "FILE" ? await fileRows(input.leftBatchId) : await crmRowsFromBatch(input.leftBatchId);
  const results = compareRowSets(left, right);
  const summary = results.reduce<Record<string, number>>((a, r) => ((a[r.status] = (a[r.status] ?? 0) + 1), a), { left: left.length, right: right.length });

  const job = await db.$transaction(async (tx) => {
    const j = await tx.comparisonJob.create({
      data: {
        leftRef: input.mode === "FILE" ? `import:${input.leftBatchId}` : `crm:import:${input.leftBatchId}`,
        rightRef: `import:${input.rightBatchId}`,
        key: "CRM_ID > DIŞ KİMLİK > TELEFON+İSİM",
        summary,
        createdBy: user.id,
      },
    });
    for (let i = 0; i < results.length; i += 1000) {
      await tx.comparisonResult.createMany({
        data: results.slice(i, i + 1000).map((r) => ({
          jobId: j.id,
          status: r.status,
          guestId: input.mode === "CRM" ? r.leftRef ?? null : null,
          rowNo: r.rightRef ? Number(r.rightRef.slice(1)) : null,
          diff: { leftRef: r.leftRef, candidateRefs: r.candidateRefs ?? null, deltas: r.deltas, reason: r.reason ?? null } as unknown as Prisma.InputJsonValue,
        })),
      });
    }
    return j;
  });
  await audit({ actorId: user.id, action: "compare.run", entity: "ComparisonJob", entityId: job.id, diff: { ...input, summary } });
  return job;
}

export type StoredDiff = Pick<CompareResult, "leftRef" | "candidateRefs" | "deltas" | "reason">;
export type { CompareStatus };
