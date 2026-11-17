import { expect, test, type APIRequestContext } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { createHmac } from "node:crypto";
import { blindIndex, encrypt } from "../../src/server/crypto/field-encryption";
import { normalizePhone } from "../../src/lib/phone";
import { firstLogin } from "./helpers";

process.loadEnvFile?.(".env");
const db = new PrismaClient();
test.afterAll(async () => db.$disconnect());

/** Meta Cloud API webhook'unu imzalı olarak taklit eder. */
async function meta(request: APIRequestContext, value: Record<string, unknown>, opts: { badSignature?: boolean } = {}) {
  const raw = JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: "1", changes: [{ field: "messages", value }] }] });
  const sig = opts.badSignature ? "sha256=" + "0".repeat(64) : "sha256=" + createHmac("sha256", process.env.WA_APP_SECRET!).update(raw).digest("hex");
  return request.post("/api/messaging/whatsapp", { data: raw, headers: { "content-type": "application/json", "x-hub-signature-256": sig } });
}
const inbound = (id: string, from: string, body: { text?: string; button?: string }) => ({
  messages: [{ id, from: from.replace("+", ""), timestamp: String(Math.floor(Date.now() / 1000)), type: body.button ? "button" : "text", ...(body.button ? { button: { payload: body.button, text: "Aboneliği iptal et" } } : { text: { body: body.text } }) }],
});

async function makeGuest(ownerId: string, raw: string, tag: string) {
  const n = normalizePhone(raw, "DE");
  if (!n.ok || !n.e164) throw new Error(`geçersiz numara ${raw}`);
  const g = await db.guest.create({
    data: {
      firstName: "Wa", lastName: `Misafir${tag}`, ownerId, country: "DE",
      phones: { create: { e164Enc: encrypt(n.e164), phoneHash: blindIndex(n.e164), masked: n.masked!, country: n.country, lineType: n.lineType, isPrimary: true } },
      consents: { create: { channel: "WHATSAPP", status: "GRANTED", scope: "MARKETING", source: "E2E", sourceSystem: "E2E", grantedAt: new Date() } },
    },
  });
  return { guest: g, e164: n.e164 };
}

