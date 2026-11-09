import Link from "next/link";
import { requirePage } from "@/server/auth/rbac";
import { db } from "@/server/db";
import { CompareForm } from "@/components/compare-form";

export const dynamic = "force-dynamic";

export default async function ComparePage() {
  await requirePage("compare.run");
  const [batches, jobs] = await Promise.all([
    db.importBatch.findMany({
      where: { status: { in: ["PREVIEWED", "APPLIED", "ROLLED_BACK"] } },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: { id: true, fileName: true, sourceLabel: true, createdAt: true, status: true },
    }),
    db.comparisonJob.findMany({ orderBy: { createdAt: "desc" }, take: 30 }),
  ]);
  const label = (b: (typeof batches)[number]) =>
    `${b.fileName} · ${b.sourceLabel} · ${b.createdAt.toLocaleDateString("tr-TR", { timeZone: "Europe/Istanbul" })}${b.status === "APPLIED" ? " · uygulandı" : ""}`;
  const batchName = new Map(batches.map((b) => [b.id, b.fileName]));
  const refLabel = (ref: string) => {
    const crm = ref.startsWith("crm:import:");
    const id = ref.replace(/^crm:import:|^import:/, "");
    return `${crm ? "CRM (" : ""}${batchName.get(id) ?? id}${crm ? ")" : ""}`;
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="eyebrow">VERİ VE DOSYA İŞLEMLERİ</p>
        <h1 className="page-title">Liste karşılaştırma</h1>
        <p className="mt-1 text-sm text-muted">İki dosyayı veya bir dosyayı CRM’deki güncel kayıtlarla karşılaştırır. “Dosyada yok” silme anlamına gelmez.</p>
      </div>
      <CompareForm batches={batches.map((b) => ({ id: b.id, label: label(b), applied: b.status === "APPLIED" }))} />
      <section>
        <h2 className="card-title">Son karşılaştırmalar</h2>
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="table-ink min-w-[760px]">
            <thead>
              <tr><th scope="col">Taban</th><th scope="col">Yeni dosya</th><th scope="col">Özet</th><th scope="col">Tarih</th></tr>
            </thead>
            <tbody>
              {jobs.length === 0 && <tr><td colSpan={4} className="py-6 text-center text-muted">Henüz karşılaştırma yok.</td></tr>}
              {jobs.map((j) => {
                const s = (j.summary ?? {}) as Record<string, number>;
                return (
                  <tr key={j.id}>
                    <td><Link href={`/compare/${j.id}`} className="font-semibold text-teal-ink hover:underline">{refLabel(j.leftRef)}</Link></td>
                    <td>{refLabel(j.rightRef)}</td>
                    <td className="text-xs">{s.NEW ?? 0} yeni · {(s.CONTACT_CHANGED ?? 0) + (s.OTHER_CHANGED ?? 0)} değişen · {(s.CONFLICT ?? 0) + (s.MULTI_MATCH ?? 0)} çelişki · {s.MISSING_IN_FILE ?? 0} dosyada yok</td>
                    <td className="text-xs text-muted">{j.createdAt.toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" })}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
