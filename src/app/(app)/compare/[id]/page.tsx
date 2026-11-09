import Link from "next/link";
import { notFound } from "next/navigation";
import { can, requirePage } from "@/server/auth/rbac";
import { db } from "@/server/db";
import type { StoredDiff } from "@/server/services/compare";

export const dynamic = "force-dynamic";

const STATUS: Record<string, { label: string; cls: string }> = {
  NEW: { label: "Yeni kayıt", cls: "border-teal-ink text-teal-ink" },
  SAME: { label: "Eşleşti, değişiklik yok", cls: "border-line text-muted" },
  CONTACT_CHANGED: { label: "Telefon/iletişim değişti", cls: "border-ink text-ink" },
  OTHER_CHANGED: { label: "Diğer alanlar değişti", cls: "border-ink text-ink" },
  MULTI_MATCH: { label: "Birden fazla muhtemel eşleşme", cls: "border-warn text-warn-ink" },
  CONFLICT: { label: "Kaynaklar arasında çelişki", cls: "border-critical text-critical" },
  MISSING_IN_FILE: { label: "Tabanda var, yeni dosyada yok", cls: "border-warn text-warn-ink" },
};
const ORDER = ["NEW", "CONTACT_CHANGED", "OTHER_CHANGED", "CONFLICT", "MULTI_MATCH", "MISSING_IN_FILE", "SAME"];
const FIELD: Record<string, string> = {
  firstName: "Ad", lastName: "Soyad", fullName: "Ad soyad", language: "Dil", country: "Ülke", city: "Şehir", birthYear: "Doğum yılı",
  vipLevel: "VIP", phone: "Telefon", email: "E-posta", "consent.CALL": "Arama izni", "consent.SMS": "SMS izni", "consent.WHATSAPP": "WhatsApp izni", "consent.EMAIL": "E-posta izni",
};

export default async function CompareJobPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ status?: string }> }) {
  const user = await requirePage("compare.run");
  const { id } = await params;
  const { status } = await searchParams;
  const job = await db.comparisonJob.findUnique({ where: { id } });
  if (!job) notFound();
  const crmMode = job.leftRef.startsWith("crm:");
  const ids = [job.leftRef, job.rightRef].map((r) => r.replace(/^crm:import:|^import:/, ""));
  const batches = new Map((await db.importBatch.findMany({ where: { id: { in: ids } }, select: { id: true, fileName: true, createdAt: true } })).map((b) => [b.id, b]));
  const left = batches.get(ids[0]);
  const right = batches.get(ids[1]);
  const summary = (job.summary ?? {}) as Record<string, number>;
  const active = status && STATUS[status] ? status : null;
  const results = await db.comparisonResult.findMany({
    where: { jobId: id, ...(active ? { status: active } : { status: { not: "SAME" } }) },
    orderBy: [{ status: "asc" }, { rowNo: "asc" }],
    take: 300,
  });
  const guestIds = new Set<string>();
  for (const r of results) {
    const d = r.diff as unknown as StoredDiff;
    if (crmMode && d.leftRef) guestIds.add(d.leftRef);
    if (crmMode) d.candidateRefs?.forEach((c) => guestIds.add(c));
  }
  const guests = new Map(
    (await db.guest.findMany({ where: { id: { in: [...guestIds] } }, select: { id: true, crmNo: true, firstName: true, lastName: true } })).map((g) => [g.id, g]),
  );
  const leftLabel = (ref: string | null | undefined) => {
    if (!ref) return "—";
    if (!crmMode) return `Satır ${ref.slice(1)}`;
    const g = guests.get(ref);
    return g ? `CRM-${String(g.crmNo).padStart(6, "0")} ${g.firstName} ${g.lastName}` : ref;
  };

  return (
    <div className="flex flex-col gap-5">
      <Link href="/compare" className="text-sm text-teal-ink hover:underline">‹ Karşılaştırmalar</Link>
      <div>
        <p className="eyebrow">KARŞILAŞTIRMA</p>
        <h1 className="page-title">{crmMode ? "CRM ↔ dosya" : "Dosya ↔ dosya"}</h1>
        <p className="mt-1 text-sm text-muted">
          Taban: {crmMode ? `CRM’deki güncel hali (${left?.fileName ?? "?"} misafirleri)` : left?.fileName} ({summary.left ?? 0} kayıt) · Yeni dosya: {right?.fileName} ({summary.right ?? 0} kayıt) · {job.createdAt.toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" })}
        </p>
      </div>

      <nav aria-label="Durum filtresi" className="flex flex-wrap gap-2">
        <Link href="?" className={"rounded border px-3 py-1.5 text-sm " + (!active ? "border-ink bg-ink text-cream" : "border-line bg-white")}>Değişenler</Link>
        {ORDER.map((s) => (
          <Link key={s} href={`?status=${s}`} className={"rounded border px-3 py-1.5 text-sm " + (active === s ? "border-ink bg-ink text-cream" : "border-line bg-white")}>
            {STATUS[s].label} ({summary[s] ?? 0})
          </Link>
        ))}
      </nav>

      {(summary.MISSING_IN_FILE ?? 0) > 0 && (
        <p className="callout-info">“Yeni dosyada yok” kayıtlar silinmez; yalnız bilgi amaçlı listelenir.</p>
      )}

      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="table-ink min-w-[900px]">
          <thead>
            <tr>
              <th scope="col">Durum</th>
              <th scope="col">Taban</th>
              <th scope="col">Yeni dosya</th>
              <th scope="col">Eski değer → yeni değer</th>
            </tr>
          </thead>
          <tbody>
            {results.length === 0 && <tr><td colSpan={4} className="py-6 text-center text-muted">Bu filtrede kayıt yok.</td></tr>}
            {results.map((r) => {
              const d = r.diff as unknown as StoredDiff;
              const st = STATUS[r.status];
              return (
                <tr key={String(r.id)}>
                  <td><span className={`pill ${st.cls}`}>{st.label}</span></td>
                  <td className="text-sm">
                    {crmMode && d.leftRef && guests.has(d.leftRef) ? <Link href={`/guests/${d.leftRef}`} className="text-teal-ink hover:underline">{leftLabel(d.leftRef)}</Link> : leftLabel(d.leftRef)}
                    {d.candidateRefs && d.candidateRefs.length > 1 && <div className="text-xs text-muted">Adaylar: {d.candidateRefs.map(leftLabel).join(" · ")}</div>}
                  </td>
                  <td className="text-sm">{r.rowNo ? `Satır ${r.rowNo}` : "—"}</td>
                  <td className="text-xs">
                    {d.deltas.map((x, i) => (
                      <div key={i}><b>{FIELD[x.field] ?? x.field}</b>: {x.left ?? "∅"} → {x.right ?? "∅"}</div>
                    ))}
                    {d.reason && <div className="text-warn-ink">{d.reason}</div>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {results.length === 300 && <p className="text-xs text-muted">İlk 300 kayıt gösteriliyor.</p>}
      {can(user, "import.create") && (
        <p className="callout-info">
          Değişiklikleri CRM’e uygulamak için yeni dosyayı “Mevcut listeyi güncelle” amacıyla içe aktarın; çakışan alanlar orada tek tek kararla uygulanır.{" "}
          <Link href="/imports" className="font-semibold text-teal-ink hover:underline">İçe aktarma ›</Link>
        </p>
      )}
    </div>
  );
}
