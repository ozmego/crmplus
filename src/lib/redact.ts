/**
 * Serbest metinde hassas kişisel veri maskeleme (docs/03 §2, docs/09).
 * Not kaydı engellenmez; bulunan değerler maskelenir ve kullanıcı uyarılır.
 */

export type RedactionKind = "CARD" | "IBAN" | "TCKN" | "PHONE" | "EMAIL";

export interface RedactionResult {
  text: string;
  found: RedactionKind[];
}

function luhnValid(digits: string): boolean {
  let sum = 0;
  let dbl = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (dbl) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

export function tcknValid(s: string): boolean {
  if (!/^[1-9]\d{10}$/.test(s)) return false;
  const d = s.split("").map(Number);
  const odd = d[0] + d[2] + d[4] + d[6] + d[8];
  const even = d[1] + d[3] + d[5] + d[7];
  const d10 = (((odd * 7 - even) % 10) + 10) % 10;
  const d11 = d.slice(0, 10).reduce((a, b) => a + b, 0) % 10;
  return d[9] === d10 && d[10] === d11;
}

function ibanValid(raw: string): boolean {
  const s = raw.replace(/\s/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(s)) return false;
  const rearranged = s.slice(4) + s.slice(0, 4);
  let rem = 0;
  for (const ch of rearranged) {
    const v = /[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch;
    for (const c of v) rem = (rem * 10 + (c.charCodeAt(0) - 48)) % 97;
  }
  return rem === 1;
}

export function redactSensitive(input: string): RedactionResult {
  const found = new Set<RedactionKind>();
  let text = input;

  text = text.replace(/\b[A-Za-z]{2}\d{2}(?:[ ]?[A-Za-z0-9]{4}){3,7}(?:[ ]?[A-Za-z0-9]{1,4})?\b/g, (m) => {
    if (!ibanValid(m)) return m;
    found.add("IBAN");
    return "[IBAN]";
  });

  text = text.replace(/\b\d(?:[ -]?\d){12,18}\b/g, (m) => {
    const digits = m.replace(/\D/g, "");
    if (digits.length < 13 || digits.length > 19 || !luhnValid(digits)) return m;
    found.add("CARD");
    return "[KART]";
  });

  text = text.replace(/\b\d{11}\b/g, (m) => {
    if (!tcknValid(m)) return m;
    found.add("TCKN");
    return "[TC KİMLİK]";
  });

  text = text.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, () => {
    found.add("EMAIL");
    return "[E-POSTA]";
  });

  text = text.replace(/(?:\+|00)?\d[\d ()-]{8,}\d/g, (m) => {
    const digits = m.replace(/\D/g, "");
    if (digits.length < 10 || digits.length > 15) return m;
    found.add("PHONE");
    return "[TELEFON]";
  });

  return { text, found: [...found] };
}
