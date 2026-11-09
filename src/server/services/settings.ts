import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { audit } from "@/server/audit";

/** Sistem ayarları (Setting tablosu). Değişiklikler gerekçeli ve denetim kayıtlı. */

export interface RecordingGate {
  approvedAt: string | null;
  approvedBy: string | null;
  checklist: {
    legalBasis: boolean; // hukuki dayanak belirlendi
    noticeText: boolean; // bilgilendirme metni onaylandı
    retention: boolean; // saklama süreleri onaylandı
    vendorDataUse: boolean; // tedarikçinin veri kullanımı değerlendirildi
    accessMatrix: boolean; // erişim matrisi onaylandı
    guestPreferenceFlow: boolean; // misafir tercih akışı onaylandı
  };
  noticeText: string;
  legalRef: string;
}

export interface Retention {
  audioDays: number;
  rawTranscriptDays: number;
  importFileDays: number;
  listenGrantHours: number;
}

export const DEFAULT_GATE: RecordingGate = {
  approvedAt: null,
  approvedBy: null,
  checklist: { legalBasis: false, noticeText: false, retention: false, vendorDataUse: false, accessMatrix: false, guestPreferenceFlow: false },
  noticeText: "Hizmet kalitesi ve güvenliğiniz için bu görüşme kayıt altına alınmaktadır. Kayıt istemiyorsanız lütfen temsilcimize iletiniz.",
  legalRef: "",
};
export const DEFAULT_RETENTION: Retention = { audioDays: 90, rawTranscriptDays: 30, importFileDays: 30, listenGrantHours: 24 };

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const s = await db.setting.findUnique({ where: { key } });
  return s ? ({ ...fallback, ...(s.value as object) } as T) : fallback;
}

export async function setSetting(actorId: string, key: string, value: unknown, reason: string) {
  const prev = await db.setting.findUnique({ where: { key } });
  await db.setting.upsert({
    where: { key },
    update: { value: value as Prisma.InputJsonValue, updatedBy: actorId },
    create: { key, value: value as Prisma.InputJsonValue, updatedBy: actorId },
  });
  await audit({ actorId, action: "settings.update", entity: "Setting", entityId: key, reason, diff: { before: (prev?.value ?? null) as Prisma.InputJsonValue, after: value as Prisma.InputJsonValue } });
}

export const getRecordingGate = () => getSetting<RecordingGate>("recording.gate", DEFAULT_GATE);
export const getRetention = () => getSetting<Retention>("retention", DEFAULT_RETENTION);

/** Karar kapısı: altı onayın tamamı verilmiş ve onay zamanı kayıtlı olmalı (plan v4 §4). */
export function gateOpen(g: RecordingGate): boolean {
  return !!g.approvedAt && Object.values(g.checklist).every(Boolean);
}

/** Personel/puantaj parametreleri (docs/11 §6) — ⚖️ İK/hukuk teyidiyle değiştirilir. */
export interface HrParams {
  coverageTarget: number; // çağrı merkezinde saat başına hedef temsilci
  toleranceMin: number; // geç kalma / erken çıkış toleransı
  windowMin: number; // vardiya ±pencere; dışındaki tekil etkinlik sayılmaz
}
export const DEFAULT_HR_PARAMS: HrParams = { coverageTarget: 2, toleranceMin: 10, windowMin: 120 };
export const hrParams = () => getSetting<HrParams>("hr.params", DEFAULT_HR_PARAMS);
