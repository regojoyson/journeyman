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

# Warn (non-fatal) if the runner kit is absent — docker-workspace sandboxes need it.
data_dir="$(grep -E '^JOURNEYMAN_DATA_DIR=' .env 2>/dev/null | head -n1 | cut -d= -f2- || true)"
data_dir="${data_dir:-./.journeyman-data}"
if [ ! -f "${data_dir}/kit/runner-base.tar" ]; then
  echo "NOTE: runner kit not found under ${data_dir}/kit — docker-workspace sandboxes" >&2
  echo "      will fail until you run:" >&2
  echo "        JOURNEYMAN_BASE_DIR=\"\$(pwd)/.journeyman-data\" npm run build:kit" >&2
fi

./scripts/build-images.sh
docker compose up -d
docker compose ps
