import Link from "next/link";
import { redirect } from "next/navigation";
import { can, requireUser, scopeOf } from "@/server/auth/rbac";
import { listSamples } from "@/server/services/qa";
import { FinanceForm } from "@/components/finance-form";
import { fromDbDate } from "@/lib/hr/time";
import { QA_STATUS } from "@/lib/qa-labels";
import { generateAction } from "./actions";

export const dynamic = "force-dynamic";

const REASON: Record<string, string> = { RANDOM: "Rastgele", PROCESS_FLAG: "Süreç uyarısı", MISMATCH: "Sonuç/özet uyuşmazlığı", LOW_CONFIDENCE: "Düşük güven", MANUAL: "Elle eklendi" };

export default async function QaPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const user = await requireUser();
  const reviewer = !!scopeOf(user, "qa.review");
  if (!reviewer && !can(user, "qa.respond")) redirect("/forbidden");
  const { status } = await searchParams;
  const samples = await listSamples(user, status || undefined);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="eyebrow">KALİTE ÖRNEKLEMESİ</p>
        <h1 className="page-title">{reviewer ? "Ekip örneklemi" : "Kalite incelemelerim"}</h1>
        <p className="mt-1 text-sm text-muted">
          Ortak kriter setiyle insan incelemesi ve koçluk notu. <b>Otomatik puan, sıralama veya yaptırım yoktur.</b> Analiz yalnız incelemeye aday görüşme önerir; personel açıklama veya itiraz ekleyebilir.
        </p>
      </div>

      {reviewer && (
        <div className="flex flex-wrap items-end gap-3">
          <FinanceForm action={generateAction} submit="Geçen haftanın örneklemini oluştur" tone="secondary" inline fields={[]} />
        </div>
      )}

      <nav aria-label="Durum filtresi" className="flex flex-wrap gap-2">
        {[["", "Tümü"], ...Object.entries(QA_STATUS)].map(([k, l]) => (
          <Link key={k} href={k ? `?status=${k}` : "?"} className={"rounded border px-3 py-1.5 text-sm " + ((status ?? "") === k ? "border-ink bg-ink text-cream" : "border-line bg-white")}>{l}</Link>
        ))}
      </nav>

      <section className="card bg-white">
        <table className="table-ink" data-testid="qa-list">
          <thead><tr><th>Hafta</th><th>Personel</th><th>Görüşme</th><th>Seçilme nedeni</th><th>Durum</th></tr></thead>
          <tbody>
            {samples.map((s) => (
              <tr key={s.id}>
                <td>{fromDbDate(s.weekStart)}</td>
                <td>{s.agentName}</td>
                <td>
                  <Link href={`/qa/${s.id}`} className="font-semibold text-teal-ink underline">
                    {s.call?.startedAt.toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Istanbul" }) ?? "—"}
                  </Link>
                  <span className="text-muted"> · {s.call?.disposition ?? "—"} · {s.call?.talkSec ?? 0} sn</span>
                </td>
                <td>{REASON[s.reason] ?? s.reason}</td>
                <td><span className="pill">{QA_STATUS[s.status]}</span></td>
              </tr>
            ))}
            {samples.length === 0 && <tr><td colSpan={5} className="text-muted">Kayıt yok.</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  );
}
