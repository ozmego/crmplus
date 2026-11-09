import Link from "next/link";
import { redirect } from "next/navigation";
import { can, requirePage, scopeOf } from "@/server/auth/rbac";
import { canActOnScope, scopeOptions } from "@/server/services/hr";
import { monthGrid } from "@/server/services/timesheet";
import { FinanceForm } from "@/components/finance-form";
import { DAY_CODES } from "@/lib/hr/attendance";
import { fmtMin, istDate } from "@/lib/hr/time";
import { periodAction, recomputeAction } from "../actions";

export const dynamic = "force-dynamic";

const STATUS: Record<string, string> = { OPEN: "Açık", IN_REVIEW: "Onay bekliyor", APPROVED: "Onaylandı", LOCKED: "Kilitli" };
const CODE_TONE: Record<string, string> = { D: "bg-critical-bg text-critical font-bold", RTÇ: "bg-warn-bg", İ: "bg-info-bg", R: "bg-info-bg", HT: "text-muted", RT: "text-muted" };

export default async function TimesheetPage({ searchParams }: { searchParams: Promise<{ month?: string; scope?: string }> }) {
  const user = await requirePage("attendance.view");
  if (scopeOf(user, "attendance.view") === "own") redirect("/hr");
  const sp = await searchParams;
  const today = istDate(new Date());
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? "") ? sp.month! : today.slice(0, 7);
  const scopes = await scopeOptions(user, "attendance.view");
  const scope = scopes.find((s) => s.value === sp.scope)?.value ?? scopes[0]?.value;
  if (!scope) return <p className="callout-info">Görebileceğiniz ekip yok.</p>;
  const g = await monthGrid(user, month, scope);
  const hid = [{ name: "month", type: "hidden" as const, value: month }, { name: "scope", type: "hidden" as const, value: scope }];
  const can_ = (perm: Parameters<typeof canActOnScope>[1]) => canActOnScope(user, perm, scope);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="eyebrow">PERSONEL · PUANTAJ</p>
        <h1 className="page-title">{month}</h1>
        <p className="mt-1 text-sm text-muted">
          Dönem: <span className="pill" data-testid="period-status">{STATUS[g.status]}</span> · Hücreler sistem olaylarından hesaplanır; düzeltme gerekçeli ve değiştirilemez kayıttır. Hazırlayan onaylayamaz; kilitten sonra düzeltme yapılamaz.
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
          <label htmlFor="month" className="label">Ay</label>
          <input id="month" type="month" name="month" defaultValue={month} className="input min-h-9" />
        </div>
        <button className="btn-secondary min-h-9">Göster</button>
      </form>

      <section className="card bg-white">
        <div className="overflow-x-auto">
          <table className="table-ink text-xs" data-testid="timesheet-grid">
            <thead>
              <tr>
                <th>Personel</th>
                {g.days.map((d) => <th key={d} className={"px-1 text-center " + (g.holidays.has(d) ? "bg-teal-ink" : "")} title={g.holidays.get(d)?.name}>{Number(d.slice(8))}</th>)}
                <th>Gün</th><th>Saat</th><th>F.mesai</th><th>İnceleme</th>
              </tr>
            </thead>
            <tbody>
              {g.employees.map(({ employee: e, days, totals, review }) => (
                <tr key={e.id} data-testid={`row-${e.sicilNo}`}>
                  <td className="whitespace-nowrap font-semibold">{e.firstName} {e.lastName}<span className="block font-normal text-muted">{e.sicilNo}</span></td>
                  {g.days.map((d) => {
                    const day = days.get(d);
                    const flagged = day?.flags.some((f: string) => ["LEAVE_CONFLICT", "ABSENT_SUGGESTED", "SINGLE_EVENT", "UNPLANNED_WORK"].includes(f));
                    return (
                      <td key={d} className={"px-1 text-center " + (CODE_TONE[day?.code ?? ""] ?? "") + (flagged ? " outline outline-2 outline-warn" : "")}>
                        {d < today ? (
                          <Link href={`/hr/timesheet/day?e=${e.id}&d=${d}`} title={`${DAY_CODES[day?.code ?? ""] ?? "hesaplanmadı"}${day ? ` · ${fmtMin(day.workedMin)}` : ""}${day?.adjusted ? " · düzeltildi" : ""}`} className="block min-w-5 hover:underline">
                            {day?.code || "·"}{day?.adjusted ? "*" : ""}
                          </Link>
                        ) : (
                          <span className="text-muted">·</span>
                        )}
                      </td>
                    );
                  })}
                  <td className="tabular-nums">{totals.workedDays}</td>
                  <td className="tabular-nums" data-testid="worked-total">{fmtMin(totals.workedMin)}</td>
                  <td className="tabular-nums">{fmtMin(totals.overtimeMin)}</td>
                  <td className="tabular-nums">{review || ""}</td>
                </tr>
              ))}
              {g.employees.length === 0 && <tr><td colSpan={g.days.length + 5} className="text-muted">Personel yok.</td></tr>}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-muted">
          {Object.entries(DAY_CODES).map(([k, v]) => `${k} ${v}`).join(" · ")} · * düzeltildi · turuncu çerçeve: inceleme gerekir
        </p>
      </section>

      <section className="card">
        <h2 className="card-title">Dönem işlemleri</h2>
        <div className="flex flex-col gap-3">
          {g.status === "OPEN" && (can_("attendance.adjust") || can_("timesheet.prepare")) && (
            <FinanceForm action={recomputeAction} submit="Yeniden hesapla" tone="secondary" inline fields={hid} />
          )}
          {g.status === "OPEN" && can_("timesheet.prepare") && <FinanceForm action={periodAction} submit="Hazırla ve onaya gönder" inline fields={[...hid, { name: "action", type: "hidden", value: "PREPARE" }]} />}
          {g.status === "IN_REVIEW" && can_("timesheet.approve") && (
            g.period?.preparedBy === user.id ? (
              <p className="text-sm text-muted">Onay bekleniyor; hazırlayan kişi onaylayamaz.</p>
            ) : (
              <FinanceForm action={periodAction} submit="Dönemi onayla" inline fields={[...hid, { name: "action", type: "hidden", value: "APPROVE" }]} />
            )
          )}
          {g.status === "APPROVED" && can_("timesheet.lock") && <FinanceForm action={periodAction} submit="Dönemi kilitle" inline fields={[...hid, { name: "action", type: "hidden", value: "LOCK" }]} />}
          {["IN_REVIEW", "APPROVED"].includes(g.status) && can_("timesheet.approve") && (
            <details>
              <summary className="cursor-pointer text-sm font-semibold text-teal-ink">Dönemi yeniden aç (düzeltme için)</summary>
              <div className="mt-2"><FinanceForm action={periodAction} submit="Yeniden aç" tone="secondary" inline fields={[...hid, { name: "action", type: "hidden", value: "REOPEN" }, { name: "reason", label: "Gerekçe", required: true }]} /></div>
            </details>
          )}
          {can(user, "timesheet.export") && can_("timesheet.export") && (
            <form method="get" action="/api/hr/timesheet/export" className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="month" value={month} />
              <input type="hidden" name="scope" value={scope} />
              <div>
                <label htmlFor="export-reason" className="label">Dışa aktarma gerekçesi</label>
                <input id="export-reason" name="reason" required minLength={5} className="input min-h-10" placeholder="ör. Kasım bordrosu" />
              </div>
              <button className="btn-secondary min-h-10">Excel indir</button>
            </form>
          )}
        </div>
      </section>
    </div>
  );
}
