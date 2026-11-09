import Link from "next/link";
import { Lock } from "lucide-react";
import { requirePage } from "@/server/auth/rbac";

/** Finans ayrı bir bölümdür: kendi menüsü ve kalıcı erişim uyarısı (plan v4 §8). */
export default async function FinanceLayout({ children }: { children: React.ReactNode }) {
  await requirePage("finance.view");
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3 rounded-md border-l-4 border-warn bg-warn-bg px-4 py-2 text-sm text-warn-ink">
        <Lock size={16} aria-hidden />
        <span><b>Finansal veri</b> — bu bölümdeki her görüntüleme ve işlem kayıt altına alınır. Çağrı merkezi ve ses analizi ekranlarından ayrıdır.</span>
      </div>
      <nav aria-label="Finans menüsü" className="flex flex-wrap gap-2">
        {[
          ["/finance", "Dönemler"],
          ["/finance/trips", "Tripler ve sonuçlar"],
          ["/finance/contracts", "Casinolar ve sözleşmeler"],
        ].map(([href, label]) => (
          <Link key={href} href={href} className="rounded border border-line bg-white px-3 py-1.5 text-sm hover:bg-card">{label}</Link>
        ))}
      </nav>
      {children}
    </div>
  );
}
