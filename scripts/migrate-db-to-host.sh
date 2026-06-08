#!/usr/bin/env bash
# One-time migration: copy the existing project-managed DB named volumes
# (journeyman-deploy_pgdata / journeyman-deploy_redisdata) into host bind-mount
# folders under JOURNEYMAN_BASE_DIR, so postgres/redis keep their data after we
# switch compose.deploy.yml to host mounts.
#
# Run ONCE, with the stack DOWN, before the first `npm run compose:up` on the new config:
#   docker compose -f compose.deploy.yml down   # stop (NO -v — keep the named volumes)
#   npm run migrate-db-to-host
#   npm run compose:up
#
# Safe to re-run (it overwrites the host copy). The old named volumes are left intact
# as a fallback.
set -euo pipefail
cd "$(dirname "$0")/.."

data_dir="$(grep -E '^JOURNEYMAN_BASE_DIR=' .env 2>/dev/null | head -n1 | cut -d= -f2- || true)"
data_dir="${data_dir:-./.journeyman-data}"

PG_VOL="journeyman-deploy_pgdata"
REDIS_VOL="journeyman-deploy_redisdata"

copy_volume() {
  local vol="$1" dest="$2"
  if ! docker volume inspect "$vol" >/dev/null 2>&1; then
    echo ">>> named volume '$vol' not found — skipping (fresh install? nothing to migrate)"
    return 0
  fi
  mkdir -p "$dest"
  echo ">>> copying $vol -> $dest"
  # `cp -a` preserves ownership/permissions so postgres (uid 999) can read its files.
  docker run --rm -v "${vol}:/from:ro" -v "${dest}:/to" alpine sh -c 'cp -a /from/. /to/ 2>/dev/null; true'
}

echo "Migrating DB named volumes into host folders under: ${data_dir}"
echo "Make sure the stack is DOWN first (docker compose -f compose.deploy.yml down)."
copy_volume "$PG_VOL"    "${data_dir}/postgres"
copy_volume "$REDIS_VOL" "${data_dir}/redis"
echo "✓ Done. Now run: npm run compose:up"
