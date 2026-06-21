# Usage & Cost Dashboard — Design

**Date:** 2026-06-21
**Status:** Approved (pending spec review)
**Scope:** A workspace-scoped "Usage & Cost" dashboard built on the existing `jm_token_usage`
data, plus a pricing layer that converts recorded tokens into dollars.

## Problem

`jm_token_usage` already records detailed per-call token counts (input, output, cache-read,
cache-creation, reasoning, total) tagged with workspace, org, workflow, workflow version, step,
agent, provider/vendor/model, outcome, and attempt. But:

- There is **no dashboard** surfacing this data — only a single small "token usage" tile on the
  existing workspace dashboard.
- `jm_token_usage.cost_usd` exists but is **reserved and always NULL** — there is no pricing
  data anywhere in the system (the original `jm_coding_models` cost columns were dropped in
  migration 020).

We want one page that answers four questions: **cost monitoring** (what are we spending and is
it spiking), **optimization** (which models/agents/steps/workflows are inefficient),
**forensic drill-down** (why did this run cost so much), and **capacity/trends** (how is usage
growing).

## Goals

- Turn recorded token usage into dollar cost via an org-scoped, versioned pricing table.
- Ship a dedicated workspace-scoped page that serves all four questions above.
- Reuse existing infrastructure: the `@journeyman/orchestrator` usage query builders, the
  standalone analytics service, the coding-models admin, and the no-charting-library frontend
  convention.

## Non-Goals (YAGNI)

- Org-wide rollup across all workspaces (workspace-scoped only for v1).
- Per-agent token-trend sparklines and agent×model heatmaps (interesting, not decision-driving
  on day one).
- Multi-currency conversion (a `currency` field is reserved, but everything renders in its
  stored currency; no FX).
- Budgets/alerts/quotas (future work — this is a reporting dashboard, not an enforcement layer).

---

## Architecture

Three layers: a **pricing layer** (new table + admin CRUD + write-time cost computation), a
**backend layer** (new aggregate endpoints on the analytics service), and a **frontend layer**
(new dashboard package wired into the web shell).

```
Pricing CRUD (coding-models admin)  ──writes──►  jm_model_pricing
                                                       │ (lookup at write time)
recordTokenUsage()  ──fills cost_usd──►  jm_token_usage
                                                       │ (SUM, GROUP BY)
analytics service  ──/api/analytics/workspaces/:wsId/usage──►  usage-dashboard page
```

### 1. Pricing layer

#### `jm_model_pricing` table (new migration)

Org-scoped and **versioned via effective dating**, so changing a price does not rewrite the cost
of historical usage.

| Column                  | Type          | Notes |
|-------------------------|---------------|-------|
| `id`                    | UUID PK       | |
| `org_id`                | UUID NOT NULL | FK `jm_orgs(id)` — pricing is org-scoped |
| `provider`              | TEXT NOT NULL | matches `jm_token_usage.provider` |
| `vendor`                | TEXT          | matches `jm_token_usage.vendor` |
| `model`                 | TEXT NOT NULL | matches `jm_token_usage.model` |
| `input_per_1m`          | NUMERIC(12,4) | $ per 1M input tokens |
| `output_per_1m`         | NUMERIC(12,4) | $ per 1M output tokens |
| `cache_read_per_1m`     | NUMERIC(12,4) | $ per 1M cache-read tokens |
| `cache_creation_per_1m` | NUMERIC(12,4) | $ per 1M cache-write tokens |
| `reasoning_per_1m`      | NUMERIC(12,4) | $ per 1M reasoning tokens (often equals output) |
| `currency`              | TEXT NOT NULL | default `'USD'` |
| `effective_from`        | TIMESTAMPTZ NOT NULL | when this price became active |
| `effective_to`         | TIMESTAMPTZ   | NULL = still active |
| `created_at`            | TIMESTAMPTZ   | default `now()` |
| `updated_at`            | TIMESTAMPTZ   | default `now()` |

Indexes:
- Lookup index on `(org_id, provider, model, effective_from DESC)` for resolving the active
  price quickly.
- A partial unique index enforcing **one active (NULL `effective_to`) row** per
  `(org_id, provider, COALESCE(vendor,''), model)` so there is never pricing ambiguity for "now".

**Price resolution:** for a usage row with `(org_id, provider, vendor, model, created_at)`, the
applicable price is the `jm_model_pricing` row with the same key where
`effective_from <= created_at AND (effective_to IS NULL OR created_at < effective_to)`. Matching
is on `provider` + `model` (and `vendor` when present); migration 064 confirms `jm_token_usage`
stores these as free text, so there is no FK — matching is by value.

