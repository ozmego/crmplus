/**
 * 3CX V20 Call Control API — saf yardımcılar (ağ yok, birim testli).
 *
 * 3CX olayları webhook ile değil WebSocket (/callcontrol/ws) ile gelir. Her olay yalnız değişen varlığın yolunu
 * taşır ("/callcontrol/101/participants/7"); ayrıntı ayrıca GET ile okunur. Katılımcı kaldırıldığında ayrıntı
 * artık okunamaz, bu yüzden izleyici katılımcı → çağrı eşlemesini bellekte tutar.
 */

export type DialFormat = "e164" | "00" | "national";

/** Santralin giden arama kuralına göre numara: +905321234567 → "+905321234567" | "00905321234567" | "05321234567" (yalnız TR). */
export function toDialString(e164: string, format: DialFormat = "e164"): string {
  if (!/^\+\d{6,15}$/.test(e164)) throw new Error("E.164 değil");
  if (format === "00") return "00" + e164.slice(1);
  if (format === "national") return e164.startsWith("+90") ? "0" + e164.slice(3) : "00" + e164.slice(1);
  return e164;
}

export interface WsEvent {
  type: "upsert" | "remove" | "other";
  entity: string;
  dn?: string;
  participantId?: number;
}

/** 3CX WebSocket çerçevesi: {"sequence":1,"event":{"event_type":0,"entity":"/callcontrol/101/participants/7"}} */
export function parseWsEvent(raw: string): WsEvent | null {
  let j: unknown;
  try {
    j = JSON.parse(raw);
  } catch {
    return null;
  }
  const ev = (j as { event?: { event_type?: unknown; entity?: unknown } })?.event;
  if (!ev || typeof ev.entity !== "string") return null;
  const type = ev.event_type === 0 ? "upsert" : ev.event_type === 1 ? "remove" : "other";
  const m = /^\/callcontrol\/([^/]+)\/participants\/(\d+)$/.exec(ev.entity);
  return { type, entity: ev.entity, dn: m?.[1], participantId: m ? Number(m[2]) : undefined };
}

export interface Participant {
  id: number;
  dn: string;
  status: string; // Dialing | Ringing | Connected …
  callid: number;
  party_dn?: string;
}

export interface TrackedEvent {
  eventId: string;
  event: "answered" | "ended";
  externalId: string;
  at: string;
  talkSec?: number;
}

/**
 * Katılımcı durumlarını crmPlus santral olaylarına çevirir. Yalnız temsilci dahilisindeki katılımcı izlenir:
 * ilk "Connected" → answered; katılımcı kaldırılınca → ended (konuşma süresi bağlanma anından).
 * Olay kimlikleri çağrı kimliğinden türetilir; aynı olay iki kez gelirse işleyici tek kez yazar.
 */
export class ParticipantTracker {
  private byKey = new Map<string, { callid: number; answeredAt?: number }>();

  upsert(p: Participant, at: Date): TrackedEvent[] {
    const key = `${p.dn}/${p.id}`;
    const cur = this.byKey.get(key) ?? { callid: p.callid };
    this.byKey.set(key, cur);
    if (p.status === "Connected" && cur.answeredAt === undefined) {
      cur.answeredAt = at.getTime();
      return [{ eventId: `3cx:${p.callid}:answered`, event: "answered", externalId: String(p.callid), at: at.toISOString() }];
    }
    return [];
  }

  remove(dn: string, participantId: number, at: Date): TrackedEvent[] {
    const key = `${dn}/${participantId}`;
    const cur = this.byKey.get(key);
    if (!cur) return [];
    this.byKey.delete(key);
    const talkSec = cur.answeredAt !== undefined ? Math.max(0, Math.round((at.getTime() - cur.answeredAt) / 1000)) : 0;
    return [{ eventId: `3cx:${cur.callid}:ended`, event: "ended", externalId: String(cur.callid), at: at.toISOString(), talkSec }];
  }

  get size() {
    return this.byKey.size;
  }
}
