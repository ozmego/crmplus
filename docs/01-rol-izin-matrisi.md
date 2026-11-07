# 01 — Rol ve İzin Matrisi

Durum: **Taslak** · Sahibi: Operasyon müdürü + BT

## 1. İlkeler

1. **Rol = izin paketi.** Sistem rol adına bakmaz, izin anahtarına bakar. Kodda `requirePermission("guest.view")` vardır, `if (role === "Admin")` yoktur.
2. **Birden çok rol birleşir, kapsam birleşmez.** Bir kullanıcı hem Takım lideri hem Veri yükleyici olabilir. Liderlik izinleri yalnız kendi ekibinde geçerlidir, yükleyici izinleri yalnız import ekranlarında geçerlidir. Bir rolün kapsamı (`team`) diğer rolün iznine (`import.create`) taşınmaz.
3. **Üç ayrı eksen** her istekte sunucuda kontrol edilir:
   - **İşlem**: ne yapılabilir (görüntüle, düzenle, sil, dışa aktar, rol ver)
   - **Kayıt kapsamı**: hangi kayıtlar (`own` atanmış, `team` ekibin, `all` tümü)
   - **Alan grubu**: kaydın hangi alanları (aşağıda §3)
4. **Varsayılan ret.** Açıkça verilmemiş izin yoktur.
5. **Arayüzde gizleme güvenlik değildir.** Yetkisiz alanlar sunucuda yanıttan çıkarılır, sorguda hiç seçilmez.

## 2. Kayıt kapsamı

| Kapsam | Anlamı |
|---|---|
| `own` | Kullanıcıya atanmış misafir/görev/geri arama/mesaj konuşması |
| `team` | Kullanıcının **lideri olduğu** ekibin üyelerine atanmış kayıtlar + ekibin ortak kuyruğu |
| `all` | Tüm kayıtlar |

Atanmamış misafirler yalnız `all` kapsamında görünür.

## 3. Alan grupları

| Grup | Alanlar (örnek) |
|---|---|
| `general` | CRM ID, ad, soyad, dil, ülke, VIP seviyesi, etiketler, sahip temsilci, ekip |
| `contact` | Maskeli telefon (`+90 532 *** ** 12`), maskeli e-posta, izin durumu, telefon durumu |
| `contact.full` | Maskesiz telefon ve e-posta (görüntüleme gerekçeli ve kayıtlı) |
| `notes` | Çağrı notları, misafir notları |
| `identity` | Doğum yılı/tarihi, pasaport/kimlik no, adres |
| `financial` | Trip harcamaları, oyun sonuçları (buy-in, cash-out, rolling, net), komisyon, limitler |
| `sensitive.rg` | Sorumlu oyun bayrakları ve inceleme notları |

Çağrı personeli arama yaparken maskesiz numarayı görmez. Arama sunucu tarafında numara çözülerek başlatılır (Aşama 1: `tel:` bağlantısı tek kullanımlık, kısa ömürlü bir sunucu yönlendirmesiyle üretilir ve görüntülenmez; Aşama 2: santral API).

> Not: Aşama 1’de manuel aramada `tel:` bağlantısı telefonu tarayıcı/softphone’a iletir; teknik olarak numara cihazda görünebilir. Tam gizlilik Aşama 2’deki santral entegrasyonuyla sağlanır. Bu sınırlama bilinçli kabul edilmiş bir risktir (Açık soru 3).

## 4. İzin anahtarları

### Misafir ve iletişim
| Anahtar | Açıklama |
|---|---|
| `guest.view` | Misafir listesi ve kartı (kapsama göre) |
| `guest.create` / `guest.edit` / `guest.delete` | Oluşturma / düzenleme / silme (silme = anonimleştirme talebi) |
| `guest.assign` | Misafiri temsilciye/ekibe atama |
| `field.contact.full` | Maskesiz iletişim bilgisi görme (gerekçe zorunlu) |
| `field.notes` | Notları görme ve yazma |
| `field.identity` | Kimlik alanları |
| `field.financial` | Finansal alanlar |
| `field.sensitive.rg` | Sorumlu oyun bayrakları |
| `consent.view` / `consent.edit` | İzin kayıtları |
| `consent.exception.request` / `consent.exception.approve` | İzin istisnası talebi / onayı |
| `block.create` | İletişim durdurma kaydı açma (herkese açık olmalı: misafir talebini kim alırsa işler) |
| `block.remove` | Durdurma kaydını kaldırma (gerekçe + ikinci onay) |

