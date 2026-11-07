# 08 — Güvenlik Olay Müdahale Prosedürü

Durum: **Taslak** · Sahibi: BT güvenlik

## 1. Olay türleri ve önem derecesi

| Derece | Örnekler | İlk müdahale hedefi |
|---|---|---|
| **P1 Kritik** | Veri sızıntısı şüphesi, yetkisiz toplu export, sunucuya yetkisiz erişim, fidye yazılımı | 15 dk |
| **P2 Yüksek** | Hesap ele geçirme şüphesi, olağan dışı toplu kayıt görüntüleme, acil erişimin gerekçesiz kullanımı | 1 saat |
| **P3 Orta** | Tekrarlayan yetkisiz erişim (403) girişimi, başarısız giriş patlaması, yeni ülke/IP’den giriş | 1 iş günü |
| **P4 Düşük** | Tekil şüpheli davranış, yanlış yapılandırma | 1 hafta |

## 2. Sistemin ürettiği uyarılar (`AccessAlert`)

| Kural (varsayılan eşik, ayarlanabilir) | Derece |
|---|---|
| 10 dk içinde > 100 farklı misafir kartı açma | P2 |
| Günlük maskesiz görüntüleme > 20 | P3 |
| Export > 5.000 satır veya günde > 3 export | P2 |
| Yetkisiz export girişimi (403) | P2 |
| 1 saatte > 10 adet 403 | P3 |
| 15 dk içinde > 10 başarısız giriş (tek hesap veya tek IP) | P3 |
| Mesai dışı (22:00–07:00) giriş — yönetici rolleri | P3 |
| Yeni cihaz + yeni IP aynı anda | P4 |
| Acil erişim kullanımı | P2 (her zaman inceleme) |
| Pasifleştirilmiş hesapla giriş denemesi | P2 |
| (Aşama 2) Günlük kayıt dinleme > 30 | P3 |
| (Aşama 2) Onaysız toplu mesaj denemesi | P2 |

P1/P2 uyarıları anında Sistem yöneticisi, Operasyon yöneticisi ve Denetçiye e-posta ile bildirilir.

## 3. Müdahale adımları

1. **Tespit ve kayıt**: uyarı veya bildirim → olay kaydı açılır (zaman, kaynak, ilk gözlem).
2. **Sınırlama**:
   - Şüpheli hesap: tek tıkla **askıya al** (oturumlar silinir, giriş engellenir).
   - Toplu sızıntı şüphesi: export özelliği sistem genelinde kapatılır (ayar: `exports.enabled = false`).
   - Sunucu ihlali: ağ erişimi kesilir, sistem yalnız okuma moduna alınır.
3. **Delil toplama**: AuditLog, AccessLog, sunucu ve Caddy logları dışa alınır, SHA-256 ile mühürlenir. Loglar değiştirilemez olduğu için ek kopya alınmadan sistem değiştirilmez.
4. **Analiz**: hangi veri, kaç kişi, hangi zaman aralığı, hangi hesap.
5. **Bildirim**: ⚖️ HUKUK — KVKK’ya ve ilgili kişilere bildirim gerekip gerekmediği değerlendirilir. Kurul kararına göre veri ihlali, öğrenildiği andan itibaren **en kısa sürede ve en geç 72 saat** içinde Kurul’a bildirilmelidir; ilgili kişilere bildirim makul en kısa sürede yapılır. Bildirim sorumlusu: (Açık soru 1).
6. **Düzeltme**: şifre/anahtar rotasyonu (veritabanı, şifreleme anahtarı, entegrasyon anahtarları), açığın kapatılması.
7. **Geri dönüş**: sistem normale alınır, artırılmış izleme 30 gün.
8. **Değerlendirme**: olay raporu, kök neden, alınan önlemler; kurallar ve eşikler güncellenir.

## 4. Yedekleme ve geri yükleme

- Günlük şifreli `pg_dump` (gece 03:00), 35 gün saklama, en az bir kopya farklı fiziksel konumda.
- Dosya depoları (yüklenen dosyalar, Aşama 2 kayıtları) günlük senkron.
- **Haftalık otomatik geri yükleme testi**: son yedek ayrı bir test veritabanına yüklenir, temel tutarlılık sorguları çalıştırılır, sonuç raporlanır.
- Hedefler: RPO ≤ 24 saat, RTO ≤ 4 saat.

## 5. Anahtar yönetimi

- Uygulama şifreleme anahtarı (`FIELD_ENCRYPTION_KEY`) ve hash anahtarı (`BLIND_INDEX_KEY`) `.env` dışında, sunucuda yalnız root okuyabilir bir dosyada; yedekleri ayrı yerde.
- Anahtar rotasyonu: yeni anahtar sürümü eklenir, kayıtlar arka planda yeniden şifrelenir (anahtar sürümü kayıtta tutulur).

## Açık sorular

1. KVKK bildirim sorumlusu ve irtibat kişisi kim?
2. Uyarı bildirimleri e-posta dışında hangi kanala gitmeli (SMS, Teams, Slack)?
3. Yedeklerin ikinci konumu neresi olacak?
4. Mesai saatleri (uyarı kuralı için) 07:00–22:00 doğru mu?