test("WhatsApp: aktarım kapısı → şablon iki kişili onay → şablonla ilk mesaj → 24 saat penceresi → yanıt → okundu → ret şüphesi ve ret düğmesi", async ({ browser, request }) => {
  test.setTimeout(240_000);
  const s = Date.now().toString().slice(-7);
  const letters = s.split("").map((d) => "abcdefghij"[Number(d)]).join("");
  const name = `kasim_bilgi_${letters}`;
  const agentUser = await db.user.findUniqueOrThrow({ where: { email: "e2e-temsilci-w@crmplus.local" } });
  const { guest, e164 } = await makeGuest(agentUser.id, `+49151${s}3`, s);
  const second = await makeGuest(agentUser.id, `+49152${s}4`, `${s}b`);
  const page = async (email: string) => {
    const p = await (await browser.newContext()).newPage();
    await firstLogin(p, email);
    return p;
  };

  // 1. Hazırlayan şablon taslağı; kendi şablonunu onaylayamaz
  const w1 = await page("e2e-ops-w1@crmplus.local");
  await w1.goto("/messages/whatsapp");
  await expect(w1.getByTestId("transfer")).toContainText("kapalı");
  await w1.getByLabel("Meta şablon adı").fill(name);
  await w1.getByLabel(/^Değişkenler sırayla/).fill("ad, temsilci_adi");
  await w1.getByLabel("Metin").fill("Merhaba {{1}}, temsilciniz {{2}} Kasım programını paylaşacak.");
  await w1.getByRole("button", { name: "Taslağı kaydet" }).click();
  await expect(w1.getByText(/Şablon taslağı kaydedildi/)).toBeVisible();
  const row = w1.getByTestId("wa-templates").locator("tr", { hasText: name });
  await expect(row.getByRole("button", { name: /Onayla/ })).toHaveCount(0);

  // 2. Kanal kapısı kapalıyken onaylanamaz → yönetici aktarım değerlendirmesini kaydeder → onay (sahte sağlayıcı anında onaylar)
  const w2 = await page("e2e-ops-w2@crmplus.local");
  await w2.goto("/messages/whatsapp");
  const row2 = w2.getByTestId("wa-templates").locator("tr", { hasText: name });
  await row2.getByRole("button", { name: "Onayla ve Meta’ya gönder" }).click();
  await expect(w2.getByText(/WhatsApp kanalı kapalı/).first()).toBeVisible();
  const admin = await page("e2e-admin-w@crmplus.local");
  await admin.goto("/messages/whatsapp");
  await admin.getByLabel("Değerlendirme tarihi").fill("2026-11-01");
  await admin.getByLabel("Belge referansı").fill("KVKK-AKT-2026-07");
  await admin.getByLabel("Gerekçe", { exact: true }).fill("Hukuk görüşü ve aktarım sözleşmesi tamam");
  await admin.getByRole("button", { name: "Değerlendirmeyi kaydet" }).click();
  await expect(admin.getByTestId("transfer")).toContainText("Kanal açık");
  await w2.reload();
  await w2.getByTestId("wa-templates").locator("tr", { hasText: name }).getByRole("button", { name: "Onayla ve Meta’ya gönder" }).click();
  await expect(w2.getByTestId("wa-templates").locator("tr", { hasText: name })).toContainText("Onaylı");

  // 2b. WhatsApp toplu kampanyası: SMS ile aynı kapılar (segment, test, iki kişili onay, hukuk teyidi, hız sınırlı gönderim)
  const tag = `e2e-wa-${s}`;
  const third = await makeGuest(agentUser.id, `+49176${s}5`, `${s}c`);
  await db.guest.update({ where: { id: third.guest.id }, data: { tags: [tag] } });
  await w1.goto("/messages");
  await w1.getByLabel("Kampanya adı").fill(`E2E WA kampanya ${s}`);
  await w1.getByLabel("Kategori", { exact: true }).selectOption("INFORMATIONAL");
  await w1.getByLabel("Onaylı şablon (kanal)").selectOption({ label: `WhatsApp · ${name} tr (bilgilendirme)` });
  await w1.getByLabel("Etiket").fill(tag);
  await w1.getByRole("button", { name: "Taslağı oluştur ve önizle" }).click();
  await expect(w1).toHaveURL(/\/messages\/campaigns\//, { timeout: 60_000 });
  await expect(w1.getByTestId("campaign-channel")).toHaveText("WhatsApp");
  await expect(w1.getByTestId("eligible-count")).toHaveText("1");
  await w1.getByLabel("Test numarası").fill("+49 151 99887766");
  await w1.getByRole("button", { name: "Test gönder" }).click();
  await expect(w1.getByText("Test mesajı gönderildi.")).toBeVisible();
  await w1.getByRole("button", { name: "Onaya gönder" }).click();
  await expect(w1.getByTestId("campaign-status")).toHaveText("Onay bekliyor");
  await w2.goto(w1.url());
  await w2.getByRole("checkbox").check();
  await w2.locator("#approve-reason").fill("Bilgilendirme içeriği ve ülke kontrol edildi");
  await w2.getByRole("button", { name: "Kampanyayı onayla" }).click();
  await expect(w2.getByTestId("campaign-status")).toHaveText("Onaylandı");
  await w2.getByRole("button", { name: "Gönderimi başlat" }).click();
  await expect(w2.getByTestId("campaign-status")).toHaveText("Tamamlandı", { timeout: 60_000 });
  const camConv = await db.conversation.findFirstOrThrow({ where: { guestId: third.guest.id } });
  expect(await db.message.count({ where: { conversationId: camConv.id, channel: "WHATSAPP", campaignId: { not: null } } })).toBe(1);
  expect(camConv.assigneeId).toBe(agentUser.id); // yanıtlar misafirin temsilcisine düşer

  // 3. Temsilci: misafir kartından şablonla ilk mesaj → gelen kutusunda konuşma, pencere kapalı (serbest yanıt yok)
  const agent = await page("e2e-temsilci-w@crmplus.local");
  await agent.goto(`/guests/${guest.id}`);
  await agent.getByText("WhatsApp şablonu gönder").click();
  await agent.getByLabel("Onaylı WhatsApp şablonu").selectOption({ label: `${name} (tr)` });
  await agent.getByRole("button", { name: "WhatsApp gönder" }).click();
  await expect(agent.getByText("WhatsApp şablonu gönderildi.")).toBeVisible();
  const conv = await db.conversation.findFirstOrThrow({ where: { guestId: guest.id, status: "OPEN" } });
  const out = await db.message.findFirstOrThrow({ where: { conversationId: conv.id, direction: "OUT" } });
  await agent.goto(`/inbox/${conv.id}`);
  await expect(agent.getByTestId("thread")).toContainText("Merhaba Wa, temsilciniz E2E Temsilci WhatsApp Kasım programını paylaşacak.");
  await expect(agent.getByTestId("window")).toContainText("kapalı");
  await expect(agent.getByLabel("Yanıt")).toHaveCount(0);

  // 4. İmzasız webhook reddedilir; misafir yazar → pencere açılır; aynı olay tekrar işlenmez; okundu bilgisi
  expect((await meta(request, inbound(`wamid.in1-${s}`, e164, { text: "Merhaba, program ne zaman?" }), { badSignature: true })).status()).toBe(401);
  expect(await (await meta(request, inbound(`wamid.in1-${s}`, e164, { text: "Merhaba, program ne zaman?" }))).json()).toMatchObject({ received: 1 });
  expect(await (await meta(request, inbound(`wamid.in1-${s}`, e164, { text: "Merhaba, program ne zaman?" }))).json()).toMatchObject({ duplicates: 1 });
  await meta(request, { statuses: [{ id: out.providerMessageId, status: "read", timestamp: String(Math.floor(Date.now() / 1000)), recipient_id: e164.slice(1) }] });
  await agent.reload();
  await expect(agent.getByTestId("window")).toContainText("açık");
  await expect(agent.getByTestId("thread")).toContainText("okundu");
  await agent.getByLabel("Yanıt").fill("Tabii, birazdan paylaşıyorum.");
  await agent.getByRole("button", { name: "Gönder", exact: true }).click();
  await expect(agent.getByTestId("thread")).toContainText("Tabii, birazdan paylaşıyorum.");

  // 5. Belirsiz ret ifadesi → şüphe; temsilci tek tıkla durdurur → yanıt kapanır
  await meta(request, inbound(`wamid.in2-${s}`, e164, { text: "Lütfen bana bir daha yazmayın" }));
  await agent.reload();
  await expect(agent.getByTestId("suspect")).toBeVisible();
  await agent.getByRole("button", { name: "Durdurma kaydı aç" }).click();
  await expect(agent.getByText("İletişim durduruldu")).toBeVisible();
  await expect(agent.getByLabel("Yanıt")).toHaveCount(0);
  expect(await db.contactBlock.count({ where: { guestId: guest.id, channel: "WHATSAPP", removedAt: null } })).toBe(1);

  // 6. “Aboneliği iptal et” düğmesi → anında durdurma + tek seferlik onay mesajı
  const r = await (await meta(request, inbound(`wamid.in3-${s}`, `+49152${s}4`, { button: "OPT_OUT" }))).json();
  expect(r).toMatchObject({ optOuts: 1 });
  expect(await db.contactBlock.count({ where: { guestId: second.guest.id, channel: "WHATSAPP", removedAt: null } })).toBe(1);
  const conv2 = await db.conversation.findFirstOrThrow({ where: { guestId: second.guest.id } });
  expect(await db.message.count({ where: { conversationId: conv2.id, direction: "OUT" } })).toBe(1);

  // 7. Meta abonelik doğrulaması
  const v = await request.get(`/api/messaging/whatsapp?hub.mode=subscribe&hub.verify_token=${process.env.WA_VERIFY_TOKEN}&hub.challenge=ok123`);
  expect(await v.text()).toBe("ok123");
  expect((await request.get("/api/messaging/whatsapp?hub.mode=subscribe&hub.verify_token=yanlis&hub.challenge=x")).status()).toBe(403);
});
