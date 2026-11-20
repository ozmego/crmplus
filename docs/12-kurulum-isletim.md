# 12 — Kurulum ve İşletim (Üretim)

Durum: **Taslak** · Sahibi: BT · İlgili: 07 (saklama), 08 (olay müdahale)

## 1. Bileşenler

| Servis | İmaj | Görev | Dışarı açık |
|---|---|---|---|
| `caddy` | caddy:2 | HTTPS, ters vekil, HSTS, 60 MB gövde sınırı | **80, 443** |
| `app` | crmplus-app (Dockerfile `app`) | Next.js uygulaması, `/api/health` | hayır |
| `worker` | crmplus-worker (Dockerfile `worker`) | içe aktarma, kayıt indirme, transkript, SMS/WhatsApp gönderimi, gece puantajı, İYS, bakım | hayır |
| `migrate` | crmplus-worker | tek seferlik `prisma migrate deploy` (her başlatmada, idempotent) | — |
| `postgres` | postgres:16 | veritabanı (`public`, `finance`, `hr` şemaları) | hayır |
| `redis` | redis:7 (parolalı, AOF) | iş kuyruğu | hayır |
| `clamav` | clamav/clamav:1.4 | yüklenen dosyaların taranması (üretimde zorunlu) | hayır |
| `speech` *(isteğe bağlı)* | ./speech | Türkçe transkript (GPU) — `--profile speech` | hayır |

Kalıcı birimler: `pgdata`, `redisdata`, `storage` (şifreli dosyalar: içe aktarma, ses, ekstre), `clamav`, `caddy-data` (sertifikalar).

## 2. Sunucu gereksinimi

Plan v4 “Kapasite”: uygulama + veritabanı için 16 vCPU, 64 GB RAM, 1 TB NVMe (Linux, Docker Engine 24+ ve Compose v2). Ses analizi açılacaksa ayrı GPU sunucusu (24 GB VRAM).

## 3. İlk kurulum

```bash
git clone <depo> crmplus && cd crmplus
sh scripts/init-env.sh crm.sirket.com.tr     # .env.production: rastgele parola ve anahtarlar (600 izni)
# .env.production içinde: CRMPLUS_TLS (ACME e-postası veya internal), SEED_ADMIN_EMAIL, sağlayıcı ayarları
docker compose --env-file .env.production up -d --build
docker compose --env-file .env.production run --rm worker pnpm db:seed:prod   # roller, sonuç kodları, ilk yönetici
curl -fsS https://crm.sirket.com.tr/api/health                                  # {"status":"ok",...}
```

- İlk yönetici `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` ile girer; ilk girişte şifre değişimi ve MFA zorunludur. Ardından seed parolasını `.env.production`'dan silin.
- **Demo verisi üretimde yüklenmez** (`SEED_DEMO` tanımlanmaz).
- ClamAV ilk açılışta imza indirir (birkaç dakika); bu sürede dosya yükleme “taranamadı” hatası verir — bilinçli olarak taranmamış dosya kabul edilmez.
- İç ağ kurulumunda (`CRMPLUS_TLS=internal`) Caddy'nin kök sertifikası (`caddy-data` birimi → `/data/caddy/pki/authorities/local/root.crt`) istemci bilgisayarlara güvenilir kök olarak dağıtılır.

## 3a. Santral — 3CX V20

crmPlus, 3CX'e **Call Control API** ile bağlanır. Arama `POST /callcontrol/{dahili}/makecall` ile başlatılır: 3CX önce temsilcinin dahilisini çaldırır, temsilci açınca misafiri arar. Numara tarayıcıya gönderilmez. 3CX webhook göndermez; bağlanma ve bitiş anları işçideki dinleyicinin `/callcontrol/ws` olay akışından okunur. Bu yüzden **worker hizmeti çalışmıyorsa süreler yazılmaz**. Santraldeki diğer çağrılar yok sayılır, yalnız crmPlus'ın başlattığı çağrılar işlenir.

