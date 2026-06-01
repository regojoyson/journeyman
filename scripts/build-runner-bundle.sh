#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
TAG="${TAG:-dev}"
IMAGE="journeyman/runner-bundle:${TAG}"
echo ">>> Building ${IMAGE}"
docker build -f docker/runner-bundle.Dockerfile --target bundle -t "${IMAGE}" .
echo "OK: built ${IMAGE}"
