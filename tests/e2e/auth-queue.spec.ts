import { expect, test } from "@playwright/test";
import { generateSync } from "otplib";
import { PrismaClient } from "@prisma/client";
import { mfaOn } from "./helpers";

process.loadEnvFile?.(".env");
const db = new PrismaClient();
const EMAIL = "temsilci1@crmplus.local";
const NEW_PASSWORD = "YeniSifre2026test";

test.afterAll(async () => db.$disconnect());

test("ilk giriş → şifre değişimi → (MFA açıksa) MFA kurulumu → arama kuyruğu → çağrı kapatma", async ({ page }) => {
  // Hatalı şifre
  await page.goto("/login");
  await page.getByLabel("E-posta").fill(EMAIL);
  await page.getByLabel("Şifre").fill("yanlis-sifre-123");
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await expect(page.locator("p[role=alert]")).toContainText("hatalı");

  // Doğru şifre → zorunlu şifre değişimi
  await page.getByLabel("Şifre").fill(process.env.SEED_ADMIN_PASSWORD!);
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await expect(page).toHaveURL(/change-password/);
  await page.getByLabel("Yeni şifre", { exact: true }).fill(NEW_PASSWORD);
  await page.getByLabel("Yeni şifre (tekrar)").fill(NEW_PASSWORD);
  await page.getByRole("button", { name: "Devam" }).click();

  if (mfaOn()) {
    // MFA kurulumu: ekrandaki anahtarla kod üret
    await expect(page).toHaveURL(/mfa/);
    const secret = (await page.locator("p.font-mono").first().innerText()).trim();
    await page.getByLabel("Doğrulama kodu").fill(generateSync({ secret }));
    await page.getByRole("button", { name: "Doğrula" }).click();
    await expect(page.getByText("Kurtarma kodlarınız")).toBeVisible();
    await page.getByRole("link", { name: "Kaydettim, devam et" }).click();
  } else {
    // MFA kapalı: şifre değişiminden sonra doğrudan dashboard; /mfa adresi de ana sayfaya döner
    await expect(page).not.toHaveURL(/mfa/);
    await page.goto("/mfa");
    await expect(page).not.toHaveURL(/mfa/);
  }

  // Temsilci → dashboard (Benim günüm) → kuyruk
  await expect(page.getByRole("heading", { name: "Benim günüm" })).toBeVisible();
  await page.goto("/queue");
  await expect(page.getByRole("heading", { name: "Arama kuyruğu" })).toBeVisible();

  // Kuyrukta yalnız izni GRANTED olanlar: veritabanından beklenen sayıyı hesapla
  const user = await db.user.findUniqueOrThrow({ where: { email: EMAIL } });
  const expected = await db.task.count({
    where: {
      assigneeId: user.id,
      status: { in: ["OPEN", "IN_PROGRESS"] },
      nextAttemptAt: null,
      guest: { consents: { some: { channel: "CALL", status: "GRANTED" } }, blocks: { none: { removedAt: null } } },
    },
  });
  await expect(page.getByText(`${expected} kayıt`)).toBeVisible();
  const unknownInQueue = await db.task.count({
    where: { assigneeId: user.id, status: { in: ["OPEN", "IN_PROGRESS"] }, guest: { consents: { some: { channel: "CALL", status: { not: "GRANTED" } } } } },
  });
  expect(unknownInQueue).toBe(0); // izinsizler BLOCKED'a çekilmiş olmalı

  // Ara → Bağlandı → Bitir → sonuç kodu olmadan kayıt yapılamaz
  const firstName = (await page.locator("section h2").first().innerText()).trim();
  await page.getByRole("button", { name: "Ara", exact: true }).click();
  await expect(page.getByText("ARANIYOR", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Bağlandı", exact: true }).click();
  await expect(page.getByText("BAĞLANDI", { exact: true })).toBeVisible();
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: "Bitir", exact: true }).click();
  await expect(page.getByRole("button", { name: /Kaydet ve sıradaki/ })).toBeDisabled();

  // Not zorunlu kod + kısa not → hata; sonra hassas veri içeren uzun not → maskelenir
  await page.getByRole("radio", { name: /Ulaşıldı/ }).click();
  await page.getByLabel(/^Not/).fill("kısa");
  await page.getByRole("button", { name: /Kaydet ve sıradaki/ }).click();
  await expect(page.locator("p[role=alert]")).toContainText("10 karakter");
  await page.getByLabel(/^Not/).fill("Aralık tripi için teyit, kart 4111 1111 1111 1111 söyledi.");
  await page.getByRole("button", { name: /Kaydet ve sıradaki/ }).click();
  await expect(page.locator("p[role=status]")).toContainText("maskelendi");

  const call = await db.call.findFirstOrThrow({ where: { agentId: user.id }, orderBy: { startedAt: "desc" } });
  expect(call.disposition).toBe("REACHED");
  expect(call.talkSec).toBeGreaterThanOrEqual(1);
  expect(call.closedAt).not.toBeNull();

  // İkinci misafir: iletişim istemiyor → durdurma kaydı, tüm görevler iptal
  await expect(page.locator("section h2").first()).not.toHaveText(firstName);
  await page.getByRole("button", { name: "Ara", exact: true }).click();
  await page.getByRole("button", { name: "Bitir (bağlanmadı)" }).click();
  await page.getByRole("radio", { name: /İletişim istemiyor/ }).click();
  await expect(page.getByText(/iletişim anında durdurulur/)).toBeVisible();
  await page.getByRole("button", { name: /Kaydet ve sıradaki/ }).click();
  await expect(page.locator("p[role=status]")).toContainText("kaydedildi");

  const dncCall = await db.call.findFirstOrThrow({ where: { agentId: user.id, disposition: "DO_NOT_CONTACT" }, orderBy: { startedAt: "desc" } });
  const block = await db.contactBlock.findFirst({ where: { guestId: dncCall.guestId, removedAt: null } });
  expect(block).not.toBeNull();
  const openTasks = await db.task.count({ where: { guestId: dncCall.guestId, status: { in: ["OPEN", "IN_PROGRESS"] } } });
  expect(openTasks).toBe(0);
  const consent = await db.consentRecord.findUniqueOrThrow({ where: { guestId_channel: { guestId: dncCall.guestId, channel: "CALL" } } });
  expect(consent.status).toBe("DENIED");

  // Denetim kaydı değiştirilemez
  await expect(db.$executeRawUnsafe(`UPDATE "AuditLog" SET action = 'x'`)).rejects.toThrow(/append-only/);
});
