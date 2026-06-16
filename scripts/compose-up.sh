#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

# Ensure workspace deps are installed/linked before the host-side kit build
# (build:kit / register-kit run here with tsx and need node_modules — incl. any
# packages added since the last pull, e.g. @journeyman/agent-protocol).
# Deterministic install for deploy; fall back to `npm install` if there's no lockfile.
echo ">>> installing workspace deps"
if [ -f package-lock.json ]; then
  npm ci --no-audit --no-fund
else
  npm install --no-audit --no-fund
fi

# Deploy uses a dedicated env file so it can't clash with the dev .env
# (e.g. the registry port: dev = localhost:5500, deploy = localhost:5000).
ENV_FILE=".env.production"

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: no ${ENV_FILE} found." >&2
  echo "  cp .env.production.example ${ENV_FILE}" >&2
  echo "  then set JWT_SECRET and JM_SECRET_ENCRYPTION_KEY (openssl rand -hex 32)" >&2
  exit 1
fi

# All compose invocations read interpolation vars (e.g. JOURNEYMAN_BASE_DIR) and
# service env from the deploy env file.
COMPOSE=(docker compose --env-file "$ENV_FILE" -f compose.deploy.yml)

# Abort if a required secret is missing or empty (no silent blank boot).
require_secret() {
  local key="$1" val
  # `|| true` so a no-match grep doesn't trip `set -e` before our own check runs.
  val="$(grep -E "^${key}=" "$ENV_FILE" 2>/dev/null | head -n1 | cut -d= -f2- || true)"
  if [ -z "$val" ]; then
    echo "ERROR: required secret '${key}' is missing or empty in ${ENV_FILE}" >&2
    echo "Generate with: openssl rand -hex 32" >&2
    exit 1
  fi
}
require_secret JWT_SECRET
require_secret JM_SECRET_ENCRYPTION_KEY

# Build into the SAME host folder that's bind-mounted into the worker at /data/journeyman
# (JOURNEYMAN_BASE_DIR from the env file), so kit.json lands at /data/journeyman/kit.
data_dir="$(grep -E '^JOURNEYMAN_BASE_DIR=' "$ENV_FILE" 2>/dev/null | head -n1 | cut -d= -f2- || true)"
data_dir="${data_dir:-./.journeyman-data}"

# Postgres + redis data live in host bind-mounts under the data dir (durable across
# `down -v`/compose:reset). Ensure the folders exist so the bind-mounts resolve.
mkdir -p "${data_dir}/postgres" "${data_dir}/redis"

# Require the registry target (replaces the old tar kit).
registry="$(grep -E '^JOURNEYMAN_REGISTRY=' "$ENV_FILE" 2>/dev/null | head -n1 | cut -d= -f2- || true)"
if [ -z "$registry" ]; then
  echo "ERROR: JOURNEYMAN_REGISTRY is not set in ${ENV_FILE} (e.g. localhost:5000)" >&2
  exit 1
fi

# When using the bundled local registry (localhost:*), bring up dind + registry
# first and wait for it — build:kit pushes here. External registries (GHCR/GitLab/…)
# are already running, so this block is skipped for them.
case "$registry" in
  localhost:*|127.0.0.1:*)
    echo ">>> starting bundled registry (${registry})"
    "${COMPOSE[@]}" up -d registry
    reg_port="${registry##*:}"
    printf ">>> waiting for registry on localhost:%s " "${reg_port}"
    for i in $(seq 1 30); do
      if curl -sf "http://localhost:${reg_port}/v2/" >/dev/null 2>&1; then echo "ok"; break; fi
      printf "."; sleep 1
      if [ "$i" -eq 30 ]; then echo; echo "ERROR: registry on localhost:${reg_port} did not become ready" >&2; exit 1; fi
    done
    ;;
esac

echo ">>> building + pushing runner kit to ${registry}"
ENV_FILE="$ENV_FILE" JOURNEYMAN_BASE_DIR="${data_dir}" npm run build:kit

./scripts/build-images.sh

echo ">>> bringing up postgres + running migrations"
"${COMPOSE[@]}" up -d postgres
"${COMPOSE[@]}" run --rm migrations

echo ">>> registering kit images in the DB"
ENV_FILE="$ENV_FILE" \
  DATABASE_URL="${DATABASE_URL:-postgres://postgres:postgres@localhost:6032/journeyman}" \
  JOURNEYMAN_BASE_DIR="${data_dir}" npm run register-kit

"${COMPOSE[@]}" up -d
"${COMPOSE[@]}" ps
