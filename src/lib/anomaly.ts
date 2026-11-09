/**
 * Olağan dışı erişim kuralları — docs/08 §2. Saf: sayımlardan uyarı listesi üretir.
 * Eşikler ayarlanabilir; varsayılanlar belgedeki değerlerdir.
 */
export interface ActorCounts {
  actorId: string | null;
  distinctGuestViews10m: number;
  reveals24h: number;
  exports24h: number;
  maxExportRows24h: number;
  deniedExports1h: number;
  denied1h: number;
  listens24h: number;
}
export interface LoginCounts {
  key: string; // e-posta veya IP
  failed15m: number;
}

export type Severity = "P1" | "P2" | "P3" | "P4";
export interface AlertSpec {
  rule: string;
  severity: Severity;
  actorId: string | null;
  detail: Record<string, unknown>;
}

export const THRESHOLDS = {
  massView10m: 100,
  reveals24h: 20,
  exports24h: 3,
  exportRows: 5000,
  denied1h: 10,
  failedLogins15m: 10,
  listens24h: 30,
};

export function evaluateAnomalies(actors: ActorCounts[], logins: LoginCounts[], t = THRESHOLDS): AlertSpec[] {
  const out: AlertSpec[] = [];
  for (const a of actors) {
    if (a.distinctGuestViews10m > t.massView10m) out.push({ rule: "MASS_VIEW", severity: "P2", actorId: a.actorId, detail: { views: a.distinctGuestViews10m, window: "10 dk" } });
    if (a.reveals24h > t.reveals24h) out.push({ rule: "REVEAL_THRESHOLD", severity: "P3", actorId: a.actorId, detail: { reveals: a.reveals24h } });
    if (a.maxExportRows24h > t.exportRows || a.exports24h > t.exports24h)
      out.push({ rule: "BULK_EXPORT", severity: "P2", actorId: a.actorId, detail: { exports: a.exports24h, maxRows: a.maxExportRows24h } });
    if (a.deniedExports1h > 0) out.push({ rule: "DENIED_EXPORT", severity: "P2", actorId: a.actorId, detail: { attempts: a.deniedExports1h } });
    if (a.denied1h > t.denied1h) out.push({ rule: "REPEATED_DENIED", severity: "P3", actorId: a.actorId, detail: { denied: a.denied1h } });
    if (a.listens24h > t.listens24h) out.push({ rule: "LISTEN_VOLUME", severity: "P3", actorId: a.actorId, detail: { listens: a.listens24h } });
  }
  for (const l of logins) {
    if (l.failed15m > t.failedLogins15m) out.push({ rule: "FAILED_LOGIN_BURST", severity: "P3", actorId: null, detail: { key: l.key, failed: l.failed15m } });
  }
  return out;
}
