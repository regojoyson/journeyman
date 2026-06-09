# Replace DinD with a Docker Socket Proxy — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the privileged DinD service with a `socat` Docker-socket proxy so sandboxes run as siblings on the host's Docker daemon (restoring `host.docker.internal`), across `compose.deploy.yml`, `infra/compose.dev.yml`, the `compose-up.sh` script, and the docs.

**Architecture:** A `socat` sidecar bridges the host `/var/run/docker.sock` to TCP `2375`; the worker's TCP-only Docker client points at it (`tcp://dockerproxy:2375` in compose, `tcp://localhost:2375` for host-dev). DinD and its `privileged`/`dind-storage` go away; the bundled `registry` becomes a normal published service (`5500:5000`).

**Tech Stack:** Docker Compose, `alpine/socat`, `registry:2`, Bash, Markdown. **No application code.**

> **Execution preference (this run):** no per-step commits/verification — make all edits, then run `docker compose config` on both files once and make a single commit at the end.

---

## Reference facts (verified)

- `compose.deploy.yml` services today: `postgres, redis, conductor, docker (docker:27-dind, privileged, publishes 5500:5500, dind-storage volume), registry (network_mode: service:docker, REGISTRY_HTTP_ADDR 0.0.0.0:5500, depends_on docker), migrations, api-server, worker (depends_on … docker, registry), web`. Volumes: `dind-storage`, `registry-storage`.
- `infra/compose.dev.yml` services: `postgres, redis, conductor, registry (registry:2, ports 5500:5000)`. Volumes: `pgdata, registry-data`. Worker runs on the **host**.
- `scripts/compose-up.sh` brings the bundled registry up with **`"${COMPOSE[@]}" up -d docker registry`** before `build:kit` push, then later `up -d` for the rest. Removing the `docker` service breaks this line.
- `compose:reset` = `down -v` (removes named volumes; no explicit `dind-storage` reference — no script change needed for the volume removal).
- `docs/deploy-docker-compose.md` references DinD in: the service table (line ~27), the "two paths" bullet (~40–42), the registry section (~102–104), create-sandbox daemon host (~140), operations comment (~159), troubleshooting (~187), security notes (~194–198). `docs/setup.md` has **no** DinD/sandbox section, so host-dev guidance goes into `deploy-docker-compose.md`.
- `docker compose version` = v5.0.1 (so `docker compose -f <file> config` validates YAML).

## File structure

- Modify: `compose.deploy.yml`
- Modify: `infra/compose.dev.yml`
- Modify: `scripts/compose-up.sh`
- Modify: `docs/deploy-docker-compose.md`

---

## Task 1: `compose.deploy.yml` — DinD → socat proxy + standalone registry

**Files:** Modify `compose.deploy.yml`

- [ ] **Step 1: Replace the `docker` (DinD) service with `dockerproxy`**

Replace this block:
```yaml
  # Built-in Docker engine for docker-workspace sandboxes (Docker-in-Docker).
  # Reachable only on the private compose network at tcp://docker:2375.
  docker:
    image: docker:27-dind
    privileged: true
    environment:
      DOCKER_TLS_CERTDIR: ""
    command: ["--host=tcp://0.0.0.0:2375"]
    # Publish the bundled registry (which shares this container's network namespace)
    # on host 5500. Port MUST match on both sides (5500:5500): the kit image refs embed
    # `localhost:5500`, and that literal must resolve to the same registry from the host
    # (build:kit push) and from inside dind (pull). 5500 (not 5000) avoids the macOS
    # AirPlay Receiver clash. Docker treats localhost registries as insecure — no TLS.
    ports: ["5500:5500"]
    volumes:
      - dind-storage:/var/lib/docker
```
with:
```yaml
  # Bridges the host Docker socket to TCP so the worker (a TCP-only Docker client) drives
  # the host's OWN Docker daemon — sandboxes run as siblings, not nested (no DinD, no
  # privileged). Reachable ONLY on the private compose network at tcp://dockerproxy:2375.
  # SECURITY: exposes the full, unauthenticated Docker API (root-equivalent on the host).
  # Do NOT publish this port. Local/trusted deployments only.
  dockerproxy:
    image: alpine/socat
    command: ["tcp-listen:2375,fork,reuseaddr", "unix-connect:/var/run/docker.sock"]
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    restart: unless-stopped
```

