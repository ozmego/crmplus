import { can, requirePage } from "@/server/auth/rbac";
import { db } from "@/server/db";
import { financeView } from "@/server/services/finance";
import { FinanceForm } from "@/components/finance-form";
import { addVersionAction, createCasinoAction } from "../actions";

export const dynamic = "force-dynamic";

const EXAMPLE = JSON.stringify(
  [
    {
      name: "Net kayıp kademeli",
      basis: "NET_LOSS",
      scope: "PERIOD_TOTAL",
      tierMode: "MARGINAL",
      tiers: [{ from: 0, to: 1000000, rate: 0.1 }, { from: 1000000, to: 5000000, rate: 0.12 }, { from: 5000000, to: null, rate: 0.15 }],
      min: null,
      max: null,
      currency: "TRY",
      priority: 1,
      netWinBehavior: "CARRY_OVER",
    },
  ],
  null,
  1,
);

type Rule = { name: string; basis: string; scope: string; tierMode: string; tiers: { from: number; to: number | null; rate?: number; amount?: number }[]; currency: string; netWinBehavior: string; min: number | null; max: number | null };
const BASIS: Record<string, string> = { NET_LOSS: "Net kayıp", ROLLING: "Rolling", GUEST_COUNT: "Misafir sayısı", TRIP_COUNT: "Trip sayısı" };
const SCOPE: Record<string, string> = { PER_GUEST: "misafir başı", PER_TRIP: "trip başı", PERIOD_TOTAL: "dönem toplamı" };
const NETWIN: Record<string, string> = { ZERO: "sıfırla", CARRY_OVER: "sonraki döneme devret", NEGATIVE: "negatif komisyon" };

export default async function ContractsPage() {
  const user = await requirePage("finance.view");
  await financeView(user, "contracts");
  const casinos = await db.casino.findMany({
    orderBy: { name: "asc" },
    include: { contracts: { include: { versions: { orderBy: { version: "desc" } } } } },
  });
  const canManage = can(user, "finance.contract.manage");

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="eyebrow">FİNANS</p>
        <h1 className="page-title">Casinolar ve sözleşmeler</h1>
        <p className="mt-1 text-sm text-muted">Sözleşmeler sürümlüdür; yeni sürüm öncekini kapatır, geçmiş hesaplar kendi sürümünü korur. Kural modeli: docs/06 §4.</p>
      </div>

      {canManage && (
        <section className="card">
          <h2 className="card-title">Casino ekle</h2>
          <FinanceForm
            action={createCasinoAction}
            submit="Ekle"
            fields={[
              { name: "name", label: "Ad", required: true },
              { name: "country", label: "Ülke kodu", placeholder: "TR" },
              { name: "currency", label: "Para birimi", required: true, defaultValue: "TRY" },
            ]}
          />
        </section>
      )}

      {casinos.map((c) => (
        <section key={c.id} className="card bg-white">
          <h2 className="text-lg font-bold text-ink">{c.name} <span className="text-sm font-normal text-muted">· {c.country ?? "—"} · {c.currency}</span></h2>
          {c.contracts.length === 0 && <p className="text-sm text-muted">Sözleşme yok.</p>}
          {c.contracts.map((ct) => (
            <div key={ct.id} className="mt-3 flex flex-col gap-2">
              <h3 className="font-semibold text-teal-ink">{ct.name}</h3>
              {ct.versions.map((v) => {
                const rules = v.rules as unknown as Rule[];
                return (
                  <div key={v.id} className="rounded-md border border-line p-3 text-sm">
                    <p className="font-semibold">
                      Sürüm {v.version} · {v.validFrom.toLocaleDateString("tr-TR", { timeZone: "Europe/Istanbul" })} – {v.validTo ? v.validTo.toLocaleDateString("tr-TR", { timeZone: "Europe/Istanbul" }) : "açık uçlu"} · birleştirme: {v.combine}
                    </p>
                    <ul className="mt-1 list-disc pl-5">
                      {rules.map((r, i) => (
                        <li key={i}>
                          <b>{r.name}</b>: {BASIS[r.basis]} · {SCOPE[r.scope]} · {r.tierMode === "MARGINAL" ? "marjinal" : "toplam"} kademe ·{" "}
                          {r.tiers.map((t) => `${t.from.toLocaleString("tr-TR")}–${t.to === null ? "∞" : t.to.toLocaleString("tr-TR")}: ${t.rate !== undefined ? `%${(t.rate * 100).toLocaleString("tr-TR")}` : `${t.amount?.toLocaleString("tr-TR")} ${r.currency}`}`).join(" · ")}
                          {r.min !== null ? ` · taban ${r.min}` : ""}{r.max !== null ? ` · tavan ${r.max}` : ""} · net kazançta: {NETWIN[r.netWinBehavior]}
                        </li>
                      ))}
                    </ul>
                    {v.note && <p className="mt-1 text-xs text-muted">{v.note}</p>}
                  </div>
                );
              })}
            </div>
          ))}
          {canManage && (
            <details className="mt-4">
              <summary className="cursor-pointer text-sm font-semibold text-teal-ink">Sözleşme veya yeni sürüm ekle</summary>
              <div className="mt-3">
                <FinanceForm
                  action={addVersionAction}
                  submit="Sürümü kaydet"
                  fields={[
                    { name: "casinoId", type: "hidden", value: c.id },
                    { name: "contractId", label: "Mevcut sözleşme (boşsa yeni)", type: "select", options: c.contracts.map((ct) => ({ value: ct.id, label: ct.name })) },
                    { name: "contractName", label: "Yeni sözleşme adı", placeholder: "ör. 2026 ana sözleşme" },
                    { name: "validFrom", label: "Geçerlilik başlangıcı", type: "date", required: true },
                    { name: "validTo", label: "Geçerlilik bitişi (boş = açık uçlu)", type: "date" },
                    { name: "combine", label: "Bileşenleri birleştirme", type: "select", required: true, defaultValue: "SUM", options: [{ value: "SUM", label: "Topla" }, { value: "MAX", label: "En yükseği" }, { value: "PRIORITY", label: "Öncelik sırası" }] },
                    { name: "note", label: "Not" },
                    { name: "rules", label: "Kural bileşenleri (docs/06 §4 biçimi)", type: "textarea", required: true, defaultValue: EXAMPLE, rows: 12 },
                  ]}
                />
              </div>
            </details>
          )}
        </section>
      ))}
    </div>
  );
}
