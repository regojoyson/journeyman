#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo "No .env found — copying from .env.example"
  cp .env.example .env
fi

./scripts/build-images.sh
docker compose up -d
docker compose ps
