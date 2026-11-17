#!/usr/bin/env sh
# .env.production dosyasını şablondan üretir; parola ve anahtarları rastgele oluşturur.
#   sh scripts/init-env.sh crm.sirket.local
# Var olan dosyanın üzerine yazmaz (anahtar kaybı = şifreli verinin kaybı).
set -eu
cd "$(dirname "$0")/.."
OUT=.env.production
if [ -e "$OUT" ]; then
  echo "HATA: $OUT zaten var. Üzerine yazılmaz (şifreleme anahtarları kaybolur)." >&2
  exit 1
fi
command -v openssl >/dev/null || { echo "HATA: openssl gerekli" >&2; exit 1; }
DOMAIN="${1:-crm.sirket.local}"

# Her yer tutucu için ayrı rastgele değer (awk yerine satır satır, değerler tekrar kullanılmaz)
umask 077
: > "$OUT"
while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in
    *__RANDOM_HEX_32__*) line=$(printf '%s' "$line" | sed "s/__RANDOM_HEX_32__/$(openssl rand -hex 32)/") ;;
    *__RANDOM_HEX_16__*) line=$(printf '%s' "$line" | sed "s/__RANDOM_HEX_16__/$(openssl rand -hex 16)/") ;;
    *__RANDOM_B64_32__*) line=$(printf '%s' "$line" | sed "s|__RANDOM_B64_32__|$(openssl rand -base64 32)|") ;;
  esac
  case "$line" in
    CRMPLUS_DOMAIN=*) line="CRMPLUS_DOMAIN=$DOMAIN" ;;
  esac
  printf '%s\n' "$line" >> "$OUT"
done < .env.production.example

echo "$OUT oluşturuldu (izin 600)."
echo "İlk yönetici parolası: $(grep '^SEED_ADMIN_PASSWORD=' "$OUT" | cut -d= -f2)"
echo "⚠ FIELD_ENCRYPTION_KEY ve BLIND_INDEX_KEY değerlerini yedeklerden ayrı, güvenli bir yerde saklayın."
