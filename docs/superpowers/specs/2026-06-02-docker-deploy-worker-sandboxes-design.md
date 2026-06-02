# Docker Deployment — Worker Sandbox Bundling Design

**Date:** 2026-06-02
**Status:** Proposed

## Problem

Deploying Journeyman with `npm run compose:up` brings up a working stack — Postgres, Redis,
Conductor, migrations, api-server, worker, and web — and the four application images are fully
wired and bundled. That part is complete.

What is **not** complete is the worker's Docker-sandbox capability. A worker can run a coding job
in one of two ways, decided per worker by its record (`resolveWorker` →
[`provisionDocker`](../../../packages/orchestrator/src/cli-worker.ts) / `provisionLocal`):

- **`local`** — runs the coding operation in-process, inside the worker itself.
- **`docker`** — provisions a fresh per-run container (built from the `docker/` Dockerfiles) and
  runs the operation inside it.

Today the `docker` path works only because the worker is run **on the host**
(`npm run start:worker`), where it inherits the host's Docker daemon. Once the worker runs *inside*
a container (which is what deploying does), the `docker` path silently breaks. We want the deployed
worker to behave exactly like the host worker: `local` workers run in-process, `docker` workers run
in sandboxes, with the choice driven entirely by the worker record.

## Gaps (verified)

| # | Gap | Evidence | Severity |
|---|-----|----------|----------|
| 1 | The runner sandbox images are never built by the deploy path. [`build-images.sh`](../../../scripts/build-images.sh) builds only the 4 app images; `runner-base` / `runner-bundle` are built by separate scripts ([`build-runner-image.sh`](../../../scripts/build-runner-image.sh), [`build-runner-bundle.sh`](../../../scripts/build-runner-bundle.sh)) that are **not** in `package.json` and **not** called by `compose:up` or `k8s:up`. The worker's defaults expect `journeyman/runner-base:dev` / `journeyman/runner-bundle:dev` ([`cli-worker.ts:73`](../../../packages/orchestrator/src/cli-worker.ts)). | A clean `compose:up` followed by a `docker`-worker run fails: image not found. | 🔴 |
| 2 | The containerized worker has no access to a Docker daemon. The `worker` service in [`docker-compose.yml`](../../../docker-compose.yml) mounts no Docker socket, sets no `DOCKER_HOST`, and is not privileged (same for [`deploy/k8s/base/worker.yaml`](../../../deploy/k8s/base/worker.yaml)). | Even with images present, the worker cannot create sibling containers/volumes; `docker` workers are inert in the deployed stack. | 🔴 |
| 3 | `ANTHROPIC_API_KEY` is commented out in [`.env.example`](../../../.env.example). | Every AI step (analyze/plan/implement/custom-prompt) fails at runtime if unset and there is no `claude login` inside a container. | 🟡 (config, not build) |

`makeDockerClient` ([`docker-client.ts:175`](../../../packages/workers/src/backends/docker/docker-client.ts))
already supports both connection kinds the worker record can carry — `local` (default socket /
`socketPath` / `DOCKER_HOST`) and `remote` (`tcp://host:port` + optional TLS). No application-code
change is required; the gaps are entirely in the deployment/build wiring.

## Design

### Fix 1 — Build runner images as part of the deploy path

Extend the build scripts so the two runner images are produced alongside the four app images, and
expose them as npm scripts.

- Add `images:build:runner` to `package.json` that runs `build-runner-image.sh` **and**
  `build-runner-bundle.sh` (both already exist and self-test).
- Have [`build-images.sh`](../../../scripts/build-images.sh) (or a new `images:build:all`) also
  invoke the runner builds, so `compose:up` and `k8s:up` produce them. Keep a way to build *just*
  the app images for callers who don't need the sandbox feature.
- Result: after `compose:up`, `journeyman/runner-base:dev` and `journeyman/runner-bundle:dev` exist
  on the host daemon — the same daemon the worker will use in Fix 2.

### Fix 2 — Give the deployed worker a Docker daemon

**Compose (recommended: Approach A — mount the host socket).** Add the host Docker socket to the
`worker` service in [`docker-compose.yml`](../../../docker-compose.yml):

```yaml
  worker:
    # …existing…
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
```

This faithfully reproduces the host-worker behavior: a `docker`-type worker with
`connection: { kind: "local" }` provisions sibling runner containers on the host daemon (where Fix 1
placed the images), exec's into them, and tears them down. `local`-type workers are unaffected.

- The runner container, not the worker container, mounts the per-run volume `jm-run-<runId>` at
  `/workspace`; no filesystem sharing between worker and runner is required — the worker only drives
  the daemon over the socket.
- Note the trade-off in the docs: mounting the Docker socket grants the worker root-equivalent
  control of the host daemon. Acceptable for single-host dev/self-hosted deployments; not a
  hardened multi-tenant posture.

**Kubernetes (Approach B — remote daemon per worker, documentation-only here).** Socket-mounting is
an anti-pattern in k8s. Instead, `docker`-type workers in a cluster should carry
`connection: { kind: "remote", host: "tcp://…", certDir }` pointing at a dedicated Docker/build
host, with the runner images present on that host. This needs no manifest change now — it is a
worker-record configuration and is captured here as the documented production path. (A DinD sidecar
is a possible future alternative; out of scope.)

### Fix 3 — API key guidance

Uncomment `ANTHROPIC_API_KEY` in [`.env.example`](../../../.env.example) (or add a clear
"required for AI steps" note) and reference it from the README deployment section so a fresh deploy
doesn't fail its first AI step.

## Non-goals

- No application/runtime code changes — provisioning, connection handling, and per-worker branching
  already work.
- No DinD implementation for compose (Approach C).
- No k8s manifest changes (remote-connection path is config + docs only).
- No change to how `local` workers run.
- The runner-image *coverage* matrix (MCP runtimes, musl/alpine custom bases, Gemini/Codex CLIs) is
  explicitly out of scope.

## Files affected

| File | Change |
|------|--------|
| `package.json` | Add `images:build:runner` (and wire runner builds into the deploy build). |
| `scripts/build-images.sh` | Also build the two runner images (or a sibling `images:build:all`). |
| `docker-compose.yml` | Mount `/var/run/docker.sock` into the `worker` service. |
| `.env.example` | Surface `ANTHROPIC_API_KEY` as required-for-AI. |
| `README.md` | Document runner-image build, the socket mount + its trade-off, and the k8s remote-worker path. |

## Verification

1. `npm run compose:up` on a clean machine; confirm `docker image ls 'journeyman/*'` lists the four
   app images **and** `runner-base` / `runner-bundle`.
2. From inside the `worker` container, `docker ps` (or the worker's own ping) succeeds against the
   host daemon.
3. Create a `docker`-type worker and run a flow that needs a workspace; confirm a `jm-run-<runId>`
   container + volume appear, the clone runs, and the run completes.
4. Create a `local`-type worker and confirm it still runs in-process (regression check).
5. Confirm an AI step succeeds with `ANTHROPIC_API_KEY` set and fails clearly without it.
