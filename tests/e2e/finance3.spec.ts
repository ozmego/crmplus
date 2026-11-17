import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { firstLogin } from "./helpers";

process.loadEnvFile?.(".env");
const db = new PrismaClient();
test.afterAll(async () => db.$disconnect());

const RULES = (s: string) =>
  JSON.stringify([
    { name: `Net kayıp ${s}`, basis: "NET_LOSS", scope: "PERIOD_TOTAL", tierMode: "MARGINAL", tiers: [{ from: 0, to: 1000000, rate: 0.1 }, { from: 1000000, to: null, rate: 0.12 }], min: null, max: null, currency: "TRY", priority: 1, netWinBehavior: "CARRY_OVER" },
    { name: `Almanya misafiri ${s}`, basis: "GUEST_COUNT", scope: "PERIOD_TOTAL", tierMode: "MARGINAL", tiers: [{ from: 0, to: null, amount: 1000 }], min: null, max: null, currency: "TRY", priority: 2, netWinBehavior: "ZERO", filter: { countries: ["DE"] } },
  ]);

async function upload(page: Page, file: { name: string; body: string }, casino?: string, period?: string) {
  if (casino) {
    await page.goto("/finance");
    await page.getByText("Casino ekstresi yükle").click();
    await page.getByLabel("Casino", { exact: true }).selectOption({ label: casino });
    await page.getByLabel("Dönem", { exact: true }).fill(period!);
  }
  await page.getByLabel("Ekstre dosyası (xlsx, csv)").setInputFiles({ name: file.name, mimeType: "text/csv", buffer: Buffer.from(file.body, "utf8") });
  await page.getByRole("button", { name: "Yükle ve eşle" }).click();
  await expect(page.getByText("Ekstre yüklendi ve eşlendi.")).toBeVisible({ timeout: 30_000 });
}

