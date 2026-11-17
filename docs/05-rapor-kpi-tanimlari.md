# 05 — Rapor Tanımları ve KPI Formülleri

Durum: **Taslak** · Sahibi: Operasyon müdürü

Bu belgedeki formüller testlerde birebir kullanılır. Bir formül değişirse önce burası güncellenir.

## 1. Genel kurallar

- Tüm tarihler `Europe/Istanbul` saat dilimine göre gruplanır. “Gün” = 00:00–23:59 İstanbul saati.
- Bir çağrı, `startedAt` tarihinin gününe ait sayılır.
- `autoClosed` çağrılar sayılır, ancak süre metriklerine girmez ve ayrı “veri kalitesi” sayacında gösterilir.
- Oranlarda payda 0 ise sonuç `—` gösterilir, 0 değil.
- Görünürlük: personel kendi satırını, takım lideri ekibini, operasyon yöneticisi tümünü (toplulaştırılmış + kişi detayı) görür.
- **Hacim metrikleri kalite metrikleri olmadan gösterilmez.** Personel tablolarında “arama adedi” sütunu her zaman ulaşma oranı, ret oranı ve eksik kayıt oranıyla birlikte gelir. Tek metriğe göre sıralanmış “lider tablosu” yoktur.

## 2. Tanımlar

| Kısaltma | Tanım |
|---|---|
| `C` | Dönemde ilgili kapsamda başlatılan çağrılar (`Call`) |
| `C_ans` | `C` içinde `answeredAt IS NOT NULL` |
| `C_reach` | `C` içinde sonuç kodu kategorisi “Ulaşıldı” olan ve kod `WRONG_PERSON` olmayan |
| `C_unreach` | `C` içinde sonuç kategorisi “Ulaşılamadı” (`NO_ANSWER`, `BUSY`, `INVALID_NUMBER`) |
| `C_valid` | `C` içinde `autoClosed = false` |

## 3. Personel / ekip KPI’ları

| KPI | Formül |
|---|---|
| Atanan görev | Dönemde `assignedAt` olan görevler (temsilciye göre) |
| Aranan görev | En az bir `Call`’u olan farklı görev sayısı |
| Tamamlanan görev | Dönemde `DONE` durumuna geçen görevler |
| Toplam arama denemesi | `count(C)` |
| Tekil aranan numara | `count(distinct C.phoneId)` |
| Toplam konuşma süresi | `sum(C_valid.talkSec)` |
| Ortalama konuşma süresi | `sum(C_valid ∩ C_ans .talkSec) / count(C_valid ∩ C_ans)` (yalnız bağlanan çağrılar) |
| Ortalama çalma süresi | `avg(C_valid.ringSec)` |
| Ulaşılan çağrı oranı | `count(C_reach) / count(C)` |
| Ulaşılamayan çağrı oranı | `count(C_unreach) / count(C)` |
| Geri arama talebi | `count(C where disposition = CALLBACK_REQUESTED)` |
| Geri arama tamamlanma oranı | Planlanan zamanı dönemde olan geri aramalar içinde `DONE` olanlar / tümü (`CANCELLED` hariç) |
| Geri arama zamanında tamamlanma oranı | Aynı payda; pay: `DONE` ve ilk deneme planlanan ± 15 dk içinde |
| İletişim istememe kayıtları | `count(C where disposition = DO_NOT_CONTACT)` |
| Ret oranı | `İletişim istememe / count(C_reach)` |
| Yanlış kişi oranı | `count(C where disposition = WRONG_PERSON) / count(C_ans)` |
| Eksik sonuç kodu oranı | `count(çağrı kapandı ama sonuç kodu yok — yalnız otomatik kapatılanlar) / count(C)` |
| Eksik not oranı | Not zorunlu olan kodlarda notu boş/kısa olanlar / not zorunlu olan kodlu çağrılar |
| Mesai içi aktif süre | `AgentStatusLog` içinde `READY` + `ON_CALL` + `WRAP_UP` süreleri toplamı |
| Doluluk oranı | `(sum(talkSec) + sum(wrapSec)) / Mesai içi aktif süre` |

## 4. Kampanya KPI’ları

