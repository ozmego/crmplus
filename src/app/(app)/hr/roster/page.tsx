import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePage, scopeOf } from "@/server/auth/rbac";
import { db } from "@/server/db";
import { canActOnScope, DEPARTMENTS, scopeOptions } from "@/server/services/hr";
import { coverageTarget, getRosterWeek } from "@/server/services/roster";
import { FinanceForm } from "@/components/finance-form";
import { RosterGrid } from "@/components/roster-grid";
import { addDays, dbDate, fromDbDate, hhmm, istDate, weekStartOf } from "@/lib/hr/time";
import { copyWeekAction, publishRosterAction } from "../actions";

export const dynamic = "force-dynamic";

const DOW = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];
const STATUS: Record<string, string> = { DRAFT: "Taslak", PUBLISHED: "Yayında", CHANGED: "Yayında · yayınlanmamış değişiklik var" };

export default async function RosterPage({ searchParams }: { searchParams: Promise<{ week?: string; scope?: string }> }) {
  const user = await requirePage("roster.view");
  if (scopeOf(user, "roster.view") === "own") redirect("/hr");
  const sp = await searchParams;
  const scopes = await scopeOptions(user, "roster.view");
  const scope = scopes.find((s) => s.value === sp.scope)?.value ?? scopes[0]?.value;
  const weekStart = weekStartOf(/^\d{4}-\d{2}-\d{2}$/.test(sp.week ?? "") ? sp.week! : addDays(istDate(new Date()), 7));
  if (!scope) return <p className="callout-info">Görebileceğiniz ekip yok.</p>;

  const w = await getRosterWeek(weekStart, scope);
  const editable = canActOnScope(user, "roster.manage", scope);
  const canPublish = canActOnScope(user, "roster.publish", scope);
  const target = await coverageTarget();
  const holidays = new Map((await db.publicHoliday.findMany({ where: { date: { gte: dbDate(weekStart), lte: dbDate(addDays(weekStart, 6)) } } })).map((h) => [fromDbDate(h.date), h.name]));
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)).map((date, i) => ({ date, label: `${DOW[i]} ${date.slice(8)}.${date.slice(5, 7)}`, holiday: holidays.get(date) }));

  const options = [
    { value: "OFF", label: "Hafta tatili" },
    { value: "LEAVE", label: "İzin" },
    ...w.templates.map((t) => ({ value: `W:${t.id}`, label: `${t.name} ${hhmm(t.startMin)}–${hhmm(t.endMin)}` })),
    ...w.templates.map((t) => ({ value: `E:${t.id}`, label: `Eğitim · ${t.name}` })),
    ...w.templates.map((t) => ({ value: `S:${t.id}`, label: `Saha · ${t.name}` })),
  ];
  const valueOf = (a: (typeof w.assignments)[number]) =>
    a.kind === "OFF" || a.kind === "LEAVE" ? a.kind : a.templateId ? `${{ WORK: "W", TRAINING: "E", FIELD: "S" }[a.kind as "WORK"]}:${a.templateId}` : "";
  const rows = w.employees.map((e) => ({
    id: e.id,
    name: `${e.firstName} ${e.lastName}`,
    dept: DEPARTMENTS[e.department as keyof typeof DEPARTMENTS] ?? e.department,
    cells: Object.fromEntries(w.assignments.filter((a) => a.employeeId === e.id).map((a) => [fromDbDate(a.date), valueOf(a)])),
    warn: Object.fromEntries(w.warnings.filter((x) => x.employeeId === e.id && x.date).map((x) => [x.date!, true])),
  }));
  const ccCount = w.employees.filter((e) => e.department === "CALL_CENTER").length;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="eyebrow">PERSONEL · VARDİYA ÇİZELGESİ</p>
        <h1 className="page-title">Hafta {weekStart}</h1>
        <p className="mt-1 text-sm text-muted">
          Durum: <span className="pill" data-testid="roster-status">{w.roster ? STATUS[w.roster.status] : "Taslak (boş)"}</span>
          {w.roster?.version ? ` · sürüm ${w.roster.version}` : ""} · Kurallar uyarır, engellemez; uyarıyla yayın gerekçe ister.
        </p>
      </div>

      <form className="flex flex-wrap items-end gap-2 text-sm">
        <div>
          <label htmlFor="scope" className="label">Ekip</label>
          <select id="scope" name="scope" defaultValue={scope} className="input min-h-9">
            {scopes.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="week" className="label">Hafta (herhangi bir gün)</label>
          <input id="week" type="date" name="week" defaultValue={weekStart} className="input min-h-9" />
        </div>
        <button className="btn-secondary min-h-9">Göster</button>
        <Link className="ml-2 text-teal-ink underline" href={`/hr/roster?scope=${scope}&week=${addDays(weekStart, -7)}`}>← Önceki</Link>
        <Link className="text-teal-ink underline" href={`/hr/roster?scope=${scope}&week=${addDays(weekStart, 7)}`}>Sonraki →</Link>
      </form>

      {w.employees.length === 0 ? (
        <p className="callout-info">Bu ekipte aktif personel yok.</p>
      ) : (
        <section className="card bg-white">
          <RosterGrid weekStart={weekStart} scope={scope} days={days} rows={rows} options={options} editable={editable} />
          {editable && (
            <div className="mt-3">
              <FinanceForm action={copyWeekAction} submit="Önceki haftayı kopyala" tone="secondary" inline fields={[{ name: "weekStart", type: "hidden", value: weekStart }, { name: "scope", type: "hidden", value: scope }]} />
            </div>
          )}
        </section>
      )}

      {ccCount > 0 && (
        <section className="card bg-white">
          <h2 className="card-title">Saatlik kapsama · çağrı merkezi (hedef {target})</h2>
          <div className="overflow-x-auto">
            <table className="text-xs tabular-nums" data-testid="coverage">
              <thead><tr><th className="pr-2 text-left">Gün</th>{Array.from({ length: 16 }, (_, i) => i + 8).map((h) => <th key={h} className="w-8 text-center">{h}</th>)}</tr></thead>
              <tbody>
                {w.coverage.map((c, i) => (
                  <tr key={c.date}>
                    <td className="pr-2">{days[i].label}</td>
                    {c.hours.slice(8, 24).map((n, k) => {
                      const h = k + 8;
                      const low = h >= 9 && h < 21 && n < target;
                      return <td key={h} className={"border border-line text-center " + (low ? "bg-critical-bg font-bold text-critical" : n ? "bg-info-bg" : "")}>{n}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-1 text-xs text-muted">Kırmızı: 09–21 arasında planlanan temsilci sayısı hedefin altında.</p>
        </section>
      )}

      <section className="card">
        <h2 className="card-title">Kural uyarıları ({w.warnings.length})</h2>
        <ul className="text-sm" data-testid="roster-warnings">
          {w.warnings.map((x, i) => <li key={i} className="border-l-4 border-warn py-1 pl-2">{x.message}</li>)}
          {w.warnings.length === 0 && <li className="text-muted">Uyarı yok.</li>}
        </ul>
        {canPublish && w.roster && w.roster.status !== "PUBLISHED" && w.assignments.length > 0 && (
          <div className="mt-3">
            <FinanceForm
              action={publishRosterAction}
              submit="Çizelgeyi yayınla"
              fields={[
                { name: "weekStart", type: "hidden", value: weekStart },
                { name: "scope", type: "hidden", value: scope },
                ...(w.warnings.length ? [{ name: "reason", label: "Uyarılara rağmen yayın gerekçesi", required: true }] : []),
              ]}
            />
          </div>
        )}
        {w.roster?.overrideReason && <p className="mt-2 text-xs text-muted">Son yayın gerekçesi: {w.roster.overrideReason}</p>}
      </section>
    </div>
  );
}
