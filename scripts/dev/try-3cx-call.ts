/**
 * 3CX akışını uçtan uca dener (geliştirme veritabanı): bir temsilciye dahili atar, açık görevinden "Ara" yapar,
 * santral olaylarının çağrıya yazılmasını bekler. Gerçek arama başlatır — yalnız sahte santralle ya da
 * bilerek kullanın. Önce: işçi PBX_PROVIDER=3cx ile çalışıyor olmalı.
 *   PBX_PROVIDER=3cx THREECX_URL=… THREECX_CLIENT_ID=… THREECX_CLIENT_SECRET=… \
 *   pnpm exec tsx --env-file=.env --require ./src/worker/server-only-shim.cjs scripts/dev/try-3cx-call.ts <temsilci-e-posta> <dahili>
 */
import { db } from "@/server/db";
import { principalFor } from "@/server/auth/rbac";
import { startCall } from "@/server/services/calls";

async function main() {
const [email, ext] = process.argv.slice(2);
if (!email || !ext) throw new Error("Kullanım: try-3cx-call.ts <temsilci-e-posta> <dahili>");

const user = await db.user.findUniqueOrThrow({ where: { email } });
await db.user.update({ where: { id: user.id }, data: { extension: ext } });
await db.call.updateMany({ where: { agentId: user.id, closedAt: null }, data: { closedAt: new Date() } }); // önceki denemeden açık kalan
const principal = await principalFor(user.id);
if (!principal) throw new Error("Kullanıcı etkin değil");
const tasks = await db.task.findMany({ where: { assigneeId: user.id, status: { in: ["OPEN", "IN_PROGRESS"] } }, orderBy: { createdAt: "asc" }, take: 20 });
let r: Awaited<ReturnType<typeof startCall>> | null = null;
for (const t of tasks) {
  try {
    r = await startCall(principal, t.id);
    break;
  } catch (e) {
    console.log(`görev ${t.id}: ${(e as Error).message}`);
  }
}
if (!r) throw new Error("Aranabilir açık görev bulunamadı");
console.log("Ara →", r);
if (r.fallback) console.log("Santral hata verdi, manuel moda düşüldü. Son olay:", await db.telephonyIncident.findFirst({ orderBy: { at: "desc" } }));

const t0 = Date.now();
for (;;) {
  const c = await db.call.findUniqueOrThrow({ where: { id: r.callId } });
  console.log(`${((Date.now() - t0) / 1000).toFixed(0).padStart(3)} sn · santral ${c.provider}/${c.externalId ?? "—"} · bağlandı ${c.answeredAt?.toISOString().slice(11, 19) ?? "—"} · bitti ${c.endedAt?.toISOString().slice(11, 19) ?? "—"} · konuşma ${c.talkSec ?? "—"} sn · çalma ${c.ringSec ?? "—"} sn`);
  if (c.endedAt || Date.now() - t0 > 30_000) break;
  await new Promise((res) => setTimeout(res, 2000));
}
await db.$disconnect();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
