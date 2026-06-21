# Workspace Dashboard — Design

**Date:** 2026-06-21
**Status:** Approved (design); pending implementation plan
**Owner:** Samuel Rego

## In plain words

A single page inside a workspace that answers two questions at a glance:

1. **What's happening right now?** — active runs, anything needing attention, a live feed, environments in use. (Top of the page, refreshes itself.)
2. **How have we been doing?** — run volume, success rate, durations, token usage, and per-agent activity over a chosen time window. (Below.)

The numbers come from a **new, small backend service** dedicated to reading stats, so the already-busy `api-server` is left alone. The page asks that service for two things: a cheap *live* snapshot it re-checks every ~10 seconds, and a heavier *overview* it fetches whenever the time window changes.

Everything is **workspace-scoped** and read from data already stored today. No new writes, no schema changes.

## Goals

- One workspace-level dashboard, live snapshot on top, historical trends below — a single scrollable page.
- 14 widgets across three bands (Live / Trends / Agents), all driven by existing tables.
- Keep `api-server` untouched: the stats backend is a separate, self-contained service.
- Work with **today's** data — no dependence on dormant rollup tables, no schema migrations.

## Non-goals (future work)

- **Dollar cost.** `jm_token_usage.cost_usd` is intentionally null this phase; widgets show token *counts*, not spend.
- **Precomputed rollup tables / materialized views.** All aggregates are computed on demand. `jm_agent_run_counters` is dormant and not relied upon.
- **Custom/arbitrary date ranges**, CSV export, scheduled email digests, cross-workspace/org roll-ups.

## Architecture

### New backend: `@journeyman/analytics`

A standalone Fastify HTTP service — a third service alongside the existing `api-server` and `web` (this is an established pattern in deploy, not a new one).

- **Auth:** reuses `@journeyman/identity` — `makeRequireAuth()` and `makeRequireWorkspacePermission()`. Both are pure preHandler factories that take only a `{ pool }`, so they drop into any Fastify app. Same JWT verification and workspace-permission semantics as `api-server`. Every route guards with `requireAuth()` + `requirePerm("...read")` scoped to `:wsId`.
- **DB:** its own read-only `pg.Pool` via `createPool({ connectionString: DATABASE_URL })` (the same factory `api-server` uses). Read-only by convention — the service issues only `SELECT`s.
- **Routes as a plugin:** all routes are registered through `registerAnalyticsRoutes(app, pool)` (mirrors `registerSecretsRoutes`, `registerIdentityRoutes`, etc.). Because the routes are a plugin, the service can *also* be mounted into `api-server` for a fast local dev loop — but its deploy target is its own container.
- **Bootstrap:** `buildAnalyticsServer({ pool })` returns the Fastify instance; `cli-start.ts` is the container entrypoint. Mirrors `packages/api-server/src/{server.ts, cli-start.ts}`.

`api-server` is **not modified**.

### New frontend: `@journeyman/workspace-dashboard`

A UI package that renders the page, mirroring the existing `@journeyman/runs-list` / `@journeyman/run-viewer` pattern (a focused UI surface package consumed by `@journeyman/web`).

- Mounted as a route/page in `@journeyman/web`.
- **Live band** polls `/live` every ~10s (interval cleared on unmount; pauses when the tab is hidden).
- **Trends + Agents bands** fetch `/overview?window=` once per window selection, plus a manual refresh control.
- Window selector: `24h | 7d | 30d`, default `7d`.

### Data flow

```
web (dashboard page) → ingress / vite proxy (/api/analytics/*) → @journeyman/analytics → Postgres (read-only aggregates)
                                                                          │
                                                  reuses @journeyman/identity (auth) + createPool (db)
```

## API

Base path: `/api/analytics`. Both endpoints require auth and `:wsId` workspace read permission.

### `GET /api/analytics/workspaces/:wsId/live`

Cheap, polled ~10s. Returns the live band:

```jsonc
{
  "activeRuns":    { "running": 5, "queued": 1, "paused": 1, "total": 7 },
  "needsAttention": [
    { "instanceId": "…", "name": "release-bot", "state": "paused", "nodeId": "open-pr", "ageMs": 480000 },
    { "instanceId": "…", "name": "nightly-sync", "state": "failed", "nodeId": "custom-ai", "ageMs": 1320000 }
  ],
  "recentFeed": [
    { "instanceId": "…", "name": "deploy-bot", "status": "running", "trigger": "webhook", "elapsedMs": 120000 }
    // last ~10
  ],
  "activeSandboxes": { "total": 5, "byType": { "docker": 4, "local": 1 } }
}
```

### `GET /api/analytics/workspaces/:wsId/overview?window=24h|7d|30d`

Heavier, fetched per window change. Returns the trends + agents bands:

