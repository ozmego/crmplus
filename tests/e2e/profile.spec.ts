import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { firstLogin } from "./helpers";

process.loadEnvFile?.(".env");
const db = new PrismaClient();
test.afterAll(async () => db.$disconnect());

// 1×1 PNG
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");
const iso = (d: Date) => d.toISOString().slice(0, 10);

test("casino müşteri profili (kimlik, belge, tercih, seyahat, kredi) ve raporlama modülü; yetkiye göre maskeleme", async ({ browser }) => {
  const s = Date.now().toString().slice(-6);
  const agentUser = await db.user.findUniqueOrThrow({ where: { email: "e2e-temsilci-c@crmplus.local" } });
  const casino = await db.casino.create({ data: { name: `E2E Profil Casino ${s}`, country: "CY", currency: "TRY" } });
  const guest = await db.guest.create({ data: { firstName: "Profil", lastName: `Oyuncu${s}`, country: "TR", ownerId: agentUser.id } });
  const start = new Date(Date.now() + 10 * 86_400_000);
  const trip = await db.trip.create({ data: { casinoId: casino.id, name: `Profil tripi ${s}`, startDate: start, endDate: new Date(start.getTime() + 4 * 86_400_000), createdBy: "e2e" } });
  await db.tripGuest.create({ data: { tripId: trip.id, guestId: guest.id, crmNo: guest.crmNo, guestName: `Profil Oyuncu${s}`, country: "TR" } });
  const newPage = async (email: string) => {
    const p = await (await browser.newContext()).newPage();
    await firstLogin(p, email);
    return p;
  };

  // 1. Operasyon (kimlik yetkili): eksikler → kimlik (geçersiz TC reddedilir) → tercih → casino no → seyahat → belge
  const ops = await newPage("e2e-ops-c@crmplus.local");
  await ops.goto(`/guests/${guest.id}?tab=casino`);
  await expect(ops.getByTestId("profile-gaps")).toContainText("Kimlik veya pasaport numarası");
  await expect(ops.getByTestId("profile-gaps")).toContainText("Yaklaşan trip için seyahat bilgisi");

  await ops.getByText("Kimlik bilgilerini düzenle").click();
  await ops.getByLabel("Uyruk (ISO)").fill("TR");
  await ops.getByLabel("Doğum tarihi").fill("1980-05-05");
  await ops.getByLabel("T.C. kimlik no (değiştirmek için)").fill("10000000145");
  await ops.getByRole("button", { name: "Kimliği kaydet" }).click();
  await expect(ops.locator("p[role=alert]")).toContainText("T.C. kimlik numarası geçersiz");
  await ops.getByLabel("T.C. kimlik no (değiştirmek için)").fill("10000000146");
  await ops.getByLabel("Pasaport no (değiştirmek için)").fill("u 123 4567");
  await ops.getByLabel("Pasaport geçerlilik").fill(iso(new Date(Date.now() + 3 * 365 * 86_400_000)));
  await ops.getByRole("button", { name: "Kimliği kaydet" }).click();
  await expect(ops.getByText("Kimlik bilgileri kaydedildi.")).toBeVisible();
  await expect(ops.getByText("10000000146", { exact: true })).toBeVisible();
  const prof = await db.guestProfile.findUniqueOrThrow({ where: { guestId: guest.id } });
  expect(prof.tcNoEnc?.startsWith("v1:")).toBe(true); // şifreli
  expect(JSON.stringify(prof)).not.toContain("10000000146");
  const audit = await db.auditLog.findFirstOrThrow({ where: { entityId: guest.id, action: "guest.identity.update" }, orderBy: { at: "desc" } });
  expect(JSON.stringify(audit.diff)).not.toContain("10000000146"); // denetim kaydına değer yazılmaz

  await ops.getByText("Tercihleri düzenle").click();
  await ops.getByLabel("Bakara").check();
  await ops.getByLabel("Masa alt limit").fill("1000");
  await ops.getByLabel("Masa üst limit").fill("50000");
  await ops.getByRole("button", { name: "Tercihleri kaydet" }).click();
  await expect(ops.getByText("Tercihler kaydedildi.")).toBeVisible();

  await ops.getByLabel("Casino", { exact: true }).selectOption({ label: casino.name });
  await ops.getByLabel("Oyuncu no").fill(`P-${s}`);
  await ops.getByRole("button", { name: "Ekle" }).click();
  await expect(ops.getByText(`P-${s}`)).toBeVisible();

  await ops.getByText("Seyahat bilgisi ekle").click();
  await ops.getByLabel("Gidiş uçuşu").fill("TK1234");
  await ops.getByLabel("Otel", { exact: true }).fill("Grand Otel");
  await ops.getByRole("button", { name: "Seyahati kaydet" }).click();
  await expect(ops.getByText("Seyahat bilgisi kaydedildi.")).toBeVisible();
  await expect(ops.getByTestId("travel").getByText(/TK1234/)).toBeVisible();

  await ops.getByText("Belge yükle").click();
  await ops.getByLabel("Tür").selectOption("PHOTO");
  await ops.getByLabel(/^Dosya/).setInputFiles({ name: "sahte.png", mimeType: "image/png", buffer: Buffer.from("bu bir resim degil") });
  await ops.getByRole("button", { name: "Yükle ve tara" }).click();
  await expect(ops.locator("p[role=alert]")).toContainText("Yalnız JPEG, PNG veya PDF");
  await ops.getByLabel(/^Dosya/).setInputFiles({ name: "vesikalik.png", mimeType: "image/png", buffer: PNG });
  await ops.getByRole("button", { name: "Yükle ve tara" }).click();
  await expect(ops.getByText(/Belge yüklendi/)).toBeVisible();
  const doc = await db.guestDocument.findFirstOrThrow({ where: { guestId: guest.id, deletedAt: null } });
  expect((await ops.request.get(`/api/guests/documents/${doc.id}`)).status()).toBe(400); // gerekçe zorunlu
  const opened = await ops.request.get(`/api/guests/documents/${doc.id}?reason=${encodeURIComponent("E2E casino kayıt kontrolü")}`);
  expect(opened.status()).toBe(200);
  expect(opened.headers()["content-type"]).toBe("image/png");
  expect(Buffer.from(await opened.body()).equals(PNG)).toBe(true);
  const opsUser = await db.user.findUniqueOrThrow({ where: { email: "e2e-ops-c@crmplus.local" } });
  expect(await db.accessLog.count({ where: { actorId: opsUser.id, resource: "guest.document", resourceId: doc.id, reason: "E2E casino kayıt kontrolü" } })).toBe(1);
  expect(await db.accessLog.count({ where: { actorId: opsUser.id, resource: "guest.identity", resourceId: guest.id } })).toBeGreaterThan(0);

  // 2. Temsilci (kimlik yetkisi yok): maskeli, düzenleme yok, belge açamaz
  const agent = await newPage("e2e-temsilci-c@crmplus.local");
  await agent.goto(`/guests/${guest.id}?tab=casino`);
  await expect(agent.getByText("•••••••••46")).toBeVisible();
  await expect(agent.getByText("10000000146")).toHaveCount(0);
  await expect(agent.getByText("Kimlik bilgilerini düzenle")).toHaveCount(0);
  await expect(agent.getByText("1 belge kayıtlı")).toBeVisible();
  expect((await agent.request.get(`/api/guests/documents/${doc.id}?reason=merak%20ettim%20bakayim`)).status()).toBe(403);
  await expect(agent.getByRole("definition").filter({ hasText: "Bakara" })).toBeVisible(); // tercihler görünür
  await agent.goto("/reports/players");
  await expect(agent).toHaveURL(/forbidden/); // oyuncu raporu yalnız operasyon/finans

  // 3. Finans: ön yatırım / kredi hattı (Finans sekmesi), erişim kaydı
  const fin = await newPage("e2e-finans-c@crmplus.local");
  await fin.goto(`/guests/${guest.id}?tab=finans`);
  await fin.getByLabel("Casino").selectOption({ label: `${casino.name} (TRY)` });
  await fin.getByLabel("Ön yatırım").fill("250000");
  await fin.getByRole("button", { name: "Kaydet" }).click();
  await expect(fin.getByRole("cell", { name: "250.000,00 TRY" })).toBeVisible();
  const finUser = await db.user.findUniqueOrThrow({ where: { email: "e2e-finans-c@crmplus.local" } });
  expect(await db.accessLog.count({ where: { actorId: finUser.id, resource: "finance:guest.credit", resourceId: guest.id } })).toBeGreaterThan(0);
  await fin.goto(`/reports/casinos?from=${iso(new Date())}&to=${iso(new Date(Date.now() + 30 * 86_400_000))}`);
  await expect(fin.getByRole("columnheader", { name: "Onaylı komisyon" })).toBeVisible();

  // 4. Raporlama: operasyon oyuncu raporunda oyuncuyu görür, gerekçeli Excel; casino raporunda finans kolonları yok
  const range = `from=${iso(new Date())}&to=${iso(new Date(Date.now() + 30 * 86_400_000))}`;
  await ops.goto(`/reports/players?${range}&casino=${casino.id}`);
  await expect(ops.getByRole("link", { name: `Profil Oyuncu${s}` })).toBeVisible();
  await expect(ops.getByRole("cell", { name: "Yeni" })).toBeVisible();
  expect((await ops.request.get(`/api/reports/players?${range}`)).status()).toBe(400);
  const why = `E2E aylık oyuncu listesi ${s}`;
  const xlsx = await ops.request.get(`/api/reports/players?${range}&casino=${casino.id}&reason=${encodeURIComponent(why)}`);
  expect(xlsx.status()).toBe(200);
  expect(xlsx.headers()["content-type"]).toContain("spreadsheetml");
  expect(await db.accessLog.count({ where: { actorId: opsUser.id, action: "export", resource: "report.players", reason: why } })).toBe(1);
  await ops.goto(`/reports/casinos?${range}`);
  await expect(ops.getByText("yalnız finans yetkisiyle görünür")).toBeVisible();
  await ops.goto(`/reports/calls?${range}`);
  await expect(ops.getByRole("heading", { name: "Çağrı ve kampanya raporu" })).toBeVisible();

  // 5. Sistem yöneticisi: rapor merkezini ve toplamları görür, oyuncu adlarını ve kartını görmez
  const admin = await newPage("e2e-admin-r@crmplus.local");
  await admin.goto("/reports");
  await expect(admin.getByRole("link", { name: /Oyuncu ve trip raporu/ })).toBeVisible();
  await admin.goto(`/reports/players?${range}&casino=${casino.id}`);
  await expect(admin.getByText("Oyuncu adları yalnız oyuncu görüntüleme yetkisiyle")).toBeVisible();
  await expect(admin.getByText(`Profil Oyuncu${s}`)).toHaveCount(0);
  await admin.goto(`/guests/${guest.id}`);
  await expect(admin).toHaveURL(/forbidden/);
});
