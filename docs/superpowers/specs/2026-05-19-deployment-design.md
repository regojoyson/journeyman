# Deployment Design — Docker Compose & Kubernetes

**Date:** 2026-05-19
**Status:** Draft (pending review)
**Scope:** Local-first deployment of the full Journeyman stack to (a) Docker Compose and (b) generic Kubernetes.

## 1. Goals & Scope

### In scope
- Containerize the three application services: `api-server`, `worker` (orchestrator), `web` (React static).
- Containerize the migrations runner as a one-shot job.
- Reuse the existing infra services (`postgres`, `redis`, `conductor`).
- Produce a single-command `docker compose up` bring-up for the full stack.
- Produce cluster-agnostic Kubernetes manifests deployable to any Kubernetes (kind, minikube, k3s, EKS, GKE, AKS, Rancher Desktop, etc.) via Kustomize.

### Out of scope (v1)
- Production secrets management (Vault, SealedSecrets, External Secrets Operator).
- TLS / cert-manager / production ingress hardening.
- Autoscaling (HPA), PodDisruptionBudgets, NetworkPolicies.
- Image registry / CI-CD pipelines (build & push).
- Helm packaging (Kustomize only for v1).
- Multi-tenant or multi-environment overlays beyond a `local/` example and a `example-registry/` template.

## 2. Services

| Service | Type | Runtime | Notes |
|---|---|---|---|
| `postgres` | Stateful | `postgres:16-alpine` | Existing. PVC-backed in K8s. |
| `redis` | Stateless | `redis:7-alpine` | Existing. |
| `conductor` | Stateless | `orkesio/orkes-conductor-community-standalone:latest` | Existing. Single-pod even in K8s for v1. |
| `migrations` | Job (one-shot) | `journeyman/migrations:dev` | Runs `journeyman-migrate`, exits 0. |
| `api-server` | Stateless | `journeyman/api-server:dev` | Fastify REST + SSE on port 3000. |
| `worker` | Stateless | `journeyman/worker:dev` | `tsx packages/orchestrator/src/cli-worker.ts`. No service port. |
| `web` | Stateless | `journeyman/web:dev` | nginx serving React build on port 8080, proxies `/api` → `api-server:3000`. |

## 3. Image Strategy

**Single shared multi-stage `Dockerfile` at repo root**, with a `TARGET` build arg selecting the runtime stage.

Rationale: npm workspaces hoist `node_modules` and share `package-lock.json`. A shared Dockerfile installs once and produces small per-service images.

Stages:
1. `deps` — installs all workspace dependencies from `package-lock.json`.
2. `build` — runs `npm run build:web` and TypeScript compilation as needed.
3. `runtime-api` — copies built `api-server` artifacts + production deps. Entry: `npm run start:api-server`.
4. `runtime-worker` — copies orchestrator + deps. Entry: `node` against built worker (or `tsx` if not pre-compiled).
5. `runtime-web` — `nginx:alpine` with React build copied into `/usr/share/nginx/html` + custom `nginx.conf` for `/api` proxying.
6. `runtime-migrations` — minimal Node image running `journeyman-migrate`.

Build commands:
```bash
docker build -t journeyman/api-server:dev   --target runtime-api        .
docker build -t journeyman/worker:dev       --target runtime-worker     .
docker build -t journeyman/web:dev          --target runtime-web        .
docker build -t journeyman/migrations:dev   --target runtime-migrations .
```

A `Makefile` or `scripts/build-images.sh` wraps these.

## 4. Docker Compose Layout

```
journeyman/
├── docker-compose.yml          NEW: full stack (apps + infra)
├── Dockerfile                  NEW: shared multi-stage
├── .dockerignore               NEW
├── .env.example                NEW
├── infra/
│   └── docker-compose.yml      unchanged (infra-only, npm run infra:up still works)
└── deploy/k8s/                 NEW (see §5)
```

Root `docker-compose.yml`:
- Includes the three infra services (postgres, redis, conductor) — copied from `infra/docker-compose.yml` to avoid Compose `include:` complexity.
- Adds the four new services.
- `migrations` uses `restart: "no"` and is depended on via `depends_on: { condition: service_completed_successfully }`.
- `api-server` and `worker` depend on `migrations` completing and `postgres`/`redis` healthy.
- `web` exposes `8081:8080`, `api-server` exposes `3000:3000`.

Env: `.env` at repo root (gitignored), `.env.example` checked in.

## 5. Kubernetes Layout (cluster-agnostic)

Kustomize, no Helm.

```
deploy/k8s/
├── base/
│   ├── kustomization.yaml
│   ├── namespace.yaml
│   ├── postgres.yaml           StatefulSet + Service + PVC (no explicit storageClassName)
│   ├── redis.yaml              Deployment + Service
│   ├── conductor.yaml          Deployment + Service + ConfigMap
│   ├── migrations-job.yaml     Job, ttlSecondsAfterFinished set
│   ├── api-server.yaml         Deployment + Service (ClusterIP, port 3000)
│   ├── worker.yaml             Deployment (no Service)
│   ├── web.yaml                Deployment + Service (ClusterIP, port 8080)
│   ├── ingress.yaml            Ingress (ingressClassName configurable, default "nginx")
│   ├── configmap.yaml          non-secret env
│   └── secret.yaml             stub Secret (overridden by overlay)
└── overlays/
    ├── local/
    │   ├── kustomization.yaml  imagePullPolicy: IfNotPresent, replicas=1, dev secrets
    │   └── patches/            resource limits sized for a laptop
    └── example-registry/
        ├── kustomization.yaml  template for remote registry images + production-ish settings
        └── README.md           how to adapt for a real cluster
```

