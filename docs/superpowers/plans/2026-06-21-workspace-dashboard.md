# Workspace Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a single workspace-level dashboard page — a live snapshot (active runs, attention, feed, sandboxes) on top, historical trends and per-agent stats below — served by a new standalone `@journeyman/analytics` service that leaves `api-server` untouched.

**Architecture:** A new backend package `@journeyman/analytics` exposes two read-only endpoints (`/live` polled ~10s, `/overview?window=` per window change), built as a Fastify route plugin that reuses `@journeyman/identity` for auth and a plain `pg.Pool` for DB. A new frontend package `@journeyman/workspace-dashboard` renders the page (mirrors `runs-list`), mounted as a route in `@journeyman/web`. Shared response DTOs live in `@journeyman/core`. All aggregates are computed on demand from existing tables — **no schema changes, no writes.**

**Tech Stack:** TypeScript (ESM), Fastify 5, `pg`, React 19, `@tanstack/react-query`, Vitest.

**Spec:** [docs/superpowers/specs/2026-06-21-workspace-dashboard-design.md](../specs/2026-06-21-workspace-dashboard-design.md)

> **Execution constraints (per request):** Work on the current `master` branch. **Do NOT commit.** There are no per-task commit steps. The single verification gate is the final typecheck task. DB-integration tests against a live database are out of scope for this pass; only pure-logic unit tests are written (window math, token formatting).

---

## File Structure

**New backend package — `packages/analytics/`**
- `package.json`, `tsconfig.json` — scaffold (mirrors `packages/secrets`)
- `src/index.ts` — exports `registerAnalyticsRoutes`, `buildAnalyticsServer`
- `src/window.ts` — `windowSince(window, now)` pure helper (unit-tested)
- `src/db/live.ts` — `getLiveStats(pool, wsId)`
- `src/db/runs.ts` — run-volume / outcome / duration / trigger / failures queries
- `src/db/tokens.ts` — token aggregation
- `src/db/agents.ts` — agent inventory / provider mix / activity / leaderboard
- `src/db/overview.ts` — `getOverviewStats(pool, wsId, window)` composes the above
- `src/routes/index.ts` — `registerAnalyticsRoutes(app, pool)` (auth-guarded)
- `src/server.ts` — `buildAnalyticsServer(pool)`
- `src/cli-start.ts` — standalone entrypoint (own `pg.Pool`, listens on `PORT`)
- `src/window.test.ts` — pure unit test

**New frontend package — `packages/workspace-dashboard/`**
- `package.json`, `tsconfig.json` — scaffold (mirrors `packages/runs-list`)
- `src/index.ts` — exports `Dashboard`
- `src/format.ts` — `formatTokens`, `formatDuration`, `formatAgo` (unit-tested)
- `src/format.test.ts` — pure unit test
- `src/widgets.tsx` — small presentational primitives (Kpi, Bars, Donut, HBars, Sparkline)
- `src/LiveBand.tsx`, `src/TrendsBand.tsx`, `src/AgentsBand.tsx`
- `src/Dashboard.tsx` — window state + band layout

**Shared types — `packages/core/`**
- Create `src/types/analytics.types.ts`
- Modify `src/index.ts` (export the new types)

**Web integration — `packages/web/`**
- Create `src/api/analytics.ts` — `getLiveStats`, `getOverview`
- Create `src/routes/DashboardPage.tsx`
- Modify `src/App.tsx` — add route
- Modify `vite.config.ts` — add `/api/analytics` proxy

**Deployment — repo root**
- Modify `Dockerfile` — add `runtime-analytics` stage
- Modify `compose.deploy.yml` — add `analytics` service
- Create `deploy/k8s/base/analytics.yaml`; modify `deploy/k8s/base/kustomization.yaml` and `ingress.yaml`

---

## Task 1: Shared DTO types in `@journeyman/core`

**Files:**
- Create: `packages/core/src/types/analytics.types.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Create the analytics DTO types**

Create `packages/core/src/types/analytics.types.ts`:

```typescript
import type { WorkflowInstanceStatus } from "./workflow-instance.types.ts";

export type AnalyticsWindow = "24h" | "7d" | "30d";

// ---- live ----
export interface ActiveRunsStat {
  running: number;
  queued: number; // pending + provisioning
  paused: number;
  total: number;
}

export interface NeedsAttentionItem {
  instanceId: string;
  name: string;
  state: "paused" | "failed";
  nodeId: string | null;
  ageMs: number;
}

export interface RecentFeedItem {
  instanceId: string;
  name: string;
  status: WorkflowInstanceStatus;
  trigger: string;
  elapsedMs: number;
}

export interface ActiveSandboxesStat {
  total: number;
  byType: Record<string, number>;
}

export interface LiveStats {
  activeRuns: ActiveRunsStat;
  needsAttention: NeedsAttentionItem[];
  recentFeed: RecentFeedItem[];
  activeSandboxes: ActiveSandboxesStat;
}

// ---- overview ----
export interface DayCount {
  day: string; // YYYY-MM-DD
  count: number;
}

export interface OutcomeSplit {
  completed: number;
  failed: number;
  cancelled: number;
  successRate: number; // 0..1
}

export interface DurationStat {
  medianMs: number;
  trend: { day: string; medianMs: number }[];
  deltaPct: number; // (last - first) / first, 0 if insufficient data
}

export interface TokenStat {
  total: number;
  byProvider: Record<string, number>;
  byVendor: Record<string, number>;
  costUsd: number | null; // null this phase
}

export interface FailurePoint {
  nodeId: string | null;
  count: number;
}

export interface AgentInventory {
  total: number;
  active: number;
  draft: number;
  enabled: number;
}

export interface AgentLeaderboardRow {
  agentId: string;
  name: string;
  provider: string | null;
  runs: number;
  tokens: number;
  successRate: number; // 0..1
  avgDurationMs: number;
}

export interface AgentStats {
  inventory: AgentInventory;
  providerMix: Record<string, number>; // fractions, sum ~1
  activityPerDay: DayCount[];
  leaderboard: AgentLeaderboardRow[];
}

export interface OverviewStats {
  window: AnalyticsWindow;
  runVolume: DayCount[];
  outcomeSplit: OutcomeSplit;
  duration: DurationStat;
  byTrigger: Record<string, number>; // fractions, sum ~1
  tokens: TokenStat;
  topFailures: FailurePoint[];
  agents: AgentStats;
}
```

- [ ] **Step 2: Export the new types**

In `packages/core/src/index.ts`, add a line alongside the other `export * from "./types/*.types.ts"` lines (match the existing ordering/style):

```typescript
export * from "./types/analytics.types.ts";
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck -w @journeyman/core`
Expected: PASS (no errors).

---

## Task 2: Scaffold the `@journeyman/analytics` package

**Files:**
- Create: `packages/analytics/package.json`
- Create: `packages/analytics/tsconfig.json`

- [ ] **Step 1: Create `packages/analytics/package.json`**

```json
{
  "name": "@journeyman/analytics",
  "version": "0.1.0",
  "description": "Workspace analytics service — read-only stats aggregation.",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./routes": "./src/routes/index.ts"
  },
  "files": ["src"],
  "scripts": {
    "start": "tsx src/cli-start.ts",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@journeyman/core": "*",
    "@journeyman/identity": "*",
    "fastify": "^5.8.5",
    "@fastify/cors": "^11.0.1",
    "@fastify/sensible": "^6.0.3",
    "pg": "^8.13.0",
    "tsx": "^4.19.2"
  },
  "devDependencies": {
    "@types/node": "^25.6.0",
    "@types/pg": "^8.11.10",
    "typescript": "^6.0.3",
    "vitest": "^4.1.8"
  }
}
```

> NOTE: confirm the `@fastify/cors`, `@fastify/sensible`, and `tsx` versions against `packages/api-server/package.json` and pin to the same versions used there. If they differ, use api-server's versions.

- [ ] **Step 2: Create `packages/analytics/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "allowImportingTsExtensions": true,
    "noEmit": true,
    "resolveJsonModule": true,
    "rootDir": "./src"
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Link the new workspace package**

