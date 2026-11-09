"use client";

import { useActionState, useState } from "react";
import { campaignAction } from "@/app/(app)/messages/actions";

/** Onay: gerekçe + ülke/içerik/yerel hukuk uygunluğu onay kutusu zorunlu (plan v4 §6). */
export function CampaignApprove({ id }: { id: string }) {
  const [state, act, pending] = useActionState(campaignAction, undefined);
  // Kontrollü alanlar: React form sıfırlaması hatalı denemeden sonra girileni silmesin
  const [reason, setReason] = useState("");
  const [legal, setLegal] = useState(false);
  return (
    <form action={act} className="flex flex-col gap-3 text-sm">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="action" value="APPROVE" />
      <label className="flex items-start gap-2">
        <input type="checkbox" name="legal" className="mt-1" checked={legal} onChange={(e) => setLegal(e.target.checked)} />
        <span>Hedef ülkeler, mesaj içeriği ve faaliyet için yerel hukuk ve platform kurallarına uygunluğu kontrol ettim. Mesaj fiziksel casino/etkinlik bilgilendirmesidir, çevrimiçi kumar tanıtımı değildir.</span>
      </label>
      <div>
        <label htmlFor="approve-reason" className="label">Onay gerekçesi</label>
        <input id="approve-reason" name="reason" required value={reason} onChange={(e) => setReason(e.target.value)} className="input min-h-10" />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn-primary min-h-10" disabled={pending}>Kampanyayı onayla</button>
        {state?.error && <p role="alert" className="font-semibold text-critical">{state.error}</p>}
        {state?.ok && <p role="status" className="text-teal-ink">{state.ok}</p>}
      </div>
    </form>
  );
}
