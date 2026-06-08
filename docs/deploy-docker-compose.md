# Deploy Journeyman with Docker Compose

This guide brings the **whole** Journeyman stack up with one `docker compose` command:
UI, API, worker, the durable engine (Conductor + Redis + Postgres), and a built-in
Docker engine so AI coding jobs can run in isolated containers.

> **Status:** this describes the target setup defined in
> [docs/superpowers/specs/2026-06-08-docker-compose-deployment-design.md](superpowers/specs/2026-06-08-docker-compose-deployment-design.md).
> The compose/Dockerfile changes it depends on are tracked in that spec's implementation plan.

## Architecture

![Docker Compose deployment diagram](diagrams/docker-compose-deployment.svg)

### Services

Host ports use a **6000 series** to avoid clashing with the dev infra stack
(`infra/compose.dev.yml`) and common local services. Only host-side ports change —
container ports stay standard, so all in-network URLs (`postgres:5432`, `api-server:4000`,
`conductor:8080`) are unchanged.

| Service | Image | Role | Host port | Container |
|---|---|---|---|---|
| `web` | nginx + built SPA | serves the UI, proxies `/api` → api-server | **6080** | 8080 |
| `api-server` | `journeyman/api-server` | Fastify REST + SSE gateway | **6000** | 4000 |
| `worker` | `journeyman/worker` | executes flow steps and AI coding jobs | — | — |
| `docker` | `docker:27-dind` | built-in Docker engine for docker-workspace jobs | — (internal `2375`) | 2375 |
| `conductor` | orkes-conductor | durable workflow engine | **6008**, **6005** (UI) | 8080, 5000 |
| `postgres` | `postgres:16` | persistence | **6032** | 5432 |
| `redis` | `redis:7` | Conductor queue | **6079** | 6379 |
| `migrations` | `journeyman/migrations` | one-shot: applies DB migrations, then exits | — | — |

### How a step runs (the worker's two paths)

A flow step runs inside a **sandbox** the user picks in the app. There are two kinds and
**both are always available** — the deployment never forces one:

- **Local sandbox** — the worker clones the repo and runs the AI *in its own container*,
  writing to `/data/journeyman/workspaces/<runId>` (a host bind-mount, so it survives restarts).
- **Docker sandbox** — the worker asks the built-in `docker` (dind) engine over
  `tcp://docker:2375` to spin up a fresh, isolated container per job, then destroy it.
  The runner image (the "kit") is loaded into dind from `/data/journeyman/kit` on first use.

---

## Prerequisites

- Docker + the `docker compose` plugin.
- This repo checked out.

## 1. Configure `.env`

Copy the template and fill in the **required** values:

```bash
cp .env.example .env
```

| Variable | Required | Notes |
|---|---|---|
| `JWT_SECRET` | ✅ | `openssl rand -hex 32` |
| `JM_SECRET_ENCRYPTION_KEY` | ✅ | `openssl rand -hex 32` |
| `ANTHROPIC_API_KEY` | ✅ for AI steps | `sk-ant-…` (no `claude login` inside a container) |
| `JOURNEYMAN_DATA_DIR` | optional | host folder bind-mounted to `/data/journeyman`. Default: `./.journeyman-data` |
| `GITHUB_ACCESS_TOKEN` / `JM_GLOBAL_GITHUB_TOKEN` | optional | default git token if not set per-user |

Generate both secrets quickly:

```bash
printf 'JWT_SECRET=%s\nJM_SECRET_ENCRYPTION_KEY=%s\n' "$(openssl rand -hex 32)" "$(openssl rand -hex 32)" >> .env
```

`compose-up.sh` will **stop with a clear error** if `JWT_SECRET` or
`JM_SECRET_ENCRYPTION_KEY` is missing — it will not boot with blank secrets.

## 2. Build the runner kit (needed for docker workspaces)

The worker loads prebuilt runner images into dind from `*.tar` files — it never builds
them at run time. Produce them once into your data dir:

```bash
JOURNEYMAN_BASE_DIR="$(pwd)/.journeyman-data" npm run build:kit
# → .journeyman-data/kit/runner-base.tar, runner-bundle.tar
```

- `runner-base.tar` → the **default box** (docker sandboxes with no custom image).
- `runner-bundle.tar` → grafted into **custom** sandbox images.

The worker loads these into dind on first use (it never pulls or builds the kit at run time).
**Rebuild the kit whenever `@journeyman/agent-runtime` changes** — the tars embed the runner.

(Skip this if you only use **local** sandboxes.)

## 3. Bring the stack up

```bash
npm run compose:up      # builds app images + docker compose up -d
```

This builds the four app images, then starts every service. `migrations` runs first and
exits; `api-server`/`web` wait until it has completed and the DB is healthy.

Check status and logs:

```bash
docker compose -f compose.deploy.yml ps
docker compose -f compose.deploy.yml logs -f worker
```

Open the UI: **http://localhost:6080**  (Conductor UI: http://localhost:6005)

## 4. Create a sandbox in the app

Log in, then go to **Sidebar → Sandboxes → New sandbox**.

**Local workspace** (simplest):
1. Type = **Local** → Save.

**Docker workspace, built-in engine:**
1. Type = **Docker**
2. Connection = **Local socket**, leave **Socket path blank** (resolves to the built-in dind).
3. Image source = a prebuilt ref (e.g. `node:22-bookworm`) or a Dockerfile.
4. Network = **Full (internet)**.
5. Save → **Test connection** → ✅.

**Docker workspace, your own engine (any IP):**
1. Type = **Docker** → Connection = **Remote daemon**.
2. Daemon host = `tcp://<your-host>:2376`.
3. Save → **Test connection** → ✅.

The worker connects straight to that host, ignoring the built-in engine.

---

## Operations

```bash
npm run compose:down     # stop the stack (keep data)
npm run compose:reset    # stop + delete volumes (DESTROYS data)
docker compose -f compose.deploy.yml logs -f api-server
```

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `compose-up` aborts naming `JWT_SECRET` | secrets not set | add them to `.env` (step 1) |
| Docker-sandbox "Test connection" fails | dind not up, or kit missing | `docker compose -f compose.deploy.yml ps` shows `docker`; run `npm run build:kit` (step 2) |
| AI step errors with auth | `ANTHROPIC_API_KEY` missing | set it in `.env`, `docker compose -f compose.deploy.yml up -d worker` |
| `web` loads but `/api` calls fail | api-server not healthy yet | `docker compose -f compose.deploy.yml logs api-server` |
| Local-sandbox clone fails with `git: not found` | worker image missing git | rebuild images (`npm run images:build`) |

## Security notes

- The `docker` (dind) service runs **privileged** — it needs kernel access to create
  containers. It is reachable only on the private compose network. Acceptable for a
  self-hosted single-host deployment; review before exposing the host beyond localhost.
- The built-in engine listens on **plain TCP (no TLS)** inside the compose network only.
  For remote engines over the internet, use TLS certs on the sandbox's connection config.