Run: `npm install`
Expected: completes; `@journeyman/analytics` is linked into `node_modules`. (Root `package.json` already globs `packages/*`, so no edit needed.)

---

## Task 3: Window helper (pure, TDD)

**Files:**
- Create: `packages/analytics/src/window.ts`
- Test: `packages/analytics/src/window.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/analytics/src/window.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { windowSince } from "./window.ts";

const NOW = new Date("2026-06-21T12:00:00.000Z");

describe("windowSince", () => {
  it("24h → 24 hours before now", () => {
    expect(windowSince("24h", NOW).toISOString()).toBe("2026-06-20T12:00:00.000Z");
  });
  it("7d → 7 days before now", () => {
    expect(windowSince("7d", NOW).toISOString()).toBe("2026-06-14T12:00:00.000Z");
  });
  it("30d → 30 days before now", () => {
    expect(windowSince("30d", NOW).toISOString()).toBe("2026-05-22T12:00:00.000Z");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @journeyman/analytics`
Expected: FAIL — cannot find module `./window.ts`.

- [ ] **Step 3: Write the implementation**

Create `packages/analytics/src/window.ts`:

```typescript
import type { AnalyticsWindow } from "@journeyman/core";

const HOURS: Record<AnalyticsWindow, number> = {
  "24h": 24,
  "7d": 24 * 7,
  "30d": 24 * 30,
};

/** Lower time bound for a window, relative to `now`. */
export function windowSince(window: AnalyticsWindow, now: Date): Date {
  return new Date(now.getTime() - HOURS[window] * 60 * 60 * 1000);
}

/** Parse a query string into a valid window, defaulting to "7d". */
export function parseWindow(raw: unknown): AnalyticsWindow {
  return raw === "24h" || raw === "30d" ? raw : "7d";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @journeyman/analytics`
Expected: PASS (3 tests).

---

## Task 4: Live stats query

**Files:**
- Create: `packages/analytics/src/db/live.ts`

Reference column names (verbatim from migrations): `jm_workflow_instances(id, workspace_id, status, trigger_source, started_at, completed_at, created_at, failed_at_node_id, workflow_name_snapshot)`; `jm_sandbox_instances(run_id, type, status)`. Valid statuses: `pending | provisioning | running | paused | completed | failed | cancelled`.

- [ ] **Step 1: Write the implementation**

Create `packages/analytics/src/db/live.ts`:

```typescript
import type { Pool } from "pg";
import type {
  LiveStats, ActiveRunsStat, NeedsAttentionItem, RecentFeedItem, ActiveSandboxesStat,
} from "@journeyman/core";

export async function getLiveStats(pool: Pool, wsId: string): Promise<LiveStats> {
  return {
    activeRuns: await activeRuns(pool, wsId),
    needsAttention: await needsAttention(pool, wsId),
    recentFeed: await recentFeed(pool, wsId),
    activeSandboxes: await activeSandboxes(pool, wsId),
  };
}

async function activeRuns(pool: Pool, wsId: string): Promise<ActiveRunsStat> {
  const { rows } = await pool.query(
    `SELECT status, count(*)::int AS n
       FROM jm_workflow_instances
      WHERE workspace_id = $1
        AND status IN ('running','pending','provisioning','paused')
      GROUP BY status`,
    [wsId],
  );
  const by: Record<string, number> = {};
  for (const r of rows) by[r.status] = r.n;
  const running = by.running ?? 0;
  const queued = (by.pending ?? 0) + (by.provisioning ?? 0);
  const paused = by.paused ?? 0;
  return { running, queued, paused, total: running + queued + paused };
}

async function needsAttention(pool: Pool, wsId: string): Promise<NeedsAttentionItem[]> {
  const { rows } = await pool.query(
    `SELECT id,
            COALESCE(workflow_name_snapshot, 'run') AS name,
            status,
            failed_at_node_id,
            (EXTRACT(EPOCH FROM (now() - COALESCE(completed_at, started_at, created_at))) * 1000)::bigint AS age_ms
       FROM jm_workflow_instances
      WHERE workspace_id = $1
        AND (status = 'paused'
             OR (status = 'failed' AND completed_at > now() - interval '1 hour'))
      ORDER BY COALESCE(completed_at, started_at, created_at) DESC
      LIMIT 20`,
    [wsId],
  );
  return rows.map((r) => ({
    instanceId: r.id,
    name: r.name,
    state: r.status as "paused" | "failed",
    nodeId: r.failed_at_node_id ?? null,
    ageMs: Number(r.age_ms),
  }));
}

async function recentFeed(pool: Pool, wsId: string): Promise<RecentFeedItem[]> {
  const { rows } = await pool.query(
    `SELECT id,
            COALESCE(workflow_name_snapshot, 'run') AS name,
            status,
            trigger_source,
            (EXTRACT(EPOCH FROM (COALESCE(completed_at, now()) - COALESCE(started_at, created_at))) * 1000)::bigint AS elapsed_ms
       FROM jm_workflow_instances
      WHERE workspace_id = $1
      ORDER BY created_at DESC
      LIMIT 10`,
    [wsId],
  );
  return rows.map((r) => ({
    instanceId: r.id,
    name: r.name,
    status: r.status,
    trigger: r.trigger_source,
    elapsedMs: Number(r.elapsed_ms),
  }));
}

async function activeSandboxes(pool: Pool, wsId: string): Promise<ActiveSandboxesStat> {
  const { rows } = await pool.query(
    `SELECT s.type, count(*)::int AS n
       FROM jm_sandbox_instances s
       JOIN jm_workflow_instances r ON s.run_id = r.id
      WHERE r.workspace_id = $1
        AND s.status = 'active'
      GROUP BY s.type`,
    [wsId],
  );
  const byType: Record<string, number> = {};
  let total = 0;
  for (const r of rows) { byType[r.type] = r.n; total += r.n; }
  return { total, byType };
}
```

- [ ] **Step 2: Verify**

Run: `npm run typecheck -w @journeyman/analytics`
Expected: PASS.

---

## Task 5: Run-trend queries

**Files:**
- Create: `packages/analytics/src/db/runs.ts`

All queries window on `created_at >= $2` (always present; `DEFAULT now()`).

- [ ] **Step 1: Write the implementation**

