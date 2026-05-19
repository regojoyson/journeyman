#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

OVERLAY="${OVERLAY:-deploy/k8s/overlays/local}"

if [ ! -f "${OVERLAY}/.env.secret" ] && [ -f "${OVERLAY}/.env.secret.example" ]; then
  echo "Seeding ${OVERLAY}/.env.secret from .env.secret.example"
  cp "${OVERLAY}/.env.secret.example" "${OVERLAY}/.env.secret"
fi

./scripts/build-images.sh

echo
echo ">>> Note: images must be visible to your cluster's container runtime."
echo "    - kind:       kind load docker-image journeyman/api-server:dev journeyman/worker:dev journeyman/web:dev journeyman/migrations:dev"
echo "    - minikube:   minikube image load journeyman/api-server:dev (repeat per image)"
echo "    - k3s / Rancher Desktop / Docker Desktop k8s: usually automatic"
echo

kubectl apply -k "${OVERLAY}"

echo
echo "Applied. Track readiness with:  kubectl -n journeyman get pods -w"
