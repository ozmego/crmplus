"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/server/auth/rbac";
import type { FormState } from "@/app/(app)/finance/actions";
import { addCasinoNumber, deleteDocument, ProfileEditError, saveCreditLine, saveIdentity, savePreferences, saveTravel, uploadDocument } from "@/server/services/casino-profile";

const ERR: Record<string, string> = {
  FORBIDDEN: "Bu işlem için yetkiniz yok.",
  NOT_FOUND: "Kayıt bulunamadı veya kapsamınızda değil.",
  BAD_TCNO: "T.C. kimlik numarası geçersiz (11 hane, sağlama kuralı).",
  BAD_PASSPORT: "Pasaport numarası 5–20 harf/rakam olmalı.",
  BAD_COUNTRY: "Ülke kodu iki harf olmalı (ör. TR, DE).",
  BAD_DATE: "Tarih geçersiz.",
  UNDERAGE: "Doğum tarihi geçersiz veya 18 yaş altı.",
  BAD_VALUE: "Değer geçersiz.",
  MIN_GT_MAX: "Alt limit üst limitten büyük olamaz.",
  BAD_HOST: "Host etkin bir kullanıcı olmalı.",
  TOO_LONG: "Metin çok uzun.",
  NUMBER_TAKEN: "Bu casino oyuncu numarası başka bir oyuncuda kayıtlı.",
  NO_FILE: "Dosya seçin.",
  TOO_LARGE: "Dosya en fazla 10 MB olabilir.",
  BAD_TYPE: "Yalnız JPEG, PNG veya PDF (içerik türüyle uyumlu) yüklenebilir.",
  INFECTED: "Dosyada zararlı içerik bulundu; yüklenmedi.",
  SCAN_FAILED: "Virüs taraması yapılamadı; dosya kabul edilmedi.",
  REASON_REQUIRED: "Gerekçe zorunlu (en az 5 karakter).",
};

const f = (fd: FormData, k: string) => String(fd.get(k) ?? "");

async function run(guestId: string, fn: () => Promise<unknown>, ok: string): Promise<FormState> {
  try {
    await fn();
    revalidatePath(`/guests/${guestId}`);
    return { ok };
  } catch (e) {
    if (e instanceof ProfileEditError) return { error: ERR[e.code] ?? e.code };
    throw e;
  }
}

export async function identityAction(_: FormState, fd: FormData) {
  const user = await requireUser();
  const id = f(fd, "guestId");
  return run(id, () => saveIdentity(user, id, {
    nationality: f(fd, "nationality"), gender: f(fd, "gender"), birthDate: f(fd, "birthDate"), tcNo: f(fd, "tcNo"),
    passportNo: f(fd, "passportNo"), passportCountry: f(fd, "passportCountry"), passportExpiry: f(fd, "passportExpiry"), address: f(fd, "address"),
  }), "Kimlik bilgileri kaydedildi.");
}

export async function preferencesAction(_: FormState, fd: FormData) {
  const user = await requireUser();
  const id = f(fd, "guestId");
  return run(id, () => savePreferences(user, id, {
    games: fd.getAll("games").map(String), tableMin: f(fd, "tableMin"), tableMax: f(fd, "tableMax"), limitCurrency: f(fd, "limitCurrency"), hostUserId: f(fd, "hostUserId"), preferences: f(fd, "preferences"),
  }), "Tercihler kaydedildi.");
}

export async function casinoNumberAction(_: FormState, fd: FormData) {
  const user = await requireUser();
  const id = f(fd, "guestId");
  return run(id, () => addCasinoNumber(user, id, f(fd, "casinoId"), f(fd, "number")), "Casino oyuncu numarası eklendi.");
}

export async function travelAction(_: FormState, fd: FormData) {
  const user = await requireUser();
  const id = f(fd, "guestId");
  const keys = ["outFlight", "outAt", "outRoute", "retFlight", "retAt", "retRoute", "pnr", "hotel", "roomType", "checkIn", "checkOut", "transfer", "companion", "note"] as const;
  return run(id, () => saveTravel(user, f(fd, "tripGuestId"), Object.fromEntries(keys.map((k) => [k, f(fd, k)]))), "Seyahat bilgisi kaydedildi.");
}

export async function creditAction(_: FormState, fd: FormData) {
  const user = await requireUser();
  const id = f(fd, "guestId");
  return run(id, () => saveCreditLine(user, id, { casinoId: f(fd, "casinoId"), frontMoney: f(fd, "frontMoney"), creditLimit: f(fd, "creditLimit"), note: f(fd, "note") }), "Ön yatırım / kredi hattı kaydedildi.");
}

export async function documentUploadAction(_: FormState, fd: FormData) {
  const user = await requireUser();
  const id = f(fd, "guestId");
  const file = fd.get("file");
  return run(id, () => uploadDocument(user, id, f(fd, "kind"), file instanceof File ? file : (null as unknown as File)), "Belge yüklendi (virüs taramasından geçti).");
}

export async function documentDeleteAction(_: FormState, fd: FormData) {
  const user = await requireUser();
  const id = f(fd, "guestId");
  return run(id, () => deleteDocument(user, f(fd, "documentId"), f(fd, "reason")), "Belge kaldırıldı.");
}
