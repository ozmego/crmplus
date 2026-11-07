import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { requirePage } from "@/server/auth/rbac";
import { db } from "@/server/db";

export const dynamic = "force-dynamic";
const PAGE = 100;

const ACTION_TR: Record<string, string> = {
  view: "Görüntüleme", reveal: "Maskesiz görüntüleme", export: "Dışa aktarma", listen: "Kayıt dinleme", download: "İndirme", denied: "Yetkisiz deneme",
};

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ tab?: string; actor?: string; action?: string; from?: string; to?: string; page?: string }> }) {
  await requirePage("audit.view");
  const sp = await searchParams;
  const tab = sp.tab === "access" ? "access" : "audit";
  const page = Math.max(1, Number(sp.page ?? 1));
  const users = await db.user.findMany({ select: { id: true, name: true, email: true }, orderBy: { name: "asc" } });
  const userName = new Map(users.map((u) => [u.id, u.name]));
  const at: Prisma.DateTimeFilter = {};
  if (sp.from) at.gte = new Date(`${sp.from}T00:00:00+03:00`);
  if (sp.to) at.lte = new Date(`${sp.to}T23:59:59+03:00`);
  const common = { ...(sp.actor ? { actorId: sp.actor } : {}), ...(sp.from || sp.to ? { at } : {}) };

  const rows =
    tab === "audit"
      ? await db.auditLog.findMany({
          where: { ...common, ...(sp.action ? { action: { startsWith: sp.action } } : {}) },
          orderBy: { at: "desc" },
          skip: (page - 1) * PAGE,
          take: PAGE + 1,
        })
      : await db.accessLog.findMany({
          where: { ...common, ...(sp.action ? { action: sp.action } : {}) },
          orderBy: { at: "desc" },
          skip: (page - 1) * PAGE,
          take: PAGE + 1,
        });
  const hasNext = rows.length > PAGE;
  const list = rows.slice(0, PAGE);
  const qs = (o: Record<string, string | number | undefined>) =>
    "?" + new URLSearchParams(Object.entries({ ...sp, ...o }).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => [k, String(v)])).toString();

  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="eyebrow">DENETİM</p>
        <h1 className="page-title">İşlem ve erişim kayıtları</h1>
        <p className="mt-1 text-sm text-muted">Kayıtlar değiştirilemez ve silinemez (veritabanı düzeyinde korunur). Salt okunur ekran.</p>
      </div>

      <nav aria-label="Kayıt türü" className="flex gap-2">
        <Link href={qs({ tab: "audit", page: 1, action: undefined })} className={"rounded border px-3 py-1.5 text-sm " + (tab === "audit" ? "border-ink bg-ink text-cream" : "border-line bg-white")}>İşlem kayıtları</Link>
        <Link href={qs({ tab: "access", page: 1, action: undefined })} className={"rounded border px-3 py-1.5 text-sm " + (tab === "access" ? "border-ink bg-ink text-cream" : "border-line bg-white")}>Erişim kayıtları</Link>
      </nav>

      <form className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="tab" value={tab} />
        <div>
          <label htmlFor="actor" className="label">Kullanıcı</label>
          <select id="actor" name="actor" defaultValue={sp.actor ?? ""} className="input">
            <option value="">Tümü</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="action" className="label">İşlem</label>
          {tab === "audit" ? (
            <input id="action" name="action" defaultValue={sp.action} className="input" placeholder="ör. role., import., auth." />
          ) : (
            <select id="action" name="action" defaultValue={sp.action ?? ""} className="input">
              <option value="">Tümü</option>
              {Object.entries(ACTION_TR).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          )}
        </div>
        <div><label htmlFor="from" className="label">Başlangıç</label><input id="from" name="from" type="date" defaultValue={sp.from} className="input" /></div>
        <div><label htmlFor="to" className="label">Bitiş</label><input id="to" name="to" type="date" defaultValue={sp.to} className="input" /></div>
        <button className="btn-primary">Filtrele</button>
      </form>

      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="table-ink min-w-[980px]">
          <thead>
            <tr>
              <th scope="col">Zaman</th>
              <th scope="col">Kullanıcı</th>
              <th scope="col">İşlem</th>
              <th scope="col">Kayıt</th>
              <th scope="col">Gerekçe</th>
              <th scope="col">Ayrıntı</th>
              <th scope="col">IP</th>
            </tr>
          </thead>
          <tbody>
            {list.length === 0 && <tr><td colSpan={7} className="py-6 text-center text-muted">Kayıt yok.</td></tr>}
            {list.map((r) => {
              const isAudit = "entity" in r;
              const action = r.action;
              const denied = !isAudit && action === "denied";
              return (
                <tr key={String(r.id)} className={denied ? "bg-critical-bg" : ""}>
                  <td className="whitespace-nowrap text-xs">{r.at.toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" })}</td>
                  <td className="text-xs">{r.actorId ? userName.get(r.actorId) ?? r.actorId : <span className="text-muted">sistem</span>}</td>
                  <td className="font-mono text-xs">{isAudit ? action : ACTION_TR[action] ?? action}</td>
                  <td className="text-xs">
                    {isAudit ? `${(r as { entity?: string | null }).entity ?? ""} ${(r as { entityId?: string | null }).entityId ?? ""}` : `${(r as { resource: string }).resource} ${(r as { resourceId?: string | null }).resourceId ?? ""}`}
                  </td>
                  <td className="text-xs">{r.reason ?? "—"}</td>
                  <td className="max-w-md truncate font-mono text-[11px] text-muted" title={JSON.stringify(isAudit ? (r as { diff: unknown }).diff : (r as { meta: unknown }).meta)}>
                    {JSON.stringify(isAudit ? (r as { diff: unknown }).diff : (r as { meta: unknown }).meta) ?? ""}
                  </td>
                  <td className="text-xs text-muted">{r.ip ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <nav aria-label="Sayfalar" className="flex gap-3 text-sm">
        {page > 1 && <Link href={qs({ page: page - 1 })} className="btn-secondary">‹ Daha yeni</Link>}
        {hasNext && <Link href={qs({ page: page + 1 })} className="btn-secondary">Daha eski ›</Link>}
      </nav>
    </div>
  );
}
