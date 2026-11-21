import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { firstLogin } from "./helpers";

process.loadEnvFile?.(".env");
const db = new PrismaClient();
test.afterAll(async () => db.$disconnect());

test("operasyon paneli ve raporlar: kapsam, gerekçeli dışa aktarma, yetkisiz panel", async ({ page, browser }) => {
  // Operasyon yöneticisi → dashboard (operasyon bölümü + grafik) → operasyon paneli
  await firstLogin(page, "operasyon@crmplus.local");
  await expect(page.getByRole("heading", { name: "Operasyon", exact: true })).toBeVisible();
  await expect(page.getByText("Tüm aramalar · son 14 gün")).toBeVisible();
  await page.goto("/ops");
  await expect(page.getByRole("heading", { name: "Operasyon paneli" })).toBeVisible();
  await expect(page.getByText("Bugün bekleyen arama")).toBeVisible();
  await expect(page.getByText("Ürün metrikleri · son 30 gün")).toBeVisible();

  // Rapor merkezi → personel raporu: tüm personel kapsamı
  await page.goto("/reports");
  await expect(page.getByRole("heading", { name: "Rapor merkezi" })).toBeVisible();
  await page.getByRole("link", { name: /Personel ve ekip raporu/ }).click();
  await expect(page.getByText("Tüm personel ·")).toBeVisible();
  const agentsWithCall = await db.user.count({ where: { status: "ACTIVE", roles: { some: { role: { key: { in: ["agent", "team_lead"] } } } } } });
  expect(await page.locator("tbody tr").count()).toBeGreaterThanOrEqual(Math.min(agentsWithCall, 1));

  // Gerekçesiz dışa aktarma reddedilir; gerekçeli olan erişim kaydına düşer
  const noReason = await page.request.get("/api/reports/agents");
  expect(noReason.status()).toBe(400);
  const ok = await page.request.get("/api/reports/agents?reason=E2E%20haftal%C4%B1k%20rapor");
  expect(ok.status()).toBe(200);
  expect(ok.headers()["content-type"]).toContain("spreadsheetml");
  const ops = await db.user.findUniqueOrThrow({ where: { email: "operasyon@crmplus.local" } });
  expect(await db.accessLog.count({ where: { actorId: ops.id, action: "export", resource: "report.agents", reason: "E2E haftalık rapor" } })).toBeGreaterThan(0);

  // Temsilci: rapor yalnız kendisi; operasyon paneli yetkisiz; dışa aktarma izni yok
  const agent = await browser.newPage();
  await firstLogin(agent, "e2e-temsilci@crmplus.local");
  await agent.goto("/reports/agents");
  await expect(agent.getByText("Kendi performansınız ·")).toBeVisible();
  await expect(agent.locator("tbody tr")).toHaveCount(1);
  await expect(agent.getByRole("button", { name: "Excel olarak indir" })).toHaveCount(0);
  expect((await agent.request.get("/api/reports/agents?reason=deneme%20deneme")).status()).toBe(403);
  await agent.goto("/ops");
  await expect(agent).toHaveURL(/forbidden/);
});
