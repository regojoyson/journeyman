# Docker Compose Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `npm run compose:up` bring up the full Journeyman stack with **both** sandbox backends always available — local (in-worker) and docker (isolated containers on a built-in dind engine) — on a 6000-series host-port scheme.

**Architecture:** One `docker-compose.yml` runs 8 services. The worker gets `git` (local clones), a host bind-mount at `/data/journeyman` (workspaces + runner kit), `DOCKER_HOST=tcp://docker:2375` (the built-in dind engine), and `IS_SANDBOX=1` (so the in-process Claude engine accepts `bypassPermissions` as root). Which backend a run uses is chosen per-user in the app's Sandbox registry — the deployment never picks.

**Tech Stack:** Docker Compose, multi-stage Dockerfile (node:22-alpine), `docker:27-dind`, nginx, Fastify, bash.

**Reference spec:** [docs/superpowers/specs/2026-06-08-docker-compose-deployment-design.md](../specs/2026-06-08-docker-compose-deployment-design.md)

**Note on testing:** These are declarative config/script changes — there is no unit-test harness for compose files. "Verification" here means `docker compose config` (schema validation), targeted image builds, and an end-to-end smoke test (Task 6). Each task commits independently.

---

### Task 1: Add `git` to the worker image

The local sandbox backend clones repos by shelling out to `git` **inside the worker container** (`@journeyman/git-provider` uses `execFile("git", …)`; the worker runs the operation in-process). `node:22-alpine` ships no git, so local-mode clones fail with `git: not found`. The `runtime-worker` stage needs git + ssh.

**Files:**
- Modify: `Dockerfile` (the `runtime-worker` stage, lines 35-41)

- [ ] **Step 1: Add the apk install to the `runtime-worker` stage**

Change this block:

```dockerfile
# ---------- runtime-worker ----------
FROM node:22-alpine AS runtime-worker
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY . .
CMD ["npx", "tsx", "packages/orchestrator/src/cli-worker.ts"]
```

to:

```dockerfile
# ---------- runtime-worker ----------
FROM node:22-alpine AS runtime-worker
WORKDIR /app
ENV NODE_ENV=production
# Local-sandbox runs clone + run AI in-process here, so git + ssh must be present.
RUN apk add --no-cache git openssh-client ca-certificates
COPY --from=deps /app/node_modules ./node_modules
COPY . .
CMD ["npx", "tsx", "packages/orchestrator/src/cli-worker.ts"]
```

- [ ] **Step 2: Build the worker image to verify the stage still builds**

Run: `docker build --target runtime-worker -t journeyman/worker:dev .`
Expected: build completes; final image tagged `journeyman/worker:dev`.

- [ ] **Step 3: Verify git is present in the image**

Run: `docker run --rm --entrypoint git journeyman/worker:dev --version`
Expected: prints `git version 2.x.x`.

- [ ] **Step 4: Commit**

```bash
git add Dockerfile
git commit -m "feat(deploy): install git in the worker image for local-sandbox clones"
```

---

### Task 2: Document compose env vars in `.env.example`

Add the docker-compose-specific knobs and mark the required secrets / AI key. `ANTHROPIC_API_KEY` is required for AI steps (no `claude login` in a container). `JOURNEYMAN_DATA_DIR` is the **host** folder bind-mounted into the worker (distinct from `JOURNEYMAN_BASE_DIR`, which is the path *inside* the container — compose sets that to `/data/journeyman`).

**Files:**
- Modify: `.env.example` (AI provider section ~line 45, and add a new compose section)

- [ ] **Step 1: Update the AI provider note**

Replace:

```bash
# --- AI provider (required only if NOT logged in via `claude login`) ---
# ANTHROPIC_API_KEY=sk-ant-your_anthropic_key_here
```

with:

```bash
# --- AI provider ---
# Required for AI steps under docker-compose (no `claude login` inside a container).
ANTHROPIC_API_KEY=sk-ant-your_anthropic_key_here
```

- [ ] **Step 2: Append a docker-compose deployment section**

Add at the end of the file:

