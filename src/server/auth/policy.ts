/**
 * Kimlik doğrulama politikası (ortam değişkenleriyle):
 *   AUTH_MFA_REQUIRED=true   iki adımlı doğrulama (TOTP) zorunlu; varsayılan kapalı (şirket kararı, 20 Kasım 2026)
 *   PASSWORD_MIN_LENGTH=8    şifre alt sınırı (en az 6); harf/rakam zorunluluğu yok
 * MFA kapalıyken giriş tek adımdır: şifre doğrulanınca oturum doğrulanmış sayılır.
 * Not: MFA kapalıyken hesap güvenliği yalnız şifreye dayanır; deneme sınırı ve geçici kilit çalışmaya devam eder.
 */
export function mfaRequired(): boolean {
  return process.env.AUTH_MFA_REQUIRED === "true";
}

export function passwordMinLength(): number {
  const n = Number(process.env.PASSWORD_MIN_LENGTH ?? 8);
  return Number.isInteger(n) && n >= 6 ? Math.min(n, 64) : 8;
}
