import { hash, verify } from "@node-rs/argon2";

// Argon2id, OWASP önerisine yakın parametreler
const OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(plain: string): Promise<string> {
  return hash(plain, OPTIONS);
}

export async function verifyPassword(hashed: string, plain: string): Promise<boolean> {
  try {
    return await verify(hashed, plain);
  } catch {
    return false;
  }
}

/** Şifre politikası: en az 12 karakter, harf ve rakam. */
export function passwordPolicyError(plain: string): string | null {
  if (plain.length < 12) return "Şifre en az 12 karakter olmalı.";
  if (!/[A-Za-zÇĞİÖŞÜçğıöşü]/.test(plain) || !/\d/.test(plain)) return "Şifre harf ve rakam içermeli.";
  return null;
}
