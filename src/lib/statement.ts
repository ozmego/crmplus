/**
 * Casino ekstresi işleme ve mutabakat — saf fonksiyonlar (Aşama 3, docs/06 §7).
 * Tutarlar kuruş (tam sayı). Net kayıp işareti: + misafir kaybı (kasa kazancı), − misafir kazancı.
 */
import { normHeader } from "./import/fields";

export type StatementField = "crmNo" | "playerRef" | "name" | "playedOn" | "netLoss" | "rolling";

const SYN: Record<StatementField, string[]> = {
  crmNo: ["crm", "crm no", "crm id", "crmid", "misafir no"],
  playerRef: ["oyuncu no", "player id", "player no", "member id", "üye no", "account", "hesap no"],
  name: ["ad soyad", "misafir", "oyuncu", "name", "player name", "guest"],
  playedOn: ["tarih", "oyun tarihi", "date", "gaming date", "play date"],
  netLoss: ["net kayıp", "net kayip", "net loss", "kasa kazancı", "house win", "win loss", "w/l", "net result", "net"],
  rolling: ["rolling", "turnover", "ciro", "rolling chip"],
};

export function mapStatementHeaders(headers: string[]): Partial<Record<StatementField, string>> {
  const out: Partial<Record<StatementField, string>> = {};
  for (const pass of ["exact", "contains"] as const) {
    for (const h of headers) {
      const nh = normHeader(h);
      for (const [f, syns] of Object.entries(SYN) as [StatementField, string[]][]) {
        if (out[f]) continue;
        if (Object.values(out).includes(h)) continue;
        const hit = syns.some((s) => (pass === "exact" ? nh === normHeader(s) : nh.includes(normHeader(s))));
        if (hit) out[f] = h;
      }
    }
  }
  return out;
}

/** "1.234.567,89" · "1,234,567.89" · "(1.000)" · 1234.5 → kuruş; okunamazsa null. */
export function parseAmount(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return Math.round(v * 100);
  if (typeof v !== "string") return null;
  let s = v.trim().replace(/[₺$€£\s]|TRY|TL|EUR|USD/gi, "");
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1);
  }
  if (s.startsWith("-")) {
    neg = !neg;
    s = s.slice(1);
  }
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma > lastDot) s = s.replace(/\./g, "").replace(",", "."); // Türkçe biçim: 1.234,56
  else if (lastComma < 0 && /^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, ""); // yalnız binlik nokta: 12.500
  else s = s.replace(/,/g, ""); // İngilizce biçim: 1,234.56
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const k = Math.round(Number(s) * 100);
  return neg ? -k : k;
}

/** Excel seri tarih, gg.aa.yyyy, yyyy-aa-gg → "yyyy-aa-gg"; okunamazsa null. */
export function parseStatementDate(v: unknown): string | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  if (typeof v === "number" && v > 20000 && v < 80000) return new Date(Date.UTC(1899, 11, 30) + v * 86_400_000).toISOString().slice(0, 10);
  if (typeof v !== "string") return null;
  const s = v.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
}

export interface StatementLineIn {
  rowNo: number;
  crmNo: number | null;
  playerRef: string | null;
  name: string | null;
  playedOn: string | null;
  netLoss: number;
  rolling: number | null;
  issue: string | null;
}

/** invertSign: ekstre misafir bakış açısıyla (misafir kazancı pozitif) yazılmışsa işaret çevrilir. */
export function normalizeStatementRows(rows: Record<string, unknown>[], map: Partial<Record<StatementField, string>>, opts: { invertSign?: boolean; period?: string } = {}): StatementLineIn[] {
  return rows.map((r, i) => {
    const issues: string[] = [];
    const crmRaw = map.crmNo ? String(r[map.crmNo] ?? "").replace(/\D/g, "") : "";
    const crmNo = crmRaw ? Number(crmRaw) : null;
    const playerRef = map.playerRef ? String(r[map.playerRef] ?? "").trim() || null : null;
    const name = map.name ? String(r[map.name] ?? "").trim() || null : null;
    const playedOn = map.playedOn ? parseStatementDate(r[map.playedOn]) : null;
    const nl = map.netLoss ? parseAmount(r[map.netLoss]) : null;
    const rolling = map.rolling ? parseAmount(r[map.rolling]) : null;
    if (crmNo === null && !playerRef) issues.push("CRM no veya oyuncu no yok");
    if (nl === null) issues.push("net kayıp okunamadı");
    if (map.playedOn && !playedOn) issues.push("tarih okunamadı");
    if (opts.period && playedOn && playedOn.slice(0, 7) !== opts.period) issues.push(`tarih ${opts.period} dönemi dışında`);
    return { rowNo: i + 2, crmNo, playerRef, name, playedOn, netLoss: nl === null ? 0 : opts.invertSign ? -nl : nl, rolling, issue: issues.join("; ") || null };
  });
}

export interface GuestTotals {
  key: string; // crmNo
  name: string;
  netLoss: number;
  rolling: number;
}

export interface ReconRow {
  key: string;
  name: string;
  statementNetLoss: number | null;
  enteredNetLoss: number | null;
  diff: number; // ekstre − girilen
  status: "MATCH" | "DIFF" | "ONLY_STATEMENT" | "ONLY_ENTERED";
}

/** Misafir bazında ekstre ↔ girilen sonuç karşılaştırması; tolerans kuruş cinsinden (vars. 0). */
export function reconcile(statement: GuestTotals[], entered: GuestTotals[], tolerance = 0) {
  const s = new Map(statement.map((x) => [x.key, x]));
  const e = new Map(entered.map((x) => [x.key, x]));
  const keys = [...new Set([...s.keys(), ...e.keys()])].sort((a, b) => Number(a) - Number(b));
  const rows: ReconRow[] = keys.map((k) => {
    const a = s.get(k);
    const b = e.get(k);
    const diff = (a?.netLoss ?? 0) - (b?.netLoss ?? 0);
    const status: ReconRow["status"] = !a ? "ONLY_ENTERED" : !b ? "ONLY_STATEMENT" : Math.abs(diff) <= tolerance ? "MATCH" : "DIFF";
    return { key: k, name: a?.name ?? b?.name ?? "", statementNetLoss: a?.netLoss ?? null, enteredNetLoss: b?.netLoss ?? null, diff, status };
  });
  const sum = (xs: GuestTotals[]) => xs.reduce((t, x) => t + x.netLoss, 0);
  return {
    rows,
    statementTotal: sum(statement),
    enteredTotal: sum(entered),
    totalDiff: sum(statement) - sum(entered),
    counts: { match: rows.filter((r) => r.status === "MATCH").length, diff: rows.filter((r) => r.status === "DIFF").length, onlyStatement: rows.filter((r) => r.status === "ONLY_STATEMENT").length, onlyEntered: rows.filter((r) => r.status === "ONLY_ENTERED").length },
    clean: rows.every((r) => r.status === "MATCH"),
  };
}
