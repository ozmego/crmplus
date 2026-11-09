"use client";

import { useActionState } from "react";
import { workStatusAction } from "@/app/(app)/hr/actions";

const LABEL: Record<string, string> = { READY: "Mesaide", BREAK: "Molada", OFFLINE: "Mesai dışı", ON_CALL: "Görüşmede", WRAP_UP: "Çağrı sonrası" };

/** Mesai durumu: puantajın kaynağıdır (docs/11 §3). Mola süreleri puantajdan düşülür. */
export function WorkStatus({ status, since, compact }: { status: string; since: string | null; compact?: boolean }) {
  const [state, act, pending] = useActionState(workStatusAction, undefined);
  const btn = (s: string, label: string, tone = "btn-secondary") => (
    <form action={act}>
      <input type="hidden" name="status" value={s} />
      <button className={`${tone} min-h-9 text-sm`} disabled={pending}>{label}</button>
    </form>
  );
  return (
    <div className={"flex flex-wrap items-center gap-2 " + (compact ? "" : "rounded-lg border border-line bg-white p-3")} data-testid="work-status">
      <span className="text-sm">
        Durum: <b>{LABEL[status] ?? status}</b>
        {since && <span className="text-muted"> · {new Date(since).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" })}</span>}
      </span>
      {status === "OFFLINE" && btn("READY", "Mesaiye başla", "btn-primary")}
      {status === "READY" && btn("BREAK", "Molaya çık")}
      {status === "BREAK" && btn("READY", "Moladan dön", "btn-primary")}
      {status !== "OFFLINE" && btn("OFFLINE", "Mesaiyi bitir")}
      {state?.error && <p role="alert" className="text-sm font-semibold text-critical">{state.error}</p>}
    </div>
  );
}