1. **Lisans:** Call Control API, 3CX V20'nin Enterprise lisansında açılır (sürüm ve lisans 3CX yöneticisiyle teyit edilir).
2. **3CX yönetim konsolu > Entegrasyonlar > API > Ekle:**
   - "3CX Call Control API erişimi"ni açın.
   - İzlenecek dahililer olarak tüm temsilci dahililerini seçin.
   - Oluşan istemci kimliğini ve API anahtarını kaydedin. Anahtar yalnız bir kez gösterilir.
3. **`.env.production` içine:**
   ```
   PBX_PROVIDER=3cx
   THREECX_URL=https://firma.3cx.com.tr
   THREECX_CLIENT_ID=<istemci kimliği>
   THREECX_CLIENT_SECRET=<API anahtarı>
   THREECX_DIAL_FORMAT=e164
   ```
   `THREECX_DIAL_FORMAT` santralin giden arama kuralına göre seçilir: `e164` (+90532…), `00` (0090532…) veya `national` (0532…).
4. `docker compose --env-file .env.production up -d app worker` ile hizmetleri yeniden başlatın. Worker günlüğünde `[3cx] olay akışına bağlanıldı` satırı görünmelidir.
5. **crmPlus > Yönetim > Entegrasyonlar > Santral — 3CX:**
   - Her temsilciye dahili numarasını gerekçeyle atayın.
   - **Bağlantıyı sına** düğmesine basın. Sınama belirteç alır ve dahili listesini okur; arama başlatmaz. API istemcisinde izlenmeyen dahililer ayrıca listelenir.
6. **Canlı deneme:** bir test misafiriyle tek arama yapın. Çağrı kaydında `santral 3cx`, bağlanma ve bitiş anları ile konuşma süresi görünmelidir.

**Hata durumları:**
- 3CX yanıt vermezse veya kimlik reddedilirse arama **manuel moda düşer** ve `DIAL_FAILED` olayı açılır (Yönetim > Ayarlar > Santral).
- Olay akışı koparsa worker artan beklemeyle yeniden bağlanır; her denemede belirteci yeniler. Üçüncü başarısızlıkta bir kez `EVENTS_DISCONNECTED`, bağlantı geri gelince `EVENTS_RESTORED` olayı yazılır. Kopukluk sırasında biten çağrıların süreleri boş kalır; temsilci sonuç kodunu yine girer.

**Geliştirmede sahte santral:**
```bash
node scripts/dev/fake-3cx.mjs   # http://127.0.0.1:5090 · istemci crmplus / secret · dahililer 101, 102
```
Arama ve olay akışını uçtan uca dener: Dialing → 3 sn sonra Connected → 6 sn sonra kapanış. Numara 0000 ile bitiyorsa misafir açmaz. `scripts/dev/try-3cx-call.ts` bir temsilcinin açık görevinden arama başlatıp süreleri izler. Bu betik yalnız geliştirme veritabanı içindir: temsilcinin açık çağrılarını kapatır.

**Henüz yok:**
- 3CX ses kayıtlarının crmPlus'a çekilmesi (XAPI `Recordings`). Kayıt akışı şimdilik genel santral webhook'u (`recording.ready`) üzerinden çalışıyor.
- Çağrı geçmişinden (CDR) süre mutabakatı.

## 4. Anahtarlar ve gizli değerler

| Değer | Kaybolursa |
|---|---|
| `FIELD_ENCRYPTION_KEY` | Şifreli alanlar (telefon, e-posta, notlar, MFA sırları) ve dosyalar **okunamaz** — geri dönüşü yoktur |
| `BLIND_INDEX_KEY` | Telefon/e-posta ile eşleme ve arama çalışmaz |
| `POSTGRES_PASSWORD`, `REDIS_PASSWORD` | Değiştirilebilir (servisleri yeniden başlatın) |
| Webhook sırları (`PBX_`, `SMS_`, `WA_APP_SECRET`) | Sağlayıcı panelinde yenilenir |
| `THREECX_CLIENT_SECRET` | 3CX konsolunda API istemcisi için yeni anahtar üretilir; worker ve app yeniden başlatılır |

`.env.production` yedeklere **dahil edilmez**; ayrı, erişimi kısıtlı bir kasada (parola yöneticisi / HSM) saklanır. Anahtar rotasyonu Aşama sonrası iştir (tüm şifreli alanların yeniden şifrelenmesi gerekir).