Create `packages/analytics/src/db/runs.ts`:

```typescript
import type { Pool } from "pg";
import type { DayCount, OutcomeSplit, DurationStat, FailurePoint } from "@journeyman/core";

export async function runVolume(pool: Pool, wsId: string, since: Date): Promise<DayCount[]> {
  const { rows } = await pool.query(
    `SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day, count(*)::int AS n
       FROM jm_workflow_instances
      WHERE workspace_id = $1 AND created_at >= $2
      GROUP BY 1 ORDER BY 1`,
    [wsId, since],
  );
  return rows.map((r) => ({ day: r.day, count: r.n }));
}

export async function outcomeSplit(pool: Pool, wsId: string, since: Date): Promise<OutcomeSplit> {
  const { rows } = await pool.query(
    `SELECT status, count(*)::int AS n
       FROM jm_workflow_instances
      WHERE workspace_id = $1 AND created_at >= $2
        AND status IN ('completed','failed','cancelled')
      GROUP BY status`,
    [wsId, since],
  );
  const by: Record<string, number> = {};
  for (const r of rows) by[r.status] = r.n;
  const completed = by.completed ?? 0;
  const failed = by.failed ?? 0;
  const cancelled = by.cancelled ?? 0;
  const denom = completed + failed + cancelled;
  return { completed, failed, cancelled, successRate: denom === 0 ? 0 : completed / denom };
}

export async function durationStat(pool: Pool, wsId: string, since: Date): Promise<DurationStat> {
  const trendRes = await pool.query(
    `SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_ms)::bigint AS median
       FROM jm_workflow_instances
      WHERE workspace_id = $1 AND created_at >= $2 AND duration_ms IS NOT NULL
      GROUP BY 1 ORDER BY 1`,
    [wsId, since],
  );
  const trend = trendRes.rows.map((r) => ({ day: r.day, medianMs: Number(r.median) }));

  const overallRes = await pool.query(
    `SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_ms)::bigint AS median
       FROM jm_workflow_instances
      WHERE workspace_id = $1 AND created_at >= $2 AND duration_ms IS NOT NULL`,
    [wsId, since],
  );
  const medianMs = Number(overallRes.rows[0]?.median ?? 0);

  let deltaPct = 0;
  if (trend.length >= 2) {
    const first = trend[0].medianMs;
    const last = trend[trend.length - 1].medianMs;
    if (first > 0) deltaPct = (last - first) / first;
  }
  return { medianMs, trend, deltaPct };
}

export async function byTrigger(pool: Pool, wsId: string, since: Date): Promise<Record<string, number>> {
  const { rows } = await pool.query(
    `SELECT trigger_source, count(*)::int AS n
       FROM jm_workflow_instances
      WHERE workspace_id = $1 AND created_at >= $2
      GROUP BY trigger_source`,
    [wsId, since],
  );
  const total = rows.reduce((s, r) => s + r.n, 0);
  const out: Record<string, number> = {};
  for (const r of rows) out[r.trigger_source] = total === 0 ? 0 : r.n / total;
  return out;
}

export async function topFailures(pool: Pool, wsId: string, since: Date): Promise<FailurePoint[]> {
  const { rows } = await pool.query(
    `SELECT failed_at_node_id AS node_id, count(*)::int AS n
       FROM jm_workflow_instances
      WHERE workspace_id = $1 AND created_at >= $2
        AND status = 'failed' AND failed_at_node_id IS NOT NULL
      GROUP BY failed_at_node_id
      ORDER BY n DESC
      LIMIT 5`,
    [wsId, since],
  );
  return rows.map((r) => ({ nodeId: r.node_id ?? null, count: r.n }));
}
```

- [ ] **Step 2: Verify**

Run: `npm run typecheck -w @journeyman/analytics`
Expected: PASS.

---

## Task 6: Token aggregation query

**Files:**
- Create: `packages/analytics/src/db/tokens.ts`

Reference: `jm_token_usage(workspace_id, provider, vendor, total_tokens, created_at, cost_usd)`. `cost_usd` is null this phase.

- [ ] **Step 1: Write the implementation**

Create `packages/analytics/src/db/tokens.ts`:

```typescript
import type { Pool } from "pg";
import type { TokenStat } from "@journeyman/core";

export async function tokenStat(pool: Pool, wsId: string, since: Date): Promise<TokenStat> {
  const { rows } = await pool.query(
    `SELECT provider,
            COALESCE(vendor, 'unknown') AS vendor,
            COALESCE(SUM(total_tokens), 0)::bigint AS tokens
       FROM jm_token_usage
      WHERE workspace_id = $1 AND created_at >= $2
      GROUP BY provider, COALESCE(vendor, 'unknown')`,
    [wsId, since],
  );
  const byProvider: Record<string, number> = {};
  const byVendor: Record<string, number> = {};
  let total = 0;
  for (const r of rows) {
    const t = Number(r.tokens);
    total += t;
    byProvider[r.provider] = (byProvider[r.provider] ?? 0) + t;
    byVendor[r.vendor] = (byVendor[r.vendor] ?? 0) + t;
  }
  return { total, byProvider, byVendor, costUsd: null };
}
```

- [ ] **Step 2: Verify**

Run: `npm run typecheck -w @journeyman/analytics`
Expected: PASS.

---

## Task 7: Agent stats queries

**Files:**
- Create: `packages/analytics/src/db/agents.ts`

Reference: `jm_agents(id, workspace_id, status, enabled, name)`; `jm_token_usage(agent_id, provider, total_tokens, workflow_instance_id, created_at, workspace_id)`; `jm_workflow_instances(inputs jsonb → 'agentId', status, duration_ms, created_at, workspace_id)`. `jm_agent_run_counters` is dormant — activity is computed live here.

- [ ] **Step 1: Write the implementation**

Create `packages/analytics/src/db/agents.ts`:

```typescript
import type { Pool } from "pg";
import type {
  AgentStats, AgentInventory, DayCount, AgentLeaderboardRow,
} from "@journeyman/core";

export async function agentStats(pool: Pool, wsId: string, since: Date): Promise<AgentStats> {
  return {
    inventory: await inventory(pool, wsId),
    providerMix: await providerMix(pool, wsId, since),
    activityPerDay: await activityPerDay(pool, wsId, since),
    leaderboard: await leaderboard(pool, wsId, since),
  };
}

async function inventory(pool: Pool, wsId: string): Promise<AgentInventory> {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE status = 'active')::int AS active,
            count(*) FILTER (WHERE status = 'draft')::int AS draft,
            count(*) FILTER (WHERE enabled)::int AS enabled
       FROM jm_agents
      WHERE workspace_id = $1`,
    [wsId],
  );
  const r = rows[0] ?? {};
  return { total: r.total ?? 0, active: r.active ?? 0, draft: r.draft ?? 0, enabled: r.enabled ?? 0 };
}

async function providerMix(pool: Pool, wsId: string, since: Date): Promise<Record<string, number>> {
  const { rows } = await pool.query(
    `SELECT provider, count(DISTINCT workflow_instance_id)::int AS n
       FROM jm_token_usage
      WHERE workspace_id = $1 AND created_at >= $2 AND agent_id IS NOT NULL
      GROUP BY provider`,
    [wsId, since],
  );
  const total = rows.reduce((s, r) => s + r.n, 0);
  const out: Record<string, number> = {};
  for (const r of rows) out[r.provider] = total === 0 ? 0 : r.n / total;
  return out;
}

