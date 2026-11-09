import Link from "next/link";
import { can, requirePage } from "@/server/auth/rbac";
import { db } from "@/server/db";
import { DEPARTMENTS, listEmployees } from "@/server/services/hr";
import { FinanceForm } from "@/components/finance-form";
import { fromDbDate } from "@/lib/hr/time";
import { createEmployeeAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function EmployeesPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; dept?: string }> }) {
  const user = await requirePage("hr.employee.view");
  const sp = await searchParams;
  const [employees, teams] = await Promise.all([
    listEmployees(user, { search: sp.q?.trim() || undefined, status: sp.status || "ACTIVE", department: sp.dept || undefined }),
    db.team.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const teamName = new Map(teams.map((t) => [t.id, t.name]));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="eyebrow">PERSONEL</p>
        <h1 className="page-title">Personel kayıtları</h1>
        <p className="mt-1 text-sm text-muted">Tüm personel (CRM kullanıcısı olmayanlar dahil). Sağlık/teşhis bilgisi tutulmaz. İşten çıkış, bağlı CRM hesabını anında kapatır.</p>
      </div>

      {can(user, "hr.employee.edit") && (
        <details className="card">
          <summary className="cursor-pointer card-title">Personel ekle</summary>
          <div className="mt-3">
            <FinanceForm
              action={createEmployeeAction}
              submit="Ekle"
              fields={[
                { name: "sicilNo", label: "Sicil no", required: true },
                { name: "firstName", label: "Ad", required: true },
                { name: "lastName", label: "Soyad", required: true },
                { name: "department", label: "Departman", type: "select", required: true, options: Object.entries(DEPARTMENTS).map(([value, label]) => ({ value, label })) },
                { name: "title", label: "Unvan" },
                { name: "teamId", label: "Ekip", type: "select", options: [{ value: "", label: "Ekipsiz" }, ...teams.map((t) => ({ value: t.id, label: t.name }))] },
                { name: "employmentType", label: "Çalışma tipi", type: "select", required: true, defaultValue: "FULL", options: [{ value: "FULL", label: "Tam zamanlı" }, { value: "PART", label: "Yarı zamanlı" }] },
                { name: "weeklyHours", label: "Haftalık sözleşme saati", type: "number", defaultValue: "45", required: true },
                { name: "hireDate", label: "İşe giriş", type: "date", required: true },
                { name: "userEmail", label: "CRM kullanıcısı (e-posta, varsa)" },
                { name: "phone", label: "Telefon" },
                { name: "email", label: "E-posta" },
              ]}
            />
          </div>
        </details>
      )}

      <section className="card bg-white">
        <form className="mb-3 flex flex-wrap items-end gap-2 text-sm">
          <div>
            <label htmlFor="q" className="label">Ara</label>
            <input id="q" name="q" defaultValue={sp.q} placeholder="ad, soyad, sicil" className="input min-h-9" />
          </div>
          <div>
            <label htmlFor="dept" className="label">Departman</label>
            <select id="dept" name="dept" defaultValue={sp.dept ?? ""} className="input min-h-9">
              <option value="">Tümü</option>
              {Object.entries(DEPARTMENTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="status" className="label">Durum</label>
            <select id="status" name="status" defaultValue={sp.status ?? "ACTIVE"} className="input min-h-9">
              <option value="ACTIVE">Çalışıyor</option>
              <option value="EXITED">Ayrıldı</option>
            </select>
          </div>
          <button className="btn-secondary min-h-9">Filtrele</button>
        </form>
        <div className="overflow-x-auto">
          <table className="table-ink">
            <thead><tr><th>Sicil</th><th>Ad soyad</th><th>Departman</th><th>Ekip</th><th>Haftalık saat</th><th>İşe giriş</th><th>CRM</th></tr></thead>
            <tbody>
              {employees.map((e) => (
                <tr key={e.id}>
                  <td className="tabular-nums">{e.sicilNo}</td>
                  <td><Link href={`/hr/employees/${e.id}`} className="font-semibold text-teal-ink underline">{e.firstName} {e.lastName}</Link>{e.title && <span className="text-muted"> · {e.title}</span>}</td>
                  <td>{DEPARTMENTS[e.department as keyof typeof DEPARTMENTS] ?? e.department}</td>
                  <td>{e.teamId ? teamName.get(e.teamId) : "—"}</td>
                  <td className="tabular-nums">{e.weeklyHours}{e.employmentType === "PART" ? " (yarı)" : ""}</td>
                  <td>{fromDbDate(e.hireDate)}</td>
                  <td>{e.userId ? "bağlı" : "—"}</td>
                </tr>
              ))}
              {employees.length === 0 && <tr><td colSpan={7} className="text-muted">Kayıt yok.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
