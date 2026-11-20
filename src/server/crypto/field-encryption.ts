import { createCipheriv, createDecipheriv, createHmac, createSecretKey, randomBytes, type KeyObject } from "node:crypto";

/**
 * Uygulama düzeyinde alan şifreleme (docs/07 §3).
 * Biçim: "v1:<iv b64>:<tag b64>:<ciphertext b64>" — anahtar sürümü önekte tutulur, rotasyon için.
 */

// Anahtar süreç başına bir kez KeyObject olarak hazırlanır. Ham Buffer verilince OpenSSL 3 anahtarı her çağrıda
// yeniden kurar: ölçümde HMAC 32 → 3,9 µs, AES-GCM 50 → 10 µs (500k satırlık içe aktarmada dakikalar).
// Anahtar değişimi süreç yeniden başlatmasını gerektirir.
const keyCache = new Map<string, KeyObject>();
function key(name: "FIELD_ENCRYPTION_KEY" | "BLIND_INDEX_KEY"): KeyObject {
  const hit = keyCache.get(name);
  if (hit) return hit;
  const raw = process.env[name];
  if (!raw) throw new Error(`${name} tanımlı değil`);
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) throw new Error(`${name} 32 bayt olmalı`);
  const k = createSecretKey(buf);
  keyCache.set(name, k);
  return k;
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