async function activityPerDay(pool: Pool, wsId: string, since: Date): Promise<DayCount[]> {
  const { rows } = await pool.query(
    `SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day,
            count(DISTINCT workflow_instance_id)::int AS n
       FROM jm_token_usage
      WHERE workspace_id = $1 AND created_at >= $2 AND agent_id IS NOT NULL
      GROUP BY 1 ORDER BY 1`,
    [wsId, since],
  );
  return rows.map((r) => ({ day: r.day, count: r.n }));
}

async function leaderboard(pool: Pool, wsId: string, since: Date): Promise<AgentLeaderboardRow[]> {
  // runs / success / duration from instances (agent id lives in inputs->>'agentId')
  const instRes = await pool.query(
    `SELECT inputs->>'agentId' AS agent_id,
            count(*)::int AS runs,
            count(*) FILTER (WHERE status = 'completed')::int AS completed,
            COALESCE(AVG(duration_ms) FILTER (WHERE duration_ms IS NOT NULL), 0)::bigint AS avg_dur
       FROM jm_workflow_instances
      WHERE workspace_id = $1 AND created_at >= $2 AND inputs->>'agentId' IS NOT NULL
      GROUP BY 1`,
    [wsId, since],
  );
  // tokens + provider from token usage
  const tokRes = await pool.query(
    `SELECT agent_id,
            COALESCE(SUM(total_tokens), 0)::bigint AS tokens,
            (array_agg(provider ORDER BY created_at DESC))[1] AS provider
       FROM jm_token_usage
      WHERE workspace_id = $1 AND created_at >= $2 AND agent_id IS NOT NULL
      GROUP BY agent_id`,
    [wsId, since],
  );
  // names
  const nameRes = await pool.query(
    `SELECT id, name FROM jm_agents WHERE workspace_id = $1`,
    [wsId],
  );

  const tokens = new Map<string, { tokens: number; provider: string | null }>();
  for (const r of tokRes.rows) tokens.set(r.agent_id, { tokens: Number(r.tokens), provider: r.provider ?? null });
  const names = new Map<string, string>();
  for (const r of nameRes.rows) names.set(r.id, r.name);

  const out: AgentLeaderboardRow[] = instRes.rows.map((r) => {
    const agentId = r.agent_id as string;
    const tk = tokens.get(agentId);
    return {
      agentId,
      name: names.get(agentId) ?? agentId,
      provider: tk?.provider ?? null,
      runs: r.runs,
      tokens: tk?.tokens ?? 0,
      successRate: r.runs === 0 ? 0 : r.completed / r.runs,
      avgDurationMs: Number(r.avg_dur),
    };
  });
  out.sort((a, b) => b.runs - a.runs);
  return out.slice(0, 10);
}
```

- [ ] **Step 2: Verify**

Run: `npm run typecheck -w @journeyman/analytics`
Expected: PASS.

---

## Task 8: Overview composer

**Files:**
- Create: `packages/analytics/src/db/overview.ts`

- [ ] **Step 1: Write the implementation**

Create `packages/analytics/src/db/overview.ts`:

```typescript
import type { Pool } from "pg";
import type { OverviewStats, AnalyticsWindow } from "@journeyman/core";
import { windowSince } from "../window.ts";
import { runVolume, outcomeSplit, durationStat, byTrigger, topFailures } from "./runs.ts";
import { tokenStat } from "./tokens.ts";
import { agentStats } from "./agents.ts";

export async function getOverviewStats(
  pool: Pool,
  wsId: string,
  window: AnalyticsWindow,
): Promise<OverviewStats> {
  const since = windowSince(window, new Date());
  const [runVol, outcome, duration, triggers, tokens, failures, agents] = await Promise.all([
    runVolume(pool, wsId, since),
    outcomeSplit(pool, wsId, since),
    durationStat(pool, wsId, since),
    byTrigger(pool, wsId, since),
    tokenStat(pool, wsId, since),
    topFailures(pool, wsId, since),
    agentStats(pool, wsId, since),
  ]);
  return {
    window,
    runVolume: runVol,
    outcomeSplit: outcome,
    duration,
    byTrigger: triggers,
    tokens,
    topFailures: failures,
    agents,
  };
}
```

- [ ] **Step 2: Verify**

Run: `npm run typecheck -w @journeyman/analytics`
Expected: PASS.

---

## Task 9: Auth-guarded routes

**Files:**
- Create: `packages/analytics/src/routes/index.ts`

Pattern (verbatim from `packages/secrets/src/routes/workspace-secrets.ts`): build `requireAuth`/`requirePerm` from the pool, guard each route, read `:wsId` from params.

- [ ] **Step 1: Write the implementation**

Create `packages/analytics/src/routes/index.ts`:

```typescript
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { makeRequireAuth, makeRequireWorkspacePermission } from "@journeyman/identity";
import { getLiveStats } from "../db/live.ts";
import { getOverviewStats } from "../db/overview.ts";
import { parseWindow } from "../window.ts";

export async function registerAnalyticsRoutes(app: FastifyInstance, pool: Pool) {
  const requireAuth = makeRequireAuth({ pool });
  const requirePerm = makeRequireWorkspacePermission({ pool });

  app.get(
    "/api/analytics/workspaces/:wsId/live",
    { preHandler: [requireAuth(), requirePerm("resource.read")] },
    async (req) => {
      const { wsId } = req.params as { wsId: string };
      return await getLiveStats(pool, wsId);
    },
  );

  app.get(
    "/api/analytics/workspaces/:wsId/overview",
    { preHandler: [requireAuth(), requirePerm("resource.read")] },
    async (req) => {
      const { wsId } = req.params as { wsId: string };
      const { window } = req.query as { window?: string };
      return await getOverviewStats(pool, wsId, parseWindow(window));
    },
  );
}
```

> NOTE: `"resource.read"` is the workspace read-permission string used across the codebase (see `packages/secrets/src/routes/workspace-secrets.ts`). Confirm it is a valid `WorkspacePermission` in `@journeyman/identity`; if a more specific analytics permission exists, use it, otherwise `resource.read` is correct.

- [ ] **Step 2: Verify**

Run: `npm run typecheck -w @journeyman/analytics`
Expected: PASS.

---

## Task 10: Server bootstrap + standalone entrypoint + exports

**Files:**
- Create: `packages/analytics/src/server.ts`
- Create: `packages/analytics/src/cli-start.ts`
- Create: `packages/analytics/src/index.ts`

- [ ] **Step 1: Create `packages/analytics/src/server.ts`**

```typescript
import Fastify from "fastify";
import cors from "@fastify/cors";
import sensible from "@fastify/sensible";
import type { Pool } from "pg";
import type { FastifyInstance } from "fastify";
import { registerAnalyticsRoutes } from "./routes/index.ts";

