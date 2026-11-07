"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { resolveReviewAction } from "@/app/(app)/review/actions";

const ERR: Record<string, string> = {
  NOT_OPEN: "Bu kayıt artık açık değil.",
  BAD_ACTION: "Bu tür için geçersiz karar.",
  TARGET_REQUIRED: "Birleştirilecek kaydı seçin.",
  SOURCE_MISSING: "Kaynak satır bulunamadı (içe aktarma silinmiş veya süresi dolmuş olabilir).",
  PROOF_REQUIRED: "İzni kabul etmek için kanıt referansı zorunlu.",
  BLOCK_ACTIVE: "Aktif iletişim durdurma kaydı var; izin kabul edilemez.",
  INVALID_INPUT: "Gerekçe en az 5 karakter olmalı.",
  FORBIDDEN: "Bu işlem için yetkiniz yok.",
};

export interface ReviewAction {
  value: string;
  label: string;
  tone?: "primary" | "danger" | "secondary";
  needsTarget?: boolean;
  needsProof?: boolean;
}

export function ReviewDecision({ id, actions, candidates }: { id: string; actions: ReviewAction[]; candidates?: { id: string; label: string }[] }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [target, setTarget] = useState(candidates?.length === 1 ? candidates[0].id : "");
  const [proof, setProof] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const submit = (a: ReviewAction) =>
    start(async () => {
      setErr(null);
      const r = await resolveReviewAction({
        id,
        action: a.value as "DISMISS",
        reason,
        targetGuestId: a.needsTarget ? target : undefined,
        proofRef: a.needsProof ? proof : undefined,
      });
      if (r.ok) router.refresh();
      else setErr(ERR[r.error] ?? r.error);
    });

  return (
    <div className="flex flex-col gap-3 border-t border-line pt-3">
      {candidates && candidates.length > 1 && (
        <div className="max-w-md">
          <label htmlFor={`t-${id}`} className="label">Birleştirilecek kayıt</label>
          <select id={`t-${id}`} value={target} onChange={(e) => setTarget(e.target.value)} className="input min-h-9">
            <option value="">Seçin…</option>
            {candidates.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </div>
      )}
      {actions.some((a) => a.needsProof) && (
        <div className="max-w-md">
          <label htmlFor={`p-${id}`} className="label">İzin kanıtı (yalnız izni kabul ederken)</label>
          <input id={`p-${id}`} value={proof} onChange={(e) => setProof(e.target.value)} className="input min-h-9" placeholder="form no, belge referansı" />
        </div>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-64 flex-1">
          <label htmlFor={`r-${id}`} className="label">Gerekçe (kayıt altına alınır)</label>
          <input id={`r-${id}`} value={reason} onChange={(e) => setReason(e.target.value)} className="input min-h-9" />
        </div>
        {actions.map((a) => (
          <button
            key={a.value}
            type="button"
            disabled={pending || reason.trim().length < 5 || (a.needsTarget && !target)}
            onClick={() => submit(a)}
            className={(a.tone === "primary" ? "btn-primary" : a.tone === "danger" ? "btn-danger" : "btn-secondary") + " min-h-9"}
          >
            {a.label}
          </button>
        ))}
      </div>
      {err && <p role="alert" className="text-sm font-semibold text-critical">{err}</p>}
    </div>
  );
}
