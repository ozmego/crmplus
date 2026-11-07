# Junket CRM — Ürün Belgeleri (Aşama 0)

Bu klasör, geliştirme başlamadan önce kesinleşmesi gereken kuralları içerir. Kod bu belgelerden türetilir: izin listesi, sonuç kodları, alan sözlüğü ve KPI formülleri `prisma/seed.ts` ve testlere birebir aktarılır. Bir kural değişirse önce ilgili belge güncellenir, sonra kod.

| # | Belge | Sahibi (önerilen) | Durum |
|---|---|---|---|
| 01 | [Rol ve izin matrisi](01-rol-izin-matrisi.md) | Operasyon müdürü + BT | Taslak |
| 02 | [Excel şablonu ve alan sözlüğü](02-excel-sablonu-alan-sozlugu.md) | Veri sorumlusu | Taslak |
| 03 | [Çağrı sonuç kodları ve görev durumları](03-cagri-sonuc-kodlari-gorev-durumlari.md) | Çağrı merkezi müdürü | Taslak |
| 04 | [İzin/ret ve arama engelleme akışı](04-izin-ret-arama-engelleme.md) | Uyum + hukuk | Taslak — hukuk teyidi bekliyor |
| 05 | [Rapor tanımları ve KPI formülleri](05-rapor-kpi-tanimlari.md) | Operasyon müdürü | Taslak |
| 06 | [Komisyon hesaplama ve onay akışı](06-komisyon-hesaplama-onay-akisi.md) | Finans müdürü | Taslak — sözleşme örnekleri bekliyor |
| 07 | [Veri envanteri ve saklama](07-veri-envanteri-saklama.md) | KVKK irtibat kişisi | Taslak — hukuk teyidi bekliyor |
| 08 | [Güvenlik olay müdahale prosedürü](08-guvenlik-olay-mudahale.md) | BT güvenlik | Taslak |
| 09 | [Konuşma kaydı ve analiz politikası](09-konusma-kaydi-analiz-politikasi.md) | Uyum + çağrı merkezi | Taslak — hukuk teyidi bekliyor |
| 10 | [Mesajlaşma politikası (SMS/WhatsApp)](10-mesajlasma-politikasi.md) | Uyum + pazarlama | Taslak — hukuk teyidi bekliyor |

## Belge kuralları

- Her belgenin sonunda **Açık sorular** bölümü vardır. Bu sorular yanıtlanmadan belge “Onaylandı” durumuna geçmez.
- `⚖️ HUKUK` işaretli maddeler hukuk danışmanının yazılı teyidini gerektirir. Bu belgeler hukuki görüş değildir.
- Sayısal varsayılanlar (saklama süreleri, eşikler, oranlar) sistemde **ayarlanabilir** olarak kodlanır. Belgedeki değer yalnızca ilk değerdir.

## Sabit kararlar (keşif görüşmesinden)

- Tek saat dilimi: `Europe/Istanbul`. Misafir bazlı saat dilimi yok, arama saati kuralı yok.
- Varsayılan telefon ülkesi: TR. Yabancı numaralar `+` ülke koduyla kabul edilir.
- Ölçek: 15–60 çağrı personeli, ≤ 500.000 misafir kaydı.
- Komisyon: kademeli/karma kurallar.
- Santral: bulut (3CX veya SIP sağlayıcı), Aşama 2.
- Mesajlaşma: toplu SMS (İYS entegrasyonlu yerli sağlayıcı) ve WhatsApp Business (Meta Cloud API), Aşama 2.
- Kurulum: şirketin kendi sunucusu, Docker Compose.
- Arayüz dilleri: Türkçe (varsayılan) ve İngilizce.
