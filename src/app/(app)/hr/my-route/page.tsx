import { requirePage } from "@/server/auth/rbac";
import { myStops } from "@/server/services/field-routes";
import { FinanceForm } from "@/components/finance-form";
import { hhmm } from "@/lib/hr/time";
import { stopActionAction } from "../actions";

export const dynamic = "force-dynamic";

const t = (d: Date) => d.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" });

/** Mobil uyumlu: tek sütun, büyük düğmeler. Konum toplanmaz; saat sunucuda yazılır. */
export default async function MyRoutePage() {
  const user = await requirePage("route.checkin");
  const r = await myStops(user);
  if (!r) return <p className="callout-info">Personel kaydınız yok; İK ile görüşün.</p>;

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-4">
      <div>
        <p className="eyebrow">BUGÜNKÜ ROTAM · {r.date}</p>
        <h1 className="page-title">{r.stops.length} durak</h1>
        <p className="mt-1 text-sm text-muted">“Vardım” ve “Ayrıldım” saatleri puantajınıza saha günü olarak işlenir. Konum bilgisi toplanmaz.</p>
      </div>
      {r.stops.length === 0 && <p className="callout-info">Bugün için yayınlanmış durak yok.</p>}
      {r.stops.map((s) => (
        <section key={s.id} className="card bg-white" data-testid="stop">
          <p className="text-xs font-semibold text-muted">#{s.seq}{s.plannedMin != null ? ` · ${hhmm(s.plannedMin)}` : ""}</p>
          <h2 className="text-lg font-bold text-ink">{s.location.name}</h2>
          <p className="text-sm">{s.purpose}{s.guestName ? ` · Misafir: ${s.guestName}` : ""}</p>
          <p className="mt-1 text-sm" data-testid="stop-status">
            {s.status === "DONE" ? `Yapıldı · ${t(s.checkInAt!)}–${t(s.checkOutAt!)}` : s.status === "SKIPPED" ? `Yapılamadı · ${s.resultNote}` : s.status === "CANCELLED" ? "İptal edildi" : s.checkInAt ? `Varış ${t(s.checkInAt)}` : "Bekliyor"}
          </p>
          {s.status === "PLANNED" && !s.checkInAt && (
            <div className="mt-3 flex flex-col gap-3">
              <FinanceForm action={stopActionAction} submit="Vardım" fields={[{ name: "stopId", type: "hidden", value: s.id }, { name: "action", type: "hidden", value: "IN" }]} />
              <details>
                <summary className="cursor-pointer text-sm font-semibold text-critical">Yapılamadı</summary>
                <div className="mt-2"><FinanceForm action={stopActionAction} submit="Yapılamadı olarak işaretle" tone="danger" fields={[{ name: "stopId", type: "hidden", value: s.id }, { name: "action", type: "hidden", value: "SKIP" }, { name: "note", label: "Neden", required: true }]} /></div>
              </details>
            </div>
          )}
          {s.status === "PLANNED" && s.checkInAt && (
            <div className="mt-3">
              <FinanceForm action={stopActionAction} submit="Ayrıldım" fields={[{ name: "stopId", type: "hidden", value: s.id }, { name: "action", type: "hidden", value: "OUT" }, { name: "note", label: "Sonuç notu (isteğe bağlı)" }]} />
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
