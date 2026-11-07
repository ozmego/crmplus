"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function NavLinks({ items }: { items: { href: string; label: string }[] }) {
  const path = usePathname();
  return (
    <nav aria-label="Ana menü" className="flex flex-wrap gap-1">
      {items.map((i) => {
        const active = path === i.href || path.startsWith(i.href + "/");
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
