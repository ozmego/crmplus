import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AuthShell } from "@/components/auth-shell";
import { LoginForm } from "@/components/auth-forms";
import { readSession } from "@/server/auth/session";

export default async function LoginPage() {
  const session = await readSession();
  if (session?.mfaVerified) redirect("/");
  const t = await getTranslations("auth");
  return (
    <AuthShell>
      <p className="eyebrow mb-1">GİRİŞ</p>
      <h2 className="page-title mb-6">{t("signIn")}</h2>
      <LoginForm />
    </AuthShell>
  );
}
