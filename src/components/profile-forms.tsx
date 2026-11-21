"use client";

import { useActionState, useState } from "react";
import { Eye } from "lucide-react";
import type { FormState } from "@/app/(app)/finance/actions";

/** Serbest alanlı form kabuğu (dosya, çoklu seçim vb.): sunucu eylemi + hata/başarı mesajı. */
export function ProfileForm({
  action,
  submit,
  children,
  className = "flex flex-col gap-3",
  tone = "primary",
}: {
  action: (s: FormState, fd: FormData) => Promise<FormState>;
  submit: string;
  children: React.ReactNode;
  className?: string;
  tone?: "primary" | "secondary" | "danger";
}) {
  const [state, act, pending] = useActionState(action, undefined);
  return (
    <form action={act} className={className}>
      {children}
      {state?.error && <p role="alert" className="callout-critical">{state.error}</p>}
      {state?.ok && <p role="status" className="callout-info">{state.ok}</p>}
      <div>
        <button className={tone === "secondary" ? "btn-secondary" : tone === "danger" ? "btn-danger" : "btn-primary"} disabled={pending}>
          {pending ? "Kaydediliyor…" : submit}
        </button>
      </div>
    </form>
  );
}

/** Belgeyi görüntüleme: gerekçe zorunlu; yeni sekmede açılır ve erişim kaydına yazılır. */
export function OpenDocument({ documentId, label }: { documentId: string; label: string }) {
  const [reason, setReason] = useState("");
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1 text-xs font-semibold text-teal-ink hover:underline">
        <Eye className="h-3.5 w-3.5" aria-hidden /> Görüntüle
      </button>
    );
  }
  const ok = reason.trim().length >= 5;
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <input
        aria-label={`${label} görüntüleme gerekçesi`}
        placeholder="Gerekçe (kayıt altına alınır)"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        className="input min-h-8 w-56 text-xs"
      />
      <a
        href={ok ? `/api/guests/documents/${documentId}?reason=${encodeURIComponent(reason.trim())}` : undefined}
        target="_blank"
        rel="noopener noreferrer"
        aria-disabled={!ok}
        className={"text-xs font-semibold " + (ok ? "text-teal-ink hover:underline" : "pointer-events-none text-muted")}
      >
        Aç
      </a>
    </span>
  );
}
