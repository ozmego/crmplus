import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { firstLogin } from "./helpers";

process.loadEnvFile?.(".env");
const db = new PrismaClient();
test.afterAll(async () => db.$disconnect());

test("yönetim: kullanıcı oluştur → pasifleştir (giriş engellenir) → etkinleştir → denetim kaydı; yetkisiz sayfa", async ({ page, browser }) => {
  const stamp = Date.now().toString().slice(-6);
  const email = `e2e-yeni-${stamp}@crmplus.local`;

  await firstLogin(page, "e2e-admin@crmplus.local");
  await page.goto("/admin/users");

  // Kendi satırında rol düğmesi yok (kendine rol veremez)
  const selfRow = page.locator("tr", { hasText: "e2e-admin@crmplus.local" });
  await expect(selfRow.getByRole("button", { name: "Roller" })).toHaveCount(0);

  // Yeni kullanıcı
  await page.getByRole("button", { name: "+ Yeni kullanıcı" }).click();
  await page.getByLabel("E-posta").fill(email);
  await page.getByLabel("Ad soyad").fill(`E2E Yeni ${stamp}`);
  await page.getByLabel("Çağrı merkezi personeli").check();
  await page.locator("#nu-reason").fill("E2E testi işe alım");
  await page.getByRole("button", { name: "Oluştur" }).click();
  const tempPw = (await page.locator("p.font-mono.text-lg").innerText()).trim();
  expect(tempPw).toMatch(/^[A-Za-z2-9]{16}$/);
  await page.getByRole("button", { name: "Kapat" }).click();

  // Pasifleştir
  const row = page.locator("tr", { hasText: email });
  await row.getByRole("button", { name: "Pasifleştir" }).click();
  await row.getByLabel("Gerekçe").fill("E2E testi ayrılış");
  await row.getByRole("button", { name: "Pasifleştir" }).click();
  await expect(row.getByText("Pasif")).toBeVisible();

  // Pasif kullanıcı giriş yapamaz
  const other = await browser.newPage();
  await other.goto("/login");
  await other.getByLabel("E-posta").fill(email);
  await other.getByLabel("Şifre").fill(tempPw);
  await other.getByRole("button", { name: "Giriş yap" }).click();
  await expect(other.locator("p[role=alert]")).toContainText("Hesap kapalı");

  // Etkinleştir → giriş şifre değişimine gider
  await row.getByRole("button", { name: "Etkinleştir" }).click();
  await row.getByLabel("Gerekçe").fill("E2E testi geri dönüş");
  await row.getByRole("button", { name: "Etkinleştir" }).click();
  await expect(row.getByText("Etkin", { exact: true })).toBeVisible();
  await other.getByRole("button", { name: "Giriş yap" }).click();
  await other.getByLabel("Şifre").fill(tempPw);
  await other.getByRole("button", { name: "Giriş yap" }).click();
  await expect(other).toHaveURL(/change-password/);

  // Denetim kaydı
  const created = await db.user.findUniqueOrThrow({ where: { email } });
  const actions = (await db.auditLog.findMany({ where: { entityId: created.id }, select: { action: true, reason: true } })).map((a) => a.action);
  expect(actions).toEqual(expect.arrayContaining(["user.create", "user.disabled", "user.enable"]));
  await page.goto(`/admin/audit?actor=${(await db.user.findUniqueOrThrow({ where: { email: "e2e-admin@crmplus.local" } })).id}`);
  await expect(page.getByText("user.disabled").first()).toBeVisible();

  // Temsilci yönetim sayfasını açamaz → yetkisiz sayfası + erişim kaydı
  const agentPage = await browser.newPage();
  await firstLogin(agentPage, "temsilci2@crmplus.local");
  await agentPage.goto("/admin/users");
  await expect(agentPage).toHaveURL(/forbidden/);
  const agent = await db.user.findUniqueOrThrow({ where: { email: "temsilci2@crmplus.local" } });
  expect(await db.accessLog.count({ where: { actorId: agent.id, action: "denied", resource: "page:user.view" } })).toBeGreaterThan(0);
});
