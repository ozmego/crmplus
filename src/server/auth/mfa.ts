import { createHash, randomBytes } from "node:crypto";
import { generateSecret, generateURI, verifySync } from "otplib";
import QRCode from "qrcode";

const ISSUER = "crmPlus";

export function newMfaSecret(): string {
  return generateSecret();
}

export async function mfaQrDataUrl(secret: string, email: string): Promise<string> {
  const uri = generateURI({ issuer: ISSUER, label: email, secret });
  return QRCode.toDataURL(uri, { margin: 1, width: 220 });
}

/** ±30 sn tolerans (bir zaman adımı). */
export function verifyTotp(secret: string, token: string): boolean {
  const clean = token.replace(/\s/g, "");
  if (!/^\d{6}$/.test(clean)) return false;
  try {
    return verifySync({ secret, token: clean, epochTolerance: 30 }).valid;
  } catch {
    return false;
  }
}

export function newRecoveryCodes(count = 8): { plain: string[]; hashes: string[] } {
  const plain = Array.from({ length: count }, () => randomBytes(5).toString("hex").toUpperCase());
  return { plain, hashes: plain.map(hashRecoveryCode) };
}

export function hashRecoveryCode(code: string): string {
  return createHash("sha256").update(code.trim().toUpperCase()).digest("hex");
}
