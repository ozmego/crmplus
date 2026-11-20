import "server-only";
import { db } from "@/server/db";
import { parseWsEvent, ParticipantTracker, type TrackedEvent } from "@/lib/threecx";
import { getParticipant, threecxConfig, threecxToken } from "@/server/telephony/threecx";
import { handleTelephonyEvent } from "@/server/telephony/webhook";

/**
 * 3CX olay dinleyicisi (işçi sürecinde çalışır; PBX_PROVIDER=3cx iken).
 * Yalnız crmPlus'ın başlattığı çağrılar işlenir (Call.provider = "3cx" ve externalId = 3CX çağrı kimliği);
 * santraldeki diğer çağrılar yok sayılır ve hiçbir yere yazılmaz.
 * Bağlantı koparsa artan bekleme ile yeniden bağlanır; 3 ardışık başarısızlıkta bir kez TelephonyIncident açar.
 */
export function startThreeCxListener(log: (...a: unknown[]) => void) {
  const tracker = new ParticipantTracker();
  let stopped = false;
  let ws: WebSocket | null = null;
  let failures = 0;
  let incidentOpen = false;

  const ours = async (externalId: string) => !!(await db.call.findFirst({ where: { provider: "3cx", externalId }, select: { id: true } }));

  async function emit(events: TrackedEvent[]) {
    for (const e of events) {
      if (!(await ours(e.externalId))) continue;
      const r = await handleTelephonyEvent("3cx", e);
      log(`[3cx] ${e.event} çağrı ${e.externalId} → ${r.status}`);
    }
  }

  async function onMessage(raw: string) {
    const ev = parseWsEvent(raw);
    if (!ev?.dn || ev.participantId === undefined) return;
    const at = new Date();
    if (ev.type === "remove") return emit(tracker.remove(ev.dn, ev.participantId, at));
    if (ev.type === "upsert") {
      const p = await getParticipant(ev.entity);
      if (p) await emit(tracker.upsert({ ...p, dn: p.dn ?? ev.dn }, at));
    }
  }

  // Bağlantı açılmadan kapandıysa belirteç reddedilmiş olabilir (anahtar yenilendi, santral yeniden başladı):
  // sonraki denemede önbellekteki belirteç yerine yenisi alınır.
  let freshToken = false;
  async function connect() {
    if (stopped) return;
    try {
      const token = await threecxToken(freshToken);
      let opened = false;
      const url = threecxConfig().url.replace(/^http/, "ws") + "/callcontrol/ws";
      // Node'un yerleşik WebSocket'i (undici) Authorization başlığını ikinci argümandaki headers ile kabul eder
      const Ws = WebSocket as unknown as new (u: string, o: { headers: Record<string, string> }) => WebSocket;
      ws = new Ws(url, { headers: { Authorization: `Bearer ${token}` } });
      ws.addEventListener("open", async () => {
        opened = true;
        freshToken = false;
        failures = 0;
        log("[3cx] olay akışına bağlanıldı");
        if (incidentOpen) {
          incidentOpen = false;
          await db.telephonyIncident.create({ data: { provider: "3cx", kind: "EVENTS_RESTORED", detail: "3CX olay akışı yeniden bağlandı" } }).catch(() => undefined);
        }
      });
      ws.addEventListener("message", (m) => {
        onMessage(typeof m.data === "string" ? m.data : String(m.data)).catch((e) => log("[3cx] olay işlenemedi:", (e as Error).message));
      });
      ws.addEventListener("close", () => {
        if (!opened) freshToken = true;
        retry(opened ? "bağlantı kapandı" : "bağlantı kurulamadı");
      });
      ws.addEventListener("error", () => undefined); // ardından close gelir
    } catch (e) {
      freshToken = true;
      retry((e as Error).message);
    }
  }

  let retrying = false;
  async function retry(reason: string) {
    if (stopped || retrying) return;
    retrying = true;
    failures++;
    const wait = Math.min(60_000, 2_000 * 2 ** Math.min(failures - 1, 5));
    log(`[3cx] olay akışı kesildi (${reason}); ${Math.round(wait / 1000)} sn sonra yeniden denenecek`);
    if (failures === 3 && !incidentOpen) {
      incidentOpen = true;
      await db.telephonyIncident
        .create({ data: { provider: "3cx", kind: "EVENTS_DISCONNECTED", detail: `3CX olay akışına bağlanılamıyor: ${reason}`.slice(0, 500) } })
        .catch(() => undefined);
    }
    setTimeout(() => {
      retrying = false;
      connect();
    }, wait);
  }

  connect();
  return {
    stop() {
      stopped = true;
      ws?.close();
    },
  };
}
