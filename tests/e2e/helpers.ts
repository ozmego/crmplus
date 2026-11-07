import { expect, type Page } from "@playwright/test";
import { generateSync } from "otplib";

export const NEW_PASSWORD = "YeniSifre2026test";

/** İlk giriş: seed şifresi → şifre değişimi → MFA kurulumu. MFA sırrını döndürür. */
export async function firstLogin(page: Page, email: string): Promise<string> {
  await page.goto("/login");
  await page.getByLabel("E-posta").fill(email);
  await page.getByLabel("Şifre").fill(process.env.SEED_ADMIN_PASSWORD!);
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await expect(page).toHaveURL(/change-password/);
  await page.getByLabel("Yeni şifre", { exact: true }).fill(NEW_PASSWORD);
  await page.getByLabel("Yeni şifre (tekrar)").fill(NEW_PASSWORD);
  await page.getByRole("button", { name: "Devam" }).click();
  await expect(page).toHaveURL(/mfa/);
  const secret = (await page.locator("p.font-mono").first().innerText()).trim();
  await page.getByLabel("Doğrulama kodu").fill(generateSync({ secret }));
  await page.getByRole("button", { name: "Doğrula" }).click();
  await page.getByRole("link", { name: "Kaydettim, devam et" }).click();
  return secret;
}