#### Pricing CRUD

Prices are an attribute of an org's models, so CRUD lives alongside the existing coding-models
admin rather than in a new surface:

- Backend: extend `packages/coding-models/src/routes/org.ts` (or a sibling `pricing.ts` in the
  same package) with list/create/update/delete for `jm_model_pricing`, admin-role gated like the
  existing coding-models routes. DB helpers in `packages/coding-models/src/db.ts` (or a new
  `pricing-db.ts`).
- Frontend: a pricing section/sub-table in `packages/web/src/routes/AdminCodingModelsPage.tsx`.
  Creating a new price row with an `effective_from` automatically closes the previous active row
  (`effective_to = new.effective_from`).

#### Cost computation — freeze at write time + backfill

Chosen because the pricing table is versioned and the dashboard must be fast and easy to query
(a plain `SUM(cost_usd)`, no join at query time).

- **Write time:** `recordTokenUsage()` (`packages/orchestrator/src/usage/record-token-usage.ts`)
  resolves the effective price for each usage item and computes
  `cost_usd = input_tokens/1e6*input_per_1m + output_tokens/1e6*output_per_1m + cache_read_tokens/1e6*cache_read_per_1m + cache_creation_tokens/1e6*cache_creation_per_1m + reasoning_tokens/1e6*reasoning_per_1m`,
  storing the result in the existing `cost_usd` column.
- **No match:** if no price row matches, `cost_usd` is left `NULL`. The dashboard surfaces these
  rows as **"unpriced"** (count + token totals shown, dollar cost shown as "—"), never as `$0`.
- **Backfill:** a one-time script (under `packages/migrations` tooling or `scripts/`) walks
  existing `jm_token_usage` rows and fills `cost_usd` using the effective-dated prices. Re-runnable
  and idempotent (only updates rows where a price now matches).

> Note: write-time freeze means a *future* price edit does not retroactively change already-costed
> rows — that is the intended accounting behavior. To re-cost history after correcting a price,
> re-run the backfill for the affected `(provider, model)` and date range.

### 2. Backend — analytics service (port 4002)

The dashboard reads exclusively from the standalone analytics service
(`@journeyman/analytics`), consistent with the existing workspace dashboard. The richer
api-app `/usage` routes are left untouched.

New `packages/analytics/src/db/usage.ts` querying `jm_token_usage`, reusing/extending the
`@journeyman/orchestrator` query builders (`buildUsageTotalsQuery`,
`buildUsageAggregateQuery`, `DIMENSION_COLUMNS`) so the `SUMS` projection also selects
`SUM(cost_usd)` and a `COUNT(*) FILTER (WHERE cost_usd IS NULL)` "unpriced" count.

New routes (read-only, auth + `resource.read` workspace permission, mirroring existing analytics
auth):

| Route | Purpose |
|-------|---------|
| `GET /api/analytics/workspaces/:wsId/usage/summary?window=` | KPI totals: cost, tokens (by type), run count, $/run, cache savings, unpriced count |
| `GET /api/analytics/workspaces/:wsId/usage/timeseries?window=&interval=day` | cost + tokens per day for the cost-over-time chart |
| `GET /api/analytics/workspaces/:wsId/usage/by/:dimension?window=` | breakdown by `model \| provider \| agent \| workflow \| workflow_version \| step` (whitelisted via `DIMENSION_COLUMNS`) |
| `GET /api/analytics/workspaces/:wsId/usage/waste?window=` | cost/tokens on failed (`outcome != 'success'`) or retried (`attempt > 1`) rows, with top contributing agent |
| `GET /api/analytics/workspaces/:wsId/usage/instances/:instanceId` | per-instance token/cost breakdown by step for the forensic drill-in |

`window` accepts `24h \| 7d \| 30d` (matching the existing analytics `overview` convention) and
carries previous-period totals for the "vs prev" deltas.

**Cache savings** = `cache_read_tokens/1e6 * (input_per_1m - cache_read_per_1m)` summed — the
dollars saved by cache reads versus paying full input price. Reported alongside the read-hit
ratio (`cache_read_tokens / (cache_read_tokens + input_tokens)`).

### 3. Frontend — `@journeyman/usage-dashboard` (new package)

