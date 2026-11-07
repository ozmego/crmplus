import { getTranslations } from "next-intl/server";

/** Giriş ekranları: PDF kapağındaki koyu mürekkep panel + açık form alanı. */
export async function AuthShell({ children }: { children: React.ReactNode }) {
  const t = await getTranslations("auth");
  return (
    <main className="grid min-h-screen md:grid-cols-[1.1fr_1fr]">
      <section className="flex flex-col justify-between bg-ink px-8 py-10 text-cream md:px-14 md:py-14">
        <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-teal">{t("eyebrow")}</p>
        <div className="my-12">
          <p className="mb-3 text-lg font-semibold text-cream/80">crmPlus</p>
          <h1 className="max-w-xl text-4xl font-extrabold leading-[1.1] md:text-5xl">{t("title")}</h1>
          <div className="mt-8 flex flex-wrap gap-2">
            {["Veri içe aktarma", "Çağrı merkezi", "Ses analizi", "WhatsApp + SMS", "Yetki ve denetim"].map((p) => (
              <span key={p} className="rounded-full border border-white/25 px-3 py-1 text-xs text-cream/85">
                {p}
              </span>
            ))}
          </div>
        </div>
        <p className="text-xs text-cream/60">İç kullanım · Tüm oturumlar kayıt altındadır.</p>
      </section>
      <section className="flex items-center justify-center px-6 py-10">
        <div className="w-full max-w-sm">{children}</div>
      </section>
    </main>
  );
}
