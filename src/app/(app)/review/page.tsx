import Link from "next/link";
import { can, requirePage } from "@/server/auth/rbac";
import { listReview, REVIEW_KINDS } from "@/server/services/review";
import { ReviewDecision, type ReviewAction } from "@/components/review-card";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, string> = {
  POSSIBLE_DUPLICATE: "Olası mükerrer",
  MULTI_MATCH: "Birden fazla muhtemel eşleşme",
  FIELD_CONFLICT: "Alan çakışması",
  CONSENT_CONFLICT: "İzin çakışması",
  DISPUTED_PHONE: "Tartışmalı numara",
};
const FIELD_LABEL: Record<string, string> = {
  firstName: "Ad", lastName: "Soyad", language: "Dil", country: "Ülke", city: "Şehir", birthYear: "Doğum yılı", vipLevel: "VIP",
};
const CH: Record<string, string> = { CALL: "Arama", SMS: "SMS", WHATSAPP: "WhatsApp", EMAIL: "E-posta" };
const STATUS_TR: Record<string, string> = { GRANTED: "izin var", DENIED: "reddedildi", UNKNOWN: "bilinmiyor" };

const ACTIONS: Record<string, ReviewAction[]> = {
  POSSIBLE_DUPLICATE: [
    { value: "MERGE", label: "Seçili kayıtla birleştir", tone: "primary", needsTarget: true },
    { value: "CREATE_NEW", label: "Farklı kişi — yeni kayıt aç" },
    { value: "DISMISS", label: "Satırı reddet" },
  ],
  FIELD_CONFLICT: [
    { value: "KEEP_CURRENT", label: "Mevcut değeri koru", tone: "primary" },
    { value: "USE_INCOMING", label: "Yeni değeri kullan" },
  ],
  CONSENT_CONFLICT: [
    { value: "KEEP_CURRENT", label: "Ret korunsun", tone: "primary" },
    { value: "ACCEPT_INCOMING", label: "Yeni izni kanıtla kabul et", needsProof: true },
  ],
  DISPUTED_PHONE: [
    { value: "REMOVE_PHONE", label: "Numarayı misafirden kaldır", tone: "danger" },
    { value: "CONFIRM_OWNER", label: "Numara misafire ait — doğrula" },
    { value: "DISMISS", label: "Kapat" },
  ],
};
ACTIONS.MULTI_MATCH = ACTIONS.POSSIBLE_DUPLICATE;

