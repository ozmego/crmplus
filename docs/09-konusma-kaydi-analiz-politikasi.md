# 09 — Konuşma Kaydı ve Analiz Politikası (Aşama 2)

Durum: **Taslak — hukuk teyidi bekliyor** · Sahibi: Uyum + çağrı merkezi müdürü

## 1. Amaç ve sınırlar

Kayıt ve analiz şu amaçlarla yapılır: hizmet kalitesi, mevzuata ve iç kurallara uyum, misafir taleplerinin (özellikle iletişim durdurma) doğru işlendiğinin ispatı, temsilci koçluğu.

Şu amaçlarla **kullanılmaz**:
- Otomatik skorla tek başına disiplin, ücret veya işten çıkarma kararı
- Misafirin duygu durumuna göre pazarlama baskısının artırılması
- Sorumlu oyun sinyallerinin pazarlama hedeflemesinde kullanılması (bu sinyaller yalnız korumaya yönelik kullanılır)

## 2. Bildirim ve rıza

- Her çağrının başında otomatik anons (santral tarafından, temsilci bağlanmadan önce):
  > TR: “Hizmet kalitesi ve güvenliğiniz için bu görüşme kayıt altına alınmaktadır. Kayıt istemiyorsanız lütfen temsilcimize iletiniz.”
  > EN: “This call is recorded for quality and security purposes. If you do not wish to be recorded, please tell our representative.”
- Misafir itiraz ederse temsilci “Kaydı durdur” düğmesine basar. Santral API’siyle kayıt durdurulur ve o noktadan sonra kayıt alınmaz. Durdurmadan önceki kısım saklanır mı? ⚖️ HUKUK (taslak: itiraz anına kadar olan kısım da silinir; yalnız “kayıt itirazı” meta verisi kalır).
- Misafirin “kayıt istemiyorum” tercihi `recordingOptOut` olarak saklanır; sonraki çağrılarda kayıt baştan kapalı başlar.
- ⚖️ HUKUK: Kayıt için açık rıza mı yoksa aydınlatma + meşru menfaat mi yeterli; temsilcilerin (çalışanların) kaydı için aydınlatma metni.

## 3. Saklama

| Veri | Süre | Not |
|---|---|---|
| Ses | 90 gün | Uyum ihlali veya şikâyet bayrağı varsa inceleme kapanana kadar uzatılır (en fazla 1 yıl) |
| Ham transkript | 30 gün | Yalnız `transcript.view.raw` |
| Maskelenmiş transkript | 1 yıl | |
| Skorlar, bayraklar, QA değerlendirmeleri | 2 yıl | Koçluk geçmişi |
| Sağlayıcıdaki kopya | Şirket sunucusuna alındıktan sonra silinir (sağlayıcı izin veriyorsa) | |

## 4. Erişim

| Rol | Ses | Ham transkript | Maskelenmiş transkript | Skor |
|---|---|---|---|---|
| Kalite analisti | Dinler (gerekçe) | ✅ | ✅ | ✅ |
| Takım lideri | Ekibi, gerekçeyle dinler | — | Ekibi | Ekibi |
| Çağrı personeli | — | — | Kendi | Kendi |
| Operasyon yöneticisi | Gerekçeyle dinler | — | ✅ | ✅ |
| Denetçi | — | — | — | Yalnız erişim kayıtları |
| Finans, Veri yükleyici | — | — | — | — |

- Ses indirme (`recording.download`) varsayılan olarak hiç kimsede yoktur. Hukuki talep durumunda geçici olarak, iki onayla verilir.
- Her dinleme AccessLog’a yazılır; günlük > 30 dinleme uyarı üretir.

## 5. Otomatik analizin kullanım kuralları

- Otomatik kalite skoru **destekleyici göstergedir**. Temsilcinin göreceği skor ekranında “otomatik değerlendirme — kesin değildir” uyarısı bulunur.
- ASR güveni düşük çağrılar otomatik skora girmez.
- Temsilci kendi değerlendirmesine **itiraz** edebilir; itiraz QA kuyruğuna düşer ve insan tarafından değerlendirilir.
- Skor kartının her maddesi için otomatik ve insan değerlendirmesi arasındaki uyum (Cohen’s kappa) aylık ölçülür. Kappa < 0,6 olan madde otomatik puanlamadan çıkarılır.

## 6. Sorumlu oyun bayrağı süreci

1. Analiz, misafirin konuşmasında borç, kontrol kaybı, bırakma isteği, kendini sınırlama gibi ifadeler tespit eder.
2. Bayrak yalnız `field.sensitive.rg` izinli kişilere görünür.
3. Misafir için “sorumlu oyun incelemesi” açılır; inceleme kapanana kadar pazarlama araması ve mesajı **durur** (hizmet iletişimi devam edebilir).
4. İnceleyen kişi sonuç girer: yanlış alarm / misafirle görüşüldü / iletişim kalıcı durduruldu / casinoya bilgi verildi (⚖️ HUKUK: casino ile paylaşım dayanağı).
5. Bayrak ve sonuç misafir kartında yalnız yetkililere görünür.

## 7. Skor kartı v1

| # | Madde | Ağırlık | Kanıt yöntemi | Zaman koşulu |
|---|---|---|---|---|
| 1 | Selamlama | 5 | Örnek cümle benzerliği | İlk 15 sn |
| 2 | Kendini ve şirketi tanıtma | 10 | Benzerlik + şirket adı geçmesi | İlk 30 sn |
| 3 | Kayıt bildirimi teyidi (anons yoksa temsilci söyler) | 10 | Anons tespiti veya benzerlik | İlk 30 sn |
| 4 | Arama amacını açıklama | 5 | Benzerlik | İlk 60 sn |
| 5 | İletişim tercihini sorma/teyit | 5 | Benzerlik | — |
| 6 | Ret talebine doğru yanıt (varsa) | **Kritik** | Opt-out tespiti + sonuç kodu = `DO_NOT_CONTACT` | — |
| 7 | Kazanç vaadi / baskı dili yok | **Kritik** | Yasaklı ifade listesi | — |
| 8 | Kapanış | 5 | Benzerlik | Son 30 sn |
| İletişim | Konuşma oranı, söz kesme, sessizlik, monolog | 25 | Akustik metrikler | — |
| Deneyim | Duygu eğrisi | 20 | Duygu modeli | — |
| Kayıt doğruluğu | Sonuç kodu tutarlılığı, not | 15 | Karşılaştırma | — |

Kritik maddelerden biri ihlal edilirse uyum bölümünün puanı 0 olur ve çağrı QA kuyruğuna gider.

## Açık sorular

1. Bulut santral seçildi mi? Stereo kayıt ve AB/TR’de barındırma destekliyor mu?
2. Kayıt itirazında, itirazdan önceki kısım saklanmalı mı? ⚖️
3. Skor kartı maddeleri ve ağırlıkları uygun mu?
4. Sorumlu oyun incelemesinde casino ile bilgi paylaşımı yapılacak mı? ⚖️
5. Analiz sunucusu (GPU) ne zaman temin edilebilir?
