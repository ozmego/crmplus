import Link from "next/link";
import { requirePage } from "@/server/auth/rbac";
import { LOCATION_KINDS, routesWeek } from "@/server/services/field-routes";
import { FinanceForm } from "@/components/finance-form";
import { addDays, fromDbDate, hhmm, istDate, weekStartOf } from "@/lib/hr/time";
import { addLocationAction, addStopAction, cancelStopAction, publishRouteAction } from "../actions";

export const dynamic = "force-dynamic";

const STOP: Record<string, string> = { PLANNED: "Planlandı", DONE: "Yapıldı", SKIPPED: "Yapılamadı", CANCELLED: "İptal" };
const DOW = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];

export default async function RoutesPage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const user = await requirePage("route.manage");
  const sp = await searchParams;
  const weekStart = weekStartOf(/^\d{4}-\d{2}-\d{2}$/.test(sp.week ?? "") ? sp.week! : istDate(new Date()));
  const { employees, locations } = await routesWeek(user, weekStart);
  const dayOpts = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)).map((d, i) => ({ value: d, label: `${DOW[i]} ${d.slice(8)}.${d.slice(5, 7)}` }));

  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="eyebrow">PERSONEL · SAHA ROTALARI</p>
        <h1 className="page-title">Hafta {weekStart}</h1>
        <p className="mt-1 text-sm text-muted">
          Duraklar personelin “Bugünkü rotam” ekranında görünür (yalnız yayınlanmış rota). Misafir yalnız adıyla görünür; iletişim durdurma kaydı olan misafire durak eklenmez. Konum toplanmaz.{" "}
          <Link className="text-teal-ink underline" href={`/hr/routes?week=${addDays(weekStart, -7)}`}>← Önceki</Link> · <Link className="text-teal-ink underline" href={`/hr/routes?week=${addDays(weekStart, 7)}`}>Sonraki →</Link>
        </p>
      </div>

      {employees.length === 0 && <p className="callout-info">Kapsamınızda saha departmanında aktif personel yok.</p>}

      {employees.map((e) => {
        const route = e.routes[0];
        return (
          <section key={e.id} className="card bg-white" data-testid="route-card">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="card-title">{e.firstName} {e.lastName}</h2>
              <span className="pill">{route ? (route.status === "PUBLISHED" ? "Yayında" : "Taslak") : "Rota yok"}</span>
            </div>
            {route && route.stops.length > 0 && (
              <table className="table-ink mt-2">
                <thead><tr><th>Gün</th><th>#</th><th>Saat</th><th>Lokasyon</th><th>Amaç</th><th>Misafir</th><th>Durum</th><th></th></tr></thead>
                <tbody>
                  {route.stops.map((s) => (
                    <tr key={s.id}>
                      <td>{fromDbDate(s.date)}</td>
                      <td>{s.seq}</td>
                      <td className="tabular-nums">{s.plannedMin != null ? hhmm(s.plannedMin) : "—"}</td>
                      <td>{s.location.name}</td>
                      <td>{s.purpose}</td>
                      <td>{s.guestName ?? "—"}</td>
                      <td>
                        {STOP[s.status]}
                        {s.checkInAt && <span className="block text-xs text-muted">{s.checkInAt.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" })}{s.checkOutAt ? `–${s.checkOutAt.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" })}` : ""}</span>}
                        {s.resultNote && <span className="block text-xs text-muted">{s.resultNote}</span>}
                      </td>
                      <td>{s.status === "PLANNED" && <FinanceForm action={cancelStopAction} submit="İptal" tone="secondary" inline fields={[{ name: "stopId", type: "hidden", value: s.id }]} />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <details className="mt-3">
              <summary className="cursor-pointer text-sm font-semibold text-teal-ink">Durak ekle</summary>
              <div className="mt-2">
                {locations.length === 0 ? (
                  <p className="text-sm text-muted">Önce aşağıdan lokasyon ekleyin.</p>
                ) : (
                  <FinanceForm
                    action={addStopAction}
                    submit="Durağı ekle"
                    fields={[
                      { name: "employeeId", type: "hidden", value: e.id },
                      { name: "date", label: "Gün", type: "select", required: true, options: dayOpts },
                      { name: "time", label: "Saat (SS:DD)", placeholder: "14:00" },
                      { name: "locationId", label: "Lokasyon", type: "select", required: true, options: locations.map((l) => ({ value: l.id, label: `${l.name}${l.city ? ` · ${l.city}` : ""}` })) },
                      { name: "purpose", label: "Amaç", required: true, placeholder: "ör. misafir karşılama" },
                      { name: "guestCrmNo", label: "Misafir CRM no (isteğe bağlı)" },
                    ]}
                  />
                )}
              </div>
            </details>
            {route && route.status !== "PUBLISHED" && route.stops.length > 0 && (
              <div className="mt-3"><FinanceForm action={publishRouteAction} submit="Rotayı yayınla" inline fields={[{ name: "routeId", type: "hidden", value: route.id }]} /></div>
            )}
          </section>
        );
      })}

      <section className="card">
        <h2 className="card-title">Lokasyonlar</h2>
        <p className="text-sm">{locations.map((l) => `${l.name} (${LOCATION_KINDS[l.kind as keyof typeof LOCATION_KINDS]})`).join(" · ") || "Henüz lokasyon yok."}</p>
        <div className="mt-3">
          <FinanceForm
            action={addLocationAction}
            submit="Lokasyon ekle"
            inline
            fields={[
              { name: "name", label: "Ad", required: true },
              { name: "kind", label: "Tür", type: "select", required: true, defaultValue: "CASINO", options: Object.entries(LOCATION_KINDS).map(([value, label]) => ({ value, label })) },
              { name: "city", label: "Şehir" },
            ]}
          />
        </div>
      </section>
    </div>
  );
}
