import { can, requirePage } from "@/server/auth/rbac";
import { db } from "@/server/db";
import { leaveLists } from "@/server/services/leave";
import { FinanceForm } from "@/components/finance-form";
import { fromDbDate, istDate } from "@/lib/hr/time";
import { addHolidayAction, leaveDecisionAction, requestLeaveAction } from "../actions";

export const dynamic = "force-dynamic";

const STATUS: Record<string, string> = { REQUESTED: "Talep edildi", PRE_APPROVED: "Ön onaylı", APPROVED: "Onaylandı", REJECTED: "Reddedildi", CANCELLED: "Geri çekildi" };

type L = Awaited<ReturnType<typeof leaveLists>>["mine"][number];
const range = (l: L) => `${fromDbDate(l.startDate)}${l.endDate.getTime() !== l.startDate.getTime() ? ` – ${fromDbDate(l.endDate)}` : ""}${l.halfDay ? " (yarım gün)" : ""}`;

export default async function LeavePage() {
  const user = await requirePage("leave.request");
  const [{ employee, mine, toPre, toApprove }, types, holidays] = await Promise.all([
    leaveLists(user),
    db.leaveType.findMany({ orderBy: { code: "asc" } }),
    db.publicHoliday.findMany({ where: { date: { gte: new Date(`${istDate(new Date()).slice(0, 4)}-01-01`) } }, orderBy: { date: "asc" } }),
  ]);
  const approveIds = new Set(toApprove.map((l) => l.id));
  const queue = [...toApprove, ...toPre.filter((l) => !approveIds.has(l.id))];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="eyebrow">PERSONEL · İZİNLER</p>
        <h1 className="page-title">İzinler</h1>
        <p className="mt-1 text-sm text-muted">Talep → takım lideri ön onayı → İK onayı. Raporlu izinde yalnız belge referansı girilir; teşhis veya sağlık bilgisi yazmayın.</p>
      </div>

      {employee ? (
        <section className="card">
          <h2 className="card-title">Yeni izin talebi</h2>
          <FinanceForm
            action={requestLeaveAction}
            submit="Talep gönder"
            fields={[
              { name: "typeCode", label: "İzin türü", type: "select", required: true, options: types.map((t) => ({ value: t.code, label: `${t.name}${t.paid ? "" : " (ücretsiz)"}${t.needsDocument ? " · belge gerekir" : ""}` })) },
              { name: "from", label: "Başlangıç", type: "date", required: true },
              { name: "to", label: "Bitiş", type: "date" },
              { name: "halfDay", label: "Süre", type: "select", defaultValue: "0", options: [{ value: "0", label: "Tam gün" }, { value: "1", label: "Yarım gün (tek gün)" }] },
              { name: "documentRef", label: "Belge referansı (raporlu izin)" },
              { name: "note", label: "Not (sağlık bilgisi yazmayın)" },
            ]}
          />
        </section>
      ) : (
        <p className="callout-info">Personel kaydınız yok; izin talebi için İK ile görüşün.</p>
      )}

      {queue.length > 0 && (
        <section className="card bg-white">
          <h2 className="card-title">Onay bekleyenler ({queue.length})</h2>
          <ul className="flex flex-col gap-3" data-testid="leave-queue">
            {queue.map((l) => (
              <li key={l.id} className="rounded-md border border-line p-3 text-sm">
                <p><b>{l.employee.firstName} {l.employee.lastName}</b> ({l.employee.sicilNo}) · {l.type.name} · {range(l)} · <span className="pill">{STATUS[l.status]}</span></p>
                {l.documentRef && <p className="text-xs text-muted">Belge: {l.documentRef}</p>}
                {l.note && <p className="text-xs text-muted">Not: {l.note}</p>}
                <div className="mt-2 flex flex-wrap gap-2">
                  {approveIds.has(l.id) ? (
                    <FinanceForm action={leaveDecisionAction} submit="Onayla" inline fields={[{ name: "id", type: "hidden", value: l.id }, { name: "action", type: "hidden", value: "APPROVE" }]} />
                  ) : (
                    <FinanceForm action={leaveDecisionAction} submit="Ön onay ver" inline fields={[{ name: "id", type: "hidden", value: l.id }, { name: "action", type: "hidden", value: "PRE" }]} />
                  )}
                  <FinanceForm action={leaveDecisionAction} submit="Reddet" tone="danger" inline fields={[{ name: "id", type: "hidden", value: l.id }, { name: "action", type: "hidden", value: "REJECT" }, { name: "reason", label: "Red gerekçesi", required: true }]} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card bg-white">
        <h2 className="card-title">Taleplerim</h2>
        <ul className="flex flex-col gap-2 text-sm" data-testid="my-leaves">
          {mine.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center gap-2">
              <span>{l.type.name} · {range(l)} · <span className="pill">{STATUS[l.status]}</span>{l.rejectReason ? ` · ${l.rejectReason}` : ""}</span>
              {["REQUESTED", "PRE_APPROVED"].includes(l.status) && (
                <FinanceForm action={leaveDecisionAction} submit="Geri çek" tone="secondary" inline fields={[{ name: "id", type: "hidden", value: l.id }, { name: "action", type: "hidden", value: "CANCEL" }]} />
              )}
            </li>
          ))}
          {mine.length === 0 && <li className="text-muted">Talep yok.</li>}
        </ul>
      </section>

      <section className="card">
        <h2 className="card-title">Resmi tatiller</h2>
        <p className="text-sm">{holidays.map((h) => `${fromDbDate(h.date)} ${h.name}${h.halfDay ? " (yarım)" : ""}`).join(" · ") || "Tanımlı tatil yok."}</p>
        <p className="mt-1 text-xs text-muted">Dini bayram tarihleri her yıl Diyanet takvimine göre teyit edilmelidir.</p>
        {can(user, "hr.employee.edit") && (
          <div className="mt-3">
            <FinanceForm
              action={addHolidayAction}
              submit="Tatil ekle / güncelle"
              inline
              fields={[
                { name: "date", label: "Tarih", type: "date", required: true },
                { name: "name", label: "Ad", required: true },
                { name: "halfDay", label: "Süre", type: "select", defaultValue: "0", options: [{ value: "0", label: "Tam gün" }, { value: "1", label: "Yarım gün (arife)" }] },
              ]}
            />
          </div>
        )}
      </section>
    </div>
  );
}
