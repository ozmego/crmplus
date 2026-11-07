import Link from "next/link";
import { notFound } from "next/navigation";
import { can, requirePage } from "@/server/auth/rbac";
import { db } from "@/server/db";
import { getDecrypted } from "@/server/storage";
import { parseFile } from "@/server/import/parse";
import { FIELDS, FIELD_BY_KEY, type Mapping } from "@/lib/import/fields";
import { pendingDecisionCount } from "@/server/services/imports";
import { MappingStep, PreviewActions, RollbackForm, RowDecision, type MappingColumn } from "@/components/import-wizard";
import type { RowIssue } from "@/lib/import/normalize";
import type { FieldChange } from "@/lib/import/match";

export const dynamic = "force-dynamic";

const RESULT: Record<string, { label: string; cls: string }> = {
  NEW: { label: "Yeni", cls: "border-teal-ink text-teal-ink" },
  MATCHED: { label: "Eşleşti, değişiklik var", cls: "border-ink text-ink" },
  UNCHANGED: { label: "Eşleşti, değişiklik yok", cls: "border-line text-muted" },
  CONFLICT: { label: "Çakışma", cls: "border-warn bg-warn-bg text-warn-ink" },
  MULTI_MATCH: { label: "Birden fazla muhtemel eşleşme", cls: "border-warn text-warn-ink" },
  POSSIBLE: { label: "Olası eşleşme (inceleme)", cls: "border-warn text-warn-ink" },
  INVALID: { label: "Hatalı", cls: "border-critical text-critical" },
  DUP_IN_FILE: { label: "Dosya içi mükerrer", cls: "border-critical text-critical" },
};
const TABS: [string, string, string[]][] = [
  ["all", "Tümü", []],
  ["new", "Yeni", ["NEW"]],
  ["matched", "Eşleşen", ["MATCHED", "UNCHANGED"]],
  ["conflict", "Çakışma", ["CONFLICT"]],
  ["review", "İnceleme", ["MULTI_MATCH", "POSSIBLE"]],
  ["invalid", "Hatalı / mükerrer", ["INVALID", "DUP_IN_FILE"]],
];
const FIELD_LABEL = Object.fromEntries(FIELDS.map((f) => [f.key, f.label]));

function maskSample(v: unknown, field: string | null, canNotes: boolean): string {
  const s = v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? "").trim();
  if (!s) return "";
  const sens = field ? FIELD_BY_KEY.get(field)?.sensitivity : null;
  if (sens === "F") return "•••••";
  if (sens === "N" && !canNotes) return "[gizli]";
  if (sens === "I") return s.length <= 4 ? "***" : `${s.slice(0, 3)}***${s.slice(-2)}`;
  if (sens === "KM") return s.slice(0, 4) + "…";
  return s.length > 40 ? s.slice(0, 40) + "…" : s;
}

type Stored = {
  fields: Record<string, string>;
  phones: { masked?: string; ok: boolean; error?: string; changed?: boolean }[];
  consent: Record<string, string>;
  issues: RowIssue[];
  changes?: FieldChange[];
  consentPlan?: { channel: string; from: string | null; to: string; action: string }[];
  match?: { candidateIds?: string[] };
};

