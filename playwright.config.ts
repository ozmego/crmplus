import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 90_000,
  // Geliştirme sunucusu bir rotayı ilk istekte derler; ilk adımlar birkaç saniye sürebilir.
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  globalSetup: "./tests/e2e/global-setup.ts",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3210",
    channel: "chrome",
    headless: true,
    locale: "tr-TR",
    timezoneId: "Europe/Istanbul",
  },
});
