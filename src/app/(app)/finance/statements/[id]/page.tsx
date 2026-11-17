import Link from "next/link";
import { notFound } from "next/navigation";
import { can, requirePage } from "@/server/auth/rbac";
import { FinanceForm } from "@/components/finance-form";
import { applyStatementAction } from "../../actions";
import { db } from "@/server/db";
import { financeView } from "@/server/services/finance";
import { reconciliation } from "@/server/services/finance-engine";
import { fromKurus } from "@/lib/commission";

export const dynamic = "force-dynamic";

const MATCH: Record<string, string> = { MATCHED: "Eşleşti", UNMATCHED: "Misafir bulunamadı", NOT_IN_TRIP: "Dönem tripinde yok", INVALID: "Geçersiz satır" };
const STATUS: Record<string, string> = { MATCH: "Uyumlu", DIFF: "Fark var", ONLY_STATEMENT: "Yalnız ekstrede", ONLY_ENTERED: "Yalnız girilen" };
const money = (v: { toString(): string } | number | null, cur: string) => (v === null ? "—" : `${Number(v.toString()).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur}`);

export default async function StatementPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePage("finance.view");
  const { id } = await params;
  const st = await db.casinoStatement.findUnique({ where: { id }, include: { lines: { orderBy: { rowNo: "asc" } } } });
  if (!st) notFound();
  await financeView(user, "statement", id);
  const casino = await db.casino.findUniqueOrThrow({ where: { id: st.casinoId } });
  const period = await db.commissionPeriod.findUnique({ where: { casinoId_period: { casinoId: st.casinoId, period: st.period } } });
  const rec = period ? await reconciliation(period.id, st.id) : null;
  const t = st.totals as { mapping: Record<string, string>; invertSign: boolean };
  const cur = st.currency;

  return (
    <div className="flex flex-col gap-5">
      {period && <Link href={`/finance/periods/${period.id}`} className="text-sm text-teal-ink hover:underline">‹ {casino.name} · {st.period}</Link>}
      <div>
        <p className="eyebrow">CASİNO EKSTRESİ · {casino.name} · {st.period}</p>
        <h1 className="page-title">{st.fileName}</h1>
        <p className="mt-1 text-sm text-muted">
          SHA-256 <span className="font-mono">{st.sha256}</span> · yüklenme {st.uploadedAt.toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" })} · sütun eşleme: {Object.entries(t.mapping).map(([k, v]) => `${k}=“${v}”`).join(", ")}{t.invertSign ? " · işaret çevrildi" : ""} · {st.status === "APPLIED" ? "sonuç olarak işlendi" : "henüz işlenmedi"}
        </p>
        {/* Dönemde henüz sonuç yoksa dönem sayfası da yoktur; ekstre buradan işlenir ve dönemi açar */}
        {st.status === "IMPORTED" && can(user, "finance.result.edit") && period?.status !== "LOCKED" && (
          st.uploadedBy === user.id ? (
            <p className="mt-2 text-sm text-muted">Ekstreyi yükleyen kişi sonuç olarak işleyemez (iki kişili kontrol).</p>
          ) : (
            <div className="mt-3"><FinanceForm action={applyStatementAction} submit="Sonuç olarak işle" inline fields={[{ name: "statementId", type: "hidden", value: st.id }]} /></div>
          )
        )}
        {period && <p className="mt-2 text-sm"><Link href={`/finance/periods/${period.id}`} className="font-semibold text-teal-ink underline">Dönem sayfası</Link></p>}
      </div>

      {rec && (
        <section className="card" data-testid="reconciliation">
          <h2 className="card-title">Mutabakat · ekstre ↔ girilen sonuçlar (misafir bazında)</h2>
          <p className="text-sm">
            Ekstre {money(fromKurus(rec.statementTotal), cur)} · girilen (bu ekstreden işlenenler hariç) {money(fromKurus(rec.enteredTotal), cur)} · fark <b>{money(fromKurus(rec.totalDiff), cur)}</b> ·
            uyumlu {rec.counts.match} · farklı {rec.counts.diff} · yalnız ekstrede {rec.counts.onlyStatement} · yalnız girilen {rec.counts.onlyEntered} · eşleşmeyen satır {rec.unmatchedLines}
          </p>
          <table className="table-ink mt-3">
            <thead><tr><th>CRM</th><th>Misafir</th><th>Ekstre</th><th>Girilen</th><th>Fark</th><th>Durum</th></tr></thead>
            <tbody>
              {rec.rows.map((r) => (
                <tr key={r.key} className={r.status === "MATCH" ? undefined : "bg-warn-bg"}>
                  <td>CRM-{r.key.padStart(6, "0")}</td>
                  <td>{r.name}</td>
                  <td className="tabular-nums">{r.statementNetLoss === null ? "—" : money(fromKurus(r.statementNetLoss), cur)}</td>
                  <td className="tabular-nums">{r.enteredNetLoss === null ? "—" : money(fromKurus(r.enteredNetLoss), cur)}</td>
                  <td className="tabular-nums">{money(fromKurus(r.diff), cur)}</td>
                  <td>{STATUS[r.status]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="card bg-white">
        <h2 className="card-title">Satırlar ({st.lines.length})</h2>
        <table className="table-ink" data-testid="statement-lines">
          <thead><tr><th>Satır</th><th>CRM / oyuncu</th><th>Ad</th><th>Tarih</th><th>Net kayıp</th><th>Rolling</th><th>Eşleme</th></tr></thead>
          <tbody>
            {st.lines.map((l) => (
              <tr key={l.id} className={l.match === "MATCHED" ? undefined : "bg-warn-bg"}>
                <td>{l.rowNo}</td>
                <td>{l.crmNo ? `CRM-${String(l.crmNo).padStart(6, "0")}` : l.playerRef ?? "—"}</td>
                <td>{l.name ?? "—"}</td>
                <td>{l.playedOn ? l.playedOn.toLocaleDateString("tr-TR", { timeZone: "Europe/Istanbul" }) : "—"}</td>
                <td className="tabular-nums">{money(l.netLoss, cur)}</td>
                <td className="tabular-nums">{money(l.rolling, cur)}</td>
                <td>{MATCH[l.match]}{l.issue ? ` · ${l.issue}` : ""}{l.resultId ? " · işlendi" : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