| KPI | Formül |
|---|---|
| Hedef misafir | Kampanyaya eklenmeye çalışılan misafirler |
| Uygun misafir | Uygunluk kontrolünden geçen misafirler |
| Hariç tutulan (nedene göre) | Uygunluk ret nedeni kırılımı |
| Erişim oranı | En az bir `C_reach` çağrısı olan misafir / uygun misafir |
| Dönüşüm (Aşama 1: manuel) | Kampanya süresince trip’e eklenen misafir / uygun misafir |
| Ret oranı | Kampanyada `DO_NOT_CONTACT` olan misafir / erişilen misafir |

## 5. Veri kaynağı KPI’ları

Kaynak = import batch veya kaynak tipi (casino X, web formu…).

| KPI | Formül |
|---|---|
| Hatalı satır oranı | Hata kodlu satır / toplam satır |
| Eşleşmeyen satır oranı | “Yeni” + “inceleme” sonucundaki satırlar / toplam (güncelleme amaçlı import’larda) |
| Mükerrer oranı | `E_DUP_IN_FILE` + DB ile mükerrer / toplam satır |
| Geçersiz telefon oranı | `formatStatus = INVALID` olan numara / toplam numara |
| İzin bilinmeyen oranı | Bu kaynaktan gelen ve `CALL` izni `UNKNOWN` misafir / kaynaktan gelen misafir |
| Erişilebilir numara oranı | Son 90 günde olumlu erişim kanıtı olan numara / aranan numara |

## 6. Ürün metrikleri (yönetici)

| Metrik | Formül | Hedef (taslak) |
|---|---|---|
| Hatalı/eşleşmemiş satır oranı | §5 toplam | < %5 |
| Mükerrer kayıt oranı | Açık “olası mükerrer” inceleme sayısı / aktif misafir | < %2 |
| İzin/ret durumu bilinmeyen kayıt sayısı | `CALL` izni `UNKNOWN` olan aktif misafir | Azalan trend |
| Geri arama zamanında tamamlanma | §3 | > %85 |
| Sonuç kaydı eksiksizliği | `1 − (Eksik sonuç kodu oranı + Eksik not oranı)` | > %98 |
| Kişi başı arama / konuşma / ulaşma | §3’ün personel ortalaması | Bilgi amaçlı |
| Yetkisiz erişim girişimi | Dönemde 403 dönen istek sayısı (kullanıcı bazında) | 0’a yakın |
| Yetkisiz export girişimi | 403 dönen export istekleri | 0 |
| Durdurma yansıma süresi | `recordedAt − requestedAt` medyanı ve 95. yüzdeliği | Medyan < 1 dk, P95 < 24 saat |

## 7. Operasyon paneli kartları

| Kart | Sorgu |
|---|---|
| Bugün bekleyen aramalar | `OPEN` görevler (son tarih ≤ bugün) + bugünkü `PENDING/DUE` geri aramalar |
| Geciken geri aramalar | `LATE` + `MISSED` |
| İzin durumu eksik | `CALL` izni `UNKNOWN` aktif misafir |
| Import hata kuyruğu | Son 30 günde hatalı satırı olan ve düzeltme yüklenmemiş batch’ler |
| Mükerrer inceleme kuyruğu | `ReviewItem` `OPEN` (tipe göre) |
| Ekip kapasitesi | Ekip başına: aktif temsilci, açık görev, temsilci başına açık görev, bugün aranan |
| Olağan dışı erişim | `AccessAlert` `OPEN` (önem derecesine göre) |
| Transkript sorunları | Son 30 gün: `Transcript` `FAILED` + `Recording` `FAILED` + `Transcript` `LOW_CONFIDENCE` (güven < 0,6) |
| İnsan incelemesi bekleyen | `CallAnalysis.reviewStatus = PENDING`; alt satır: bunlardan sonuç/özet uyuşmazlığı olanlar |

## 7b. Canlı kanal panosu ve kapasite planı (Aşama 2)

