#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo "ERROR: no .env found." >&2
  echo "  cp .env.example .env" >&2
  echo "  then set JWT_SECRET and JM_SECRET_ENCRYPTION_KEY (openssl rand -hex 32)" >&2
  exit 1
fi

# Abort if a required secret is missing or empty (no silent blank boot).
require_secret() {
  local key="$1" val
  # `|| true` so a no-match grep doesn't trip `set -e` before our own check runs.
  val="$(grep -E "^${key}=" .env 2>/dev/null | head -n1 | cut -d= -f2- || true)"
  if [ -z "$val" ]; then
    echo "ERROR: required secret '${key}' is missing or empty in .env" >&2
    echo "Generate with: openssl rand -hex 32" >&2
    exit 1
  fi
}
require_secret JWT_SECRET
require_secret JM_SECRET_ENCRYPTION_KEY

# Ensure the runner kit exists (docker-workspace sandboxes load these tars into dind).
# Build into the SAME host folder that's bind-mounted into the worker at /data/journeyman
# (JOURNEYMAN_BASE_DIR from .env), so the kit lands at /data/journeyman/kit inside the
# worker. Built once; delete the kit dir (or run `npm run build:kit`) to force a rebuild.
data_dir="$(grep -E '^JOURNEYMAN_BASE_DIR=' .env 2>/dev/null | head -n1 | cut -d= -f2- || true)"
data_dir="${data_dir:-./.journeyman-data}"

# Postgres + redis data live in host bind-mounts under the data dir (durable across
# `down -v`/compose:reset). Ensure the folders exist so the bind-mounts resolve.
mkdir -p "${data_dir}/postgres" "${data_dir}/redis"

if [ ! -f "${data_dir}/kit/runner-base.tar" ] || [ ! -f "${data_dir}/kit/runner-bundle.tar" ]; then
  echo ">>> runner kit missing — building into ${data_dir}/kit (one-time, for docker-workspace sandboxes)"
  JOURNEYMAN_BASE_DIR="${data_dir}" npm run build:kit
else
  echo ">>> runner kit present in ${data_dir}/kit — skipping build:kit"
fi

./scripts/build-images.sh
docker compose -f compose.deploy.yml up -d
docker compose -f compose.deploy.yml ps
