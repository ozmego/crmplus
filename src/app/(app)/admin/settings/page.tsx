import { requirePage } from "@/server/auth/rbac";
import { db } from "@/server/db";
import { gateOpen, getRecordingGate, getRetention } from "@/server/services/settings";
import Link from "next/link";
import { configuredProvider, PBX_MODE_LABEL } from "@/server/telephony/provider";
import { GateForm, RetentionForm } from "@/components/admin-settings";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  await requirePage("settings.manage");
  const [gate, retention, incidents] = await Promise.all([
    getRecordingGate(),
    getRetention(),
    db.telephonyIncident.findMany({ where: { resolvedAt: null }, orderBy: { at: "desc" }, take: 20 }),
  ]);
  const open = gateOpen(gate);
  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="eyebrow">YÖNETİM</p>
        <h1 className="page-title">Ayarlar</h1>
      </div>

      <section className="card bg-white">
        <h2 className="card-title">Ses kaydı ve analiz — karar kapısı</h2>
        <p className={open ? "callout-info mb-3" : "callout-warn mb-3"}>
          {open
            ? `Kapı açık (${gate.approvedAt ? new Date(gate.approvedAt).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" }) : ""}). Santralden gelen kayıtlar saklanır ve analiz edilir.`
            : "Kapı kapalı. Santralden gelen kayıtlar saklanmaz (indirme adresi de tutulmaz), analiz yapılmaz."}
        </p>
        <GateForm gate={gate} />
      </section>

      <section className="card bg-white">
        <h2 className="card-title">Saklama süreleri</h2>
        <p className="mb-3 text-sm text-muted">Süresi dolan ses kayıtları ve maskelenmemiş transkriptler her gece otomatik silinir (docs/07, docs/09).</p>
        <RetentionForm retention={retention} />
      </section>

      <section className="card bg-white">
        <h2 className="card-title">Santral</h2>
        <p className="text-sm">
          Mod: <b>{PBX_MODE_LABEL[configuredProvider().name]}</b>. Santral bağlantısı ortam değişkenleriyle yapılandırılır (PBX_PROVIDER; 3CX için THREECX_*). Bağlantı sınaması ve dahili numaralar: <Link href="/admin/integrations#threecx" className="text-teal-ink underline">Entegrasyonlar</Link>.
        </p>
        <h3 className="mt-3 text-sm font-semibold">Açık santral olayları</h3>
        {incidents.length === 0 ? (
          <p className="text-sm text-muted">Yok.</p>
        ) : (
          <ul className="text-sm">
            {incidents.map((i) => (
              <li key={i.id}>{i.at.toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" })} · {i.kind} · {i.detail}</li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
