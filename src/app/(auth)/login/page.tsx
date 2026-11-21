import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { LoginForm } from "@/components/auth-forms";
import { readSession } from "@/server/auth/session";

export default async function LoginPage() {
  const session = await readSession();
  if (session?.mfaVerified) redirect("/");
  return (
    <AuthShell>
      <p className="eyebrow mb-2">GİRİŞ</p>
      <h2 className="mb-1 font-display text-4xl font-semibold text-ink">Hoş geldiniz</h2>
      <p className="mb-8 text-sm text-muted">Devam etmek için kurumsal hesabınızla giriş yapın.</p>
      <LoginForm />
    </AuthShell>
  );
}
