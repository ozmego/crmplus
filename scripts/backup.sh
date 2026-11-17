#!/usr/bin/env sh
# crmPlus yedeği: PostgreSQL (pg_dump, özel biçim) + dosya deposu (şifreli dosyalar) + özet (SHA-256).
#   sh scripts/backup.sh [hedef_klasör]          vars. ./backups
#   BACKUP_KEEP_DAYS=30 (vars.) — daha eski yedekler silinir
# Gizli anahtarlar (.env.production) yedeğe DAHİL EDİLMEZ; ayrı saklanır (docs/12).
# Önerilen: her gece cron ile, yedek klasörü başka bir sunucuya/diske kopyalanır.
set -eu
# Git Bash (Windows) yol dönüştürmesini kapat; Linux'ta etkisi yok
export MSYS_NO_PATHCONV=1
cd "$(dirname "$0")/.."
DEST="${1:-./backups}"
KEEP="${BACKUP_KEEP_DAYS:-30}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DIR="$DEST/crmplus-$STAMP"
COMPOSE="docker compose --env-file .env.production"
umask 077
mkdir -p "$DIR"

# shellcheck disable=SC1091
set -a; . ./.env.production; set +a

echo "[1/3] Veritabanı dökümü…"
$COMPOSE exec -T postgres pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc --no-owner > "$DIR/db.dump"

echo "[2/3] Dosya deposu…"
# Bağlama (bind mount) yerine standart çıktı üzerinden: her ortamda aynı çalışır
$COMPOSE run --rm -T --no-deps --entrypoint tar worker -C /app/storage -czf - . > "$DIR/storage.tar.gz"

echo "[3/3] Özet…"
( cd "$DIR" && sha256sum db.dump storage.tar.gz > SHA256SUMS )
printf 'created=%s\nschema_migrations=%s\n' "$STAMP" "$($COMPOSE exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc 'select count(*) from _prisma_migrations')" > "$DIR/MANIFEST"

find "$DEST" -maxdepth 1 -type d -name 'crmplus-*' -mtime +"$KEEP" -exec rm -rf {} + 2>/dev/null || true
echo "Yedek hazır: $DIR"
