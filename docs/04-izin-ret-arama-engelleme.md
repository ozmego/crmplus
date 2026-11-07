# 04 — İzin/Ret ve Arama Engelleme Akışı

Durum: **Taslak — hukuk teyidi bekliyor** · Sahibi: Uyum + hukuk

> Bu belge hukuki görüş değildir. `⚖️ HUKUK` işaretli maddeler hukuk danışmanının yazılı teyidiyle kesinleşir. Türkiye’de telefonla yapılan pazarlama aramaları ve SMS/WhatsApp mesajları 6563 sayılı Kanun ve Ticari İletişim ve Ticari Elektronik İletiler Hakkında Yönetmelik kapsamına girebilir. İleti Yönetim Sistemi (İYS) yükümlülükleri bu kapsama bağlıdır.

## 1. Temel kural

**Varsayılan: iletişim yok.** Bir misafir, ilgili kanalda kanıtlı ve geçerli izni olmadıkça o kanaldan aranmaz ve mesaj almaz. İzin durumu bilinmeyen (`UNKNOWN`) kayıt, reddedilmiş (`DENIED`) kayıtla aynı şekilde kuyruğa giremez.

## 2. İzin kaydı (kanal bazında)

Kanallar: `CALL`, `SMS`, `WHATSAPP`, `EMAIL`.

