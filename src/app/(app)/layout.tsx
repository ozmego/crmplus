import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { requireUser, can } from "@/server/auth/rbac";
import type { Permission } from "@/server/auth/permissions";
import { logoutAction, setLocaleAction } from "@/app/(auth)/actions";
import { NavLinks } from "@/components/nav-links";

const NAV: { href: string; key: string; perm: Permission }[] = [
  { href: "/ops", key: "ops", perm: "report.product" },
  { href: "/queue", key: "queue", perm: "queue.view" },
  { href: "/guests", key: "guests", perm: "guest.view" },
  { href: "/imports", key: "imports", perm: "import.view" },
  { href: "/compare", key: "compare", perm: "compare.run" },
  { href: "/review", key: "review", perm: "review.view" },
  { href: "/calls", key: "calls", perm: "call.view" },
  { href: "/qa", key: "qa", perm: "qa.review" },
  { href: "/qa", key: "qa", perm: "qa.respond" },
  { href: "/messages", key: "messages", perm: "message.campaign.prepare" },
  { href: "/inbox", key: "inbox", perm: "inbox.view" },
  { href: "/reports", key: "reports", perm: "report.view" },
  { href: "/finance", key: "finance", perm: "finance.view" },
  { href: "/hr", key: "hr", perm: "attendance.view" },
  { href: "/admin/users", key: "admin", perm: "user.view" },
  { href: "/admin/audit", key: "audit", perm: "audit.view" },
  { href: "/admin/settings", key: "settings", perm: "settings.manage" },
  { href: "/admin/vocabulary", key: "vocabulary", perm: "vocabulary.manage" },
  { href: "/admin/integrations", key: "integrations", perm: "integration.manage" },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const t = await getTranslations("nav");
  const tc = await getTranslations("common");
  const locale = await getLocale();
  const items = NAV.filter((n, i) => can(user, n.perm) && NAV.findIndex((m) => m.href === n.href && can(user, m.perm)) === i).map((n) => ({ href: n.href, label: t(n.key as "ops") }));

  return (
    <div className="flex min-h-screen flex-col">
      <header className="bg-ink text-cream">
        <div className="mx-auto flex max-w-[1480px] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 md:px-6">
          <Link href="/" className="text-lg font-extrabold tracking-tight text-cream">
            crm<span className="text-teal">Plus</span>
          </Link>
          <NavLinks items={items} />
          <div className="ml-auto flex items-center gap-3 text-sm">
            <form action={setLocaleAction}>
              <input type="hidden" name="locale" value={locale === "tr" ? "en" : "tr"} />
              <button className="rounded border border-white/25 px-2 py-1 text-xs font-semibold text-cream/90 hover:bg-white/10" aria-label={tc("language")}>
                {locale === "tr" ? "EN" : "TR"}
              </button>
            </form>
            <span className="hidden text-cream/80 sm:inline">{user.name}</span>
            <form action={logoutAction}>
              <button className="rounded px-2 py-1 text-xs font-semibold text-cream/90 hover:bg-white/10">{tc("logout")}</button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[1480px] flex-1 px-4 py-6 md:px-6">{children}</main>
    </div>
  );
}
