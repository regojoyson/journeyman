# Workspace Dashboard

A single workspace-level page that answers two questions at a glance: **what's happening right now**, and **how have we been doing**. It is served by a dedicated read-only analytics microservice so the main `api-server` stays uncluttered.

- **Backend:** `@journeyman/analytics` — a standalone Fastify service (own container, port `4002`) that runs aggregate SQL against the existing tables. It reuses `@journeyman/identity` for auth and a read-only `pg` pool. `api-server` is **not** in the request path.
- **Frontend:** `@journeyman/workspace-dashboard` — the UI package (bands + widgets), rendered by `@journeyman/web` at `/workspaces/:wsId/dashboard`.

Everything is **workspace-scoped** and read from data already stored — no schema changes, no writes.

## The page

Three bands, top to bottom:

| Band | Widgets | Source |
|---|---|---|
| ⚡ **Live now** (polled ~10s) | Active runs (running/queued/paused) · Needs attention (paused + failed <1h) · Live run feed · Active sandboxes | `jm_workflow_instances`, `jm_sandbox_instances` |
| 📈 **Trends** (per window) | Run volume/day · Success vs failure · Avg duration · Runs by trigger · Token usage · Top failure points | `jm_workflow_instances`, `jm_token_usage` |
| 🤖 **Agents** (per window) | Inventory (active/draft/enabled) · Provider/model mix · Activity/day · Leaderboard (runs, tokens, success, avg dur) | `jm_agents`, `jm_token_usage`, `jm_workflow_instances` |

The window selector is `24h / 7d / 30d` (default `7d`).

> **Cost is tokens-only for now.** `jm_token_usage.cost_usd` is intentionally null this phase, so token widgets show token *counts*, not dollars.

## API

Base path `/api/analytics`. Both routes require auth and `resource.read` permission on the workspace.

| Endpoint | Cadence | Returns |
|---|---|---|
| `GET /api/analytics/workspaces/:wsId/live` | polled ~10s by the page | active-run counts, needs-attention list, recent feed, active sandbox count |
| `GET /api/analytics/workspaces/:wsId/overview?window=24h\|7d\|30d` | fetched on window change | run volume, outcome split, duration, trigger mix, token usage, top failures, and the agents block |

Auth is the same JWT/cookie mechanism as `api-server` — the service shares the DB and identity secret, and in dev the web proxy forwards cookies same-origin.

## Running it locally

The service is a normal workspace package with a `start` script, plus a root convenience script:

```bash
npm run start:analytics          # → tsx packages/analytics/src/cli-start.ts, listens on :4002
# equivalently: npm start -w @journeyman/analytics
```

It connects lazily, so it boots without a database, but the endpoints need the dev DB up and migrated:

```bash
npm run infra:up                 # Postgres :5433, Redis, Conductor
npm run migrate                  # create jm_* tables on :5433
npm run start:analytics          # analytics service on :4002
npm run start:web                # web UI — its vite proxy routes /api/analytics → :4002
```

Then open `/workspaces/<wsId>/dashboard`. A full local stack is three processes — `start:api-server`, `start:analytics`, `start:web` — over `infra:up` + `migrate`.

### Configuration

| Env | Default | Purpose |
|---|---|---|
| `ANALYTICS_PORT` | `4002` | listen port (dedicated — **not** the shared `PORT`, which is api-server's `4000`) |
| `DATABASE_URL` | `postgres://postgres:postgres@localhost:5433/journeyman` | read-only DB connection |
| `PG_MAX` | `10` | pool size |
| `JWT_SECRET` | — | must match `api-server` so tokens verify |
| `IDENTITY_ENFORCE` | — | `true` to enforce auth |

## Deployment

The service ships as a third HTTP container alongside `api-server` and `web`:

- **Docker image:** `journeyman/analytics:dev`, built from the `runtime-analytics` stage (`npm run images:build` builds it).
- **Compose:** the `analytics` service in [`compose.deploy.yml`](../compose.deploy.yml) — host port `6002` → container `4002`, gated on `migrations`.
- **Kubernetes:** [`deploy/k8s/base/analytics.yaml`](../deploy/k8s/base/analytics.yaml) (Deployment + Service on `4002`); the ingress routes `/api/analytics` to it (a more specific rule than `/api` → `api-server`). `PORT=4002` is set explicitly in the pod because the shared `journeyman-config` ConfigMap pins `PORT=4000` for `api-server`.

## Code layout

```
packages/analytics/src/
├── cli-start.ts          ← standalone entrypoint (own pg.Pool, listens on PORT)
├── server.ts             ← buildAnalyticsServer(pool)
├── routes/index.ts       ← registerAnalyticsRoutes(app, pool) — the two auth-guarded routes
├── window.ts             ← window → time-bound helper
└── db/
    ├── live.ts           ← live-band queries
    ├── runs.ts           ← run volume / outcome / duration / trigger / failures
    ├── tokens.ts         ← token aggregation
    ├── agents.ts         ← inventory / provider mix / activity / leaderboard
    └── overview.ts       ← composes the overview payload

packages/workspace-dashboard/src/
├── Dashboard.tsx         ← window state + band layout
├── LiveBand / TrendsBand / AgentsBand
├── widgets.tsx           ← Kpi, Bars, Donut, HBars, Sparkline
└── format.ts             ← token / duration formatters
```

Response DTOs (`LiveStats`, `OverviewStats`, …) live in `@journeyman/core` (`types/analytics.types.ts`) so backend and frontend share one contract.

## Design & plan

- Spec: [docs/superpowers/specs/2026-06-21-workspace-dashboard-design.md](superpowers/specs/2026-06-21-workspace-dashboard-design.md)
- Implementation plan: [docs/superpowers/plans/2026-06-21-workspace-dashboard.md](superpowers/plans/2026-06-21-workspace-dashboard.md)
