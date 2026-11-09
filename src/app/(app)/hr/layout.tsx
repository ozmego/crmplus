import { can, requireUser, scopeOf } from "@/server/auth/rbac";
import type { Permission } from "@/server/auth/permissions";
import { NavLinks } from "@/components/nav-links";

/** wide: izin yalnız “own” kapsamındaysa sekme gösterilmez (ekip/tümü görenler için yönetim ekranı). */
const TABS: { href: string; label: string; perm: Permission; exact?: boolean; wide?: boolean }[] = [
  { href: "/hr", label: "Benim", perm: "attendance.view", exact: true },
  { href: "/hr/my-route", label: "Bugünkü rotam", perm: "route.checkin" },
  { href: "/hr/leave", label: "İzinler", perm: "leave.request" },
  { href: "/hr/employees", label: "Personel", perm: "hr.employee.view" },
  { href: "/hr/roster", label: "Vardiya çizelgesi", perm: "roster.view", wide: true },
  { href: "/hr/routes", label: "Saha rotaları", perm: "route.manage" },
  { href: "/hr/timesheet", label: "Puantaj", perm: "attendance.view", wide: true },
];

export default async function HrLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const items = TABS.filter((t) => can(user, t.perm) && (!t.wide || scopeOf(user, t.perm) !== "own")).map((t) => ({ href: t.href, label: t.label, exact: t.exact }));
  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-lg bg-ink-2 px-3 py-2 text-cream">
        <NavLinks items={items} ariaLabel="Personel modülü" />
      </div>
      {children}
    </div>
  );
}
