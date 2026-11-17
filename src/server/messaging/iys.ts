import "server-only";
import { db } from "@/server/db";
import { blindIndex } from "@/server/crypto/field-encryption";

/**
 * İleti Yönetim Sistemi (İYS) adaptörü (docs/04 §6, docs/10 §3).
 *   IYS_PROVIDER = none (vars.) | http | mock (yalnız geliştirme)
 *   IYS_URL, IYS_TOKEN, IYS_BRAND_CODE — SMS sağlayıcısının İYS arayüzü veya İYS entegratörü
 * Kural: yanıt alınamazsa sonuç UNAVAILABLE'dır ve ileti GÖNDERİLMEZ (“izinli varsay” yoktur).
 * Sorgular IysQueryLog'a yazılır; aynı numara+tür için 1 saatlik önbellek kullanılır (yalnız ONAY/RET).
 */
export type IysType = "MESAJ" | "ARAMA";
export type IysResult = "ONAY" | "RET" | "UNAVAILABLE";

export const iysMode = () => (process.env.IYS_PROVIDER ?? "none") as "none" | "http" | "mock";

async function queryRemote(e164: string, type: IysType): Promise<IysResult> {
  const mode = iysMode();
  if (mode === "mock" && process.env.NODE_ENV !== "production") {
    // Tekrarlanabilir: son hane çift → ONAY, tek → RET
    return Number(e164.at(-1)) % 2 === 0 ? "ONAY" : "RET";
  }
  if (mode !== "http" || !process.env.IYS_URL) return "UNAVAILABLE";
  try {
    const res = await fetch(`${process.env.IYS_URL.replace(/\/$/, "")}/consents/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.IYS_TOKEN ?? ""}` },
      body: JSON.stringify({ brandCode: process.env.IYS_BRAND_CODE, recipient: e164, type, recipientType: "BIREYSEL" }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return "UNAVAILABLE";
    const j = (await res.json().catch(() => ({}))) as { status?: string };
    return j.status === "ONAY" ? "ONAY" : j.status === "RET" ? "RET" : "UNAVAILABLE";
  } catch {
    return "UNAVAILABLE";
  }
}

export async function iysCheck(e164: string, type: IysType = "MESAJ"): Promise<IysResult> {
  const phoneHash = blindIndex(e164);
  const cached = await db.iysQueryLog.findFirst({
    where: { phoneHash, type, result: { in: ["ONAY", "RET"] }, at: { gte: new Date(Date.now() - 3600_000) } },
    orderBy: { at: "desc" },
  });
  if (cached) return cached.result as IysResult;
  const result = await queryRemote(e164, type);
  await db.iysQueryLog.create({ data: { phoneHash, type, result, source: iysMode() } });
  return result;
}

/** Ret bildirimi (işçi): bağlantı yoksa kayıt PENDING kalır ve “İYS'ye bildirilecekler” listesinde görünür. */
export async function iysReportOptOut(e164: string, type: IysType): Promise<"SENT" | "PENDING" | "FAILED"> {
  const mode = iysMode();
  if (mode === "none") return "PENDING";
  if (mode === "mock") return process.env.NODE_ENV !== "production" ? "SENT" : "PENDING";
  try {
    const res = await fetch(`${process.env.IYS_URL!.replace(/\/$/, "")}/consents`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.IYS_TOKEN ?? ""}` },
      body: JSON.stringify({ brandCode: process.env.IYS_BRAND_CODE, recipient: e164, type, status: "RET", source: "HS_WEB", recipientType: "BIREYSEL", consentDate: new Date().toISOString() }),
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok ? "SENT" : "FAILED";
  } catch {
    return "FAILED";
  }
}