## 5. Yedekleme ve geri yükleme

```bash
sh scripts/backup.sh /yedek/crmplus          # pg_dump (özel biçim) + depo arşivi + SHA256SUMS + MANIFEST; 30 günden eskiler silinir
sh scripts/restore.sh /yedek/crmplus/crmplus-<zaman> --test   # geçici veritabanına yükler, tablo sayılarını ve tetikleyicileri doğrular, siler
sh scripts/restore.sh /yedek/crmplus/crmplus-<zaman>          # GERÇEK geri yükleme (EVET onayı ister; app/worker durdurulur)
```

- Önerilen zamanlama (cron, sunucu saati): her gece 02:30 yedek; her pazar 04:00 `--test` geri yükleme denemesi. Sonuçlar BT'ye e-postayla.
- Yedek klasörü aynı gün başka bir sunucuya / çevrimdışı diske kopyalanır (3-2-1 kuralı). Yedekler şifreli alanları zaten şifreli içerir; yine de yedek diski şifreli olmalıdır.
- Hedefler (taslak): RPO 24 saat, RTO 4 saat. Daha kısa RPO için PostgreSQL WAL arşivleme (Aşama sonrası).
- Değiştirilemez denetim kayıtları (AuditLog, AccessLog, puantaj düzeltmeleri) geri yüklemede tetikleyicileriyle birlikte gelir; test bunu doğrular.

## 6. Güncelleme

```bash
sh scripts/backup.sh /yedek/crmplus           # her güncellemeden önce
git pull
docker compose --env-file .env.production up -d --build   # migrate servisi göçleri uygular, ardından app/worker yeniden başlar
curl -fsS https://<alan>/api/health
```

Göçler yalnız ileri yönlüdür; geri dönüş yedekten geri yüklemeyle yapılır.

## 7. İzleme

- `GET /api/health` → 200 `{"status":"ok","checks":{"db":"ok","redis":"ok"}}`, sorun varsa 503. Kimlik istemez, yapılandırma bilgisi vermez.
- Konteyner sağlık durumu: `docker compose ps` (app ve veritabanı sağlık kontrolleri tanımlı).
- Günlükler: `docker compose logs -f app worker caddy` (Caddy JSON erişim günlüğü). Uygulama içi denetim ve erişim kayıtları **Yönetim → Denetim** ekranında; olağan dışı erişim uyarıları operasyon panelinde.
- İşçi zamanlanmış işleri: bakım (5–15 dk), puantaj (06:30), kalite örneklemi (Pazartesi 07:00), İYS (15 dk), saklama temizliği (03:15).

## 8. Güvenlik notları

- Yalnız 80/443 açıktır; veritabanı, Redis ve ClamAV iç ağdadır.
- Caddy'nin önünde başka vekil yoktur; istemci `X-Forwarded-For` başlıklarına güvenilmez (denetim kaydındaki IP sahte başlıkla değiştirilemez). Önüne yük dengeleyici konursa Caddy `trusted_proxies` yalnız o cihazın IP'siyle ayarlanır.
- Oturum çerezleri üretimde `Secure`, `HttpOnly`, `SameSite=Strict`.
- Sahte (mock) sağlayıcılar üretimde çalışmaz; yapılandırılmamış servis açık hata verir veya kapalı kalır (ör. İYS yokken TR numaralara ileti gitmez).
- Uygulama ve işçi konteynerleri root olmayan kullanıcıyla (`node`) çalışır.

## 8a. Doğrulama kaydı (17 Kasım 2026, yerel sınama yığını)

- İmajlar Linux'ta derlendi (`app` standalone, `worker`); tüm servisler sağlıklı kalktı, `migrate` 15 göçü uyguladı, seed çalıştı.
- Caddy üzerinden HTTPS: `/api/health` 200, HSTS ve güvenlik başlıkları mevcut, HTTP → HTTPS yönlendirmesi.
- Üretim imajında giriş: ilk girişte şifre değişimine yönlendirme; oturum çerezi `Secure`, `HttpOnly`, `SameSite=Strict`; yanlış şifre uyarısı.
- `backup.sh` → `restore.sh --test` başarılı (tablo sayıları, göç kaydı, 3 değiştirilemezlik tetikleyicisi, depo arşivi); gerçek geri yükleme sonrası sonradan eklenen kayıt geri alındı, dosya deposu döndü, uygulama sağlıklı.

