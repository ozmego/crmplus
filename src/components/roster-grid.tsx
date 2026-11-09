"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setCellAction } from "@/app/(app)/hr/actions";

export interface GridRow {
  id: string;
  name: string;
  dept: string;
  cells: Record<string, string>; // tarih → değer
  warn: Record<string, boolean>;
}

/** Hafta × personel ızgarası. Hücre değişince sunucuya yazılır; kurallar sayfa yenilenince yeniden hesaplanır. */
export function RosterGrid({
  weekStart, scope, days, rows, options, editable,
}: {
  weekStart: string;
  scope: string;
  days: { date: string; label: string; holiday?: string }[];
  rows: GridRow[];
  options: { value: string; label: string }[];
  editable: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const label = new Map(options.map((o) => [o.value, o.label]));

  function change(employeeId: string, date: string, value: string) {
    setError(null);
    start(async () => {
      const r = await setCellAction({ weekStart, scope, employeeId, date, value });
      if (r?.error) setError(r.error);
      router.refresh();
    });
  }

  return (
    <div className="overflow-x-auto">
      {error && <p role="alert" className="mb-2 text-sm font-semibold text-critical">{error}</p>}
      <table className="table-ink" aria-busy={pending}>
        <thead>
          <tr>
            <th>Personel</th>
            {days.map((d) => <th key={d.date} className="min-w-36">{d.label}{d.holiday && <span className="block font-normal text-cream/80">{d.holiday}</span>}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="whitespace-nowrap font-semibold">{r.name}<span className="block text-xs font-normal text-muted">{r.dept}</span></td>
              {days.map((d) => {
                const v = r.cells[d.date] ?? "";
                return (
                  <td key={d.date} className={r.warn[d.date] ? "bg-warn-bg" : undefined}>
                    {editable ? (
                      <select
                        aria-label={`${r.name} ${d.label}`}
                        value={v}
                        disabled={pending}
                        onChange={(e) => change(r.id, d.date, e.target.value)}
                        className="input min-h-9 w-full text-xs"
                      >
                        <option value="">—</option>
                        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    ) : (
                      <span className="text-sm">{label.get(v) ?? "—"}</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
