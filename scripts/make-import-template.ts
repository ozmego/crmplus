/**
 * docs/templates/misafir-import.xlsx üretir (alan sözlüğü: src/lib/import/fields.ts, docs/02).
 * Çalıştırma: pnpm exec tsx scripts/make-import-template.ts
 */
import ExcelJS from "exceljs";
import { mkdirSync } from "node:fs";
import { FIELDS, suggestMapping } from "../src/lib/import/fields";

const COLUMNS: { header: string; key: string; example: string; note: string }[] = [
  { header: "CRM ID", key: "crmId", example: "", note: "Varsa CRM numarası; yeni misafirde boş" },
  { header: "Oyuncu No", key: "externalId", example: "C-104233", note: "Casino oyuncu numarası" },
  { header: "Kaynak", key: "externalSource", example: "Merit Royal", note: "Dış kimliğin kaynağı (casino/iş ortağı)" },
  { header: "Ad", key: "firstName", example: "Ayşe", note: "Zorunlu (veya Ad Soyad)" },
  { header: "Soyad", key: "lastName", example: "Kaya", note: "Zorunlu (veya Ad Soyad)" },
  { header: "Telefon 1", key: "phone1", example: "+90 532 000 00 00", note: "Ülke kodlu yazın; yoksa Türkiye varsayılır" },
  { header: "Telefon 2", key: "phone2", example: "", note: "" },
  { header: "E-posta", key: "email", example: "ayse@example.com", note: "" },
  { header: "Dil", key: "language", example: "tr", note: "ISO 639-1 (tr, en, de, ru…)" },
  { header: "Ülke", key: "country", example: "TR", note: "ISO 3166 iki harf" },
  { header: "Şehir", key: "city", example: "İstanbul", note: "" },
  { header: "Doğum Yılı", key: "birthYear", example: "1980", note: "Yaş uygunluğu için; tam doğum tarihi gerekmez" },
  { header: "Etiketler", key: "tags", example: "kıbrıs, hafta-sonu", note: "Virgülle ayırın" },
  { header: "Temsilci", key: "ownerAgent", example: "temsilci1@crmplus.local", note: "Sahip temsilcinin e-postası" },
  { header: "Not", key: "notes", example: "", note: "Finansal bilgi, sağlık veya kimlik numarası yazmayın" },
  { header: "Arama İzni", key: "consentCall", example: "EVET", note: "EVET / HAYIR / boş (bilinmiyor → aranmaz)" },
  { header: "SMS İzni", key: "consentSms", example: "", note: "EVET / HAYIR / boş" },
  { header: "WhatsApp İzni", key: "consentWhatsapp", example: "", note: "EVET / HAYIR / boş" },
  { header: "E-posta İzni", key: "consentEmail", example: "", note: "EVET / HAYIR / boş" },
  { header: "İzin Tarihi", key: "consentDate", example: "2026-10-15", note: "İzin verildiyse zorunlu" },
  { header: "İzin Kaynağı", key: "consentSource", example: "Casino kayıt formu", note: "İzin verildiyse zorunlu" },
  { header: "İzin Kanıtı", key: "consentProofRef", example: "FORM-2026-0412", note: "Form/kayıt referansı" },
];

// Şablon başlıkları otomatik eşlemeyle birebir eşleşmeli
const m = suggestMapping(COLUMNS.map((c) => c.header));
for (const c of COLUMNS) {
  if (m[c.header] !== c.key) throw new Error(`Başlık eşlenmiyor: ${c.header} → ${m[c.header]} (beklenen ${c.key})`);
}

const wb = new ExcelJS.Workbook();
wb.creator = "crmPlus";
const ws = wb.addWorksheet("Misafirler", { views: [{ state: "frozen", ySplit: 1 }] });
ws.columns = COLUMNS.map((c) => ({ header: c.header, key: c.key, width: Math.max(14, c.header.length + 4) }));
ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF12252F" } };
COLUMNS.forEach((c, i) => {
  if (c.note) ws.getCell(1, i + 1).note = c.note;
  ws.getColumn(i + 1).numFmt = "@"; // telefon ve kimlikler metin olarak kalsın
});
ws.addRow(Object.fromEntries(COLUMNS.map((c) => [c.key, c.example])));

const info = wb.addWorksheet("Açıklama");
info.columns = [{ header: "Sütun", width: 18 }, { header: "Alan", width: 30 }, { header: "Hassasiyet", width: 12 }, { header: "Açıklama", width: 70 }];
info.getRow(1).font = { bold: true };
const SENS: Record<string, string> = { G: "Genel", K: "Kişisel", I: "İletişim", KM: "Kimlik", F: "Finansal", N: "Not" };
for (const c of COLUMNS) {
  const f = FIELDS.find((x) => x.key === c.key)!;
  info.addRow([c.header, f.label, SENS[f.sensitivity], c.note]);
}
info.addRow([]);
info.addRow(["Kurallar", "", "", "Finansal sütunlar (kayıp, kazanç, rolling, komisyon) CRM'e alınmaz; finans modülüne ayrı yüklenir."]);
info.addRow(["", "", "", "Dosyada olmayan misafir silinmez. Dolu alan kullanıcı kararı olmadan ezilmez."]);
info.addRow(["", "", "", "Telefon tek başına kimlik değildir: eşleşme CRM ID → dış kimlik → telefon + ad sırasıyla yapılır."]);
info.addRow(["", "", "", "İzin bilgisi boş bırakılırsa durum 'bilinmiyor' olur ve misafir aranmaz / mesaj almaz."]);

mkdirSync("docs/templates", { recursive: true });
void wb.xlsx.writeFile("docs/templates/misafir-import.xlsx").then(() => console.log("docs/templates/misafir-import.xlsx yazıldı:", COLUMNS.length, "sütun"));
