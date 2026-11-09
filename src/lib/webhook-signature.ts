import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Webhook imzası: HMAC-SHA256(secret, `${timestamp}.${rawBody}`) hex.
 * Zaman damgası ±5 dk dışındaysa tekrar oynatma (replay) sayılır ve reddedilir.
 */
export const MAX_SKEW_SEC = 300;

export function signPayload(secret: string, timestamp: string, rawBody: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
}

export type SignatureError = "MISSING" | "BAD_TIMESTAMP" | "STALE" | "MISMATCH" | "NO_SECRET";

export function verifySignature(args: {
  secret: string | undefined;
  timestamp: string | null;
  signature: string | null;
  rawBody: string;
  nowSec?: number;
}): { ok: true } | { ok: false; error: SignatureError } {
  if (!args.secret) return { ok: false, error: "NO_SECRET" };
  if (!args.timestamp || !args.signature) return { ok: false, error: "MISSING" };
  const ts = Number(args.timestamp);
  if (!Number.isInteger(ts)) return { ok: false, error: "BAD_TIMESTAMP" };
  const now = args.nowSec ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > MAX_SKEW_SEC) return { ok: false, error: "STALE" };
  const expected = Buffer.from(signPayload(args.secret, args.timestamp, args.rawBody), "hex");
  const given = Buffer.from(args.signature.replace(/^sha256=/, ""), "hex");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, error: "MISMATCH" };
  return { ok: true };
}
