import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js/max";

/**
 * Telefon normalizasyonu — docs/02 §5.
 * Saf fonksiyon: veritabanına dokunmaz, testlerde doğrudan kullanılır.
 */

export type PhoneErrorCode = "E_PHONE_EMPTY" | "E_PHONE_SCIENTIFIC" | "E_PHONE_INVALID";

export interface NormalizedPhone {
  ok: boolean;
  input: string;
  e164?: string;
  country?: string;
  lineType?: string;
  masked?: string;
  changed?: boolean; // girdi E.164'ten farklıydı
  countryMismatch?: boolean;
  error?: PhoneErrorCode;
}

export function normalizePhone(rawInput: unknown, defaultCountry: string = "TR", expectedCountry?: string | null): NormalizedPhone {
  const input = rawInput === null || rawInput === undefined ? "" : String(rawInput).trim();
  if (!input) return { ok: false, input, error: "E_PHONE_EMPTY" };

  // Excel'in sayıya çevirip bilimsel gösterime bozduğu numaralar
  if (/^\d+(\.\d+)?e\+\d+$/i.test(input.replace(",", "."))) {
    return { ok: false, input, error: "E_PHONE_SCIENTIFIC" };
  }

  let s = input.replace(/^'/, "").replace(/[\s\-.()/]/g, "");
  if (s.startsWith("00")) s = "+" + s.slice(2);

  const country = defaultCountry.toUpperCase() as CountryCode;
  if (!s.startsWith("+")) {
    if (country === "TR") {
      if (/^0\d{10}$/.test(s)) s = "+90" + s.slice(1);
      else if (/^5\d{9}$/.test(s)) s = "+90" + s;
      else if (/^90\d{10}$/.test(s)) s = "+" + s;
    }
  }

  const parsed = s.startsWith("+") ? parsePhoneNumberFromString(s) : parsePhoneNumberFromString(s, country);
  if (!parsed || !parsed.isValid()) return { ok: false, input, error: "E_PHONE_INVALID" };

  const e164 = parsed.number;
  const detected = parsed.country ?? undefined;
  return {
    ok: true,
    input,
    e164,
    country: detected,
    lineType: parsed.getType() ?? "UNKNOWN",
    masked: maskE164(e164, parsed.countryCallingCode),
    changed: input !== e164,
    countryMismatch: !!expectedCountry && !!detected && expectedCountry.toUpperCase() !== detected,
  };
}

/** "+905321234518" → "+90 532 *** ** 18" (ülke kodu, ilk 3 hane ve son 2 hane görünür). */
export function maskE164(e164: string, callingCode?: string): string {
  const cc = callingCode ?? (e164.startsWith("+90") ? "90" : e164.slice(1, 3));
  const national = e164.slice(1 + cc.length);
  if (national.length <= 5) return `+${cc} ${"*".repeat(national.length)}`;
  const head = national.slice(0, 3);
  const tail = national.slice(-2);
  const hidden = national.length - 5;
  const stars = hidden > 3 ? `${"*".repeat(3)} ${"*".repeat(hidden - 3)}` : "*".repeat(hidden);
  return `+${cc} ${head} ${stars} ${tail}`;
}

/** Hat türü SMS için uygun mu? (docs/10 §3) */
export function smsCapable(lineType?: string | null): boolean {
  return !lineType || ["MOBILE", "FIXED_LINE_OR_MOBILE", "UNKNOWN"].includes(lineType);
}
