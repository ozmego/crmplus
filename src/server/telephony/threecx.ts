import "server-only";
import { toDialString, type DialFormat, type Participant } from "@/lib/threecx";
import type { DialResult, TelephonyProvider } from "@/server/telephony/provider";

/**
 * 3CX V20 Call Control API istemcisi.
 *   THREECX_URL           https://firma.3cx.com.tr (santral adresi; yol yok)
 *   THREECX_CLIENT_ID     Yönetim > Entegrasyonlar > API'de oluşturulan istemci kimliği
 *   THREECX_CLIENT_SECRET aynı ekrandaki API anahtarı (yalnız ortam değişkeninde, ekranda gösterilmez)
 *   THREECX_DIAL_FORMAT   e164 | 00 | national (santralin giden arama kuralına göre; varsayılan e164)
 * İstemcide "Call Control API erişimi" açık olmalı ve temsilci dahilileri izlenecek dahililer arasında seçilmelidir.
 */

export class ThreeCxError extends Error {
  constructor(public code: string, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
  }
}

export function threecxConfig() {
  const url = (process.env.THREECX_URL ?? "").replace(/\/+$/, "");
  const clientId = process.env.THREECX_CLIENT_ID ?? "";
  const secret = process.env.THREECX_CLIENT_SECRET ?? "";
  const format = (process.env.THREECX_DIAL_FORMAT ?? "e164") as DialFormat;
  return { url, clientId, secret, format, configured: !!(url && clientId && secret) };
}

let tokenCache: { token: string; exp: number } | null = null;

export async function threecxToken(force = false): Promise<string> {
  const c = threecxConfig();
  if (!c.configured) throw new ThreeCxError("NOT_CONFIGURED");
  if (!force && tokenCache && tokenCache.exp > Date.now() + 60_000) return tokenCache.token;
  const res = await fetch(`${c.url}/connect/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: c.clientId, client_secret: c.secret, grant_type: "client_credentials" }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new ThreeCxError("AUTH_FAILED", `HTTP ${res.status}`);
  const j = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!j.access_token) throw new ThreeCxError("AUTH_FAILED", "belirteç yok");
  tokenCache = { token: j.access_token, exp: Date.now() + (j.expires_in ?? 3600) * 1000 };
  return j.access_token;
}

/** Yetkili istek; 401'de belirteç bir kez yenilenir. */
export async function threecxFetch(path: string, init: RequestInit = {}, retry = true): Promise<Response> {
  const { url } = threecxConfig();
  const token = await threecxToken();
  const res = await fetch(`${url}${path}`, {
    ...init,
    headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}`, ...(init.body ? { "Content-Type": "application/json" } : {}) },
    signal: init.signal ?? AbortSignal.timeout(8000),
  });
  if (res.status === 401 && retry) {
    tokenCache = null;
    return threecxFetch(path, init, false);
  }
  return res;
}

export async function getParticipant(entity: string): Promise<Participant | null> {
  const res = await threecxFetch(entity);
  if (res.status === 404) return null;
  if (!res.ok) throw new ThreeCxError("API_ERROR", `HTTP ${res.status}`);
  return (await res.json()) as Participant;
}

export const threecxProvider: TelephonyProvider = {
  name: "3cx",
  async dial({ e164, agentExtension }): Promise<DialResult> {
    if (!agentExtension) throw new ThreeCxError("NO_EXTENSION", "Temsilcinin dahili numarası tanımlı değil");
    if (!/^\d{2,8}$/.test(agentExtension)) throw new ThreeCxError("NO_EXTENSION", "Dahili numara geçersiz");
    const destination = toDialString(e164, threecxConfig().format);
    const res = await threecxFetch(`/callcontrol/${agentExtension}/makecall`, { method: "POST", body: JSON.stringify({ destination }) });
    if (!res.ok) throw new ThreeCxError("DIAL_FAILED", `HTTP ${res.status}`);
    const j = (await res.json().catch(() => ({}))) as { finalstatus?: string; reason?: string; result?: { callid?: number } };
    if (j.finalstatus && j.finalstatus !== "Success") throw new ThreeCxError("DIAL_FAILED", j.reason ?? j.finalstatus);
    if (j.result?.callid === undefined) throw new ThreeCxError("DIAL_FAILED", "çağrı kimliği dönmedi");
    return { provider: "3cx", externalId: String(j.result.callid) };
  },
};

/** Yönetim ekranındaki "Bağlantıyı sına": belirteç + dahili listesi. Hiçbir arama başlatmaz. */
export async function testThreeCx(extensions: string[]) {
  const t0 = Date.now();
  await threecxToken(true);
  const res = await threecxFetch("/callcontrol");
  if (!res.ok) throw new ThreeCxError("API_ERROR", `Call Control HTTP ${res.status} (istemcide Call Control API erişimi açık mı?)`);
  const list = (await res.json()) as { dn?: string; type?: string }[];
  const visible = new Set(list.map((d) => d.dn).filter((d): d is string => !!d));
  return {
    ms: Date.now() - t0,
    dnCount: visible.size,
    missing: extensions.filter((e) => !visible.has(e)),
  };
}
