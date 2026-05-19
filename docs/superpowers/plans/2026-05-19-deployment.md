# Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Containerize the Journeyman stack and provide both a Docker Compose deployment and a cluster-agnostic Kubernetes (Kustomize) deployment.

**Architecture:** A single multi-stage `Dockerfile` at repo root produces four runtime images (`api-server`, `worker`, `web`, `migrations`) via a `TARGET` build arg. A root `docker-compose.yml` runs the full stack (apps + infra). `deploy/k8s/base/` holds vendor-neutral Kustomize manifests; `deploy/k8s/overlays/local/` configures local-cluster dev (single replicas, `imagePullPolicy: IfNotPresent`, generated dev secrets); `deploy/k8s/overlays/example-registry/` is a template for clusters pulling from a remote registry.

**Tech Stack:** Docker (multi-stage, BuildKit), `node:22-alpine`, `nginx:alpine`, Docker Compose v2, Kubernetes (any conforming distribution), Kustomize.

**Spec:** [docs/superpowers/specs/2026-05-19-deployment-design.md](../specs/2026-05-19-deployment-design.md)

**Note on testing model:** This is deployment infrastructure (Dockerfiles + YAML). Classical TDD doesn't fit — there is no unit under test. Each task instead uses a *verification step*: build the artifact, run it, and check observable behavior (image builds, container starts, healthcheck passes, HTTP responds, `kubectl apply` succeeds, pods become Ready). Verification commands and expected outputs are spelled out in each task.

---

## File Map

### New files

| Path | Responsibility |
|---|---|
| `Dockerfile` | Shared multi-stage build; selects runtime stage via `--target`. |
| `.dockerignore` | Exclude `node_modules`, `.git`, build artifacts, secrets. |
| `.env.example` | Documented env var contract for Compose. |
| `docker-compose.yml` | Root Compose file — full stack (apps + infra). |
| `nginx/web.conf` | nginx config used by the `web` image: serve SPA, proxy `/api`. |
| `scripts/build-images.sh` | Build all four images with `:dev` tag. |
| `scripts/compose-up.sh` | Build images, then `docker compose up -d`. |
| `scripts/k8s-up.sh` | Build images, then `kubectl apply -k deploy/k8s/overlays/local`. |
| `deploy/k8s/README.md` | How to use the manifests + loading images into kind/minikube/etc. |
| `deploy/k8s/base/kustomization.yaml` | Base Kustomize entry. |
| `deploy/k8s/base/namespace.yaml` | `journeyman` namespace. |
| `deploy/k8s/base/configmap.yaml` | Non-secret env. |
| `deploy/k8s/base/secret.yaml` | Stub Secret (overridden by overlay). |
| `deploy/k8s/base/postgres.yaml` | StatefulSet + Service + PVC. |
| `deploy/k8s/base/redis.yaml` | Deployment + Service. |
| `deploy/k8s/base/conductor.yaml` | Deployment + Service + ConfigMap. |
| `deploy/k8s/base/migrations-job.yaml` | One-shot Job. |
| `deploy/k8s/base/api-server.yaml` | Deployment + Service. |
| `deploy/k8s/base/worker.yaml` | Deployment (no Service). |
| `deploy/k8s/base/web.yaml` | Deployment + Service. |
| `deploy/k8s/base/ingress.yaml` | Generic Ingress, `ingressClassName: nginx`. |
| `deploy/k8s/overlays/local/kustomization.yaml` | Local overlay (image tags, secret generator, replicas, pull policy). |
| `deploy/k8s/overlays/local/.env.secret.example` | Template for the gitignored secret source. |
| `deploy/k8s/overlays/example-registry/kustomization.yaml` | Remote-registry template. |
| `deploy/k8s/overlays/example-registry/README.md` | How to adapt for a real cluster. |

### Modified files

| Path | Change |
|---|---|
| `package.json` | Add `images:build`, `compose:up`, `compose:down`, `k8s:up`, `k8s:down` scripts. |
| `.gitignore` | Add `.env`, `deploy/k8s/overlays/local/.env.secret`. |
| `README.md` | Add deployment section pointing to the new docs. |

---

## Task 1: Repo-root scaffolding (`.dockerignore`, `.env.example`, `.gitignore`)

**Files:**
- Create: `.dockerignore`
- Create: `.env.example`
- Modify: `.gitignore`

- [ ] **Step 1: Write `.dockerignore`**

Create `.dockerignore`:
```
node_modules
**/node_modules
.git
.gitignore
.env
.env.*
!.env.example
**/dist
**/build
**/.next
**/.turbo
**/coverage
**/.vscode
**/.idea
**/*.log
docs/
infra/
deploy/
.claude/
.dockerignore
Dockerfile
docker-compose.yml
```

- [ ] **Step 2: Write `.env.example`**

