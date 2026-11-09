import Link from "next/link";
import { notFound } from "next/navigation";
import { can, requirePage } from "@/server/auth/rbac";
import { db } from "@/server/db";
import { financeView, periodTotals } from "@/server/services/finance";
import { FinanceForm } from "@/components/finance-form";
import { approveAdjustmentAction, calcTransitionAction, createAdjustmentAction, createCalcAction, lockPeriodAction } from "../../actions";

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
        <div className="card"><p className="label">Hesaplama yöntemi</p><p className="text-sm">Aşama 1: tutar elle girilir; sözleşme sürümü ve girdiler hesapla birlikte değiştirilemez biçimde saklanır.</p></div>
      </section>

      {!locked && can(user, "finance.calc.prepare") && (
        <section className="card">
          <h2 className="card-title">Hesaplama taslağı</h2>
          <FinanceForm
            action={createCalcAction}
            submit="Taslak oluştur"
            fields={[
              { name: "periodId", type: "hidden", value: p.id },
              { name: "amount", label: `Komisyon tutarı (${cur})`, type: "number", required: true },
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
              <p className="mt-1 text-sm">{c.note}</p>
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
                      <FinanceForm action={calcTransitionAction} submit="Onayla" inline fields={[{ name: "calcId", type: "hidden", value: c.id }, { name: "action", type: "hidden", value: "APPROVE" }]} />
                      <FinanceForm action={calcTransitionAction} submit="Reddet" tone="secondary" inline fields={[{ name: "calcId", type: "hidden", value: c.id }, { name: "action", type: "hidden", value: "REJECT" }, { name: "reason", label: "Ret gerekçesi" }]} />
                    </>
                  )}
                  {c.status === "APPROVED" && can(user, "finance.calc.approve") && (
                    <FinanceForm action={calcTransitionAction} submit="Mutabık kalındı" inline fields={[{ name: "calcId", type: "hidden", value: c.id }, { name: "action", type: "hidden", value: "RECONCILE" }, { name: "statementRef", label: "Casino ekstresi referansı" }]} />
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