test("Aşama 3: ülke filtreli kural + net kazanç devri → birincil motor → ekstre (kaynak dosya) → gerekçeli mutabakat → ekstreden sonuç işleme → devirle sonraki dönem; bulgular", async ({ browser }) => {
  test.setTimeout(420_000);
  const s = Date.now().toString().slice(-6);
  const casino = `E2E Casino3 ${s}`;
  const tr = await db.guest.create({ data: { firstName: "Türk", lastName: `Misafir${s}`, country: "TR" } });
  const de = await db.guest.create({ data: { firstName: "Alman", lastName: `Misafir${s}`, country: "DE" } });
  const page = async (email: string) => {
    const p = await (await browser.newContext()).newPage();
    await firstLogin(p, email);
    return p;
  };

  // 1. Hazırlayan: casino + sözleşme (ülke filtreli bileşen) + Ekim tripi + sonuçlar (kaynak referanssız)
  const f3 = await page("e2e-finans3@crmplus.local");
  await f3.goto("/finance/contracts");
  await f3.getByLabel("Ad", { exact: true }).fill(casino);
  await f3.getByRole("button", { name: "Ekle" }).click();
  const sec = f3.locator("section", { hasText: casino });
  await sec.getByText("Sözleşme veya yeni sürüm ekle").click();
  await sec.getByLabel("Yeni sözleşme adı").fill("2026 sözleşmesi");
  await sec.getByLabel("Geçerlilik başlangıcı").fill("2026-01-01");
  await sec.getByLabel(/Kural bileşenleri/).fill(RULES(s));
  await sec.getByRole("button", { name: "Sürümü kaydet" }).click();
  await expect(sec.getByText(/nitelikli misafir: ülke DE/)).toBeVisible();

  await f3.goto("/finance/trips");
  await f3.getByLabel("Casino").selectOption({ label: casino });
  await f3.getByLabel("Ad", { exact: true }).fill(`Ekim ${s}`);
  await f3.getByLabel("Başlangıç").fill("2026-10-01");
  await f3.getByLabel("Bitiş").fill("2026-10-05");
  await f3.getByRole("button", { name: "Oluştur" }).click();
  await f3.getByRole("link", { name: `Ekim ${s}` }).click();
  for (const [i, g] of [tr, de].entries()) {
    await f3.getByLabel("CRM no").fill(String(g.crmNo));
    await f3.getByRole("button", { name: "Ekle" }).click();
    await expect(f3.getByLabel("Misafir").locator("option", { hasText: g.lastName })).toHaveCount(i + 1); // iki misafirin soyadı aynı
  }
  const tripUrl = f3.url();
  for (const [g, amount] of [[tr, "100000"], [de, "-300000"]] as const) {
    await f3.goto(tripUrl);
    await f3.getByLabel("Misafir").selectOption({ label: `CRM-${String(g.crmNo).padStart(6, "0")} ${g.firstName} ${g.lastName}` });
    await f3.getByLabel("Tarih").fill("2026-10-03");
    await f3.getByLabel("Net kayıp (+) / kazanç (−)").fill(amount);
    await f3.getByRole("button", { name: "Kaydet" }).click();
    await expect(f3.getByRole("link", { name: "2026-10" })).toBeVisible();
  }
  await f3.getByRole("link", { name: "2026-10" }).click();
  await expect(f3).toHaveURL(/\/finance\/periods\//, { timeout: 60_000 });
  const octUrl = f3.url();
  // Net −200.000 → kayıp bileşeni 0, kazanç devreder; Almanya bileşeni 1 × 1.000
  await expect(f3.getByTestId("engine-total")).toHaveText("1.000,00 TRY");
  await expect(f3.getByTestId("engine")).toContainText("sonraki döneme devreder");
  await expect(f3.getByTestId("anomalies")).toContainText("kaynak referansı yok");

  // 2. Onaylayan: birincil moda geçer (gerekçeli)
  const f4 = await page("e2e-finans4@crmplus.local");
  await f4.goto("/finance");
  await f4.getByTestId("engine-mode").getByLabel("Gerekçe").fill("Gölge modda 3 dönem motorla uyumlu");
  await f4.getByRole("button", { name: "Birincil moda geç" }).click();
  await expect(f4.getByTestId("engine-mode")).toContainText("Birincil");

  // 3. Hazırlayan: tutarı boş bırakır → motor sonucu; onaylayan farksız onaylar
  await f3.goto(octUrl);
  await f3.getByLabel("Hesap açıklaması").fill("Motor: net kazanç devri + 1 Almanya misafiri");
  await f3.getByRole("button", { name: "Taslak oluştur" }).click();
  await expect(f3.getByTestId("calc-diff")).toContainText("Motor sonucu kullanıldı");
  await f3.getByRole("button", { name: "İncelemeye gönder" }).click();
  await expect(f3.getByText("İncelemede", { exact: true })).toBeVisible();
  await f4.goto(octUrl);
  await f4.getByRole("button", { name: "Onayla", exact: true }).click();
  await expect(f4.getByText("Onaylandı", { exact: true })).toBeVisible();

  // 4. Ekim ekstresi (kaynak dosya): DE misafiri −290.000 (girilen −300.000), bilinmeyen CRM satırı
  const csv = (rows: string[]) => ["CRM No;Ad Soyad;Tarih;Net Kayıp;Rolling", ...rows].join("\n");
  await f3.goto(octUrl);
  await upload(f3, { name: `ekim-${s}.csv`, body: csv([`${tr.crmNo};Türk Misafir;03.10.2026;100.000,00;0`, `${de.crmNo};Alman Misafir;03.10.2026;-290.000,00;0`, `999999;Bilinmeyen;03.10.2026;1.000,00;0`]) });
  await f3.reload();
  await expect(f3.getByTestId("statements")).toContainText("eşleşen 2 · eşleşmeyen 1");
  await expect(f3.getByTestId("statements").getByRole("button", { name: "Sonuç olarak işle" })).toHaveCount(0); // yükleyen işleyemez

  // 5. Onaylayan: ekstreyle mutabakat — fark var → gerekçe zorunlu
  await f4.goto(octUrl);
  await f4.getByRole("button", { name: "Ekstreyle mutabakat" }).click();
  await expect(f4.getByText("Ekstre ile fark var: mutabakat için gerekçe yazın.")).toBeVisible();
  await f4.getByLabel("Fark varsa gerekçe").fill("DE misafiri 10.000 TL farkı Kasım'da düzeltilecek");
  await f4.getByRole("button", { name: "Ekstreyle mutabakat" }).click();
  await expect(f4.getByTestId("recon-summary")).toContainText("fark");
  const oct = await db.commissionCalculation.findFirstOrThrow({ where: { period: { casino: { name: casino }, period: "2026-10" } } });
  expect(oct.status).toBe("RECONCILED");
  expect(oct.method).toBe("ENGINE");
  expect(oct.statementId).not.toBeNull();
  const st = await db.casinoStatement.findUniqueOrThrow({ where: { id: oct.statementId! } });
  await f4.goto(`/finance/statements/${st.id}`);
  await expect(f4.getByTestId("reconciliation")).toContainText("Fark var");
  await expect(f4.getByTestId("statement-lines")).toContainText("Dönem tripinde yok"); // CRM no var ama bu casinonun dönem tripinde değil

  // 6. Kasım: yalnız ekstre (sonuç elle girilmedi) → başka kullanıcı sonuç olarak işler → devir düşülerek motor
  await f3.goto("/finance/trips");
  await f3.getByLabel("Casino").selectOption({ label: casino });
  await f3.getByLabel("Ad", { exact: true }).fill(`Kasım ${s}`);
  await f3.getByLabel("Başlangıç").fill("2026-11-01");
  await f3.getByLabel("Bitiş").fill("2026-11-05");
  await f3.getByRole("button", { name: "Oluştur" }).click();
  await f3.getByRole("link", { name: `Kasım ${s}` }).click();
  await f3.getByLabel("CRM no").fill(String(tr.crmNo));
  await f3.getByRole("button", { name: "Ekle" }).click();
  await expect(f3.getByLabel("Misafir").locator("option", { hasText: tr.lastName })).toHaveCount(1);
  await upload(f3, { name: `kasim-${s}.csv`, body: csv([`${tr.crmNo};Türk Misafir;05.11.2026;1.200.000,00;0`]) }, casino, "2026-11");
  const nov = await db.casinoStatement.findFirstOrThrow({ where: { casinoId: st.casinoId, period: "2026-11" } });
  expect(await db.commissionPeriod.count({ where: { casinoId: st.casinoId, period: "2026-11" } })).toBe(0); // dönem henüz açılmadı
  // Yükleyen işleyemez; başka bir finans kullanıcısı ekstre ayrıntısından işler ve dönem açılır
  await f3.goto(`/finance/statements/${nov.id}`);
  await expect(f3.getByText("Ekstreyi yükleyen kişi sonuç olarak işleyemez")).toBeVisible();
  await f4.goto(`/finance/statements/${nov.id}`);
  await f4.getByRole("button", { name: "Sonuç olarak işle" }).click();
  await expect(f4.getByText(/· sonuç olarak işlendi/)).toBeVisible(); // başarıda form kalkar, durum kalıcı görünür
  const p11 = await db.commissionPeriod.findUniqueOrThrow({ where: { casinoId_period: { casinoId: st.casinoId, period: "2026-11" } } });
  await f4.goto(`/finance/periods/${p11.id}`);
  // (1.200.000 − 200.000 devir) = 1.000.000 × %10 = 100.000
  await expect(f4.getByTestId("engine-total")).toHaveText("100.000,00 TRY");
  await expect(f4.getByTestId("engine")).toContainText("önceki dönemden devreden net kazanç");
  const r = await db.gamingResult.findFirstOrThrow({ where: { periodId: p11.id } });
  expect(r.source).toBe("STATEMENT");
  expect(r.sourceRef).toBe(`ekstre:${nov.id}#2`);
  await expect(f4.getByTestId("anomalies")).not.toContainText("kaynak referansı yok");

  // Motor modunu gölgeye geri al (diğer testler için)
  await f4.goto("/finance");
  await f4.getByTestId("engine-mode").getByLabel("Gerekçe").fill("E2E sonunda gölge moda dönüş");
  await f4.getByRole("button", { name: "Gölge moda dön" }).click();
  await expect(f4.getByTestId("engine-mode")).toContainText("Gölge mod");

  // 7. Operasyon anomali raporu (toplulaştırılmış) açılır
  const ops = await page("e2e-ops-a@crmplus.local");
  await ops.goto("/reports/anomalies");
  await expect(ops.getByTestId("ops-anomalies")).toBeVisible();
  await ops.goto("/finance");
  await expect(ops).toHaveURL(/\/forbidden/); // operasyon finansa erişemez
});
