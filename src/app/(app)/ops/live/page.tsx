import Link from "next/link";
import { requirePage } from "@/server/auth/rbac";
import { liveChannels } from "@/server/services/ops-live";
import { AutoRefresh } from "@/components/auto-refresh";

export const dynamic = "force-dynamic";

function Tile({ label, value, sub, tone, testId }: { label: string; value: number | string; sub?: string; tone?: "warn" | "critical"; testId?: string }) {
  return (
    <div className={"card " + (tone === "critical" ? "border-l-4 border-critical" : tone === "warn" ? "border-l-4 border-warn" : "")}>
      <p className="text-xs font-semibold uppercase tracking-wider text-teal-ink">{label}</p>
      <p className="stat-value" data-testid={testId}>{value}</p>
      {sub && <p className="mt-1 text-xs text-muted">{sub}</p>}
    </div>
  );
}

/** Gerçek zamanlı kanal panosu: 10 sn'de bir yenilenir; yalnız toplulaştırılmış sayılar. */
export default async function LivePage() {
  await requirePage("report.product");
  const l = await liveChannels();
  const max = Math.max(1, ...l.calls.byHour);
  const sum = (o: Record<string, number>, k: string[]) => k.reduce((s, x) => s + (o[x] ?? 0), 0);
  return (
    <div className="flex flex-col gap-5">
      <AutoRefresh seconds={10} />
      <div>
        <p className="eyebrow">OPERASYON · CANLI</p>
        <h1 className="page-title">Kanal panosu</h1>
        <p className="mt-1 text-sm text-muted">
          {l.at.toLocaleTimeString("tr-TR", { timeZone: "Europe/Istanbul" })} itibarıyla · 10 saniyede bir yenilenir · toplulaştırılmış, kişi bazlı içerik yok ·{" "}
          <Link href="/ops" className="text-teal-ink underline">Operasyon paneli</Link> · <Link href="/ops/capacity" className="text-teal-ink underline">Kapasite planı</Link>
        </p>
      </div>

      <h2 className="card-title">Çağrı merkezi</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Mesaide / görüşmede" value={`${l.agents.ready} / ${l.agents.onCall}`} sub={`molada ${l.agents.onBreak} · mesai bitti ${l.agents.offline}`} testId="live-agents" />
        <Tile label="Açık çağrı" value={l.calls.open} sub={`bugün ${l.calls.today} deneme · ${Math.round(l.calls.talkSec / 60)} dk konuşma`} testId="live-calls" />
        <Tile label="Bekleyen görev" value={l.calls.openTasks} sub={`sonraki 1 saatte ${l.calls.callbacksNextHour} geri arama`} />
        <Tile label="Geciken geri arama" value={l.calls.callbacksLate} sub={`son 1 saatte ${l.calls.incidentsLastHour} santral olayı`} tone={l.calls.callbacksLate || l.calls.incidentsLastHour ? "warn" : undefined} />
      </div>
      <section className="card bg-white">
        <p className="text-xs font-semibold uppercase tracking-wider text-teal-ink">Bugün saatlik çağrı denemesi</p>
        <div className="mt-2 flex h-28 items-end gap-1" role="img" aria-label="Saatlik çağrı denemesi grafiği">
          {l.calls.byHour.map((n, h) => (
            <div key={h} className="flex flex-1 flex-col items-center justify-end gap-1">
              <span className="text-[10px] tabular-nums text-muted">{n || ""}</span>
              <div className="w-full rounded-t bg-teal" style={{ height: `${(n / max) * 80}px` }} />
              <span className="text-[10px] tabular-nums text-muted">{h}</span>
            </div>
          ))}
        </div>
      </section>

      <h2 className="card-title">SMS · bugün</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Gönderilen" value={sum(l.sms.status, ["SENT", "DELIVERED", "FAILED"])} testId="live-sms" />
        <Tile label="Teslim edildi" value={l.sms.status.DELIVERED ?? 0} />
        <Tile label="Başarısız" value={l.sms.status.FAILED ?? 0} tone={l.sms.status.FAILED ? "warn" : undefined} />
        <Tile label="Gelen / ret" value={`${l.sms.inbound} / ${l.optOuts.SMS ?? 0}`} />
      </div>

      <h2 className="card-title">WhatsApp</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Bugün gönderilen" value={sum(l.whatsapp.status, ["SENT", "DELIVERED", "READ", "FAILED"])} sub={`teslim ${l.whatsapp.status.DELIVERED ?? 0} · okundu ${l.whatsapp.status.READ ?? 0} · başarısız ${l.whatsapp.status.FAILED ?? 0}`} testId="live-wa" />
        <Tile label="Bugün gelen / ret" value={`${l.whatsapp.inbound} / ${l.optOuts.WHATSAPP ?? 0}`} />
        <Tile label="Açık konuşma" value={l.whatsapp.openConversations} sub={`okunmamış ${l.whatsapp.unread} · atanmamış ${l.whatsapp.unassigned} · pencere açık ${l.whatsapp.windowOpen}`} tone={l.whatsapp.unassigned ? "warn" : undefined} />
        <Tile label="Ret şüphesi" value={l.whatsapp.optOutSuspect} sub="temsilci doğrulaması bekliyor" tone={l.whatsapp.optOutSuspect ? "critical" : undefined} />
      </div>
    </div>
  );
}