- [ ] **Step 2: Make `registry` standalone + published**

Replace this block:
```yaml
  # Bundled local registry for the runner kit (zero-config default for
  # JOURNEYMAN_REGISTRY=localhost:5500). External registries (GHCR/GitLab/ECR) are
  # used by simply pointing JOURNEYMAN_REGISTRY elsewhere and ignoring this service.
  # Shares dind's network namespace so `localhost:5500` means the same thing to the
  # host (via the published port above) and to dind (when it pulls kit images).
  registry:
    image: registry:2
    network_mode: "service:docker"
    # Listen on 5500 inside dind's shared netns (matches the published 5500:5500 above
    # and the localhost:5500 the kit refs embed).
    environment:
      REGISTRY_HTTP_ADDR: 0.0.0.0:5500
    volumes:
      - registry-storage:/var/lib/registry
    depends_on:
      docker:
        condition: service_started
```
with:
```yaml
  # Bundled local registry for the runner kit (zero-config default for
  # JOURNEYMAN_REGISTRY=localhost:5500). Standalone + published: `localhost:5500` resolves
  # to it from the host (build:kit push) and from the host Docker daemon (pull, when
  # provisioning sandboxes). External registries (GHCR/GitLab/ECR): point JOURNEYMAN_REGISTRY
  # elsewhere and ignore this service. 5500 (not 5000) avoids the macOS AirPlay clash.
  registry:
    image: registry:2
    ports: ["5500:5000"]
    volumes:
      - registry-storage:/var/lib/registry
```

- [ ] **Step 3: Repoint the worker's `depends_on`**

Replace:
```yaml
    depends_on:
      migrations:
        condition: service_completed_successfully
      redis:
        condition: service_healthy
      conductor:
        condition: service_started
      docker:
        condition: service_started
      registry:
        condition: service_started
```
with:
```yaml
    depends_on:
      migrations:
        condition: service_completed_successfully
      redis:
        condition: service_healthy
      conductor:
        condition: service_started
      dockerproxy:
        condition: service_started
      registry:
        condition: service_started
```

- [ ] **Step 4: Drop the `dind-storage` volume**

Replace:
```yaml
volumes:
  # postgres + redis data are host bind-mounts under JOURNEYMAN_BASE_DIR (see the
  # postgres/redis services) — durable across `down -v`/compose:reset. Only dind-storage
  # is a project-managed named volume here (safe to wipe/rebuild).
  dind-storage:
  # Bundled local registry storage (runner kit images). Safe to wipe/rebuild.
  registry-storage:
```
with:
```yaml
volumes:
  # postgres + redis data are host bind-mounts under JOURNEYMAN_BASE_DIR (see the
  # postgres/redis services) — durable across `down -v`/compose:reset.
  # Bundled local registry storage (runner kit images). Safe to wipe/rebuild.
  registry-storage:
```

---

## Task 2: `infra/compose.dev.yml` — add a host-published `dockerproxy`

**Files:** Modify `infra/compose.dev.yml`

- [ ] **Step 1: Add the proxy service**

Insert this service after the `registry` service (before the top-level `volumes:` key):
```yaml
  # Bridges the host Docker socket to TCP so a host-run worker (npm run start:worker) can
  # drive the host Docker daemon for docker-backend sandboxes. Set the sandbox's daemon
  # host to tcp://localhost:2375. Bound to loopback only.
  # SECURITY: unauthenticated Docker API (root-equivalent on the host) — never expose
  # beyond 127.0.0.1.
  dockerproxy:
    image: alpine/socat
    command: ["tcp-listen:2375,fork,reuseaddr", "unix-connect:/var/run/docker.sock"]
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    ports: ["127.0.0.1:2375:2375"]
    restart: unless-stopped
```

---

## Task 3: `scripts/compose-up.sh` — stop starting the removed `docker` service

