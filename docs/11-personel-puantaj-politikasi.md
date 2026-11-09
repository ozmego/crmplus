# 11 — Personel Verisi ve Puantaj Politikası (Aşama 1B)

Durum: **Taslak — İK ve hukuk teyidi bekliyor** · Sahibi: İK + hukuk · Modül: plan v4 “Personel ve Puantaj”

> Bu belge hukuki görüş değildir. `⚖️ HUKUK` işaretli parametreler (İş Kanunu md. 41, 63, 69 ve yıllık izin hak edişi) İK ve hukuk danışmanının yazılı teyidiyle kesinleşir ve sistemde **ayarlanabilir** kodlanır.

## 0. Uygulama durumu (8 Kasım 2026)

Uygulandı ve uçtan uca test edildi: personel kaydı ve CRM kullanıcısına bağlama, işten çıkışta CRM erişiminin kapanması · vardiya şablonları ve haftalık çizelge (kural uyarıları, saatlik kapsama, önceki haftayı kopyalama, gerekçeli yayın, sürüm) · mesai/mola/çıkış işaretleri (arama kuyruğu ve “Benim” ekranı) · otomatik puantaj (gece 06:30 ve istek üzerine), gerekçeli değiştirilemez düzeltme, aylık hazırla → onayla → kilitle, bordro Excel'i · izin talep/ön onay/son onay, yıllık izin bakiyesi, resmi tatiller (2026–2027) · saha rotası, lokasyonlar, “Bugünkü rotam” vardım/ayrıldım/yapılamadı, ziyaretin misafir zaman çizelgesine düşmesi, durdurma kaydı olan misafire durak eklenmemesi · operasyon panelinde plan / mesaide personel sayısı.

Henüz yok: fazla mesai denkleştirme dönemi (haftalık hesap yapılıyor) · görev atamada “vardiyada değil” uyarısı (görev atama ekranı henüz yok) · bordro sütun sırasının ekrandan ayarlanması · çalışan aydınlatma metninin onay akışı.

## 1. Kapsam

Tüm personel: çağrı merkezi, saha/host, ofis, finans ve yönetim. CRM kullanıcısı olmayan çalışanlar da kayıtlıdır. Personel verisi ayrı `hr` veritabanı şemasında tutulur; misafir (CRM) ve finans sorguları bu şemaya erişemez.

## 2. Çalışan aydınlatma metni (taslak)

> “Çalışma sürenizin hesaplanması (puantaj) için crmPlus’a giriş-çıkış saatleriniz, çağrı merkezi durumlarınız (hazır, görüşmede, mola, çevrimdışı) ve saha ziyaretlerinizdeki ‘vardım / ayrıldım’ işaretleriniz kullanılır. Bu bilgiler yalnız çalışma süresi, fazla mesai ve izin takibi için işlenir; performans puanlaması veya görüşme içeriği analiziyle birleştirilmez. Konum (GPS) bilgisi toplanmaz. Puantajınızı ‘Puantajım’ ekranından görebilir, hatalı gördüğünüz günler için düzeltme talep edebilirsiniz.” ⚖️ HUKUK

## 3. Puantajın kaynakları ve sınırları

| Kaynak | Kimler için | Ne sayılır |
|---|---|---|
| Oturum ve çağrı merkezi durumları | CRM kullanıcıları | İlk giriş / ilk “hazır”, son etkinlik, mola süreleri |
| Saha rotası “Vardım / Ayrıldım” | Saha personeli | Durak giriş-çıkışları |
| Yönetici girişi (MANUAL) | CRM kullanıcısı olmayanlar | Giriş-çıkış saatleri |

Sınırlar:
- Puantaj **yalnız çalışma süresi** içindir. Çağrı adedi, konuşma süresi, ses analizi veya kalite incelemesiyle birleştirilmez ve bunlara göre düzeltilmez.
- Planlanan vardiyanın ±2 saat dışındaki tekil etkinlikler (ör. gece 5 dakikalık giriş) puantaja sayılmaz, “plan dışı etkinlik” olarak işaretlenir.
- “Devamsız” (D) gün kodu sistem tarafından yalnız önerilir; yönetici onayı olmadan kesinleşmez.
- Onaylı izin ve resmi tatil sistem etkinliğinden önceliklidir; çelişki (izinliyken giriş) inceleme olarak işaretlenir.
- Konum toplanmaz. İleride istenirse ayrı açık rıza ve hukuk incelemesi gerekir.

## 4. Sağlık verisi

Sağlık ve teşhis bilgisi **tutulmaz**. Raporlu izinde yalnız tarih aralığı ve belge referansı (ör. e-Rapor numarası) saklanır; belge görüntüsü sisteme yüklenmez.

