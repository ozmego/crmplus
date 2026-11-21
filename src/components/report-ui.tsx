import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { todayIso } from "@/server/services/reports";

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Rapor tarih aralığı: geçersiz/eksikse son `days` gün; en fazla 2 yıl. */
export function readRange(sp: { from?: string; to?: string }, days: number) {
  const today = todayIso();
  const to = ISO.test(sp.to ?? "") ? sp.to! : today;
  const def = todayIso(new Date(new Date(`${to}T12:00:00Z`).getTime() - (days - 1) * 86_400_000));
  let from = ISO.test(sp.from ?? "") ? sp.from! : def;
  if (from > to) from = to;
  const min = todayIso(new Date(new Date(`${to}T12:00:00Z`).getTime() - 730 * 86_400_000));
  if (from < min) from = min;
  return { from, to };
}

export function ReportHeader({ title, sub }: { title: string; sub: React.ReactNode }) {
  return (
    <div>
      <Link href="/reports" className="text-sm text-teal-ink hover:underline">‹ Rapor merkezi</Link>
      <p className="eyebrow mt-2">RAPORLAMA</p>
      <h1 className="page-title">{title}</h1>
      <p className="mt-1 text-sm text-muted">{sub}</p>
    </div>
  );
}

export function RangeForm({ from, to, children }: { from: string; to: string; children?: React.ReactNode }) {
  return (
    <form className="flex flex-wrap items-end gap-3 rounded-xl border border-line bg-white p-3" role="search" aria-label="Rapor filtresi">
      <div><label htmlFor="from" className="label">Başlangıç</label><input id="from" name="from" type="date" defaultValue={from} className="input" /></div>
      <div><label htmlFor="to" className="label">Bitiş</label><input id="to" name="to" type="date" defaultValue={to} className="input" /></div>
      {children}
      <button className="btn-primary">Uygula</button>
    </form>
  );
}

export function StatTile({ label, value, sub, icon: Icon }: { label: string; value: string | number; sub?: string; icon?: LucideIcon }) {
  return (
    <div className="rounded-xl border border-line bg-white p-4 shadow-[0_1px_2px_rgb(18_18_20/0.04)]">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-bold uppercase tracking-wider text-muted">{label}</p>
        {Icon && <Icon className="h-4 w-4 text-teal-ink" aria-hidden />}
      </div>
      <p className="stat-value mt-1">{typeof value === "number" ? value.toLocaleString("tr-TR") : value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
    </div>
  );
}

export const money = (v: string) => Number(v).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const moneyList = (rows: { currency: string; total: string }[]) => (rows.length ? rows.map((r) => `${money(r.total)} ${r.currency}`).join(" · ") : "—");
