import Link from "next/link";
import { can, requirePage } from "@/server/auth/rbac";
import { db } from "@/server/db";
import { UploadForm } from "@/components/import-wizard";

export const dynamic = "force-dynamic";

const STATUS: Record<string, string> = {
  UPLOADED: "Yüklendi", SCANNED: "Eşleme bekliyor", REJECTED: "Reddedildi", MAPPED: "Eşlendi", PREVIEWED: "Önizleme",
  APPLYING: "Uygulanıyor", APPLIED: "Uygulandı", ROLLED_BACK: "Geri alındı", FAILED: "Hata",
};
const PURPOSE: Record<string, string> = { NEW_LIST: "Yeni liste", UPDATE: "Güncelleme", COMPARE: "Karşılaştırma" };

export default async function ImportsPage() {
  const user = await requirePage("import.view");
  const batches = await db.importBatch.findMany({ orderBy: { createdAt: "desc" }, take: 50 });
  const uploaders = new Map(
    (await db.user.findMany({ where: { id: { in: [...new Set(batches.map((b) => b.uploadedById))] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]),
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="eyebrow">VERİ VE DOSYA İŞLEMLERİ</p>
        <h1 className="page-title">Excel içe aktarma ve karşılaştırma</h1>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        {[
          ["1", "Dosyayı yükle", "Tür, boyut ve şablon kontrolü, virüs taraması"],
          ["2", "Sütunları eşleştir", "Alan önerileri ve kullanıcı onayı"],
          ["3", "Önizle ve doğrula", "Yeni, hatalı, mükerrer, eksik izin"],
          ["4", "Uygula ve denetle", "Sonuç raporu ve geri alma kaydı"],
        ].map(([n, t, d]) => (
          <div key={n} className="rounded-lg bg-info-bg p-3">
            <p className="text-2xl font-extrabold text-teal-ink">{n}</p>
            <p className="text-sm font-semibold">{t}</p>
            <p className="text-xs text-muted">{d}</p>
          </div>
        ))}
      </div>

      {can(user, "import.create") && <UploadForm />}

      <section>
        <h2 className="card-title">Son içe aktarmalar</h2>
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="table-ink min-w-[820px]">
            <thead>
              <tr>
                <th scope="col">Dosya</th>
                <th scope="col">Amaç</th>
                <th scope="col">Kaynak</th>
                <th scope="col">Satır</th>
                <th scope="col">Durum</th>
                <th scope="col">Yükleyen</th>
                <th scope="col">Tarih</th>
              </tr>
            </thead>
            <tbody>
              {batches.length === 0 && (
                <tr><td colSpan={7} className="py-6 text-center text-muted">Henüz içe aktarma yok.</td></tr>
              )}
              {batches.map((b) => (
                <tr key={b.id}>
                  <td><Link href={`/imports/${b.id}`} className="font-semibold text-teal-ink hover:underline">{b.fileName}</Link></td>
                  <td>{PURPOSE[b.purpose]}</td>
                  <td>{b.sourceLabel}</td>
                  <td className="tabular-nums">{(b.summary as { rowCount?: number } | null)?.rowCount?.toLocaleString("tr-TR") ?? "—"}</td>
                  <td>{STATUS[b.status]}</td>
                  <td>{uploaders.get(b.uploadedById) ?? "—"}</td>
                  <td className="text-xs text-muted">{b.createdAt.toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