export async function buildAnalyticsServer(pool: Pool): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" } });
  await app.register(cors, { origin: true, credentials: true });
  await app.register(sensible);

  app.get("/healthz", async () => ({ ok: true }));
  await registerAnalyticsRoutes(app, pool);

  return app;
}
```

- [ ] **Step 2: Create `packages/analytics/src/cli-start.ts`**

```typescript
import { Pool } from "pg";
import { buildAnalyticsServer } from "./server.ts";

const databaseUrl =
  process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5433/journeyman";
const pool = new Pool({ connectionString: databaseUrl, max: Number(process.env.PG_MAX ?? 10) });

const server = await buildAnalyticsServer(pool);
const port = Number(process.env.PORT ?? 4002);
await server.listen({ port, host: "0.0.0.0" });
server.log.info({ port }, "analytics service listening");

const shutdown = async () => {
  await server.close();
  await pool.end();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
```

> NOTE: the analytics service must run with the **same identity/JWT environment** as `api-server` so token verification matches. Copy the auth-related env vars (e.g. `IDENTITY_ENFORCE` and any JWT secret env) from `packages/api-server/src/cli-start.ts` / `compose.deploy.yml` into the analytics deployment in Task 15.

- [ ] **Step 3: Create `packages/analytics/src/index.ts`**

```typescript
export { registerAnalyticsRoutes } from "./routes/index.ts";
export { buildAnalyticsServer } from "./server.ts";
```

- [ ] **Step 4: Verify**

Run: `npm run typecheck -w @journeyman/analytics`
Expected: PASS.

---

## Task 11: Web API client + formatters (TDD on formatters)

**Files:**
- Create: `packages/web/src/api/analytics.ts`
- Create: `packages/workspace-dashboard/src/format.ts`
- Test: `packages/workspace-dashboard/src/format.test.ts`

> The frontend package is scaffolded in Task 12; the formatter file + test created here are pure and verified with the dashboard package's own vitest in Task 16. If running tests now, do Task 12 Step 1–2 first so the package resolves.

- [ ] **Step 1: Create the web API client**

Create `packages/web/src/api/analytics.ts`:

```typescript
import { api } from "./client.ts";
import type { LiveStats, OverviewStats, AnalyticsWindow } from "@journeyman/core";

export function getLiveStats(wsId: string): Promise<LiveStats> {
  return api<LiveStats>(`/api/analytics/workspaces/${encodeURIComponent(wsId)}/live`);
}

export function getOverview(wsId: string, window: AnalyticsWindow): Promise<OverviewStats> {
  const qs = new URLSearchParams({ window });
  return api<OverviewStats>(
    `/api/analytics/workspaces/${encodeURIComponent(wsId)}/overview?${qs.toString()}`,
  );
}
```

> NOTE: confirm `api` is exported from `packages/web/src/api/client.ts` (it is, per the existing `runs.ts`). Match the import extension convention used by neighboring files in `packages/web/src/api/`.

- [ ] **Step 2: Write the failing formatter test**

Create `packages/workspace-dashboard/src/format.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { formatTokens, formatDuration } from "./format.ts";

describe("formatTokens", () => {
  it("formats millions", () => expect(formatTokens(4_200_000)).toBe("4.2M"));
  it("formats thousands", () => expect(formatTokens(12_300)).toBe("12.3K"));
  it("passes small numbers through", () => expect(formatTokens(842)).toBe("842"));
  it("handles zero", () => expect(formatTokens(0)).toBe("0"));
});

describe("formatDuration", () => {
  it("formats minutes and seconds", () => expect(formatDuration(221_000)).toBe("3m 41s"));
  it("formats seconds only", () => expect(formatDuration(40_000)).toBe("40s"));
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npm test -w @journeyman/workspace-dashboard`
Expected: FAIL — cannot find `./format.ts` (or package not found — complete Task 12 Step 1–2 first, then re-run).

- [ ] **Step 4: Implement the formatters**

Create `packages/workspace-dashboard/src/format.ts`:

```typescript
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function formatDuration(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return m > 0 ? `${m}m ${String(s).padStart(2, "0")}s` : `${s}s`;
}

export function formatAgo(ms: number): string {
  return formatDuration(ms) + " ago";
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npm test -w @journeyman/workspace-dashboard`
Expected: PASS (6 tests).

---

## Task 12: Scaffold `@journeyman/workspace-dashboard` package

**Files:**
- Create: `packages/workspace-dashboard/package.json`
- Create: `packages/workspace-dashboard/tsconfig.json`

- [ ] **Step 1: Create `packages/workspace-dashboard/package.json`**

```json
{
  "name": "@journeyman/workspace-dashboard",
  "version": "0.1.0",
  "description": "Workspace dashboard — live + historical stats page.",
  "type": "module",
  "main": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "files": ["src"],
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "peerDependencies": {
    "react": "^19.2.7",
    "react-dom": "^19.2.7"
  },
  "dependencies": {
    "@journeyman/core": "*"
  },
  "devDependencies": {
    "@types/react": "^19.2.17",
    "@types/react-dom": "^19.2.3",
    "react": "^19.2.7",
    "react-dom": "^19.2.7",
    "typescript": "^6.0.3",
    "vitest": "^4.1.8"
  }
}
```

- [ ] **Step 2: Create `packages/workspace-dashboard/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "allowImportingTsExtensions": true,
    "noEmit": true,
    "resolveJsonModule": true,
    "rootDir": "./src"
  },
  "include": ["src/**/*"]
}
```

> NOTE: confirm `jsx` / `lib` settings match `packages/runs-list/tsconfig.json`; copy that file's compilerOptions if they differ.

- [ ] **Step 3: Link**

Run: `npm install`
Expected: completes; `@journeyman/workspace-dashboard` linked.

---

## Task 13: Dashboard widgets + bands + container

**Files:**
- Create: `packages/workspace-dashboard/src/widgets.tsx`
- Create: `packages/workspace-dashboard/src/LiveBand.tsx`
- Create: `packages/workspace-dashboard/src/TrendsBand.tsx`
- Create: `packages/workspace-dashboard/src/AgentsBand.tsx`
- Create: `packages/workspace-dashboard/src/Dashboard.tsx`
- Create: `packages/workspace-dashboard/src/index.ts`

- [ ] **Step 1: Create presentational primitives — `widgets.tsx`**

```tsx
import type { CSSProperties, ReactNode } from "react";

const BLUE = "#6aa9ff", GREEN = "#3ddc84", RED = "#ff6a6a", AMBER = "#ffc24b";
export const COLORS = { BLUE, GREEN, RED, AMBER };

export function Card({ title, cap, children, span }: {
  title: string; cap?: string; children: ReactNode; span?: boolean;
}) {
  const style: CSSProperties = {
    border: "1px solid rgba(127,127,127,.18)", borderRadius: 12, padding: 14,
    background: "rgba(127,127,127,.04)", gridColumn: span ? "1 / -1" : undefined,
  };
  return (
    <div style={style}>
      <h4 style={{ margin: "0 0 2px", fontSize: 13 }}>{title}</h4>
      {cap && <p style={{ fontSize: 11, opacity: 0.55, margin: "0 0 10px" }}>{cap}</p>}
      {children}
    </div>
  );
}

export function Kpi({ value, sub }: { value: ReactNode; sub?: { n: ReactNode; label: string; color?: string }[] }) {
  return (
    <div>
      <div style={{ fontSize: 34, fontWeight: 700, lineHeight: 1 }}>{value}</div>
      {sub && (
        <div style={{ display: "flex", gap: 14, marginTop: 10, fontSize: 12 }}>
          {sub.map((s, i) => (
            <span key={i}>
              <b style={{ display: "block", fontSize: 17, color: s.color }}>{s.n}</b>
              <span style={{ opacity: 0.6 }}>{s.label}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function Bars({ data, max }: { data: number[]; max?: number }) {
  const m = max ?? Math.max(1, ...data);
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 90 }}>
      {data.map((v, i) => (
        <div key={i} style={{
          flex: 1, height: `${(v / m) * 100}%`, minHeight: 2,
          background: `linear-gradient(180deg, ${BLUE}, rgba(106,169,255,.35))`,
          borderRadius: "3px 3px 0 0",
        }} />
      ))}
    </div>
  );
}

export function HBars({ rows }: { rows: { label: string; frac: number; valueText: string; color?: string }[] }) {
  return (
    <div>
      {rows.map((r, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, margin: "7px 0" }}>
          <span style={{ width: 78, opacity: 0.8 }}>{r.label}</span>
          <span style={{ flex: 1, height: 8, background: "rgba(127,127,127,.15)", borderRadius: 5, overflow: "hidden" }}>
            <span style={{ display: "block", height: "100%", width: `${Math.round(r.frac * 100)}%`, background: r.color ?? BLUE, borderRadius: 5 }} />
          </span>
          <span style={{ width: 48, textAlign: "right", opacity: 0.6, fontSize: 11 }}>{r.valueText}</span>
        </div>
      ))}
    </div>
  );
}

export function Donut({ segments }: { segments: { value: number; color: string; label: string }[] }) {
  const total = Math.max(1, segments.reduce((s, x) => s + x.value, 0));
  const C = 2 * Math.PI * 34;
  let offset = 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
      <svg width="92" height="92" viewBox="0 0 92 92">
        <circle cx="46" cy="46" r="34" fill="none" stroke="rgba(127,127,127,.18)" strokeWidth="13" />
        {segments.map((s, i) => {
          const len = (s.value / total) * C;
          const el = (
            <circle key={i} cx="46" cy="46" r="34" fill="none" stroke={s.color} strokeWidth="13"
              strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-offset}
              transform="rotate(-90 46 46)" />
          );
          offset += len;
          return el;
        })}
      </svg>
      <div style={{ fontSize: 12 }}>
        {segments.map((s, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 7, padding: "2px 0" }}>
            <span style={{ width: 9, height: 9, borderRadius: 2, background: s.color }} />
            {s.label} · {s.value}
          </div>
        ))}
      </div>
    </div>
  );
}

