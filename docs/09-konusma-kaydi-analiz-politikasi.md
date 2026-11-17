# 09 — Ses Kaydı ve Türkçe Analiz Politikası (Aşama 1, karar kapısına bağlı)

Durum: **Taslak — hukuk teyidi bekliyor** · Sahibi: Uyum + çağrı merkezi müdürü · Plan v4 §4 ile hizalı

## 1. Amaç ve sınırlar

Kayıt ve analiz şu amaçlarla yapılır: hizmet kalitesi, iç kurallara uyum, misafir taleplerinin (özellikle iletişim durdurma) doğru işlendiğinin ispatı, temsilci koçluğu, geri arama/aktarma takibinin unutulmaması.

Sistem şunları **üretmez ve saklamaz**: duygu, kişilik, ikna edilebilirlik, kumar davranışı, kayıp temelli risk/değer skoru, otomatik kalite puanı. Analiz çıktısının şemasında bu alanlar yoktur (şema testi: `tests/unit/speech-analysis.test.ts`).

Otomatik analiz yalnız **öneri** üretir. Çalışan ya da misafir aleyhine tek başına karar, puan, yaptırım veya sıralama üretmez; her öneri bir insan tarafından onaylanır, düzeltilir veya itiraz edilir.

## 2. Karar kapısı

Aşağıdaki altı koşulun her biri **Ayarlar → Ses karar kapısı** ekranında ayrı ayrı onaylanmadan santralden gelen kayıtlar saklanmaz (`DISCARDED / GATE_CLOSED`) ve analiz çalışmaz:

1. Hukuki dayanak belirlendi (açık rıza / aydınlatma + meşru menfaat) ⚖️
2. Misafir bilgilendirme metni (anons) onaylandı
3. Ses, transkript, analiz ve dosya saklama süreleri onaylandı
4. Ses/ASR tedarikçisinin veri kullanımı değerlendirildi (bkz. §8)
5. Erişim matrisi onaylandı (bkz. §5)
6. Misafirin kayıt istememe akışı onaylandı

Kapı onayı gerekçe ister ve AuditLog'a yazılır. Kapı kapatılırsa yeni kayıtlar yine atılır; mevcut kayıtlar saklama süresine göre silinir.

## 3. Bilgilendirme ve tercih

- Her çağrının başında anons (santral) veya temsilci bildirimi:
  > TR: “Hizmet kalitesi için bu görüşme kayıt altına alınmaktadır. Kayıt istemiyorsanız lütfen temsilcimize iletiniz.”
  > EN: “This call is recorded for quality purposes. If you do not wish to be recorded, please tell our representative.”
- Çağrı ekranında temsilci “Kayıt bildirimi yapıldı” ve gerekirse “Misafir kayıt istemiyor” işaretler (`Call.recordingNotice`, `Call.recordingPreference`).
- Misafir istemezse: o çağrının kaydı saklanmaz (`DISCARDED / GUEST_DECLINED`), tercih `ConsentRecord(channel = RECORDING, status = DENIED)` olarak zaman damgasıyla saklanır; sonraki çağrılarda kuyruk ve çağrı ekranı “kayıtsız” gösterir.
- ⚖️ HUKUK: itiraz anından önceki kısım da silinir mi? Uygulama: itiraz eden çağrının kaydı **tamamen** atılır, yalnız meta veri kalır.

## 4. Akış (uygulanan)

1. **Santral webhook'u** (imzalı, ±5 dk) kayıt hazır olayını bildirir → kayıt kuyruğa alınır.
2. **İndirme** (`recordings` kuyruğu): ses şifreli (AES-256-GCM) depoya yazılır, SHA-256 ve süre saklanır; santral indirme adresi şifreli tutulur ve indirmeden sonra silinir.
3. **Transkript** (`speech` kuyruğu, şirket içi `speech/` servisi, faster-whisper `large-v3-turbo`, `language = tr`): stereo kayıtta kanal 0 = temsilci, kanal 1 = misafir. Kurum sözlüğü (casino, otel, kişi adları) ilk istem olarak verilir.
4. **Maskeleme**: telefon, IBAN, kart, TC kimlik no, e-posta → `[TELEFON]`, `[IBAN]`, `[KART]`, `[TCKN]`, `[EPOSTA]`. Ham metin şifreli ve kısa süreli saklanır, hiçbir ekranda gösterilmez.
5. **Öneri** (kural sürümü `RULES_VERSION`, isteğe bağlı yerel LLM özeti — Ollama): kısa özet, sabit listeden konu etiketleri, geri arama/aktarma aksiyonu (tarih-saat çıkarımı), süreç uyarıları (kayıt bildirimi, kendini tanıtma, iletişim durdurma talebi ↔ sonuç kodu tutarlılığı).
6. **İnsan incelemesi**: onay (aksiyon önerisi onaylanınca geri arama/görev oluşur), düzeltme, itiraz. Transkript bölütü düzeltmesi eski/yeni metinle `TranscriptEdit`'e yazılır.

