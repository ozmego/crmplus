import Link from "next/link";
import { can, requirePage } from "@/server/auth/rbac";
import { db } from "@/server/db";
import { leaveBalance, myEmployee } from "@/server/services/hr";
import { myWeek } from "@/server/services/roster";
import { currentWorkStatus } from "@/server/services/field-routes";
import { WorkStatus } from "@/components/work-status";
import { DAY_CODES, monthTotals } from "@/lib/hr/attendance";
import { addDays, daysOfMonth, dbDate, fmtMin, fromDbDate, hhmm, istDate, weekStartOf } from "@/lib/hr/time";

export const dynamic = "force-dynamic";

const KIND: Record<string, string> = { WORK: "Vardiya", OFF: "Hafta tatili", LEAVE: "İzin", TRAINING: "Eğitim", FIELD: "Saha" };
const DOW = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];

export default async function MyHrPage({ searchParams }: { searchParams: Promise<{ week?: string; month?: string }> }) {
  const user = await requirePage("attendance.view");
  const sp = await searchParams;
  const today = istDate(new Date());
  const week = weekStartOf(/^\d{4}-\d{2}-\d{2}$/.test(sp.week ?? "") ? sp.week! : today);
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? "") ? sp.month! : today.slice(0, 7);
  const emp = await myEmployee(user.id);
  const ws = await currentWorkStatus(user.id);

  if (!emp) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="page-title">Çizelgem ve puantajım</h1>
        <WorkStatus status={ws.status} since={ws.since?.toISOString() ?? null} />
        <p className="callout-info">CRM hesabınız bir personel kaydına bağlı değil. Çizelge ve puantaj için İK ile görüşün.</p>
      </div>
    );
  }

  const [mw, days, balance] = await Promise.all([
    myWeek(user.id, week),
    db.attendanceDay.findMany({ where: { employeeId: emp.id, date: { gte: dbDate(`${month}-01`), lte: dbDate(daysOfMonth(month).at(-1)!) } }, orderBy: { date: "asc" } }),
    leaveBalance(emp.id),
  ]);
  const byDate = new Map(mw!.days.map((d) => [d.date, d]));
  const t = monthTotals(days);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="eyebrow">PERSONEL · {emp.sicilNo}</p>
        <h1 className="page-title">Çizelgem ve puantajım</h1>
        <p className="mt-1 text-sm text-muted">
          Puantaj; giriş, mesai/mola işaretleri ve saha ziyaretlerinden otomatik hesaplanır, yöneticiniz gerekçeyle düzeltebilir. Konum toplanmaz; görüşme içerikleri ve performans puantajla birleştirilmez.
        </p>
      </div>

      <WorkStatus status={ws.status} since={ws.since?.toISOString() ?? null} />

      <section className="card bg-white">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="card-title">Haftalık çizelge</h2>
          <div className="flex gap-3 text-sm">
            <Link className="text-teal-ink underline" href={`/hr?week=${addDays(week, -7)}`}>← Önceki hafta</Link>
            <Link className="text-teal-ink underline" href={`/hr?week=${addDays(week, 7)}`}>Sonraki hafta →</Link>
          </div>
        </div>
        <ol className="grid gap-2 sm:grid-cols-7" data-testid="my-week">
          {Array.from({ length: 7 }, (_, i) => addDays(week, i)).map((d, i) => {
            const a = byDate.get(d);
            return (
              <li key={d} className={"rounded-md border p-2 text-sm " + (d === today ? "border-teal" : "border-line")}>
                <p className="text-xs font-semibold text-muted">{DOW[i]} {d.slice(8)}.{d.slice(5, 7)}</p>
                {a ? (
                  <>
                    <p className="font-semibold">{a.template ?? KIND[a.kind]}</p>
                    {a.startMin != null && a.endMin != null && <p className="tabular-nums">{hhmm(a.startMin)}–{hhmm(a.endMin)}</p>}
                    {a.changed && <span className="pill mt-1 border-warn text-warn-ink">değişti</span>}
                    {a.pendingChange && <span className="pill mt-1">güncelleniyor</span>}
                  </>
                ) : (
                  <p className="text-muted">—</p>
                )}
              </li>
            );
          })}
        </ol>
        <p className="mt-2 text-xs text-muted">Yalnız yayınlanmış çizelge gösterilir. “değişti”: son yayında güncellenen gün.</p>
      </section>

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <section className="card bg-white">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="card-title">Puantajım · {month}</h2>
            <form className="flex items-center gap-2 text-sm">
              <label htmlFor="m" className="sr-only">Ay</label>
              <input id="m" type="month" name="month" defaultValue={month} className="input min-h-9 w-40" />
              <button className="btn-secondary min-h-9">Göster</button>
            </form>
          </div>
          <p className="text-sm">
            Çalışılan <b>{t.workedDays}</b> gün · <b className="tabular-nums">{fmtMin(t.workedMin)}</b> saat · fazla mesai <b className="tabular-nums">{fmtMin(t.overtimeMin)}</b>
            {t.holidayWorkMin > 0 && <> · resmi tatilde <b>{fmtMin(t.holidayWorkMin)}</b></>}
          </p>
          <table className="table-ink mt-3">
            <thead><tr><th>Gün</th><th>Kod</th><th>Giriş</th><th>Çıkış</th><th>Mola</th><th>Çalışılan</th><th>Not</th></tr></thead>
            <tbody>
              {days.map((d) => (
                <tr key={d.id}>
                  <td>{fromDbDate(d.date).slice(8)}</td>
                  <td title={DAY_CODES[d.code]}>{d.code || "—"}</td>
                  <td className="tabular-nums">{d.firstIn ? d.firstIn.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" }) : "—"}</td>
                  <td className="tabular-nums">{d.lastOut ? d.lastOut.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" }) : "—"}</td>
                  <td className="tabular-nums">{d.breakMin} dk</td>
                  <td className="tabular-nums">{fmtMin(d.workedMin)}</td>
                  <td className="text-xs">{d.adjusted ? "düzeltildi" : ""}</td>
                </tr>
              ))}
              {days.length === 0 && <tr><td colSpan={7} className="text-muted">Bu ay için hesaplanmış gün yok (puantaj her gece önceki gün için hesaplanır).</td></tr>}
            </tbody>
          </table>
        </section>

        <section className="card">
          <h2 className="card-title">Yıllık izin</h2>
          <p className="stat-value" data-testid="leave-remaining">{balance.remaining}</p>
          <p className="text-sm text-muted">kalan gün · hak {balance.entitlement} · kullanılan {balance.used} (kıdem {balance.seniorityYears} yıl)</p>
          <p className="mt-3 text-sm">
            <Link href="/hr/leave" className="font-semibold text-teal-ink underline">İzin talebi</Link>
            {can(user, "route.checkin") && <> · <Link href="/hr/my-route" className="font-semibold text-teal-ink underline">Bugünkü rotam</Link></>}
          </p>
          <p className="mt-2 text-xs text-muted">Hak ediş kıdeme göre hesaplanır; İK teyidi gerektirir.</p>
        </section>
      </div>
    </div>
  );
}
