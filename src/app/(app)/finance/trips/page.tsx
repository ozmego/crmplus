import Link from "next/link";
import { can, requirePage } from "@/server/auth/rbac";
import { db } from "@/server/db";
import { financeView } from "@/server/services/finance";
import { FinanceForm } from "@/components/finance-form";
import { createTripAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function TripsPage() {
  const user = await requirePage("finance.view");
  await financeView(user, "trips");
  const [trips, casinos] = await Promise.all([
    db.trip.findMany({ orderBy: { startDate: "desc" }, include: { casino: { select: { name: true } }, _count: { select: { guests: true } } }, take: 100 }),
    db.casino.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const d = (x: Date) => x.toLocaleDateString("tr-TR", { timeZone: "Europe/Istanbul" });

  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="eyebrow">FİNANS</p>
        <h1 className="page-title">Tripler ve oyun sonuçları</h1>
      </div>
      {can(user, "finance.result.edit") && (
        <section className="card">
          <h2 className="card-title">Trip oluştur</h2>
          <FinanceForm
            action={createTripAction}
            submit="Oluştur"
            fields={[
              { name: "casinoId", label: "Casino", type: "select", required: true, options: casinos.map((c) => ({ value: c.id, label: c.name })) },
              { name: "name", label: "Ad", required: true, placeholder: "ör. Aralık Kıbrıs grubu" },
              { name: "startDate", label: "Başlangıç", type: "date", required: true },
              { name: "endDate", label: "Bitiş", type: "date", required: true },
            ]}
          />
        </section>
      )}
      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="table-ink min-w-[700px]">
          <thead><tr><th scope="col">Trip</th><th scope="col">Casino</th><th scope="col">Tarih</th><th scope="col">Misafir</th></tr></thead>
          <tbody>
            {trips.length === 0 && <tr><td colSpan={4} className="py-6 text-center text-muted">Trip yok.</td></tr>}
            {trips.map((t) => (
              <tr key={t.id}>
                <td><Link href={`/finance/trips/${t.id}`} className="font-semibold text-teal-ink hover:underline">{t.name}</Link></td>
                <td>{t.casino.name}</td>
                <td>{d(t.startDate)} – {d(t.endDate)}</td>
                <td>{t._count.guests}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
