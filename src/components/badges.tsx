/** Durum rozetleri. "Aktif" kesinliği iddia edilmez (plan v4 §2): biçim ve erişim ayrı gösterilir. */

const CONSENT: Record<string, { label: string; cls: string }> = {
  GRANTED: { label: "İzin var", cls: "border-teal-ink bg-info-bg text-teal-ink" },
  DENIED: { label: "Reddedildi", cls: "border-critical text-critical" },
  UNKNOWN: { label: "Bilinmiyor", cls: "border-warn text-warn-ink" },
  BLOCKED: { label: "İletişim durduruldu", cls: "border-critical bg-critical-bg text-critical" },
};

export function ConsentBadge({ status }: { status: string }) {
  const c = CONSENT[status] ?? CONSENT.UNKNOWN;
  return <span className={`pill ${c.cls}`}>{c.label}</span>;
}

const REACH: Record<string, string> = {
  UNVERIFIED: "Erişim doğrulanmadı",
  REACHED: "Son çağrıda ulaşıldı",
  UNREACHED: "Son denemede ulaşılamadı",
  UNREACHABLE: "Ulaşılamıyor",
};

export function PhoneStateBadge({ formatStatus, reachability }: { formatStatus: string; reachability: string }) {
  if (formatStatus === "INVALID") return <span className="pill border-critical text-critical">Biçim geçersiz</span>;
  const tone =
    reachability === "REACHED" ? "border-teal-ink text-teal-ink" : reachability === "UNVERIFIED" ? "border-line text-muted" : "border-warn text-warn-ink";
  return <span className={`pill ${tone}`}>{formatStatus === "COUNTRY_MISMATCH" ? "Ülke uyuşmazlığı · " : ""}{REACH[reachability] ?? reachability}</span>;
}
