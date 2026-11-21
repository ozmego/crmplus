"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  BadgeCheck,
  BookA,
  CalendarClock,
  ChartColumn,
  ChevronsLeft,
  ChevronsRight,
  ClipboardCheck,
  FileUp,
  Gem,
  GitCompareArrows,
  Headphones,
  Inbox,
  Landmark,
  LayoutDashboard,
  Menu,
  MessageSquareText,
  MonitorDot,
  PhoneCall,
  Plug,
  ScrollText,
  Settings,
  UserCog,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";

/** Sunucudan bileşen gönderilemediği için ikonlar anahtar adıyla seçilir. */
const ICONS: Record<string, LucideIcon> = {
  dashboard: LayoutDashboard,
  ops: MonitorDot,
  queue: PhoneCall,
  calls: Headphones,
  qa: BadgeCheck,
  inbox: Inbox,
  messages: MessageSquareText,
  guests: Users,
  locations: Gem,
  imports: FileUp,
  compare: GitCompareArrows,
  review: ClipboardCheck,
  reports: ChartColumn,
  finance: Landmark,
  hr: CalendarClock,
  admin: UserCog,
  audit: ScrollText,
  settings: Settings,
  vocabulary: BookA,
  integrations: Plug,
};

export interface SidebarGroup {
  label: string;
  items: { href: string; label: string; icon: string; exact?: boolean }[];
}

export const SIDEBAR_COOKIE = "crm_sidebar";

function isActive(path: string, href: string, exact?: boolean) {
  if (href === "/") return path === "/";
  return path === href || (!exact && path.startsWith(href + "/"));
}

function NavList({ groups, collapsed, onNavigate }: { groups: SidebarGroup[]; collapsed: boolean; onNavigate?: () => void }) {
  const path = usePathname();
  return (
    <nav aria-label="Ana menü" className="flex flex-col gap-5">
      {groups.map((g) => (
        <div key={g.label} className="flex flex-col gap-1">
          {collapsed ? (
            <div className="mx-auto my-1 h-px w-6 bg-[#c9a24a]/25" aria-hidden />
          ) : (
            <p className="px-3 pb-1 text-[10px] font-bold uppercase tracking-[0.24em] text-[#c9a24a]/80">{g.label}</p>
          )}
          {g.items.map((i) => {
            const Icon = ICONS[i.icon] ?? LayoutDashboard;
            const active = isActive(path, i.href, i.exact);
            return (
              <Link
                key={i.href}
                href={i.href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                title={collapsed ? i.label : undefined}
                className={
                  "group relative flex items-center gap-3 rounded-lg py-2 text-[13.5px] font-semibold transition-all " +
                  (collapsed ? "justify-center px-0 " : "px-3 ") +
                  (active
                    ? "bg-gradient-to-r from-[#c9a24a]/25 to-[#c9a24a]/5 text-[#f3dc9a]"
                    : "text-cream/75 hover:bg-white/[0.06] hover:text-cream")
                }
              >
                {active && <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r bg-gradient-to-b from-[#e8cf8a] to-[#c9a24a]" aria-hidden />}
                <Icon className={"h-[18px] w-[18px] shrink-0 " + (active ? "text-[#e8cf8a]" : "text-cream/60 group-hover:text-[#e0c072]")} strokeWidth={1.8} aria-hidden />
                {collapsed ? <span className="sr-only">{i.label}</span> : <span className="truncate">{i.label}</span>}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

/** Geniş ekran: soldaki kenar menü (ikonlara daraltılabilir, tercih çerezde). */
export function DesktopSidebar({ groups, initialCollapsed }: { groups: SidebarGroup[]; initialCollapsed: boolean }) {
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    document.cookie = `${SIDEBAR_COOKIE}=${next ? "collapsed" : "open"}; path=/; max-age=31536000; samesite=strict`;
  };
  return (
      <aside
        className={
          "sticky top-[57px] z-20 hidden h-[calc(100vh-57px)] shrink-0 flex-col justify-between overflow-y-auto border-r border-[#c9a24a]/15 bg-ink py-5 transition-[width] duration-200 lg:flex " +
          (collapsed ? "w-[68px] px-2" : "w-64 px-3")
        }
      >
        <NavList groups={groups} collapsed={collapsed} />
        <button
          type="button"
          onClick={toggle}
          className="mt-6 inline-flex items-center justify-center gap-2 rounded-lg border border-white/10 py-2 text-xs font-semibold text-cream/70 hover:border-[#c9a24a]/50 hover:text-cream"
          aria-label={collapsed ? "Menüyü genişlet" : "Menüyü daralt"}
        >
          {collapsed ? <ChevronsRight className="h-4 w-4" aria-hidden /> : <><ChevronsLeft className="h-4 w-4" aria-hidden /> Daralt</>}
        </button>
      </aside>
  );
}

/** Dar ekran: üst bardaki "Menü" düğmesi + soldan açılan çekmece. */
export function MobileMenu({ groups }: { groups: SidebarGroup[] }) {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-md border border-white/15 px-2.5 py-1.5 text-xs font-semibold text-cream hover:border-[#c9a24a]/60 lg:hidden"
        aria-expanded={open}
        aria-controls="mobile-menu"
      >
        <Menu className="h-4 w-4" aria-hidden /> Menü
      </button>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Ana menü">
          <button type="button" className="absolute inset-0 bg-black/60" aria-label="Menüyü kapat" onClick={() => setOpen(false)} />
          <div id="mobile-menu" className="absolute left-0 top-0 flex h-full w-72 max-w-[85vw] flex-col gap-4 overflow-y-auto border-r border-[#c9a24a]/25 bg-ink p-4 shadow-2xl">
            <button type="button" onClick={() => setOpen(false)} className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-cream/80 hover:bg-white/10">
              <X className="h-4 w-4" aria-hidden /> Kapat
            </button>
            <NavList groups={groups} collapsed={false} onNavigate={() => setOpen(false)} />
          </div>
        </div>
      )}
    </>
  );
}