```jsonc
{
  "window": "7d",
  "runVolume":   [ { "day": "2026-06-15", "count": 38 }, … ],
  "outcomeSplit":{ "completed": 271, "failed": 29, "cancelled": 12, "successRate": 0.87 },
  "duration":    { "medianMs": 221000, "trend": [ { "day": "…", "medianMs": … } ], "deltaPct": -0.12 },
  "byTrigger":   { "webhook": 0.62, "manual": 0.24, "schedule": 0.10, "api": 0.04 },
  "tokens":      { "total": 4200000, "byProvider": { "claude": 2700000, "opencode": 1200000, "aisdk": 300000 },
                   "byVendor": { … }, "costUsd": null },
  "topFailures": [ { "stepType": "custom-ai", "nodeId": "generate-fix", "count": 11 }, … ],
  "agents": {
    "inventory": { "total": 9, "active": 6, "draft": 3, "enabled": 8 },
    "providerMix": { "claude": 0.64, "opencode": 0.30, "aisdk": 0.06 },
    "activityPerDay": [ { "day": "…", "count": … } ],
    "leaderboard": [
      { "agentId": "…", "name": "deploy-bot", "provider": "claude",
        "runs": 142, "tokens": 1900000, "successRate": 0.94, "avgDurationMs": 130000 }
    ]
  }
}
```

## Data sources & key decisions

All queries filter by `workspace_id = :wsId` and the window's lower time bound. Relevant indexes already exist (notably `jm_token_usage` is indexed on `workspace + time`).

| Widget | Source | Notes |
|---|---|---|
| Active runs, needs-attention, feed | `jm_workflow_instances` | Filter on `status`; "needs attention" = `status='paused'` OR (`status='failed'` AND `completed_at > now()-1h`). |
| Run volume, outcome split, duration, by-trigger | `jm_workflow_instances` | Group by `date_trunc('day', started_at)`, `status`, `trigger_source`; duration from `duration_ms`. |
| Top failure points | `jm_workflow_instances` (failed) | Group by the failed step/node. |
| Active sandboxes | `jm_sandbox_instances` ⋈ `jm_workflow_instances` | Sandboxes are **not** workspace-scoped directly — join `sandbox.run_id = instances.id`, filter `instances.workspace_id = :wsId` AND `sandbox.status='active'`. Group by `type`. |
| Token total / provider / vendor | `jm_token_usage` | Has `agent_id`, `agent_name`, `provider`, `vendor`, `model` columns directly + `workspace+time` index → primary source for token sums and provider/model mix. `cost_usd` is null → omit dollars. |
| Agent inventory, provider mix | `jm_agents` (workspace-scoped) | Count by `status` (`active`/`draft`) and `enabled`; provider from `definition->>'provider'`. |
| Agent leaderboard, activity/day | `jm_token_usage` + `jm_workflow_instances` | Per-agent **tokens** from `jm_token_usage` (direct `agent_id`); per-agent **run counts / success / duration** from instances. Activity/day computed on the fly (`group by day, agent`) so it works **today** — `jm_agent_run_counters` is dormant and noted as a future fast-path. |

### Decisions locked

- **Two new packages:** `@journeyman/analytics` (backend service) + `@journeyman/workspace-dashboard` (UI).
- **Window:** `24h / 7d / 30d`, default `7d`.
- **Live cadence:** client polls `/live` every ~10s (no SSE this phase — polling is simpler and sufficient).
- **No schema changes, no writes.**

## Deployment

Adding a third HTTP service follows the existing pattern:

- **Dockerfile:** new `runtime-analytics` stage alongside `runtime-api` / `runtime-worker` / `runtime-web`.
- **compose.deploy.yml:** new `analytics` service; container port (e.g. `4002`), `depends_on: [postgres, migrations]`, `DATABASE_URL` + JWT/auth env mirroring `api-server`.
- **K8s:** `deploy/k8s/base/analytics.yaml` (Deployment + Service); add to `kustomization.yaml`.
- **Ingress:** route `/api/analytics` → `analytics` service. The rule must be **more specific than** the existing `/api → api-server` rule so it matches first.
- **Web dev proxy:** add `/api/analytics` → analytics target in `packages/web/vite.config.ts`.

## Testing

- **Aggregation correctness:** per-query tests against a seeded test database (follows the existing store-test pattern in the repo) — verify counts, success rate, token sums, the sandbox join, and window boundaries.
- **Auth guards:** no token → 401; valid token but wrong/no workspace permission → 403; correct permission → 200.
- **Empty-state:** a workspace with no runs/agents returns well-formed zeros, not nulls/errors.
- **Frontend:** the dashboard page renders each band from a mocked payload; live polling starts/stops on mount/unmount.

## Open questions

None blocking. Cost ($) and rollup-backed fast paths are explicitly deferred (see Non-goals).
