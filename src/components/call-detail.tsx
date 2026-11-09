"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Headphones, Pencil } from "lucide-react";
import { editSegmentAction, listenAction, reviewAnalysisAction } from "@/app/(app)/calls/actions";

const ERR: Record<string, string> = {
  NOT_FOUND: "Çağrı bulunamadı veya kapsamınız dışında.",
  FORBIDDEN: "Bu işlem için yetkiniz yok.",
  INVALID_INPUT: "Gerekçe/açıklama en az 5 karakter olmalı.",
  NO_TRANSCRIPT: "Transkript yok.",
  NO_ANALYSIS: "Analiz yok.",
  COMMENT_REQUIRED: "İtiraz için açıklama zorunlu.",
  EMPTY: "Metin boş olamaz.",
};

export function ListenPanel({ callId, hasGrant, expiresAt }: { callId: string; hasGrant: boolean; expiresAt?: string }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (hasGrant) {
    return (
      <div className="flex flex-col gap-2">
        <audio controls preload="none" src={`/api/recordings/${callId}/audio`} className="w-full max-w-xl" />
        <p className="text-xs text-muted">Dinleme izniniz {expiresAt ? new Date(expiresAt).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" }) : ""} tarihine kadar geçerli. Her dinleme kayıt altına alınır. İndirme kapalıdır.</p>
      </div>
    );
  }
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await listenAction(callId, reason);
          if (r.ok) router.refresh();
          else setErr(ERR[r.error] ?? r.error);
        });
      }}
    >
      <div className="min-w-72 flex-1">
        <label htmlFor="listen-reason" className="label">Dinleme gerekçesi (kayıt altına alınır)</label>
        <input id="listen-reason" value={reason} onChange={(e) => setReason(e.target.value)} required minLength={5} className="input" placeholder="ör. kalite örneklemesi, misafir şikâyeti incelemesi" />
      </div>
      <button className="btn-primary" disabled={pending}><Headphones size={16} aria-hidden /> Dinleme izni al</button>
      {err && <p role="alert" className="w-full text-sm text-critical">{err}</p>}
    </form>
  );
}

export function TranscriptView({ callId, segments, canEdit }: { callId: string; segments: { speaker: string; start: number; text: string }[]; canEdit: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState<number | null>(null);
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const ts = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  return (
    <ol className="flex flex-col gap-2">
      {segments.map((s, i) => (
        <li key={i} className={"rounded-md border px-3 py-2 " + (s.speaker === "AGENT" ? "border-line bg-white" : "border-teal/40 bg-info-bg")}>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted">{s.speaker === "AGENT" ? "Temsilci" : "Misafir"} · {ts(s.start)}</span>
            {canEdit && editing !== i && (
              <button type="button" className="inline-flex items-center gap-1 text-xs text-teal-ink hover:underline" onClick={() => { setEditing(i); setText(s.text); }}>
                <Pencil size={12} aria-hidden /> Düzelt
              </button>
            )}
          </div>
          {editing === i ? (
            <form
              className="mt-1 flex flex-col gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                start(async () => {
                  const r = await editSegmentAction(callId, i, text);
                  if (r.ok) { setEditing(null); router.refresh(); } else setErr(ERR[r.error] ?? r.error);
                });
              }}
            >
              <label className="sr-only" htmlFor={`seg-${i}`}>Bölüm metni</label>
              <textarea id={`seg-${i}`} value={text} onChange={(e) => setText(e.target.value)} rows={2} className="input py-2" />
              <div className="flex gap-2">
                <button className="btn-primary min-h-9" disabled={pending}>Kaydet</button>
                <button type="button" className="btn-secondary min-h-9" onClick={() => setEditing(null)}>Vazgeç</button>
              </div>
              {err && <p role="alert" className="text-xs text-critical">{err}</p>}
            </form>
          ) : (
            <p className="text-sm">{s.text}</p>
          )}
        </li>
      ))}
    </ol>
  );
}

export function AnalysisReview({ callId, summary, topics, status }: { callId: string; summary: string; topics: string[]; status: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<null | "CORRECT" | "DISPUTE">(null);
  const [sum, setSum] = useState(summary);
  const [comment, setComment] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const send = (decision: "APPROVE" | "CORRECT" | "DISPUTE") =>
    start(async () => {
      const r = await reviewAnalysisAction(callId, { decision, summary: decision === "CORRECT" ? sum : undefined, topics: decision === "CORRECT" ? topics : undefined, comment: comment || undefined });
      if (r.ok) {
        setMsg(decision === "APPROVE" ? `Öneri onaylandı${r.data.callbacksCreated ? ` · ${r.data.callbacksCreated} geri arama planlandı` : ""}.` : "Kaydedildi.");
        setMode(null);
        router.refresh();
      } else setMsg(ERR[r.error] ?? r.error);
    });
  if (status !== "PENDING") return msg ? <p role="status" className="text-sm text-teal-ink">{msg}</p> : null;
  return (
    <div className="flex flex-col gap-2 border-t border-line pt-3">
      {mode === "CORRECT" && (
        <div>
          <label htmlFor="sum" className="label">Düzeltilmiş özet</label>
          <textarea id="sum" value={sum} onChange={(e) => setSum(e.target.value)} rows={3} className="input py-2" />
        </div>
      )}
      {mode && (
        <div>
          <label htmlFor="cmt" className="label">{mode === "DISPUTE" ? "İtiraz açıklaması (zorunlu)" : "Not (isteğe bağlı)"}</label>
          <input id="cmt" value={comment} onChange={(e) => setComment(e.target.value)} className="input" />
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {!mode && <button type="button" className="btn-primary min-h-9" disabled={pending} onClick={() => send("APPROVE")}>Öneriyi onayla</button>}
        {!mode && <button type="button" className="btn-secondary min-h-9" onClick={() => setMode("CORRECT")}>Düzelt</button>}
        {!mode && <button type="button" className="btn-secondary min-h-9" onClick={() => setMode("DISPUTE")}>İtiraz et</button>}
        {mode && <button type="button" className="btn-primary min-h-9" disabled={pending} onClick={() => send(mode)}>Kaydet</button>}
        {mode && <button type="button" className="btn-secondary min-h-9" onClick={() => setMode(null)}>Vazgeç</button>}
      </div>
      {msg && <p role="status" className="text-sm">{msg}</p>}
    </div>
  );
}
