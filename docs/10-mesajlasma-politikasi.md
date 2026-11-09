# 10 — Mesajlaşma Politikası: Toplu SMS (Aşama 1) ve WhatsApp (Aşama 2)

Durum: **Taslak — hukuk teyidi bekliyor** · Sahibi: Uyum + pazarlama

> ⚖️ HUKUK: Ticari elektronik ileti tanımı, İYS kontrol yükümlülüğü, “bilgilendirme” muafiyetinin kapsamı ve WhatsApp (Meta) üzerinden yurt dışına veri aktarımı hukuk danışmanıyla teyit edilmeden bu modül canlıya alınmaz.

## 0. Aşama 1'de uygulanan (SMS)

- Sağlayıcı soyutlaması: `SMS_PROVIDER = sms-http` (Netgsm / İleti Merkezi seçilince yalnız ayar girilir); geliştirmede `mock`.
- Şablon taslağı → **başka bir yetkili** onaylar. Canlı karakter, kodlama (GSM-7 / UCS-2) ve parça sayacı; Türkçe karakteri dönüştürme düğmesi.
- Kampanya: segment (yalnız §9'daki alanlar) → önizleme (uygun sayı, hariç tutma nedenleri, parça, tahmini maliyet) → **test gönderimi zorunlu** → onaya gönder → onay (hazırlayan ≠ onaylayan, gerekçe, hukuk uygunluk onay kutusu) → gönderimi başlat → hız sınırlı gönderim (`SMS_TPS`), uygunluk **her mesajda yeniden** kontrol edilir, iptal edilirse durur.
- Misafir kartından onaylı şablonla tekil SMS (`message.send.single`), kapsam kontrolüyle.
- İmzalı sağlayıcı webhook'u: gelen `RET` → o kanal için anında durdurma + `OptOutEvent`; teslim raporu → mesaj durumu + telefon erişilebilirlik kanıtı. Aynı olay iki kez işlenmez.
- Her gönderim misafirin iletişim zaman çizelgesine (`Interaction`, kanal = SMS) düşer; mesaj gövdeleri şifreli saklanır.
- **İYS bağlantısı Aşama 2'de.** O zamana kadar Türkiye numaralarına kampanya ve tekil SMS **gönderilmez** (hariç tutma nedeni: “İYS bağlantısı yok”). “İzinli varsay” davranışı yoktur.

## 1. Kanallar

| Kanal | Sağlayıcı (öneri) | Gönderici |
|---|---|---|
| SMS | Netgsm veya İleti Merkezi (İYS entegrasyonlu) | BTK onaylı alfanümerik başlık (ör. `SIRKETADI`) |
| WhatsApp | Meta WhatsApp Business Platform (Cloud API) | Doğrulanmış işletme hesabı + kayıtlı numara |

## 2. Mesaj kategorileri

| Kategori | Örnek | İzin | İYS |
|---|---|---|---|
| `MARKETING` | Trip kampanyası, özel davet, promosyon | Kanal izni `GRANTED` + `scope = MARKETING` | Zorunlu (TR numara) |
| `INFORMATIONAL` | Trip uçuş saati değişikliği, rezervasyon onayı | Kanal izni veya onaylı istisna | ⚖️ HUKUK: muafiyet teyidi; teyide kadar `MARKETING` gibi işlenir |
| `SERVICE` (yalnız WhatsApp) | Misafirin başlattığı konuşmaya yanıt | 24 saat penceresi | Uygulanmaz ⚖️ |

Şablon kategorisi kayıt sırasında seçilir ve sonradan değiştirilemez (yeni sürüm gerekir).

## 3. Gönderim öncesi kontroller

Sırasıyla, her mesaj için:
1. `isContactable(guest, phone, channel, purpose)` (bkz. 04)
2. SMS: hat türü `MOBILE` veya `FIXED_LINE_OR_MOBILE` veya bilinmiyor
3. SMS + TR numara: İYS sorgusu sonucu `ONAY`. İYS yanıt vermezse veya bağlı değilse **gönderilmez** (bilgilendirme muafiyeti hukuk teyidine kadar uygulanmaz).
4. WhatsApp: opt-in kanıtı var; pencere dışındaysa şablon Meta’da `APPROVED`
5. Son 24 saatte aynı misafire aynı kanaldan pazarlama mesajı gönderilmemiş (sıklık sınırı, ayarlanabilir)

## 4. Şablon kuralları

- Değişkenler yalnız beyaz listeden. Aşama 1: `{ad}`, `{soyad}`, `{temsilci_adi}`, `{sehir}`. Aşama 2 (trip modülüyle): `{trip_tarihi}`, `{casino_adi}`, `{otel_adi}`.
- **Yasak değişkenler**: kayıp, kazanç, rolling, komisyon, limit, bakiye ve tüm `financial` alanları; maskesiz kimlik bilgileri.
- **Yasak içerik**: kesin kazanç vaadi, “son şans” gibi baskı dili, borç/kredi teklifi, 18 yaş altını hedefleyen ifade. Sistem şablon kaydında bu ifadeleri tarar ve uyarır; onaylayan kişi uyarıyı görür.
- Pazarlama SMS’lerinin sonuna ret bilgisi otomatik eklenir: `RET yazıp <kısa numara>’ya gönderin` veya İYS ret metni (sağlayıcıya göre). ⚖️ HUKUK: zorunlu ret metni biçimi.
- Şablon onayı: `message.template.manage` hazırlar, `message.campaign.approve` yetkili ikinci kişi onaylar.

## 5. Toplu kampanya onayı

| Kampanya büyüklüğü | Onay |
|---|---|
| ≤ 10.000 mesaj ve ≤ 25.000 TL tahmini maliyet | 1 onay (hazırlayan ≠ onaylayan) — **Aşama 1'de tüm kampanyalar** |
| Daha büyük | 2 onay (iki farklı onaylayan) — Aşama 2 |

Onay ekranında gösterilenler: hedef ve uygun sayı, hariç tutma nedenleri, İYS sonucu, örnek önizlemeler, maliyet, zamanlama, test gönderimi sonucu.

## 6. Ret (opt-out) anahtar kelimeleri

Gelen SMS/WhatsApp mesajı, büyük/küçük harf ve Türkçe karakter normalize edildikten sonra şunlardan biriyle **başlıyor veya tamamen eşleşiyorsa** ret sayılır:

`RET`, `IPTAL`, `İPTAL`, `STOP`, `DUR`, `UNSUBSCRIBE`, `ABONELIK IPTAL`, `ARAMAYIN`, `MESAJ ATMAYIN`, `ISTEMIYORUM`

- Eşleşmede: o kanal için anında `ContactBlock` ve yansıma süresi kaydı. Misafire tek seferlik onay mesajı (“Talebiniz alınmıştır, size bu kanaldan ileti gönderilmeyecektir.”) Aşama 2'de.
- Belirsiz ifadeler (ör. “bir daha yazmayın lütfen”) gelen kutusunda (Aşama 2) **ret şüphesi** etiketiyle en üste alınır; temsilci tek tıkla ret kaydı açar.
- WhatsApp şablonlarında “Aboneliği iptal et” hızlı yanıt butonu pazarlama şablonlarında zorunludur.

## 7. Saklama ve güvenlik

- Mesaj gövdeleri şifreli; 1 yıl sonra içerik silinir, meta veri (kim, ne zaman, kanal, durum, maliyet) kalır.
- Gelen medya ClamAV taramasından geçer, 90 gün saklanır.
- Sağlayıcı anahtarları yalnız `integration.manage` yetkisiyle görülür.
- **WhatsApp yurt dışı aktarım**: kanal, ayarlarda “KVKK aktarım değerlendirmesi yapıldı” onayı (tarih, onaylayan, belge referansı) girilmeden etkinleştirilemez. ⚖️ HUKUK

## 8. Telefon durumuna etkisi

| Olay | Etki |
|---|---|
| SMS `DELIVERED` | Olumlu erişim kanıtı (güven ↑) |
| SMS kalıcı hata (numara yok, abone yok) | Olumsuz kanıt (güven ↓); 2 kez → `UNREACHABLE` |
| WhatsApp `delivered` / `read` | Olumlu kanıt |
| WhatsApp “numara WhatsApp’ta kayıtlı değil” | Yalnız WhatsApp için uygun değil; telefonun genel durumunu etkilemez |

## 9. Segmentasyon sınırı (plan v4 §6)

Segment yalnız şu alanlarla kurulur: **dil, ülke, etiket, son iletişim tarihi** (ileride: yaş uygunluğu, operasyonel tercih). Kayıp/kazanç, komisyon, VIP seviyesi, analizden türetilmiş herhangi bir değer **kullanılamaz**. Segment kural motoru bilinmeyen alanı reddeder (`segmentSchema` — birim testli). Kanal izni ve durdurma kaydı segmentten bağımsız olarak her mesajda kontrol edilir.

## 10. Platform uygunluğu

WhatsApp ticari mesajda önceden opt-in ve ret uyumu ister. Fiziksel casino/etkinlik bilgilendirmesi çevrimiçi kumar tanıtımından ayrıdır; Meta politikası gereği çevrimiçi kumar tanıtımı yapılmaz. Kampanya onay ekranında ülke, içerik, faaliyet ve yerel hukuk uygunluğu için **zorunlu onay kutusu** vardır.

## Açık sorular

1. SMS başlığı (BTK) ve İYS hizmet sağlayıcı kaydı mevcut mu?
2. WhatsApp Business hesabı ve işletme doğrulaması mevcut mu?
3. Mesajlar hangi dillerde gönderilecek? Şablon varyantları buna göre hazırlanır.
4. Sıklık sınırı (24 saatte 1 pazarlama mesajı) uygun mu?
5. Onay eşikleri (10.000 mesaj / 25.000 TL) uygun mu?
6. Gelen mesajlara mesai dışında kim bakacak? Otomatik yanıt gerekli mi?