```bash
# --- Docker Compose deployment (used by `npm run compose:up`) ---
# Host folder bind-mounted into the worker at /data/journeyman (workspaces + runner kit).
# Build the kit into this SAME folder so the worker can load it into dind:
#   JOURNEYMAN_BASE_DIR="$(pwd)/.journeyman-data" npm run build:kit
# Note: under compose the worker's in-container JOURNEYMAN_BASE_DIR is forced to
# /data/journeyman; the JOURNEYMAN_BASE_DIR above only affects host-run processes
# (npm run start:worker) and build:kit output.
# JOURNEYMAN_DATA_DIR=./.journeyman-data
#
# Required secrets (compose-up.sh aborts if either is empty):
#   JWT_SECRET                 — openssl rand -hex 32
#   JM_SECRET_ENCRYPTION_KEY   — openssl rand -hex 32
```

- [ ] **Step 3: Verify the file is still valid shell-style env**

Run: `grep -E '^(ANTHROPIC_API_KEY|# JOURNEYMAN_DATA_DIR)=' .env.example`
Expected: both lines present.

- [ ] **Step 4: Commit**

```bash
git add .env.example
git commit -m "docs(deploy): document compose env vars (ANTHROPIC_API_KEY, JOURNEYMAN_DATA_DIR)"
```

---

### Task 3: Rewrite `docker-compose.yml` (dind + worker wiring + 6000 ports + healthcheck)

This is the core change. Add the `docker` (dind) service, wire the worker (bind-mount, `JOURNEYMAN_BASE_DIR`, `DOCKER_HOST`, `IS_SANDBOX`), move host ports to the 6000 series, add an `api-server` healthcheck, and make `web`/`worker` wait on `service_healthy`. Container ports and in-network URLs are unchanged.

**Files:**
- Modify: `docker-compose.yml` (full replace)

- [ ] **Step 1: Replace the whole file with the new stack**

```yaml
# Full Journeyman stack: infra + apps.
# Infra services mirror infra/docker-compose.yml so `npm run infra:up` stays valid.
# Host ports use a 6000 series to avoid clashing with the dev infra stack.
# Container ports are unchanged, so in-network URLs stay standard.

services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: journeyman
    ports: ["6032:5432"]
    volumes: ["pgdata:/var/lib/postgresql/data"]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      retries: 10

  redis:
    image: redis:7-alpine
    command: ["redis-server", "--appendonly", "yes"]
    ports: ["6079:6379"]
    volumes: ["redisdata:/data"]
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      retries: 10

  conductor:
    image: orkesio/orkes-conductor-community-standalone:latest
    ports:
      - "6008:8080"
      - "6005:5000"
    environment:
      - CONFIG_PROP=/app/config/conductor.properties
    volumes:
      - ./infra/conductor-config:/app/config
    depends_on:
      redis:
        condition: service_healthy
      postgres:
        condition: service_healthy

  # Built-in Docker engine for docker-workspace sandboxes (Docker-in-Docker).
  # Reachable only on the private compose network at tcp://docker:2375.
  docker:
    image: docker:27-dind
    privileged: true
    environment:
      DOCKER_TLS_CERTDIR: ""
    command: ["--host=tcp://0.0.0.0:2375"]
    volumes:
      - dind-storage:/var/lib/docker

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
      CONDUCTOR_BASE_URL: http://conductor:8080/api
      STORE_BACKEND: postgres
      IDENTITY_ENFORCE: "true"
      PORT: "4000"
    ports: ["6000:4000"]
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://localhost:4000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 5s
      timeout: 5s
      retries: 20
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
      CONDUCTOR_BASE_URL: http://conductor:8080/api
      STORE_BACKEND: postgres
      # In-container data root (overrides any JOURNEYMAN_BASE_DIR in .env).
      JOURNEYMAN_BASE_DIR: /data/journeyman
      # Default Docker engine for docker-workspace sandboxes (the built-in dind).
      DOCKER_HOST: tcp://docker:2375
      # Local-sandbox AI runs in-process as root here; the Claude engine refuses
      # bypassPermissions as root unless IS_SANDBOX=1.
      IS_SANDBOX: "1"
    volumes:
      - ${JOURNEYMAN_DATA_DIR:-./.journeyman-data}:/data/journeyman
    depends_on:
      migrations:
        condition: service_completed_successfully
      redis:
        condition: service_healthy
      conductor:
        condition: service_started
      docker:
        condition: service_started

  web:
    image: journeyman/web:dev
    ports: ["6080:8080"]
    depends_on:
      api-server:
        condition: service_healthy

volumes:
  pgdata:
  redisdata:
  dind-storage:
```