Düşük güvenli (< 0,6) transkriptler ve sonuç/özet uyuşmazlıkları inceleme kuyruğuna düşer; operasyon panelinde toplulaştırılmış sayı olarak görünür.

## 5. Erişim

| Rol | Ses dinleme | Maskelenmiş transkript | Öneri inceleme |
|---|---|---|---|
| Takım lideri | Ekibi; gerekçe + 24 saatlik süreli izin | Ekibi | Ekibi |
| Çağrı personeli | — | Kendi çağrıları | Kendi çağrıları |
| Operasyon yöneticisi | — | Tümü | Tümü (düzeltme yok) |
| Sistem yöneticisi | — | — | — (karar kapısı ve saklama ayarı) |
| Finans, Veri yükleyici, Denetçi | — | — | — |

- Ses indirme (`recording.download`) varsayılan rollerde **kimsede yoktur**; hukuki talepte geçici ve iki onayla verilir.
- Her dinleme AccessLog'a yazılır; olağan dışı dinleme hacmi erişim uyarısı üretir (docs/08).
- Kişi bazlı görüşme içeriği yalnız yetkili inceleme ekranında (`/calls`) görünür; genel panolar toplulaştırılmıştır.

## 6. Saklama (varsayılan; Ayarlar'dan değiştirilebilir, ⚖️ HUKUK teyidi)

| Veri | Süre | Not |
|---|---|---|
| Ses | 90 gün | Şikâyet/uyum incelemesi açıksa kapanana kadar (en fazla 1 yıl) |
| Ham transkript (şifreli) | 30 gün | Hiçbir ekranda gösterilmez |
| Maskelenmiş transkript | 1 yıl | |
| Analiz önerisi ve inceleme kararı | 1 yıl | Model/kural sürümü ve güvenle birlikte |
| Santraldeki kopya | Şirket deposuna alındıktan sonra silinir (sağlayıcı izin veriyorsa) | |

Saklama temizliği her gece 03:15 (Europe/Istanbul) çalışır. Aşama 1'de otomatik silinenler: ses ve ham transkript. Maskelenmiş transkript ve analiz önerisinin 1 yıl sonunda silinmesi Aşama 2'de otomatikleşecek; o zamana kadar `retention.execute` yetkisiyle elle yürütülür.

## 6a. Kalite örneklemesi (Aşama 2 — uygulandı)

- **Örneklem:** her Pazartesi 07:00'de geçen hafta için, temsilci başına 3 görüşme (en az 30 sn). En fazla 2'si analizin önerdiği aday (sonuç/özet uyuşmazlığı, süreç uyarısı, düşük güven), kalanı rastgele. Seçim tekrarlanabilir (hafta + temsilci tohumlu) ve denetim kaydına yazılır. Lider ayrıca elle görüşme ekleyebilir.
- **İnceleme:** takım lideri sürümlü ortak kriter setiyle her kriteri “karşılandı / karşılanmadı / uygulanmaz” olarak işaretler; “karşılanmadı” için açıklama zorunludur. Koçluk notu zorunludur. **Toplam puan hesaplanmaz ve gösterilmez.**
- **Personel hakkı:** personel yalnız incelenmiş örneklemini görür; “okudum” der veya gerekçeyle itiraz eder. İtiraz lider tarafından gerekçeli yanıtla kapatılır.
- **Sınırlar:** örneklem sonuçları puantajla, personel sıralamasıyla veya yaptırımla birleştirilmez; raporlarda yalnız durum sayıları toplulaştırılmış görünür.
- **Kurum sözlüğü:** etkin terimler (en fazla 200) transkript motoruna ilk istem olarak verilir. Altı veya daha fazla rakam içeren terim (telefon, kimlik, kart) reddedilir.

## 7. Doğruluk ölçümü

- İnsan düzeltmelerinden kelime hata oranı (WER) ve etiket düzeltme oranı **Raporlar → Ses analizi doğruluk paneli** ekranında seçilen dönem için hesaplanır (docs/05 §7a). WER yalnız düzeltilen bölütlerden hesaplanır; düzeltilmemiş bölütler doğru varsayılmaz.
- Canlıya almadan önce 30–50 rol yapma kaydından oluşan Türkçe test setiyle WER ölçülür; PII maskeleme sızıntısı = 0 olmalıdır.

## 8. Ses sağlayıcısı değerlendirme ölçütleri

Bulut santral ve olası bulut ASR için: Türkçe tanıma başarısı · sesin işlendiği ve saklandığı ülke · alt işleyenler · silme güvencesi · modelin eğitiminde kullanım · erişim kayıtları · kesinti davranışı. **Varsayılan: ASR şirket içinde**, ses şirket dışına çıkmaz.

## Açık sorular

1. Bulut santral seçildi mi? Stereo kayıt ve TR/AB barındırma destekliyor mu?
2. Kayıt hukuki dayanağı ve çalışan aydınlatma metni ⚖️
3. Saklama süreleri uygun mu? ⚖️
4. Analiz sunucusu (GPU, 24 GB VRAM) ne zaman temin edilebilir? Yoksa CPU profilinde yalnız örneklem çağrılar transkript edilir.
