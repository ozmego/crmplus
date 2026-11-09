/**
 * crmPlus arka plan işçisi. Çalıştırma: `pnpm worker`
 * Kuyruklar: recordings (indirme), speech (transkript + analiz), maintenance (zamanlanmış bakım), imports (büyük dosyalar).
 */
import { Worker } from "bullmq";
import { queue, redisConnection } from "@/server/queue";
import { fetchRecording, purgeExpiredRecordings, transcribeRecording } from "@/server/services/recordings";
import { runMaintenance } from "@/worker/maintenance";
import { runImportJob } from "@/worker/imports";
import { sendCampaignJob } from "@/server/services/messaging";

const connection = redisConnection();
const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);

const workers = [
  new Worker("recordings", async (job) => fetchRecording(job.data.recordingId as string), { connection, concurrency: 4 }),
  new Worker("speech", async (job) => transcribeRecording(job.data.recordingId as string), { connection, concurrency: Number(process.env.SPEECH_CONCURRENCY ?? 1) }),
  new Worker("messages", async (job) => sendCampaignJob(job.data.campaignId as string), { connection, concurrency: 1 }),
  new Worker("imports", async (job) => runImportJob(job.name, job.data as { batchId: string; userId: string }), { connection, concurrency: 1 }),
  new Worker(
    "maintenance",
    async (job) => {
      if (job.name === "retention") return purgeExpiredRecordings();
      return runMaintenance(job.name);
    },
    { connection, concurrency: 1 },
  ),
];

for (const w of workers) {
  w.on("completed", (job) => log(`[${w.name}] ${job.name} tamamlandı`, job.id));
  w.on("failed", (job, err) => log(`[${w.name}] ${job?.name} başarısız`, job?.id, err.message));
}

// Zamanlanmış bakım işleri
async function schedule() {
  const m = queue("maintenance");
  await m.upsertJobScheduler("retention", { pattern: "15 3 * * *", tz: "Europe/Istanbul" }, { name: "retention" });
  await m.upsertJobScheduler("callbacks", { every: 5 * 60_000 }, { name: "callbacks" });
  await m.upsertJobScheduler("stale-calls", { every: 15 * 60_000 }, { name: "stale-calls" });
  await m.upsertJobScheduler("access-anomalies", { every: 10 * 60_000 }, { name: "access-anomalies" });
  await m.upsertJobScheduler("import-files", { pattern: "30 3 * * *", tz: "Europe/Istanbul" }, { name: "import-files" });
  // Puantaj: önceki gün (gece devreden vardiyalar 06:00'da biter → 06:30)
  await m.upsertJobScheduler("attendance", { pattern: "30 6 * * *", tz: "Europe/Istanbul" }, { name: "attendance" });
}

schedule()
  .then(() => log("crmPlus işçisi çalışıyor:", workers.map((w) => w.name).join(", ")))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

async function shutdown() {
  log("kapatılıyor…");
  await Promise.all(workers.map((w) => w.close()));
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
