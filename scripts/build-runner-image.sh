#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

TAG="${TAG:-dev}"
IMAGE="journeyman/runner-base:${TAG}"

echo ">>> Building ${IMAGE}"
docker build -f docker/runner-base.Dockerfile -t "${IMAGE}" .

echo ">>> Smoke test (--selftest, no API key needed)"
OUT="$(docker run --rm "${IMAGE}" --selftest)"
echo "runner output: ${OUT}"
case "${OUT}" in
  *'"ok":true'*'"selftest":true'*) echo "OK: runner-base image works" ;;
  *) echo "FAIL: unexpected selftest output" >&2; exit 1 ;;
esac
