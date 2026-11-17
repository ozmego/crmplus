import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

/**
 * Uygulama düzeyinde alan şifreleme (docs/07 §3).
 * Biçim: "v1:<iv b64>:<tag b64>:<ciphertext b64>" — anahtar sürümü önekte tutulur, rotasyon için.
 */

// Anahtarlar her çağrıda yeniden çözülmez (toplu içe aktarmada yüz binlerce çağrı); ortam değişirse önbellek yenilenir
const keyCache = new Map<string, { raw: string; buf: Buffer }>();
function key(name: "FIELD_ENCRYPTION_KEY" | "BLIND_INDEX_KEY"): Buffer {
  const raw = process.env[name];
  if (!raw) throw new Error(`${name} tanımlı değil`);
  const hit = keyCache.get(name);
  if (hit && hit.raw === raw) return hit.buf;
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) throw new Error(`${name} 32 bayt olmalı`);
  keyCache.set(name, { raw, buf });
  return buf;
}

export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key("FIELD_ENCRYPTION_KEY"), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${ct.toString("base64")}`;
}

export function decrypt(payload: string): string {
  const [ver, ivB64, tagB64, ctB64] = payload.split(":");
  if (ver !== "v1" || !ivB64 || !tagB64 || ctB64 === undefined) throw new Error("Geçersiz şifreli veri");
  const decipher = createDecipheriv("aes-256-gcm", key("FIELD_ENCRYPTION_KEY"), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()]).toString("utf8");
}

/** Şifreli alanda eşitlik araması için HMAC-SHA256 özeti (blind index). */
export function blindIndex(value: string): string {
  return createHmac("sha256", key("BLIND_INDEX_KEY")).update(value.trim().toLowerCase()).digest("hex");
}
