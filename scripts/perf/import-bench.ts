/**
 * İçe aktarma performans ölçümü (plan hedefi: 500k satır önizleme < 3 dk, uygulama < 10 dk).
 * Ayrı bir veritabanında çalıştırın (geliştirme verisini kirletmez):
 *   DATABASE_URL=postgresql://…/crmplus_perf pnpm exec tsx --env-file=.env --require ./src/worker/server-only-shim.cjs scripts/perf/import-bench.ts <dosya.csv> [new|update]
 */
import { readFileSync, statSync } from "node:fs";
import { basename } from "node:path";
import { db } from "@/server/db";
import { principalFor } from "@/server/auth/rbac";
import { applyImport, buildPreview, createImport, saveMapping, setAllDecisions } from "@/server/services/imports";
import type { Mapping } from "@/lib/import/fields";

const file = process.argv[2];
if (!file) throw new Error("dosya yolu verin");

let peakRss = 0;
const timer = setInterval(() => (peakRss = Math.max(peakRss, process.memoryUsage().rss)), 250);
const t = async <T,>(label: string, fn: () => Promise<T>) => {
  const s = performance.now();
  const r = await fn();
  const ms = performance.now() - s;
  console.log(`${label.padEnd(18)} ${(ms / 1000).toFixed(1).padStart(8)} sn`);
  return { r, ms };
};

async function main() {
  const admin = await db.user.findFirstOrThrow({ where: { roles: { some: { role: { key: "sys_admin" } } } } });
  // Yönetici içe aktarma yetkisine sahip değil; ölçüm için veri yükleyici rolü geçici atanır
  const loader = await db.role.findUniqueOrThrow({ where: { key: "data_loader" } });
  await db.userRole.upsert({ where: { userId_roleId: { userId: admin.id, roleId: loader.id } }, update: {}, create: { userId: admin.id, roleId: loader.id, assignedBy: "perf" } });
  const user = (await principalFor(admin.id))!;
  const data = readFileSync(file);
  console.log(`dosya: ${basename(file)} · ${(statSync(file).size / 1e6).toFixed(1)} MB · mevcut misafir: ${await db.guest.count()}`);

  const up = await t("yükleme+ayrıştırma", () => createImport(user, { fileName: basename(file), data, purpose: (process.argv[3] === "update" ? "UPDATE" : "NEW_LIST"), sourceLabel: "perf", defaultCountry: "TR" }));
  const batch = up.r;
  const rows = (batch.summary as { rowCount: number }).rowCount;
  await t("eşleme", () => saveMapping(user, batch.id, batch.mapping as Mapping));
  const pv = await t("önizleme", () => buildPreview(user, batch.id));
  console.log("  özet:", JSON.stringify({ new: pv.r.new, matched: pv.r.matched, changed: pv.r.changed, conflict: pv.r.conflict, invalid: pv.r.invalid, possible: pv.r.possible, multi: pv.r.multi }));
  if (pv.r.conflict) await t("toplu karar", () => setAllDecisions(user, batch.id, "USE_NEW"));
  const ap = await t("uygulama", () => applyImport(user, batch.id));
  console.log("  uygulanan:", JSON.stringify(ap.r));
  const rate = (ms: number) => Math.round(rows / (ms / 1000));
  console.log(`satır: ${rows} · önizleme ${rate(pv.ms)} satır/sn · uygulama ${rate(ap.ms)} satır/sn · tepe bellek ${(peakRss / 1e6).toFixed(0)} MB`);
  console.log(`500k tahmini: önizleme ${((500_000 / rate(pv.ms)) / 60).toFixed(1)} dk · uygulama ${((500_000 / rate(ap.ms)) / 60).toFixed(1)} dk`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    clearInterval(timer);
    await db.$disconnect();
    process.exit();
  });
