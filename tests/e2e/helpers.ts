import { expect, type Page } from "@playwright/test";
import { generateSync } from "otplib";

export const NEW_PASSWORD = "YeniSifre2026test";

/** Sunucunun giriş politikası (.env ile aynı): AUTH_MFA_REQUIRED=true ise MFA kurulumu da sınanır. */
export function mfaOn(): boolean {
  try {
    process.loadEnvFile?.(".env");
  } catch {
    /* .env yoksa ortam değişkenleri */
  }
  return process.env.AUTH_MFA_REQUIRED === "true";
}

/** İlk giriş: seed şifresi → şifre değişimi → (MFA açıksa) MFA kurulumu → dashboard. MFA sırrını döndürür (kapalıysa ""). */
export async function firstLogin(page: Page, email: string): Promise<string> {
  await page.goto("/login");
  await page.getByLabel("E-posta").fill(email);
  await page.getByLabel("Şifre").fill(process.env.SEED_ADMIN_PASSWORD!);
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await expect(page).toHaveURL(/change-password/);
  await page.getByLabel("Yeni şifre", { exact: true }).fill(NEW_PASSWORD);
  await page.getByLabel("Yeni şifre (tekrar)").fill(NEW_PASSWORD);
  await page.getByRole("button", { name: "Devam" }).click();
  if (!mfaOn()) {
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/Günaydın|İyi günler|İyi akşamlar/);
    return "";
  }
  await expect(page).toHaveURL(/mfa/);
  const secret = (await page.locator("p.font-mono").first().innerText()).trim();
  await page.getByLabel("Doğrulama kodu").fill(generateSync({ secret }));
  await page.getByRole("button", { name: "Doğrula" }).click();
  await page.getByRole("link", { name: "Kaydettim, devam et" }).click();
  return secret;
}
