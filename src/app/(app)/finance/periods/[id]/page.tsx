import Link from "next/link";
import { notFound } from "next/navigation";
import { can, requirePage } from "@/server/auth/rbac";
import { db } from "@/server/db";
import { financeView, periodTotals } from "@/server/services/finance";
import { engineForPeriod, engineSettings, financeAnomalies } from "@/server/services/finance-engine";
import { StatementUpload } from "@/components/statement-upload";
import { fromKurus } from "@/lib/commission";
import { FinanceForm } from "@/components/finance-form";
import { applyStatementAction, approveAdjustmentAction, calcTransitionAction, createAdjustmentAction, createCalcAction, lockPeriodAction, reconcileAction } from "../../actions";

export const dynamic = "force-dynamic";

const STATUS: Record<string, { label: string; cls: string }> = {
  DRAFT: { label: "Taslak", cls: "border-line text-muted" },
  IN_REVIEW: { label: "İncelemede", cls: "border-warn text-warn-ink" },
  APPROVED: { label: "Onaylandı", cls: "border-teal-ink text-teal-ink" },
  RECONCILED: { label: "Mutabık kalındı", cls: "border-ink bg-ink text-cream" },
  CANCELLED: { label: "İptal", cls: "border-critical text-critical" },
};
const money = (v: { toString(): string } | number, cur: string) =>
  `${Number(v.toString()).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur}`;

