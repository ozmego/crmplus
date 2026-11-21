import { hash, verify } from "@node-rs/argon2";
import { passwordMinLength } from "@/server/auth/policy";

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

/** Şifre politikası: en az PASSWORD_MIN_LENGTH karakter (vars. 8); karakter türü zorunluluğu yok. */
export function passwordPolicyError(plain: string, min = passwordMinLength()): string | null {
  if (plain.length < min) return `Şifre en az ${min} karakter olmalı.`;
  if (plain.length > 200) return "Şifre en fazla 200 karakter olabilir.";
  if (!plain.trim()) return "Şifre yalnız boşluktan oluşamaz.";
  return null;
}
