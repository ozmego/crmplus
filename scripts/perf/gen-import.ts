/**
 * Performans ölçümü için sentetik misafir dosyası (CSV). Kişisel veri değildir.
 *   pnpm exec tsx scripts/perf/gen-import.ts <satır> <çıktı.csv> [--variant]
 * --lean: daha az sütun (500k satır 50 MB dosya sınırının altında kalsın)
 * --variant: toplam yine <satır>; ilk %95 mevcut misafirler (aynı telefon/oyuncu no, %10'unda şehir değişmiş), son %5 yeni misafir.
 */
import { writeFileSync } from "node:fs";

const n = Number(process.argv[2] ?? 10000);
const out = process.argv[3] ?? "perf.csv";
const variant = process.argv.includes("--variant");
const lean = process.argv.includes("--lean");
const FIRST = ["Ayşe", "Mehmet", "Fatma", "Ali", "Zeynep", "Mustafa", "Elif", "Ahmet", "Emine", "Hasan", "Hans", "Anna", "Peter", "Olga"];
const LAST = ["Yılmaz", "Kaya", "Demir", "Şahin", "Çelik", "Yıldız", "Aydın", "Öztürk", "Arslan", "Doğan", "Müller", "Schmidt", "Ivanova"];
const CITY = ["İstanbul", "Ankara", "İzmir", "Antalya", "Bursa", "Berlin", "Köln", "Moskova"];
const header = lean ? "Ad;Soyad;Telefon;E-posta;Ülke;Şehir;Arama İzni;İzin Tarihi;İzin Kaynağı;Oyuncu No;Kaynak" : "Ad;Soyad;Telefon;E-posta;Dil;Ülke;Şehir;Doğum Yılı;Etiketler;Arama İzni;SMS İzni;İzin Tarihi;İzin Kaynağı;Oyuncu No;Kaynak";
const lines = [header];
const total = n;
const existing = variant ? Math.round(n * 0.95) : n;
for (let k = 0; k < total; k++) {
  const i = k < existing ? k : k + 1_000_000; // varyantta son %5 yeni kimlikler
  const op = 530 + (i % 10); // 0530–0539
  const phone = `0${op}${String(1000000 + (i % 9000000)).slice(-7)}`;
  const de = i % 7 === 0;
  const city = variant && i % 10 === 0 ? CITY[(i + 3) % CITY.length] : CITY[i % CITY.length];
  const consent = i % 10 < 7;
  if (lean) {
    lines.push([FIRST[i % FIRST.length], `${LAST[i % LAST.length]}${i}`, phone, `m${i}@o.test`, de ? "DE" : "TR", city, consent ? "EVET" : "", consent ? "2026-10-15" : "", consent ? "Form" : "", `P${100000 + i}`, "Perf"].join(";"));
    continue;
  }
  lines.push([
    FIRST[i % FIRST.length], `${LAST[i % LAST.length]}${i}`, phone, `misafir${i}@ornek.test`,
    de ? "de" : "tr", de ? "DE" : "TR", city, String(1955 + (i % 45)), i % 3 === 0 ? "kıbrıs, hafta-sonu" : "",
    consent ? "EVET" : "", consent && i % 2 ? "EVET" : "", consent ? "2026-10-15" : "", consent ? "Casino kayıt formu" : "",
    `P${100000 + i}`, "Perf Casino",
  ].join(";"));
}
writeFileSync(out, lines.join("\n"), "utf8");
console.log(`${out}: ${total} satır${variant ? " (tekrar yükleme varyantı)" : ""}`);