### Import, karşılaştırma, inceleme
| Anahtar | Açıklama |
|---|---|
| `import.create` | Dosya yükleme ve sihirbazı çalıştırma |
| `import.apply` | Önizlemeyi onaylayıp uygulama |
| `import.rollback` | Import geri alma |
| `import.view` | Import geçmişi ve sonuç raporları |
| `compare.run` | Karşılaştırma çalıştırma |
| `review.view` / `review.resolve` | İnceleme kuyruğu |
| `mapping.template.manage` | Sütun eşleme şablonları |

### Çağrı merkezi
| Anahtar | Açıklama |
|---|---|
| `queue.view` | Arama kuyruğu (kapsama göre) |
| `call.make` | Arama başlatma ve sonuç girme |
| `call.view` | Çağrı geçmişi (kapsama göre) |
| `callback.manage` | Geri arama planlama/yeniden atama |
| `task.view` / `task.create` / `task.assign` | Görevler |
| `campaign.view` / `campaign.manage` | Arama kampanyaları |
| `segment.manage` | Segment oluşturma |

### Raporlar ve dışa aktarma
| Anahtar | Açıklama |
|---|---|
| `report.view` | Raporlar (kapsama göre: personel kendi, lider ekip, yönetici tümü) |
| `report.product` | Ürün metrikleri ve veri kalitesi raporları |
| `export.basic` | Kendi kapsamında, ≤ 1.000 satır export (gerekçe zorunlu) |
| `export.bulk` | Sınırsız export (gerekçe zorunlu, yönetici bildirimi) |

### Yönetim ve denetim
| Anahtar | Açıklama |
|---|---|
| `user.view` / `user.manage` | Kullanıcı yönetimi, pasifleştirme |
| `role.manage` | Rol tanımlama ve izin düzenleme |
| `role.assign` | Kullanıcıya rol verme (gerekçe zorunlu; kendine rol veremez) |
| `team.manage` | Ekip yönetimi |
| `settings.manage` | Sistem ayarları |
| `integration.manage` | Santral, SMS, WhatsApp, HLR anahtarları |
| `audit.view` | Denetim ve erişim kayıtları |
| `alert.view` / `alert.resolve` | Olağan dışı erişim uyarıları |
| `emergency.access` | Acil erişim (break-glass): sınırlı süre, gerekçe, yönetici bildirimi |
| `retention.manage` | Saklama süreleri ve anonimleştirme işleri |

### Finans
| Anahtar | Açıklama |
|---|---|
| `finance.view` | Finans modülüne giriş |
| `finance.contract.manage` | Sözleşme ve kural girişi |
| `finance.result.edit` | Oyun sonucu girişi/importu |
| `finance.calc.prepare` | Hesaplama hazırlama |
| `finance.calc.approve` | Hesaplama onayı (hazırlayan onaylayamaz) |
| `finance.period.lock` | Dönem kapatma |
| `finance.adjust` | Düzeltme/iptal kaydı |
| `finance.export` | Finans dışa aktarımı |

### Aşama 2 — Konuşma kaydı ve mesajlaşma
| Anahtar | Açıklama |
|---|---|
| `recording.listen` | Kayıt dinleme (gerekçe zorunlu) |
| `recording.download` | Ses indirme (varsayılan kimsede yok) |
| `transcript.view.redacted` / `transcript.view.raw` | Maskelenmiş / ham transkript |
| `qa.review` / `qa.calibrate` | QA puanlama / kalibrasyon |
| `message.send.single` | Tekil şablon mesaj (atanmış misafire) |
| `message.reply` | WhatsApp 24 saat penceresinde serbest yanıt |
| `message.campaign.prepare` / `message.campaign.approve` | Toplu mesaj kampanyası hazırlama / onay |
| `message.template.manage` | Mesaj şablonları |
| `inbox.view` | Gelen kutusu (kapsama göre) |

## 5. Varsayılan roller

İşaretler: ✅ izinli · 🔸 kısıtlı (açıklamaya bakın) · — yok