export default async function PeriodDetail({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePage("finance.view");
  const { id } = await params;
  const p = await db.commissionPeriod.findUnique({
    where: { id },
    include: {
      casino: true,
      calculations: { orderBy: { version: "desc" }, include: { adjustments: true } },
      adjustments: { orderBy: { createdAt: "desc" }, include: { calculation: { select: { version: true, period: { select: { period: true } } } } } },
    },
  });
  if (!p) notFound();
  await financeView(user, "period", id);
  const totals = await periodTotals(p.id);
  const [engine, { mode }, anomalies, statements] = await Promise.all([
    engineForPeriod(p.id),
    engineSettings(),
    financeAnomalies(p.id),
    db.casinoStatement.findMany({ where: { casinoId: p.casinoId, period: p.period }, orderBy: { uploadedAt: "desc" } }),
  ]);
  const FINDING: Record<string, string> = { NO_SOURCE_REF: "kaynak referansı yok", DUPLICATE_DAY: "aynı gün birden fazla sonuç", OUTLIER: "dönem medyanının çok üstünde tutar", LATE_ENTRY: "geç girilmiş sonuç" };
  const names = new Map(
    (await db.user.findMany({
      where: { id: { in: [...new Set([...p.calculations.flatMap((c) => [c.preparedBy, c.approvedBy, c.reconciledBy]), ...p.adjustments.flatMap((a) => [a.preparedBy, a.approvedBy])].filter((x): x is string => !!x))] } },
      select: { id: true, name: true },
    })).map((u) => [u.id, u.name]),
  );
  const locked = p.status === "LOCKED";
  const cur = p.casino.currency;
  const dt = (d: Date | null) => (d ? d.toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" }) : "");

  return (
    <div className="flex flex-col gap-5">
      <Link href="/finance" className="text-sm text-teal-ink hover:underline">‹ Dönemler</Link>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">KOMİSYON DÖNEMİ · {p.casino.name}</p>
          <h1 className="page-title font-mono">{p.period}</h1>
          <p className="text-sm text-muted">
            {locked ? `Kilitli · ${dt(p.lockedAt)}` : "Açık"} · {totals.results} sonuç · {totals.guests} misafir · {totals.trips} trip
          </p>
        </div>
        {!locked && can(user, "finance.period.lock") && (
          <FinanceForm action={lockPeriodAction} submit="Dönemi kilitle" tone="danger" inline fields={[{ name: "periodId", type: "hidden", value: p.id }]} />
        )}
      </div>

      <section className="grid gap-3 sm:grid-cols-3">
        <div className="card financial-field"><p className="label">Net misafir kaybı</p><p className="stat-value">{money(totals.netLoss, cur)}</p></div>
        <div className="card financial-field"><p className="label">Rolling</p><p className="stat-value">{money(totals.rolling, cur)}</p></div>
        <div className="card financial-field"><p className="label">Motor hesabı ({mode === "SHADOW" ? "gölge mod" : "birincil"})</p><p className="stat-value" data-testid="engine-total">{money(fromKurus(engine.total), cur)}</p></div>
      </section>

      <section className="card bg-white" data-testid="engine">
        <h2 className="card-title">Komisyon motoru · ayrıntı</h2>
        <p className="text-xs text-muted">
          {mode === "SHADOW"
            ? "Gölge mod: motor sonucu bilgi amaçlıdır; tutarı finans elle girer, fark onayda gerekçe ister."
            : "Birincil mod: tutar boş bırakılırsa motor sonucu kullanılır; elle tutar girilirse fark onayda gerekçe ister."}{" "}
          Kurallar: docs/06 §4.
        </p>
        {engine.warnings.map((w) => <p key={w} className="mt-1 border-l-4 border-warn pl-2 text-sm text-warn-ink">{w}</p>)}
        {engine.versions.map((v) => (
          <details key={v.label} className="mt-3" open>
            <summary className="cursor-pointer text-sm font-semibold">{v.label} · birleştirme {v.combine} · {money(fromKurus(v.total), cur)}{v.combine !== "SUM" && v.chosen.length ? ` (sayılan: ${v.chosen.join(", ")})` : ""}</summary>
            <ul className="mt-2 flex flex-col gap-2 text-sm">
              {v.rules.map((r) => (
                <li key={r.rule} className="rounded-md border border-line p-2">
                  <p><b>{r.rule}</b> · nitelikli misafir {r.qualifyingGuests} · {money(fromKurus(r.total), cur)}{r.capped ? ` (${r.capped === "MAX" ? "tavan" : "taban"} uygulandı, hesap ${money(fromKurus(r.subtotal), cur)})` : ""}</p>
                  <ul className="mt-1 list-disc pl-5 text-xs text-muted">
                    {r.units.slice(0, 20).flatMap((u) => u.lines.map((l, i) => <li key={`${u.key}-${i}`}>{u.key !== "DONEM" ? `CRM-${u.key}: ` : ""}{l}</li>))}
                  </ul>
                </li>
              ))}
            </ul>
          </details>
        ))}
        {Object.keys(engine.carryOut).length > 0 && <p className="mt-2 text-xs text-muted">Sonraki döneme devreden net kazanç: {Object.values(engine.carryOut).flatMap((m) => Object.values(m)).map((k) => money(fromKurus(k), cur)).join(", ")}</p>}
      </section>

      {!locked && can(user, "finance.calc.prepare") && (
        <section className="card">
          <h2 className="card-title">Hesaplama taslağı</h2>
          <FinanceForm
            action={createCalcAction}
            submit="Taslak oluştur"
            fields={[
              { name: "periodId", type: "hidden", value: p.id },
              { name: "amount", label: mode === "SHADOW" ? `Komisyon tutarı (${cur}) — elle; motor: ${money(fromKurus(engine.total), cur)}` : `Komisyon tutarı (${cur}) — boş bırakılırsa motor sonucu`, type: "number", required: mode === "SHADOW" },
              { name: "note", label: "Hesap açıklaması", type: "textarea", required: true, rows: 2, placeholder: "ör. 1M × %10 + 2,2M × %12 = 364.000; 12 nitelikli misafir × 5.000 = 60.000" },
            ]}
          />
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-bold text-ink">Hesaplamalar</h2>
        {p.calculations.length === 0 && <p className="text-sm text-muted">Henüz hesaplama yok.</p>}
        {p.calculations.map((c) => {
          const snap = c.snapshot as { contracts?: { contract: string; version: number }[]; totals?: { netLoss: string; guests: number }; inputs?: unknown[] };
          const st = STATUS[c.status];
          const diff = c.engineAmount ? Number(c.amount.toString()) - Number(c.engineAmount.toString()) : 0;
          const recon = c.reconcileSummary as { clean?: boolean; totalDiff?: string; counts?: { match: number; diff: number; onlyStatement: number; onlyEntered: number }; reason?: string | null } | null;
          return (
            <article key={c.id} className="card bg-white">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-lg font-bold text-ink">Sürüm {c.version} · {money(c.amount, c.currency)} <span className={`pill ml-2 ${st.cls}`}>{st.label}</span></p>
                <p className="text-xs text-muted">
                  Hazırlayan {names.get(c.preparedBy)} · {dt(c.createdAt)}
                  {c.approvedBy && ` · Onaylayan ${names.get(c.approvedBy)} · ${dt(c.approvedAt)}`}
                  {c.reconciledBy && ` · Mutabakat ${c.statementRef} (${names.get(c.reconciledBy)})`}
                </p>
              </div>
              <p className="mt-1 text-sm whitespace-pre-wrap">{c.note}</p>
              {c.engineAmount && (
                <p className={"mt-1 text-sm " + (diff ? "font-semibold text-warn-ink" : "text-teal-ink")} data-testid="calc-diff">
                  {c.method === "ENGINE" ? "Motor sonucu kullanıldı" : `Elle girildi · motor ${money(c.engineAmount, c.currency)}`}{diff ? ` · fark ${money(diff, c.currency)}` : c.method === "MANUAL" ? " · motorla aynı" : ""}
                </p>
              )}
              {recon && (
                <p className={"mt-1 text-sm " + (recon.clean ? "text-teal-ink" : "text-warn-ink")} data-testid="recon-summary">
                  Mutabakat: {recon.clean ? "ekstre ile tam uyumlu" : `fark ${money(recon.totalDiff ?? 0, c.currency)} · ${recon.counts?.diff ?? 0} farklı, ${recon.counts?.onlyStatement ?? 0} yalnız ekstrede, ${recon.counts?.onlyEntered ?? 0} yalnız girilen`}{recon.reason ? ` · gerekçe: ${recon.reason}` : ""}
                </p>
              )}
              <p className="mt-1 text-xs text-muted">
                Anlık görüntü: {snap.contracts?.map((x) => `${x.contract} s${x.version}`).join(", ")} · girdiler {snap.inputs?.length ?? 0} sonuç · net kayıp {snap.totals ? money(snap.totals.netLoss, c.currency) : "—"}
              </p>
              {c.rejectReason && c.status === "DRAFT" && <p className="mt-1 text-xs text-critical">Reddedildi: {c.rejectReason}</p>}
              {c.cancelReason && <p className="mt-1 text-xs text-critical">İptal: {c.cancelReason}</p>}

              {!locked && (
                <div className="mt-3 flex flex-wrap gap-3 border-t border-line pt-3">
                  {c.status === "DRAFT" && can(user, "finance.calc.prepare") && (
                    <FinanceForm action={calcTransitionAction} submit="İncelemeye gönder" inline fields={[{ name: "calcId", type: "hidden", value: c.id }, { name: "action", type: "hidden", value: "SUBMIT" }]} />
                  )}
                  {c.status === "IN_REVIEW" && can(user, "finance.calc.approve") && (
                    <>
                      <FinanceForm action={calcTransitionAction} submit="Onayla" inline fields={[{ name: "calcId", type: "hidden", value: c.id }, { name: "action", type: "hidden", value: "APPROVE" }, ...(diff ? [{ name: "reason", label: "Motorla fark gerekçesi" }] : [])]} />
                      <FinanceForm action={calcTransitionAction} submit="Reddet" tone="secondary" inline fields={[{ name: "calcId", type: "hidden", value: c.id }, { name: "action", type: "hidden", value: "REJECT" }, { name: "reason", label: "Ret gerekçesi" }]} />
                    </>
                  )}
                  {c.status === "APPROVED" && can(user, "finance.calc.approve") && (
                    statements.length ? <FinanceForm action={reconcileAction} submit="Ekstreyle mutabakat" inline fields={[{ name: "calcId", type: "hidden", value: c.id }, { name: "statementId", label: "Casino ekstresi", type: "select", required: true, defaultValue: statements[0].id, options: statements.map((s) => ({ value: s.id, label: `${s.fileName} · ${s.uploadedAt.toLocaleDateString("tr-TR")}` })) }, { name: "reason", label: "Fark varsa gerekçe" }]} /> : <p className="text-xs text-muted">Mutabakat için önce casino ekstresini yükleyin.</p>
                  )}
                  {(c.status === "DRAFT" || c.status === "IN_REVIEW") && can(user, "finance.calc.prepare") && (
                    <FinanceForm action={calcTransitionAction} submit="İptal et" tone="danger" inline fields={[{ name: "calcId", type: "hidden", value: c.id }, { name: "action", type: "hidden", value: "CANCEL" }, { name: "reason", label: "İptal gerekçesi" }]} />
                  )}
                </div>
              )}
              {locked && (c.status === "APPROVED" || c.status === "RECONCILED") && can(user, "finance.adjust") && (
                <div className="mt-3 border-t border-line pt-3">
                  <p className="mb-2 text-xs text-muted">Dönem kilitli. Düzeltme, sonraki ilk açık dönemde yeni kayıt olarak işlenir; bu hesap değişmez.</p>
                  <FinanceForm action={createAdjustmentAction} submit="Düzeltme kaydı oluştur" inline fields={[{ name: "calculationId", type: "hidden", value: c.id }, { name: "amount", label: `Tutar (± ${cur})`, type: "number" }, { name: "reason", label: "Gerekçe" }]} />
                </div>
              )}
            </article>
          );
        })}
      </section>

      <section className="card" data-testid="statements">
        <h2 className="card-title">Casino ekstresi ve kaynak dosyalar</h2>
        {statements.length === 0 && <p className="text-sm text-muted">Bu dönem için ekstre yüklenmedi.</p>}
        <ul className="flex flex-col gap-2 text-sm">
          {statements.map((s) => {
            const t = s.totals as { netLoss: string; lines: number; matched: number; unmatched: number };
            return (
              <li key={s.id} className="flex flex-wrap items-center gap-3 rounded-md border border-line bg-white p-2">
                <Link href={`/finance/statements/${s.id}`} className="font-semibold text-teal-ink underline">{s.fileName}</Link>
                <span>{t.lines} satır · eşleşen {t.matched} · eşleşmeyen {t.unmatched} · net kayıp {money(t.netLoss, s.currency)}</span>
                <span className="font-mono text-xs text-muted">sha256 {s.sha256.slice(0, 12)}…</span>
                <span className="pill">{s.status === "APPLIED" ? "Sonuç olarak işlendi" : "Yüklendi"}</span>
                {s.status === "IMPORTED" && !locked && can(user, "finance.result.edit") && s.uploadedBy !== user.id && (
                  <FinanceForm action={applyStatementAction} submit="Sonuç olarak işle" tone="secondary" inline fields={[{ name: "statementId", type: "hidden", value: s.id }]} />
                )}
              </li>
            );
          })}
        </ul>
        {!locked && can(user, "finance.result.edit") && <div className="mt-3"><StatementUpload casinoId={p.casinoId} period={p.period} /></div>}
      </section>

      <section className="card" data-testid="anomalies">
        <h2 className="card-title">Kontrol bulguları (inceleme için)</h2>
        <p className="text-xs text-muted">Veri kalitesi ve süreç kontrolü içindir; misafir hedeflemesi veya personel değerlendirmesinde kullanılmaz.</p>
        {anomalies.findings.length === 0 && anomalies.engineDiffs.length === 0 ? (
          <p className="text-sm text-teal-ink">Bulgu yok.</p>
        ) : (
          <ul className="mt-2 list-disc pl-5 text-sm">
            {anomalies.findings.slice(0, 50).map((x, i) => <li key={i}>CRM-{String(x.crmNo).padStart(6, "0")}: {FINDING[x.kind]}{x.kind === "LATE_ENTRY" ? ` (${x.days} gün sonra)` : x.kind === "DUPLICATE_DAY" ? ` (${x.playedOn}, ${x.resultIds.length} kayıt)` : ""}</li>)}
            {anomalies.engineDiffs.map((d) => <li key={d.calcId}>Hesap sürüm {d.version}: elle {money(d.amount, cur)} · motor {money(d.engineAmount, cur)}</li>)}
          </ul>
        )}
      </section>

      {p.adjustments.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-bold text-ink">Bu döneme işlenen düzeltmeler</h2>
          {p.adjustments.map((a) => (
            <div key={a.id} className="card flex flex-wrap items-center justify-between gap-3 bg-white">
              <p className="text-sm">
                <b>{money(a.amount, a.currency)}</b> · {a.calculation.period.period} dönemi sürüm {a.calculation.version} için · {a.reason} ·{" "}
                <span className="text-muted">hazırlayan {names.get(a.preparedBy)}{a.approvedBy ? ` · onaylayan ${names.get(a.approvedBy)}` : ""}</span>{" "}
                <span className={`pill ${a.status === "APPROVED" ? "border-teal-ink text-teal-ink" : "border-warn text-warn-ink"}`}>{a.status === "APPROVED" ? "Onaylandı" : "Onay bekliyor"}</span>
              </p>
              {a.status === "DRAFT" && !locked && can(user, "finance.calc.approve") && (
                <FinanceForm action={approveAdjustmentAction} submit="Düzeltmeyi onayla" inline fields={[{ name: "adjustmentId", type: "hidden", value: a.id }]} />
              )}
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
