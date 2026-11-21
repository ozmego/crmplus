import Link from "next/link";
import {
  AlertTriangle,
  ArrowUpRight,
  AudioLines,
  BadgeCheck,
  CalendarClock,
  ChartColumn,
  FileSpreadsheet,
  Gem,
  Landmark,
  MessageSquareText,
  MonitorDot,
  PhoneCall,
  Users,
  type LucideIcon,
} from "lucide-react";
import { can, requirePage, type Principal } from "@/server/auth/rbac";
import type { Permission } from "@/server/auth/permissions";

export const dynamic = "force-dynamic";

interface Report {
  href: string;
  title: string;
  desc: string;
  icon: LucideIcon;
  perms: Permission[];
}

/** Rapor merkezi: tüm raporlar kategorilere göre; her kart yalnız erişim yetkisi olana görünür. */
const CATEGORIES: { title: string; reports: Report[] }[] = [
  {
    title: "Oyuncular ve casinolar",
    reports: [
      { href: "/reports/players", title: "Oyuncu ve trip raporu", desc: "Casinoya gönderilen oyuncular, yeni/tekrar gelen, aylık trend, casino ve ülke dağılımı; Excel.", icon: Users, perms: ["report.product", "finance.view"] },
      { href: "/reports/casinos", title: "Casino performans raporu", desc: "Casino bazında trip ve oyuncu; finans yetkisiyle kayıp/kazanç, rolling ve onaylı komisyon.", icon: Gem, perms: ["report.product", "finance.view"] },
      { href: "/locations", title: "Casino profilleri", desc: "Casino bazında tripler, oyuncular ve (finans yetkisiyle) sözleşme ve sonuçlar.", icon: Gem, perms: ["finance.view", "report.product"] },
    ],
  },
  {
    title: "Operasyon",
    reports: [
      { href: "/ops", title: "Operasyon paneli", desc: "Bugün bekleyen işler, geri arama SLA'sı, ekip kapasitesi ve ürün metrikleri.", icon: MonitorDot, perms: ["report.product"] },
      { href: "/ops/live", title: "Canlı kanal panosu", desc: "Çağrı, SMS ve WhatsApp kanallarının anlık durumu.", icon: MonitorDot, perms: ["report.product"] },
      { href: "/ops/capacity", title: "Kapasite planı", desc: "Saatlik iş yükü ve vardiyadaki temsilci ihtiyacı.", icon: CalendarClock, perms: ["report.product"] },
      { href: "/reports/anomalies", title: "Operasyon anomalileri", desc: "Olağan dışı arama, süre ve sonuç örüntüleri (inceleme için öneri).", icon: AlertTriangle, perms: ["report.product"] },
    ],
  },
  {
    title: "Çağrı merkezi ve kalite",
    reports: [
      { href: "/reports/calls", title: "Çağrı ve kampanya raporu", desc: "Günlük arama hacmi, sonuç kodu dağılımı, ulaşma oranı ve kampanya teslim durumları.", icon: PhoneCall, perms: ["report.product"] },
      { href: "/reports/agents", title: "Personel ve ekip raporu", desc: "Arama, konuşma, ulaşma, geri arama ve sonuç kaydı göstergeleri; Excel dışa aktarımı.", icon: Users, perms: ["report.view"] },
      { href: "/reports/speech", title: "Ses analizi doğruluk paneli", desc: "Transkript oranı, düşük güven, etiket düzeltme ve inceleme kuyruğu yaşı.", icon: AudioLines, perms: ["report.product"] },
      { href: "/qa", title: "Kalite örneklemesi", desc: "Haftalık örneklem, kriterli inceleme ve itirazlar (puan yok).", icon: BadgeCheck, perms: ["qa.review"] },
    ],
  },
  {
    title: "İletişim",
    reports: [
      { href: "/messages", title: "Kampanya sonuçları", desc: "SMS ve WhatsApp kampanyaları: hedef, hariç tutulanlar, teslim ve ret.", icon: MessageSquareText, perms: ["message.campaign.prepare", "message.campaign.approve"] },
    ],
  },
  {
    title: "Veri",
    reports: [
      { href: "/imports", title: "İçe aktarma geçmişi", desc: "Yüklenen dosyalar, hatalı satır raporları ve geri alma kayıtları.", icon: FileSpreadsheet, perms: ["import.view"] },
    ],
  },
  {
    title: "Finans",
    reports: [
      { href: "/finance", title: "Komisyon dönemleri", desc: "Dönem durumları, hesaplamalar, mutabakat ve finans kontrol bulguları.", icon: Landmark, perms: ["finance.view"] },
    ],
  },
  {
    title: "Personel",
    reports: [
      { href: "/hr/timesheet", title: "Puantaj", desc: "Aylık puantaj, düzeltmeler ve bordro dışa aktarımı.", icon: CalendarClock, perms: ["timesheet.export", "timesheet.approve"] },
    ],
  },
];

function visible(user: Principal) {
  return CATEGORIES.map((c) => ({ ...c, reports: c.reports.filter((r) => r.perms.some((p) => can(user, p))) })).filter((c) => c.reports.length > 0);
}

export default async function ReportsHub() {
  const user = await requirePage("report.view");
  const cats = visible(user);
  return (
    <div className="flex flex-col gap-8">
      <div>
        <p className="eyebrow">RAPORLAMA</p>
        <h1 className="page-title">Rapor merkezi</h1>
        <p className="mt-1 text-sm text-muted">Yetkinizin kapsadığı tüm raporlar. Formüller ve hariç tutulanlar her raporun kendi sayfasında (docs/05).</p>
      </div>
      {cats.map((c) => (
        <section key={c.title} className="flex flex-col gap-3">
          <h2 className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.22em] text-teal-ink">
            <ChartColumn className="h-3.5 w-3.5" aria-hidden /> {c.title}
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {c.reports.map(({ href, title, desc, icon: Icon }) => (
              <Link key={href} href={href} className="group flex gap-4 rounded-xl border border-line bg-white p-4 shadow-[0_1px_2px_rgb(18_18_20/0.04)] transition-colors hover:border-teal-ink/50">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-[#c9a24a]/40 bg-[#c9a24a]/10">
                  <Icon className="h-5 w-5 text-teal-ink" strokeWidth={1.8} aria-hidden />
                </span>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="flex items-center gap-1 font-semibold text-ink">
                    {title} <ArrowUpRight className="h-3.5 w-3.5 text-muted transition-colors group-hover:text-teal-ink" aria-hidden />
                  </span>
                  <span className="text-sm text-muted">{desc}</span>
                </span>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
