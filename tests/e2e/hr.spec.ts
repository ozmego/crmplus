import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import ExcelJS from "exceljs";
import { firstLogin } from "./helpers";

process.loadEnvFile?.(".env");
const db = new PrismaClient();
test.afterAll(async () => db.$disconnect());

const ist = (d = new Date()) => new Date(d.getTime() + 3 * 3600_000).toISOString().slice(0, 10);
const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const at = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+03:00`);

/** Geçen ayın ikinci Pazartesi'si: ay kapanmış olsun (dönem hazırlanabilsin). */
function pastMonday() {
  const t = ist();
  const first = `${t.slice(0, 7)}-01`;
  const prev = addDays(first, -1).slice(0, 7);
  let d = `${prev}-08`;
  while (new Date(`${d}T00:00:00Z`).getUTCDay() !== 1) d = addDays(d, 1);
  return d;
}

async function fill(page: Page | ReturnType<Page["locator"]>, label: string, value: string) {
  await page.getByLabel(label, { exact: true }).fill(value);
}

test("personel ve puantaj: kayıt → çizelge (kural uyarısı) → otomatik puantaj → gerekçeli düzeltme → iki kişili onay → kilit → Excel; izin; saha rotası; yetki", async ({ browser }) => {
  test.setTimeout(300_000);
  const s = Date.now().toString().slice(-6);
  const team = await db.team.findFirstOrThrow({ where: { name: { startsWith: "E2E Ekip P" } }, orderBy: { createdAt: "desc" } });
  const agentUser = await db.user.findUniqueOrThrow({ where: { email: "e2e-temsilci-p@crmplus.local" } });
  const monday = pastMonday();
  const month = monday.slice(0, 7);
  const gunduz = await db.shiftTemplate.findUniqueOrThrow({ where: { name: "Gündüz" } });
  const newPage = async (email: string) => {
    const p = await (await browser.newContext()).newPage();
    await firstLogin(p, email);
    return p;
  };

  // 1. İK: personel kayıtları (CRM kullanıcısına bağlı temsilci + saha personeli)
  const hr1 = await newPage("e2e-ik1@crmplus.local");
  await expect(hr1).toHaveURL(/\/hr\/employees/);
  for (const [sicil, first, last, dept, email] of [
    [`P${s}`, "Puantaj", `Temsilci${s}`, "CALL_CENTER", "e2e-temsilci-p@crmplus.local"],
    [`S${s}`, "Saha", `Host${s}`, "FIELD", "e2e-saha@crmplus.local"],
  ]) {
    await hr1.goto("/hr/employees");
    await hr1.getByText("Personel ekle").click();
    const form = hr1.locator("details").filter({ hasText: "Personel ekle" });
    await fill(form, "Sicil no", sicil);
    await fill(form, "Ad", first);
    await fill(form, "Soyad", last);
    await form.getByLabel("Departman", { exact: true }).selectOption(dept);
    await form.getByLabel("Ekip", { exact: true }).selectOption(team.id);
    await fill(form, "İşe giriş", "2024-01-01");
    await fill(form, "CRM kullanıcısı (e-posta, varsa)", email);
    await form.getByRole("button", { name: "Ekle", exact: true }).click();
    await expect(hr1).toHaveURL(/\/hr\/employees\/c/);
    await expect(hr1.getByText(`CRM kullanıcısı: ${email} (etkin)`)).toBeVisible();
  }
  const emp = await db.employee.findUniqueOrThrow({ where: { sicilNo: `P${s}` } });
  // İK misafir verisine erişemez
  await hr1.goto("/guests");
  await expect(hr1).toHaveURL(/\/forbidden/);

  // 2. Takım lideri: geçmiş hafta çizelgesi (6 × Gündüz = 48 saat → sözleşme aşımı uyarısı) ve gerekçeli yayın
  const lead = await newPage("e2e-lider-p@crmplus.local");
  await lead.goto(`/hr/roster?scope=${team.id}&week=${monday}`);
  for (let i = 0; i < 7; i++) {
    const d = addDays(monday, i);
    const sel = lead.getByLabel(new RegExp(`^Puantaj Temsilci${s} \\S+ ${d.slice(8)}\\.${d.slice(5, 7)}$`));
    await sel.selectOption(i < 6 ? `W:${gunduz.id}` : "OFF");
    await expect(sel).toBeEnabled();
    await expect(sel).toHaveValue(i < 6 ? `W:${gunduz.id}` : "OFF");
  }
  await lead.reload();
  await expect(lead.getByTestId("roster-warnings")).toContainText("sözleşme 45 saat");
  await lead.getByLabel("Uyarılara rağmen yayın gerekçesi").fill("E2E: yoğun hafta, fazla mesai onaylı");
  await lead.getByRole("button", { name: "Çizelgeyi yayınla" }).click();
  await expect(lead.getByTestId("roster-status")).toHaveText("Yayında");

  // 3. Sistem olayları (Pazartesi): 09:05 mesai, 12:30–13:30 mola, 18:10 çıkış → 8:05 çalışma
  await db.agentStatusLog.createMany({
    data: [["09:05", "READY"], ["12:30", "BREAK"], ["13:30", "READY"], ["18:10", "OFFLINE"]].map(([t, status]) => ({ userId: agentUser.id, status, at: at(monday, t) })),
  });

  // 4. Temsilci: kendi çizelgesi, mesai durumu; yönetim ekranlarına erişemez
  const agent = await newPage("e2e-temsilci-p@crmplus.local");
  await agent.goto(`/hr?week=${monday}`);
  await expect(agent.getByTestId("my-week")).toContainText("Gündüz");
  await agent.getByRole("button", { name: "Mesaiye başla" }).click();
  await expect(agent.getByTestId("work-status")).toContainText("Mesaide");
  await agent.getByRole("button", { name: "Molaya çık" }).click();
  await expect(agent.getByTestId("work-status")).toContainText("Molada");
  await agent.goto("/hr/timesheet");
  await expect(agent).toHaveURL(/\/hr$/);
  await agent.goto("/hr/employees");
  await expect(agent).toHaveURL(/\/forbidden/);

  // 5. Lider: puantaj hesap → gün ayrıntısı → gerekçeli düzeltme
  await lead.goto(`/hr/timesheet?scope=${team.id}&month=${month}`);
  await lead.getByRole("button", { name: "Yeniden hesapla" }).click();
  await expect(lead.getByText("Puantaj yeniden hesaplandı.")).toBeVisible();
  await expect(lead.getByTestId(`row-P${s}`).getByTestId("worked-total")).toHaveText("8:05");
  await lead.goto(`/hr/timesheet/day?e=${emp.id}&d=${monday}`);
  await expect(lead.getByTestId("day-code")).toHaveText("Ç");
  await expect(lead.getByTestId("day-worked")).toHaveText("8:05");
  await lead.getByLabel("Alan", { exact: true }).selectOption("lastOut");
  await lead.getByLabel(/Yeni değer/).fill("18:40");
  await lead.getByLabel("Gerekçe", { exact: true }).fill("Çıkış işareti unutulmuş, vardiya kaydıyla teyit");
  await lead.getByRole("button", { name: "Düzeltmeyi kaydet" }).click();
  await expect(lead.getByTestId("day-worked")).toHaveText("8:35");
  await expect(lead.getByTestId("adjustments")).toContainText("vardiya kaydıyla teyit");
  // Planlı ama etkinliği olmayan gün “devamsız” önerisidir
  await lead.goto(`/hr/timesheet/day?e=${emp.id}&d=${addDays(monday, 1)}`);
  await expect(lead.getByTestId("day-code")).toHaveText("D");
  await expect(lead.getByText(/Devamsızlık önerisi/)).toBeVisible();

  // 6. Dönem: lider hazırlar → İK onaylar → kilit → düzeltme kapanır
  await lead.goto(`/hr/timesheet?scope=${team.id}&month=${month}`);
  await lead.getByRole("button", { name: "Hazırla ve onaya gönder" }).click();
  await expect(lead.getByTestId("period-status")).toHaveText("Onay bekliyor");
  await hr1.goto(`/hr/timesheet?scope=${team.id}&month=${month}`);
  await expect(hr1.getByTestId(`row-P${s}`).getByTestId("worked-total")).toHaveText("8:35");
  await hr1.getByRole("button", { name: "Dönemi onayla" }).click();
  await expect(hr1.getByTestId("period-status")).toHaveText("Onaylandı");
  await hr1.getByRole("button", { name: "Dönemi kilitle" }).click();
  await expect(hr1.getByTestId("period-status")).toHaveText("Kilitli");
  await lead.goto(`/hr/timesheet/day?e=${emp.id}&d=${monday}`);
  await expect(lead.getByText("Dönem onaylı veya kilitli; düzeltme yapılamaz.")).toBeVisible();
  await expect(lead.getByRole("button", { name: "Düzeltmeyi kaydet" })).toHaveCount(0);

  // 7. Excel: ızgarayla aynı toplam
  await hr1.goto(`/hr/timesheet?scope=${team.id}&month=${month}`);
  await hr1.locator("#export-reason").fill(`${month} bordrosu`);
  const [download] = await Promise.all([hr1.waitForEvent("download"), hr1.getByRole("button", { name: "Excel indir" }).click()]);
  const wb = new ExcelJS.Workbook();
  const { readFile } = await import("node:fs/promises");
  await wb.xlsx.load((await readFile(await download.path())) as never);
  const ws = wb.worksheets[0];
  const header = (ws.getRow(1).values as unknown[]).map(String);
  const row = ws.getRows(2, ws.rowCount - 1)!.find((r) => r.getCell(1).value === `P${s}`)!;
  expect(row.getCell(header.indexOf("Çalışılan saat")).value).toBe(8.58);
  expect(row.getCell(header.indexOf("Devamsız")).value).toBe(5);
  expect(await db.accessLog.count({ where: { action: "export", resource: "timesheet", reason: `${month} bordrosu` } })).toBeGreaterThan(0);

  // 8. İzin: temsilci talep → lider ön onay → İK onay
  const leaveDay = addDays(ist(), 21);
  await agent.goto("/hr/leave");
  await agent.getByLabel("İzin türü").selectOption("İ");
  await fill(agent, "Başlangıç", leaveDay);
  await fill(agent, "Bitiş", leaveDay);
  await agent.getByRole("button", { name: "Talep gönder" }).click();
  await expect(agent.getByText("İzin talebi gönderildi.")).toBeVisible();
  await lead.goto("/hr/leave");
  const item = lead.getByTestId("leave-queue").locator("li", { hasText: `Temsilci${s}` });
  await expect(item.getByRole("button", { name: "Onayla" })).toHaveCount(0); // lider son onay veremez
  await item.getByRole("button", { name: "Ön onay ver" }).click();
  await expect(item).toHaveCount(0); // ön onaylanınca liderin kuyruğundan çıkar
  const hr2 = await newPage("e2e-ik2@crmplus.local");
  await hr2.goto("/hr/leave");
  await hr2.getByTestId("leave-queue").locator("li", { hasText: `Temsilci${s}` }).getByRole("button", { name: "Onayla" }).click();
  await expect(hr2.getByTestId("leave-queue").locator("li", { hasText: `Temsilci${s}` })).toHaveCount(0);
  await agent.goto("/hr/leave");
  await expect(agent.getByTestId("my-leaves")).toContainText("Onaylandı");

  // 9. Saha rotası: durdurma kaydı olan misafire durak eklenmez; host vardım/ayrıldım
  const blocked = await db.guest.create({ data: { firstName: "Durdurulmuş", lastName: `Misafir${s}`, blocks: { create: { reason: "GUEST_REQUEST", requestedAt: new Date() } } } });
  const today = ist();
  await lead.goto("/hr/routes");
  await fill(lead, "Ad", `E2E Casino ${s}`);
  await lead.getByRole("button", { name: "Lokasyon ekle" }).click();
  await expect(lead.getByText("Lokasyon eklendi.")).toBeVisible();
  const card = lead.getByTestId("route-card").filter({ hasText: `Host${s}` });
  await card.getByText("Durak ekle").click();
  await card.getByLabel("Gün").selectOption(today);
  await card.getByLabel("Saat (SS:DD)").fill("15:00");
  await card.getByLabel("Lokasyon").selectOption({ label: `E2E Casino ${s}` });
  await card.getByLabel("Amaç").fill("Misafir karşılama");
  await card.getByLabel("Misafir CRM no (isteğe bağlı)").fill(String(blocked.crmNo));
  await card.getByRole("button", { name: "Durağı ekle" }).click();
  await expect(card.getByText(/iletişim durdurma kaydı var/)).toBeVisible();
  await card.getByLabel("Misafir CRM no (isteğe bağlı)").fill("");
  await card.getByRole("button", { name: "Durağı ekle" }).click();
  await expect(card.getByText("Misafir karşılama")).toBeVisible();
  await card.getByRole("button", { name: "Rotayı yayınla" }).click();
  await expect(card.getByText("Yayında")).toBeVisible();

  const host = await newPage("e2e-saha@crmplus.local");
  await expect(host).toHaveURL(/\/hr\/my-route/);
  const stop = host.getByTestId("stop").filter({ hasText: `E2E Casino ${s}` });
  await stop.getByRole("button", { name: "Vardım" }).click();
  await expect(stop.getByTestId("stop-status")).toContainText("Varış");
  await stop.getByRole("button", { name: "Ayrıldım" }).click();
  await expect(stop.getByTestId("stop-status")).toContainText("Yapıldı");
  // Saha personeli puantaj ekranına ve misafirlere erişemez
  await host.goto("/guests");
  await expect(host).toHaveURL(/\/forbidden/);
});
