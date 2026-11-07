import Link from "next/link";
import { requirePage, scopeOf } from "@/server/auth/rbac";
import { listGuests } from "@/server/services/guests";
import { ConsentBadge, PhoneStateBadge } from "@/components/badges";

export const dynamic = "force-dynamic";

const SCOPE_LABEL = { own: "Size atanmış misafirler", team: "Ekibinizin misafirleri", all: "Tüm misafirler" } as const;

export default async function GuestsPage({ searchParams }: { searchParams: Promise<{ q?: string; consent?: string; page?: string }> }) {
  const user = await requirePage("guest.view");
  const sp = await searchParams;
  const { rows, total, page, pageSize } = await listGuests(user, { q: sp.q, consent: sp.consent, page: Number(sp.page ?? 1) });
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const qs = (p: number) => `?${new URLSearchParams({ ...(sp.q ? { q: sp.q } : {}), ...(sp.consent ? { consent: sp.consent } : {}), page: String(p) })}`;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="eyebrow">MİSAFİR VERİSİ</p>
        <h1 className="page-title">Misafirler</h1>
        <p className="mt-1 text-sm text-muted">{SCOPE_LABEL[scopeOf(user, "guest.view") ?? "own"]} · {total.toLocaleString("tr-TR")} kayıt</p>
      </div>

      <form className="flex flex-wrap items-end gap-3" role="search">
        <div className="min-w-64 flex-1">
          <label htmlFor="q" className="label">Ara</label>
          <input id="q" name="q" defaultValue={sp.q} placeholder="Ad, soyad, CRM-000123, telefon veya casino kimliği" className="input" />
        </div>
        <div>
          <label htmlFor="consent" className="label">Arama izni</label>
          <select id="consent" name="consent" defaultValue={sp.consent ?? ""} className="input">
            <option value="">Tümü</option>
            <option value="GRANTED">İzin var</option>
            <option value="UNKNOWN">Bilinmiyor</option>
            <option value="DENIED">Reddedildi</option>
            <option value="BLOCKED">İletişim durdurulmuş</option>
          </select>
        </div>
        <button className="btn-primary">Filtrele</button>
      </form>

      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="table-ink min-w-[860px]">
          <thead>
            <tr>
              <th scope="col">CRM ID</th>
              <th scope="col">Ad soyad</th>
              <th scope="col">Telefon</th>
              <th scope="col">Dil / ülke</th>
              <th scope="col">Arama izni</th>
              <th scope="col">Sahip</th>
              <th scope="col">Güncelleme</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="py-8 text-center text-muted">Kayıt bulunamadı.</td>
              </tr>
            )}
            {rows.map((g) => {
              const ph = g.phones[0];
              return (
                <tr key={g.id}>
                  <td className="font-mono text-xs">
                    <Link href={`/guests/${g.id}`} className="text-teal-ink underline-offset-2 hover:underline">
                      CRM-{String(g.crmNo).padStart(6, "0")}
                    </Link>
                  </td>
                  <td className="font-semibold text-ink">
                    <Link href={`/guests/${g.id}`} className="hover:underline">{g.firstName} {g.lastName}</Link>
                  </td>
                  <td>
                    {ph ? (
                      <div className="flex flex-col gap-1">
                        <span className="font-mono">{ph.masked}</span>
                        <PhoneStateBadge formatStatus={ph.formatStatus} reachability={ph.reachability} />
                      </div>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td>{g.language.toUpperCase()}{g.country ? ` · ${g.country}` : ""}</td>
                  <td><ConsentBadge status={g.blocks.length ? "BLOCKED" : g.consents[0]?.status ?? "UNKNOWN"} /></td>
                  <td>{g.owner?.name ?? <span className="text-muted">Atanmamış</span>}</td>
                  <td className="text-xs text-muted">{g.updatedAt.toLocaleDateString("tr-TR")}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <nav aria-label="Sayfalar" className="flex items-center gap-3 text-sm">
          {page > 1 && <Link href={qs(page - 1)} className="btn-secondary">‹ Önceki</Link>}
          <span className="text-muted">Sayfa {page} / {pages}</span>
          {page < pages && <Link href={qs(page + 1)} className="btn-secondary">Sonraki ›</Link>}
        </nav>
      )}
    </div>
  );
}
