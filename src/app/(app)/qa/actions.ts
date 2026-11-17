"use server";

import { revalidatePath } from "next/cache";
import { ForbiddenError, requirePermission } from "@/server/auth/rbac";
import type { Permission } from "@/server/auth/permissions";
import { addManualSample, addTerm, closeSample, generateForUser, QaError, respondSample, reviewSample, toggleTerm, type CriterionResult } from "@/server/services/qa";
import type { FormState } from "@/app/(app)/finance/actions";

const ERR: Record<string, string> = {
  FORBIDDEN: "Bu işlem için yetkiniz yok.",
  NOT_FOUND: "Kayıt bulunamadı.",
  OWN_CALL: "Kendi görüşmenizi inceleyemezsiniz.",
  ALREADY_SAMPLED: "Bu görüşme zaten örneklemde.",
  BAD_STATE: "Kayıt bu işlem için uygun durumda değil.",
  NOTE_REQUIRED: "Koçluk notu en az 10 karakter olmalı.",
  INCOMPLETE: "Her kriter için bir seçim yapın.",
  NOT_MET_NOTE: "“Karşılanmadı” seçilen kriterler için kısa açıklama yazın.",
  DISPUTE_REASON: "İtiraz gerekçesi en az 10 karakter olmalı.",
  RESOLUTION_REQUIRED: "İtiraz sonucu en az 10 karakter olmalı.",
  BAD_TERM: "Terim 2–60 karakter olmalı ve numara içermemeli.",
};

async function run(perm: Permission, fn: (u: Awaited<ReturnType<typeof requirePermission>>) => Promise<unknown>, okMsg: string, path = "/qa"): Promise<FormState> {
  try {
    const user = await requirePermission(perm, "qa");
    await fn(user);
    revalidatePath(path, "layout");
    return { ok: okMsg };
  } catch (e) {
    if (e instanceof QaError) return { error: ERR[e.code] ?? e.code };
    if (e instanceof ForbiddenError) return { error: ERR.FORBIDDEN };
    throw e;
  }
}
const f = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

export async function generateAction(_: FormState, fd: FormData) {
  let n = 0;
  const r = await run("qa.review", async (u) => (n = (await generateForUser(u, f(fd, "weekStart") || undefined)).created), "");
  return r?.error ? r : { ok: n ? `${n} görüşme örnekleme eklendi.` : "Yeni örneklem yok (uygun görüşme yok veya kota dolu)." };
}

export async function manualSampleAction(_: FormState, fd: FormData) {
  return run("qa.review", (u) => addManualSample(u, f(fd, "callId")), "Görüşme örnekleme eklendi.");
}

export async function reviewAction(_: FormState, fd: FormData) {
  const results: Record<string, { result: CriterionResult; note?: string }> = {};
  for (const [k, v] of fd.entries()) {
    const m = /^r:(.+)$/.exec(k);
    if (m) results[m[1]] = { result: String(v) as CriterionResult, note: f(fd, `n:${m[1]}`) || undefined };
  }
  return run("qa.review", (u) => reviewSample(u, f(fd, "id"), { results, coachingNote: f(fd, "coachingNote") }), "İnceleme kaydedildi; personel açıklama veya itiraz ekleyebilir.");
}

export async function respondAction(_: FormState, fd: FormData) {
  const dispute = f(fd, "kind") === "DISPUTE";
  return run("qa.respond", (u) => respondSample(u, f(fd, "id"), f(fd, "comment"), dispute), dispute ? "İtirazınız iletildi." : "Teşekkürler, okundu olarak işaretlendi.");
}

export async function closeAction(_: FormState, fd: FormData) {
  return run("qa.review", (u) => closeSample(u, f(fd, "id"), f(fd, "resolution")), "Örneklem kapatıldı.");
}

export async function addTermAction(_: FormState, fd: FormData) {
  return run("vocabulary.manage", (u) => addTerm(u, f(fd, "term"), f(fd, "kind")), "Terim eklendi.", "/admin/vocabulary");
}

export async function toggleTermAction(_: FormState, fd: FormData) {
  return run("vocabulary.manage", (u) => toggleTerm(u, f(fd, "id")), "Güncellendi.", "/admin/vocabulary");
}
