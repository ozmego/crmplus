import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AuthShell } from "@/components/auth-shell";
import { ChangePasswordForm } from "@/components/auth-forms";
import { readSession } from "@/server/auth/session";

export default async function ChangePasswordPage() {
  const session = await readSession();
  if (!session) redirect("/login");
  const t = await getTranslations("auth");
  return (
    <AuthShell>
      <p className="eyebrow mb-1">HESAP</p>
      <h2 className="page-title mb-2">{t("changeTitle")}</h2>
      <p className="mb-6 text-sm text-muted">{t("changeHint")}</p>
      <ChangePasswordForm />
    </AuthShell>
  );
}
