#!/usr/bin/env bash
# DESTRUCTIVE: stop the deploy stack and DELETE the host postgres + redis data folders.
# This is the only command that destroys DB data (compose:reset preserves it).
# Resolves JOURNEYMAN_BASE_DIR from .env.production so it targets the real data dir.
set -euo pipefail
cd "$(dirname "$0")/.."

ENV_FILE=".env.production"
data_dir="$(grep -E '^JOURNEYMAN_BASE_DIR=' "$ENV_FILE" 2>/dev/null | head -n1 | cut -d= -f2- || true)"
data_dir="${data_dir:-./.journeyman-data}"

echo ">>> Stopping the stack and DELETING DB data under: ${data_dir}/{postgres,redis}"
docker compose --env-file "$ENV_FILE" -f compose.deploy.yml down
rm -rf "${data_dir}/postgres" "${data_dir}/redis"
echo "✓ DB data wiped (${data_dir}/postgres, ${data_dir}/redis removed)."
