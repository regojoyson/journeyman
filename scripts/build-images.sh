#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

TAG="${TAG:-dev}"
TARGETS=("api-server:runtime-api" "analytics:runtime-analytics" "worker:runtime-worker" "web:runtime-web" "migrations:runtime-migrations")

for spec in "${TARGETS[@]}"; do
  name="${spec%%:*}"
  target="${spec##*:}"
  echo ">>> Building journeyman/${name}:${TAG} (target=${target})"
  docker build --target "${target}" -t "journeyman/${name}:${TAG}" .
done

echo
echo "All images built:"
docker image ls 'journeyman/*' --format '{{.Repository}}:{{.Tag}}\t{{.Size}}' | sort
