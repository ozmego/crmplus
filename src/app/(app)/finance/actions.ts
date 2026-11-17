"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ForbiddenError, requirePermission } from "@/server/auth/rbac";
import type { Permission } from "@/server/auth/permissions";
import {
  addContractVersion,
  addResult,
  addTripGuest,
  approveAdjustment,
  createAdjustment,
  createCalculation,
  createCasino,
  createTrip,
  FinanceError,
  lockPeriod,
  transitionCalculation,
} from "@/server/services/finance";
import { applyStatement, importStatement, reconcileCalculation, setEngineMode } from "@/server/services/finance-engine";

export type FormState = { error?: string; ok?: string } | undefined;

const ERR: Record<string, string> = {
  CASINO_EXISTS: "Bu adla casino zaten var.",
  CONTRACT_NAME_REQUIRED: "Yeni sözleşme için ad girin.",
  OVERLAP: "Yeni sürüm önceki sürümden önce başlayamaz.",
  BAD_DATES: "Bitiş tarihi başlangıçtan önce olamaz.",
  GUEST_NOT_FOUND: "Bu CRM numarasıyla misafir yok.",
  ALREADY_IN_TRIP: "Misafir zaten bu tripte.",
  PERIOD_LOCKED: "Dönem kilitli; değişiklik yapılamaz. Düzeltme kaydı kullanın.",
  NO_CONTRACT: "Bu dönemde geçerli sözleşme sürümü yok.",
  BAD_STATE: "Kayıt bu işlem için uygun durumda değil.",
  SAME_PERSON: "Hazırlayan kişi onaylayamaz veya reddedemez (iki kişili onay).",
  REASON_REQUIRED: "Gerekçe zorunlu (en az 5 karakter).",
  STATEMENT_REQUIRED: "Casino ekstresi referansı zorunlu.",
  OPEN_CALCULATIONS: "Dönemde sonuçlanmamış hesaplama var.",
  NO_CALCULATION: "Dönemde onaylı hesaplama yok.",
  ALREADY_LOCKED: "Dönem zaten kilitli.",
  PERIOD_NOT_LOCKED: "Açık dönemde düzeltme yerine yeni hesaplama sürümü kullanılır.",
  FORBIDDEN: "Bu işlem için yetkiniz yok.",
  AMOUNT_REQUIRED_SHADOW: "Gölge modda tutar elle girilir; motor sonucu yanında gösterilir.",
  DIFF_REASON_REQUIRED: "Elle girilen tutar motor sonucundan farklı: onay için fark gerekçesi yazın.",
  BAD_PERIOD: "Dönem YYYY-AA biçiminde olmalı.",
  FILE_TOO_LARGE: "Dosya çok büyük.",
  INFECTED: "Dosya güvenlik taramasından geçmedi.",
  PARSE_FAILED: "Dosya okunamadı (xlsx veya csv olmalı).",
  COLUMNS_MISSING: "Gerekli sütunlar bulunamadı (net kayıp ve CRM no veya oyuncu no).",
  DUPLICATE_STATEMENT: "Bu dosya bu casino için zaten yüklenmiş.",
  STATEMENT_MISMATCH: "Ekstre bu casino ve döneme ait değil.",
  RECON_REASON_REQUIRED: "Ekstre ile fark var: mutabakat için gerekçe yazın.",
  NO_FILE: "Dosya seçin.",
};

async function run(perm: Permission, fn: (u: Awaited<ReturnType<typeof requirePermission>>) => Promise<unknown>, okMsg: string): Promise<FormState> {
  try {
    const user = await requirePermission(perm, "finance");
    await fn(user);
    revalidatePath("/finance", "layout");
    return { ok: okMsg };
  } catch (e) {
    if (e instanceof FinanceError) return { error: e.code === "COLUMNS_MISSING" ? `${ERR.COLUMNS_MISSING} ${e.message}` : ERR[e.code] ?? e.message };
    if (e instanceof ForbiddenError) return { error: ERR.FORBIDDEN };
    if (e instanceof z.ZodError) return { error: e.issues.map((i) => i.message).join(" · ") };
    throw e;
  }
}

const f = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const money = z.string().regex(/^-?\d+(\.\d{1,2})?$/, "Tutar sayı olmalı (ör. 125000.50)");
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tarih seçin");

export async function createCasinoAction(_: FormState, fd: FormData) {
  return run("finance.contract.manage", (u) =>
    createCasino(u, z.object({ name: z.string().min(2), country: z.string().max(2).optional(), currency: z.string().regex(/^[A-Z]{3}$/) }).parse({
      name: f(fd, "name"), country: f(fd, "country") || undefined, currency: f(fd, "currency").toUpperCase(),
    })), "Casino eklendi.");
}

export async function addVersionAction(_: FormState, fd: FormData) {
  return run("finance.contract.manage", async (u) => {
    let rules: unknown;
    try {
      rules = JSON.parse(f(fd, "rules"));
    } catch {
      throw new z.ZodError([{ code: "custom", path: ["rules"], message: "Kurallar okunamadı" }]);
    }
    await addContractVersion(u, {
      casinoId: f(fd, "casinoId"),
      contractId: f(fd, "contractId") || undefined,
      contractName: f(fd, "contractName") || undefined,
      version: { validFrom: f(fd, "validFrom"), validTo: f(fd, "validTo") || null, combine: f(fd, "combine") as "SUM", rules: rules as never, note: f(fd, "note") || undefined },
    });
  }, "Sözleşme sürümü kaydedildi.");
}

