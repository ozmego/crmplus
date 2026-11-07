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
  const r = await run(async () => applyImport(await requirePermission("import.apply"), batchId));
  revalidatePath(`/imports/${batchId}`);
  return r;
}

export async function rollbackAction(batchId: string, reason: string) {
  const r = await run(async () => rollbackImport(await requirePermission("import.rollback"), batchId, z.string().trim().min(5).max(300).parse(reason)));
  revalidatePath(`/imports/${batchId}`);
  return r;
}
