import { expect, test, type Page } from "@playwright/test";
import ExcelJS from "exceljs";
import { PrismaClient } from "@prisma/client";
import { firstLogin } from "./helpers";

process.loadEnvFile?.(".env");
const db = new PrismaClient();
test.afterAll(async () => db.$disconnect());

async function xlsx(rows: (string | number)[][]) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Liste");
  rows.forEach((r) => ws.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

async function uploadForCompare(page: Page, name: string, buffer: Buffer) {
  await page.goto("/imports");
  await page.getByLabel("Dosya (.xlsx, .csv · en fazla 50 MB)").setInputFiles({ name, mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer });
  await page.getByLabel("Amaç").selectOption("COMPARE");
  await page.getByLabel("Kaynak").fill("E2E karşılaştırma");
  await page.getByRole("button", { name: /Yükle ve tara/ }).click();
  await page.getByRole("button", { name: /Eşlemeyi kaydet ve önizle/ }).click();
  await expect(page.getByText("Bu yükleme yalnız karşılaştırma amaçlı")).toBeVisible();
  return db.importBatch.findFirstOrThrow({ where: { fileName: name } });
}

test("liste karşılaştırma: iki dosya → 7 durumdan beklenenler; hiçbir kayıt değişmez", async ({ page }) => {
  const s = Date.now().toString().slice(-6);
  const tel = (n: number) => `0534${s.slice(0, 3)}${String(n).padStart(4, "0")}`;
  const head = ["Adı", "Soyadı", "Cep Telefonu", "Şehir", "Arama İzni", "İzin Tarihi", "İzin Kaynağı"];
  const left = await xlsx([
    head,
    ["Ali", `Aynı${s}`, tel(1), "Bursa", "", "", ""],
    ["Ayşe", `Şehir${s}`, tel(2), "İzmir", "", "", ""],
    ["Can", `İsim${s}`, tel(3), "", "", "", ""],
    ["Eda", `İzin${s}`, tel(4), "", "Hayır", "01.06.2026", "Form"],
    ["Gül", `Eksik${s}`, tel(5), "", "", "", ""],
  ]);
  const right = await xlsx([
    head,
    ["Ali", `Aynı${s}`, tel(1), "Bursa", "", "", ""], // aynı
    ["Ayşe", `Şehir${s}`, tel(2), "Antalya", "", "", ""], // diğer alan
    ["Murat", `Başka${s}`, tel(3), "", "", "", ""], // aynı telefon farklı isim → çelişki
    ["Eda", `İzin${s}`, tel(4), "", "Evet", "01.07.2026", "Form"], // izin çelişkisi
    ["Yeni", `Kişi${s}`, tel(6), "", "", "", ""], // yeni
  ]);

  await firstLogin(page, "e2e-veri@crmplus.local");
  const guestsBefore = await db.guest.count();
  const a = await uploadForCompare(page, `sol-${s}.xlsx`, left);
  const b = await uploadForCompare(page, `sag-${s}.xlsx`, right);

  await page.goto("/compare");
  await page.locator("#left").selectOption(a.id);
  await page.locator("#right").selectOption(b.id);
  await page.getByRole("button", { name: "Karşılaştır" }).click();
  await expect(page.getByRole("heading", { name: "Dosya ↔ dosya" })).toBeVisible();

  const job = await db.comparisonJob.findFirstOrThrow({ where: { rightRef: `import:${b.id}` }, orderBy: { createdAt: "desc" } });
  expect(job.summary).toMatchObject({ SAME: 1, OTHER_CHANGED: 1, CONFLICT: 2, NEW: 1, MISSING_IN_FILE: 1 });
  await expect(page.getByText("Aynı telefon farklı isimle")).toBeVisible();
  await expect(page.getByText("Antalya")).toBeVisible();
  await page.getByRole("link", { name: /Tabanda var, yeni dosyada yok/ }).click();
  await expect(page.getByText("silinmez")).toBeVisible();

  // Karşılaştırma hiçbir kaydı değiştirmez
  expect(await db.guest.count()).toBe(guestsBefore);
});
