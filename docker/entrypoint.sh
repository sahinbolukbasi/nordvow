#!/bin/sh
# Konteyner girişi. Argüman verilmezse: veritabanı hazırlığı + web sunucusu.
# Argüman verilirse (ör. agent job'ı) doğrudan o komut çalışır.
set -e
cd /app

# ECS görev tanımı anahtarı enjekte etmese de infulancer-prod/integrations okunur.
# Dolu ortam değişkeni ezilmez. Okuma hatası kabı durdurmaz.
HYDRATE_FILE=/tmp/nv-integrations.env
rm -f "$HYDRATE_FILE"
npx tsx packages/core/scripts/hydrate-integrations.ts --write "$HYDRATE_FILE" || true
if [ -f "$HYDRATE_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$HYDRATE_FILE"
  set +a
  rm -f "$HYDRATE_FILE"
fi

if [ "$#" -gt 0 ]; then
  exec "$@"
fi

npx tsx packages/core/scripts/bootstrap.ts ensure-audit-db
npm run db:migrate
npm run audit:migrate
npx tsx packages/core/scripts/bootstrap.ts sync-models
if [ "${SEED_ON_START:-false}" = "true" ]; then
  npx tsx packages/core/scripts/bootstrap.ts seed-if-empty
fi

exec npm run start -w @infulancer/web -- -p "${PORT:-3000}" -H 0.0.0.0
