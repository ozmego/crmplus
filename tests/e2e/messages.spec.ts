import { expect, test, type APIRequestContext } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { signPayload } from "../../src/lib/webhook-signature";
import { blindIndex, encrypt } from "../../src/server/crypto/field-encryption";
import { normalizePhone } from "../../src/lib/phone";
import { firstLogin } from "./helpers";

process.loadEnvFile?.(".env");
const db = new PrismaClient();
test.afterAll(async () => db.$disconnect());

async function smsWebhook(request: APIRequestContext, body: Record<string, unknown>) {
  const raw = JSON.stringify(body);
  const ts = String(Math.floor(Date.now() / 1000));
  return request.post("/api/messaging/webhook/mock", {
    data: raw,
    headers: { "content-type": "application/json", "x-crmplus-timestamp": ts, "x-crmplus-signature": signPayload(process.env.SMS_WEBHOOK_SECRET!, ts, raw) },
  });
}

async function makeGuest(tag: string, raw: string, region: string, consent: "GRANTED" | null) {
  const n = normalizePhone(raw, region);
  if (!n.ok || !n.e164) throw new Error(`test numarası geçersiz: ${raw}`);
  return db.guest.create({
    data: {
      firstName: "Sms", lastName: `Testi-${tag}`, tags: [tag], country: n.country,
      phones: { create: { e164Enc: encrypt(n.e164), phoneHash: blindIndex(n.e164), masked: n.masked!, country: n.country, lineType: n.lineType, isPrimary: true } },
      ...(consent ? { consents: { create: { channel: "SMS", status: consent, scope: "MARKETING", source: "E2E", sourceSystem: "E2E", grantedAt: new Date() } } } : {}),
    },
  });
}

