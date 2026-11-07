import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AuthShell } from "@/components/auth-shell";
import { MfaSetupForm, MfaVerifyForm } from "@/components/auth-forms";
import { readSession } from "@/server/auth/session";
import { ensureMfaSecret } from "@/server/auth/account";
import { mfaQrDataUrl } from "@/server/auth/mfa";

export default async function MfaPage() {
  const session = await readSession();
  if (!session) redirect("/login");
  if (session.user.mustChangePassword) redirect("/change-password");
  if (session.mfaVerified) redirect("/");
  const t = await getTranslations("auth");

  if (session.user.mfaEnabledAt) {
    return (
      <AuthShell>
        <p className="eyebrow mb-1">MFA</p>
        <h2 className="page-title mb-2">{t("mfaTitle")}</h2>
        <p className="mb-6 text-sm text-muted">{t("mfaPrompt")}</p>
        <MfaVerifyForm />
      </AuthShell>
    );
  }

  const secret = await ensureMfaSecret();
  if (!secret) redirect("/login");
  const qr = await mfaQrDataUrl(secret, session.user.email);
  return (
    <AuthShell>
      <p className="eyebrow mb-1">MFA</p>
      <h2 className="page-title mb-4">{t("mfaSetupTitle")}</h2>
      <ol className="mb-4 list-decimal space-y-1 pl-5 text-sm">
        <li>{t("mfaSetupStep1")}</li>
        <li>{t("mfaSetupStep2")}</li>
      </ol>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={qr} alt="MFA QR kodu" width={180} height={180} className="mb-3 rounded-md border border-line" />
      <p className="mb-1 text-xs text-muted">{t("mfaManual")}</p>
      <p className="mb-5 break-all rounded bg-card px-2 py-1 font-mono text-xs">{secret}</p>
      <MfaSetupForm />
    </AuthShell>
  );
}
