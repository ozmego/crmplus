/**
 * Üretim konteynerinde virüs taraması denetimi: temiz dosya CLEAN, EICAR test imzası (zararsız standart dizi) INFECTED olmalı.
 *   docker compose exec worker node_modules/.bin/tsx --require ./src/worker/server-only-shim.cjs scripts/smoke/scan-check.ts
 */
import { scanBuffer } from "@/server/scan";

const EICAR = String.raw`X5O!P%@AP[4\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*`;

async function main() {
  const clean = await scanBuffer(Buffer.from("Ad;Soyad\nAyşe;Yılmaz\n"));
  const infected = await scanBuffer(Buffer.from(EICAR));
  console.log("temiz dosya:", JSON.stringify(clean));
  console.log("EICAR:", JSON.stringify(infected));
  const ok = clean.status === "CLEAN" && infected.status === "INFECTED";
  console.log(ok ? "GEÇTİ  virüs taraması" : "KALDI  virüs taraması");
  process.exit(ok ? 0 : 1);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