export function Sparkline({ points }: { points: number[] }) {
  if (points.length === 0) return <div style={{ height: 90, opacity: 0.4, fontSize: 12 }}>no data</div>;
  const max = Math.max(1, ...points), min = Math.min(...points);
  const span = Math.max(1, max - min);
  const step = points.length > 1 ? 260 / (points.length - 1) : 260;
  const coords = points.map((p, i) => `${i * step},${90 - ((p - min) / span) * 70 - 10}`).join(" ");
  return (
    <svg width="100%" height="90" viewBox="0 0 260 90" preserveAspectRatio="none">
      <polyline fill="none" stroke={BLUE} strokeWidth="2.5" points={coords} />
    </svg>
  );
}
```

- [ ] **Step 2: Create `LiveBand.tsx`**

```tsx
import type { LiveStats } from "@journeyman/core";
import { Card, Kpi, COLORS } from "./widgets.tsx";
import { formatDuration } from "./format.ts";

const dotColor: Record<string, string> = {
  running: COLORS.BLUE, completed: COLORS.GREEN, failed: COLORS.RED,
  paused: COLORS.AMBER, pending: COLORS.AMBER, provisioning: COLORS.AMBER, cancelled: "rgba(127,127,127,.5)",
};

export function LiveBand({ data }: { data: LiveStats }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
      <Card title="Active runs" cap="happening right now">
        <Kpi value={data.activeRuns.total} sub={[
          { n: data.activeRuns.running, label: "running", color: COLORS.GREEN },
          { n: data.activeRuns.queued, label: "queued" },
          { n: data.activeRuns.paused, label: "paused", color: COLORS.AMBER },
        ]} />
      </Card>

      <Card title="Needs attention" cap="paused or failed < 1h">
        {data.needsAttention.length === 0 && <p style={{ fontSize: 12, opacity: 0.5 }}>All clear</p>}
        {data.needsAttention.slice(0, 4).map((a) => (
          <div key={a.instanceId} style={{ display: "flex", gap: 8, padding: "6px 0", fontSize: 12, borderBottom: "1px solid rgba(127,127,127,.1)" }}>
            <span style={{ color: a.state === "failed" ? COLORS.RED : COLORS.AMBER }}>{a.state === "failed" ? "✕" : "⏸"}</span>
            <div><b>{a.name}</b><div style={{ opacity: 0.6 }}>{a.nodeId ?? a.state} · {formatDuration(a.ageMs)}</div></div>
          </div>
        ))}
      </Card>

      <Card title="Live run feed" cap="latest activity">
        {data.recentFeed.map((f) => (
          <div key={f.instanceId} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", fontSize: 12, borderBottom: "1px solid rgba(127,127,127,.1)" }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: dotColor[f.status] ?? COLORS.BLUE }} />
            <span style={{ fontWeight: 600 }}>{f.name}</span>
            <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 8, background: "rgba(127,127,127,.15)" }}>{f.trigger}</span>
            <span style={{ marginLeft: "auto", opacity: 0.55, fontSize: 11 }}>{f.status} · {formatDuration(f.elapsedMs)}</span>
          </div>
        ))}
      </Card>

      <Card title="Sandboxes up" cap="provisioned environments">
        <Kpi value={data.activeSandboxes.total}
          sub={Object.entries(data.activeSandboxes.byType).map(([k, v]) => ({ n: v, label: k }))} />
      </Card>
    </div>
  );
}
```

- [ ] **Step 3: Create `TrendsBand.tsx`**

```tsx
import type { OverviewStats } from "@journeyman/core";
import { Card, Bars, HBars, Donut, Sparkline, Kpi, COLORS } from "./widgets.tsx";
import { formatTokens, formatDuration } from "./format.ts";

