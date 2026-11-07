# 07 — Veri Envanteri ve Saklama

Durum: **Taslak — hukuk teyidi bekliyor** · Sahibi: KVKK irtibat kişisi

> Hukuki dayanak sütunu 6698 sayılı KVKK md. 5/6 kapsamında **öneridir**. ⚖️ HUKUK: Her satır hukuk danışmanı tarafından teyit edilmeli; aydınlatma metni ve VERBİS kaydı bu tabloya göre güncellenmeli.

## 1. Envanter

| Veri kategorisi | Alanlar | Amaç | Önerilen hukuki dayanak | Kimler erişir | Saklama süresi (taslak) | Süre sonunda |
|---|---|---|---|---|---|---|
| Kimlik | Ad, soyad | Misafir tanıma, iletişim | Sözleşme / meşru menfaat | Tüm operasyon rolleri (kapsamlı) | Son iletişim + 3 yıl | Anonimleştirme |
| Kimlik (ek) | Doğum yılı/tarihi, belge no | Eşleştirme, yaş doğrulama, trip rezervasyonu | Sözleşme; belge no için açık rıza veya hukuki yükümlülük ⚖️ | Operasyon yön., Finans | Son trip + 3 yıl | Silme |
| İletişim | Telefon, e-posta | Arama, mesaj | Açık rıza (pazarlama) | Kapsamlı, maskeli | İzin geri alınana kadar; son iletişim + 3 yıl | Silme |
| İzin kayıtları | Kanal durumu, kaynak, kanıt | Yasal yükümlülüğün ispatı | Hukuki yükümlülük | Uyum, Operasyon yön. | İzin sona erdikten sonra 3 yıl ⚖️ | Silme |
| Durdurma kayıtları | Telefon hash’i, kanal, tarih | Tekrar aramayı önleme | Hukuki yükümlülük / meşru menfaat | Sistem (otomatik), Uyum | Süresiz (yalnız hash) ⚖️ | — |
| Müşteri işlem | Çağrı meta verisi, sonuç kodu, görevler | Operasyon, performans | Meşru menfaat | Kapsamlı | 2 yıl | Toplulaştırma + silme |
| Notlar | Serbest metin | Hizmet sürekliliği | Meşru menfaat | Not izni olanlar | 2 yıl | Silme |
| Finansal | Oyun sonuçları, harcama, komisyon | Komisyon, faturalandırma | Sözleşme / hukuki yükümlülük (VUK, TTK) | Finans | 10 yıl ⚖️ | Silme |
| Seyahat | Uçuş, otel, transfer | Trip organizasyonu | Sözleşme | Operasyon, Finans | Trip + 3 yıl (fatura kalemleri 10 yıl) | Silme |
| Sorumlu oyun | Bayraklar, inceleme notları | Misafiri koruma | Meşru menfaat ⚖️ (özel nitelikli veri sayılıp sayılmayacağı teyit edilmeli) | Kalite analisti, Operasyon yön. | İnceleme kapanışı + 2 yıl | Silme |
| Ses kaydı (Aşama 2) | Görüşme sesi | Kalite, uyum, ispat | Açık rıza / meşru menfaat ⚖️ | Kalite analisti, lider (gerekçeli) | 90 gün | Silme |
| Transkript (Aşama 2) | Ham / maskelenmiş metin | Kalite analizi | Aynı | Ham: Kalite analisti; Maskelenmiş: kapsamlı | Ham 30 gün; maskelenmiş 1 yıl | Silme |
| Mesaj içeriği (Aşama 2) | SMS/WhatsApp gövdesi | İletişim geçmişi | Açık rıza | Kapsamlı | 1 yıl | İçerik silme, meta veri kalır |
| Yüklenen dosyalar | Orijinal Excel | İzlenebilirlik | Meşru menfaat | Veri yükleyici, Operasyon yön. | 30 gün | Silme (hash + meta kalır) |
| Kullanıcı (personel) | Ad, e-posta, oturum, IP, cihaz | Güvenlik | Hukuki yükümlülük / meşru menfaat | Sistem yön., Denetçi | Ayrılış + 2 yıl | Anonimleştirme |
| Denetim/erişim kayıtları | AuditLog, AccessLog | Güvenlik, ispat | Hukuki yükümlülük (KVKK md. 12 güvenlik tedbirleri) | Denetçi, Sistem yön. | 2 yıl | Silme |

## 2. Silme ve anonimleştirme akışı

- **Otomatik**: `retention` işi her gece çalışır; süresi dolan kayıtları kategori bazında siler/anonimleştirir, işlem özetini (kategori, adet, tarih — kişisel veri olmadan) kayıt altına alır.
- **Anonimleştirme**: ad/soyad → `Anonim-<rastgele>`, iletişim bilgileri silinir, telefon hash’i durdurma listesi için korunur (yalnız durdurma kaydı varsa), istatistiklerde kullanılan sayısal alanlar (çağrı adetleri) kalır.
- **İlgili kişi talebi** (KVKK md. 11): `retention.manage` yetkili kişi talebi kaydeder → sistem misafirin tüm kayıtlarının dökümünü (erişim talebi) veya silme önizlemesini üretir → onay → uygulama. Yasal saklama zorunluluğu olan kategoriler (finans) silinmez, erişimi kısıtlanır ve gerekçesi raporda belirtilir. Yanıt süresi takibi: 30 gün.
- **Yedekler**: silinen veri yedeklerde yedek saklama süresi (35 gün) sonunda kendiliğinden kaybolur; yedekten geri yükleme yapılırsa `retention` işi geri yükleme sonrasında yeniden çalıştırılır.

## 3. Teknik tedbirler (özet)

| Tedbir | Uygulama |
|---|---|
| Aktarımda şifreleme | TLS 1.2+ (Caddy), HSTS |
| Depolamada şifreleme | Disk şifreleme (LUKS); telefon, e-posta, belge no, not, mesaj gövdesi için uygulama düzeyinde AES-256-GCM; anahtar ayrı saklanır |
| Arama için hash | Telefon/e-posta için HMAC-SHA256 blind index |
| Yedek | Günlük şifreli `pg_dump`, 35 gün; haftalık geri yükleme testi |
| Dosya | ClamAV tarama, şifreli geçici depo, 30 gün |
| Erişim | RBAC, MFA, oturum sınırları, AccessLog |
| Maskeleme | Alan grupları, varsayılan maskeli görünüm |

## Açık sorular

1. VERBİS kaydı mevcut mu? Envanter VERBİS kayıtlarıyla uyumlu mu? ⚖️
2. Finans kayıtları için 10 yıl yeterli/gerekli mi? ⚖️
3. Durdurma listesinin (yalnız telefon hash’i) süresiz tutulması kabul edilebilir mi? ⚖️
4. Belge numarası (pasaport/TC) tutulması iş için zorunlu mu? Değilse hiç toplanmamalı.
5. Sunucu yurt içinde mi? (Yurt dışı aktarım değerlendirmesini etkiler.)
