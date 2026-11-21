import Link from "next/link";
import { can, requirePage } from "@/server/auth/rbac";
import { db } from "@/server/db";
import { listUsers } from "@/server/services/users";
import { mfaRequired } from "@/server/auth/policy";
import { CreateUserForm, TeamForm, UserRowActions } from "@/components/admin-users";

export const dynamic = "force-dynamic";

const STATUS: Record<string, { label: string; cls: string }> = {
  ACTIVE: { label: "Etkin", cls: "border-teal-ink text-teal-ink" },
  LOCKED: { label: "Kilitli", cls: "border-warn text-warn-ink" },
  DISABLED: { label: "Pasif", cls: "border-critical text-critical" },
};

export default async function UsersPage() {
  const me = await requirePage("user.view");
  const [users, roles, teams] = await Promise.all([
    listUsers(),
    db.role.findMany({ orderBy: { name: "asc" }, select: { key: true, name: true } }),
    db.team.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, leaderId: true, _count: { select: { members: true } } } }),
  ]);
  const leaders = users.filter((u) => u.status === "ACTIVE" && u.roles.some((r) => r.role.key === "team_lead")).map((u) => ({ id: u.id, name: u.name }));
  const canManage = can(me, "user.manage");
  const canRoles = can(me, "role.assign");
  const canTeam = can(me, "team.manage");
  const mfa = mfaRequired();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">YÖNETİM</p>
          <h1 className="page-title">Kullanıcılar ve ekipler</h1>
          <p className="mt-1 text-sm text-muted">Tüm değişiklikler gerekçeli ve <Link href="/admin/audit" className="text-teal-ink hover:underline">denetim kaydında</Link>.</p>
        </div>
      </div>

      {canManage && <CreateUserForm roles={roles} teams={teams} />}

      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="table-ink min-w-[980px]">
          <thead>
            <tr>
              <th scope="col">Ad soyad</th>
              <th scope="col">E-posta</th>
              <th scope="col">Roller</th>
              <th scope="col">Ekip</th>
              <th scope="col">Durum</th>
              <th scope="col">MFA</th>
              <th scope="col">Son giriş</th>
              <th scope="col">İşlemler</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const locked = u.lockedUntil && u.lockedUntil > new Date();
              const st = STATUS[u.status];
              return (
                <tr key={u.id}>
                  <td className="font-semibold text-ink">{u.name}{u.id === me.id && <span className="ml-1 text-xs text-muted">(siz)</span>}</td>
                  <td className="text-xs">{u.email}</td>
                  <td className="text-xs">{u.roles.map((r) => r.role.name).join(", ") || <span className="text-critical">rol yok</span>}</td>
                  <td>{u.team?.name ?? "—"}</td>
                  <td>
                    <span className={`pill ${st.cls}`}>{st.label}</span>
                    {locked && <span className="pill ml-1 border-warn text-warn-ink">Geçici kilit</span>}
                  </td>
                  <td className="text-xs">{!mfa ? <span className="text-muted">Kapalı (politika)</span> : u.mfaEnabledAt ? "Kurulu" : <span className="text-warn-ink">Kurulmadı</span>}</td>
                  <td className="text-xs text-muted">{u.lastLoginAt?.toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" }) ?? "—"}</td>
                  <td>
                    <UserRowActions
                      userId={u.id}
                      isSelf={u.id === me.id}
                      status={u.status}
                      roleKeys={u.roles.map((r) => r.role.key)}
                      teamId={u.team?.id ?? null}
                      roles={roles}
                      teams={teams}
                      canRoles={canRoles}
                      canTeam={canTeam}
                      canManage={canManage}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-bold text-ink">Ekipler</h2>
        <div className="flex flex-wrap gap-3">
          {teams.map((t) => (
            <div key={t.id} className="card min-w-48">
              <p className="font-semibold text-ink">{t.name}</p>
              <p className="text-xs text-muted">{t._count.members} üye · lider: {users.find((u) => u.id === t.leaderId)?.name ?? "—"}</p>
            </div>
          ))}
        </div>
        {canTeam && <TeamForm teams={teams} leaders={leaders} />}
      </section>
    </div>
  );
}
