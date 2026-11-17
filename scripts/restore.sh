#!/usr/bin/env sh
# crmPlus geri yükleme.
#   sh scripts/restore.sh backups/crmplus-<zaman>          üretim veritabanının ve deposunun YERİNE geçer (onay ister)
#   sh scripts/restore.sh backups/crmplus-<zaman> --test   geçici bir veritabanına yükler, tutarlılığı kontrol eder, siler
# Aynı FIELD_ENCRYPTION_KEY / BLIND_INDEX_KEY ile çalışan bir kurulumda geri yüklenmelidir.
set -eu
# Git Bash (Windows) yol dönüştürmesini kapat; Linux'ta etkisi yok
export MSYS_NO_PATHCONV=1
cd "$(dirname "$0")/.."
DIR="${1:?Kullanım: restore.sh <yedek_klasörü> [--test]}"
MODE="${2:-}"
COMPOSE="docker compose --env-file .env.production"
# shellcheck disable=SC1091
set -a; . ./.env.production; set +a

echo "Özet doğrulanıyor…"
( cd "$DIR" && sha256sum -c SHA256SUMS )

if [ "$MODE" = "--test" ]; then
  T="crmplus_restore_test"
  echo "Geçici veritabanına ($T) yükleniyor…"
  $COMPOSE exec -T postgres psql -U "$POSTGRES_USER" -d postgres -qc "DROP DATABASE IF EXISTS $T" -c "CREATE DATABASE $T"
  $COMPOSE exec -T postgres pg_restore -U "$POSTGRES_USER" -d "$T" --no-owner --exit-on-error < "$DIR/db.dump"
  q() { $COMPOSE exec -T postgres psql -U "$POSTGRES_USER" -d "$1" -tAc "$2"; }
  FAIL=0
  for tbl in '"User"' '"Guest"' '"Call"' '"AuditLog"' '"AccessLog"' 'finance."GamingResult"' 'hr."Employee"' '_prisma_migrations'; do
    a=$(q "$POSTGRES_DB" "select count(*) from $tbl"); b=$(q "$T" "select count(*) from $tbl")
    status="OK"; [ "$a" -lt "$b" ] && status="FAZLA"; [ "$b" -eq 0 ] && [ "$a" -gt 0 ] && status="EKSİK" && FAIL=1
    printf '  %-26s canlı=%-8s yedek=%-8s %s\n' "$tbl" "$a" "$b" "$status"
  done
  # Değiştirilemez kayıt tetikleyicisi geri yüklendi mi?
  trg=$(q "$T" "select count(*) from pg_trigger where tgname like '%append_only%'")
  echo "  değiştirilemezlik tetikleyicisi: $trg"
  [ "$trg" -ge 3 ] || FAIL=1
  echo "Depo arşivi: $(tar -tzf "$DIR/storage.tar.gz" | wc -l) girdi"
  $COMPOSE exec -T postgres psql -U "$POSTGRES_USER" -d postgres -qc "DROP DATABASE $T"
  [ "$FAIL" -eq 0 ] && echo "GERİ YÜKLEME TESTİ BAŞARILI" || { echo "GERİ YÜKLEME TESTİ BAŞARISIZ" >&2; exit 1; }
  exit 0
fi

printf 'UYARI: %s veritabanı ve dosya deposu %s yedeğiyle DEĞİŞTİRİLECEK. Devam için EVET yazın: ' "$POSTGRES_DB" "$DIR"
read -r ans
[ "$ans" = "EVET" ] || { echo "İptal edildi."; exit 1; }
$COMPOSE stop app worker
$COMPOSE exec -T postgres psql -U "$POSTGRES_USER" -d postgres -qc "DROP DATABASE $POSTGRES_DB WITH (FORCE)" -c "CREATE DATABASE $POSTGRES_DB"
$COMPOSE exec -T postgres pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --exit-on-error < "$DIR/db.dump"
$COMPOSE run --rm -T --no-deps --entrypoint sh worker -c "find /app/storage -mindepth 1 -delete && tar -C /app/storage -xzf -" < "$DIR/storage.tar.gz"
$COMPOSE up -d app worker
echo "Geri yükleme tamam."