### Cluster-agnostic choices

- **Storage**: PVCs omit `storageClassName`, letting the cluster's default StorageClass be used. Works on every common distribution.
- **Ingress**: `networking.k8s.io/v1` Ingress with `ingressClassName` configurable via Kustomize (default `nginx`). Hostname defaults to `journeyman.local`; documented to need DNS or `/etc/hosts`.
- **Image pull**: tags `:dev` with `imagePullPolicy: IfNotPresent` in the `local/` overlay. The `example-registry/` overlay shows how to point at `ghcr.io/<org>/journeyman-*:<tag>`.
- **Loading local images** into the cluster is cluster-specific (kind: `kind load`, minikube: `minikube image load`, Rancher Desktop / k3s: images visible automatically). Documented in `deploy/k8s/README.md`, not encoded in manifests.
- **No vendor-specific resources**: no Traefik IngressRoute, no AWS LB annotations, no GKE BackendConfig.

### Migration ordering

- `migrations` is a `batch/v1 Job`.
- `api-server` and `worker` Deployments include an `initContainer` that runs `kubectl wait` against the Job — or, simpler and avoids needing in-pod kubectl: the initContainer runs a small `pg_isready` + schema-version check loop. Decision deferred to plan stage; default to the schema-version check approach.

## 6. Configuration & Secrets

Shared env contract between Compose and K8s:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string |
| `REDIS_URL` | Redis connection string |
| `CONDUCTOR_URL` | Conductor REST endpoint |
| `JWT_SECRET` | `@journeyman/identity` JWT signing key |
| `SECRETS_ENCRYPTION_KEY` | `@journeyman/secrets` AES key |
| `ANTHROPIC_API_KEY` | optional; `@journeyman/coding-cli` Claude provider |
| `LOG_LEVEL` | pino log level (default `info`) |
| `PORT` | api-server listen port (default 3000) |

- **Compose**: `.env` (gitignored), `.env.example` checked in.
- **K8s**: `ConfigMap` for non-secret values; `Secret` generated by Kustomize `secretGenerator` from a gitignored `deploy/k8s/overlays/local/.env.secret`. A `.env.secret.example` is checked in.

## 7. Networking

- **Compose**: default bridge network; service names resolve via Docker DNS. Host port bindings only on `web` (8081) and `api-server` (3000). Postgres/Redis/Conductor stay internal except for the dev convenience ports already in `infra/docker-compose.yml` (5433, 6380, 8080/5001) — kept identical for parity.
- **K8s**: ClusterIP services for everything; Ingress routes `/` → `web`, `/api` → `api-server`. Worker has no Service.
- **Web → API**: nginx in the `web` container proxies `/api/*` → `api-server:3000`. Same behavior in Compose and K8s. No build-time API URL.

## 8. Build & Deploy Scripts

```
scripts/
├── build-images.sh             docker build all four images with :dev tag
├── compose-up.sh               build images + docker compose up -d
└── k8s-up.sh                   build images + kubectl apply -k deploy/k8s/overlays/local
```

`package.json` scripts added:
- `npm run images:build`
- `npm run compose:up` / `compose:down`
- `npm run k8s:up` / `k8s:down`

## 9. Open Decisions (resolved with defaults)

| Question | Default |
|---|---|
| Web → API URL strategy | nginx proxy (not build-time env) |
| Conductor topology in K8s | single pod, same image as Compose |
| Node runtime | `node:22-alpine` |
| Dev tooling (Tilt/Skaffold) | none for v1 |
| Worker replicas | 1 in Compose; configurable in overlay (default 1) |
| Migration ordering in K8s | schema-version check in initContainer (avoids in-pod kubectl) |

## 10. Acceptance Criteria

- `docker compose up -d` from a clean checkout brings the full stack to a healthy state.
- `http://localhost:8081` serves the web UI; UI calls to `/api/*` reach `api-server`.
- `npm run k8s:up` against any Kubernetes cluster (tested on at least kind and one Rancher Desktop / k3s instance) produces the same working stack, reachable via the configured Ingress host.
- The same `Dockerfile` and the same env-var contract drive both deployments.
- No vendor-specific Kubernetes resources are present in `base/`.

## 11. Risks & Follow-ups

- **Conductor's image is large** (~1.5 GB) and slow to pull on first run — documented in README, not mitigated in v1.
- **Worker scaling** beyond 1 replica needs verification that the Conductor worker is stateless w.r.t. the local repo workspace — deferred.
- **Production hardening** (TLS, secrets management, autoscaling) is a follow-up spec.
- **CI image publishing** is a follow-up spec.