Create `.env.example`:
```
# Database
DATABASE_URL=postgres://postgres:postgres@postgres:5432/journeyman

# Redis
REDIS_URL=redis://redis:6379

# Conductor
CONDUCTOR_URL=http://conductor:8080/api

# Identity
JWT_SECRET=change-me-in-real-deployments

# Secrets vault
SECRETS_ENCRYPTION_KEY=change-me-32-bytes-base64-or-hex

# Optional: Claude provider
ANTHROPIC_API_KEY=

# Logging
LOG_LEVEL=info

# API
PORT=3000
```

- [ ] **Step 3: Update `.gitignore`**

Append to `.gitignore` (create the file if it doesn't exist; check first with `cat .gitignore`):
```
# deployment
.env
deploy/k8s/overlays/local/.env.secret
```

- [ ] **Step 4: Verify**

Run: `ls -la .dockerignore .env.example && grep -q '^.env$' .gitignore && echo OK`
Expected: lists both files and prints `OK`.

- [ ] **Step 5: Commit**

```bash
git add .dockerignore .env.example .gitignore
git commit -m "chore: add docker/env scaffolding for deployment"
```

---

## Task 2: Multi-stage `Dockerfile`

**Files:**
- Create: `Dockerfile`

- [ ] **Step 1: Write the Dockerfile**

Create `Dockerfile` at repo root:

```dockerfile
# syntax=docker/dockerfile:1.7

# ---------- deps ----------
FROM node:22-alpine AS deps
WORKDIR /app
# Copy lockfile + every workspace package.json (preserves layout for npm)
COPY package.json package-lock.json ./
COPY packages ./packages
# Strip everything except package.json files from packages/* to maximize cache hits.
RUN find packages -mindepth 2 -maxdepth 2 ! -name 'package.json' -exec rm -rf {} + 2>/dev/null || true
RUN npm ci --include=dev

# ---------- build (web only — others run via tsx) ----------
FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build -w @journeyman/web

# ---------- runtime-api ----------
FROM node:22-alpine AS runtime-api
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY . .
EXPOSE 3000
CMD ["npm", "run", "start", "-w", "@journeyman/api-server"]

# ---------- runtime-worker ----------
FROM node:22-alpine AS runtime-worker
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY . .
CMD ["npx", "tsx", "packages/orchestrator/src/cli-worker.ts"]

# ---------- runtime-migrations ----------
FROM node:22-alpine AS runtime-migrations
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY . .
CMD ["npm", "run", "migrate", "-w", "@journeyman/migrations"]

# ---------- runtime-web ----------
FROM nginx:1.27-alpine AS runtime-web
COPY --from=build /app/packages/web/dist /usr/share/nginx/html
COPY nginx/web.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
```

- [ ] **Step 2: Verify Dockerfile syntax**

Run: `docker buildx build --progress=plain --target deps -t journeyman-deps-check . 2>&1 | tail -5`
Expected: build succeeds (last line shows `naming to docker.io/library/journeyman-deps-check`).

If it fails because `nginx/web.conf` doesn't exist yet — that's fine for Task 2; `runtime-web` stage isn't being targeted. The `deps` stage must succeed.

- [ ] **Step 3: Commit**

```bash
git add Dockerfile
git commit -m "feat: add shared multi-stage Dockerfile"
```

---

## Task 3: nginx config for the web image

**Files:**
- Create: `nginx/web.conf`

- [ ] **Step 1: Write the nginx config**

Create `nginx/web.conf`:

```nginx
server {
  listen 8080;
  server_name _;
  root /usr/share/nginx/html;
  index index.html;

  # SPA history fallback
  location / {
    try_files $uri $uri/ /index.html;
  }

  # Reverse proxy /api → api-server:3000
  location /api/ {
    proxy_pass http://api-server:3000/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    # SSE support
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 1h;
  }
}
```

- [ ] **Step 2: Verify nginx config syntactically**

Run: `docker run --rm -v "$PWD/nginx/web.conf:/etc/nginx/conf.d/default.conf:ro" nginx:1.27-alpine nginx -t 2>&1`
Expected: `the configuration file /etc/nginx/nginx.conf syntax is ok` and `configuration file /etc/nginx/nginx.conf test is successful`.

- [ ] **Step 3: Commit**

```bash
git add nginx/web.conf
git commit -m "feat: add nginx config for web image (SPA + /api proxy)"
```

---

## Task 4: Build each runtime image

**Files:** none new — verification only.

- [ ] **Step 1: Build `runtime-api`**

Run: `docker build --target runtime-api -t journeyman/api-server:dev .`
Expected: exits 0; final line `naming to docker.io/journeyman/api-server:dev`.

- [ ] **Step 2: Build `runtime-worker`**

Run: `docker build --target runtime-worker -t journeyman/worker:dev .`
Expected: exits 0.

- [ ] **Step 3: Build `runtime-migrations`**

Run: `docker build --target runtime-migrations -t journeyman/migrations:dev .`
Expected: exits 0.

- [ ] **Step 4: Build `runtime-web`**

Run: `docker build --target runtime-web -t journeyman/web:dev .`
Expected: exits 0.

- [ ] **Step 5: Verify image list**

Run: `docker image ls 'journeyman/*' --format '{{.Repository}}:{{.Tag}}' | sort`
Expected:
```
journeyman/api-server:dev
journeyman/migrations:dev
journeyman/web:dev
journeyman/worker:dev
```

- [ ] **Step 6: Smoke-test the web image standalone**

Run:
```bash
docker run --rm -d --name jm-web-smoke -p 18080:8080 journeyman/web:dev
sleep 2
curl -sf -o /dev/null -w '%{http_code}\n' http://localhost:18080/
docker rm -f jm-web-smoke
```
Expected: prints `200`.

If non-200, debug nginx config or the web build. Do not proceed until 200.

- [ ] **Step 7: Commit (no file changes — skip if nothing to commit)**

Nothing to commit at this step. Continue.

---

## Task 5: Build script

**Files:**
- Create: `scripts/build-images.sh`

- [ ] **Step 1: Write the script**

Create `scripts/build-images.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

TAG="${TAG:-dev}"
TARGETS=("api-server:runtime-api" "worker:runtime-worker" "web:runtime-web" "migrations:runtime-migrations")

for spec in "${TARGETS[@]}"; do
  name="${spec%%:*}"
  target="${spec##*:}"
  echo ">>> Building journeyman/${name}:${TAG} (target=${target})"
  docker build --target "${target}" -t "journeyman/${name}:${TAG}" .
done

echo
echo "All images built:"
docker image ls 'journeyman/*' --format '{{.Repository}}:{{.Tag}}\t{{.Size}}' | sort
```

- [ ] **Step 2: Make it executable**

Run: `chmod +x scripts/build-images.sh`

- [ ] **Step 3: Verify**

Run: `./scripts/build-images.sh`
Expected: builds all four images, exits 0, prints the four image names at the end.

- [ ] **Step 4: Commit**

```bash
git add scripts/build-images.sh
git commit -m "feat: add scripts/build-images.sh"
```

---

## Task 6: Root `docker-compose.yml`

**Files:**
- Create: `docker-compose.yml`

- [ ] **Step 1: Write the compose file**

Create `docker-compose.yml` at repo root:

```yaml
# Full Journeyman stack: infra + apps.
# Infra services mirror infra/docker-compose.yml so `npm run infra:up` stays valid.

services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: journeyman
    ports: ["5433:5432"]
    volumes: ["pgdata:/var/lib/postgresql/data"]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      retries: 10

  redis:
    image: redis:7-alpine
    ports: ["6380:6379"]
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      retries: 10

  conductor:
    image: orkesio/orkes-conductor-community-standalone:latest
    ports:
      - "8080:8080"
      - "5001:5000"
    environment:
      - CONFIG_PROP=/app/config/conductor.properties
    volumes:
      - ./infra/conductor-config:/app/config
    depends_on:
      redis:
        condition: service_healthy
      postgres:
        condition: service_healthy

  migrations:
    image: journeyman/migrations:dev
    env_file: .env
    environment:
      DATABASE_URL: postgres://postgres:postgres@postgres:5432/journeyman
    depends_on:
      postgres:
        condition: service_healthy
    restart: "no"

  api-server:
    image: journeyman/api-server:dev
    env_file: .env
    environment:
      DATABASE_URL: postgres://postgres:postgres@postgres:5432/journeyman
      REDIS_URL: redis://redis:6379
      CONDUCTOR_URL: http://conductor:8080/api
      PORT: "3000"
    ports: ["3000:3000"]
    depends_on:
      migrations:
        condition: service_completed_successfully
      redis:
        condition: service_healthy
      conductor:
        condition: service_started

  worker:
    image: journeyman/worker:dev
    env_file: .env
    environment:
      DATABASE_URL: postgres://postgres:postgres@postgres:5432/journeyman
      REDIS_URL: redis://redis:6379
      CONDUCTOR_URL: http://conductor:8080/api
    depends_on:
      migrations:
        condition: service_completed_successfully
      redis:
        condition: service_healthy
      conductor:
        condition: service_started

  web:
    image: journeyman/web:dev
    ports: ["8081:8080"]
    depends_on:
      api-server:
        condition: service_started

volumes:
  pgdata:
```

- [ ] **Step 2: Create `.env` from example (for local run)**

Run: `cp .env.example .env`
(`.env` is gitignored — do not commit it.)

- [ ] **Step 3: Validate compose file**

Run: `docker compose config --quiet`
Expected: exits 0 with no output (valid).

- [ ] **Step 4: Bring up the stack**

Run: `docker compose up -d`
Expected: starts all services; `migrations` exits 0; the rest stay Up.

- [ ] **Step 5: Wait for `web` and `api-server` to be reachable**

Run:
```bash
for i in 1 2 3 4 5 6 7 8 9 10; do
  code=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:8081/ || true)
  [ "$code" = "200" ] && echo "web OK" && break
  echo "waiting for web ($code)…"; sleep 3
done
```
Expected: prints `web OK`.

Run:
```bash
curl -s -o /dev/null -w 'api: %{http_code}\n' http://localhost:3000/healthz || \
curl -s -o /dev/null -w 'api: %{http_code}\n' http://localhost:3000/
```
Expected: any HTTP response from api-server (200/404 acceptable — proves the process is listening).

If api-server is not listening, check `docker compose logs api-server`. Common causes: missing env var, DB not migrated, port not bound. Fix root cause; do not bypass.

- [ ] **Step 6: Bring the stack down**

Run: `docker compose down`
Expected: removes containers; volume `pgdata` persists.

- [ ] **Step 7: Commit**

```bash
git add docker-compose.yml
git commit -m "feat: add root docker-compose.yml with full stack"
```

---

## Task 7: Compose lifecycle scripts + npm scripts

**Files:**
- Create: `scripts/compose-up.sh`
- Modify: `package.json`

- [ ] **Step 1: Write `scripts/compose-up.sh`**

Create `scripts/compose-up.sh`:

```bash
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
```

- [ ] **Step 2: Make it executable**

Run: `chmod +x scripts/compose-up.sh`

- [ ] **Step 3: Add npm scripts**

Edit `package.json`. In the `scripts` object, add (preserve trailing commas correctly):
```json
    "images:build": "./scripts/build-images.sh",
    "compose:up": "./scripts/compose-up.sh",
    "compose:down": "docker compose down",
```

- [ ] **Step 4: Verify the scripts run**

Run: `npm run compose:down`
Expected: exits 0 (no error even if nothing is running).

Run: `npm run images:build`
Expected: builds all four images, exits 0.

- [ ] **Step 5: Commit**

```bash
git add scripts/compose-up.sh package.json
git commit -m "feat: add compose lifecycle scripts and npm aliases"
```

---

## Task 8: Kubernetes base — namespace, ConfigMap, Secret stub

**Files:**
- Create: `deploy/k8s/base/namespace.yaml`
- Create: `deploy/k8s/base/configmap.yaml`
- Create: `deploy/k8s/base/secret.yaml`
- Create: `deploy/k8s/base/kustomization.yaml`

- [ ] **Step 1: Write `namespace.yaml`**

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: journeyman
```

- [ ] **Step 2: Write `configmap.yaml`**

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: journeyman-config
data:
  DATABASE_URL: "postgres://postgres:postgres@postgres:5432/journeyman"
  REDIS_URL: "redis://redis:6379"
  CONDUCTOR_URL: "http://conductor:8080/api"
  LOG_LEVEL: "info"
  PORT: "3000"
```

- [ ] **Step 3: Write `secret.yaml` (stub — overlay overrides this)**

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: journeyman-secrets
type: Opaque
stringData:
  JWT_SECRET: "change-me-in-real-deployments"
  SECRETS_ENCRYPTION_KEY: "change-me-32-bytes-base64-or-hex"
  ANTHROPIC_API_KEY: ""
```

- [ ] **Step 4: Write base `kustomization.yaml`**

```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization

namespace: journeyman

resources:
  - namespace.yaml
  - configmap.yaml
  - secret.yaml
  - postgres.yaml
  - redis.yaml
  - conductor.yaml
  - migrations-job.yaml
  - api-server.yaml
  - worker.yaml
  - web.yaml
  - ingress.yaml
```

(Resources referenced here are added in subsequent tasks. Kustomize will not validate until they exist; that's fine — we test the full base at Task 14.)

- [ ] **Step 5: Commit**

```bash
git add deploy/k8s/base/namespace.yaml deploy/k8s/base/configmap.yaml deploy/k8s/base/secret.yaml deploy/k8s/base/kustomization.yaml
git commit -m "feat(k8s): add base namespace, configmap, secret stub, kustomization"
```

---

## Task 9: Kubernetes base — Postgres

**Files:**
- Create: `deploy/k8s/base/postgres.yaml`

- [ ] **Step 1: Write `postgres.yaml`**

```yaml
apiVersion: v1
kind: Service
metadata:
  name: postgres
spec:
  selector:
    app: postgres
  ports:
    - port: 5432
      targetPort: 5432
---
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: postgres
spec:
  serviceName: postgres
  replicas: 1
  selector:
    matchLabels:
      app: postgres
  template:
    metadata:
      labels:
        app: postgres
    spec:
      containers:
        - name: postgres
          image: postgres:16-alpine
          env:
            - { name: POSTGRES_USER, value: postgres }
            - { name: POSTGRES_PASSWORD, value: postgres }
            - { name: POSTGRES_DB, value: journeyman }
            - { name: PGDATA, value: /var/lib/postgresql/data/pgdata }
          ports:
            - containerPort: 5432
          readinessProbe:
            exec:
              command: ["pg_isready", "-U", "postgres"]
            initialDelaySeconds: 5
            periodSeconds: 5
          volumeMounts:
            - name: pgdata
              mountPath: /var/lib/postgresql/data
  volumeClaimTemplates:
    - metadata:
        name: pgdata
      spec:
        accessModes: ["ReadWriteOnce"]
        resources:
          requests:
            storage: 2Gi
```

- [ ] **Step 2: Verify YAML parses**

Run: `kubectl apply --dry-run=client -f deploy/k8s/base/postgres.yaml`
Expected: prints `service/postgres created (dry run)` and `statefulset.apps/postgres created (dry run)`.

- [ ] **Step 3: Commit**

```bash
git add deploy/k8s/base/postgres.yaml
git commit -m "feat(k8s): add base postgres statefulset"
```

---

## Task 10: Kubernetes base — Redis

**Files:**
- Create: `deploy/k8s/base/redis.yaml`

- [ ] **Step 1: Write `redis.yaml`**

```yaml
apiVersion: v1
kind: Service
metadata:
  name: redis
spec:
  selector:
    app: redis
  ports:
    - port: 6379
      targetPort: 6379
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: redis
spec:
  replicas: 1
  selector:
    matchLabels:
      app: redis
  template:
    metadata:
      labels:
        app: redis
    spec:
      containers:
        - name: redis
          image: redis:7-alpine
          ports:
            - containerPort: 6379
          readinessProbe:
            exec:
              command: ["redis-cli", "ping"]
            initialDelaySeconds: 2
            periodSeconds: 5
```

- [ ] **Step 2: Verify**

Run: `kubectl apply --dry-run=client -f deploy/k8s/base/redis.yaml`
Expected: dry-run success for Service and Deployment.

- [ ] **Step 3: Commit**

```bash
git add deploy/k8s/base/redis.yaml
git commit -m "feat(k8s): add base redis deployment"
```

---

## Task 11: Kubernetes base — Conductor

**Files:**
- Create: `deploy/k8s/base/conductor.yaml`

- [ ] **Step 1: Write `conductor.yaml`**

For v1, we run Conductor in standalone mode without mounting the custom config map (the image has working defaults). If `infra/conductor-config/conductor.properties` is required, a follow-up task can wire it via ConfigMap.

```yaml
apiVersion: v1
kind: Service
metadata:
  name: conductor
spec:
  selector:
    app: conductor
  ports:
    - name: api
      port: 8080
      targetPort: 8080
    - name: ui
      port: 5000
      targetPort: 5000
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: conductor
spec:
  replicas: 1
  selector:
    matchLabels:
      app: conductor
  template:
    metadata:
      labels:
        app: conductor
    spec:
      containers:
        - name: conductor
          image: orkesio/orkes-conductor-community-standalone:latest
          ports:
            - containerPort: 8080
            - containerPort: 5000
          readinessProbe:
            httpGet:
              path: /
              port: 8080
            initialDelaySeconds: 30
            periodSeconds: 10
            failureThreshold: 30
```

- [ ] **Step 2: Verify**

Run: `kubectl apply --dry-run=client -f deploy/k8s/base/conductor.yaml`
Expected: dry-run success.

- [ ] **Step 3: Commit**

```bash
git add deploy/k8s/base/conductor.yaml
git commit -m "feat(k8s): add base conductor deployment"
```

---

## Task 12: Kubernetes base — Migrations Job, api-server, worker, web

**Files:**
- Create: `deploy/k8s/base/migrations-job.yaml`
- Create: `deploy/k8s/base/api-server.yaml`
- Create: `deploy/k8s/base/worker.yaml`
- Create: `deploy/k8s/base/web.yaml`

- [ ] **Step 1: Write `migrations-job.yaml`**

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: migrations
spec:
  ttlSecondsAfterFinished: 600
  backoffLimit: 3
  template:
    spec:
      restartPolicy: OnFailure
      initContainers:
        - name: wait-for-postgres
          image: postgres:16-alpine
          command:
            - sh
            - -c
            - 'until pg_isready -h postgres -U postgres; do echo "waiting for postgres"; sleep 2; done'
      containers:
        - name: migrations
          image: journeyman/migrations:dev
          envFrom:
            - configMapRef:
                name: journeyman-config
            - secretRef:
                name: journeyman-secrets
```

- [ ] **Step 2: Write `api-server.yaml`**

```yaml
apiVersion: v1
kind: Service
metadata:
  name: api-server
spec:
  selector:
    app: api-server
  ports:
    - port: 3000
      targetPort: 3000
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api-server
spec:
  replicas: 1
  selector:
    matchLabels:
      app: api-server
  template:
    metadata:
      labels:
        app: api-server
    spec:
      initContainers:
        - name: wait-for-postgres
          image: postgres:16-alpine
          command:
            - sh
            - -c
            - 'until pg_isready -h postgres -U postgres; do echo "waiting for postgres"; sleep 2; done'
      containers:
        - name: api-server
          image: journeyman/api-server:dev
          ports:
            - containerPort: 3000
          envFrom:
            - configMapRef:
                name: journeyman-config
            - secretRef:
                name: journeyman-secrets
          readinessProbe:
            tcpSocket:
              port: 3000
            initialDelaySeconds: 10
            periodSeconds: 5
```

- [ ] **Step 3: Write `worker.yaml`**

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: worker
spec:
  replicas: 1
  selector:
    matchLabels:
      app: worker
  template:
    metadata:
      labels:
        app: worker
    spec:
      initContainers:
        - name: wait-for-postgres
          image: postgres:16-alpine
          command:
            - sh
            - -c
            - 'until pg_isready -h postgres -U postgres; do echo "waiting for postgres"; sleep 2; done'
      containers:
        - name: worker
          image: journeyman/worker:dev
          envFrom:
            - configMapRef:
                name: journeyman-config
            - secretRef:
                name: journeyman-secrets
```

- [ ] **Step 4: Write `web.yaml`**

```yaml
apiVersion: v1
kind: Service
metadata:
  name: web
spec:
  selector:
    app: web
  ports:
    - port: 8080
      targetPort: 8080
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
spec:
  replicas: 1
  selector:
    matchLabels:
      app: web
  template:
    metadata:
      labels:
        app: web
    spec:
      containers:
        - name: web
          image: journeyman/web:dev
          ports:
            - containerPort: 8080
          readinessProbe:
            httpGet:
              path: /
              port: 8080
            initialDelaySeconds: 5
            periodSeconds: 5
```

- [ ] **Step 5: Verify each parses**

Run: `for f in deploy/k8s/base/migrations-job.yaml deploy/k8s/base/api-server.yaml deploy/k8s/base/worker.yaml deploy/k8s/base/web.yaml; do kubectl apply --dry-run=client -f "$f" || exit 1; done`
Expected: dry-run success for all four files.

- [ ] **Step 6: Commit**

```bash
git add deploy/k8s/base/migrations-job.yaml deploy/k8s/base/api-server.yaml deploy/k8s/base/worker.yaml deploy/k8s/base/web.yaml
git commit -m "feat(k8s): add base migrations job, api-server, worker, web"
```

---

## Task 13: Kubernetes base — Ingress

**Files:**
- Create: `deploy/k8s/base/ingress.yaml`

- [ ] **Step 1: Write `ingress.yaml`**

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: journeyman
  annotations:
    nginx.ingress.kubernetes.io/proxy-buffering: "off"
    nginx.ingress.kubernetes.io/proxy-read-timeout: "3600"
spec:
  ingressClassName: nginx
  rules:
    - host: journeyman.local
      http:
        paths:
          - path: /api
            pathType: Prefix
            backend:
              service:
                name: api-server
                port:
                  number: 3000
          - path: /
            pathType: Prefix
            backend:
              service:
                name: web
                port:
                  number: 8080
```

Notes for the implementer:
- `ingressClassName: nginx` matches the most common ingress controller. Overlays can patch this for clusters using `traefik`, `haproxy`, etc.
- The `nginx.ingress.kubernetes.io/*` annotations are ignored by other controllers and harmless if absent.

- [ ] **Step 2: Verify**

Run: `kubectl apply --dry-run=client -f deploy/k8s/base/ingress.yaml`
Expected: dry-run success.

- [ ] **Step 3: Commit**

```bash
git add deploy/k8s/base/ingress.yaml
git commit -m "feat(k8s): add base ingress"
```

---

## Task 14: Local overlay

**Files:**
- Create: `deploy/k8s/overlays/local/kustomization.yaml`
- Create: `deploy/k8s/overlays/local/.env.secret.example`

- [ ] **Step 1: Write `kustomization.yaml`**

```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization

namespace: journeyman

resources:
  - ../../base

images:
  - name: journeyman/api-server
    newTag: dev
  - name: journeyman/worker
    newTag: dev
  - name: journeyman/web
    newTag: dev
  - name: journeyman/migrations
    newTag: dev

# Override image pull policy via patch (Kustomize cannot set this through the images: field).
patches:
  - target:
      kind: Deployment
    patch: |-
      - op: add
        path: /spec/template/spec/containers/0/imagePullPolicy
        value: IfNotPresent
  - target:
      kind: StatefulSet
    patch: |-
      - op: add
        path: /spec/template/spec/containers/0/imagePullPolicy
        value: IfNotPresent
  - target:
      kind: Job
      name: migrations
    patch: |-
      - op: add
        path: /spec/template/spec/containers/0/imagePullPolicy
        value: IfNotPresent

secretGenerator:
  - name: journeyman-secrets
    behavior: replace
    envs:
      - .env.secret

generatorOptions:
  disableNameSuffixHash: true
```

- [ ] **Step 2: Write `.env.secret.example`**

```
JWT_SECRET=local-dev-jwt-secret
SECRETS_ENCRYPTION_KEY=local-dev-encryption-key-change-me
ANTHROPIC_API_KEY=
```

- [ ] **Step 3: Seed the local secret file (gitignored)**

Run: `cp deploy/k8s/overlays/local/.env.secret.example deploy/k8s/overlays/local/.env.secret`
(`.gitignore` already excludes this path from Task 1.)

- [ ] **Step 4: Render the overlay**

Run: `kubectl kustomize deploy/k8s/overlays/local > /tmp/journeyman-rendered.yaml && wc -l /tmp/journeyman-rendered.yaml`
Expected: prints a positive line count (typically 250+).

- [ ] **Step 5: Dry-run apply against the configured cluster**

Run: `kubectl apply --dry-run=client -k deploy/k8s/overlays/local`
Expected: all resources show `(dry run)` with no errors.

- [ ] **Step 6: Commit**

```bash
git add deploy/k8s/overlays/local/kustomization.yaml deploy/k8s/overlays/local/.env.secret.example
git commit -m "feat(k8s): add local overlay with image tags, pull policy, secret generator"
```

---

## Task 15: Example-registry overlay (template)

**Files:**
- Create: `deploy/k8s/overlays/example-registry/kustomization.yaml`
- Create: `deploy/k8s/overlays/example-registry/README.md`

- [ ] **Step 1: Write `kustomization.yaml`**

```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization

namespace: journeyman

resources:
  - ../../base

# Replace REGISTRY/ORG/TAG to match your registry.
images:
  - name: journeyman/api-server
    newName: ghcr.io/your-org/journeyman-api-server
    newTag: REPLACE_ME
  - name: journeyman/worker
    newName: ghcr.io/your-org/journeyman-worker
    newTag: REPLACE_ME
  - name: journeyman/web
    newName: ghcr.io/your-org/journeyman-web
    newTag: REPLACE_ME
  - name: journeyman/migrations
    newName: ghcr.io/your-org/journeyman-migrations
    newTag: REPLACE_ME

# Production-leaning replicas.
replicas:
  - name: api-server
    count: 2
  - name: worker
    count: 2
  - name: web
    count: 2
```

- [ ] **Step 2: Write `README.md`**

```markdown
# example-registry overlay

Template for clusters that pull images from a remote registry rather than
building locally.

## What to change

1. In `kustomization.yaml`, replace every `ghcr.io/your-org/journeyman-*`
   and `REPLACE_ME` with your real registry, org, and image tag.
2. If your registry is private, add an `imagePullSecrets` patch or set
   the secret on the namespace's default ServiceAccount.
3. Replace the inherited `journeyman-secrets` Secret with one sourced
   from your secrets store (Sealed Secrets, External Secrets, Vault, etc.).
4. Patch `Ingress` if your cluster's ingress class isn't `nginx`.
5. Add resource requests/limits, HPAs, and PodDisruptionBudgets as needed.

## Render

    kubectl kustomize deploy/k8s/overlays/example-registry
```

- [ ] **Step 3: Verify it renders**

Run: `kubectl kustomize deploy/k8s/overlays/example-registry > /dev/null`
Expected: exits 0 with no output (clean render).

- [ ] **Step 4: Commit**

```bash
git add deploy/k8s/overlays/example-registry
git commit -m "feat(k8s): add example-registry overlay template"
```

---

## Task 16: K8s lifecycle script + npm aliases + README

**Files:**
- Create: `scripts/k8s-up.sh`
- Create: `deploy/k8s/README.md`
- Modify: `package.json`

- [ ] **Step 1: Write `scripts/k8s-up.sh`**

```bash
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
echo "    - k3s/Rancher Desktop / Docker Desktop k8s: usually automatic"
echo

kubectl apply -k "${OVERLAY}"

echo
echo "Applied. Track readiness with:  kubectl -n journeyman get pods -w"
```

- [ ] **Step 2: Make it executable**

Run: `chmod +x scripts/k8s-up.sh`

- [ ] **Step 3: Add npm scripts**

Edit `package.json` `scripts`:
```json
    "k8s:up": "./scripts/k8s-up.sh",
    "k8s:down": "kubectl delete -k deploy/k8s/overlays/local --ignore-not-found",
```

- [ ] **Step 4: Write `deploy/k8s/README.md`**

```markdown
# Kubernetes Deployment

Cluster-agnostic Kustomize manifests for Journeyman.

## Layout

- `base/` — vendor-neutral manifests. Do not edit per-cluster details here.
- `overlays/local/` — single-replica local dev. Uses `imagePullPolicy: IfNotPresent` and a generated Secret.
- `overlays/example-registry/` — template for clusters pulling from a remote registry.

## Quick start (local cluster)

```bash
npm run images:build
# Load images into your cluster if needed (see below)
npm run k8s:up
```

## Loading locally-built images

Most local clusters can't see images from your host's Docker by default. Pick the command for your runtime:

| Cluster | Command |
|---|---|
| Docker Desktop k8s | nothing — uses host Docker |
| Rancher Desktop (containerd / dockerd) | nothing — uses host runtime |
| k3s on this host | nothing — uses host containerd |
| kind | `kind load docker-image journeyman/api-server:dev journeyman/worker:dev journeyman/web:dev journeyman/migrations:dev` |
| minikube | `minikube image load journeyman/api-server:dev` (repeat per image) |

## Hostname

The default Ingress host is `journeyman.local`. Add a hosts entry pointing it to your ingress controller's external IP/loadbalancer.

## Tearing down

```bash
npm run k8s:down
```
```

- [ ] **Step 5: Verify scripts run**

Run: `npm run k8s:down`
Expected: exits 0 (likely prints `No resources found`).

- [ ] **Step 6: Commit**

```bash
git add scripts/k8s-up.sh deploy/k8s/README.md package.json
git commit -m "feat(k8s): add lifecycle script, npm aliases, and README"
```

---

## Task 17: End-to-end verification

This is a verification-only task — no new files.

- [ ] **Step 1: Compose end-to-end**

```bash
docker compose down -v   # ensure clean slate
npm run compose:up
```
Expected: builds images, brings up the stack, all services reach a steady state.

Then:
```bash
curl -sf -o /dev/null -w 'web=%{http_code}\n' http://localhost:8081/
docker compose ps
```
Expected: `web=200`, all services Up or Exited(0) for `migrations`.

- [ ] **Step 2: Kubernetes end-to-end (on whatever local cluster the user has)**

Pre-condition: `kubectl config current-context` resolves to a working local cluster.

```bash
npm run k8s:up
kubectl -n journeyman rollout status deployment/web --timeout=180s
kubectl -n journeyman rollout status deployment/api-server --timeout=180s
kubectl -n journeyman get pods
```
Expected: rollouts succeed; pods Running.

If the cluster has no ingress controller, port-forward to verify:
```bash
kubectl -n journeyman port-forward svc/web 18080:8080 &
sleep 2
curl -sf -o /dev/null -w 'web=%{http_code}\n' http://localhost:18080/
kill %1 2>/dev/null || true
```
Expected: `web=200`.

- [ ] **Step 3: Tear down both**

```bash
npm run k8s:down
npm run compose:down
```

- [ ] **Step 4: Commit (no-op if nothing changed)**

Nothing new to commit unless logs/config tweaks were necessary.

---

## Task 18: README update

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Append a Deployment section to `README.md`**

Append:

```markdown
## Deployment

Journeyman ships two deployment paths sharing one `Dockerfile`:

- **Docker Compose** — full stack on one host. `npm run compose:up` builds the four runtime images (`api-server`, `worker`, `web`, `migrations`) and starts everything including Postgres, Redis, and Conductor. The web UI is at <http://localhost:8081>.
- **Kubernetes (any conforming cluster)** — Kustomize manifests in [`deploy/k8s/`](deploy/k8s/). `npm run k8s:up` builds images and applies the `local` overlay. See [`deploy/k8s/README.md`](deploy/k8s/README.md) for how to load locally-built images into kind/minikube and how to adapt the `example-registry/` overlay for remote registries.

Design and specification: [`docs/superpowers/specs/2026-05-19-deployment-design.md`](docs/superpowers/specs/2026-05-19-deployment-design.md).
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add deployment section to README"
```

---

## Done

The repo now supports:
- `npm run compose:up` for a full local stack via Docker Compose.
- `npm run k8s:up` for a generic Kubernetes deployment via Kustomize (local overlay).
- `deploy/k8s/overlays/example-registry/` as a starting point for any remote-registry cluster.

All four runtime images come from a single `Dockerfile`. The env-var contract is identical between Compose and K8s.
