import Link from "next/link";
import { notFound } from "next/navigation";
import { can, requirePage } from "@/server/auth/rbac";
import { HrError, scopeKeyOf } from "@/server/services/hr";
import { dayDetail } from "@/server/services/timesheet";
import { FinanceForm } from "@/components/finance-form";
import { DAY_CODES, FLAG_LABEL, type Flag } from "@/lib/hr/attendance";
import { fmtMin, hhmm } from "@/lib/hr/time";
import { adjustDayAction } from "../../actions";

export const dynamic = "force-dynamic";

const EV: Record<string, string> = { LOGIN: "Giriş", ACTIVITY: "Son etkinlik", LOGOUT: "Çıkış", READY: "Mesaide", BREAK: "Mola", ON_CALL: "Görüşme", WRAP_UP: "Çağrı sonrası", OFFLINE: "Mesai bitti", CHECK_IN: "Saha: vardım", CHECK_OUT: "Saha: ayrıldım" };
const FIELD: Record<string, string> = { firstIn: "İlk giriş", lastOut: "Son çıkış", breakMin: "Mola (dk)", code: "Gün kodu" };
const t = (d: Date | null | undefined) => (d ? d.toLocaleString("tr-TR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" }) : "—");

export default async function DayPage({ searchParams }: { searchParams: Promise<{ e?: string; d?: string }> }) {
  const user = await requirePage("attendance.view");
  const { e, d } = await searchParams;
  if (!e || !d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) notFound();
  let r;
  try {
    r = await dayDetail(user, e, d);
  } catch (err) {
    if (err instanceof HrError) notFound();
    throw err;
  }
  const { employee, day, events, adjustments, plan, periodStatus } = r;
  const canAdjust = can(user, "attendance.adjust") && employee.userId !== user.id && !["APPROVED", "LOCKED"].includes(periodStatus);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="eyebrow">PUANTAJ · GÜN AYRINTISI</p>
        <h1 className="page-title">{employee.firstName} {employee.lastName} · {d}</h1>
        <p className="mt-1 text-sm text-muted">
          <Link className="text-teal-ink underline" href={`/hr/timesheet?month=${d.slice(0, 7)}&scope=${scopeKeyOf(employee)}`}>Aylık puantaja dön</Link> · Dönem durumu: {periodStatus}
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="card">
          <h2 className="card-title">Plan</h2>
          {plan ? (
            <p className="text-sm">{plan.kind}{plan.startMin != null && plan.endMin != null ? ` · ${hhmm(plan.startMin)}–${hhmm(plan.endMin)} · mola ${plan.breakMin ?? 0} dk` : ""}{plan.roster.publishedAt ? ` · sürüm ${plan.roster.version}` : " · yayınlanmamış (hesaba girmez)"}</p>
          ) : (
            <p className="text-sm text-muted">Vardiya planı yok.</p>
          )}
        </section>
        <section className="card lg:col-span-2">
          <h2 className="card-title">Hesap</h2>
          {day ? (
            <div className="text-sm" data-testid="day-calc">
              <p>
                Kod <b data-testid="day-code">{day.code || "—"}</b> ({DAY_CODES[day.code] ?? "—"}) · Giriş {t(day.firstIn)} · Çıkış {t(day.lastOut)} · Mola {day.breakMin} dk ·
                Çalışılan <b data-testid="day-worked">{fmtMin(day.workedMin)}</b> · Geç {day.lateMin} dk · Erken {day.earlyMin} dk · F.mesai {fmtMin(day.overtimeMin)} · Kaynak {day.source}
              </p>
              {day.flags.length > 0 && <ul className="mt-2">{day.flags.map((f) => <li key={f} className="border-l-4 border-warn pl-2">{FLAG_LABEL[f as Flag] ?? f}</li>)}</ul>}
            </div>
          ) : (
            <p className="text-sm text-muted">Bu gün henüz hesaplanmadı.</p>
          )}
        </section>
      </div>

      <section className="card bg-white">
        <h2 className="card-title">Kaynak olaylar</h2>
        <ul className="text-sm tabular-nums">
          {events.map((x, i) => <li key={i}>{t(x.at)} · {EV[x.type] ?? x.type}</li>)}
          {events.length === 0 && <li className="text-muted">Olay yok.</li>}
        </ul>
        <p className="mt-1 text-xs text-muted">Vardiya penceresinin (±2 saat) dışındaki tekil olaylar hesaba girmez.</p>
      </section>

      <section className="card">
        <h2 className="card-title">Düzeltmeler</h2>
        <ul className="text-sm" data-testid="adjustments">
          {adjustments.map((a) => (
            <li key={a.id}>{t(a.at)} · {a.actorName} · {FIELD[a.field]}: {a.oldValue ?? "—"} → {a.newValue} · “{a.reason}”</li>
          ))}
          {adjustments.length === 0 && <li className="text-muted">Düzeltme yok.</li>}
        </ul>
        {canAdjust && (
          <div className="mt-3">
            <FinanceForm
              action={adjustDayAction}
              submit="Düzeltmeyi kaydet"
              fields={[
                { name: "employeeId", type: "hidden", value: employee.id },
                { name: "date", type: "hidden", value: d },
                { name: "field", label: "Alan", type: "select", required: true, options: Object.entries(FIELD).map(([value, label]) => ({ value, label })) },
                { name: "value", label: "Yeni değer (saat SS:DD, ertesi gün +1; mola dk; gün kodu)", required: true },
                { name: "reason", label: "Gerekçe", required: true },
              ]}
            />
          </div>
        )}
        {!canAdjust && can(user, "attendance.adjust") && <p className="mt-2 text-sm text-muted">{employee.userId === user.id ? "Kendi puantajınızı düzeltemezsiniz." : "Dönem onaylı veya kilitli; düzeltme yapılamaz."}</p>}
      </section>
    </div>
  );
}
