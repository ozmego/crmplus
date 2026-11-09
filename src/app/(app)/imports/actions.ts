"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ForbiddenError, requirePermission } from "@/server/auth/rbac";
import {
  applyImport,
  buildPreview,
  createImport,
  ImportError,
  rollbackImport,
  saveMapping,
  setAllDecisions,
  setRowDecisions,
} from "@/server/services/imports";
import { MAX_FILE_BYTES } from "@/server/import/parse";
import { db } from "@/server/db";
import { enqueue } from "@/server/queue";

/** Büyük dosyalar (varsayılan 5.000 satır üstü) arka plan işçisinde işlenir. */
async function runsInWorker(batchId: string) {
  const b = await db.importBatch.findUnique({ where: { id: batchId }, select: { summary: true } });
  return Number((b?.summary as { rowCount?: number } | null)?.rowCount ?? 0) > Number(process.env.IMPORT_INLINE_MAX_ROWS ?? 5000);
}

async function queueImport(batchId: string, userId: string, job: "preview" | "apply") {
  const b = await db.importBatch.findUniqueOrThrow({ where: { id: batchId } });
  if (job === "apply") {
    if (b.status !== "PREVIEWED") throw new ImportError("BAD_STATUS");
    await db.importBatch.update({ where: { id: batchId }, data: { status: "APPLYING" } });
  }
  await db.importBatch.update({ where: { id: batchId }, data: { summary: { ...((b.summary as object) ?? {}), job, jobError: null } } });
  await enqueue("imports", job, { batchId, userId }, { jobId: job + "-" + batchId + "-" + Date.now() });
}

export type ActionState = { error?: string } | undefined;
type Result<T> = { ok: true; data: T } | { ok: false; error: string };

async function run<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    if (e instanceof ImportError) return { ok: false, error: e.code + (e.message && e.message !== e.code ? `: ${e.message}` : "") };
    if (e instanceof ForbiddenError) return { ok: false, error: "FORBIDDEN" };
    if (e instanceof z.ZodError) return { ok: false, error: "INVALID_INPUT" };
    throw e;
  }
}

export async function uploadAction(_: ActionState, formData: FormData): Promise<ActionState> {
  let id: string | null = null;
  const r = await run(async () => {
    const user = await requirePermission("import.create");
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) throw new ImportError("NO_FILE");
    if (file.size > MAX_FILE_BYTES) throw new ImportError("TOO_LARGE");
    const meta = z
      .object({
        purpose: z.enum(["NEW_LIST", "UPDATE", "COMPARE"]),
        sourceLabel: z.string().trim().min(2).max(120),
        defaultCountry: z.string().regex(/^[A-Z]{2}$/),
      })
      .parse({ purpose: formData.get("purpose"), sourceLabel: formData.get("sourceLabel"), defaultCountry: formData.get("defaultCountry") ?? "TR" });
    const batch = await createImport(user, { fileName: file.name, data: Buffer.from(await file.arrayBuffer()), ...meta });
    id = batch.id;
  });
  if (!r.ok) return { error: r.error };
  redirect(`/imports/${id}`);
}

const mappingSchema = z.record(z.string(), z.string().nullable());

export async function saveMappingAction(batchId: string, mapping: Record<string, string | null>, sheet?: string) {
  const r = await run(async () => {
    const user = await requirePermission("import.create");
    await saveMapping(user, batchId, mappingSchema.parse(mapping), sheet);
    if (await runsInWorker(batchId)) {
      await queueImport(batchId, user.id, "preview");
      return { queued: true as const };
    }
    return buildPreview(user, batchId);
  });
  revalidatePath(`/imports/${batchId}`);
  return r;
}

export async function decideRowAction(batchId: string, rowNo: number, decisions: Record<string, "KEEP" | "USE_NEW" | "REVIEW">) {
  const r = await run(async () => {
    const user = await requirePermission("import.apply");
    await setRowDecisions(user, batchId, z.number().int().parse(rowNo), z.record(z.string(), z.enum(["KEEP", "USE_NEW", "REVIEW"])).parse(decisions));
  });
  revalidatePath(`/imports/${batchId}`);
  return r;
}

export async function decideAllAction(batchId: string, decision: "KEEP" | "USE_NEW" | "REVIEW") {
  const r = await run(async () => setAllDecisions(await requirePermission("import.apply"), batchId, z.enum(["KEEP", "USE_NEW", "REVIEW"]).parse(decision)));
  revalidatePath(`/imports/${batchId}`);
  return r;
}

export async function applyAction(batchId: string) {
  const r = await run(async () => {
    const user = await requirePermission("import.apply");
    if (await runsInWorker(batchId)) {
      await queueImport(batchId, user.id, "apply");
      return { queued: true as const, created: 0, updated: 0, review: 0 };
    }
    return { queued: false as const, ...(await applyImport(user, batchId)) };
  });
  revalidatePath(`/imports/${batchId}`);
  return r;
}

export async function rollbackAction(batchId: string, reason: string) {
  const r = await run(async () => rollbackImport(await requirePermission("import.rollback"), batchId, z.string().trim().min(5).max(300).parse(reason)));
  revalidatePath(`/imports/${batchId}`);
  return r;
}