## 8b. Performans ölçümü (20 Kasım 2026)

Hedef (plan, Kapasite): 500 bin satırlık dosyada önizleme 3 dakikanın, uygulama 10 dakikanın altında kalmalı. Ölçüm araçları `scripts/perf/` altındadır: `gen-import.ts` sentetik dosya üretir, `import-bench.ts` yükleme → önizleme → karar → uygulama akışını çalıştırır, `normalize-bench.ts` satır başı işlem maliyetini ölçer. Ölçüm ayrı bir `crmplus_perf` veritabanında, geliştirici dizüstü bilgisayarında (Windows + Docker Desktop) yapıldı. Ölçüm sırasında sistemin uykuya geçmesi engellendi ve başka iş çalışmadı. Üretim sunucusu (16 vCPU) daha hızlı olmalıdır.

| Senaryo | Önizleme | Uygulama | Tepe bellek |
|---|---|---|---|
| İlk yükleme: 500.000 yeni misafir | 1,6 dk | 4,6 dk | 2,0 GB |
| Tekrar yükleme: 475.000 mevcut (47.500'ünde şehir değişmiş) + 25.000 yeni | 2,4 dk | 0,5 dk (toplu karar 3,4 sn dahil değil) | 2,4 GB |

- Önizlemede en uzun adım satırların veritabanına yazılması (~71 sn). Sonra aday yükleme geliyor (güncelleme senaryosunda 9 + 29 sn).
- Doğrulama: güncellenen her misafir için alan geçmişi yazıldı (47.500). İzin sayıları beklenenle tutuyor (350.000 + 17.500). `applied` kaydı boş satır kalmadı.
- **İşçi belleği:** `NODE_OPTIONS=--max-old-space-size=6144`, ölçülen tepe değere pay bırakır (Dockerfile).

**Bu ölçümü mümkün kılan değişiklikler:**
- Yeni ve eşleşen satırlar 500–1000'lik sayfalarla toplu yazılıyor. Önceden satır satırdı ve tahmini süre yaklaşık 60 dakikaydı.
- 18 eksik yabancı anahtar indeksi eklendi.
- Aday misafirler önce yalnız kimlikle bulunuyor, sonra her biri bir kez yükleniyor.
- Şifreleme anahtarı OpenSSL `KeyObject` olarak önbelleğe alındı (AES-GCM 50 → 10 µs, HMAC 32 → 4 µs).
- Türkçe harf dönüşümü ICU olmadan yapılıyor; sonuçların ICU ile birebir aynı olduğu birim testiyle doğrulandı.
- Önizleme satırları tek bir uzun veritabanı işlemi yerine parça parça yazılıyor; 120 saniyelik işlem zaman aşımı ortadan kalktı.

**Henüz ölçülmeyen:** 500 bin satırlık bir içe aktarmanın **geri alınması** hâlâ satır satır yapılıyor. Büyük dosyalarda uzun sürer; toplu hale getirilmesi gerekiyor.

## 9. Bilinen sınırlar

- Windows geliştirici makinesinde `next build` son adımda (standalone kopyalama) sembolik bağlantı izni yüzünden durabilir; üretim derlemesi Linux konteynerinde yapılır.
- Ses servisi (`speech`) GPU'da henüz test edilmedi (speech/README.md).
- Onay süreçleri (karar kapıları, hukuk/İK teyitleri) kuruluma engel değildir; ilgili özellikler onaylanana kadar kapalı kalır.

## Açık sorular

1. Sunucu ve yedek hedefi (ikinci sunucu / NAS / bulut) hangisi?
2. Alan adı ve sertifika: internete açık mı (Let's Encrypt), iç ağ mı (internal CA)?
3. RPO/RTO hedefleri uygun mu?