test("SMS: şablon kuralları → iki kişili onay → izin/İYS hariç tutma → test → onay → gönderim → RET ile durdurma; temsilci erişemez", async ({ page, browser, request }) => {
  test.setTimeout(180_000);
  const s = Date.now().toString().slice(-7);
  const tag = `e2e-sms-${s}`;
  const dePhone = `+49151${s}1`;
  const ok = await makeGuest(tag, dePhone, "DE", "GRANTED");
  await makeGuest(tag, `0532${s}`, "TR", "GRANTED"); // İYS bağlantısı yok → hariç
  await makeGuest(tag, `+49152${s}2`, "DE", null); // izin bilinmiyor → hariç

  // Hazırlayan: şablon (finansal değişken reddedilir)
  await firstLogin(page, "e2e-ops1@crmplus.local");
  await page.goto("/messages/templates");
  await page.getByLabel("Şablon adı").fill(`Kasım gezisi ${s}`);
  await page.getByLabel("Metin").fill("Merhaba {ad}, kaybınız {kayip_tutari}");
  await expect(page.getByText(/kayip_tutari}: finansal/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Taslağı kaydet" })).toBeDisabled();
  await page.getByLabel("Metin").fill("Merhaba {ad}, Kasım gezisi programı hazır. Temsilciniz sizi arayacak.");
  await expect(page.getByTestId("sms-counter")).toContainText("parça");
  await page.getByRole("button", { name: "Taslağı kaydet" }).click();
  await expect(page.getByText(/Şablon taslağı kaydedildi/)).toBeVisible();
  const row = page.getByTestId("template-row").filter({ hasText: `Kasım gezisi ${s}` });
  await expect(row.getByRole("button", { name: "Şablonu onayla" })).toHaveCount(0); // kendi şablonunu onaylayamaz

  // Onaylayan: şablonu onaylar
  const approver = await (await browser.newContext()).newPage();
  await firstLogin(approver, "e2e-ops2@crmplus.local");
  await approver.goto("/messages/templates");
  await approver.getByTestId("template-row").filter({ hasText: `Kasım gezisi ${s}` }).getByRole("button", { name: "Şablonu onayla" }).click();
  await expect(approver.getByTestId("template-row").filter({ hasText: `Kasım gezisi ${s}` }).getByText("Onaylı", { exact: true })).toBeVisible();

  // Hazırlayan: kampanya taslağı, segment = etiket
  await page.goto("/messages");
  await page.getByLabel("Kampanya adı").fill(`E2E kampanya ${s}`);
  await page.getByLabel("Onaylı şablon").selectOption({ label: `SMS · Kasım gezisi ${s} (pazarlama)` });
  await page.getByLabel("Etiket").fill(tag);
  await page.getByRole("button", { name: "Taslağı oluştur ve önizle" }).click();
  // Geliştirme sunucusunda kampanya sayfasının ilk derlemesi 30 sn'yi bulabilir
  await expect(page).toHaveURL(/\/messages\/campaigns\//, { timeout: 60_000 });
  const campaignUrl = page.url();
  await expect(page.getByTestId("eligible-count")).toHaveText("1");
  await expect(page.getByText(/İYS bağlantısı yok.*: 1/)).toBeVisible();
  await expect(page.getByText(/İzin durumu bilinmiyor: 1/)).toBeVisible();

  // Test gönderimi olmadan onaya gönderilemez
  await page.getByRole("button", { name: "Onaya gönder" }).click();
  await expect(page.getByText("Onaya göndermeden önce test gönderimi yapın.")).toBeVisible();
  await page.getByLabel("Test numarası").fill("+49 151 99887766");
  await page.getByRole("button", { name: "Test gönder" }).click();
  await expect(page.getByText("Test mesajı gönderildi.")).toBeVisible();
  await page.getByRole("button", { name: "Onaya gönder" }).click();
  await expect(page.getByTestId("campaign-status")).toHaveText("Onay bekliyor");
  await expect(page.getByText("Hazırlayan kendi kampanyasını onaylayamaz.")).toBeVisible();

  // Onaylayan: hukuk onay kutusu zorunlu → onay → gönderim
  await approver.goto(campaignUrl);
  await approver.locator("#approve-reason").fill("İçerik ve hedef ülke kontrol edildi");
  await approver.getByRole("button", { name: "Kampanyayı onayla" }).click();
  await expect(approver.getByText("Ülke, içerik ve yerel hukuk uygunluğunu onaylayın.")).toBeVisible();
  await approver.getByRole("checkbox").check();
  await approver.getByRole("button", { name: "Kampanyayı onayla" }).click();
  await expect(approver.getByTestId("campaign-status")).toHaveText("Onaylandı");
  await approver.getByRole("button", { name: "Gönderimi başlat" }).click();
  await expect(approver.getByTestId("campaign-status")).toHaveText("Tamamlandı", { timeout: 60_000 });
  await expect(approver.getByTestId("send-stats")).toContainText("Gönderildi: 1");

  const sent = await db.message.findFirstOrThrow({ where: { guestId: ok.id, isTest: false, direction: "OUT" } });
  expect(await db.interaction.count({ where: { guestId: ok.id, channel: "SMS" } })).toBe(1);

  // Teslim raporu → telefon ulaşıldı kanıtı
  const dlr = await smsWebhook(request, { eventId: `dlr-${s}`, type: "status", providerMessageId: sent.providerMessageId, status: "DELIVERED", at: new Date().toISOString() });
  expect((await dlr.json()).status).toBe("updated");
  expect((await db.message.findUniqueOrThrow({ where: { id: sent.id } })).status).toBe("DELIVERED");

  // Misafir RET yazar → SMS kanalı anında durdurulur; aynı olay tekrar gelirse işlenmez
  const inbound = { eventId: `in-${s}`, type: "inbound", from: dePhone, text: "RET", at: new Date().toISOString() };
  expect((await (await smsWebhook(request, inbound)).json()).status).toBe("opt_out");
  expect((await (await smsWebhook(request, inbound)).json()).status).toBe("duplicate");
  expect(await db.contactBlock.count({ where: { guestId: ok.id, channel: "SMS", removedAt: null } })).toBe(1);
  // İmzasız istek reddedilir
  expect((await request.post("/api/messaging/webhook/mock", { data: inbound })).status()).toBe(401);

  // Önizleme yenilenince durdurulan misafir artık uygun değil
  await page.goto("/messages");
  await page.getByLabel("Kampanya adı").fill(`E2E kampanya 2 ${s}`);
  await page.getByLabel("Onaylı şablon").selectOption({ label: `SMS · Kasım gezisi ${s} (pazarlama)` });
  await page.getByLabel("Etiket").fill(tag);
  await page.getByRole("button", { name: "Taslağı oluştur ve önizle" }).click();
  await expect(page.getByTestId("eligible-count")).toHaveText("0");
  await expect(page.getByText(/İletişim durdurulmuş: 1/)).toBeVisible();

  // Temsilci mesaj ekranına erişemez
  const agent = await (await browser.newContext()).newPage();
  await firstLogin(agent, "e2e-temsilci-m@crmplus.local");
  await agent.goto("/messages");
  await expect(agent).toHaveURL(/\/forbidden/);
});
