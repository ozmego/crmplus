import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { blindIndex, encrypt } from "../../src/server/crypto/field-encryption";
import { normalizePhone } from "../../src/lib/phone";
import { firstLogin } from "./helpers";

process.loadEnvFile?.(".env");
const db = new PrismaClient();
test.afterAll(async () => db.$disconnect());

test("Aşama 2 operasyon: dış servis onayı → hat durumu sorgusu (kesin değil) → İYS ret bildirimi kuyruğu; canlı pano ve kapasite planı; yetki", async ({ browser }) => {
  test.setTimeout(240_000);
  const s = Date.now().toString().slice(-7);
  const n = normalizePhone(`0532${s}`, "TR");
  if (!n.ok || !n.e164) throw new Error("numara");
  const guest = await db.guest.create({
    data: { firstName: "Hat", lastName: `Testi${s}`, phones: { create: { e164Enc: encrypt(n.e164), phoneHash: blindIndex(n.e164), masked: n.masked!, country: "TR", lineType: n.lineType, isPrimary: true } } },
  });
  const page = async (email: string) => {
    const p = await (await browser.newContext()).newPage();
    await firstLogin(p, email);
    return p;
  };

  // 1. Yönetici: İYS bağlı değil; telefon doğrulama için güvenlik/hukuk onayı
  const admin = await page("e2e-admin-i@crmplus.local");
  await admin.goto("/admin/integrations");
  await expect(admin.getByTestId("iys")).toContainText("bağlı değil");
  // 3CX kartı: santral yapılandırılmamış, sınama anlaşılır hata verir
  const pbx = admin.getByTestId("threecx");
  await expect(pbx).toContainText("3CX ayarları girilmemiş");
  await pbx.getByRole("button", { name: "Bağlantıyı sına" }).click();
  await expect(pbx).toContainText("3CX yapılandırılmamış");
  const pc = admin.getByTestId("phone-check");
  await pc.getByLabel("İnceleme tarihi").fill("2026-11-01");
  await pc.getByLabel("Belge referansı").fill("GUV-HUK-2026-11");
  await pc.getByLabel("Gerekçe", { exact: true }).fill("Sağlayıcı sözleşmesi ve veri işleme eki onaylandı");
  await pc.getByRole("button", { name: "Onayı kaydet" }).click();
  await expect(admin.getByTestId("phone-check")).toContainText("GUV-HUK-2026-11");

  // 2. Operasyon: misafir kartından hat sorgusu → kaynak ve güvenle kanıt, “kesin değildir”
  const ops = await page("e2e-ops-l@crmplus.local");
  await ops.goto(`/guests/${guest.id}`);
  await ops.getByRole("button", { name: "Hat durumunu sorgula" }).click();
  await expect(ops.getByTestId("line-status")).toContainText("kesin değildir");
  await expect(ops.getByTestId("line-status")).toContainText("hlr:mock");
  const phone = await db.guestPhone.findFirstOrThrow({ where: { guestId: guest.id } });
  expect(await db.phoneCheck.count({ where: { phoneId: phone.id, kind: "LINE_STATUS" } })).toBe(1);
  expect(phone.reachability).not.toBe("REACHABLE"); // dış servis ulaşılabilirlik kanıtı sayılmaz

  // 3. Tüm kanallarda durdurma → Türkiye numarası için İYS'ye MESAJ + ARAMA ret bildirimi kuyruğa girer
  await ops.getByRole("button", { name: "İletişimi durdur" }).click();
  const all = ops.getByLabel("Tüm kanallar");
  if (!(await all.isChecked())) await all.check();
  await ops.getByRole("button", { name: "Kaydet", exact: true }).click();
  await expect(ops.getByText("İletişim durduruldu")).toBeVisible();
  const out = await db.iysOutbox.findMany({ where: { guestId: guest.id } });
  expect(out.map((o) => o.type).sort()).toEqual(["ARAMA", "MESAJ"]);
  expect(out.every((o) => o.status === "PENDING")).toBe(true); // bağlantı yokken bekler
  await admin.reload();
  await expect(admin.getByTestId("iys")).toContainText(`CRM-${String(guest.crmNo).padStart(6, "0")}`);

  // 4. Canlı kanal panosu ve kapasite planı (toplulaştırılmış)
  await ops.goto("/ops/live");
  await expect(ops.getByTestId("live-agents")).toBeVisible();
  await expect(ops.getByTestId("live-wa")).toBeVisible();
  await ops.goto("/ops/capacity");
  await expect(ops.getByTestId("capacity")).toBeVisible();
  await expect(ops.getByTestId("capacity-short")).toBeVisible();

  // 5. Temsilci bu ekranlara erişemez
  const agent = await page("e2e-temsilci-l@crmplus.local");
  for (const url of ["/ops/live", "/ops/capacity", "/admin/integrations"]) {
    await agent.goto(url);
    await expect(agent).toHaveURL(/\/forbidden/);
  }
});