- [ ] **Step 2: Validate the compose schema**

Run: `docker compose config -q`
Expected: exits 0 with no output (YAML + schema valid). If it complains about a missing `.env` variable, ensure `.env` exists first.

- [ ] **Step 3: Confirm all 8 services and the 6000-series ports are present**

Run: `docker compose config --services | sort`
Expected (8 lines): `api-server  conductor  docker  migrations  postgres  redis  web  worker`

Run: `docker compose config | grep -E 'published:|target:' | head -n 20`
Expected to include published `6080, 6000, 6008, 6005, 6032, 6079` mapped to targets `8080, 4000, 8080, 5000, 5432, 6379`.

- [ ] **Step 4: Commit**

```bash
git add docker-compose.yml
git commit -m "feat(deploy): add dind engine, worker wiring, healthcheck, and 6000-series ports"
```

---

### Task 4: Harden `scripts/compose-up.sh`

Stop silently copying a blank `.env` (which boots api-server with empty secrets). Instead require `.env`, abort if `JWT_SECRET` / `JM_SECRET_ENCRYPTION_KEY` are empty, and warn (non-fatal) if the runner kit is missing.

**Files:**
- Modify: `scripts/compose-up.sh` (full replace)

- [ ] **Step 1: Replace the script**

```bash
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
  val="$(grep -E "^${key}=" .env 2>/dev/null | head -n1 | cut -d= -f2-)"
  if [ -z "$val" ]; then
    echo "ERROR: required secret '${key}' is missing or empty in .env" >&2
    echo "Generate with: openssl rand -hex 32" >&2
    exit 1
  fi
}
require_secret JWT_SECRET
require_secret JM_SECRET_ENCRYPTION_KEY

# Warn (non-fatal) if the runner kit is absent — docker-workspace sandboxes need it.
data_dir="$(grep -E '^JOURNEYMAN_DATA_DIR=' .env 2>/dev/null | head -n1 | cut -d= -f2-)"
data_dir="${data_dir:-./.journeyman-data}"
if [ ! -f "${data_dir}/kit/runner-base.tar" ]; then
  echo "NOTE: runner kit not found under ${data_dir}/kit — docker-workspace sandboxes" >&2
  echo "      will fail until you run:" >&2
  echo "        JOURNEYMAN_BASE_DIR=\"\$(pwd)/.journeyman-data\" npm run build:kit" >&2
fi

./scripts/build-images.sh
docker compose up -d
docker compose ps
```

- [ ] **Step 2: Verify it aborts on an empty secret**

Run:
```bash
printf 'JWT_SECRET=\nJM_SECRET_ENCRYPTION_KEY=x\n' > /tmp/jm-env-test && \
( cd "$(git rev-parse --show-toplevel)" && cp .env .env.bak 2>/dev/null; cp /tmp/jm-env-test .env; \
  ./scripts/compose-up.sh; echo "EXIT=$?"; mv .env.bak .env 2>/dev/null )
```
Expected: prints `ERROR: required secret 'JWT_SECRET' is missing or empty in .env` and does **not** run `build-images.sh`. (The `.env.bak` dance restores your real `.env`.)

> If you prefer not to touch your real `.env`, just eyeball the script: confirm `require_secret JWT_SECRET` runs before `./scripts/build-images.sh`.

- [ ] **Step 3: Verify it passes with both secrets set**

Run (with a valid `.env` present): `bash -n scripts/compose-up.sh && echo "syntax ok"`
Expected: `syntax ok` (and, when run for real with secrets set, it proceeds to build + up).

- [ ] **Step 4: Commit**

```bash
git add scripts/compose-up.sh
git commit -m "fix(deploy): fail fast on missing secrets and warn on missing kit in compose-up"
```

---

### Task 5: Remove the obsolete `version` key from `infra/docker-compose.yml`

The top-level `version:` key is obsolete in Compose v2 and emits a warning on every `infra:up`.

**Files:**
- Modify: `infra/docker-compose.yml` (lines 4-5)

- [ ] **Step 1: Delete the version line**

Remove these two lines (line 4 and the blank line 5):