export function TrendsBand({ data }: { data: OverviewStats }) {
  const vol = data.runVolume;
  const total = vol.reduce((s, d) => s + d.count, 0);
  const o = data.outcomeSplit;
  const tk = data.tokens;
  const tkMax = Math.max(1, ...Object.values(tk.byProvider));

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
      <Card title="Run volume" cap={`runs per day · ${total} total`}>
        <Bars data={vol.map((d) => d.count)} />
      </Card>

      <Card title="Success vs failure" cap={`${Math.round(o.successRate * 100)}% success rate`}>
        <Donut segments={[
          { value: o.completed, color: COLORS.GREEN, label: "Completed" },
          { value: o.failed, color: COLORS.RED, label: "Failed" },
          { value: o.cancelled, color: "rgba(127,127,127,.4)", label: "Cancelled" },
        ]} />
      </Card>

      <Card title="Avg run duration" cap={`median ${formatDuration(data.duration.medianMs)} · ${data.duration.deltaPct <= 0 ? "↓" : "↑"} ${Math.abs(Math.round(data.duration.deltaPct * 100))}%`}>
        <Sparkline points={data.duration.trend.map((t) => t.medianMs)} />
      </Card>

      <Card title="Runs by trigger" cap="how work enters">
        <HBars rows={Object.entries(data.byTrigger).map(([label, frac]) => ({
          label, frac, valueText: `${Math.round(frac * 100)}%`,
        }))} />
      </Card>

      <Card title="Token usage" cap={`${formatTokens(tk.total)} tokens · $ later`}>
        <div style={{ fontSize: 26, fontWeight: 700 }}>{formatTokens(tk.total)}</div>
        <div style={{ marginTop: 12 }}>
          <HBars rows={Object.entries(tk.byProvider).map(([label, v]) => ({
            label, frac: v / tkMax, valueText: formatTokens(v),
          }))} />
        </div>
      </Card>

      <Card title="Top failure points" cap="where runs break">
        {data.topFailures.length === 0 && <p style={{ fontSize: 12, opacity: 0.5 }}>No failures</p>}
        {data.topFailures.map((f, i) => (
          <div key={i} style={{ display: "flex", padding: "6px 0", fontSize: 12, borderBottom: "1px solid rgba(127,127,127,.1)" }}>
            <span>{f.nodeId ?? "unknown"}</span>
            <span style={{ marginLeft: "auto", color: COLORS.RED, fontWeight: 600 }}>{f.count}</span>
          </div>
        ))}
      </Card>
    </div>
  );
}
```

- [ ] **Step 4: Create `AgentsBand.tsx`**

```tsx
import type { AgentStats } from "@journeyman/core";
import { Card, Bars, HBars, Kpi, COLORS } from "./widgets.tsx";
import { formatTokens, formatDuration } from "./format.ts";

