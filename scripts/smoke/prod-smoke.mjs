/**
 * Üretim duman testi (canlıya geçişte ve her güncellemeden sonra). Veri değiştirmez, yalnız ilk yönetici
 * girişini tamamlar: şifre değişimi + MFA kurulumu (ilk girişte zaten zorunlu adımlar).
 *
 *   SMOKE_BASE=https://crm.sirket.com.tr SMOKE_EMAIL=… SMOKE_PASSWORD=… SMOKE_NEW_PASSWORD=… node scripts/smoke/prod-smoke.mjs
 * İç ağ sertifikasında (CRMPLUS_TLS=internal) SMOKE_INSECURE=1 sertifika doğrulamasını atlar.
 * SMOKE_HTTP: HTTP adresi (yönlendirme denetimi), verilmezse atlanır.
 * Çıkış kodu: tüm denetimler geçerse 0.
 */
import { chromium, request } from "@playwright/test";
import { generateSync } from "otplib";

const BASE = process.env.SMOKE_BASE;
const { SMOKE_EMAIL: EMAIL, SMOKE_PASSWORD: PASSWORD, SMOKE_NEW_PASSWORD: NEW_PASSWORD, SMOKE_HTTP: HTTP } = process.env;
const insecure = process.env.SMOKE_INSECURE === "1";
if (!BASE) throw new Error("SMOKE_BASE gerekli");

let failed = 0;
const check = (ok, label, detail = "") => {
  console.log(`${ok ? "GEÇTİ " : "KALDI "} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed++;
};

const api = await request.newContext({ ignoreHTTPSErrors: insecure });
const h = await api.get(`${BASE}/api/health`);
const hj = await h.json().catch(() => ({}));
check(h.status() === 200 && hj.status === "ok", "sağlık ucu", `${h.status()} ${JSON.stringify(hj)}`);
const hdr = h.headers();
check(/max-age=\d{7,}/.test(hdr["strict-transport-security"] ?? ""), "HSTS", hdr["strict-transport-security"]);
check(hdr["x-content-type-options"] === "nosniff", "X-Content-Type-Options");
check(!!(hdr["x-frame-options"] || /frame-ancestors/.test(hdr["content-security-policy"] ?? "")), "çerçeveleme koruması");
check(!hdr["x-powered-by"], "X-Powered-By gizli");
if (HTTP) {
  const r = await api.get(`${HTTP}/login`, { maxRedirects: 0 });
  check([301, 302, 307, 308].includes(r.status()) && (r.headers().location ?? "").startsWith("https://"), "HTTP → HTTPS yönlendirmesi", `${r.status()} ${r.headers().location ?? ""}`);
}
const anon = await api.get(`${BASE}/admin/users`, { maxRedirects: 0 });
check([302, 303, 307].includes(anon.status()) && /\/login/.test(anon.headers().location ?? ""), "girişsiz yönetim sayfası → giriş", `${anon.status()}`);
const wh = await api.post(`${BASE}/api/telephony/webhook/pbx-http`, { data: { eventId: "x", event: "ended", at: new Date().toISOString() } });
check(wh.status() === 401, "imzasız santral webhook'u reddedilir", `${wh.status()}`);
await api.dispose();

if (EMAIL && PASSWORD && NEW_PASSWORD) {
  const browser = await chromium.launch({ channel: process.env.SMOKE_CHANNEL ?? "chrome" });
  const ctx = await browser.newContext({ ignoreHTTPSErrors: insecure, locale: "tr-TR" });
  const page = await ctx.newPage();
  try {
    await page.goto(`${BASE}/login`);
    await page.getByLabel("E-posta").fill(EMAIL);
    await page.getByLabel("Şifre").fill("yanlis-sifre-123");
    await page.getByRole("button", { name: "Giriş yap" }).click();
    await page.getByRole("alert").first().waitFor({ timeout: 15_000 });
    check(/\/login/.test(page.url()), "yanlış şifre reddedilir");

    // Hatalı gönderimden sonra form sıfırlanır; temiz sayfada yeniden dene
    await page.goto(`${BASE}/login`);
    await page.getByLabel("E-posta").fill(EMAIL);
    await page.getByLabel("Şifre").fill(PASSWORD);
    await page.getByRole("button", { name: "Giriş yap" }).click();
    await page.waitForURL(/change-password|mfa|\/$/, { timeout: 30_000 });
    const cookies = await ctx.cookies();
    const sess = cookies.find((c) => c.httpOnly && c.secure);
    check(!!sess && sess.sameSite === "Strict", "oturum çerezi Secure + HttpOnly + SameSite=Strict", sess ? `${sess.name} ${sess.sameSite}` : "yok");

    if (/change-password/.test(page.url())) {
      check(true, "ilk girişte şifre değişimi zorunlu");
      await page.getByLabel("Yeni şifre", { exact: true }).fill(NEW_PASSWORD);
      await page.getByLabel("Yeni şifre (tekrar)").fill(NEW_PASSWORD);
      await page.getByRole("button", { name: "Devam" }).click();
      await page.waitForURL(/mfa/, { timeout: 30_000 });
    }
    if (/mfa/.test(page.url())) {
      const secretEl = page.locator("p.font-mono").first();
      if (await secretEl.isVisible().catch(() => false)) {
        const secret = (await secretEl.innerText()).trim();
        await page.getByLabel("Doğrulama kodu").fill(generateSync({ secret }));
        await page.getByRole("button", { name: "Doğrula" }).click();
        await page.getByRole("link", { name: "Kaydettim, devam et" }).click();
        check(true, "MFA kurulumu", "sır yalnız bu çalıştırmada gösterildi; yönetici kendi uygulamasına yeniden kurmalı (Yönetim > Kullanıcılar > MFA sıfırla)");
      } else {
        check(true, "MFA zaten kurulu (kod girişi elle yapılmalı)");
      }
    }
    await page.waitForLoadState("networkidle");
    for (const path of ["/ops", "/admin/users", "/admin/integrations", "/admin/settings", "/admin/audit"]) {
      const res = await page.goto(`${BASE}${path}`);
      const err = await page.getByText(/Application error|Unhandled Runtime Error|500/).count();
      check(res?.status() === 200 && err === 0, `sayfa ${path}`, `${res?.status()}`);
    }
  } catch (e) {
    check(false, "tarayıcı akışı", e.message.split("\n")[0]);
    await page.screenshot({ path: "smoke-failure.png" }).catch(() => undefined);
  } finally {
    await browser.close();
  }
} else {
  console.log("ATLANDI tarayıcı akışı (SMOKE_EMAIL / SMOKE_PASSWORD / SMOKE_NEW_PASSWORD verilmedi)");
}

console.log(failed ? `\n${failed} denetim KALDI` : "\nTüm denetimler geçti");
process.exit(failed ? 1 : 0);
