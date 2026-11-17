/** Kalite kriter seti v1 (docs/09 §5 yerine; puan yok). */
export interface Criterion {
  key: string;
  label: string;
  description: string;
}
export type CriterionResult = "MET" | "NOT_MET" | "NA";

export const DEFAULT_CRITERIA: Criterion[] = [
  { key: "greeting", label: "Selamlama ve kendini tanıtma", description: "Temsilci adını ve şirketi söyledi." },
  { key: "recording_notice", label: "Kayıt bildirimi", description: "Anons yoksa kayıt bilgisi verildi; itiraz edilirse kayıt durduruldu." },
  { key: "purpose", label: "Arama amacını açıklama", description: "Aramanın nedeni açık ve doğru anlatıldı." },
  { key: "preference", label: "İletişim tercihini teyit", description: "Kanal ve zaman tercihi soruldu veya teyit edildi." },
  { key: "opt_out", label: "Ret talebine doğru yanıt", description: "Misafir istemediğini söylediyse ısrar edilmedi ve durdurma kaydı açıldı." },
  { key: "no_pressure", label: "Kazanç vaadi / baskı dili yok", description: "Kesin kazanç, “son şans”, borç/kredi teklifi gibi ifade kullanılmadı." },
  { key: "record_accuracy", label: "Doğru sonuç kodu ve not", description: "Sonuç kodu görüşmeyle tutarlı, not yeterli." },
  { key: "closing", label: "Kapanış", description: "Sonraki adım ve teşekkür." },
];

