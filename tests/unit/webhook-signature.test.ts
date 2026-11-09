import { describe, expect, it } from "vitest";
import { signPayload, verifySignature } from "@/lib/webhook-signature";

const secret = "test-secret";
const body = JSON.stringify({ event: "answered", eventId: "e1" });
const now = 1_800_000_000;

describe("verifySignature", () => {
  const ts = String(now);
  const sig = signPayload(secret, ts, body);
  it("geçerli imza", () => expect(verifySignature({ secret, timestamp: ts, signature: sig, rawBody: body, nowSec: now })).toEqual({ ok: true }));
  it("sha256= öneki kabul edilir", () => expect(verifySignature({ secret, timestamp: ts, signature: `sha256=${sig}`, rawBody: body, nowSec: now }).ok).toBe(true));
  it("gövde değişirse reddedilir", () => expect(verifySignature({ secret, timestamp: ts, signature: sig, rawBody: body + " ", nowSec: now })).toEqual({ ok: false, error: "MISMATCH" }));
  it("eski zaman damgası (replay) reddedilir", () => expect(verifySignature({ secret, timestamp: ts, signature: sig, rawBody: body, nowSec: now + 301 })).toEqual({ ok: false, error: "STALE" }));
  it("eksik başlık ve tanımsız sır", () => {
    expect(verifySignature({ secret, timestamp: null, signature: sig, rawBody: body, nowSec: now })).toEqual({ ok: false, error: "MISSING" });
    expect(verifySignature({ secret: undefined, timestamp: ts, signature: sig, rawBody: body, nowSec: now })).toEqual({ ok: false, error: "NO_SECRET" });
  });
  it("bozuk imza (farklı uzunluk) hata vermeden reddedilir", () => expect(verifySignature({ secret, timestamp: ts, signature: "abc", rawBody: body, nowSec: now }).ok).toBe(false));
});
