import Link from "next/link";
import { can, requirePage } from "@/server/auth/rbac";
import { engineSettings } from "@/server/services/finance-engine";
import { FinanceForm } from "@/components/finance-form";
import { engineModeAction } from "./actions";
import { StatementUpload } from "@/components/statement-upload";
import { db } from "@/server/db";
import { financeView } from "@/server/services/finance";

export const dynamic = "force-dynamic";

const STATUS: Record<string, string> = { DRAFT: "Taslak", IN_REVIEW: "İncelemede", APPROVED: "Onaylandı", RECONCILED: "Mutabık", CANCELLED: "İptal" };
const fmt = (v: { toString(): string } | null | undefined, cur: string) =>
  v === null || v === undefined ? "—" : `${Number(v.toString()).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur}`;

export default async function FinanceHome() {
  const user = await requirePage("finance.view");
  await financeView(user, "periods");
  const periods = await db.commissionPeriod.findMany({
    orderBy: [{ period: "desc" }],
    include: {
      casino: { select: { name: true, currency: true } },
      calculations: { orderBy: { version: "desc" }, select: { status: true, amount: true, version: true } },
      adjustments: { where: { status: "APPROVED" }, select: { amount: true } },
      _count: { select: { results: true } },
    },
    take: 100,
  });
  const sums = await db.gamingResult.groupBy({ by: ["periodId"], where: { periodId: { in: periods.map((p) => p.id) } }, _sum: { netLoss: true } });
  const net = new Map(sums.map((s) => [s.periodId, s._sum.netLoss]));
  const { mode } = await engineSettings();
  const casinos = await db.casino.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } });
  const statements = await db.casinoStatement.findMany({ orderBy: { uploadedAt: "desc" }, take: 10 });
  const casinoName = new Map(casinos.map((x) => [x.id, x.name]));

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="eyebrow">FİNANS</p>
        <h1 className="page-title">Komisyon dönemleri</h1>
        <p className="mt-1 text-sm text-muted">Dönem, bir casino için bir aydır. Oyun sonucu girildiğinde ilgili dönem kendiliğinden açılır.</p>
      </div>
      <section className="card flex flex-wrap items-center justify-between gap-3" data-testid="engine-mode">
        <p className="text-sm">
          Komisyon motoru: <b>{mode === "SHADOW" ? "Gölge mod" : "Birincil"}</b> — {mode === "SHADOW" ? "tutar elle girilir, motor sonucu yanında gösterilir ve fark onayda gerekçe ister." : "tutar boş bırakılırsa motor sonucu kullanılır."} Birincil moda geçiş, gölge moddaki hesapların motorla uyumu doğrulandıktan sonra yapılmalıdır.
        </p>
        {can(user, "finance.calc.approve") && (
          <FinanceForm action={engineModeAction} submit={mode === "SHADOW" ? "Birincil moda geç" : "Gölge moda dön"} tone="secondary" inline fields={[{ name: "mode", type: "hidden", value: mode === "SHADOW" ? "PRIMARY" : "SHADOW" }, { name: "reason", label: "Gerekçe", required: true }]} />
        )}
      </section>
      {can(user, "finance.result.edit") && casinos.length > 0 && (
        <details className="card">
          <summary className="cursor-pointer card-title">Casino ekstresi yükle</summary>
          <div className="mt-3"><StatementUpload casinos={casinos} /></div>
          {statements.length > 0 && (
            <ul className="mt-3 text-sm" data-testid="recent-statements">
              {statements.map((s) => <li key={s.id}><Link href={`/finance/statements/${s.id}`} className="text-teal-ink underline">{s.fileName}</Link> · {casinoName.get(s.casinoId)} · {s.period} · {s.status === "APPLIED" ? "işlendi" : "yüklendi"}</li>)}
            </ul>
          )}
        </details>
      )}
      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="table-ink min-w-[900px]">
          <thead>
            <tr>
              <th scope="col">Casino</th><th scope="col">Dönem</th><th scope="col">Durum</th><th scope="col">Sonuç</th>
              <th scope="col">Net misafir kaybı</th><th scope="col">Son hesaplama</th><th scope="col">Onaylı düzeltme</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {periods.length === 0 && <tr><td colSpan={7} className="py-6 text-center text-muted">Henüz dönem yok. Bir trip oluşturup oyun sonucu girin.</td></tr>}
            {periods.map((p) => {
              const last = p.calculations.find((c) => c.status !== "CANCELLED");
              const adj = p.adjustments.reduce((s, a) => s + Number(a.amount.toString()), 0);
              return (
                <tr key={p.id}>
                  <td className="font-semibold">{p.casino.name}</td>
                  <td><Link href={`/finance/periods/${p.id}`} className="font-mono text-teal-ink hover:underline">{p.period}</Link></td>
                  <td>{p.status === "LOCKED" ? <span className="pill border-ink text-ink">Kilitli</span> : <span className="pill border-teal-ink text-teal-ink">Açık</span>}</td>
                  <td>{p._count.results}</td>
                  <td>{fmt(net.get(p.id), p.casino.currency)}</td>
                  <td>{last ? `${fmt(last.amount, p.casino.currency)} · ${STATUS[last.status]} (s${last.version})` : "—"}</td>
                  <td>{adj ? fmt(adj, p.casino.currency) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
