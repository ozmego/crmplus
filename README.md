# crmPlus

Junket operasyonları için şirket içinde çalışan CRM ve çağrı merkezi: kontrollü Excel içe aktarma ve karşılaştırma, izne dayalı arama kuyruğu, bulut santral, ses kaydı ve Türkçe transkript (karar kapısına bağlı), SMS kampanyaları, ayrı bir finans/komisyon modülü ve personel/vardiya/puantaj modülü.

Ürün kuralları ve politikalar: [docs/](docs/README.md) · Uygulama planı: [docs/crmPlus_Uygulama_Plani_v4.pdf](docs/crmPlus_Uygulama_Plani_v4.pdf)

## Geliştirme ortamı

Gerekenler: Node 22+, pnpm, Docker Desktop.

```bash
pnpm install
cp .env.example .env          # anahtarları doldurun (aşağıya bakın)
pnpm db:up                    # PostgreSQL 16 (127.0.0.1:25433) + Redis (127.0.0.1:16380)
pnpm db:migrate
SEED_DEMO=1 pnpm db:seed      # roller, sonuç kodları, yönetici + isteğe bağlı demo verisi

pnpm exec next dev -p 3210    # uygulama → http://localhost:3210
pnpm worker                   # ayrı terminalde: arka plan işçisi (içe aktarma, kayıt, transkript, SMS, bakım)
```

İşçi çalışmıyorsa büyük içe aktarmalar, ses kayıtları, transkriptler ve SMS kampanyaları kuyrukta bekler.

### Önemli ortam değişkenleri

| Değişken | Açıklama |
|---|---|
| `FIELD_ENCRYPTION_KEY`, `BLIND_INDEX_KEY` | Alan şifreleme ve telefon/e-posta eşleme anahtarları (32 bayt, hex). **Kaybolursa veri okunamaz.** |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` | İlk yönetici; ilk girişte şifre değişimi ve MFA zorunlu |
| `PBX_PROVIDER` | `pbx-http` (bulut santral) veya `manual` (yedek mod) |
| `PBX_WEBHOOK_SECRET` | Santral webhook imzası (HMAC-SHA256) |
| `TRANSCRIBER`, `SPEECH_URL`, `SPEECH_TOKEN` | `remote` → şirket içi [speech/](speech/README.md) servisi; `mock` yalnız geliştirme |
| `SMS_PROVIDER`, `SMS_SEND_URL`, `SMS_API_TOKEN`, `SMS_SENDER` | `sms-http` (üretim) veya `mock` (geliştirme) |
| `SMS_WEBHOOK_SECRET` | Gelen SMS/teslim raporu webhook imzası |

Üretimde `mock` sağlayıcılar çalışmaz; yapılandırılmamış servis açık hata verir.

### Webhook'lar

- Santral: `POST /api/telephony/webhook/<sağlayıcı>`
- SMS: `POST /api/messaging/webhook/<sağlayıcı>`

Başlıklar: `x-crmplus-timestamp` (unix saniye) ve `x-crmplus-signature` = hex HMAC-SHA256(secret, `${timestamp}.${gövde}`). ±5 dakika dışındaki ve tekrarlanan olaylar işlenmez.

## Üretim kurulumu

Ayrıntı: [docs/12-kurulum-isletim.md](docs/12-kurulum-isletim.md).

```bash
sh scripts/init-env.sh crm.sirket.com.tr          # .env.production (rastgele parola ve anahtarlar)
docker compose --env-file .env.production up -d --build
docker compose --env-file .env.production run --rm worker pnpm db:seed:prod
sh scripts/backup.sh /yedek/crmplus               # yedek; geri yükleme testi: scripts/restore.sh <klasör> --test
```

Yalnız Caddy (80/443) dışarı açıktır; PostgreSQL, Redis, ClamAV ve uygulama iç ağdadır. Sağlık kontrolü: `/api/health`.

## Testler

```bash
pnpm test                     # birim testleri (Vitest)
pnpm exec tsc --noEmit && pnpm lint
pnpm test:e2e                 # uçtan uca (Playwright, Chrome) — dev sunucusu (3210) ve worker çalışıyor olmalı
```

E2E kurulumu yalnız `e2e-*` test hesaplarını ve demo hesaplarının giriş durumunu sıfırlar; her spec farklı bir hesapla giriş yapar.

Tam paket uzun sürer; Next.js geliştirme sunucusu bellek eşiğini aşınca kendini yeniden başlatır (`Server is approaching the used memory threshold`) ve o anda açık istekler kopar. Tam paket için sunucuyu daha yüksek bellekle başlatın: `NODE_OPTIONS=--max-old-space-size=8192 pnpm exec next dev -p 3210`.

## Dizinler

```
docs/            Aşama 0 belgeleri (rol matrisi, alan sözlüğü, izin akışı, KPI, komisyon, ses, mesajlaşma, personel)
docs/templates/  misafir-import.xlsx (pnpm template:import ile üretilir)
prisma/          şema (public + finance + hr), göçler, seed
speech/          şirket içi Türkçe transkript servisi (faster-whisper) — iskelet, GPU'da test edilmedi
src/app/         ekranlar ve API (Next.js App Router)
src/server/      servisler, yetkilendirme, şifreleme, santral ve SMS sağlayıcıları
src/lib/         saf iş kuralları (birim testli)
src/worker/      BullMQ işçisi (içe aktarma, kayıt, transkript, SMS, bakım, gece puantajı)
tests/           unit + e2e
```
