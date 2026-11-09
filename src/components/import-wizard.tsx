"use client";

import { useActionState, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import {
  applyAction,
  decideAllAction,
  decideRowAction,
  rollbackAction,
  saveMappingAction,
  uploadAction,
} from "@/app/(app)/imports/actions";

const ERR: Record<string, string> = {
  NO_FILE: "Dosya seçin.",
  TOO_LARGE: "Dosya 50 MB sınırını aşıyor.",
  MACRO: "Makro içeren dosyalar kabul edilmez (.xlsm). Dosyayı .xlsx olarak kaydedin.",
  UNSUPPORTED_TYPE: "Desteklenmeyen dosya türü. Yalnız .xlsx ve .csv.",
  ENCRYPTED: "Şifreli veya eski biçimli (.xls) dosya. .xlsx olarak kaydedin.",
  CORRUPT: "Dosya okunamadı (bozuk olabilir).",
  NO_HEADER: "İlk satırda başlık bulunamadı.",
  EMPTY: "Dosyada veri satırı yok.",
  TOO_MANY_ROWS: "Satır sayısı 500.000 sınırını aşıyor.",
  INFECTED: "Dosyada zararlı içerik bulundu; işlenmedi.",
  SCAN_ERROR: "Virüs taraması yapılamadı; dosya işlenmedi.",
  NAME_REQUIRED: "Ad ve soyad (veya birleşik ad soyad) sütunu eşlenmeli; ya da CRM ID.",
  KEY_REQUIRED: "Eşleştirme için CRM ID, dış kimlik, telefon veya e-posta sütunu gerekli.",
  DUPLICATE_TARGET: "Aynı CRM alanı birden fazla sütuna eşlenmiş.",
  DECISIONS_PENDING: "Karar bekleyen çakışmalar var.",
  FILE_EXPIRED: "Kaynak dosyanın saklama süresi dolmuş.",
  FORBIDDEN: "Bu işlem için yetkiniz yok.",
  INVALID_INPUT: "Alanları kontrol edin.",
};
const errText = (e: string) => ERR[e.split(":")[0]] ?? e;

export function UploadForm() {
  const [state, action, pending] = useActionState(uploadAction, undefined);
  return (
    <form action={action} className="card flex flex-col gap-4">
      <h2 className="card-title">Yeni dosya yükle</h2>
      <div className="grid gap-4 md:grid-cols-[2fr_1fr_1fr_1fr]">
        <div>
          <label htmlFor="file" className="label">Dosya (.xlsx, .csv · en fazla 50 MB)</label>
          <input id="file" name="file" type="file" accept=".xlsx,.csv" required className="input py-2" />
        </div>
        <div>
          <label htmlFor="purpose" className="label">Amaç</label>
          <select id="purpose" name="purpose" className="input" defaultValue="NEW_LIST">
            <option value="NEW_LIST">Yeni liste</option>
            <option value="UPDATE">Mevcut listeyi güncelle</option>
            <option value="COMPARE">Yalnız karşılaştır</option>
          </select>
        </div>
        <div>
          <label htmlFor="sourceLabel" className="label">Kaynak</label>
          <input id="sourceLabel" name="sourceLabel" required minLength={2} className="input" placeholder="ör. Casino A Ekim listesi" />
        </div>
        <div>
          <label htmlFor="defaultCountry" className="label">Varsayılan ülke kodu</label>
          <input id="defaultCountry" name="defaultCountry" defaultValue="TR" maxLength={2} pattern="[A-Z]{2}" className="input uppercase" />
        </div>
      </div>
      <p className="text-xs text-muted">
        Dosya virüs taramasından geçer, şifreli geçici alanda 30 gün tutulur. Finansal sütunlar CRM&apos;e alınmaz ve önizlemede gösterilmez.
      </p>
      {state?.error && <p role="alert" className="callout-critical">{errText(state.error)}</p>}
      <div>
        <button className="btn-primary" disabled={pending}>
          <Upload size={16} aria-hidden /> {pending ? "Yükleniyor ve taranıyor…" : "Yükle ve tara"}
        </button>
      </div>
    </form>
  );
}

export interface MappingColumn {
  header: string;
  suggested: string | null;
  samples: string[];
}

export function MappingStep({
  batchId,
  columns,
  fields,
  sheets,
  sheet,
}: {
  batchId: string;
  columns: MappingColumn[];
  fields: { key: string; label: string }[];
  sheets: string[];
  sheet: string;
}) {
  const router = useRouter();
  const [mapping, setMapping] = useState<Record<string, string | null>>(() => Object.fromEntries(columns.map((c) => [c.header, c.suggested])));
  const [sel, setSel] = useState(sheet);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const dupTargets = useMemo(() => {
    const cnt = new Map<string, number>();
    Object.values(mapping).forEach((v) => v && v !== "financial" && cnt.set(v, (cnt.get(v) ?? 0) + 1));
    return new Set([...cnt].filter(([, n]) => n > 1).map(([k]) => k));
  }, [mapping]);

  return (
    <div className="flex flex-col gap-4">
      {sheets.length > 1 && (
        <div className="max-w-xs">
          <label htmlFor="sheet" className="label">Sayfa</label>
          <select id="sheet" value={sel} onChange={(e) => setSel(e.target.value)} className="input">
            {sheets.map((s) => <option key={s}>{s}</option>)}
          </select>
          <p className="mt-1 text-xs text-muted">Sayfa değişirse sütunlar önizlemede yeniden okunur.</p>
        </div>
      )}
      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="table-ink min-w-[760px]">
          <thead>
            <tr>
              <th scope="col">Excel sütunu</th>
              <th scope="col">Örnek değerler</th>
              <th scope="col">CRM alanı</th>
            </tr>
          </thead>
          <tbody>
            {columns.map((c) => (
              <tr key={c.header}>
                <td className="font-semibold">{c.header}</td>
                <td className="text-xs text-muted">{c.samples.join(" · ") || "—"}</td>
                <td>
                  <label className="sr-only" htmlFor={`m-${c.header}`}>{c.header} için CRM alanı</label>
                  <select
                    id={`m-${c.header}`}
                    value={mapping[c.header] ?? ""}
                    onChange={(e) => setMapping({ ...mapping, [c.header]: e.target.value || null })}
                    className={"input min-h-9 " + (mapping[c.header] && dupTargets.has(mapping[c.header]!) ? "border-critical" : "")}
                  >
                    <option value="">— Yok say —</option>
                    {fields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="callout-info">
        Eşleştirme sırası: önce CRM ID, sonra casino oyuncu kimliği, en son telefon + ek doğrulayıcı (ad-soyad benzerliği, doğum yılı veya e-posta).
        Telefon tek başına kesin kimlik sayılmaz; şüpheli eşleşmeler inceleme kuyruğuna gider.
      </p>
      {err && <p role="alert" className="callout-critical">{errText(err)}</p>}
      <div>
        <button
          className="btn-primary"
          disabled={pending || dupTargets.size > 0}
          onClick={() =>
            start(async () => {
              setErr(null);
              const r = await saveMappingAction(batchId, mapping, sel);
              if (!r.ok) setErr(r.error);
              else router.refresh();
            })
          }
        >
          {pending ? "Satırlar doğrulanıyor…" : "Eşlemeyi kaydet ve önizle ▸"}
        </button>
      </div>
    </div>
  );
}

export function RowDecision({ batchId, rowNo, field, current }: { batchId: string; rowNo: number; field: string; current?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const opts: [string, string][] = [["KEEP", "Mevcut değeri koru"], ["USE_NEW", "Yeni değeri kullan"], ["REVIEW", "İncelemeye gönder"]];
  return (
    <div role="group" aria-label={`${field} kararı`} className="flex flex-wrap gap-1">
      {opts.map(([v, l]) => (
        <button
          key={v}
          type="button"
          disabled={pending}
          aria-pressed={current === v}
          onClick={() => start(async () => { await decideRowAction(batchId, rowNo, { [field]: v as "KEEP" }); router.refresh(); })}
          className={"rounded border px-2 py-1 text-xs " + (current === v ? "border-ink bg-ink text-cream" : "border-line bg-white hover:bg-card")}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

export function PreviewActions({ batchId, pending: pendingCount, canApply, compareOnly }: { batchId: string; pending: number; canApply: boolean; compareOnly: boolean }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {pendingCount > 0 && canApply && (
          <>
            <span className="text-sm font-semibold text-warn-ink">{pendingCount} çakışmalı satır karar bekliyor · toplu:</span>
            {(["KEEP", "REVIEW", "USE_NEW"] as const).map((d) => (
              <button
                key={d}
                type="button"
                className="btn-secondary min-h-9"
                disabled={busy}
                onClick={() => start(async () => { await decideAllAction(batchId, d); router.refresh(); })}
              >
                {d === "KEEP" ? "Hepsinde mevcut değeri koru" : d === "REVIEW" ? "Hepsini incelemeye gönder" : "Hepsinde yeni değeri kullan"}
              </button>
            ))}
          </>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {!compareOnly && canApply && (
          <button
            type="button"
            className="btn-teal min-h-12"
            disabled={busy || pendingCount > 0}
            onClick={() =>
              start(async () => {
                setErr(null);
                const r = await applyAction(batchId);
                if (r.ok) { setDone(r.data.queued ? "Büyük dosya: uygulama arka planda sürüyor; tamamlanınca bu sayfa güncellenir." : `Uygulandı: ${r.data.created} yeni, ${r.data.updated} güncellenen, ${r.data.review} incelemeye gönderilen kayıt.`); router.refresh(); }
                else setErr(r.error);
              })
            }
          >
            {busy ? "Uygulanıyor…" : "Uygula ▸"}
          </button>
        )}
        <a href={`/api/imports/${batchId}/errors`} className="btn-secondary min-h-12">Hata raporunu indir (.xlsx)</a>
        {pendingCount > 0 && !compareOnly && <span className="text-sm text-warn-ink">Karar verilmeden mevcut veri değiştirilmez.</span>}
        {compareOnly && <span className="text-sm text-muted">Bu yükleme yalnız karşılaştırma amaçlı; veritabanına yazılmaz.</span>}
      </div>
      {err && <p role="alert" className="callout-critical">{errText(err)}</p>}
      {done && <p role="status" className="callout-info">{done}</p>}
    </div>
  );
}

export function RollbackForm({ batchId }: { batchId: string }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, start] = useTransition();
  return (
    <form
      className="callout-warn flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await rollbackAction(batchId, reason);
          if (r.ok) router.refresh();
          else setErr(r.error);
        });
      }}
    >
      <p className="font-semibold">İçe aktarmayı geri al</p>
      <p className="text-xs">
        Yalnız bu dosyanın yaptığı ve sonradan değişmemiş değişiklikler geri alınır. Aranmış misafirler silinmez, ret kayıtları geri alınmaz; atlananlar raporlanır.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-72 flex-1">
          <label htmlFor="rb-reason" className="label">Gerekçe</label>
          <input id="rb-reason" value={reason} onChange={(e) => setReason(e.target.value)} required minLength={5} className="input" />
        </div>
        <button className="btn-danger" disabled={busy}>Geri al</button>
      </div>
      {err && <p role="alert" className="text-sm font-semibold text-critical">{errText(err)}</p>}
    </form>
  );
}