export function AgentsBand({ data }: { data: AgentStats }) {
  const mixMax = Math.max(1e-9, ...Object.values(data.providerMix));
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
      <Card title="Inventory" cap="workspace roster">
        <Kpi value={data.inventory.total} sub={[
          { n: data.inventory.active, label: "active", color: COLORS.GREEN },
          { n: data.inventory.draft, label: "draft" },
          { n: data.inventory.enabled, label: "enabled" },
        ]} />
      </Card>

      <Card title="Provider / model mix" cap="runs by provider">
        <HBars rows={Object.entries(data.providerMix).map(([label, frac]) => ({
          label, frac: frac / mixMax, valueText: `${Math.round(frac * 100)}%`,
        }))} />
      </Card>

      <Card title="Activity / day" cap="runs across all agents">
        <Bars data={data.activityPerDay.map((d) => d.count)} />
      </Card>

      <Card title="Leaderboard" cap="per-agent over the window" span>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ textAlign: "left", opacity: 0.5, fontSize: 10, textTransform: "uppercase" }}>
              <th>Agent</th><th>Provider</th>
              <th style={{ textAlign: "right" }}>Runs</th>
              <th style={{ textAlign: "right" }}>Tokens</th>
              <th style={{ textAlign: "right" }}>Success</th>
              <th style={{ textAlign: "right" }}>Avg dur</th>
            </tr>
          </thead>
          <tbody>
            {data.leaderboard.map((r) => (
              <tr key={r.agentId} style={{ borderTop: "1px solid rgba(127,127,127,.1)" }}>
                <td style={{ padding: "6px 0", fontWeight: 600 }}>{r.name}</td>
                <td style={{ opacity: 0.6 }}>{r.provider ?? "—"}</td>
                <td style={{ textAlign: "right" }}>{r.runs}</td>
                <td style={{ textAlign: "right" }}>{formatTokens(r.tokens)}</td>
                <td style={{ textAlign: "right", color: r.successRate >= 0.85 ? COLORS.GREEN : COLORS.AMBER }}>{Math.round(r.successRate * 100)}%</td>
                <td style={{ textAlign: "right" }}>{formatDuration(r.avgDurationMs)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
```

- [ ] **Step 5: Create `Dashboard.tsx`**

```tsx
import { useState } from "react";
import type { AnalyticsWindow, LiveStats, OverviewStats } from "@journeyman/core";
import { LiveBand } from "./LiveBand.tsx";
import { TrendsBand } from "./TrendsBand.tsx";
import { AgentsBand } from "./AgentsBand.tsx";

export interface DashboardProps {
  live: LiveStats | null;
  overview: OverviewStats | null;
  window: AnalyticsWindow;
  onWindowChange: (w: AnalyticsWindow) => void;
  loading?: boolean;
}

const WINDOWS: AnalyticsWindow[] = ["24h", "7d", "30d"];
const bandHdr: React.CSSProperties = {
  fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase",
  opacity: 0.55, fontWeight: 700, margin: "22px 0 10px",
};

export function Dashboard({ live, overview, window, onWindowChange, loading }: DashboardProps) {
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <h2 style={{ margin: 0 }}>Dashboard</h2>
        <div style={{ display: "inline-flex", border: "1px solid rgba(127,127,127,.3)", borderRadius: 8, overflow: "hidden" }}>
          {WINDOWS.map((w) => (
            <button key={w} onClick={() => onWindowChange(w)} style={{
              padding: "5px 11px", border: "none", cursor: "pointer",
              background: w === window ? "#6aa9ff" : "transparent",
              color: w === window ? "#031227" : "inherit", fontWeight: w === window ? 600 : 400,
            }}>{w}</button>
          ))}
        </div>
      </div>

      <div style={bandHdr}>⚡ Live now</div>
      {live ? <LiveBand data={live} /> : <p style={{ opacity: 0.5 }}>Loading…</p>}

      <div style={bandHdr}>📈 Trends · last {window}</div>
      {overview ? <TrendsBand data={overview} /> : <p style={{ opacity: 0.5 }}>{loading ? "Loading…" : "No data"}</p>}

      <div style={bandHdr}>🤖 Agents</div>
      {overview ? <AgentsBand data={overview.agents} /> : <p style={{ opacity: 0.5 }}>{loading ? "Loading…" : "No data"}</p>}
    </div>
  );
}
```

- [ ] **Step 6: Create `index.ts`**

```typescript
export { Dashboard } from "./Dashboard.tsx";
export type { DashboardProps } from "./Dashboard.tsx";
export { formatTokens, formatDuration, formatAgo } from "./format.ts";
```

- [ ] **Step 7: Verify**

Run: `npm run typecheck -w @journeyman/workspace-dashboard`
Expected: PASS.

---

## Task 14: Wire the page into `@journeyman/web`

**Files:**
- Create: `packages/web/src/routes/DashboardPage.tsx`
- Modify: `packages/web/src/App.tsx`

- [ ] **Step 1: Create `DashboardPage.tsx`**

```tsx
import { useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { AnalyticsWindow } from "@journeyman/core";
import { Dashboard } from "@journeyman/workspace-dashboard";
import { getLiveStats, getOverview } from "../api/analytics.ts";

export function DashboardPage() {
  const { wsId = "" } = useParams<{ wsId: string }>();
  const [window, setWindow] = useState<AnalyticsWindow>("7d");

  const live = useQuery({
    queryKey: ["analytics-live", wsId],
    queryFn: () => getLiveStats(wsId),
    refetchInterval: 10_000,
    enabled: !!wsId,
  });

  const overview = useQuery({
    queryKey: ["analytics-overview", wsId, window],
    queryFn: () => getOverview(wsId, window),
    enabled: !!wsId,
  });

  return (
    <div style={{ padding: 20 }}>
      <Dashboard
        live={live.data ?? null}
        overview={overview.data ?? null}
        window={window}
        onWindowChange={setWindow}
        loading={overview.isLoading}
      />
    </div>
  );
}
```

> NOTE: match the exact import style of neighboring pages in `packages/web/src/routes/` — confirm `useParams`/router import path (`react-router-dom`) and that `@tanstack/react-query` `useQuery` is used the same way as in `RunsListPage.tsx`. Adjust the default export vs named export to match sibling pages.

- [ ] **Step 2: Register the route in `App.tsx`**

In `packages/web/src/App.tsx`, add an import alongside the other route-page imports:

```tsx
import { DashboardPage } from "./routes/DashboardPage.tsx";
```

And add a `<Route>` next to the existing `/workspaces/:wsId/workflow-instances` route:

```tsx
<Route path="/workspaces/:wsId/dashboard" element={<DashboardPage />} />
```

> NOTE: if sibling pages use default exports, change the import/usage accordingly. Optionally add a nav link to `/workspaces/:wsId/dashboard` wherever the workspace nav links (e.g. the "Runs"/"Flows" links) are rendered — search `packages/web/src` for the existing `/workflow-instances` `NavLink` and add a "Dashboard" entry beside it.

- [ ] **Step 3: Verify**

Run: `npm run typecheck -w @journeyman/web`
Expected: PASS.

---

## Task 15: Dev proxy + deployment wiring

**Files:**
- Modify: `packages/web/vite.config.ts`
- Modify: `Dockerfile`
- Modify: `compose.deploy.yml`
- Create: `deploy/k8s/base/analytics.yaml`
- Modify: `deploy/k8s/base/kustomization.yaml`, `deploy/k8s/base/ingress.yaml`

> These config files are not covered by typecheck. Apply them exactly; runtime verification is out of scope for this pass.

- [ ] **Step 1: Add the vite proxy rule**

In `packages/web/vite.config.ts`, add this entry **before** the generic `"/api"` entry in the `proxy` object so it matches first:

```typescript
"/api/analytics": {
  target: process.env.VITE_ANALYTICS_TARGET ?? "http://localhost:4002",
  changeOrigin: true,
},
```

- [ ] **Step 2: Add the `runtime-analytics` Dockerfile stage**

In `Dockerfile`, add a stage mirroring `runtime-api`:

```dockerfile
# ---------- runtime-analytics ----------
FROM node:22-alpine AS runtime-analytics
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache git openssh-client ca-certificates curl
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages ./packages
COPY . .
EXPOSE 4002
CMD ["npm", "run", "start", "-w", "@journeyman/analytics"]
```

- [ ] **Step 3: Add the `analytics` compose service**

In `compose.deploy.yml`, add a service mirroring `api-server` (copy its `environment` block verbatim so identity/JWT env matches), changing image/build target, port, and `PORT`:

```yaml
  analytics:
    image: journeyman/analytics:dev
    env_file: .env.production
    extra_hosts:
      - "host.docker.internal:host-gateway"
    environment:
      DATABASE_URL: postgres://postgres:postgres@postgres:5432/journeyman
      IDENTITY_ENFORCE: "true"
      NODE_ENV: production
      PORT: "4002"
    ports: ["6002:4002"]
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://localhost:4002/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 5s
      timeout: 5s
      retries: 20
    depends_on:
      migrations:
        condition: service_completed_successfully
```

> NOTE: copy any JWT-secret / auth env vars that `api-server` reads (check `.env.production` keys referenced in the api-server `environment` block) into this block — token verification must use the same secret.

- [ ] **Step 4: Add the k8s Deployment + Service**

Create `deploy/k8s/base/analytics.yaml` mirroring `deploy/k8s/base/api-server.yaml` (same env/secret/configmap refs), with `containerPort: 4002`, service name `analytics`, service port `4002`, and the start command `npm run start -w @journeyman/analytics`. Then add `- analytics.yaml` to the `resources:` list in `deploy/k8s/base/kustomization.yaml`.

- [ ] **Step 5: Add the ingress rule**

In `deploy/k8s/base/ingress.yaml`, add a path rule for `/api/analytics` → `analytics:4002` **before** the existing `/api` → `api-server` rule (more specific path must precede the general one):

```yaml
  - path: /api/analytics
    pathType: Prefix
    backend:
      service:
        name: analytics
        port:
          number: 4002
```

---

## Task 16: Final verification (typecheck gate)

**Files:** none (verification only)

- [ ] **Step 1: Install / relink workspaces**

Run: `npm install`
Expected: completes with both new packages linked, no errors.

- [ ] **Step 2: Run the pure unit tests**

Run: `npm test -w @journeyman/analytics && npm test -w @journeyman/workspace-dashboard`
Expected: PASS — `window.test.ts` (3) and `format.test.ts` (6).

- [ ] **Step 3: Typecheck the whole workspace**

Run: `npm run typecheck`
Expected: PASS for all packages, including `@journeyman/core`, `@journeyman/analytics`, `@journeyman/workspace-dashboard`, and `@journeyman/web`.

- [ ] **Step 4: Import-boundary check**

Run: `npm run check:boundaries`
Expected: PASS. If it flags `@journeyman/analytics` importing `@journeyman/identity`/`@journeyman/core`, or `@journeyman/web` importing `@journeyman/workspace-dashboard`, update the allow-list in [scripts/check-import-boundaries.mjs](../../../scripts/check-import-boundaries.mjs) to permit them (these mirror existing api-server → identity and web → runs-list edges).

- [ ] **Step 5: Full check**

Run: `npm run check`
Expected: PASS (typecheck + boundaries). **Do not commit** — leave all changes in the working tree on `master`.

---

## Self-Review Notes

- **Spec coverage:** All 14 widgets map to tasks — live band (Task 4 → LiveBand), trends (Tasks 5–6 → TrendsBand), agents (Task 7 → AgentsBand). Two endpoints (Task 9), standalone service (Task 10), two packages + core types (Tasks 1, 2, 12), web integration (Tasks 11, 14), deployment (Task 15).
- **Deferred per spec:** dollar cost (`costUsd: null`), rollup tables (`jm_agent_run_counters` unused — activity computed live), custom date ranges, CSV export.
- **Type consistency:** DTO names in Task 1 (`LiveStats`, `OverviewStats`, `AgentStats`, `FailurePoint` without `stepType`, etc.) are used verbatim in Tasks 4–10 (backend) and 11–13 (frontend).
- **Constraint compliance:** no commit steps anywhere; single typecheck/boundaries gate at Task 16; all on `master`.
