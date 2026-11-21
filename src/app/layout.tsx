import type { Metadata } from "next";
import { Cormorant_Garamond, Manrope } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale } from "next-intl/server";
import "./globals.css";

// Yazı tipleri derleme sırasında indirilip uygulamayla birlikte sunulur (çalışma anında Google'a istek gitmez)
const sans = Manrope({ subsets: ["latin", "latin-ext"], variable: "--font-manrope", display: "swap" });
const display = Cormorant_Garamond({
  subsets: ["latin", "latin-ext"],
  weight: ["500", "600", "700"],
  style: ["normal", "italic"],
  variable: "--font-cormorant",
  display: "swap",
});

export const metadata: Metadata = {
  title: "crmPlus",
  description: "Junket operasyonları için CRM ve çağrı merkezi",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const locale = await getLocale();
  return (
    <html lang={locale} className={`${sans.variable} ${display.variable}`}>
      <body>
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
