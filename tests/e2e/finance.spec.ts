import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { firstLogin } from "./helpers";

process.loadEnvFile?.(".env");
const db = new PrismaClient();
test.afterAll(async () => db.$disconnect());

test("finans: sözleşme → trip → sonuç → hesap → iki kişili onay → kilit → düzeltme; temsilci erişemez", async ({ page, browser }) => {
  const s = Date.now().toString().slice(-6);
  const casinoName = `E2E Casino ${s}`;
  const guest = await db.guest.findFirstOrThrow({ where: { anonymizedAt: null }, orderBy: { crmNo: "asc" } });

  // Hazırlayan
  await firstLogin(page, "e2e-finans1@crmplus.local");
  await expect(page.getByRole("heading", { name: "Finans", exact: true })).toBeVisible(); // dashboard bölümü
  await page.goto("/finance");
  await expect(page.getByText("Finansal veri")).toBeVisible();

  await page.goto("/finance/contracts");
  await page.getByLabel("Ad", { exact: true }).fill(casinoName);
  await page.getByRole("button", { name: "Ekle" }).click();
  const section = page.locator("section", { hasText: casinoName });
  await section.getByText("Sözleşme veya yeni sürüm ekle").click();
  await section.getByLabel("Yeni sözleşme adı").fill("2026 ana sözleşme");
  await section.getByLabel("Geçerlilik başlangıcı").fill("2026-01-01");
  await section.getByRole("button", { name: "Sürümü kaydet" }).click();
  await expect(section.getByText(/Sürüm 1 ·/)).toBeVisible();

  await page.goto("/finance/trips");
  await page.getByLabel("Casino").selectOption({ label: casinoName });
  await page.getByLabel("Ad", { exact: true }).fill(`Kasım grubu ${s}`);
  await page.getByLabel("Başlangıç").fill("2026-11-01");
  await page.getByLabel("Bitiş").fill("2026-11-05");
  await page.getByRole("button", { name: "Oluştur" }).click();
  await page.getByRole("link", { name: `Kasım grubu ${s}` }).click();
  await page.getByLabel("CRM no").fill(String(guest.crmNo));
  await page.getByRole("button", { name: "Ekle" }).click();
  await expect(page.getByLabel("Misafir").locator("option", { hasText: guest.lastName })).toHaveCount(1);
  await page.getByLabel("Misafir").selectOption({ index: 1 });
  await page.getByLabel("Tarih").fill("2026-11-03");
  await page.getByLabel("Net kayıp (+) / kazanç (−)").fill("3200000");
  await page.getByLabel("Rolling").fill("500000");
  await page.getByRole("button", { name: "Kaydet" }).click();
  await expect(page.getByRole("link", { name: "2026-11" })).toBeVisible();
  await page.getByRole("link", { name: "2026-11" }).click();

  // Hesap taslağı → incelemeye → hazırlayan onaylayamaz
  await expect(page.getByText("3.200.000,00 TRY")).toBeVisible();
  await page.getByLabel(/Komisyon tutarı/).fill("424000");
  await page.getByLabel("Hesap açıklaması").fill("1M × %10 + 2,2M × %12 = 364.000; 12 × 5.000 = 60.000");
  await page.getByRole("button", { name: "Taslak oluştur" }).click();
  await page.getByRole("button", { name: "İncelemeye gönder" }).click();
  await expect(page.getByText("İncelemede")).toBeVisible();
  await page.getByRole("button", { name: "Onayla" }).click();
  await expect(page.getByText("Hazırlayan kişi onaylayamaz")).toBeVisible();
  const periodUrl = page.url();

  // Onaylayan: onay + kilit
  const p2 = await browser.newPage();
  await firstLogin(p2, "e2e-finans2@crmplus.local");
  await p2.goto(periodUrl);
  // Gölge mod: motor 369.000 (364.000 + rolling ≥ 500.000 olan 1 misafir × 5.000); elle 424.000 → fark gerekçesi zorunlu
  await expect(p2.getByTestId("engine-total")).toHaveText("369.000,00 TRY");
  await expect(p2.getByTestId("calc-diff")).toContainText("fark 55.000,00 TRY");
  await p2.getByLabel("Motorla fark gerekçesi").fill("11 nitelikli misafir ekstrede ayrıca bildirildi");
  await p2.getByRole("button", { name: "Onayla" }).click();
  await expect(p2.getByText("Onaylandı", { exact: true })).toBeVisible();
  await p2.getByRole("button", { name: "Dönemi kilitle" }).click();
  await expect(p2.getByText(/Kilitli ·/)).toBeVisible();

  const calc = await db.commissionCalculation.findFirstOrThrow({ where: { period: { casino: { name: casinoName } } }, include: { period: true } });
  expect(calc.status).toBe("APPROVED");
  expect(calc.amount.toString()).toBe("424000");
  expect(calc.engineAmount?.toString()).toBe("369000");
  expect(calc.method).toBe("MANUAL");
  const snap = calc.snapshot as { contracts: { version: number }[]; inputs: unknown[] };
  expect(snap.contracts[0].version).toBe(1);
  expect(snap.inputs).toHaveLength(1);

  // Kilitli döneme sonuç girilemez
  const tripId = (await db.trip.findFirstOrThrow({ where: { name: `Kasım grubu ${s}` } })).id;
  await page.goto(`/finance/trips/${tripId}`);
  await page.getByLabel("Misafir").selectOption({ index: 1 });
  await page.getByLabel("Tarih").fill("2026-11-04");
  await page.getByLabel("Net kayıp (+) / kazanç (−)").fill("1000");
  await page.getByRole("button", { name: "Kaydet" }).click();
  await expect(page.getByText(/Dönem kilitli; değişiklik yapılamaz/)).toBeVisible();
  expect(await db.gamingResult.count({ where: { tripGuest: { tripId } } })).toBe(1);

  // Düzeltme: sonraki açık döneme yeni kayıt; hazırlayan ≠ onaylayan
  await page.goto(periodUrl);
  await page.getByLabel(/Tutar \(±/).fill("-12000");
  await page.getByLabel("Gerekçe").fill("Ekstre farkı: 2 misafir sonucu düzeltildi");
  await page.getByRole("button", { name: "Düzeltme kaydı oluştur" }).click();
  await expect(page.getByText("Düzeltme kaydı oluşturuldu.")).toBeVisible();
  const adj = await db.commissionAdjustment.findFirstOrThrow({ where: { calculationId: calc.id }, include: { period: true } });
  expect(adj.period.period).toBe("2026-12");
  expect((await db.commissionCalculation.findUniqueOrThrow({ where: { id: calc.id } })).amount.toString()).toBe("424000"); // orijinal değişmedi
  await p2.goto(`/finance/periods/${adj.periodId}`);
  await p2.getByRole("button", { name: "Düzeltmeyi onayla" }).click();
  await expect(p2.getByText("Onaylandı").first()).toBeVisible();

  // Casino profili (finans): trip, oyuncu ve finans bölümü; görüntüleme erişim kaydına yazılır
  const casino = await db.casino.findUniqueOrThrow({ where: { name: casinoName } });
  await page.goto("/locations");
  await page.getByRole("link", { name: new RegExp(casinoName) }).click();
  await expect(page.getByRole("heading", { name: casinoName })).toBeVisible();
  await expect(page.getByRole("link", { name: `Kasım grubu ${s}` })).toBeVisible();
  await expect(page.getByText("3.200.000,00 TRY")).toBeVisible();
  await expect(page.getByText("2026 ana sözleşme")).toBeVisible();

  // Oyuncu profili: finans rolü yalnız ad + CRM no ve finans sekmesini görür
  await page.getByRole("link", { name: new RegExp(guest.lastName) }).first().click();
  await expect(page.getByText(`OYUNCU PROFİLİ · CRM-${String(guest.crmNo).padStart(6, "0")}`)).toBeVisible();
  await expect(page.getByRole("link", { name: "Genel" })).toHaveCount(0);
  await expect(page.getByText("bu görüntüleme erişim kaydına yazıldı")).toBeVisible();
  // (aynı test oyuncusunun önceki koşulardan tripleri olabilir; bu koşunun tripine daraltılır)
  await expect(page.locator("div.overflow-x-auto", { hasText: `Kasım grubu ${s}` }).getByRole("cell", { name: "3.200.000,00 TRY" })).toBeVisible();
  const f1 = await db.user.findUniqueOrThrow({ where: { email: "e2e-finans1@crmplus.local" } });
  expect(await db.accessLog.count({ where: { actorId: f1.id, resource: "finance:casino", resourceId: casino.id } })).toBeGreaterThan(0);
  expect(await db.accessLog.count({ where: { actorId: f1.id, resource: "finance:guest", resourceId: guest.id } })).toBeGreaterThan(0);

  // Erişim kaydı ve temsilci izolasyonu
  expect(await db.accessLog.count({ where: { actorId: f1.id, resource: { startsWith: "finance:" } } })).toBeGreaterThan(3);
  const agent = await browser.newPage();
  await firstLogin(agent, "e2e-temsilci-f@crmplus.local");
  await agent.goto("/finance");
  await expect(agent).toHaveURL(/forbidden/);
  await agent.goto(periodUrl);
  await expect(agent).toHaveURL(/forbidden/);
  // Temsilci casino profillerine erişemez; oyuncu profilinde finans sekmesi yoktur, ?tab=finans genel sekmeye döner
  await agent.goto(`/locations/${casino.id}`);
  await expect(agent).toHaveURL(/forbidden/);
  // (temsilcinin kapsamına girsin diye oyuncuya açık görev atanır; tripli ve sonuçlu oyuncu)
  const agentUser = await db.user.findUniqueOrThrow({ where: { email: "e2e-temsilci-f@crmplus.local" } });
  const t = await db.task.create({ data: { guestId: guest.id, assigneeId: agentUser.id, reason: "E2E profil testi", priority: 1 } });
  await agent.goto(`/guests/${guest.id}?tab=finans`);
  await expect(agent.getByRole("heading", { name: "İletişim izinleri" })).toBeVisible();
  await expect(agent.getByRole("link", { name: "Finans" })).toHaveCount(0);
  await expect(agent.getByText("bu görüntüleme erişim kaydına yazıldı")).toHaveCount(0);
  await expect(agent.getByText("3.200.000")).toHaveCount(0);
  // Trip katılımı görünür, tutar görünmez
  await agent.getByRole("link", { name: "Tripler" }).click();
  await expect(agent.getByText(`Kasım grubu ${s}`)).toBeVisible();
  await expect(agent.getByText("3.200.000")).toHaveCount(0);
  await db.task.update({ where: { id: t.id }, data: { status: "CANCELLED", closeReason: "E2E" } });
});
