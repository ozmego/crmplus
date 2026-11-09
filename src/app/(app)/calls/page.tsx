import Link from "next/link";
import { requirePage, scopeOf } from "@/server/auth/rbac";
import { reviewQueue } from "@/server/services/call-detail";

export const dynamic = "force-dynamic";

const FILTERS = [
  ["all", "Transkriptli tüm çağrılar"],
  ["mismatch", "Sonuç/özet uyuşmazlığı"],
  ["low", "Düşük güven / başarısız"],
  ["pending", "İnceleme bekleyen öneri"],
] as const;

export default async function CallsPage({ searchParams }: { searchParams: Promise<{ f?: string }> }) {
  const user = await requirePage("call.view");
  const { f } = await searchParams;
  const filter = (FILTERS.find(([k]) => k === f)?.[0] ?? "mismatch") as "all" | "mismatch" | "low" | "pending";
  const calls = await reviewQueue(user, filter);
  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="eyebrow">ÇAĞRI MERKEZİ VE SES</p>
        <h1 className="page-title">Çağrılar ve inceleme</h1>
        <p className="mt-1 text-sm text-muted">Kapsam: {{ own: "kendi çağrılarınız", team: "ekibinizin çağrıları", all: "tüm çağrılar" }[scopeOf(user, "call.view") ?? "own"]}. Kişi bazlı görüşme içeriği yalnız bu yetkili inceleme ekranında görünür.</p>
      </div>
      <nav aria-label="Filtre" className="flex flex-wrap gap-2">
        {FILTERS.map(([k, l]) => (
          <Link key={k} href={`?f=${k}`} className={"rounded border px-3 py-1.5 text-sm " + (filter === k ? "border-ink bg-ink text-cream" : "border-line bg-white")}>{l}</Link>
        ))}
      </nav>
      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="table-ink min-w-[760px]">
          <thead><tr><th scope="col">Zaman</th><th scope="col">Misafir</th><th scope="col">Temsilci</th><th scope="col">Sonuç</th><th scope="col">Süre</th></tr></thead>
          <tbody>
            {calls.length === 0 && <tr><td colSpan={5} className="py-6 text-center text-muted">Bu filtrede çağrı yok.</td></tr>}
            {calls.map((c) => (
              <tr key={c.id}>
                <td className="text-xs"><Link href={`/calls/${c.id}`} className="text-teal-ink hover:underline">{c.startedAt.toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" })}</Link></td>
                <td>CRM-{String(c.guest.crmNo).padStart(6, "0")} {c.guest.firstName} {c.guest.lastName}</td>
                <td>{c.agent.name}</td>
                <td className="font-mono text-xs">{c.disposition ?? "—"}</td>
                <td className="tabular-nums">{c.talkSec ?? 0} sn</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