- **Canlı pano** (`/ops/live`, 10 sn yenileme, `report.product`): temsilci durum sayıları (son durum, bugün), açık çağrı, bugünkü deneme ve konuşma süresi, saatlik deneme grafiği, bekleyen görev, sonraki saatin geri aramaları, geciken geri aramalar, son 1 saatin santral olayları; SMS ve WhatsApp için bugünkü gönderim durumları, gelen mesaj ve ret sayıları, açık/okunmamış/atanmamış konuşma, pencere açık konuşma, ret şüphesi. Yalnız sayılar; misafir adı veya temsilci sıralaması yok.
- **Kapasite planı** (`/ops/capacity`): son *n* haftanın (vars. 4) aynı gün+saatteki ortalama çağrı denemesi × ortalama işlem süresi (çalma + konuşma + en fazla 10 dk çağrı sonrası) / hedef doluluk (vars. %80) → saatlik gereken temsilci. Yayınlanmış çizelgedeki çağrı merkezi vardiyalarıyla karşılaştırılır; fark negatifse eksik. Otomatik kapanan çağrılar hariç. Erlang-C kullanılmaz (dış arama ağırlıklı çalışmada gelen kuyruk varsayımı geçerli değil). Öneri niteliğindedir.

## 7a. Ses analizi raporları (tanımlar)

Uygulama durumu: operasyon panelindeki iki kart, `/calls` filtreleri ve **Raporlar → Ses analizi doğruluk paneli** (`/reports/speech`, `report.product` yetkisi) hazır; aşağıdaki tüm göstergeler bu ekranda tarih aralığıyla hesaplanır.

Genel panolarda yalnız **toplulaştırılmış** gösterilir; kişi bazlı içerik yalnız `/calls` yetkili inceleme ekranında. Hiçbiri personel sıralaması veya puanı için kullanılmaz.

| Gösterge | Formül | Zaman aralığı | Hariç tutulanlar | Kapsam |
|---|---|---|---|---|
| Transkript oranı | `Transcript DONE+LOW_CONFIDENCE` / `Recording STORED` | Seçilen dönem | Karar kapısı kapalıyken veya misafir istemediği için atılan kayıtlar (`DISCARDED`) | Rol kapsamı |
| Düşük güven oranı | `LOW_CONFIDENCE` / tamamlanan transkript | Seçilen dönem | `FAILED` | Rol kapsamı |
| Etiket düzeltme oranı | `AnalysisReview` `CORRECTED` / incelenen öneri | Seçilen dönem | Bekleyen öneriler | Rol kapsamı |
| Sonuç/özet uyuşmazlığı | `dispositionMismatch = true` / analiz | Seçilen dönem | — | Rol kapsamı |
| İnceleme kuyruğu yaşı | `now − CallAnalysis.createdAt` medyan ve P95 (`PENDING`) | Anlık | — | Rol kapsamı |
| Konu dağılımı | Onaylanan/düzeltilen önerilerde etiket sayıları | Seçilen dönem | Onaylanmamış öneriler | Toplulaştırılmış |
| Takip aksiyonu tamamlanma | Onaylanan aksiyonla oluşan geri aramalardan `DONE` olan / toplam | Seçilen dönem | İptal edilenler | Rol kapsamı |
| Kelime hata oranı (WER) | İnsan düzeltmesi yapılan bölütlerde düzenleme mesafesi / kelime sayısı | Aylık | Düzeltilmemiş bölütler | Yalnız yönetim |

Veri sözlüğü kuralı: raporda her göstergenin formülü, zaman aralığı, hariç tutulanlar ve erişim kapsamı ekranda görünür ve bu tabloyla birebir aynıdır.

## 8. Dışa aktarma

- CSV ve Excel. Dosya adı: `rapor-<tür>-<başlangıç>-<bitiş>-<kullanıcı>.xlsx`.
- Export, ekrandaki filtre ve kapsamla aynı veriyi üretir. Kapsam dışı satır gelmez.
- Her export: gerekçe, satır sayısı ve filtre bilgisiyle AccessLog’a yazılır.

## Açık sorular

1. “Dönüşüm” nasıl tanımlanmalı: trip’e katılım mı, casino ziyareti mi, belirli bir oyun hacmi mi?
2. ~~Mesai/vardiya tanımı var mı?~~ Personel ve Puantaj modülünde (Aşama 1B) vardiya çizelgesinden gelecek; doluluk oranı o zaman eklenir.
3. Hedef değerler (geri arama > %85 vb.) uygun mu?
4. Personel kendi ekip ortalamasını görmeli mi? (Taslak: evet, isimsiz ortalama olarak.)
