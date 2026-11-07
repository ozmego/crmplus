"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Phone, PhoneOff, PhoneCall, Clock, ShieldCheck, Languages } from "lucide-react";
import { answerCallAction, closeCallAction, endCallAction, startCallAction } from "@/app/(app)/queue/actions";

export interface QueueRow {
  taskId: string;
  crm: string;
  name: string;
  language: string;
  timezone: string;
  phone: string;
  phoneState: string;
  consentSource: string | null;
  recordingPref: string | null;
  reason: string;
  assignedAt: string;
  callbackAt: string | null;
  callbackState: "DUE" | "LATE" | "MISSED" | "PENDING" | null;
  lastCall: { at: string; disposition: string | null; talkSec: number | null } | null;
}

interface OpenCall {
  callId: string;
  taskId: string | null;
  startedAt: string;
  answeredAt: string | null;
  endedAt: string | null;
}

type Phase = "idle" | "dialing" | "connected" | "wrap";

const ERRORS: Record<string, string> = {
  OPEN_CALL_EXISTS: "Açık bir çağrınız var; önce onu kapatın.",
  NOT_ELIGIBLE: "Bu misafir artık aranamaz (izin, durdurma veya numara durumu değişti). Görev kuyruktan çıkarıldı.",
  TASK_NOT_FOUND: "Görev bulunamadı veya size atanmamış.",
  NOTE_REQUIRED: "Bu sonuç kodu için en az 10 karakterlik not gerekli.",
  CALLBACK_TIME_REQUIRED: "Geri arama zamanı seçin.",
  CALLBACK_IN_PAST: "Geri arama zamanı gelecekte olmalı.",
  LANGUAGE_REQUIRED: "Misafirin dilini seçin.",
  FORBIDDEN: "Bu işlem için yetkiniz yok.",
};

const PHONE_STATE: Record<string, string> = {
  UNVERIFIED: "Biçim geçerli · erişim doğrulanmadı",
  REACHED: "Son çağrıda ulaşıldı",
  UNREACHED: "Son denemede ulaşılamadı",
};

const LANGS = [
  ["tr", "Türkçe"], ["en", "İngilizce"], ["ru", "Rusça"], ["ar", "Arapça"], ["fa", "Farsça"], ["de", "Almanca"],
] as const;