export async function createTripAction(_: FormState, fd: FormData) {
  return run("finance.result.edit", (u) =>
    createTrip(u, z.object({ casinoId: z.string().min(1, "Casino seçin"), name: z.string().min(2), startDate: date, endDate: date }).parse({
      casinoId: f(fd, "casinoId"), name: f(fd, "name"), startDate: f(fd, "startDate"), endDate: f(fd, "endDate"),
    })), "Trip oluşturuldu.");
}

export async function addTripGuestAction(_: FormState, fd: FormData) {
  return run("finance.result.edit", (u) => addTripGuest(u, f(fd, "tripId"), z.coerce.number().int().positive("CRM no girin").parse(f(fd, "crmNo").replace(/\D/g, ""))), "Misafir eklendi.");
}

export async function addResultAction(_: FormState, fd: FormData) {
  return run("finance.result.edit", (u) =>
    addResult(u, z.object({
      tripGuestId: z.string().min(1, "Misafir seçin"), playedOn: date, netLoss: money,
      buyIn: money.optional(), cashOut: money.optional(), rolling: money.optional(),
      source: z.enum(["MANUAL", "STATEMENT"]), sourceRef: z.string().max(120).optional(),
    }).parse({
      tripGuestId: f(fd, "tripGuestId"), playedOn: f(fd, "playedOn"), netLoss: f(fd, "netLoss"),
      buyIn: f(fd, "buyIn") || undefined, cashOut: f(fd, "cashOut") || undefined, rolling: f(fd, "rolling") || undefined,
      source: f(fd, "source") || "MANUAL", sourceRef: f(fd, "sourceRef") || undefined,
    })), "Sonuç kaydedildi.");
}

export async function createCalcAction(_: FormState, fd: FormData) {
  return run("finance.calc.prepare", (u) =>
    createCalculation(u, z.object({ periodId: z.string().min(1), amount: money.optional(), note: z.string().min(5, "Hesap açıklaması en az 5 karakter") }).parse({
      periodId: f(fd, "periodId"), amount: f(fd, "amount") || undefined, note: f(fd, "note"),
    })), "Hesaplama taslağı oluşturuldu.");
}

export async function calcTransitionAction(_: FormState, fd: FormData) {
  const action = z.enum(["SUBMIT", "APPROVE", "REJECT", "RECONCILE", "CANCEL"]).parse(f(fd, "action"));
  const perm: Permission = action === "SUBMIT" || action === "CANCEL" ? "finance.calc.prepare" : "finance.calc.approve";
  return run(perm, (u) => transitionCalculation(u, f(fd, "calcId"), action, { reason: f(fd, "reason") || undefined, statementRef: f(fd, "statementRef") || undefined }), "İşlem kaydedildi.");
}

export async function lockPeriodAction(_: FormState, fd: FormData) {
  return run("finance.period.lock", (u) => lockPeriod(u, f(fd, "periodId")), "Dönem kilitlendi.");
}

export async function createAdjustmentAction(_: FormState, fd: FormData) {
  return run("finance.adjust", (u) => createAdjustment(u, { calculationId: f(fd, "calculationId"), amount: money.parse(f(fd, "amount")), reason: f(fd, "reason") }), "Düzeltme kaydı oluşturuldu.");
}

export async function approveAdjustmentAction(_: FormState, fd: FormData) {
  return run("finance.calc.approve", (u) => approveAdjustment(u, f(fd, "adjustmentId")), "Düzeltme onaylandı.");
}

export async function uploadStatementAction(_: FormState, fd: FormData) {
  const file = fd.get("file");
  if (!(file instanceof File) || !file.size) return { error: ERR.NO_FILE };
  return run("finance.result.edit", async (u) =>
    importStatement(u, { casinoId: f(fd, "casinoId"), period: f(fd, "period"), fileName: file.name, data: Buffer.from(await file.arrayBuffer()), invertSign: f(fd, "invertSign") === "1" }), "Ekstre yüklendi ve eşlendi.");
}

export async function applyStatementAction(_: FormState, fd: FormData) {
  let n = 0;
  const r = await run("finance.result.edit", async (u) => (n = await applyStatement(u, f(fd, "statementId"))), "");
  return r?.error ? r : { ok: `${n} satır kaynak referansıyla sonuç olarak işlendi.` };
}

export async function reconcileAction(_: FormState, fd: FormData) {
  return run("finance.calc.approve", (u) => reconcileCalculation(u, f(fd, "calcId"), f(fd, "statementId"), f(fd, "reason") || undefined), "Mutabakat kaydedildi.");
}

export async function engineModeAction(_: FormState, fd: FormData) {
  return run("finance.calc.approve", (u) => setEngineMode(u, f(fd, "mode") === "PRIMARY" ? "PRIMARY" : "SHADOW", f(fd, "reason")), "Motor modu güncellendi.");
}
