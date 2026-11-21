"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BadgeCheck,
  BookA,
  CalendarClock,
  ChartColumn,
  ClipboardCheck,
  FileUp,
  GitCompareArrows,
  Headphones,
  Inbox,
  Landmark,
  LayoutDashboard,
  MessageSquareText,
  PhoneCall,
  Plug,
  ScrollText,
  Settings,
  UserCog,
  Users,
  type LucideIcon,
} from "lucide-react";

/** Menü ikonları (sunucudan bileşen gönderilemediği için anahtar adıyla seçilir). */
const ICONS: Record<string, LucideIcon> = {
  ops: LayoutDashboard,
  queue: PhoneCall,
  guests: Users,
  imports: FileUp,
  compare: GitCompareArrows,
  review: ClipboardCheck,
  calls: Headphones,
  qa: BadgeCheck,
  messages: MessageSquareText,
  inbox: Inbox,
  reports: ChartColumn,
  finance: Landmark,
  hr: CalendarClock,
  admin: UserCog,
  audit: ScrollText,
  settings: Settings,
  vocabulary: BookA,
  integrations: Plug,
};

export function NavLinks({
  items,
  ariaLabel = "Ana menü",
  tone = "dark",
}: {
  items: { href: string; label: string; exact?: boolean; icon?: string }[];
  ariaLabel?: string;
  /** dark: siyah üst menü · light: sayfa içi alt menüler */
  tone?: "dark" | "light";
}) {
  const path = usePathname();
  return (
    <nav aria-label={ariaLabel} className="flex flex-wrap gap-1">
      {items.map((i) => {
        const active = path === i.href || (!i.exact && path.startsWith(i.href + "/"));
        const Icon = i.icon ? ICONS[i.icon] : undefined;
        const cls =
          tone === "dark"
            ? active
              ? "bg-gradient-to-b from-[#e8cf8a] to-[#c9a24a] text-[#121214] shadow-[0_4px_14px_-6px_rgb(201_162_74/0.7)]"
              : "text-cream/80 hover:bg-white/[0.07] hover:text-cream"
            : active
              ? "bg-ink text-cream"
              : "text-text hover:bg-card";
        return (
          <Link
            key={i.href}
            href={i.href}
            aria-current={active ? "page" : undefined}
            className={"inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-semibold transition-all " + cls}
          >
            {Icon && <Icon className="h-4 w-4 shrink-0" strokeWidth={1.8} aria-hidden />}
            {i.label}
          </Link>
        );
      })}
    </nav>
  );
}
