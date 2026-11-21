import { getTranslations } from "next-intl/server";
import { AudioLines, Database, Gem, Headphones, Lock, MessageSquareText, ShieldCheck } from "lucide-react";

const FEATURES = [
  { icon: Database, label: "Kontrollü veri içe aktarma" },
  { icon: Headphones, label: "Çağrı merkezi ve santral" },
  { icon: AudioLines, label: "Türkçe ses analizi" },
  { icon: MessageSquareText, label: "WhatsApp ve SMS" },
  { icon: ShieldCheck, label: "Rol bazlı yetki ve denetim izi" },
];

/** Giriş ekranları (giriş, şifre değişimi, MFA): siyah-altın premium kabuk. */
export async function AuthShell({ children }: { children: React.ReactNode }) {
  const t = await getTranslations("auth");
  return (
    <main className="theme-noir relative grid min-h-screen overflow-hidden lg:grid-cols-[1.15fr_1fr]">
      {/* Arka plan: altın ışıltı ve ince ızgara */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -left-40 -top-40 h-[560px] w-[560px] rounded-full bg-[radial-gradient(circle,rgb(201_162_74/0.22),transparent_65%)]" />
        <div className="absolute -bottom-56 right-[-120px] h-[620px] w-[620px] rounded-full bg-[radial-gradient(circle,rgb(201_162_74/0.10),transparent_70%)]" />
        <div className="absolute inset-0 opacity-[0.07] [background-image:linear-gradient(rgb(201_162_74)_1px,transparent_1px),linear-gradient(90deg,rgb(201_162_74)_1px,transparent_1px)] [background-size:64px_64px] [mask-image:radial-gradient(ellipse_at_30%_40%,black,transparent_70%)]" />
      </div>

      <section className="relative flex flex-col justify-between px-8 py-10 md:px-16 md:py-14">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-lg border border-[#c9a24a]/50 bg-gradient-to-br from-[#2a2416] to-[#121214] shadow-[0_0_24px_-6px_rgb(201_162_74/0.6)]">
            <Gem className="h-5 w-5 text-[#e8cf8a]" strokeWidth={1.6} aria-hidden />
          </span>
          <span className="font-display text-2xl font-semibold tracking-wide text-[#f3ead6]">
            crm<span className="text-gilded">Plus</span>
          </span>
        </div>

        <div className="my-14 max-w-xl">
          <p className="mb-5 text-[11px] font-semibold uppercase tracking-[0.32em] text-[#c9a24a]">{t("eyebrow")}</p>
          <h1 className="font-display text-5xl font-medium leading-[1.05] text-[#f3ead6] md:text-6xl">
            {t("title")}
          </h1>
          <div className="gold-rule my-8 max-w-xs" />
          <ul className="grid gap-3 sm:grid-cols-2">
            {FEATURES.map(({ icon: Icon, label }) => (
              <li key={label} className="flex items-center gap-3 text-sm text-[#d9d1c0]">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-[#c9a24a]/35 bg-[#c9a24a]/10">
                  <Icon className="h-4 w-4 text-[#e0c072]" strokeWidth={1.7} aria-hidden />
                </span>
                {label}
              </li>
            ))}
          </ul>
        </div>

        <p className="flex items-center gap-2 text-xs text-[#8f887a]">
          <Lock className="h-3.5 w-3.5" aria-hidden /> İç kullanım · Tüm oturumlar kayıt altındadır.
        </p>
      </section>

      <section className="relative flex items-center justify-center px-6 py-10 lg:border-l lg:border-[#c9a24a]/15 lg:bg-[#0e0e10]/80">
        <div className="w-full max-w-md rounded-2xl border border-[#c9a24a]/20 bg-gradient-to-b from-[#17171b] to-[#111113] p-8 shadow-[0_30px_80px_-30px_rgb(0_0_0/0.9),inset_0_1px_0_rgb(232_207_138/0.08)] md:p-10">
          {children}
        </div>
      </section>
    </main>
  );
}