## 5. Kimlik ve iletişim verisi

- İletişim bilgileri şifreli saklanır.
- TC kimlik no yalnız bordro aktarımı gerektiriyorsa, şifreli ve ayrı `hr.identity` izniyle tutulur. ⚖️ Karar: bordro sağlayıcısı sicil no ile eşleşebiliyorsa TC kimlik no tutulmaz.

## 6. Parametreler (ilk değerler, ayarlanabilir) ⚖️

| Parametre | İlk değer | Dayanak |
|---|---|---|
| Haftalık sözleşme saati | 45 saat (yarı zamanlıda sözleşmedeki) | İş Kanunu md. 63 |
| Fazla mesai | Haftalık sözleşme saatini aşan kısım | md. 41 |
| Günlük çalışma uyarısı | 11 saat üstü | md. 63 |
| Günlük dinlenme uyarısı | Vardiyalar arası < 11 saat | Yönetmelik |
| Haftalık tatil uyarısı | 24 saat kesintisiz tatil yoksa | md. 46 |
| Geç kalma / erken çıkış toleransı | 10 dakika | Şirket kuralı |
| Yıllık izin hak edişi | Kıdeme göre (1–5 yıl 14 gün, 5–15 yıl 20 gün, 15+ yıl 26 gün) | md. 53 |
| Resmi tatil ve arife yarım günleri | Yıllık liste, yönetimden düzenlenebilir | 2429 sayılı Kanun |

Kurallar uyarı verir; ihlal gerekçesiyle yayınlanabilir ve AuditLog’a yazılır.

## 7. Düzeltme ve onay

- Her puantaj düzeltmesi alan, eski değer, yeni değer, gerekçe ve düzeltenle `AttendanceAdjustment`’a yazılır; değiştirilemez.
- Dönem akışı: Takım lideri hazırlar → İK onaylar → kilit. Hazırlayan onaylayamaz. Kilit sonrası düzeltme reddedilir; gerekirse sonraki dönemde düzeltme kaydı açılır.
- İzin: personel talep eder → takım lideri ön onay → İK son onay.

## 8. Saklama ⚖️

| Veri | Süre (taslak) |
|---|---|
| Puantaj, izin ve düzeltme kayıtları | İş ilişkisi + 10 yıl |
| Vardiya çizelgeleri ve saha rotaları | 2 yıl |
| Ham oturum/durum olayları | 1 yıl (puantaj kilitlendikten sonra özetler yeterli) |

## 9. Bordro dışa aktarım sütun şablonu (Excel)

Sicil no · Ad · Soyad · Departman · Dönem (YYYY-AA) · 1…31 gün kodları · Çalışılan gün · Çalışılan saat · Fazla mesai saati · Resmi tatilde çalışma saati · Yıllık izin günü · Raporlu gün · Ücretsiz izin günü · Mazeret izni günü · Devamsızlık günü · Hafta tatili günü

Gün kodları: Ç çalıştı · Y yarım gün · İ yıllık izin · R raporlu · Ü ücretsiz izin · M mazeret · HT hafta tatili · RT resmi tatil · RTÇ resmi tatilde çalıştı · D devamsız · E eğitim · S saha.

Sütun sırası bordro sağlayıcısına göre ayarlanabilir şablonla değiştirilebilir.

## 10. Erişim

| Rol | Erişim |
|---|---|
| İK | Personel kayıtları, izin son onayı, puantaj onayı/kilidi/dışa aktarımı; misafir ve finans verisi yok |
| Takım lideri | Ekibinin çizelgesi, rotası, puantaj düzeltmesi (gerekçeli), izin ön onayı, dönem hazırlama |
| Operasyon yöneticisi | Tüm çizelgeler ve rotalar, toplulaştırılmış puantaj |
| Saha personeli | Kendi rotası ve check-in, kendi çizelgesi/puantajı; rotadaki misafirin yalnız adı ve randevu bilgisi |
| Çağrı personeli | Kendi çizelgesi, puantajı, izin talebi |

## Açık sorular

1. Bordro sağlayıcısı hangisi, hangi sütun düzenini bekliyor? TC kimlik no gerekli mi?
2. Fazla mesai haftalık mı, denkleştirme dönemiyle mi hesaplanacak? ⚖️
3. Saha personeli için yol süresi çalışma süresine dahil mi? ⚖️
4. Yarı zamanlı çalışanların sözleşme saatleri kişi bazında mı girilecek?
5. Arife yarım günlerinde çalışma nasıl ücretlendirilecek? ⚖️
