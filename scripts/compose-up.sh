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

# Build into the SAME host folder that's bind-mounted into the worker at /data/journeyman
# (JOURNEYMAN_BASE_DIR from .env), so kit.json lands at /data/journeyman/kit.
data_dir="$(grep -E '^JOURNEYMAN_BASE_DIR=' .env 2>/dev/null | head -n1 | cut -d= -f2- || true)"
data_dir="${data_dir:-./.journeyman-data}"

# Postgres + redis data live in host bind-mounts under the data dir (durable across
# `down -v`/compose:reset). Ensure the folders exist so the bind-mounts resolve.
mkdir -p "${data_dir}/postgres" "${data_dir}/redis"

# Require the registry target (replaces the old tar kit).
registry="$(grep -E '^JOURNEYMAN_REGISTRY=' .env 2>/dev/null | head -n1 | cut -d= -f2- || true)"
if [ -z "$registry" ]; then
  echo "ERROR: JOURNEYMAN_REGISTRY is not set in .env (e.g. localhost:5000)" >&2
  exit 1
fi

echo ">>> building + pushing runner kit to ${registry}"
JOURNEYMAN_BASE_DIR="${data_dir}" npm run build:kit

./scripts/build-images.sh

echo ">>> bringing up postgres + running migrations"
docker compose -f compose.deploy.yml up -d postgres
docker compose -f compose.deploy.yml run --rm migrations

echo ">>> registering kit images in the DB"
DATABASE_URL="${DATABASE_URL:-postgres://postgres:postgres@localhost:6032/journeyman}" \
  JOURNEYMAN_BASE_DIR="${data_dir}" npm run register-kit

docker compose -f compose.deploy.yml up -d
docker compose -f compose.deploy.yml ps