A standalone package, sibling to `run-viewer`/`runs-list`, routed in `packages/web` at
`/workspaces/:wsId/usage`. Custom SVG/CSS charts only — no charting library — matching the
existing `workspace-dashboard` convention (SVG donut/sparkline primitives, flexbox bars).
Workspace-scoped controls rendered as **segmented pills** (not native `<select>`): a connected
range toggle (`30d` / `7d` / `24h`) and a second row of group-by chips
(`Model` / `Agent` / `Workflow` / `Step`), the active option filled with the info color. These
drive the time window and the breakdown sections.

#### Sections

1. **Overview**
   - KPI cards: total cost (+ vs-prev delta), total tokens (with in/out split), avg cost/run,
     cache savings (+ read-hit ratio).
   - Cost-over-time bar chart (daily, from `timeseries`).
   - An "unpriced usage" hint when any rows lack a matching price (links to pricing admin).

2. **Breakdown**
   - Cost by model (horizontal bars).
   - Token mix (cache-read / input / output / reasoning shares).

3. **By workflow**
   - Cost & $/run per workflow (sortable list).
   - **Version regression:** cost-per-run across `workflow_version_id` for a selected workflow,
     flagging when a newer version is materially more expensive per run.
   - Cost by step within a selected workflow.

4. **By agent**
   - Leaderboard: cost, $/run, cache-hit ratio, top model per agent.
   - **Wasted spend** banner: dollars on failed/retried runs (from `waste` endpoint), with the
     top contributing agent.

5. **Forensic drill-in**
   - Clicking an agent / workflow / top-spender row opens that workflow instance's token + cost
     breakdown by step (from the `instances/:instanceId` endpoint).

---

## Data Flow

1. Admin sets prices in the coding-models admin → rows in `jm_model_pricing`.
2. A step runs; `recordTokenUsage()` resolves the effective price and writes `jm_token_usage`
   rows with `cost_usd` populated (or NULL if unpriced).
3. (One time) backfill costs existing history.
4. The dashboard calls the analytics `/usage/*` endpoints; the service runs parameterized
   aggregate SQL (`SUM(cost_usd)`, grouped by whitelisted dimensions).
5. The page renders KPIs, charts, breakdowns, and supports drill-in to a single instance.

## Error Handling & Edge Cases

- **Unpriced usage:** `cost_usd IS NULL` → excluded from dollar sums, counted and surfaced as
  "unpriced" with token totals still shown. Never rendered as `$0`.
- **Overlapping price rows:** prevented by the partial unique index (one active row per key) and
  by auto-closing the previous active row on new-price creation; resolution query still uses the
  most recent `effective_from <= created_at`.
- **Dimension whitelist:** breakdown dimension is validated against `DIMENSION_COLUMNS`
  (returns 400 on unknown), preserving the existing SQL-injection guard.
- **Empty windows:** endpoints return zeroed totals / empty arrays; the page renders empty
  states, not errors.
- **Permissions:** all routes require auth + `resource.read` on the workspace, matching existing
  analytics routes.
- **Rounding:** dollar values rounded for display; token counts shown as integers / abbreviated
  (e.g. `847.2M`).

## Testing

- **Pricing resolution & cost math:** unit tests for the effective-date lookup (boundary cases:
  `created_at` exactly at `effective_from`/`effective_to`, no match, multiple historical rows)
  and the per-type cost formula.
- **Backfill:** idempotency test (re-run changes nothing) and a NULL-stays-NULL test for
  unpriced rows.
- **Query builders:** tests that the extended `SUMS` projection includes `cost_usd` and the
  unpriced count, and that each whitelisted dimension produces valid grouped SQL.
- **Endpoints:** integration tests for summary/timeseries/by-dimension/waste/instance against a
  seeded `jm_token_usage` + `jm_model_pricing` fixture, including the previous-period delta.
- **Frontend:** component tests for KPI rendering, the unpriced hint, version-regression
  flagging, and the wasted-spend banner; drill-in navigation test.

## Affected Packages

- `packages/migrations` — new migration for `jm_model_pricing`; backfill tooling.
- `packages/coding-models` — pricing CRUD routes + DB helpers.
- `packages/web` — pricing admin UI in `AdminCodingModelsPage.tsx`; route for the new page.
- `packages/orchestrator` — extend usage query builders with `cost_usd`; price lookup in
  `record-token-usage.ts`.
- `packages/analytics` — new `db/usage.ts` + `/usage/*` routes.
- `packages/usage-dashboard` — **new** frontend package (the dashboard page and its charts).

## Open Questions

None blocking. Budgets/alerts and org rollup are deferred to future specs.