**Files:** Modify `scripts/compose-up.sh`

- [ ] **Step 1: Start only the registry before the kit push**

Replace:
```bash
    echo ">>> starting bundled registry (${registry})"
    "${COMPOSE[@]}" up -d docker registry
```
with:
```bash
    echo ">>> starting bundled registry (${registry})"
    "${COMPOSE[@]}" up -d registry
```

(The later `"${COMPOSE[@]}" up -d` brings up `dockerproxy` and the rest. The kit push targets `localhost:5500` on the host, which the standalone published registry serves.)

---

## Task 4: `docs/deploy-docker-compose.md` — update DinD references

**Files:** Modify `docs/deploy-docker-compose.md`

- [ ] **Step 1: Service table row**

Replace:
```
| `docker` | `docker:27-dind` | built-in Docker engine for docker-workspace jobs | — (internal `2375`) | 2375 |
```
with:
```
| `dockerproxy` | `alpine/socat` | bridges the host Docker socket to TCP for the worker | — (internal `2375`) | 2375 |
```

- [ ] **Step 2: "Two paths" Docker-sandbox bullet**

Replace:
```
- **Docker sandbox** — the worker asks the built-in `docker` (dind) engine over
  `tcp://docker:2375` to spin up a fresh, isolated container per job, then destroy it.
  The runner image (the "kit") is pulled into dind by digest from the registry on first use.
```
with:
```
- **Docker sandbox** — the worker asks the host's Docker daemon (reached via the
  `dockerproxy` socat sidecar at `tcp://dockerproxy:2375`) to spin up a fresh, isolated
  container per job, then destroy it. The container is a **sibling** on the host daemon, so
  `host.docker.internal` reaches host-local services (e.g. a local LM Studio/Ollama server)
  from inside it. The runner image (the "kit") is pulled by digest from the registry on first use.
```

- [ ] **Step 3: Registry section (dind netns → standalone)**

Replace:
```
it, then pushes — nothing to set up. The registry shares the dind network namespace
so `localhost:5500` resolves to the same registry from the host (push) and from dind
(pull). Its storage lives in the `registry-storage` volume.
```
with:
```
it, then pushes — nothing to set up. The registry is a standalone published service, so
`localhost:5500` resolves to it from the host (push) and from the host Docker daemon
(pull, when provisioning sandboxes). Its storage lives in the `registry-storage` volume.
```

- [ ] **Step 4: Create-sandbox daemon host + host-dev note**

Replace:
```
2. Daemon host = `tcp://docker:2375` (the built-in dind).
```
with:
```
2. Daemon host = `tcp://dockerproxy:2375` (the socat proxy to the host Docker daemon).
```

Then, immediately after the block ending:
```
The worker connects straight to whatever host you set. A Docker sandbox always needs an explicit
daemon host — there is no local-socket option or fallback.
```
add:
```

**Local development (host-run worker).** When you run the worker on your host with
`npm run start:worker` (deps from `infra/compose.dev.yml`), the dev stack publishes a
`dockerproxy` on `127.0.0.1:2375`. Set the sandbox's Daemon host to `tcp://localhost:2375`.
Sandboxes still run as siblings on your host Docker daemon, so `host.docker.internal`
reaches host-local model servers (use Base URL `http://host.docker.internal:1234/v1`).
```

- [ ] **Step 5: Operations reset comment**

Replace:
```
npm run compose:reset    # stop + remove dind-storage; DB data is PRESERVED
```
with:
```
npm run compose:reset    # stop + remove named volumes (registry); DB data is PRESERVED
```

- [ ] **Step 6: Troubleshooting row**

Replace:
```
| Docker-sandbox "Test connection" fails | dind not up, or kit missing | check `docker compose -f compose.deploy.yml ps` shows `docker`; if the kit is stale, `rm -rf .journeyman-data/kit && npm run compose:up` rebuilds it |
```
with:
```
| Docker-sandbox "Test connection" fails | dockerproxy not up, or kit missing | check `docker compose -f compose.deploy.yml ps` shows `dockerproxy`; if the kit is stale, `rm -rf .journeyman-data/kit && npm run compose:up` rebuilds it |
| Sandbox can't reach a host-local model | wrong address from a sibling container | use `http://host.docker.internal:1234/v1` (not `localhost`); confirm with `docker run --rm curlimages/curl -s http://host.docker.internal:1234/v1/models` |
```

- [ ] **Step 7: Security notes**

Replace:
```
- The `docker` (dind) service runs **privileged** — it needs kernel access to create
  containers. It is reachable only on the private compose network. Acceptable for a
  self-hosted single-host deployment; review before exposing the host beyond localhost.
