import { expect, test, type APIRequestContext } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { signPayload } from "../../src/lib/webhook-signature";
import { firstLogin } from "./helpers";

process.loadEnvFile?.(".env");
const db = new PrismaClient();
test.afterAll(async () => db.$disconnect());

/** Santral webhook'unu imzalı olarak taklit eder. */
async function webhook(request: APIRequestContext, body: Record<string, unknown>, opts: { badSignature?: boolean } = {}) {
  const raw = JSON.stringify(body);
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = opts.badSignature ? "00".repeat(32) : signPayload(process.env.PBX_WEBHOOK_SECRET!, ts, raw);
  return request.post("/api/telephony/webhook/pbx-http", { data: raw, headers: { "content-type": "application/json", "x-crmplus-timestamp": ts, "x-crmplus-signature": sig } });
}

async function waitFor<T>(fn: () => Promise<T | null | undefined>, ms = 60_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error("Zaman aşımı: arka plan işçisi çalışıyor mu? (pnpm worker)");
    await new Promise((r) => setTimeout(r, 1000));
  }
}

test("ses: kapı → kayıt → transkript (maskeli) → öneri → uyuşmazlık → gerekçeli dinleme → onay; misafir istemezse saklanmaz", async ({ page, browser, request }) => {
  test.setTimeout(240_000);
  const base = { at: new Date().toISOString() };

  // 1. Karar kapısı kapalıyken gelen kayıt saklanmaz → sonra kapı açılır
  const admin = await browser.newPage();
  await firstLogin(admin, "e2e-ayar@crmplus.local");
  await admin.goto("/admin/settings");
  await expect(admin.getByText("Kapı kapalı.")).toBeVisible();
  for (const l of ["hukuki dayanak", "Bilgilendirme", "saklama süreleri onaylandı", "tedarikçisinin", "erişim matrisi", "kayıt istememe"]) {
    await admin.getByLabel(new RegExp(l)).check();
  }
  await admin.locator("#gate-reason").fill("E2E: hukuk onayı alındı");
  await admin.getByRole("button", { name: "Kaydet" }).first().click();
  await expect(admin.getByText("Karar kapısı açık")).toBeVisible();

  // 2. Temsilci arar, kayıt bildirimini işaretler, "ulaşıldı" ile kapatır
  await firstLogin(page, "e2e-temsilci-s@crmplus.local");
  await expect(page.getByRole("heading", { name: "Benim günüm" })).toBeVisible();
  await page.goto("/queue");
  await page.getByRole("button", { name: "Ara", exact: true }).click();
  await page.getByRole("button", { name: "Kayıt bildirimi yapıldı" }).click();
  await expect(page.getByRole("button", { name: "Kayıt bildirimi yapıldı ✓" })).toBeVisible();
  await page.getByRole("button", { name: "Bağlandı", exact: true }).click();
  await page.getByRole("button", { name: "Bitir", exact: true }).click();
  await page.getByRole("radio", { name: /Ulaşıldı/ }).click();
  await page.getByLabel(/^Not/).fill("Kıbrıs tripi ve otel fiyatı sordu, yarın aranacak.");
  await page.getByRole("button", { name: /Kaydet ve sıradaki/ }).click();
  await expect(page.locator("p[role=status]")).toContainText("kaydedildi");
  const agent = await db.user.findUniqueOrThrow({ where: { email: "e2e-temsilci-s@crmplus.local" } });
  const call = await db.call.findFirstOrThrow({ where: { agentId: agent.id }, orderBy: { startedAt: "desc" } });
  expect(call.recordingNotice).toBe(true);

  // 3. Santral webhook'ları: geçersiz imza reddedilir; süre santralden gelir; tekrar eden olay tek işlenir
  const bad = await webhook(request, { eventId: `x-${call.id}`, event: "answered", reference: call.id, ...base }, { badSignature: true });
  expect(bad.status()).toBe(401);
  const ended = { eventId: `end-${call.id}`, event: "ended", reference: call.id, at: new Date().toISOString(), talkSec: 37, ringSec: 6 };
  expect((await webhook(request, ended)).status()).toBe(200);
  expect(await (await webhook(request, ended)).json()).toMatchObject({ status: "duplicate" });
  expect((await db.call.findUniqueOrThrow({ where: { id: call.id } })).talkSec).toBe(37);
  const rec = { eventId: `rec-${call.id}`, event: "recording.ready", reference: call.id, at: new Date().toISOString(), recordingUrl: "http://localhost:3210/api/dev/fake-recording", channels: 2, durationSec: 37 };
  expect((await webhook(request, rec)).status()).toBe(200);

  // 4. İşçi: indirme → şifreli saklama → transkript → maskeleme → öneri
  const transcript = await waitFor(() => db.transcript.findFirst({ where: { callId: call.id, status: { in: ["DONE", "LOW_CONFIDENCE"] } }, include: { analysis: true } }));
  const text = JSON.stringify(transcript.segments);
  expect(text).toContain("[TELEFON]");
  expect(text).toContain("[KART]");
  expect(text).not.toContain("4111 1111");
  expect(transcript.rawEnc?.startsWith("v1:")).toBe(true);
  expect(transcript.analysis?.dispositionMismatch).toBe(true); // "beni bir daha aramayın" ama sonuç "Ulaşıldı"
  const stored = await db.recording.findUniqueOrThrow({ where: { callId: call.id } });
  expect(stored).toMatchObject({ status: "STORED", sourceUrlEnc: null });

  // 5. Temsilci kaydı dinleyemez (yetki yok)
  expect((await page.request.get(`/api/recordings/${call.id}/audio`)).status()).toBe(403);

  // 6. Takım lideri: uyuşmazlık listesinde görür, gerekçesiz dinleyemez, gerekçeyle dinler, öneriyi onaylar
  const lead = await browser.newPage();
  await firstLogin(lead, "lider@crmplus.local");
  await lead.goto("/calls?f=mismatch");
  await lead.locator(`a[href="/calls/${call.id}"]`).click();
  await expect(lead.getByText(/iletişim istemediğini söylemiş görünüyor/)).toBeVisible();
  expect((await lead.request.get(`/api/recordings/${call.id}/audio`)).status()).toBe(403);
  await lead.getByLabel(/Dinleme gerekçesi/).fill("Kalite örneklemesi: sonuç kodu uyuşmazlığı");
  await lead.getByRole("button", { name: "Dinleme izni al" }).click();
  await expect(lead.locator("audio")).toBeVisible();
  const audio = await lead.request.get(`/api/recordings/${call.id}/audio`);
  expect(audio.status()).toBe(200);
  expect((await audio.body()).length).toBe(4096);
  const leadUser = await db.user.findUniqueOrThrow({ where: { email: "lider@crmplus.local" } });
  expect(await db.accessLog.count({ where: { actorId: leadUser.id, action: "listen", resourceId: call.id } })).toBeGreaterThanOrEqual(2);
  await lead.getByRole("button", { name: "Öneriyi onayla" }).click();
  await expect(lead.getByText(/geri arama planlandı/)).toBeVisible();
  expect(await db.callback.count({ where: { sourceCallId: call.id, status: "PENDING" } })).toBe(1);

  // 7. Misafir kayıt istemezse kayıt saklanmaz ve sonraki çağrılar için ret kaydı oluşur
  await page.goto("/queue");
  await page.getByRole("button", { name: "Ara", exact: true }).click();
  await page.getByRole("button", { name: "Misafir kaydı istemiyor" }).click();
  await expect(page.getByRole("button", { name: "Kayıt saklanmayacak ✓" })).toBeVisible();
  await page.getByRole("button", { name: "Bitir (bağlanmadı)" }).click();
  await page.getByRole("radio", { name: /Cevap yok/ }).click();
  await page.getByRole("button", { name: /Kaydet ve sıradaki/ }).click();
  await expect(page.locator("p[role=status]")).toContainText("kaydedildi");
  const call2 = await db.call.findFirstOrThrow({ where: { agentId: agent.id, id: { not: call.id } }, orderBy: { startedAt: "desc" } });
  await webhook(request, { eventId: `rec-${call2.id}`, event: "recording.ready", reference: call2.id, at: new Date().toISOString(), recordingUrl: "http://localhost:3210/api/dev/fake-recording" });
  expect(await db.recording.findUniqueOrThrow({ where: { callId: call2.id } })).toMatchObject({ status: "DISCARDED", discardReason: "GUEST_DECLINED", sourceUrlEnc: null });
  expect((await db.consentRecord.findUniqueOrThrow({ where: { guestId_channel: { guestId: call2.guestId, channel: "RECORDING" } } })).status).toBe("DENIED");
});