| Alan | Açıklama |
|---|---|
| `status` | `GRANTED` / `DENIED` / `UNKNOWN` |
| `grantedAt` / `deniedAt` | İzin veya ret tarihi |
| `source` | İznin nereden alındığı (casino formu, web formu, sözlü beyan, İYS, misafirin kendi mesajı) |
| `sourceSystem` | Bilginin hangi sistemden geldiği (CRM, İYS, import batch #, casino X) |
| `proofRef` / `proofFile` | Kanıt: form no, imzalı belge taraması, çağrı kaydı referansı, İYS işlem no |
| `scope` | Kapsam: `MARKETING` (pazarlama), `SERVICE` (hizmet/bilgilendirme) |
| `validUntil` | Varsa geçerlilik sonu |
| `iysRef` | İYS kayıt referansı |
| `recordedBy` | Kaydı giren kullanıcı |

Her değişiklik `ConsentHistory`’ye yazılır; eski kayıtlar silinmez.

## 3. Uygunluk fonksiyonu

`isContactable(guest, phone, channel, purpose, now)` tek bir yerde tanımlıdır ve **üç noktada** çağrılır:
1. Görev/kampanya hedefi oluşturulurken
2. Kuyruk listelenirken (her satır)
3. “Ara” / “Gönder” anında

Uygun olması için hepsi sağlanmalı:

| # | Koşul |
|---|---|
| 1 | Kanal izni `GRANTED`, `scope` amaçla uyumlu, `validUntil` geçmemiş |
| 2 | Kanal (veya tüm kanallar) için aktif `ContactBlock` yok |
| 3 | Telefon `formatStatus = VALID` ve `ownership ≠ DISPUTED` |
| 4 | Pazarlama amacında: açık sorumlu oyun incelemesi yok |
| 5 | SMS/WhatsApp’ta kanal ek kuralları (bkz. 10) |
| 6 | Onaylanmış ve süresi geçmemiş bir `ConsentException` varsa 1. koşulun yerine geçebilir (2–4 yine zorunlu) |

Arama saati kuralı **yoktur** (karar: tek saat dilimi, kural yok). ⚖️ HUKUK: Arama saatine dair bağlayıcı bir kural olup olmadığı teyit edilmeli.

Sonuç `false` ise nedeni döner (`NO_CONSENT`, `CONSENT_DENIED`, `CONSENT_EXPIRED`, `BLOCKED`, `INVALID_PHONE`, `DISPUTED_PHONE`, `RG_REVIEW`, `IYS_DENIED`). Neden kodları kampanya ekranında “hariç tutulanlar” özetinde gösterilir.

## 4. İletişim durdurma (ret) talebi

Misafir hangi kanaldan (çağrı, SMS “RET”, WhatsApp, e-posta, casino aracılığıyla, yüz yüze) “benimle iletişim kurmayın” derse:

1. Talebi alan **herkes** `block.create` ile durdurma kaydı açabilir (tek ekran: Misafir kartı → “İletişimi durdur”).
2. Kayıt alanları: kapsam (yalnız bu kanal / tüm kanallar), talep zamanı (`requestedAt`, talep edildiği an), sisteme giriş zamanı (`recordedAt`), kanal, kanıt.
3. **Anında etkiler** (aynı veritabanı işleminde):
   - İlgili kanal izinleri `DENIED` olur.
   - Açık görevler `CANCELLED` (neden: durdurma).
   - Kampanya girişleri ve planlı mesajlar iptal.
   - Bekleyen geri aramalar `CANCELLED`.
4. Metrik: **yansıma süresi** = `recordedAt − requestedAt`. Çağrı ve mesaj kanalında hedef: anlık (< 1 dk, sistem otomatik). Yazılı/casino aracılığıyla gelen taleplerde hedef: < 24 saat. ⚖️ HUKUK: Ret bildiriminin yasal işlenme süresi teyit edilmeli (Yönetmelikteki süre ve İYS’ye yansıtma yükümlülüğü).
5. İYS kapsamındaki kanallarda ret, Aşama 2’de İYS’ye de bildirilir (Aşama 1’de İYS’ye bildirilecekler listesi raporu üretilir).
6. Durdurma kaydını kaldırmak: yalnız misafirin **yeni ve kanıtlı** izniyle, `block.remove` + ikinci onay + gerekçe.

## 5. İzin istisnası

Bazı durumlarda iznin olmadığı ama iletişimin gerekli olduğu düşünülebilir (ör. misafirin yaklaşan tripi için zorunlu hizmet bilgilendirmesi).

- Yalnız `SERVICE` amacı için talep edilebilir. **Pazarlama için istisna yoktur.**
- Akış: talep (`consent.exception.request`, gerekçe + kapsam + süre ≤ 7 gün) → onay (`consent.exception.approve`, talep edenden farklı kişi) → kayıt.
- Aktif `ContactBlock` varsa istisna açılamaz.
- ⚖️ HUKUK: Hizmet/bilgilendirme iletişiminin hangi koşullarda izin gerektirmediği ve hangi içeriklerin “ticari” sayıldığı teyit edilmeli. Teyit gelene kadar istisna özelliği **kapalı** gelir.

## 6. İYS

- Aşama 1: İYS’den alınan izin/ret listeleri dosya olarak içe aktarılır (`sourceSystem = IYS`). İYS kaydı ile CRM kaydı çelişirse **İYS’deki ret kazanır**; İYS’deki onay, CRM’deki ret’i ezmez (inceleme kuyruğu).
- Aşama 2: Sağlayıcı İYS API’si ile gönderim öncesi sorgu ve ret bildirimi.
- ⚖️ HUKUK: Şirketin İYS’ye kayıtlı “hizmet sağlayıcı” olması gerekip gerekmediği, sesli arama kanalının İYS kapsamı ve misafirlerin tacir/esnaf ayrımı teyit edilmeli.
- İYS sorumlusu: (Açık soru 1)

## 7. Yurt dışındaki misafirler

Yabancı numaralı misafirlerde İYS kontrolü uygulanmaz, ancak CRM izin kuralı aynen geçerlidir. ⚖️ HUKUK: AB vatandaşı misafirler için GDPR kapsamı değerlendirilmeli.

## 8. Ekranlar

- Misafir kartı → **İzinler** paneli: kanal başına durum rozeti, kaynak, tarih, kanıt bağlantısı, geçmiş.
- **İzin durumu eksik kayıtlar** listesi (operasyon paneli): `UNKNOWN` misafirler, kaynağa göre gruplu; toplu izin importuna yönlendirme.
- **Durdurma talepleri** raporu: son 30 gün, yansıma süresi dağılımı.

## Açık sorular

1. İzin ve İYS süreçlerinin sahibi kim? (Kişi/ekip)
2. Casinolar misafir izinlerini sizinle paylaşıyor mu? Paylaşıyorsa izin metni şirketinizi kapsıyor mu? ⚖️ HUKUK
3. Sözlü izin (çağrı sırasında) kabul edilecek mi? Edilecekse kanıt olarak çağrı kaydı (Aşama 2) mı, temsilci beyanı mı yeterli?
4. İzin geçerlilik süresi tanımlı olmalı mı (ör. 2 yıl iletişim olmazsa yeniden izin)?
5. Mevcut veritabanındaki misafirlerin izin durumu ne? İlk yüklemede büyük çoğunluk `UNKNOWN` olacaksa izin toplama planı gerekir.