export default async function ImportDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const user = await requirePage("import.view");
  const { id } = await params;
  const { tab = "all" } = await searchParams;
  const b = await db.importBatch.findUnique({ where: { id } });
  if (!b) notFound();
  const uploader = await db.user.findUnique({ where: { id: b.uploadedById }, select: { name: true } });
  const summary = (b.summary ?? {}) as Record<string, unknown>;
  const canNotes = can(user, "field.notes");

  const header = (
    <div className="flex flex-col gap-3">
      <Link href="/imports" className="text-sm text-teal-ink hover:underline">‹ İçe aktarmalar</Link>
      <div>
        <p className="eyebrow">İÇE AKTARMA</p>
        <h1 className="page-title">{b.fileName}</h1>
      </div>
      <dl className="flex flex-wrap gap-x-8 gap-y-1 rounded-lg border border-line bg-card px-4 py-3 text-sm">
        <div><dt className="inline text-muted">Amaç: </dt><dd className="inline">{{ NEW_LIST: "Yeni liste", UPDATE: "Güncelleme", COMPARE: "Karşılaştırma" }[b.purpose]}</dd></div>
        <div><dt className="inline text-muted">Kaynak: </dt><dd className="inline">{b.sourceLabel}</dd></div>
        <div><dt className="inline text-muted">Yükleyen: </dt><dd className="inline">{uploader?.name}</dd></div>
        <div><dt className="inline text-muted">Tarih: </dt><dd className="inline">{b.createdAt.toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" })}</dd></div>
        <div><dt className="inline text-muted">SHA-256: </dt><dd className="inline font-mono text-xs">{b.fileSha256.slice(0, 12)}…</dd></div>
        <div>
          <dt className="inline text-muted">Tarama: </dt>
          <dd className={"inline " + (b.scanResult === "CLEAN" ? "text-ok" : b.scanResult === "SKIPPED" ? "text-warn-ink" : "text-critical")}>
            {b.scanResult === "SKIPPED" ? "yapılmadı (ClamAV yapılandırılmamış)" : b.scanResult === "CLEAN" ? "temiz" : b.scanResult}
          </dd>
        </div>
        {b.matchKey && <div><dt className="inline text-muted">Eşleştirme: </dt><dd className="inline">{{ CRM_ID: "CRM ID", EXTERNAL_ID: "Dış kimlik", PHONE_PLUS: "Telefon + doğrulayıcı" }[b.matchKey]}</dd></div>}
      </dl>
    </div>
  );

  if (b.status === "REJECTED") {
    return (
      <div className="flex flex-col gap-5">
        {header}
        <p className="callout-critical">Dosya reddedildi: {b.scanResult?.startsWith("INFECTED") || b.scanResult?.startsWith("ERROR") ? b.scanResult : String(summary.parseError ?? "")}</p>
      </div>
    );
  }

  if (b.status === "SCANNED" || b.status === "MAPPED") {
    if (!can(user, "import.create")) return <div className="flex flex-col gap-5">{header}<p className="callout-info">Eşleme bekleniyor.</p></div>;
    const parsed = await parseFile(b.fileName, await getDecrypted(b.storageKey!), b.sheetName);
    const mapping = (b.mapping as Mapping) ?? {};
    const columns: MappingColumn[] = parsed.headers.map((h) => ({
      header: h,
      suggested: mapping[h] ?? null,
      samples: parsed.rows.slice(0, 3).map((r) => maskSample(r[h], mapping[h] ?? null, canNotes)).filter(Boolean),
    }));
    return (
      <div className="flex flex-col gap-5">
        {header}
        <h2 className="text-lg font-bold text-ink">2 · Sütunları eşleştir</h2>
        <MappingStep batchId={b.id} columns={columns} fields={FIELDS.map((f) => ({ key: f.key, label: f.label }))} sheets={parsed.sheets} sheet={parsed.sheet} />
      </div>
    );
  }

  const results = TABS.find((t) => t[0] === tab)?.[2] ?? [];
  const rows = await db.importRow.findMany({
    where: { batchId: b.id, ...(results.length ? { result: { in: results } } : {}) },
    orderBy: { rowNo: "asc" },
    take: 200,
  });
  const pending = b.status === "PREVIEWED" ? await pendingDecisionCount(b.id) : 0;
  const n = (k: string) => Number(summary[k] ?? 0);
  const applied = summary.applied as Record<string, number> | undefined;
  const rollback = summary.rollback as { reverted: number; guestsRemoved: number; conflicts: { rowNo: number; reason: string }[] } | undefined;

  return (
    <div className="flex flex-col gap-5">
      {header}

      <section aria-label="Önizleme özeti" className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Yeni kayıt" value={n("new")} />
        <Stat label="Mevcutla eşleşen" value={n("matched")} sub={`${n("changed")} değişiklikli · ${n("unchanged")} aynı`} />
        <Stat label="Çakışma / mükerrer" value={n("conflict") + n("multi") + n("possible") + n("dupInFile")} tone="warn" sub={`${n("conflict")} alan çakışması · ${n("multi") + n("possible")} şüpheli · ${n("dupInFile")} dosya içi`} />
        <Stat label="Geçersiz tel. / zorunlu eksik" value={`${n("invalidPhones")} / ${n("missingRequired")}`} tone="critical" />
        <Stat label="İzin durumu eksik" value={n("consentMissing")} sub={n("consentConflicts") ? `${n("consentConflicts")} ret çakışması` : undefined} />
        <Stat label="Hatalı satır" value={n("invalid")} tone="critical" />
      </section>

      {n("financialColumns") > 0 && (
        <p className="callout-warn">{n("financialColumns")} finansal sütun tanındı. Bu sütunlar CRM&apos;e alınmaz, önizlemede gösterilmez; finans verisi yalnız finans modülünden yüklenir.</p>
      )}

      {b.status === "PREVIEWED" && (
        <PreviewActions batchId={b.id} pending={pending} canApply={can(user, "import.apply")} compareOnly={b.purpose === "COMPARE"} />
      )}

      {b.status === "APPLIED" && applied && (
        <div className="flex flex-col gap-3">
          <p className="callout-info">
            Uygulandı ({b.appliedAt?.toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" })}): {applied.created} yeni misafir, {applied.updated} güncellenen, {applied.phonesAdded} yeni numara, {applied.consents} izin kaydı, {applied.review} inceleme kuyruğuna.{" "}
            <Link href="/review" className="font-semibold text-teal-ink hover:underline">İnceleme kuyruğu ›</Link>
          </p>
          <div className="flex flex-wrap gap-3">
            <a href={`/api/imports/${b.id}/errors`} className="btn-secondary">Hata raporunu indir (.xlsx)</a>
          </div>
          {can(user, "import.rollback") && <RollbackForm batchId={b.id} />}
        </div>
      )}
      {b.status === "ROLLED_BACK" && rollback && (
        <div className="callout-warn">
          <p className="font-semibold">Geri alındı · {rollback.reverted} kayıt eski haline döndü, {rollback.guestsRemoved} misafir kaldırıldı.</p>
          {rollback.conflicts.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-xs">
              {rollback.conflicts.slice(0, 50).map((c, i) => <li key={i}>Satır {c.rowNo}: {c.reason}</li>)}
            </ul>
          )}
        </div>
      )}

      <nav aria-label="Satır filtresi" className="flex flex-wrap gap-2">
        {TABS.map(([k, l]) => (
          <Link key={k} href={`?tab=${k}`} aria-current={tab === k ? "page" : undefined} className={"rounded border px-3 py-1.5 text-sm " + (tab === k ? "border-ink bg-ink text-cream" : "border-line bg-white hover:bg-card")}>
            {l}
          </Link>
        ))}
      </nav>

      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="table-ink min-w-[980px]">
          <thead>
            <tr>
              <th scope="col">Satır</th>
              <th scope="col">Durum</th>
              <th scope="col">Ad soyad</th>
              <th scope="col">Telefon</th>
              <th scope="col">Arama izni</th>
              <th scope="col">Ayrıntı / karar</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={6} className="py-6 text-center text-muted">Bu filtrede satır yok.</td></tr>}
            {rows.map((r) => {
              const s = r.normalized as unknown as Stored;
              const decisions = (r.decisions as Record<string, string> | null) ?? {};
              const res = RESULT[r.result ?? ""] ?? { label: r.result ?? "", cls: "border-line" };
              return (
                <tr key={String(r.id)}>
                  <td className="font-mono text-xs">{r.rowNo}</td>
                  <td><span className={`pill ${res.cls}`}>{res.label}</span></td>
                  <td>
                    {r.guestId ? <Link href={`/guests/${r.guestId}`} className="hover:underline">{s.fields.firstName} {s.fields.lastName}</Link> : <>{s.fields.firstName} {s.fields.lastName}</>}
                  </td>
                  <td className="font-mono text-xs">
                    {s.phones.map((p, i) => (
                      <div key={i}>{p.ok ? <>{p.masked}{p.changed ? <span className="ml-1 font-sans text-muted">(düzeltildi)</span> : null}</> : <span className="text-critical">geçersiz</span>}</div>
                    ))}
                  </td>
                  <td className="text-xs">{{ GRANTED: "Evet", DENIED: "Hayır", UNKNOWN: "Bilinmiyor" }[s.consent.CALL ?? "UNKNOWN"] ?? "Bilinmiyor"}</td>
                  <td className="flex flex-col gap-2 text-xs">
                    {s.issues.map((i, k) => (
                      <span key={k} className={i.severity === "error" ? "text-critical" : "text-warn-ink"}>{i.code} · {i.message}</span>
                    ))}
                    {s.changes?.map((c) => (
                      <div key={c.field} className="flex flex-col gap-1">
                        <span>
                          <b>{FIELD_LABEL[c.field] ?? c.field}</b>: {c.old ?? "∅"} → {c.new}
                          {c.action === "FILL" && <span className="ml-1 text-teal-ink">(boş alan doldurulacak)</span>}
                        </span>
                        {c.action === "CONFLICT" && b.status === "PREVIEWED" && can(user, "import.apply") && (
                          <RowDecision batchId={b.id} rowNo={r.rowNo} field={c.field} current={decisions[c.field]} />
                        )}
                      </div>
                    ))}
                    {s.consentPlan?.map((c) => (
                      <span key={c.channel} className={c.action === "CONFLICT" ? "text-critical" : ""}>
                        İzin {c.channel}: {c.from ?? "yok"} → {c.to}{c.action === "CONFLICT" ? " · sistemde ret/durdurma var, ezilmez → inceleme" : ""}
                      </span>
                    ))}
                    {s.match?.candidateIds && <span className="text-warn-ink">{s.match.candidateIds.length} aday kayıt · inceleme kuyruğuna gider</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows.length === 200 && <p className="text-xs text-muted">İlk 200 satır gösteriliyor. Tüm hatalı satırlar için hata raporunu indirin.</p>}
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: number | string; sub?: string; tone?: "warn" | "critical" }) {
  const border = tone === "warn" ? "border-warn" : tone === "critical" ? "border-critical/50" : "border-line";
  return (
    <div className={`rounded-lg border ${border} bg-card p-3`}>
      <p className="text-[11px] font-bold uppercase tracking-wider text-muted">{label}</p>
      <p className="stat-value">{typeof value === "number" ? value.toLocaleString("tr-TR") : value}</p>
      {sub && <p className="text-xs text-muted">{sub}</p>}
    </div>
  );
}
