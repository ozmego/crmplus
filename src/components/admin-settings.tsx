"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveGateAction, saveRetentionAction } from "@/app/(app)/admin/actions";
import type { RecordingGate, Retention } from "@/server/services/settings";

const CHECKS: [keyof RecordingGate["checklist"], string][] = [
  ["legalBasis", "Kayıt ve analiz için hukuki dayanak belirlendi"],
  ["noticeText", "Bilgilendirme (anons) metni onaylandı"],
  ["retention", "Ses, transkript ve analiz saklama süreleri onaylandı"],
  ["vendorDataUse", "Santral/ses tedarikçisinin veri kullanımı ve ülke değerlendirmesi yapıldı"],
  ["accessMatrix", "Dinleme ve transkript erişim matrisi onaylandı"],
  ["guestPreferenceFlow", "Misafirin kayıt istememe akışı onaylandı"],
];

function useSave() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const save = (fn: () => Promise<{ ok: true; data: unknown } | { ok: false; error: string }>, okText: (d: unknown) => string) =>
    start(async () => {
      const r = await fn();
      setMsg(r.ok ? { ok: true, text: okText(r.data) } : { ok: false, text: r.error === "INVALID_INPUT" ? "Alanları kontrol edin (gerekçe en az 5, bildirim metni en az 20 karakter)." : r.error === "FORBIDDEN" ? "Yetkiniz yok." : r.error });
      if (r.ok) router.refresh();
    });
  return { pending, msg, save };
}

export function GateForm({ gate }: { gate: RecordingGate }) {
  const [checklist, setChecklist] = useState(gate.checklist);
  const [noticeText, setNoticeText] = useState(gate.noticeText);
  const [legalRef, setLegalRef] = useState(gate.legalRef);
  const [reason, setReason] = useState("");
  const { pending, msg, save } = useSave();
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        save(() => saveGateAction({ checklist, noticeText, legalRef }, reason), (d) => ((d as { open: boolean }).open ? "Karar kapısı açık: kayıt ve analiz devrede." : "Kaydedildi. Kapı kapalı: kayıt saklanmaz."));
      }}
    >
      <fieldset className="flex flex-col gap-2">
        <legend className="label">Onaylar (tamamı gerekli)</legend>
        {CHECKS.map(([k, l]) => (
          <label key={k} className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={checklist[k]} onChange={(e) => setChecklist({ ...checklist, [k]: e.target.checked })} /> {l}
          </label>
        ))}
      </fieldset>
      <div>
        <label htmlFor="notice" className="label">Kayıt bildirimi metni (çağrı ekranında gösterilir)</label>
        <textarea id="notice" value={noticeText} onChange={(e) => setNoticeText(e.target.value)} rows={2} className="input py-2" />
      </div>
      <div>
        <label htmlFor="legal" className="label">Hukuki görüş / karar referansı</label>
        <input id="legal" value={legalRef} onChange={(e) => setLegalRef(e.target.value)} className="input" placeholder="ör. Hukuk görüşü 2026/14, 05.11.2026" />
      </div>
      <div>
        <label htmlFor="gate-reason" className="label">Gerekçe (kayıt altına alınır)</label>
        <input id="gate-reason" value={reason} onChange={(e) => setReason(e.target.value)} required minLength={5} className="input" />
      </div>
      <button className="btn-primary self-start" disabled={pending}>Kaydet</button>
      {msg && <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-sm text-teal-ink" : "text-sm font-semibold text-critical"}>{msg.text}</p>}
    </form>
  );
}

export function RetentionForm({ retention }: { retention: Retention }) {
  const [v, setV] = useState(retention);
  const [reason, setReason] = useState("");
  const { pending, msg, save } = useSave();
  const field = (k: keyof Retention, label: string) => (
    <div>
      <label htmlFor={`ret-${k}`} className="label">{label}</label>
      <input id={`ret-${k}`} type="number" min={1} value={v[k]} onChange={(e) => setV({ ...v, [k]: Number(e.target.value) })} className="input" />
    </div>
  );
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        save(() => saveRetentionAction(v, reason), () => "Saklama süreleri kaydedildi.");
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {field("audioDays", "Ses kaydı (gün)")}
        {field("rawTranscriptDays", "Maskelenmemiş transkript (gün)")}
        {field("importFileDays", "İçe aktarma dosyası (gün)")}
        {field("listenGrantHours", "Dinleme izni süresi (saat)")}
      </div>
      <div>
        <label htmlFor="ret-reason" className="label">Gerekçe</label>
        <input id="ret-reason" value={reason} onChange={(e) => setReason(e.target.value)} required minLength={5} className="input" />
      </div>
      <button className="btn-primary self-start" disabled={pending}>Kaydet</button>
      {msg && <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-sm text-teal-ink" : "text-sm font-semibold text-critical"}>{msg.text}</p>}
    </form>
  );
}
