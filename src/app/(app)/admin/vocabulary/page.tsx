import { requirePage } from "@/server/auth/rbac";
import { db } from "@/server/db";
import { VOCAB_KINDS } from "@/server/services/qa";
import { FinanceForm } from "@/components/finance-form";
import { addTermAction, toggleTermAction } from "@/app/(app)/qa/actions";

export const dynamic = "force-dynamic";

export default async function VocabularyPage() {
  await requirePage("vocabulary.manage");
  const terms = await db.vocabularyTerm.findMany({ orderBy: [{ active: "desc" }, { kind: "asc" }, { term: "asc" }] });
  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="eyebrow">YÖNETİM · TÜRKÇE KURUM SÖZLÜĞÜ</p>
        <h1 className="page-title">Kurum sözlüğü</h1>
        <p className="mt-1 text-sm text-muted">Casino, otel, yer ve kişi adları transkript motoruna ilk istem olarak verilir; tanıma doğruluğunu artırır. Telefon, kimlik veya kart numarası eklenmez.</p>
      </div>
      <section className="card">
        <FinanceForm
          action={addTermAction}
          submit="Ekle"
          inline
          fields={[
            { name: "term", label: "Terim", required: true, placeholder: "ör. Merit Royal" },
            { name: "kind", label: "Tür", type: "select", required: true, defaultValue: "CASINO", options: Object.entries(VOCAB_KINDS).map(([value, label]) => ({ value, label })) },
          ]}
        />
      </section>
      <section className="card bg-white">
        <p className="mb-2 text-sm text-muted">{terms.filter((t) => t.active).length} etkin terim (en fazla 200 kullanılır)</p>
        <table className="table-ink" data-testid="vocab">
          <thead><tr><th>Terim</th><th>Tür</th><th>Durum</th><th></th></tr></thead>
          <tbody>
            {terms.map((t) => (
              <tr key={t.id}>
                <td>{t.term}</td>
                <td>{VOCAB_KINDS[t.kind as keyof typeof VOCAB_KINDS] ?? t.kind}</td>
                <td>{t.active ? "Etkin" : "Pasif"}</td>
                <td><FinanceForm action={toggleTermAction} submit={t.active ? "Pasifleştir" : "Etkinleştir"} tone="secondary" inline fields={[{ name: "id", type: "hidden", value: t.id }]} /></td>
              </tr>
            ))}
            {terms.length === 0 && <tr><td colSpan={4} className="text-muted">Henüz terim yok.</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  );
}
