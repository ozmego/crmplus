import "server-only";
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Şifreli dosya deposu (yüklenen dosyalar; Aşama 1 sonunda ses kayıtları için MinIO'ya taşınacak).
 * Dosya biçimi: [12 bayt IV][16 bayt tag][şifreli içerik], AES-256-GCM.
 */
const ROOT = () => path.resolve(process.env.STORAGE_DIR ?? "storage");

function key(): Buffer {
  const k = Buffer.from(process.env.FIELD_ENCRYPTION_KEY ?? "", "base64");
  if (k.length !== 32) throw new Error("FIELD_ENCRYPTION_KEY 32 bayt olmalı");
  return k;
}

function resolveKey(storageKey: string): string {
  if (!/^[a-z]+\/[0-9a-f-]{36}$/.test(storageKey)) throw new Error("Geçersiz depolama anahtarı");
  return path.join(ROOT(), storageKey);
}

export async function putEncrypted(bucket: "imports" | "recordings" | "statements" | "documents", data: Buffer): Promise<string> {
  const storageKey = `${bucket}/${randomUUID()}`;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(data), cipher.final()]);
  const file = resolveKey(storageKey);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, Buffer.concat([iv, cipher.getAuthTag(), ct]));
  return storageKey;
}

export async function getDecrypted(storageKey: string): Promise<Buffer> {
  const buf = await readFile(resolveKey(storageKey));
  const decipher = createDecipheriv("aes-256-gcm", key(), buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]);
}

export async function removeObject(storageKey: string) {
  await rm(resolveKey(storageKey), { force: true });
}