const pad = (n: number) => String(n).padStart(2, "0");
const clock = (s: number) => `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;

export function CallWorkspace({
  rows,
  dispositions,
  openCall,
  locale,
}: {
  rows: QueueRow[];
  dispositions: { code: string; label: string; noteRequired: boolean }[];
  openCall: OpenCall | null;
  locale: string;
}) {
  const t = useTranslations("queue");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<string | null>(openCall?.taskId ?? rows[0]?.taskId ?? null);
  const [call, setCall] = useState<OpenCall | null>(openCall);
  const [now, setNow] = useState(() => Date.now());
  const [disp, setDisp] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [cbAt, setCbAt] = useState("");
  const [lang, setLang] = useState("");
  const [dncAll, setDncAll] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  /**
   * Manuel mod: softphone'u temsilci kendi tıklamasıyla açar. tel: bağlantısını otomatik açmak
   * (window.location / iframe) tarayıcının süren sunucu eylemi akışını kesmesine ve sonraki çağrı
   * düğmelerinin kilitlenmesine yol açıyor. Santral modunda dialUri gelmez, bağlantı gösterilmez.
   */
  const [dialUri, setDialUri] = useState<string | null>(null);

  const phase: Phase = !call ? "idle" : call.endedAt ? "wrap" : call.answeredAt ? "connected" : "dialing";
  const row = rows.find((r) => r.taskId === (call?.taskId ?? selected)) ?? rows[0] ?? null;

  useEffect(() => {
    if (phase !== "dialing" && phase !== "connected") return;
    const h = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(h);
  }, [phase]);

  const elapsed = useMemo(() => {
    if (!call) return 0;
    const from = new Date(call.answeredAt ?? call.startedAt).getTime();
    const to = call.endedAt ? new Date(call.endedAt).getTime() : now;
    return Math.max(0, Math.round((to - from) / 1000));
  }, [call, now]);

  // Sonuç girişinde 1–9 kısayolları (metin alanındayken devre dışı)
  useEffect(() => {
    if (phase !== "wrap") return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "TEXTAREA" || tag === "INPUT" || tag === "SELECT") return;
      const n = Number(e.key);
      if (n >= 1 && n <= dispositions.length) setDisp(dispositions[n - 1].code);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, dispositions]);

  const fmtTime = (iso: string, tz?: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short", timeZone: tz ?? "Europe/Istanbul" }).format(new Date(iso));
  const guestLocal = row
    ? new Intl.DateTimeFormat(locale, { timeStyle: "short", timeZone: row.timezone }).format(new Date(now))
    : "";

  function act<T>(fn: () => Promise<{ ok: true; data: T } | { ok: false; error: string }>, onOk: (d: T) => void) {
    setError(null);
    startTransition(async () => {
      const r = await fn();
      if (r.ok) onOk(r.data);
      else {
        setError(ERRORS[r.error] ?? r.error);
        if (r.error === "NOT_ELIGIBLE") router.refresh();
      }
    });
  }

  const onCall = () =>
    row &&
    act(() => startCallAction(row.taskId), (d) => {
      setCall({ callId: d.callId, taskId: row.taskId, startedAt: d.startedAt, answeredAt: null, endedAt: null });
      setFlash(null);
      setNow(Date.now());
      setDialUri(d.dialUri);
    });
  const onAnswer = () => call && act(() => answerCallAction(call.callId), (d) => setCall({ ...call, answeredAt: d.answeredAt }));
  const onEnd = () => call && act(() => endCallAction(call.callId), (d) => setCall({ ...call, endedAt: d.endedAt }));
  const onSave = () => {
    if (!call || !disp) return;
    const label = dispositions.find((d) => d.code === disp)?.label ?? disp;
    act(
      () =>
        closeCallAction({
          callId: call.callId,
          disposition: disp as never,
          note,
          callbackAt: disp === "CALLBACK_REQUESTED" && cbAt ? new Date(cbAt).toISOString() : null,
          language: disp === "LANGUAGE_SUPPORT" ? lang || null : null,
          dncAllChannels: dncAll,
        }),
      (d) => {
        setFlash(
          `${row?.name ?? ""} — ${label} kaydedildi.` +
            (d.redactedKinds.length ? " Notta hassas veri bulundu ve maskelendi." : ""),
        );
        setCall(null);
        setDisp(null);
        setNote("");
        setCbAt("");
        setLang("");
        setSelected(null);
        router.refresh();
      },
    );
  };

  const selectedDisp = dispositions.find((d) => d.code === disp);

  return (
    <div className="flex flex-wrap items-start gap-6">
      {/* Kuyruk */}
      <section aria-label={t("title")} className="flex min-w-0 flex-[1_1_320px] flex-col gap-2 md:max-w-[420px]">
        <p className="text-sm font-semibold text-muted">{rows.length} kayıt</p>
        {rows.length === 0 && <p className="callout-info">{t("empty")}</p>}
        {rows.map((r) => {
          const active = r.taskId === row?.taskId;
          return (
            <button
              key={r.taskId}
              type="button"
              disabled={!!call && !active}
              onClick={() => setSelected(r.taskId)}
              className={
                "flex flex-col gap-1 rounded-lg border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 " +
                (active ? "border-teal bg-info-bg" : "border-line bg-white hover:bg-card")
              }
            >
              <span className="flex items-center justify-between gap-2">
                <span className="font-semibold text-ink">{r.name}</span>
                {r.callbackState && r.callbackState !== "PENDING" ? (
                  <span className={"pill " + (r.callbackState === "DUE" ? "border-teal text-teal-ink" : "border-warn text-warn-ink")}>
                    <Clock size={12} aria-hidden /> {r.callbackState === "DUE" ? "Geri arama zamanı" : "Gecikmiş geri arama"}
                  </span>
                ) : (
                  <span className="pill border-line text-muted">{r.language}</span>
                )}
              </span>
              <span className="font-mono text-sm text-text">{r.phone}</span>
              <span className="text-xs text-muted">{r.reason}</span>
            </button>
          );
        })}
      </section>

      {/* Misafir + çağrı */}
      {row && (
        <section className="flex min-w-0 flex-[999_1_560px] flex-col gap-4">
          <div className="card flex flex-col gap-4 bg-white">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="eyebrow">MİSAFİR · {row.crm}</p>
                <h2 className="text-2xl font-extrabold text-ink">{row.name}</h2>
                <p className="font-mono text-base">
                  {row.phone} <span className="text-xs text-muted">· maskeli</span>
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <span className="pill border-ink bg-ink text-cream">
                  <Languages size={12} aria-hidden /> {row.language} · {t("localTime")} {guestLocal}
                </span>
                <span className="pill border-teal-ink bg-teal-ink text-white">
                  <ShieldCheck size={12} aria-hidden /> {t("consentOk")}
                  {row.consentSource ? ` · ${row.consentSource}` : ""}
                </span>
                <span className="pill border-line text-text">{PHONE_STATE[row.phoneState] ?? row.phoneState}</span>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label={t("reason")} value={row.reason} />
              <Field label={t("assigned")} value={fmtTime(row.assignedAt)} />
              <Field label={t("callback")} value={row.callbackAt ? fmtTime(row.callbackAt) : "—"} />
            </div>
            <div className="border-t border-dashed border-line pt-3">
              <Field
                label={t("lastCall")}
                value={
                  row.lastCall
                    ? `${fmtTime(row.lastCall.at)} · ${dispositions.find((d) => d.code === row.lastCall?.disposition)?.label ?? "—"}${
                        row.lastCall.talkSec ? ` · ${clock(row.lastCall.talkSec)}` : ""
                      }`
                    : t("noLastCall")
                }
              />
            </div>
          </div>

          <div className="rounded-lg border border-line bg-white p-5">
            <div className="flex flex-wrap items-center gap-6">
              <div>
                <p className="label">{t("status")}</p>
                <p className={"font-mono text-xl font-bold " + (phase === "connected" ? "text-teal-ink" : phase === "idle" ? "text-ink" : "text-warn-ink")}>
                  {t(`phase.${phase}`)}
                </p>
              </div>
              <div>
                <p className="label">{t("duration")}</p>
                <p className="font-mono text-3xl font-semibold tabular-nums text-ink" aria-live="off">{clock(elapsed)}</p>
              </div>
              <div className="ml-auto flex flex-wrap gap-3">
                {phase === "idle" && (
                  <button type="button" onClick={onCall} disabled={pending} className="btn-primary min-h-14 min-w-52 text-lg ring-teal focus-visible:ring-4">
                    <Phone size={20} aria-hidden /> {t("call")}
                  </button>
                )}
                {phase === "dialing" && (
                  <>
                    {dialUri && (
                      <a href={dialUri} className="btn-teal min-h-14 text-base">
                        <Phone size={18} aria-hidden /> Softphone&apos;da çevir
                      </a>
                    )}
                    <button type="button" onClick={onAnswer} disabled={pending} className="btn-primary min-h-14">
                      <PhoneCall size={18} aria-hidden /> {t("connected")}
                    </button>
                    <button type="button" onClick={onEnd} disabled={pending} className="btn-secondary min-h-14">
                      <PhoneOff size={18} aria-hidden /> {t("endNoAnswer")}
                    </button>
                  </>
                )}
                {phase === "connected" && (
                  <button type="button" onClick={onEnd} disabled={pending} className="btn-danger min-h-14 min-w-52 text-lg">
                    <PhoneOff size={20} aria-hidden /> {t("end")}
                  </button>
                )}
              </div>
            </div>
            <p className="mt-3 text-xs text-muted">{t("manualMode")}</p>

            {phase === "wrap" && (
              <div className="mt-5 flex flex-col gap-4 border-t border-line pt-5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-sm font-bold uppercase tracking-wider text-ink">
                    {t("disposition")} <span className="text-warn-ink">· {t("required")}</span>
                  </h3>
                  <span className="text-xs text-muted">Kısayol: 1–9</span>
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3" role="radiogroup" aria-label={t("disposition")}>
                  {dispositions.map((d, i) => {
                    const on = disp === d.code;
                    return (
                      <button
                        key={d.code}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        onClick={() => setDisp(d.code)}
                        className={
                          "flex min-h-14 flex-col items-start gap-0.5 rounded-md border px-3 py-2 text-left " +
                          (on
                            ? "border-ink bg-ink text-cream"
                            : d.code === "DO_NOT_CONTACT"
                              ? "border-critical/60 bg-white hover:bg-critical-bg"
                              : "border-line bg-white hover:bg-card")
                        }
                      >
                        <span className={"font-mono text-xs " + (on ? "text-teal" : "text-muted")}>[{i + 1}]</span>
                        <span className="text-sm font-semibold">{d.label}</span>
                      </button>
                    );
                  })}
                </div>

                {disp === "CALLBACK_REQUESTED" && (
                  <div className="max-w-xs">
                    <label htmlFor="cbat" className="label text-warn-ink">{t("callbackAt")} · {t("required")}</label>
                    <input id="cbat" type="datetime-local" value={cbAt} onChange={(e) => setCbAt(e.target.value)} className="input" />
                  </div>
                )}
                {disp === "LANGUAGE_SUPPORT" && (
                  <div className="max-w-xs">
                    <label htmlFor="lang" className="label text-warn-ink">Misafirin dili · {t("required")}</label>
                    <select id="lang" value={lang} onChange={(e) => setLang(e.target.value)} className="input">
                      <option value="">Seçin…</option>
                      {LANGS.map(([v, l]) => (
                        <option key={v} value={v}>{l}</option>
                      ))}
                    </select>
                  </div>
                )}
                {disp === "DO_NOT_CONTACT" && (
                  <div className="callout-critical flex flex-col gap-2">
                    <p>{t("dncWarning")}</p>
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={dncAll} onChange={(e) => setDncAll(e.target.checked)} />
                      Tüm kanallar (arama, SMS, WhatsApp, e-posta)
                    </label>
                  </div>
                )}

                <div>
                  <label htmlFor="note" className="label">
                    {t("note")} {selectedDisp?.noteRequired ? <span className="text-warn-ink">· {t("required")}</span> : null}
                  </label>
                  <textarea id="note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} className="input py-2" />
                  <p className="mt-1 text-xs text-muted">{t("noteHint")}</p>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <button type="button" onClick={onSave} disabled={!disp || pending} className="btn-primary min-h-12">
                    {t("saveNext")} ▸
                  </button>
                  {!disp && <span className="text-sm text-muted">{t("needDisposition")}</span>}
                </div>
              </div>
            )}

            {error && <p role="alert" className="callout-critical mt-4">{error}</p>}
            {flash && phase === "idle" && <p role="status" className="callout-info mt-4">{flash}</p>}
          </div>
        </section>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="label">{label}</p>
      <p className="text-sm text-text">{value}</p>
    </div>
  );
}
