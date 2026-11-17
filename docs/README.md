# crmPlus — Ürün Belgeleri (Aşama 0, plan v4 ile güncel)

Bu klasör, geliştirme başlamadan önce kesinleşmesi gereken kuralları içerir. Kod bu belgelerden türetilir: izin listesi, sonuç kodları, alan sözlüğü ve KPI formülleri `prisma/seed.ts` ve testlere birebir aktarılır. Bir kural değişirse önce ilgili belge güncellenir, sonra kod.

| # | Belge | Sahibi (önerilen) | Durum |
|---|---|---|---|
| 01 | [Rol ve izin matrisi](01-rol-izin-matrisi.md) | Operasyon müdürü + BT | Taslak |
| 02 | [Excel şablonu ve alan sözlüğü](02-excel-sablonu-alan-sozlugu.md) | Veri sorumlusu | Taslak |
| 03 | [Çağrı sonuç kodları ve görev durumları](03-cagri-sonuc-kodlari-gorev-durumlari.md) | Çağrı merkezi müdürü | Taslak |
| 04 | [İzin, ret ve kayıt bilgilendirme akışı](04-izin-ret-arama-engelleme.md) | Uyum + hukuk | Taslak — hukuk teyidi bekliyor |
| 05 | [Rapor tanımları ve KPI formülleri](05-rapor-kpi-tanimlari.md) | Operasyon müdürü | Taslak |
| 06 | [Komisyon hesaplama ve onay akışı](06-komisyon-hesaplama-onay-akisi.md) | Finans müdürü | Taslak — sözleşme örnekleri bekliyor |
| 07 | [Veri envanteri ve saklama](07-veri-envanteri-saklama.md) | KVKK irtibat kişisi | Taslak — hukuk teyidi bekliyor |
| 08 | [Güvenlik olay müdahale prosedürü](08-guvenlik-olay-mudahale.md) | BT güvenlik | Taslak |
| 09 | [Ses kaydı ve Türkçe analiz politikası](09-konusma-kaydi-analiz-politikasi.md) | Uyum + çağrı merkezi | Taslak — hukuk teyidi bekliyor |
| 10 | [Mesajlaşma politikası (SMS/WhatsApp)](10-mesajlasma-politikasi.md) | Uyum + pazarlama | Taslak — hukuk teyidi bekliyor |
| 11 | [Personel verisi ve puantaj politikası](11-personel-puantaj-politikasi.md) | İK + hukuk | Taslak — Aşama 1B öncesi onaylanmalı |
| 12 | [Kurulum ve işletim (üretim)](12-kurulum-isletim.md) | BT | Taslak |

Şablon: [templates/misafir-import.xlsx](templates/misafir-import.xlsx) — başlıkları otomatik eşlemeyle birebir uyumlu (`scripts/make-import-template.ts` ile üretilir).
Plan: [crmPlus_Uygulama_Plani_v4.pdf](crmPlus_Uygulama_Plani_v4.pdf).

## Belge kuralları

- Her belgenin sonunda **Açık sorular** bölümü vardır. Bu sorular yanıtlanmadan belge “Onaylandı” durumuna geçmez.
- `⚖️ HUKUK` işaretli maddeler hukuk danışmanının yazılı teyidini gerektirir. Bu belgeler hukuki görüş değildir.
- Sayısal varsayılanlar (saklama süreleri, eşikler, oranlar) sistemde **ayarlanabilir** olarak kodlanır. Belgedeki değer yalnızca ilk değerdir.

## Sabit kararlar (keşif görüşmesinden)

- Sistem saat dilimi: `Europe/Istanbul`. Misafirin saat dilimi tutulur ve yerel saati kuyrukta **yalnız gösterilir**; arama saati kuralı yok.
- Varsayılan telefon ülkesi: TR. Yabancı numaralar `+` ülke koduyla kabul edilir.
- Ölçek: 15–60 çağrı personeli, ≤ 500.000 misafir kaydı.
- Komisyon: kademeli/karma kurallar.
- Santral: bulut (3CX veya SIP sağlayıcı), **Aşama 1**; manuel mod yalnız yedek.
- Ses kaydı ve Türkçe transkript: **Aşama 1**, karar kapısına bağlı.
- Mesajlaşma: SMS **Aşama 1** (İYS bağlantısı Aşama 2), WhatsApp Business (Meta Cloud API) Aşama 2.
- Kayıp/kazanç yalnız finans modülünde; hedefleme, öncelik, segment veya skor için kullanılmaz.
- Kurulum: şirketin kendi sunucusu, Docker Compose.
- Arayüz dilleri: Türkçe (varsayılan) ve İngilizce.
