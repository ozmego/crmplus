import { expect, test } from "@playwright/test";
import ExcelJS from "exceljs";
import { PrismaClient } from "@prisma/client";
import { decrypt } from "../../src/server/crypto/field-encryption";
import { firstLogin } from "./helpers";

process.loadEnvFile?.(".env");
const db = new PrismaClient();
test.afterAll(async () => db.$disconnect());

test("Excel içe aktarma: yükle → eşle → önizle → karar → uygula → hata raporu → geri al", async ({ page }) => {
  // Mevcut kayıtlardan test senaryosu kur
  const granted = await db.guest.findFirstOrThrow({
    where: { consents: { some: { channel: "CALL", status: "GRANTED" } }, city: null, blocks: { none: {} } },
    include: { phones: true },
    orderBy: { crmNo: "asc" },
  });
  const denied = await db.guest.findFirstOrThrow({ where: { consents: { some: { channel: "CALL", status: "DENIED" } } }, orderBy: { crmNo: "asc" } });
  const conflictGuest = await db.guest.findFirstOrThrow({ where: { id: { notIn: [granted.id, denied.id] } }, orderBy: { crmNo: "desc" } });
  // Eşleşen misafire izin + yeni numara (toplu uygulama yolu: izin ekleme/güncelleme, telefon ekleme)
  const consentGuest = await db.guest.findFirstOrThrow({
    where: { id: { notIn: [granted.id, denied.id, conflictGuest.id] }, anonymizedAt: null, blocks: { none: {} }, consents: { none: { channel: "CALL", status: { in: ["GRANTED", "DENIED"] } } } },
    orderBy: { crmNo: "asc" },
  });
  const consentBefore = await db.consentRecord.findUnique({ where: { guestId_channel: { guestId: consentGuest.id, channel: "CALL" } } });
  const phoneCountBefore = await db.guestPhone.count({ where: { guestId: consentGuest.id } });
  const grantedPhone = decrypt(granted.phones[0].e164Enc);
  const stamp = Date.now().toString().slice(-6);

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Misafirler");
  ws.addRow(["CRM ID", "Adı", "Soyadı", "Cep Telefonu", "Şehir", "Arama İzni", "İzin Tarihi", "İzin Kaynağı", "Net Kayıp"]);
  ws.addRow(["", "Test", `Yeni${stamp}`, `0532 9${stamp.slice(0, 2)} ${stamp.slice(2, 4)} ${stamp.slice(4, 6)}`, "İzmir", "Evet", "01.06.2026", "Fuar formu", 125000]); // 2: yeni
  ws.addRow(["", granted.firstName, granted.lastName, grantedPhone, "Antalya", "", "", "", 5000]); // 3: telefon+isim eşleşir, şehir doldurulur
  ws.addRow([`CRM-${conflictGuest.crmNo}`, conflictGuest.firstName, `${conflictGuest.lastName}oğlu`, "", "", "", "", "", ""]); // 4: soyad çakışması
  ws.addRow(["", "", "Eksik", "9.05E+11", "", "", "", "", ""]); // 5: ad yok + bozuk telefon → hatalı
  ws.addRow(["", "Test", `Yeni${stamp}`, `0532 9${stamp.slice(0, 2)} ${stamp.slice(2, 4)} ${stamp.slice(4, 6)}`, "İzmir", "", "", "", ""]); // 6: dosya içi mükerrer
  ws.addRow([`CRM-${denied.crmNo}`, denied.firstName, denied.lastName, "", "", "Evet", "01.06.2026", "Fuar formu", ""]); // 7: ret varken izin → inceleme
  ws.addRow([`CRM-${consentGuest.crmNo}`, consentGuest.firstName, consentGuest.lastName, `0533 8${stamp.slice(0, 2)} ${stamp.slice(2, 4)} ${stamp.slice(4, 6)}`, "", "Evet", "01.06.2026", "Fuar formu", ""]); // 8: izin + yeni numara
  const buffer = Buffer.from(await wb.xlsx.writeBuffer());

  await firstLogin(page, "veri@crmplus.local");
  await page.goto("/imports");
  await page.getByLabel("Dosya (.xlsx, .csv · en fazla 50 MB)").setInputFiles({ name: `test-${stamp}.xlsx`, mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer });
  await page.getByLabel("Amaç").selectOption("UPDATE");
  await page.getByLabel("Kaynak").fill("E2E test listesi");
  await page.getByRole("button", { name: /Yükle ve tara/ }).click();

  // Eşleme önerileri
  await expect(page.getByRole("heading", { name: /Sütunları eşleştir/ })).toBeVisible();
  await expect(page.getByLabel("Cep Telefonu için CRM alanı")).toHaveValue("phone1");
  await expect(page.getByLabel("Net Kayıp için CRM alanı")).toHaveValue("financial");
  await expect(page.getByText("125000")).toHaveCount(0); // finansal örnek değer maskeli
  await page.getByRole("button", { name: /Eşlemeyi kaydet ve önizle/ }).click();

  // Önizleme
  await expect(page.getByText("finansal sütun tanındı")).toBeVisible();
  const batch = await db.importBatch.findFirstOrThrow({ where: { fileName: `test-${stamp}.xlsx` } });
  const s = batch.summary as Record<string, number>;
  expect(s).toMatchObject({ new: 1, conflict: 1, invalid: 1, dupInFile: 1, consentConflicts: 1 });
  expect(s.changed).toBeGreaterThanOrEqual(2);

  // Çakışma kararı verilmeden uygulanamaz
  await expect(page.getByRole("button", { name: "Uygula ▸" })).toBeDisabled();
  await page.getByRole("button", { name: "Yeni değeri kullan" }).first().click();
  await expect(page.getByRole("button", { name: "Uygula ▸" })).toBeEnabled();
  await page.getByRole("button", { name: "Uygula ▸" }).click();
  await expect(page.getByText(/Uygulandı/).first()).toBeVisible();

  // Veritabanı doğrulamaları
  const created = await db.guest.findFirstOrThrow({ where: { lastName: `Yeni${stamp}` }, include: { phones: true, consents: true } });
  expect(created.phones[0].e164Enc.startsWith("v1:")).toBe(true); // telefon şifreli
  expect(created.consents.find((c) => c.channel === "CALL")?.status).toBe("GRANTED");
  const filled = await db.guest.findUniqueOrThrow({ where: { id: granted.id } });
  expect(filled.city).toBe("Antalya");
  expect(await db.fieldHistory.count({ where: { guestId: granted.id, importBatchId: batch.id, field: "city" } })).toBe(1);
  const renamed = await db.guest.findUniqueOrThrow({ where: { id: conflictGuest.id } });
  expect(renamed.lastName).toBe(`${conflictGuest.lastName}oğlu`);
  const stillDenied = await db.consentRecord.findUniqueOrThrow({ where: { guestId_channel: { guestId: denied.id, channel: "CALL" } } });
  expect(stillDenied.status).toBe("DENIED"); // dosyadaki izin reti ezemez
  expect(await db.reviewItem.count({ where: { sourceRef: `import:${batch.id}`, kind: "CONSENT_CONFLICT" } })).toBe(1);
  const newConsent = await db.consentRecord.findUniqueOrThrow({ where: { guestId_channel: { guestId: consentGuest.id, channel: "CALL" } } });
  expect(newConsent).toMatchObject({ status: "GRANTED", sourceSystem: `import:${batch.id}`, source: "Fuar formu" });
  expect(newConsent.grantedAt?.toISOString().slice(0, 10)).toBe("2026-06-01");
  expect(await db.guestPhone.count({ where: { guestId: consentGuest.id } })).toBe(phoneCountBefore + 1);
  expect(await db.consentHistory.count({ where: { guestId: consentGuest.id, source: `import:${batch.id}`, newStatus: "GRANTED" } })).toBe(1);
  const rowsJson = JSON.stringify(
    await db.importRow.findMany({ where: { batchId: batch.id }, select: { raw: true, normalized: true, errors: true, applied: true } }),
  );
  expect(rowsJson).not.toContain("125000"); // finansal değer saklanmadı
  expect(rowsJson).not.toContain(grantedPhone); // açık telefon saklanmadı

  // Hata raporu
  const res = await page.request.get(`/api/imports/${batch.id}/errors`);
  expect(res.status()).toBe(200);
  const report = new ExcelJS.Workbook();
  await report.xlsx.load((await res.body()) as unknown as ArrayBuffer);
  const rep = report.getWorksheet("Hatalar")!;
  expect(rep.getRow(1).values).toContain("Hata/uyarı kodu");
  expect(rep.getRow(1).values).not.toContain("Net Kayıp");
  expect(rep.actualRowCount).toBeGreaterThanOrEqual(3);

  // İnceleme kuyruğu: izin çakışması kanıtsız kabul edilemez, ret korunur
  const conflictItem = await db.reviewItem.findFirstOrThrow({ where: { sourceRef: `import:${batch.id}`, kind: "CONSENT_CONFLICT" } });
  await page.goto("/review?kind=CONSENT_CONFLICT");
  const card = page.locator("li", { has: page.locator(`#r-${conflictItem.id}`) });
  await card.getByLabel("Gerekçe (kayıt altına alınır)").fill("E2E: ret kaydı korunmalı");
  await card.getByRole("button", { name: "Yeni izni kanıtla kabul et" }).click();
  await expect(card.getByRole("alert")).toContainText("kanıt");
  await card.getByRole("button", { name: "Ret korunsun" }).click();
  await expect.poll(async () => (await db.reviewItem.findUniqueOrThrow({ where: { id: conflictItem.id } })).status).toBe("RESOLVED");
  expect((await db.consentRecord.findUniqueOrThrow({ where: { guestId_channel: { guestId: denied.id, channel: "CALL" } } })).status).toBe("DENIED");

  // Geri al
  await page.goto(`/imports/${batch.id}`);
  await page.getByLabel("Gerekçe").fill("E2E testi geri alma");
  await page.getByRole("button", { name: "Geri al" }).click();
  await expect(page.getByText(/Geri alındı ·/)).toBeVisible();
  expect(await db.guest.count({ where: { lastName: `Yeni${stamp}` } })).toBe(0);
  expect((await db.guest.findUniqueOrThrow({ where: { id: granted.id } })).city).toBeNull();
  expect((await db.guest.findUniqueOrThrow({ where: { id: conflictGuest.id } })).lastName).toBe(conflictGuest.lastName);
  expect(await db.guestPhone.count({ where: { guestId: consentGuest.id } })).toBe(phoneCountBefore);
  const consentAfter = await db.consentRecord.findUnique({ where: { guestId_channel: { guestId: consentGuest.id, channel: "CALL" } } });
  expect(consentAfter?.status ?? null).toBe(consentBefore?.status ?? null);
});
