import Link from "next/link";
import { requirePage, scopeOf } from "@/server/auth/rbac";
import { inboxList, waEnabled } from "@/server/services/whatsapp";
import { AutoRefresh } from "@/components/auto-refresh";

export const dynamic = "force-dynamic";

const t = (d: Date | null) => (d ? d.toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Istanbul" }) : "—");

export default async function InboxPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const user = await requirePage("inbox.view");
  const { status } = await searchParams;
  const st = status === "CLOSED" ? "CLOSED" : "OPEN";
  const [list, enabled] = await Promise.all([inboxList(user, st), waEnabled()]);
  return (
    <div className="flex flex-col gap-5">
      <AutoRefresh seconds={15} />
      <div>
        <p className="eyebrow">MESAJLAR · WHATSAPP</p>
        <h1 className="page-title">Gelen kutusu</h1>
        <p className="mt-1 text-sm text-muted">
          Kapsam: {{ own: "size atanan ve ekibinizin atanmamış konuşmaları", team: "ekibinizin konuşmaları", all: "tüm konuşmalar" }[scopeOf(user, "inbox.view") ?? "own"]}. Misafirin son mesajından sonraki 24 saat içinde serbest yanıt; dışında yalnız onaylı şablon. Ret şüphesi olanlar en üstte.
        </p>
      </div>
      {!enabled && <p className="callout-warn">WhatsApp kanalı kapalı: yurt dışı aktarım değerlendirmesi kaydı girilmemiş (Mesajlar → WhatsApp şablonları).</p>}
      <nav aria-label="Durum" className="flex gap-2">
        {[["OPEN", "Açık"], ["CLOSED", "Kapalı"]].map(([k, l]) => (
          <Link key={k} href={`?status=${k}`} className={"rounded border px-3 py-1.5 text-sm " + (st === k ? "border-ink bg-ink text-cream" : "border-line bg-white")}>{l}</Link>
        ))}
      </nav>
      <section className="card bg-white">
        <table className="table-ink" data-testid="inbox">
          <thead><tr><th>Misafir</th><th>Son mesaj</th><th>Pencere</th><th>Atanan</th><th>Okunmamış</th></tr></thead>
          <tbody>
            {list.map((c) => (
              <tr key={c.id} className={c.optOutSuspect ? "bg-warn-bg" : undefined}>
                <td>
                  <Link href={`/inbox/${c.id}`} className="font-semibold text-teal-ink underline">
                    {c.guest ? `${c.guest.firstName} ${c.guest.lastName}` : "Eşleşmeyen numara"}
                  </Link>
                  {c.optOutSuspect && <span className="pill ml-2 border-warn text-warn-ink">ret şüphesi</span>}
                </td>
                <td>{t(c.lastInboundAt)}</td>
                <td>{c.window.open ? <span className="text-teal-ink">açık · {t(c.window.closesAt)}’e kadar</span> : <span className="text-muted">kapalı (şablon)</span>}</td>
                <td>{c.assigneeName ?? "atanmamış"}</td>
                <td className="tabular-nums">{c.unread || ""}</td>
              </tr>
            ))}
            {list.length === 0 && <tr><td colSpan={5} className="text-muted">Konuşma yok.</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  );
}
