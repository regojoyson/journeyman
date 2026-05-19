# Journeyman

Configurable, step-based AI pipeline that automates ticket → code → PR workflows.

![License](https://img.shields.io/badge/license-MIT-blue) ![Node](https://img.shields.io/badge/node-%3E%3D18-green) ![TypeScript](https://img.shields.io/badge/TypeScript-5-blue)

## What is Journeyman?

Journeyman watches for tickets (Jira, Linear, GitHub Issues, Monday) and runs configurable AI-powered flows that clone repos, analyze the ticket, write code, and open PRs — all without manual intervention. A visual, n8n-style canvas editor lets you drag-and-drop step nodes, wire conditional branches, and configure retry policies without touching code. The provider pattern means you can swap any AI coding tool (Claude, Gemini, Codex), git host (GitHub, GitLab), ticket tracker, or notification channel without changing your flow definitions. Durable execution is backed by Conductor, with support for step retries and human-in-the-loop pause/resume gates.

## Architecture

![Architecture](docs/architecture.svg)

| Layer | Role |
|---|---|
| **Web UI** | Visual canvas editor, live run monitoring, runs history |
| **API Gateway** | Fastify REST + SSE; auth, validation, routing |
| **Orchestrator** | Conductor adapter, worker harness, durable execution |
| **Steps & Providers** | Execution logic per flow node — AI coding, git, tickets, notifications |
| **Storage** | PostgreSQL (persistence) + Redis (job queue) |

## Packages

### Shared

| Package | Description |
|---|---|
| `@journeyman/core` | Interfaces and types — the contract all packages depend on |

### UI

| Package | Description |
|---|---|
| `@journeyman/web` | React web shell (flows list, flow editor page, run detail page) |
| `@journeyman/flow-editor` | Visual canvas editor component (drag-drop nodes, properties panel, MCP/skills config) |
| `@journeyman/run-viewer` | Read-only execution canvas with live per-node status |
| `@journeyman/runs-list` | Sortable, filterable run history table |

### Backend

| Package | Description |
|---|---|
| `@journeyman/api-server` | Fastify HTTP gateway with REST and SSE endpoints |
| `@journeyman/orchestrator` | Conductor adapter, worker harness, pluggable flow and run stores |
| `@journeyman/identity` | JWT auth, bcrypt passwords, user/org/role management |
| `@journeyman/secrets` | User- and org-scoped secret vault with AES encryption |
| `@journeyman/migrations` | SQL migrations (`journeyman-migrate` CLI) |

### Steps

| Package | Description |
|---|---|
| `@journeyman/steps` | Built-in step catalog (getTicket, analyze, plan, implement, createPR, …) |
| `@journeyman/custom-steps` | User-defined AI step registration with prompt templates |

### Providers

| Package | Description |
|---|---|
| `@journeyman/coding-cli` | AI coding operations via Claude Agent SDK (analyze, plan, implement, git) |
| `@journeyman/coding-models` | AI model provider configuration (Claude, Gemini, Codex) |
| `@journeyman/git-provider` | GitHub and GitLab REST (create PRs, MRs, list repos) |
| `@journeyman/github-api` | Shared Octokit client (REST + GraphQL, retry + throttling) |
| `@journeyman/ticket-provider` | Jira, Linear, Monday, GitHub Issues and Projects |
| `@journeyman/notification-provider` | Slack notifications |

### Integrations

| Package | Description |
|---|---|
| `@journeyman/mcp` | MCP instance registry, resolver, and Claude Agent SDK adapter |
| `@journeyman/skills` | Skill package management and Claude Agent SDK adapter |

## Getting Started

```bash
# 1. Install dependencies
npm install

# 2. Start infrastructure (Postgres, Redis, Conductor)
npm run infra:up

# 3. Run database migrations
npm run migrate

# 4. Copy and fill environment variables
cp .env.example .env

# 5. Start API server, worker, and web UI
npm run start:api-server
npm run start:worker
npm run dev:web
```

→ [Quickstart guide](docs/quickstart.md) — 10-minute end-to-end walkthrough

→ [Full setup reference](docs/setup.md) — all environment variables, webhook config, deployment

## Flow Editor

The visual canvas is powered by `@journeyman/flow-editor`, a React component built on XYFlow. Nodes represent steps (built-in or custom); edges carry JSON Logic conditions for conditional branching between them. The properties panel lets you configure node inputs, retry/backoff policy, MCP tools, skill packages, and secret bindings per node. Flows can be authored in the UI, validated, and published — the same JSON schema is used by the orchestrator at runtime.

→ [Flow authoring guide](docs/flows.md)

## Docs

### Using Journeyman

| Doc | Description |
|---|---|
| [Quickstart](docs/quickstart.md) | 10-minute end-to-end: install, configure, trigger your first run |
| [Setup](docs/setup.md) | Full install reference: env vars, webhook config, deployment |
| [Products](docs/products.md) | Logical tenants — isolate flows, repos, and concurrency per team |
| [New Product](docs/new-product.md) | Add a new product via the UI without touching code |
| [Flows](docs/flows.md) | Author flows in the visual editor or YAML: nodes, edges, conditions, retries |
| [Steps](docs/steps.md) | Built-in step catalog and the `IStepHandler` interface |
| [Custom Steps](docs/custom-steps.md) | Register user-defined AI steps with custom prompts and tools |
| [Providers](docs/providers.md) | Configure coding, git, ticket, and notification providers |
| [Triggers](docs/triggers.md) | API, GitHub, GitLab, and Jira webhook trigger sources |
| [Artifacts](docs/artifacts.md) | Shared artifact bag: how data flows between steps |
| [Management API](docs/management-api.md) | Full REST + SSE API reference |

### Platform Features

| Doc | Description |
|---|---|
| [MCP](docs/mcp.md) | Connect Model Context Protocol servers to flows and AI steps |
| [Skills](docs/skills.md) | Enable reusable skill bundles for AI steps |
| [Secrets](docs/secrets.md) | User- and org-scoped secret vault with flow bindings |
| [Users & Roles](docs/users.md) | Authentication, user management, and role-based access |
| [Webhooks](docs/webhooks.md) | Inbound webhook verification, HMAC signing, and dedup |

### Operations

| Doc | Description |
|---|---|
| [Security](docs/security.md) | Threat model, token management, secret rotation, encryption |
| [Troubleshooting](docs/troubleshooting.md) | Runbook for common failure modes |

## Development

```bash
# Type-check all packages
npm run typecheck

# Check import boundaries
npm run check:boundaries

# Run tests
npm test

# Infrastructure lifecycle
npm run infra:up      # start Postgres, Redis, Conductor
npm run infra:down    # stop containers
npm run infra:reset   # wipe volumes and restart
```

## Deployment

Journeyman ships two deployment paths that share one `Dockerfile`:

- **Docker Compose** — full stack on a single host. Best for local dev or a small single-node deploy.
- **Kubernetes** — cluster-agnostic Kustomize manifests under [`deploy/k8s/`](deploy/k8s/). Tested against k3s / Rancher Desktop; works on kind, minikube, EKS, GKE, AKS, etc.

Design / specification: [`docs/superpowers/specs/2026-05-19-deployment-design.md`](docs/superpowers/specs/2026-05-19-deployment-design.md).

### Container images

A single multi-stage [`Dockerfile`](Dockerfile) produces four images via the `--target` flag:

| Image | Stage | Purpose |
|---|---|---|
| `journeyman/api-server:dev` | `runtime-api` | Fastify REST + SSE on port `4000` |
| `journeyman/worker:dev` | `runtime-worker` | Orchestrator worker (no exposed port) |
| `journeyman/web:dev` | `runtime-web` | nginx serving the React build on port `8080`; proxies `/api` to `api-server:4000` |
| `journeyman/migrations:dev` | `runtime-migrations` | One-shot DB schema migrator |

Build all four:

```bash
npm run images:build      # ./scripts/build-images.sh
```

### Environment variables

The same env contract drives both deployments. Required at runtime:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string |
| `CONDUCTOR_BASE_URL` | Conductor REST endpoint |
| `STORE_BACKEND` | `postgres` (or `memory` for dev) |
| `IDENTITY_ENFORCE` | `true` to enforce JWT auth |
| `JWT_SECRET` | JWT signing key (≥32 chars; `openssl rand -hex 32`) |
| `JM_SECRET_ENCRYPTION_KEY` | AES key for the secrets vault (`openssl rand -hex 32`) |
| `LOG_LEVEL` | pino log level (default `info`) |
| `PORT` | api-server listen port (default `4000`) |

Optional: `ANTHROPIC_API_KEY`, `GITHUB_ACCESS_TOKEN`, `JM_GLOBAL_*` secrets — see [`.env.example`](.env.example) for the full list.

### Path 1: Docker Compose

**Prerequisites:** Docker 24+ with Compose v2.

```bash
# 1. Seed an env file with dev secrets
cp .env.example .env
# Generate strong values for JWT_SECRET and JM_SECRET_ENCRYPTION_KEY:
#   openssl rand -hex 32
# Edit .env and paste them in.

# 2. Bring up the full stack (builds images, then `docker compose up -d`)
npm run compose:up

# 3. Open the web UI
open http://localhost:8081

# 4a. Stop, KEEP data (postgres + redis volumes survive)
npm run compose:down

# 4b. Stop AND wipe data (drops `pgdata` and `redisdata`)
npm run compose:reset
```

Volumes live inside the Rancher Desktop VM at `/var/lib/docker/volumes/journeyman_pgdata/_data` and `/var/lib/docker/volumes/journeyman_redisdata/_data`.

Port map (host → container):

| Host | Service | Notes |
|---|---|---|
| 8081 | web (nginx) | UI; also proxies `/api` to api-server |
| 4000 | api-server | REST + SSE |
| 8080 | conductor | Conductor REST |
| 5001 | conductor | UI (5000 is taken by macOS AirPlay) |
| 5433 | postgres | dev access |
| 6380 | redis | dev access |

The `migrations` service runs once, exits 0, and gates `api-server` + `worker` via `depends_on: service_completed_successfully`.

### Path 2: Kubernetes (any conforming cluster)

**Prerequisites:** `kubectl` configured against a working cluster; an ingress controller if you want hostname-based access (any class — `nginx`, `traefik`, etc.).

Layout:

```
deploy/k8s/
├── base/                       cluster-agnostic manifests
└── overlays/
    ├── local/                  single-replica dev (imagePullPolicy: IfNotPresent)
    └── example-registry/       template for remote-registry clusters
```

Quick start:

```bash
# 1. Build images on your host
npm run images:build

# 2. Make images visible to the cluster (only some runtimes need this):
#    Docker Desktop k8s / Rancher Desktop / k3s on this host  → nothing
#    kind     → kind load docker-image journeyman/api-server:dev journeyman/worker:dev journeyman/web:dev journeyman/migrations:dev
#    minikube → minikube image load journeyman/api-server:dev   (repeat per image)

# 3. Seed dev secrets for the local overlay
cp deploy/k8s/overlays/local/.env.secret.example deploy/k8s/overlays/local/.env.secret
# Edit the file and paste real values for JWT_SECRET / JM_SECRET_ENCRYPTION_KEY.

# 4. Apply (the script also rebuilds images and reminds you about the load step)
npm run k8s:up

# 5. Watch rollouts
kubectl -n journeyman get pods -w
kubectl -n journeyman rollout status deployment/web
kubectl -n journeyman rollout status deployment/api-server

# 6. Access the UI
#    Via ingress: point `journeyman.local` at your ingress controller, then open http://journeyman.local
#    Or port-forward:
kubectl -n journeyman port-forward svc/web 18080:8080
# Then: http://localhost:18080

# 7a. Stop, KEEP data (postgres + redis PVCs survive)
npm run k8s:down

# 7b. Stop AND wipe data (also deletes PVCs)
npm run k8s:reset
```

PVCs live in the cluster's default StorageClass — for Rancher Desktop / k3s that's `local-path`, files at `/var/lib/rancher/k3s/storage/` inside the VM (`rdctl shell` to look).

Deploying to a remote cluster: copy [`deploy/k8s/overlays/example-registry/`](deploy/k8s/overlays/example-registry/), replace the `ghcr.io/your-org/...` images and `REPLACE_ME` tags with your own, and swap the inherited Secret for one sourced from your secrets store (Sealed Secrets, External Secrets, Vault). See [`deploy/k8s/overlays/example-registry/README.md`](deploy/k8s/overlays/example-registry/README.md).

### Troubleshooting

| Symptom | Cause / Fix |
|---|---|
| `web` container returns 502 from `/api/...` | api-server not yet listening — wait for `migrations` to complete and `api-server` to become Ready. Check `docker compose logs api-server`. |
| K8s pods stuck `ImagePullBackOff` with `journeyman/*:dev` | Images aren't in the cluster's runtime. Run the `kind load` / `minikube image load` step above. |
| `worker` pod in `Error` shortly after apply | Usually because Conductor is still starting (its readiness probe has `initialDelaySeconds: 30`). It restarts and stabilises automatically. |
| api-server crashes with secret-related errors | `JWT_SECRET` or `JM_SECRET_ENCRYPTION_KEY` missing/too short. Generate with `openssl rand -hex 32`. |
| Conductor image pull is very slow | `orkesio/orkes-conductor-community-standalone` is ~1.5 GB on first pull; subsequent runs are cached. |
