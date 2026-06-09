# Replace DinD with a Docker Socket Proxy — Design

**Date:** 2026-06-09
**Status:** Approved (design)

## Goal

Stop running sandboxes inside Docker-in-Docker (DinD) and instead drive **Docker
Desktop's own daemon** through a small TCP→socket proxy (`socat`). Sandboxes then run
as **siblings** on Desktop, so `host.docker.internal` resolves inside them — which is
required to reach host-local services (e.g. an LM Studio / Ollama server on the Mac) from
an OpenCode custom-endpoint model. No application code changes; compose + docs + one
runtime setting.

## Background — why DinD breaks host networking

`compose.deploy.yml` runs a privileged `docker:27-dind` service; the worker talks to it at
`tcp://docker:2375`, and the `registry` shares DinD's network namespace so `localhost:5500`
resolves for both host-push and DinD-pull. Sandboxes are **nested** inside DinD, so
`host.docker.internal` does **not** reach the Mac host — a model pointed at
`http://host.docker.internal:1234/v1` can't connect to LM Studio. `infra/compose.dev.yml`
(deps-only; worker runs on the host) already uses a plain published registry "no dind
namespace tricks needed", but offers no Docker endpoint for a host-run worker's docker
backend.

## Decision (locked with stakeholder)

Use a **`socat` TCP proxy sidecar** (no code change). `makeDockerClient` is TCP-only and
explicitly refuses a local-socket fallback, so the proxy converts the host Docker socket to a
TCP endpoint the worker can use. Sandboxes run on Docker Desktop's daemon as siblings.

Trade-offs accepted: the proxy exposes the **full, unauthenticated Docker API** on its
network (root-equivalent on the host) — so its port is **never published to the LAN**; and
sandboxes share Desktop's daemon (weaker isolation than DinD). Suitable for local/trusted
deployments.

## Topology

```
worker ──tcp://dockerproxy:2375──► socat ──/var/run/docker.sock──► Docker Desktop daemon
                                                                     └─► sandbox container (sibling)
                                                                           └─► opencode → host.docker.internal:1234 → LM Studio
registry (registry:2, published 5500:5000) ◄── build:kit push (host) / image pull (Desktop daemon)
```

## Changes

### 1. `compose.deploy.yml` (worker runs inside compose)

- **Remove** the `docker` (DinD) service, its `privileged: true`, and the `dind-storage`
  volume.
- **Add** `dockerproxy`:
  ```yaml
  # Bridges the host Docker socket to TCP so the worker (TCP-only client) drives Docker
  # Desktop's daemon directly — sandboxes run as siblings, not nested (no DinD).
  # Reachable ONLY on the private compose network at tcp://dockerproxy:2375.
  # SECURITY: exposes the full, unauthenticated Docker API (root-equivalent on the host).
  # Do NOT publish this port. Local/trusted use only.
  dockerproxy:
    image: alpine/socat
    command: ["tcp-listen:2375,fork,reuseaddr", "unix-connect:/var/run/docker.sock"]
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    restart: unless-stopped
  ```
- **Rework `registry`** to standalone (drop `network_mode: service:docker`, the
  `REGISTRY_HTTP_ADDR` override, and `depends_on: docker`):
  ```yaml
  registry:
    image: registry:2
    ports: ["5500:5000"]
    volumes:
      - registry-storage:/var/lib/registry
  ```
  Desktop's daemon pulls `localhost:5500` from the Mac host's published port; `build:kit`
  pushes to the same. (Already proven: a manual `docker run localhost:5500/runner-base@…`
  pulls successfully on Desktop.)
- **Worker `depends_on`**: replace the `docker` entry with `dockerproxy` (keep `registry`).
- **Remove** the `dind-storage:` named volume (keep `registry-storage:`).

### 2. `infra/compose.dev.yml` (worker runs on the host)

- **Add** the same `dockerproxy`, but **publish on host loopback** so a host-run
  `npm run start:worker` reaches Desktop at `tcp://localhost:2375`:
  ```yaml
  dockerproxy:
    image: alpine/socat
    command: ["tcp-listen:2375,fork,reuseaddr", "unix-connect:/var/run/docker.sock"]
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    ports: ["127.0.0.1:2375:2375"]   # loopback only — never expose to the LAN
    restart: unless-stopped
  ```
- Registry stays as-is (already standalone `5500:5000`).

### 3. Runtime repoint (sandbox/compute-target — not compose)

- Set the sandbox's `config.connection.host`:
  - **deploy:** `tcp://dockerproxy:2375`
  - **host-dev:** `tcp://localhost:2375`
  Done via the sandbox CRUD (UI/API) or by editing the existing sandbox row; new sandboxes
  should be created with this host.
- Coding models pointing at host-local servers use **Base URL
  `http://host.docker.internal:1234/v1`** (no LAN IP needed now).

### 4. Docs

- `docs/deploy-docker-compose.md`: replace the DinD section with the socat-proxy topology +
  de-coupled registry; document the `host.docker.internal` reachability, the sandbox
  `connection.host = tcp://dockerproxy:2375`, and the security caveat.
- `docs/setup.md` (local dev): add the `dockerproxy` service, the host-dev sandbox
  connection `tcp://localhost:2375`, and the local-model Base-URL note.

## Error handling / risks

- **Daemon unreachable:** if `connection.host` still points at the removed `docker` service,
  sandbox provisioning fails fast with a connect error — fix by repointing to `dockerproxy`.
- **Registry pull fails:** Desktop daemon must reach `localhost:5500`; verified by a manual
  `docker run localhost:5500/runner-base@…`.
- **Orphans:** sandboxes are siblings on Desktop; a crash could leave `journeyman.runId`-
  labeled containers / `jm-run-*` volumes. Journeyman already labels + removes them; a stray
  one is removable with normal `docker rm`/`docker volume rm`.
- **Security:** the proxy is unauthenticated; deploy keeps it network-internal, dev binds it
  to `127.0.0.1` only. Documented in both compose files and the docs.

## Verification

- `docker compose -f compose.deploy.yml config` and `... -f infra/compose.dev.yml config`
  parse cleanly.
- `npm run compose:up` brings the stack up with no `docker`/DinD service; the worker connects
  to `dockerproxy`.
- A reachability check from a Desktop sibling container succeeds:
  `docker run --rm curlimages/curl -s http://host.docker.internal:1234/v1/models`.
- An OpenCode custom-endpoint workflow (model `…/…`, Base URL `host.docker.internal:1234/v1`)
  runs to completion.

## Out of scope

- Adding native unix-socket support to `makeDockerClient` (the cleaner long-term option;
  deliberately deferred — we chose the no-code proxy).
- A least-privilege proxy (`tecnativa/docker-socket-proxy`); `socat` is used for simplicity.
  Switching later is a one-service swap.
- DinD for stronger isolation in untrusted/multi-tenant deployments (this design targets
  local/trusted use).

## Affected files

- `compose.deploy.yml` — remove DinD, add `dockerproxy`, standalone `registry`, worker deps.
- `infra/compose.dev.yml` — add host-published `dockerproxy`.
- `docs/deploy-docker-compose.md`, `docs/setup.md` — topology + connection + security notes.
