import Link from "next/link";
import { notFound } from "next/navigation";
import { can, requirePage } from "@/server/auth/rbac";
import { db } from "@/server/db";
import { DEPARTMENTS, getEmployeeCard } from "@/server/services/hr";
import { FinanceForm } from "@/components/finance-form";
import { fmtMin, fromDbDate, istDate } from "@/lib/hr/time";
import { exitEmployeeAction, updateEmployeeAction } from "../../actions";

export const dynamic = "force-dynamic";

export default async function EmployeeCardPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePage("hr.employee.view");
  const { id } = await params;
  const e = await getEmployeeCard(user, id);
  if (!e) notFound();
  const [teams, leaves, recentDays] = await Promise.all([
    db.team.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.leaveRequest.findMany({ where: { employeeId: id }, include: { type: true }, orderBy: { startDate: "desc" }, take: 10 }),
    db.attendanceDay.findMany({ where: { employeeId: id }, orderBy: { date: "desc" }, take: 14 }),
  ]);
  const editable = can(user, "hr.employee.edit") && e.status === "ACTIVE";

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="eyebrow">PERSONEL · {e.sicilNo}</p>
        <h1 className="page-title">{e.firstName} {e.lastName}</h1>
        <p className="mt-1 text-sm text-muted">
          {DEPARTMENTS[e.department as keyof typeof DEPARTMENTS]} · {e.title ?? "unvan yok"} · Ekip: {e.teamName ?? "—"} · {e.weeklyHours} saat/hafta · İşe giriş {fromDbDate(e.hireDate)}
          {e.status === "EXITED" && <b className="text-critical"> · Ayrıldı {e.exitDate ? fromDbDate(e.exitDate) : ""}</b>}
        </p>
        <p className="mt-1 text-sm">CRM kullanıcısı: {e.linkedUser ? `${e.linkedUser.email} (${e.linkedUser.status === "ACTIVE" ? "etkin" : "pasif"})` : "bağlı değil"} · <Link href="/hr/employees" className="text-teal-ink underline">Tüm personel</Link></p>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="card">
          <h2 className="card-title">Yıllık izin</h2>
          <p className="stat-value">{e.balance.remaining}</p>
          <p className="text-sm text-muted">kalan · hak {e.balance.entitlement} · kullanılan {e.balance.used} · kıdem {e.balance.seniorityYears} yıl</p>
        </section>
        <section className="card lg:col-span-2">
          <h2 className="card-title">Son izinler</h2>
          <ul className="text-sm">
            {leaves.map((l) => <li key={l.id}>{l.type.name} · {fromDbDate(l.startDate)} – {fromDbDate(l.endDate)}{l.halfDay ? " (yarım)" : ""} · {l.status}</li>)}
            {leaves.length === 0 && <li className="text-muted">Kayıt yok.</li>}
          </ul>
        </section>
      </div>

      <section className="card bg-white">
        <h2 className="card-title">Son 14 gün puantaj</h2>
        <p className="text-sm">
          {recentDays.map((d) => (
            <span key={d.id} className="mr-3 inline-block tabular-nums">{fromDbDate(d.date).slice(5)} <b>{d.code || "—"}</b> {d.workedMin ? fmtMin(d.workedMin) : ""}</span>
          ))}
          {recentDays.length === 0 && <span className="text-muted">Henüz hesaplanmış gün yok.</span>}
        </p>
      </section>

      {editable && (
        <section className="card">
          <h2 className="card-title">Kaydı düzenle</h2>
          <FinanceForm
            action={updateEmployeeAction}
            submit="Kaydet"
            fields={[
              { name: "id", type: "hidden", value: e.id },
              { name: "sicilNo", label: "Sicil no", required: true, defaultValue: e.sicilNo },
              { name: "firstName", label: "Ad", required: true, defaultValue: e.firstName },
              { name: "lastName", label: "Soyad", required: true, defaultValue: e.lastName },
              { name: "department", label: "Departman", type: "select", required: true, defaultValue: e.department, options: Object.entries(DEPARTMENTS).map(([value, label]) => ({ value, label })) },
              { name: "title", label: "Unvan", defaultValue: e.title ?? "" },
              { name: "teamId", label: "Ekip", type: "select", defaultValue: e.teamId ?? "", options: [{ value: "", label: "Ekipsiz" }, ...teams.map((t) => ({ value: t.id, label: t.name }))] },
              { name: "employmentType", label: "Çalışma tipi", type: "select", required: true, defaultValue: e.employmentType, options: [{ value: "FULL", label: "Tam zamanlı" }, { value: "PART", label: "Yarı zamanlı" }] },
              { name: "weeklyHours", label: "Haftalık sözleşme saati", type: "number", required: true, defaultValue: String(e.weeklyHours) },
              { name: "hireDate", label: "İşe giriş", type: "date", required: true, defaultValue: fromDbDate(e.hireDate) },
              { name: "userEmail", label: "CRM kullanıcısı (e-posta)", defaultValue: e.linkedUser?.email ?? "" },
              { name: "phone", label: "Telefon", defaultValue: e.phone ?? "" },
              { name: "email", label: "E-posta", defaultValue: e.email ?? "" },
            ]}
          />
          <details className="mt-5">
            <summary className="cursor-pointer text-sm font-semibold text-critical">İşten çıkış</summary>
            <p className="mt-2 text-sm text-muted">Personel kaydı kapanır; bağlı CRM hesabı anında pasifleşir, açık görev ve geri aramalar ekip liderine düşer.</p>
            <div className="mt-2">
              <FinanceForm
                action={exitEmployeeAction}
                submit="İşten çıkışı kaydet"
                tone="danger"
                fields={[
                  { name: "id", type: "hidden", value: e.id },
                  { name: "exitDate", label: "Çıkış tarihi", type: "date", required: true, defaultValue: istDate(new Date()) },
                  { name: "reason", label: "Gerekçe", required: true },
                ]}
              />
            </div>
          </details>
        </section>
      )}
    </div>
  );
}
