"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function NavLinks({ items, ariaLabel = "Ana menü" }: { items: { href: string; label: string; exact?: boolean }[]; ariaLabel?: string }) {
  const path = usePathname();
  return (
    <nav aria-label={ariaLabel} className="flex flex-wrap gap-1">
      {items.map((i) => {
        const active = path === i.href || (!i.exact && path.startsWith(i.href + "/"));
        return (
          <Link
            key={i.href}
            href={i.href}
            aria-current={active ? "page" : undefined}
            className={
              "rounded px-3 py-1.5 text-sm font-medium transition-colors " +
              (active ? "bg-cream text-ink" : "text-cream/85 hover:bg-white/10")
            }
          >
            {i.label}
          </Link>
        );
      })}
    </nav>
  );
}