```yaml
version: "3.9"

```

So the file goes straight from the header comment to `services:`.

- [ ] **Step 2: Validate**

Run: `docker compose -f infra/docker-compose.yml config -q`
Expected: exits 0, no `the attribute "version" is obsolete` warning.

- [ ] **Step 3: Commit**

```bash
git add infra/docker-compose.yml
git commit -m "chore(infra): drop obsolete compose version key"
```

---

### Task 6: End-to-end smoke test

Bring the whole stack up and confirm it works. This is a manual verification checklist, not an automated test.

**Files:** none (verification only)

- [ ] **Step 1: Prepare `.env`**

```bash
cp .env.example .env
printf 'JWT_SECRET=%s\nJM_SECRET_ENCRYPTION_KEY=%s\n' \
  "$(openssl rand -hex 32)" "$(openssl rand -hex 32)" >> .env
# edit .env: set ANTHROPIC_API_KEY=sk-ant-... and (optional) JOURNEYMAN_DATA_DIR
```

- [ ] **Step 2: Build the runner kit into the bind-mount folder**

Run: `JOURNEYMAN_BASE_DIR="$(pwd)/.journeyman-data" npm run build:kit`
Expected: `.journeyman-data/kit/runner-base.tar` and `runner-bundle.tar` exist.
Verify: `ls .journeyman-data/kit`

- [ ] **Step 3: Bring the stack up**

Run: `npm run compose:up`
Expected: images build, all services start, no secret-abort.

- [ ] **Step 4: Check service status**

Run: `docker compose ps`
Expected: `postgres`, `redis`, `conductor`, `docker`, `api-server`, `worker`, `web` are `Up` (api-server `healthy`); `migrations` shows `Exited (0)`.

- [ ] **Step 5: Verify the API health endpoint (port 6000)**

Run: `curl -fsS http://localhost:6000/healthz`
Expected: `{"ok":true}`

- [ ] **Step 6: Verify the worker has git**

Run: `docker compose exec -T worker git --version`
Expected: `git version 2.x.x`

- [ ] **Step 7: Verify the worker can reach the dind engine**

Run: `docker compose exec -T docker docker version --format '{{.Server.Version}}'`
Expected: prints the dind server version (e.g. `27.x.x`), proving the engine is up on `tcp://docker:2375`.

- [ ] **Step 8: Open the UI and exercise both sandbox types**

- Open `http://localhost:6080`, log in.
- **Local sandbox:** Sidebar → Sandboxes → New → type **Local** → Save.
- **Docker sandbox:** New → type **Docker** → Connection **Local socket**, socket path **blank**, image `node:22-bookworm`, Network **Full** → Save → **Test connection** → expect ✅ (the worker reaches the built-in dind via `DOCKER_HOST`).

- [ ] **Step 9: Tear down**

Run: `npm run compose:down`
Expected: stack stops; named volumes retained.

---

## Self-Review

**Spec coverage:**
- Both backends always available → Tasks 1 (git for local) + 3 (dind + DOCKER_HOST for docker). ✅
- Built-in dind over TCP → Task 3 `docker` service + `DOCKER_HOST=tcp://docker:2375`. ✅
- Host bind-mount data dir + kit → Task 3 volume + Task 6 build:kit. ✅
- 6000-series ports → Task 3. ✅
- Fail-fast secrets → Task 4. ✅
- api-server healthcheck + service_healthy deps → Task 3. ✅
- Drop `version:` → Task 5. ✅
- `.env.example` docs → Task 2. ✅
- Runner kit flow → Tasks 3 (mount) + 4 (warn) + 6 (build). ✅
- IS_SANDBOX for local in-process AI as root → Task 3 (discovered during planning; not in original spec text but required). ✅
- Docs (diagram/guide/spec) → already committed on this branch. ✅

**Placeholder scan:** No TBD/TODO; every config/script step shows full content; commands have expected output. ✅

**Type/identifier consistency:** Service names (`docker`, `worker`, `api-server`), env vars (`JOURNEYMAN_BASE_DIR`, `JOURNEYMAN_DATA_DIR`, `DOCKER_HOST`, `IS_SANDBOX`), ports, and the `/healthz` endpoint are consistent across tasks and match the codebase (`packages/api-server/src/routes/health.ts`). ✅
