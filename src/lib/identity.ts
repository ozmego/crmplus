/**
 * Kimlik alanları — saf yardımcılar (birim testli). Değerler veritabanında şifreli tutulur; burada yalnız doğrulama
 * ve maskeleme yapılır.
 */

/** T.C. kimlik no: 11 hane, ilk hane 0 değil, 10. ve 11. hane sağlama kuralları. */
export function isValidTcNo(v: string): boolean {
  if (!/^[1-9]\d{10}$/.test(v)) return false;
  const d = v.split("").map(Number);
  const odd = d[0] + d[2] + d[4] + d[6] + d[8];
  const even = d[1] + d[3] + d[5] + d[7];
  if ((((odd * 7 - even) % 10) + 10) % 10 !== d[9]) return false;
  return d.slice(0, 10).reduce((a, b) => a + b, 0) % 10 === d[10];
}

/** Pasaport no: boşluk/tire temizlenir, büyük harf; 5–20 harf/rakam. */
export function normalizePassportNo(v: string): string | null {
  const s = v.replace(/[\s-]/g, "").toUpperCase();
  return /^[A-Z0-9]{5,20}$/.test(s) ? s : null;
}

/** "12345678901" → "•••••••••01" (son 2 hane). */
export function maskId(v: string): string {
  return v.length <= 2 ? "••" : "•".repeat(Math.min(v.length - 2, 9)) + v.slice(-2);
}

export const GAMES: Record<string, string> = {
  BACCARAT: "Bakara",
  ROULETTE: "Rulet",
  BLACKJACK: "Blackjack",
  POKER: "Poker",
  SLOT: "Slot",
  OTHER: "Diğer",
};

export const DOCUMENT_KINDS: Record<string, string> = {
  PASSPORT: "Pasaport",
  ID_CARD: "Kimlik kartı",
  PHOTO: "Vesikalık",
  VISA: "Vize",
  OTHER: "Diğer belge",
};

export const DOCUMENT_MIME = ["image/jpeg", "image/png", "application/pdf"] as const;
export const DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;

/** Casino profilinin doluluk denetimi (eksikler listesi; skor değil). */
export function profileGaps(p: {
  hasIdentity: boolean;
  hasBirthDate: boolean;
  hasNationality: boolean;
  passportExpiry: Date | null;
  hasPassportDoc: boolean;
  hasPhoto: boolean;
  hasPreferences: boolean;
  nextTripStart: Date | null;
  nextTripHasTravel: boolean;
  now?: Date;
}): string[] {
  const now = p.now ?? new Date();
  const gaps: string[] = [];
  if (!p.hasIdentity) gaps.push("Kimlik veya pasaport numarası");
  if (!p.hasBirthDate) gaps.push("Doğum tarihi");
  if (!p.hasNationality) gaps.push("Uyruk");
  if (!p.hasPassportDoc) gaps.push("Pasaport/kimlik görüntüsü");
  if (!p.hasPhoto) gaps.push("Vesikalık");
  if (!p.hasPreferences) gaps.push("Oyun tercihleri ve limit");
  if (p.passportExpiry) {
    const ref = p.nextTripStart && p.nextTripStart > now ? p.nextTripStart : now;
    const sixMonths = new Date(ref.getTime() + 183 * 86_400_000);
    if (p.passportExpiry < sixMonths) gaps.push("Pasaport geçerliliği 6 aydan kısa");
  }
  if (p.nextTripStart && !p.nextTripHasTravel) gaps.push("Yaklaşan trip için seyahat bilgisi");
  return gaps;
}