- The built-in engine listens on **plain TCP (no TLS)** inside the compose network only.
  For remote engines over the internet, use TLS certs on the sandbox's connection config.
```
with:
```
- The `dockerproxy` (socat) service exposes the host's **full, unauthenticated Docker API**
  over plain TCP — **root-equivalent on the host** for anything that can reach it. It is
  bound to the **private compose network only and never published**. Acceptable for a
  self-hosted single-host deployment; do not expose that port beyond the host.
- Sandboxes run as **siblings** on the host Docker daemon (not nested), so they share the
  host's images/volumes. For stronger isolation in untrusted/multi-tenant setups, point the
  sandbox's daemon host at a dedicated/remote daemon (TLS certs via the connection config).
```

---

## Task 5: Verify + single commit (per execution preference)

**Files:** none (verification only).

- [ ] **Step 1: Validate both compose files parse**

Run:
```bash
docker compose -f compose.deploy.yml --env-file .env.production config >/dev/null && echo "deploy OK"
docker compose -f infra/compose.dev.yml config >/dev/null && echo "dev OK"
```
Expected: `deploy OK` and `dev OK`. (If `.env.production` is absent on this machine, run the deploy check with a throwaway env: `--env-file /dev/null` may warn on unset interpolation vars — that's fine; the goal is YAML/schema validity, confirmed by "OK" with no parse error.)

- [ ] **Step 2: Confirm no lingering `docker:`/dind references in the changed files**

Run:
```bash
grep -nE "docker:27-dind|dind-storage|tcp://docker:2375|network_mode|privileged" compose.deploy.yml infra/compose.dev.yml scripts/compose-up.sh || echo "clean"
```
Expected: `clean` (no matches).

- [ ] **Step 3: Single commit**

```bash
git add compose.deploy.yml infra/compose.dev.yml scripts/compose-up.sh docs/deploy-docker-compose.md docs/superpowers
git commit -m "feat(compose): replace DinD with a socat Docker-socket proxy

Sandboxes now run as siblings on the host Docker daemon (no privileged DinD), so
host.docker.internal reaches host-local services (e.g. LM Studio/Ollama). Registry is
standalone + published (5500:5000); compose-up.sh starts only the registry pre-push;
docs updated (topology, daemon host, host-dev, security caveats).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-review notes (spec coverage)

- compose.deploy.yml (remove DinD/privileged/dind-storage, add dockerproxy, standalone registry, worker deps) → Task 1. infra/compose.dev.yml host-published proxy → Task 2. **compose-up.sh fix (not in the spec but required — it starts the removed `docker` service)** → Task 3. Docs (topology, registry, daemon host, host-dev, operations, troubleshooting incl. host.docker.internal, security) → Task 4. Verification (`docker compose config` both) + single commit → Task 5.
- **Runtime repoint** (sandbox `config.connection.host` → `tcp://dockerproxy:2375` / `tcp://localhost:2375`, and the LM Studio Base URL → `host.docker.internal:1234/v1`) is a **user action in the running app/DB, not a file edit** — documented in Task 4's doc updates; there is no code/file to change for it.
- No placeholders; every step is a concrete before→after. No app code, so no typecheck/tests — verification is `docker compose config` + a grep guard.
- **Deviation from spec:** the spec named `docs/setup.md`, but it has no DinD/sandbox section; host-dev guidance is added to `docs/deploy-docker-compose.md` (Task 4 Step 4) where the infra flow is actually documented.
