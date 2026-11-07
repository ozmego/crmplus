import { cookies } from "next/headers";
import { getRequestConfig } from "next-intl/server";

export const LOCALES = ["tr", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export const LOCALE_COOKIE = "crm_locale";

export default getRequestConfig(async () => {
  const value = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale: Locale = value === "en" ? "en" : "tr";
  return {
    locale,
    timeZone: "Europe/Istanbul",
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
