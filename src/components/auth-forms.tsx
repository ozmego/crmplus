"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import {
  changePasswordAction,
  loginAction,
  setupMfaAction,
  verifyMfaAction,
  type FormState,
} from "@/app/(auth)/actions";

function ErrorBox({ state }: { state: FormState }) {
  const t = useTranslations("auth");
  if (!state?.error) return null;
  const msg =
    state.error === "policy"
      ? String(state.errorParams?.message ?? "")
      : t(state.error as "invalid", state.errorParams as Record<string, string>);
  return (
    <p role="alert" className="callout-critical">
      {msg}
    </p>
  );
}

export function LoginForm() {
  const t = useTranslations("auth");
  const [state, action, pending] = useActionState(loginAction, undefined);
  // React 19 form eyleminden sonra alanları sıfırlar; e-posta korunur, şifre bilinçli olarak temizlenir.
  const [email, setEmail] = useState("");
  return (
    <form action={action} className="flex flex-col gap-4">
      <div>
        <label className="label" htmlFor="email">{t("email")}</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          className="input"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <div>
        <label className="label" htmlFor="password">{t("password")}</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required className="input" />
      </div>
      <ErrorBox state={state} />
      <button className="btn-primary" disabled={pending}>{t("signIn")}</button>
    </form>
  );
}

export function ChangePasswordForm() {
  const t = useTranslations("auth");
  const tc = useTranslations("common");
  const [state, action, pending] = useActionState(changePasswordAction, undefined);
  return (
    <form action={action} className="flex flex-col gap-4">
      <div>
        <label className="label" htmlFor="password">{t("newPassword")}</label>
        <input id="password" name="password" type="password" autoComplete="new-password" required minLength={12} className="input" />
      </div>
      <div>
        <label className="label" htmlFor="password2">{t("newPassword2")}</label>
        <input id="password2" name="password2" type="password" autoComplete="new-password" required minLength={12} className="input" />
      </div>
      <ErrorBox state={state} />
      <button className="btn-primary" disabled={pending}>{tc("continue")}</button>
    </form>
  );
}

function CodeInput() {
  const t = useTranslations("auth");
  return (
    <div>
      <label className="label" htmlFor="code">{t("mfaCode")}</label>
      <input
        id="code"
        name="code"
        inputMode="numeric"
        autoComplete="one-time-code"
        required
        className="input font-mono text-lg tracking-[0.3em]"
      />
    </div>
  );
}

export function MfaSetupForm() {
  const t = useTranslations("auth");
  const [state, action, pending] = useActionState(setupMfaAction, undefined);
  if (state?.codes) {
    return (
      <div className="flex flex-col gap-4">
        <h2 className="text-lg font-bold text-ink">{t("recoveryTitle")}</h2>
        <p className="callout-warn">{t("recoveryHint")}</p>
        <ul className="grid grid-cols-2 gap-2 rounded-lg border border-line bg-card p-4 font-mono text-sm">
          {state.codes.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        <Link href="/" className="btn-primary">{t("recoveryDone")}</Link>
      </div>
    );
  }
  return (
    <form action={action} className="flex flex-col gap-4">
      <CodeInput />
      <ErrorBox state={state} />
      <button className="btn-primary" disabled={pending}>{t("mfaVerify")}</button>
    </form>
  );
}

export function MfaVerifyForm() {
  const t = useTranslations("auth");
  const [state, action, pending] = useActionState(verifyMfaAction, undefined);
  return (
    <form action={action} className="flex flex-col gap-4">
      <CodeInput />
      <p className="text-xs text-muted">{t("mfaRecovery")}: kurtarma kodunu aynı alana yazabilirsiniz.</p>
      <ErrorBox state={state} />
      <button className="btn-primary" disabled={pending}>{t("mfaVerify")}</button>
    </form>
  );
}
