import Link from "next/link";
import { cookies } from "next/headers";
import { getLocale, getTranslations } from "next-intl/server";
import { Gem, Globe, LogOut } from "lucide-react";
import { requireUser, can, type Principal } from "@/server/auth/rbac";
import type { Permission } from "@/server/auth/permissions";
import { logoutAction, setLocaleAction } from "@/app/(auth)/actions";
import { DesktopSidebar, MobileMenu, type SidebarGroup } from "@/components/app-sidebar";

type NavKey =
  | "dashboard" | "ops" | "queue" | "calls" | "qa" | "inbox" | "messages" | "guests" | "locations" | "imports" | "compare" | "review"
  | "reports" | "finance" | "hr" | "admin" | "audit" | "settings" | "vocabulary" | "integrations";

/** Menü grupları. Bir öğe, listelenen izinlerden biri varsa görünür. */
const MENU: { group: string; items: { href: string; key: NavKey; perms: Permission[] | "any"; exact?: boolean }[] }[] = [
  { group: "Genel", items: [{ href: "/", key: "dashboard", perms: "any", exact: true }] },
  {
    group: "Operasyon",
    items: [
      { href: "/ops", key: "ops", perms: ["report.product"] },
      { href: "/queue", key: "queue", perms: ["queue.view"] },
      { href: "/calls", key: "calls", perms: ["call.view"] },
      { href: "/qa", key: "qa", perms: ["qa.review", "qa.respond"] },
      { href: "/inbox", key: "inbox", perms: ["inbox.view"] },
      { href: "/messages", key: "messages", perms: ["message.campaign.prepare"] },
    ],
  },
  {
    group: "Oyuncular",
    items: [
      { href: "/guests", key: "guests", perms: ["guest.view"] },
      { href: "/locations", key: "locations", perms: ["finance.view", "report.product"] },
      { href: "/imports", key: "imports", perms: ["import.view"] },
      { href: "/compare", key: "compare", perms: ["compare.run"] },
      { href: "/review", key: "review", perms: ["review.view"] },
    ],
  },
  { group: "Raporlama", items: [{ href: "/reports", key: "reports", perms: ["report.view"] }] },
  { group: "Finans", items: [{ href: "/finance", key: "finance", perms: ["finance.view"] }] },
  { group: "Personel", items: [{ href: "/hr", key: "hr", perms: ["attendance.view"] }] },
  {
    group: "Yönetim",
    items: [
      { href: "/admin/users", key: "admin", perms: ["user.view"] },
      { href: "/admin/audit", key: "audit", perms: ["audit.view"] },
      { href: "/admin/settings", key: "settings", perms: ["settings.manage"] },
      { href: "/admin/vocabulary", key: "vocabulary", perms: ["vocabulary.manage"] },
      { href: "/admin/integrations", key: "integrations", perms: ["integration.manage"] },
    ],
  },
];

function menuFor(user: Principal, label: (k: NavKey) => string): SidebarGroup[] {
  return MENU.map((g) => ({
    label: g.group,
    items: g.items
      .filter((i) => i.perms === "any" || i.perms.some((p) => can(user, p)))
      .map((i) => ({ href: i.href, label: label(i.key), icon: i.key, exact: i.exact })),
  })).filter((g) => g.items.length > 0);
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const t = await getTranslations("nav");
  const tc = await getTranslations("common");
  const locale = await getLocale();
  const groups = menuFor(user, (k) => t(k));
  const collapsed = (await cookies()).get("crm_sidebar")?.value === "collapsed";
  const initials = user.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toLocaleUpperCase("tr-TR"))
    .join("");

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 bg-ink text-cream shadow-[0_8px_30px_-12px_rgb(0_0_0/0.5)]">
        <div className="flex h-14 items-center gap-4 px-4 md:px-6">
          <Link href="/" className="flex items-center gap-2.5" aria-label="crmPlus ana sayfa">
            <span className="grid h-8 w-8 place-items-center rounded-md border border-[#c9a24a]/50 bg-gradient-to-br from-[#2a2416] to-[#121214]">
              <Gem className="h-4 w-4 text-[#e8cf8a]" strokeWidth={1.7} aria-hidden />
            </span>
            <span className="font-display text-xl font-semibold tracking-wide text-cream">
              crm<span className="text-gilded">Plus</span>
            </span>
          </Link>
          <div className="ml-auto flex items-center gap-2 text-sm">
            <form action={setLocaleAction}>
              <input type="hidden" name="locale" value={locale === "tr" ? "en" : "tr"} />
              <button className="inline-flex items-center gap-1 rounded-md border border-white/15 px-2 py-1 text-xs font-semibold text-cream/85 hover:border-[#c9a24a]/60 hover:text-cream" aria-label={tc("language")}>
                <Globe className="h-3.5 w-3.5" aria-hidden />
                {locale === "tr" ? "EN" : "TR"}
              </button>
            </form>
            <span className="hidden items-center gap-2 pl-1 sm:inline-flex">
              <span className="grid h-8 w-8 place-items-center rounded-full border border-[#c9a24a]/60 bg-[#c9a24a]/10 text-[11px] font-bold text-[#e8cf8a]" aria-hidden>
                {initials}
              </span>
              <span className="text-cream/85">{user.name}</span>
            </span>
            <form action={logoutAction}>
              <button className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-cream/80 hover:bg-white/[0.07] hover:text-cream">
                <LogOut className="h-3.5 w-3.5" aria-hidden />
                {tc("logout")}
              </button>
            </form>
            <MobileMenu groups={groups} />
          </div>
        </div>
        <div className="gold-rule opacity-60" />
      </header>
      <div className="flex flex-1">
        <DesktopSidebar groups={groups} initialCollapsed={collapsed} />
        <main className="min-w-0 flex-1 px-4 py-6 md:px-8">
          <div className="mx-auto w-full max-w-[1400px]">{children}</div>
        </main>
      </div>
    </div>
  );
}
