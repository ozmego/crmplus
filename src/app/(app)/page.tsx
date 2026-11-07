import { redirect } from "next/navigation";
import { can, requireUser } from "@/server/auth/rbac";

/** Rolüne göre kullanıcıyı ilk işine götürür. */
export default async function Home() {
  const u = await requireUser();
  if (can(u, "report.product")) redirect("/ops");
  if (can(u, "call.make")) redirect("/queue");
  if (can(u, "import.create")) redirect("/imports");
  if (can(u, "finance.view")) redirect("/finance");
  if (can(u, "audit.view")) redirect("/admin/audit");
  if (can(u, "user.view")) redirect("/admin/users");
  return <p className="callout-info">Hesabınıza henüz bir rol atanmamış. Yöneticinize başvurun.</p>;
}
