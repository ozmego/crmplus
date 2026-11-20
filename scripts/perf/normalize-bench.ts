/**
 * Normalizasyon adımlarının satır başı maliyeti (CPU; veritabanı yok).
 *   pnpm exec tsx --env-file=.env scripts/perf/normalize-bench.ts <csv> [satır]
 */
import { readFileSync } from "node:fs";
import { normalizePhone } from "@/lib/phone";
import { normalizeRow } from "@/lib/import/normalize";
import { suggestMapping } from "@/lib/import/fields";
import { blindIndex, encrypt } from "@/server/crypto/field-encryption";

const [csv, nArg] = process.argv.slice(2);
const lines = readFileSync(csv, "utf8").split("\n");
const header = lines[0].split(";");
const n = Math.min(Number(nArg ?? 50_000), lines.length - 1);
const rows = lines.slice(1, n + 1).map((l, i) => {
  const cells = l.split(";");
  const o: Record<string, unknown> = { __row: i + 2 };
  header.forEach((h, k) => (o[h] = cells[k]));
  return o;
});
const mapping = suggestMapping(header) as never;

const time = (label: string, fn: () => void) => {
  const t = performance.now();
  fn();
  const ms = performance.now() - t;
  console.log(`${label.padEnd(22)} ${(ms / 1000).toFixed(2)} sn · ${((ms * 1000) / n).toFixed(1)} µs/satır · 500k ≈ ${((ms / n) * 500).toFixed(0)} sn`);
};
const phoneCol = header.find((h) => /telefon/i.test(h))!;
time("normalizeRow", () => rows.forEach((r) => normalizeRow(r, mapping, { defaultCountry: "TR" })));
time("normalizePhone", () => rows.forEach((r) => normalizePhone(r[phoneCol], "TR")));
time("encrypt ×2", () => rows.forEach((r) => (encrypt(String(r[phoneCol])), encrypt("a@b.test"))));
time("blindIndex ×2", () => rows.forEach((r) => (blindIndex(String(r[phoneCol])), blindIndex("a@b.test"))));
