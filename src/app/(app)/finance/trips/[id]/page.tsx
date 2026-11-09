import Link from "next/link";
import { notFound } from "next/navigation";
import { can, requirePage } from "@/server/auth/rbac";
import { db } from "@/server/db";
import { financeView } from "@/server/services/finance";
import { FinanceForm } from "@/components/finance-form";
import { addResultAction, addTripGuestAction } from "../../actions";

export const dynamic = "force-dynamic";
const n = (v: { toString(): string } | null) => (v === null ? "—" : Number(v.toString()).toLocaleString("tr-TR", { minimumFractionDigits: 2 }));

export default async function TripDetail({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePage("finance.view");
  const { id } = await params;
  const trip = await db.trip.findUnique({
    where: { id },
    include: {
      casino: true,
      guests: { orderBy: { guestName: "asc" }, include: { results: { orderBy: { playedOn: "asc" }, include: { period: { select: { id: true, period: true, status: true } } } } } },
    },
  });
  if (!trip) notFound();
  await financeView(user, "trip", id);
  const edit = can(user, "finance.result.edit");

  return (
    <div className="flex flex-col gap-5">
      <Link href="/finance/trips" className="text-sm text-teal-ink hover:underline">‹ Tripler</Link>
      <div>
        <p className="eyebrow">TRIP · {trip.casino.name}</p>
        <h1 className="page-title">{trip.name}</h1>
        <p className="text-sm text-muted">
          {trip.startDate.toLocaleDateString("tr-TR", { timeZone: "Europe/Istanbul" })} – {trip.endDate.toLocaleDateString("tr-TR", { timeZone: "Europe/Istanbul" })} · para birimi {trip.casino.currency}
        </p>
      </div>

      {edit && (
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="card">
            <h2 className="card-title">Misafir ekle</h2>
            <FinanceForm action={addTripGuestAction} submit="Ekle" inline fields={[{ name: "tripId", type: "hidden", value: trip.id }, { name: "crmNo", label: "CRM no", required: true, placeholder: "CRM-000123" }]} />
          </section>
          <section className="card">
            <h2 className="card-title">Oyun sonucu gir</h2>
            <FinanceForm
              action={addResultAction}
              submit="Kaydet"
              fields={[
                { name: "tripGuestId", label: "Misafir", type: "select", required: true, options: trip.guests.map((g) => ({ value: g.id, label: `CRM-${String(g.crmNo).padStart(6, "0")} ${g.guestName}` })) },
                { name: "playedOn", label: "Tarih", type: "date", required: true },
                { name: "netLoss", label: "Net kayıp (+) / kazanç (−)", type: "number", required: true },
                { name: "rolling", label: "Rolling", type: "number" },
                { name: "buyIn", label: "Buy-in", type: "number" },
                { name: "cashOut", label: "Cash-out", type: "number" },
                { name: "source", label: "Kaynak", type: "select", defaultValue: "MANUAL", options: [{ value: "MANUAL", label: "Elle giriş" }, { value: "STATEMENT", label: "Casino ekstresi" }] },
                { name: "sourceRef", label: "Kaynak referansı", placeholder: "ekstre no / belge" },
              ]}
            />
          </section>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="table-ink min-w-[900px]">
          <thead>
            <tr><th scope="col">Misafir</th><th scope="col">Tarih</th><th scope="col">Dönem</th><th scope="col">Net kayıp</th><th scope="col">Rolling</th><th scope="col">Buy-in / cash-out</th><th scope="col">Kaynak</th></tr>
          </thead>
          <tbody className="tabular-nums">
            {trip.guests.length === 0 && <tr><td colSpan={7} className="py-6 text-center text-muted">Misafir yok.</td></tr>}
            {trip.guests.map((g) =>
              (g.results.length ? g.results : [null]).map((r, i) => (
                <tr key={`${g.id}-${r?.id ?? i}`}>
                  <td>{i === 0 ? `CRM-${String(g.crmNo).padStart(6, "0")} ${g.guestName}` : ""}</td>
                  <td>{r ? r.playedOn.toLocaleDateString("tr-TR", { timeZone: "Europe/Istanbul" }) : "—"}</td>
                  <td>{r ? <Link href={`/finance/periods/${r.period.id}`} className="text-teal-ink hover:underline">{r.period.period}{r.period.status === "LOCKED" ? " (kilitli)" : ""}</Link> : "—"}</td>
                  <td className={r && Number(r.netLoss.toString()) < 0 ? "text-critical" : ""}>{r ? n(r.netLoss) : "—"}</td>
                  <td>{r ? n(r.rolling) : "—"}</td>
                  <td>{r ? `${n(r.buyIn)} / ${n(r.cashOut)}` : "—"}</td>
                  <td className="text-xs">{r ? `${r.source === "STATEMENT" ? "Ekstre" : "Elle"}${r.sourceRef ? ` · ${r.sourceRef}` : ""}` : ""}</td>
                </tr>
              )),
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