| İzin | Sistem yön. | Operasyon yön. | Takım lideri | Çağrı personeli | Veri yükleyici | Finans | Denetçi | Kalite analisti* |
|---|---|---|---|---|---|---|---|---|
| Kayıt kapsamı | all | all | team | own | all¹ | all² | all³ | team/all |
| `guest.view` | 🔸⁴ | ✅ | ✅ | ✅ | 🔸¹ | 🔸² | 🔸³ | ✅ |
| `guest.edit` | — | ✅ | ✅ | 🔸⁵ | 🔸¹ | — | — | — |
| `guest.assign` | — | ✅ | ✅ | — | — | — | — | — |
| `field.contact.full` | — | 🔸⁶ | 🔸⁶ | — | — | — | — | — |
| `field.notes` | — | ✅ | ✅ | ✅ | — | — | — | ✅ |
| `field.identity` | — | ✅ | — | — | 🔸⁷ | ✅ | — | — |
| `field.financial` | — | — | — | — | — | ✅ | — | — |
| `field.sensitive.rg` | — | ✅ | 🔸⁸ | — | — | — | — | ✅ |
| `consent.edit` | — | ✅ | ✅ | 🔸⁹ | ✅ | — | — | — |
| `block.create` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ |
| `block.remove` | — | 🔸¹⁰ | — | — | — | — | — | — |
| `import.*` | — | ✅ | — | — | ✅ | 🔸¹¹ | — | — |
| `review.resolve` | — | ✅ | — | — | ✅ | — | — | — |
| `queue.view` / `call.make` | — | — | ✅ | ✅ | — | — | — | — |
| `call.view` | — | ✅ | ✅ | ✅ | — | — | ✅³ | ✅ |
| `task.assign` / `campaign.manage` | — | ✅ | 🔸¹² | — | — | — | — | — |
| `report.view` | — | ✅ | ✅ | ✅ | 🔸¹³ | 🔸¹⁴ | ✅ | ✅ |
| `export.basic` | — | ✅ | ✅ | — | ✅ | — | — | — |
| `export.bulk` | — | ✅ | — | — | — | — | — | — |
| `user.manage` / `team.manage` | ✅ | 🔸¹⁵ | — | — | — | — | — | — |
| `role.manage` / `role.assign` | ✅ | — | — | — | — | — | — | — |
| `settings.manage` / `integration.manage` | ✅ | — | — | — | — | — | — | — |
| `audit.view` | ✅ | — | — | — | — | — | ✅ | — |
| `alert.view` | ✅ | ✅ | — | — | — | — | ✅ | — |
| `emergency.access` | 🔸¹⁶ | — | — | — | — | — | — | — |
| `finance.*` | — | — | — | — | — | ✅¹⁷ | 🔸³ | — |

\* Kalite analisti Aşama 2’de etkinleşir.

### Dipnotlar
1. Veri yükleyici: misafirleri yalnız import, karşılaştırma ve inceleme ekranlarında görür. Notlar ve finansal sütunlar dosyada olsa bile maskelidir.
2. Finans: misafirleri yalnız finans modülünde ad + CRM ID + finansal alanlarla görür; çağrı notları ve çağrı detayları yoktur.
3. Denetçi: salt okunur. İşlem kayıtları, onay geçmişi ve çağrı **meta verisi** (kim, ne zaman, süre, sonuç kodu) görünür; not içerikleri ve finansal tutarlar görünmez. Finansta onay geçmişi ve durum değişiklikleri görünür, tutarlar `finance.view` olmadan görünmez. Hiçbir düzenleme ve export yapamaz.
4. Sistem yöneticisi: misafir verisine rutin erişimi yoktur. Destek gerektiğinde `emergency.access` kullanılır.
5. Çağrı personeli: yalnız atanmış misafirde dil ve iletişim tercihi gibi sınırlı alanları düzenleyebilir.
6. Maskesiz iletişim: gerekçe zorunlu, her görüntüleme AccessLog’a yazılır, günlük eşik aşılırsa uyarı oluşur.
7. Veri yükleyici: kimlik alanlarını yalnız eşleştirme önizlemesinde, maskeli biçimde görür (ör. doğum yılı görünür, pasaport no son 3 hane).
8. Takım lideri: kendi ekibindeki misafirlerin yalnız “sorumlu oyun incelemesi açık” durumunu görür, ayrıntıyı görmez.
9. Çağrı personeli: izin durumunu yalnız ret yönünde değiştirebilir (misafir “aramayın” dedi). İzin vermek kanıt gerektirir ve lider/operasyon tarafından girilir.
10. Durdurma kaldırma: Operasyon yöneticisi talep eder, ikinci bir yetkili onaylar, misafirin yeni izninin kanıtı zorunludur.
11. Finans: yalnız casino ekstresi/oyun sonucu importu (finans modülü içinde).
12. Takım lideri: kendi ekibine görev atar; kampanya oluşturamaz.
13. Veri yükleyici: yalnız import kalitesi raporları.
14. Finans: yalnız finans raporları.
15. Operasyon yöneticisi: ekip oluşturur ve üye atar; kullanıcı açamaz, rol veremez.
16. Acil erişim: en fazla 60 dakika, gerekçe zorunlu, açıldığı anda Operasyon yöneticisi ve Denetçiye bildirim gider.
17. Finans içinde hazırlayan ve onaylayan farklı kişiler olmalıdır (aynı kişi aynı kaydı hem hazırlayıp hem onaylayamaz).

