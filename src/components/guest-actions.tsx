"use client";

import { useState, useTransition } from "react";
import { Eye, Ban } from "lucide-react";
import { createBlockAction, revealPhoneAction, setConsentAction } from "@/app/(app)/guests/actions";

const ERR: Record<string, string> = {
  FORBIDDEN: "Bu işlem için yetkiniz yok.",
  NOT_FOUND: "Kayıt bulunamadı veya kapsamınız dışında.",
  INVALID_INPUT: "Alanları kontrol edin (gerekçe en az 5 karakter).",
  PROOF_REQUIRED: "İzin vermek için kaynak ve kanıt zorunlu.",
  BLOCK_ACTIVE: "Aktif iletişim durdurma kaydı var; önce yetkili kişinin kaldırması gerekir.",
  FUTURE_DATE: "Talep tarihi gelecekte olamaz.",
};

export function RevealPhone({ phoneId }: { phoneId: string }) {
  const [open, setOpen] = useState(false);
  const [why, setWhy] = useState("");
  const [value, setValue] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (value) return <span className="font-mono text-sm font-semibold text-ink">{value}</span>;
  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1 text-xs font-semibold text-teal-ink hover:underline">
        <Eye size={14} aria-hidden /> Maskesiz göster
      </button>
    );
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await revealPhoneAction(phoneId, why);
          if (r.ok) setValue(r.data);
          else setErr(ERR[r.error] ?? r.error);
        });
      }}
    >
      <div>
        <label htmlFor={`why-${phoneId}`} className="label">Gerekçe (kayıt altına alınır)</label>
        <input id={`why-${phoneId}`} value={why} onChange={(e) => setWhy(e.target.value)} className="input min-h-9 w-64" required minLength={5} />
      </div>
      <button className="btn-secondary min-h-9" disabled={pending}>Göster</button>
      {err && <p role="alert" className="w-full text-xs text-critical">{err}</p>}
    </form>
  );
}

export function BlockForm({ guestId }: { guestId: string }) {
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState(true);
  const [channel, setChannel] = useState<"CALL" | "SMS" | "WHATSAPP" | "EMAIL">("CALL");
  const [at, setAt] = useState(() => new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16));
  const [proof, setProof] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className="btn-danger">
        <Ban size={16} aria-hidden /> İletişimi durdur
      </button>
    );
  return (
    <form
      className="callout-critical flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await createBlockAction({ guestId, allChannels: all, channel: all ? undefined : channel, requestedAt: new Date(at).toISOString(), proof: proof || undefined });
          if (r.ok) setOpen(false);
          else setErr(ERR[r.error] ?? r.error);
        });
      }}
    >
      <p className="font-semibold">Misafirin iletişim durdurma talebini kaydedin</p>
      <p className="text-xs">Kaydedildiği anda ilgili kanal izinleri “reddedildi” olur; açık görevler ve geri aramalar iptal edilir.</p>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Tüm kanallar
      </label>
      {!all && (
        <div className="max-w-xs">
          <label htmlFor="blk-ch" className="label">Kanal</label>
          <select id="blk-ch" value={channel} onChange={(e) => setChannel(e.target.value as typeof channel)} className="input">
            <option value="CALL">Arama</option>
            <option value="SMS">SMS</option>
            <option value="WHATSAPP">WhatsApp</option>
            <option value="EMAIL">E-posta</option>
          </select>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="blk-at" className="label">Talep zamanı</label>
          <input id="blk-at" type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} className="input" required />
        </div>
        <div>
          <label htmlFor="blk-proof" className="label">Kanıt / referans</label>
          <input id="blk-proof" value={proof} onChange={(e) => setProof(e.target.value)} className="input" placeholder="ör. e-posta tarihi, casino bildirimi" />
        </div>
      </div>
      {err && <p role="alert" className="text-sm font-semibold">{err}</p>}
      <div className="flex gap-2">
        <button className="btn-danger" disabled={pending}>Kaydet</button>
        <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>Vazgeç</button>
      </div>
    </form>
  );
}

export function ConsentEditor({ guestId, channel, canGrant }: { guestId: string; channel: string; canGrant: boolean }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<"GRANTED" | "DENIED" | "UNKNOWN">(canGrant ? "GRANTED" : "DENIED");
  const [scope, setScope] = useState<"MARKETING" | "SERVICE">("MARKETING");
  const [source, setSource] = useState("");
  const [proof, setProof] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-xs font-semibold text-teal-ink hover:underline">
        Güncelle
      </button>
    );
  return (
    <form
      className="mt-2 flex flex-col gap-2 rounded-md border border-line bg-white p-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await setConsentAction({ guestId, channel: channel as "CALL", status, scope, source: source || undefined, proofRef: proof || undefined });
          if (r.ok) setOpen(false);
          else setErr(ERR[r.error] ?? r.error);
        });
      }}
    >
      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor={`st-${channel}`}>Durum</label>
          <select id={`st-${channel}`} value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className="input min-h-9">
            {canGrant && <option value="GRANTED">İzin verildi</option>}
            <option value="DENIED">Reddedildi</option>
            {canGrant && <option value="UNKNOWN">Bilinmiyor</option>}
          </select>
        </div>
        <div>
          <label className="label" htmlFor={`sc-${channel}`}>Kapsam</label>
          <select id={`sc-${channel}`} value={scope} onChange={(e) => setScope(e.target.value as typeof scope)} className="input min-h-9">
            <option value="MARKETING">Pazarlama</option>
            <option value="SERVICE">Hizmet / bilgilendirme</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor={`src-${channel}`}>Kaynak{status === "GRANTED" ? " · zorunlu" : ""}</label>
          <input id={`src-${channel}`} value={source} onChange={(e) => setSource(e.target.value)} className="input min-h-9" placeholder="ör. casino üyelik formu" />
        </div>
        <div>
          <label className="label" htmlFor={`pr-${channel}`}>Kanıt{status === "GRANTED" ? " · zorunlu" : ""}</label>
          <input id={`pr-${channel}`} value={proof} onChange={(e) => setProof(e.target.value)} className="input min-h-9" placeholder="form no, belge referansı" />
        </div>
      </div>
      {!canGrant && <p className="text-xs text-muted">Yetkiniz yalnız ret kaydetmeye izin veriyor. İzin vermek için kanıtla birlikte ekip liderinize iletin.</p>}
      {err && <p role="alert" className="text-xs font-semibold text-critical">{err}</p>}
      <div className="flex gap-2">
        <button className="btn-primary min-h-9" disabled={pending}>Kaydet</button>
        <button type="button" className="btn-secondary min-h-9" onClick={() => setOpen(false)}>Vazgeç</button>
      </div>
    </form>
  );
}
