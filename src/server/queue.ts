import "server-only";
import { Queue } from "bullmq";
import IORedis from "ioredis";

/**
 * Arka plan kuyrukları (BullMQ / Redis). İşler `src/worker/index.ts` sürecinde çalışır.
 *   recordings  — santralden ses kaydını indirip şifreli saklama
 *   speech      — Türkçe transkript + maskeleme + analiz önerisi
 *   maintenance — saklama süresi temizliği, geri arama durumları, erişim anomalileri (zamanlanmış)
 */
export const QUEUES = ["recordings", "speech", "maintenance", "imports", "messages"] as const;
export type QueueName = (typeof QUEUES)[number];

let connection: IORedis | null = null;
const queues = new Map<QueueName, Queue>();

export function redisConnection() {
  connection ??= new IORedis(process.env.REDIS_URL ?? "redis://localhost:16380", { maxRetriesPerRequest: null });
  return connection;
}

export function queue(name: QueueName): Queue {
  let q = queues.get(name);
  if (!q) {
    q = new Queue(name, { connection: redisConnection(), defaultJobOptions: { attempts: 3, backoff: { type: "exponential", delay: 10_000 }, removeOnComplete: 1000, removeOnFail: 5000 } });
    queues.set(name, q);
  }
  return q;
}

export async function enqueue(name: QueueName, job: string, data: Record<string, unknown>, opts?: { jobId?: string; delay?: number }) {
  await queue(name).add(job, data, opts);
}
