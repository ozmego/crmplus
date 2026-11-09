import { db } from "@/server/db";
import { principalFor } from "@/server/auth/rbac";
import { applyImport, buildPreview } from "@/server/services/imports";

/**
 * Büyük içe aktarmalar (IMPORT_INLINE_MAX_ROWS üstü) işçide çalışır; işi başlatan kullanıcının
 * güncel yetkileriyle (işlem anında yeniden yüklenir) yürütülür.
 */
export async function runImportJob(name: string, data: { batchId: string; userId: string }) {
  const user = await principalFor(data.userId);
  if (!user) throw new Error("Kullanıcı etkin değil");
  try {
    if (name === "preview") return await buildPreview(user, data.batchId);
    if (name === "apply") return await applyImport(user, data.batchId);
    throw new Error(`Bilinmeyen içe aktarma işi: ${name}`);
  } catch (e) {
    const b = await db.importBatch.findUnique({ where: { id: data.batchId }, select: { summary: true, status: true } });
    await db.importBatch.update({
      where: { id: data.batchId },
      data: {
        status: name === "apply" ? "FAILED" : b?.status,
        summary: { ...((b?.summary as object) ?? {}), job: null, jobError: (e as Error).message.slice(0, 300) },
      },
    });
    throw e;
  }
}