## 6. Hassas işlemler — gerekçe ve ek kontroller

| İşlem | Gerekçe | Ek kontrol |
|---|---|---|
| Rol verme/alma | Zorunlu | Kendine rol veremez; yönetici rollerinde ikinci onay |
| Maskesiz numara/e-posta görme | Zorunlu | AccessLog, günlük eşik |
| Export | Zorunlu | Satır limiti, AccessLog, toplu export’ta yönetici bildirimi |
| Acil erişim | Zorunlu | Süre sınırı, anlık bildirim |
| Durdurma kaldırma | Zorunlu | İkinci onay + yeni izin kanıtı |
| İzin istisnası | Zorunlu | Onaylayan ≠ talep eden, süre sınırı |
| Finans düzeltme | Zorunlu | Yeni düzeltme kaydı, orijinal değişmez |
| Kayıt dinleme (Aşama 2) | Zorunlu | AccessLog, hacim eşiği |

## 7. Hesap yaşam döngüsü

- **Açılış**: Sistem yöneticisi kullanıcı açar, rolü yöneticinin onayıyla verir. İlk girişte şifre değişimi ve MFA kurulumu zorunludur.
- **MFA**: Tüm kullanıcılar için zorunlu (TOTP). Kurtarma kodları tek kullanımlıktır.
- **Kilitleme**: 5 başarısız denemede 15 dk kilit. 10 denemede hesap yönetici açana kadar kilitli kalır.
- **Oturum**: 30 dk hareketsizlikte, en fazla 12 saatte sonlanır. Kullanıcı aktif oturumlarını görüp kapatabilir.
- **Pasifleştirme (işten ayrılma)**: tek işlemle tüm oturumlar anında silinir, açık görevler ve geri aramalar ekip liderine düşer, entegrasyon anahtarları (varsa) iptal edilir, işlem AuditLog’a yazılır. Kullanıcı silinmez, geçmiş kayıtlarla bağı korunur.
- **Periyodik gözden geçirme**: her çeyrekte rol atamaları raporu Operasyon yöneticisine gönderilir (Aşama 2).

## 8. Kayıt tutma

- `AuditLog`: tüm yazma işlemleri, rol değişiklikleri, silmeler, onaylar. Değiştirilemez (DB tetikleyicisi UPDATE/DELETE’i engeller).
- `AccessLog`: misafir kartı görüntüleme, maskesiz alan açma, export, rapor görüntüleme, kayıt dinleme.
- Yetkisiz deneme (HTTP 403) da AccessLog’a yazılır ve anomali kurallarına girdi olur.

## Açık sorular

1. Kalite analisti ve Uyum sorumlusu ayrı kişiler mi, yoksa Operasyon yöneticisi mi üstlenecek?
2. Takım liderleri birden fazla ekibe liderlik edebilir mi?
3. Aşama 1’de manuel aramada numaranın temsilcinin cihazında görünmesi kabul edilebilir mi, yoksa Aşama 1’de de bulut santral şart mı?
4. Sistem yöneticisi rolünü dış BT firması mı üstlenecek? (Acil erişim politikası buna göre sıkılaştırılabilir.)
5. Export satır limiti (1.000) ve maskesiz görüntüleme günlük eşiği (20) uygun mu?
