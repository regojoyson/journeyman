# Docker Compose Deployment — Design

**Date:** 2026-06-08
**Status:** Approved (design) — implementation plan pending

## Goal

Deploy the full Journeyman stack with a single `docker compose` command, with **both**
workspace backends always available. The deployment never picks a backend; which one a run
uses is chosen per-user/org through the Sandbox registry in the app.

## Principles

1. **Both backends always on.** `local` and `docker` sandboxes both work out of the box.
2. **Selection is data-driven**, from `jm_sandboxes` rows users create in the UI — not a
   deployment-level switch.
3. **Custom Docker hosts are first-class.** A docker sandbox may target any engine (any
   IP / TLS) via its own `connection` config; a built-in engine is only the default.

## Architecture

See [docs/diagrams/docker-compose-deployment.svg](../../diagrams/docker-compose-deployment.svg)
and the operator guide [docs/deploy-docker-compose.md](../../deploy-docker-compose.md).

### Services (8 containers)

`web`, `api-server`, `worker`, **`docker` (dind, new)**, `conductor`, `postgres`, `redis`,
`migrations` (one-shot).

### Worker's two execution paths

- **Local sandbox** → worker clones + runs the AI **in-process** in its own container,
  writing to `/data/journeyman/workspaces/<runId>`. Requires `git` in the worker image
  (clone path shells out to `git` via `execFile` in `@journeyman/git-provider`).
- **Docker sandbox** → worker drives an engine over `DOCKER_HOST` to create an isolated
  per-job container. A blank "Local socket" connection falls back to the worker's
  `DOCKER_HOST` (the built-in dind); a "Remote daemon" connection targets a custom host.

## Decisions

| Decision | Choice |
|---|---|
| Built-in Docker engine? | **Yes** — ship `docker:27-dind` as a default. |
| Connection transport | **TCP** — worker `DOCKER_HOST=tcp://docker:2375`; blank socket → dind. |
| Worker data dir | **Host bind-mount** (`${JOURNEYMAN_DATA_DIR:-./.journeyman-data}` → `/data/journeyman`) so the kit tars (produced on the host by `build:kit`) are readable by the worker. |
| dind storage | named volume `dind-storage` → `/var/lib/docker`. |
| Secrets | **Fail fast** if `JWT_SECRET` / `JM_SECRET_ENCRYPTION_KEY` are missing; never copy a blank `.env`. |
| Custom remote hosts | Supported per-sandbox (`Remote daemon` → any `tcp://ip:port`, optional TLS certDir). |

## Host ports (6000 series)

Host-exposed ports use a 6000 series so the full-stack deployment doesn't clash with the dev
infra stack (`infra/docker-compose.yml`) or common local services. **Container ports are
unchanged**, so in-network service URLs (`postgres:5432`, `api-server:4000`, `conductor:8080`)
stay the same — only the `ports:` host side moves.

| Service | Host | Container |
|---|---|---|
| web | 6080 | 8080 |
| api-server | 6000 | 4000 |
| conductor (API) | 6008 | 8080 |
| conductor (UI) | 6005 | 5000 |
| postgres | 6032 | 5432 |
| redis | 6079 | 6379 |
| docker (dind) | not exposed | 2375 (internal) |

## Changes

| File | Change |
|---|---|
| `Dockerfile` | `runtime-worker` target: `RUN apk add --no-cache git openssh-client`. |
| `docker-compose.yml` | Add `docker` (dind) service + `dind-storage` volume. Worker: bind-mount `/data/journeyman`, `JOURNEYMAN_BASE_DIR=/data/journeyman`, `DOCKER_HOST=tcp://docker:2375`, `ANTHROPIC_API_KEY`. Add `api-server` healthcheck; make `web`/`worker` depend on `api-server: service_healthy`. |
| `.env.example` | Document `ANTHROPIC_API_KEY` (uncomment), `JOURNEYMAN_DATA_DIR`, and that `JWT_SECRET` / `JM_SECRET_ENCRYPTION_KEY` are required. |
| `scripts/compose-up.sh` | Fail fast on missing required secrets (no silent blank-`.env` copy); add secret-generation helper; remind to run `build:kit` for docker workspaces. |
| `infra/docker-compose.yml` | Remove obsolete `version: "3.9"` key. |
| `docs/deploy-docker-compose.md` | New operator guide (done). |
| `docs/diagrams/docker-compose-deployment.svg` | New diagram (done). |

### dind service (sketch)

```yaml
  docker:
    image: docker:27-dind
    privileged: true
    environment:
      DOCKER_TLS_CERTDIR: ""
    command: ["--host=tcp://0.0.0.0:2375"]
    volumes:
      - dind-storage:/var/lib/docker
```

### worker additions (sketch)

```yaml
  worker:
    environment:
      DOCKER_HOST: tcp://docker:2375
      JOURNEYMAN_BASE_DIR: /data/journeyman
      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY}
    volumes:
      - ${JOURNEYMAN_DATA_DIR:-./.journeyman-data}:/data/journeyman
    depends_on:
      docker:
        condition: service_started
```

## Runner kit

The kit is **two prebuilt `docker save` tars** produced by `npm run build:kit`
([scripts/build-kit.mjs](../../../scripts/build-kit.mjs)), not a service:

| Tar | Image | Used for |
|---|---|---|
| `runner-base.tar` | `journeyman/runner-base:dev` | default box — docker sandboxes with no custom image |
| `runner-bundle.tar` | `journeyman/runner-bundle:dev` | grafted into custom user images via `COPY --from=<bundle>` |

Consumption (no registry, no build-at-runtime):

- **Default box** → `provisionDocker` calls `ensureKitImage(client, RUNNER_IMAGE, RUNNER_BASE_TAR)`
  ([cli-worker.ts](../../../packages/orchestrator/src/cli-worker.ts)): loads the tar onto the
  target daemon if absent ([ensure-kit.ts](../../../packages/sandbox/src/backends/docker/ensure-kit.ts)).
- **Custom image** → the worker build loop `ensureKit`s the bundle, then builds the wrapped
  image on dind ([build-loop.ts](../../../packages/sandbox/src/build/build-loop.ts)).

Both read the tar from the worker's filesystem (`$JOURNEYMAN_BASE_DIR/kit/`) and stream it into
the daemon (dind) over the Docker connection.

**Deployment requirements (covered by the bind-mount + env):**

1. Build on the host: `JOURNEYMAN_BASE_DIR=$(pwd)/.journeyman-data npm run build:kit` → writes
   **both** tars into `.journeyman-data/kit/`.
2. Worker bind-mounts `.journeyman-data → /data/journeyman` with `JOURNEYMAN_BASE_DIR=/data/journeyman`,
   so `kitDir` resolves and both tars are readable.
3. dind starts empty; the worker loads tars into it lazily on first use. Missing kit → a clear
   *"run npm run build:kit"* error.

**Operational:** rebuild the kit whenever `@journeyman/agent-runtime` changes — the tars embed
the bundled runner. The kit must match the daemon architecture (build on the same host arch as dind).

## Open item to verify during implementation

- **Docker-mode clone target.** Confirm the `clone-repos` step in docker mode writes into
  the sandbox container's volume (visible to the AI running inside dind), not the worker's
  filesystem. If it currently clones to the worker FS, the docker path needs the clone to
  run via the execution environment instead. Verify before/while implementing.

## Out of scope

- Kubernetes (separate `deploy/k8s` path already exists).
- TLS for the built-in dind (plain TCP on the private network is accepted here).
- Registry-based image distribution (kit stays tar-based).
