import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { firstLogin } from "./helpers";

process.loadEnvFile?.(".env");
const db = new PrismaClient();
test.afterAll(async () => db.$disconnect());

const ist = (d = new Date()) => new Date(d.getTime() + 3 * 3600_000).toISOString().slice(0, 10);
const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

test("kalite: örneklem (aday + rastgele) → kriterli inceleme (puan yok) → personel itirazı → lider kapatır; sözlük ve doğruluk paneli", async ({ browser }) => {
  test.setTimeout(240_000);
  const s = Date.now().toString().slice(-6);
  const word = s.split("").map((d) => "ABCDEFGHIJ"[Number(d)]).join(""); // sözlük numara kabul etmez
  const agent = await db.user.findUniqueOrThrow({ where: { email: "e2e-temsilci-q@crmplus.local" } });
  const guest = await db.guest.findFirstOrThrow({ where: { anonymizedAt: null, phones: { some: {} } }, include: { phones: true } });

  // Geçen hafta Salı: 3 kapalı görüşme, biri sonuç/özet uyuşmazlıklı (analiz adayı)
  const t = new Date(`${addDays(addDays(ist(), -((new Date(`${ist()}T00:00:00Z`).getUTCDay() + 6) % 7)), -6)}T11:00:00+03:00`);
  const calls = [];
  for (let i = 0; i < 3; i++) {
    calls.push(
      await db.call.create({
        data: { guestId: guest.id, phoneId: guest.phones[0].id, agentId: agent.id, startedAt: new Date(t.getTime() + i * 3600_000), answeredAt: new Date(t.getTime() + i * 3600_000 + 5000), endedAt: new Date(t.getTime() + i * 3600_000 + 125_000), closedAt: new Date(t.getTime() + i * 3600_000 + 150_000), talkSec: 120, disposition: "REACHED" },
      }),
    );
  }
  const rec = await db.recording.create({ data: { callId: calls[0].id, provider: "e2e", status: "STORED" } });
  const tr = await db.transcript.create({ data: { recordingId: rec.id, callId: calls[0].id, status: "DONE", confidence: 0.9, segments: [{ speaker: "AGENT", start: 0, end: 3, text: "Merhaba" }] } });
  await db.callAnalysis.create({ data: { transcriptId: tr.id, callId: calls[0].id, summary: `E2E özet ${s}`, topics: ["trip_interest"], actions: [], processFlags: [], dispositionMismatch: true, model: "rules", modelVersion: "e2e" } });

  // Lider: örneklem oluştur → aday çağrı “uyuşmazlık” nedeniyle seçilir
  const lead = await (await browser.newContext()).newPage();
  await firstLogin(lead, "e2e-lider-q@crmplus.local");
  await lead.goto("/qa");
  await lead.getByRole("button", { name: "Geçen haftanın örneklemini oluştur" }).click();
  await expect(lead.getByText(/3 görüşme örnekleme eklendi/)).toBeVisible();
  await lead.reload();
  await expect(lead.getByTestId("qa-list")).toContainText("Sonuç/özet uyuşmazlığı");
  // Analiz adayı (uyuşmazlık) önce seçilir; önceki çalıştırmaların aynı haftadaki görüşmeleri de aday olabilir
  const sample = await db.qaSample.findFirstOrThrow({ where: { agentId: agent.id, reason: "MISMATCH" }, orderBy: { createdAt: "desc" } });
  expect(await db.qaSample.count({ where: { agentId: agent.id } })).toBe(3);

  // Kriterli inceleme: “karşılanmadı” açıklama ister; toplam puan yok
  await lead.goto(`/qa/${sample.id}`);
  await expect(lead.getByText(/E2E özet \d+/)).toBeVisible();
  const groups = lead.locator("fieldset");
  const n = await groups.count();
  for (let i = 0; i < n; i++) await groups.nth(i).getByLabel("Karşılandı").check();
  await lead.locator("fieldset", { hasText: "Doğru sonuç kodu ve not" }).getByLabel("Karşılanmadı").check();
  await lead.locator("#coaching").fill("Açılış ve kayıt bildirimi çok iyi; sonuç kodu görüşmeyle uyumlu seçilmeli.");
  await lead.getByRole("button", { name: "İncelemeyi kaydet" }).click();
  await expect(lead.getByText("“Karşılanmadı” seçilen kriterler için kısa açıklama yazın.")).toBeVisible();
  await lead.getByLabel("Doğru sonuç kodu ve not açıklama").fill("Misafir trip istemedi, ulaşıldı yerine ilgisiz olmalıydı");
  await lead.getByRole("button", { name: "İncelemeyi kaydet" }).click();
  await expect(lead.getByTestId("qa-status")).toHaveText("İncelendi · yanıt bekliyor");
  await expect(lead.getByTestId("qa-review")).toContainText("Karşılanmadı — Misafir trip istemedi");
  await expect(lead.getByTestId("qa-review")).not.toContainText(/puan|skor|\/100/i);

  // Personel: yalnız incelenmiş örneklemini görür, gerekçeyle itiraz eder
  const ag = await (await browser.newContext()).newPage();
  await firstLogin(ag, "e2e-temsilci-q@crmplus.local");
  await ag.goto("/qa");
  await expect(ag.getByTestId("qa-list").locator("tbody tr")).toHaveCount(1);
  await ag.goto(`/qa/${sample.id}`);
  await expect(ag.getByRole("button", { name: "İncelemeyi kaydet" })).toHaveCount(0);
  await ag.getByLabel("İtiraz gerekçesi").fill("Misafir trip için tarih sordu, ulaşıldı doğru bence");
  await ag.getByRole("button", { name: "İtiraz et" }).click();
  await expect(ag.getByTestId("qa-status")).toHaveText("İtiraz edildi");

  // Lider: itirazı yanıtlayıp kapatır
  await lead.goto(`/qa/${sample.id}`);
  await lead.getByLabel("İtiraz sonucu").fill("Kayıt dinlendi, itiraz haklı; not güncellendi.");
  await lead.getByRole("button", { name: "Kapat" }).click();
  await expect(lead.getByTestId("qa-status")).toHaveText("Kapandı");

  // Operasyon: kurum sözlüğü ve doğruluk paneli (toplulaştırılmış)
  const ops = await (await browser.newContext()).newPage();
  await firstLogin(ops, "e2e-ops-q@crmplus.local");
  await ops.goto("/admin/vocabulary");
  await ops.getByLabel("Terim").fill(`E2E Casino ${word}`);
  await ops.getByRole("button", { name: "Ekle", exact: true }).click();
  await expect(ops.getByTestId("vocab")).toContainText(`E2E Casino ${word}`);
  await ops.getByLabel("Terim").fill("0532 111 22 33 44");
  await ops.getByRole("button", { name: "Ekle", exact: true }).click();
  await expect(ops.getByText(/numara içermemeli/)).toBeVisible();
  await ops.goto("/reports/speech");
  await expect(ops.getByTestId("m-transcript")).not.toHaveText("—");
  await expect(ops.getByText(/Kelime hata oranı/)).toBeVisible();
  // Temsilci sözlüğe ve panele erişemez
  await ag.goto("/admin/vocabulary");
  await expect(ag).toHaveURL(/\/forbidden/);
  await ag.goto("/reports/speech");
  await expect(ag).toHaveURL(/\/forbidden/);
});