export default async function ReviewPage({ searchParams }: { searchParams: Promise<{ kind?: string; status?: string }> }) {
  const user = await requirePage("review.view");
  const sp = await searchParams;
  const { items, counts, guests } = await listReview({ kind: sp.kind, status: sp.status });
  const canResolve = can(user, "review.resolve") && sp.status !== "RESOLVED";
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const gLabel = (id: string) => {
    const g = guests.get(id);
    if (!g) return "Kayıt bulunamadı";
    return `CRM-${String(g.crmNo).padStart(6, "0")} · ${g.firstName} ${g.lastName}${g.birthYear ? ` · ${g.birthYear}` : ""}${g.city ? ` · ${g.city}` : ""} · ${g.phones.map((p) => p.masked).join(", ") || "telefon yok"}`;
  };

  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="eyebrow">VERİ KALİTESİ</p>
        <h1 className="page-title">İnceleme kuyruğu</h1>
        <p className="mt-1 text-sm text-muted">Şüpheli eşleşmeler otomatik birleştirilmez; burada bir kişi karar verir. {total} açık kayıt.</p>
      </div>

      <nav aria-label="Tür filtresi" className="flex flex-wrap gap-2">
        <Link href="/review" className={"rounded border px-3 py-1.5 text-sm " + (!sp.kind && !sp.status ? "border-ink bg-ink text-cream" : "border-line bg-white")}>Tümü ({total})</Link>
        {REVIEW_KINDS.map((k) => (
          <Link key={k} href={`?kind=${k}`} className={"rounded border px-3 py-1.5 text-sm " + (sp.kind === k ? "border-ink bg-ink text-cream" : "border-line bg-white")}>
            {KIND_LABEL[k]} ({counts[k] ?? 0})
          </Link>
        ))}
        <Link href="?status=RESOLVED" className={"rounded border px-3 py-1.5 text-sm " + (sp.status === "RESOLVED" ? "border-ink bg-ink text-cream" : "border-line bg-white")}>Karar verilenler</Link>
      </nav>

      {items.length === 0 && <p className="callout-info">Bu filtrede kayıt yok.</p>}

      <ul className="flex flex-col gap-4">
        {items.map((it) => {
          const p = (it.payload ?? {}) as Record<string, unknown>;
          const candIds = Array.isArray(it.candidates) ? (it.candidates as string[]) : [];
          const incoming = (p.incoming ?? {}) as Record<string, unknown>;
          return (
            <li key={it.id} className="card bg-white">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-semibold text-ink">
                  <span className="pill mr-2 border-warn text-warn-ink">{KIND_LABEL[it.kind] ?? it.kind}</span>
                  {it.guestId && <Link href={`/guests/${it.guestId}`} className="text-teal-ink hover:underline">{gLabel(it.guestId)}</Link>}
                </p>
                <span className="text-xs text-muted">
                  {it.sourceRef?.startsWith("import:") ? (
                    <Link href={`/imports/${it.sourceRef.slice(7)}`} className="hover:underline">İçe aktarma · satır {String(p.rowNo ?? "")}</Link>
                  ) : (
                    it.sourceRef
                  )}{" "}
                  · {it.createdAt.toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" })}
                </span>
              </div>

              <div className="mt-2 text-sm">
                {(it.kind === "POSSIBLE_DUPLICATE" || it.kind === "MULTI_MATCH") && (
                  <div className="grid gap-3 md:grid-cols-2">
                    <div>
                      <p className="label">Dosyadaki kayıt</p>
                      <p>
                        {String(incoming.firstName ?? "")} {String(incoming.lastName ?? "")}
                        {incoming.birthYear ? ` · ${String(incoming.birthYear)}` : ""}
                        {incoming.city ? ` · ${String(incoming.city)}` : ""}
                      </p>
                      <p className="font-mono text-xs">{((incoming.phones as string[]) ?? []).join(", ")}</p>
                      <p className="mt-1 text-xs text-warn-ink">
                        {p.reason === "PHONE_ONLY" || p.reason === "NAME_CONFLICT" ? "Yalnız telefon eşleşiyor; isim/doğum yılı doğrulamıyor." : "Birden fazla kayıtla eşleşiyor."}
                      </p>
                    </div>
                    <div>
                      <p className="label">Sistemdeki aday kayıtlar</p>
                      <ul className="flex flex-col gap-1">
                        {candIds.map((c) => <li key={c}><Link href={`/guests/${c}`} className="text-teal-ink hover:underline">{gLabel(c)}</Link></li>)}
                      </ul>
                    </div>
                  </div>
                )}
                {it.kind === "FIELD_CONFLICT" && (
                  <p><b>{FIELD_LABEL[String(p.field)] ?? String(p.field)}</b>: mevcut “{String(p.current ?? "∅")}” · dosyadaki “{String(p.incoming)}”</p>
                )}
                {it.kind === "CONSENT_CONFLICT" && (
                  <p className="callout-warn">
                    <b>{CH[String(p.channel)] ?? String(p.channel)} izni</b>: sistemde “{STATUS_TR[String(p.current)] ?? "kayıt yok / durdurulmuş"}”, dosyada “{STATUS_TR[String(p.incoming)] ?? String(p.incoming)}”.
                    Ret kaydı yeni kanıt olmadan değiştirilmez.
                  </p>
                )}
                {it.kind === "DISPUTED_PHONE" && (
                  <p>Çağrıda “yanlış kişi” bildirildi: <span className="font-mono">{String((it.candidates as { masked?: string })?.masked ?? "")}</span>. Numara bu misafire ait olmayabilir; kuyruktan çıkarıldı.</p>
                )}
                {it.status !== "OPEN" && (
                  <p className="mt-2 text-xs text-muted">Karar: {it.decision} · {it.reason} · {it.decidedAt?.toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" })}</p>
                )}
              </div>

              {canResolve && it.status === "OPEN" && (
                <ReviewDecision id={it.id} actions={ACTIONS[it.kind] ?? []} candidates={candIds.map((c) => ({ id: c, label: gLabel(c) }))} />
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
