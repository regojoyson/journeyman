# Token Usage Tracking — Design

**Date:** 2026-06-21
**Status:** Approved (design)
**Scope:** Capture + store + workspace-scoped read API. No UI. Cost-in-currency deferred (schema-ready).

## Problem

Token usage is never captured today. The Claude Agent SDK returns it on the `result`
message (`usage` aggregate + `modelUsage` per-model breakdown + `total_cost_usd`), but
`run-custom-prompt.ts` logs the message and discards it. `RunCustomPromptResult` and
`RunnerResponse` have no usage field, so usage is lost at every boundary. The only
token-adjacent table, `jm_agent_run_counters`, tracks daily run *counts*, not tokens.

We want to track token usage for **workflow instances, workflow steps, and agents**,
across **any provider and any model**, always recording which provider and model were
used, scoped at the **workspace** level, so a dashboard can be built later.

## Goals

- Capture token usage for every LLM call made by `custom-ai` and `agent-run` steps.
- Work for any coding provider (Claude, OpenCode, aisdk, …) and any model.
- Record provider + exact model id on every usage record.
- Allow slicing by: workspace, workflow (template), workflow version, run (instance),
  step, agent, provider, model, user, and time.
- Expose a workspace-scoped read/aggregation API for a future dashboard.
- Be forward-compatible with currency cost (a per-model price table added later) with
  **no schema rework**.

## Non-goals (this phase)

- No dollar/currency cost computation. `cost_usd` column exists but stays `NULL`.
- No price table (`jm_model_prices`) yet.
- No web UI / dashboard.

## Decisions (from brainstorming)

1. **Atomic events table + rollup** — one append-only row per LLM call is the source of
   truth; instance/step/agent/workflow totals are `SUM ... GROUP BY` queries.
2. **Row granularity = per (call × model)** — a single `runCustomPrompt` call can span
   multiple models (`modelUsage` is a map), so each model used in a call gets its own row.
   This honors "which model I used" exactly.
3. **Full token breakdown + raw blob, cost NULL** — store input/output/cache/reasoning
   token columns plus a `raw_usage` JSONB; keep a nullable `cost_usd` column for later.
4. **Every dimension stamped on every row** — provider, model, workflow_id,
   workflow_version_id, workflow_instance_id, node_id, step type/name, agent_id/name,
   triggered-by user, timestamp — denormalized so dashboards slice without fragile joins.
5. **Capture on both `custom-ai` and `agent-run` steps.**

## Data model

New migration: `packages/migrations/src/sql/064_token_usage.sql`.
(Read `docs/constitution/DATABASE_ARCHITECTURE.md` before writing it.)

Table **`jm_token_usage`** — one row per (LLM call × model):

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `workspace_id` | uuid FK → `jm_workspaces` | top-level scope, always set |
| `org_id` | uuid | denormalized for org-level rollups |
| `workflow_id` | uuid NULL | workflow **template** — stats per workflow across all runs |
| `workflow_version_id` | uuid NULL | version-over-version comparison |
| `workflow_name` | text NULL | snapshot for display without a join |
| `workflow_instance_id` | uuid FK → `jm_workflow_instances` | the run |
| `node_id` | text | the step within the run |
| `step_type` | text | e.g. `custom-ai`, `agent-run` |
| `step_name` | text NULL | custom step display name when known |
| `attempt` | int | step retry attempt |
| `agent_id` | uuid NULL | set when the run originated from an agent |
| `agent_name` | text NULL | snapshot |
| `triggered_by_user_id` | uuid NULL | `startedByUserId` |
| `provider` | text | `claude` / `opencode` / `aisdk` / … |
| `model` | text | exact model id reported by the provider |
| `input_tokens` | bigint NULL | |
| `output_tokens` | bigint NULL | |
| `cache_read_tokens` | bigint NULL | |
| `cache_creation_tokens` | bigint NULL | |
| `reasoning_tokens` | bigint NULL | when the provider reports it |
| `total_tokens` | bigint NULL | convenience sum |
| `usage_reported` | boolean NOT NULL | `false` when the provider returned no usage (dashboards show "unknown" rather than undercounting) |
| `cost_usd` | numeric NULL | **NULL this phase**; populated later by a price table |
| `raw_usage` | jsonb NULL | full provider usage blob for forensics / future fields |
| `session_id` | text NULL | coding-cli session id |
| `created_at` | timestamptz NOT NULL default now() | time-series axis |

Indexes:
- `(workspace_id, created_at)`
- `(workspace_id, workflow_id, created_at)`
- `(workflow_instance_id)`
- `(agent_id)`
- `(workspace_id, provider, model)`

Hierarchy captured on every row:

```
workspace_id → org_id
  workflow_id (template) → workflow_version_id
    workflow_instance_id (one run)
      node_id (one step) + attempt
        provider + model → token counts
  agent_id (when run came from an agent)
```

## Capture flow (provider → runner → handler → DB)

### 1. `@journeyman/core`

Add a `TokenUsage` type and thread it through the result type
(`packages/core/src/types/coding.types.ts`):

```ts
export interface TokenUsage {
  provider: string;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  reasoningTokens?: number;
  totalTokens?: number;
  raw?: unknown;
}

export interface RunCustomPromptResult {
  result?: string;
  structured?: unknown;
  error?: string;
  sessionId?: string;
  usage?: TokenUsage[];   // NEW — empty/undefined ⇒ provider reported nothing
}
```

### 2. Claude provider

`packages/agent-runtime/src/providers/claude/operations/run-custom-prompt.ts` — on the
`result` message (`subtype === "success"`), map `msg.modelUsage` (a
`Record<model, ModelUsage>`) into `TokenUsage[]`, one entry per model key. Attach to the
returned `RunCustomPromptResult.usage`. `ModelUsage` fields: `inputTokens`,
`outputTokens`, `cacheReadInputTokens`, `cacheCreationInputTokens`, `costUSD`,
`webSearchRequests`, `contextWindow`, `maxOutputTokens` — keep the originals in `raw`.

### 3. OpenCode / aisdk providers

Extract usage where the SDK exposes it and return `TokenUsage[]`. When a provider does
not report usage, return `usage` undefined/empty — the handler records a single row with
`usage_reported = false` so the call is still counted. Gemini/Codex stubs are unaffected.

### 4. Runner boundary

`packages/agent-runtime/src/runner/runner-types.ts` — add `usage?: TokenUsage[]` to
`RunnerResponse`; pass it through `dispatch.ts` / `run-cli.ts`. This is required so
**sandboxed (Docker) runs** report usage back across the stdin/stdout boundary, not just
local runs.

### 5. Step handlers persist

A new helper in `@journeyman/orchestrator`:

```ts
recordTokenUsage(pool, {
  workspaceId, orgId,
  workflowId, workflowVersionId, workflowName,
  workflowInstanceId, nodeId, stepType, stepName, attempt,
  agentId, agentName, triggeredByUserId,
  usage,            // TokenUsage[] from the provider; [] ⇒ one usage_reported=false row
});
```

- `custom-ai-step-handler.ts` and `agent-run-step-handler.ts` call it after the coding
  call returns (success path).
- Context already on hand: `ctx.workflowInstanceId`, `ctx.nodeId`, `ctx.attempt`,
  `input.provider`, `input.model`, `input.startedByUserId`, `input.startedByOrgId`,
  `input.workflowId`.
- `workspace_id`, `workflow_version_id`, `workflow_name`, and `agent_id`/`agent_name`
  are read from the `jm_workflow_instances` row (one lookup, or threaded via input).
- Writing usage **must never fail the step** — wrap in try/catch, log on error.

## Read API (workspace-scoped, no UI)

New routes in `@journeyman/api-server`, under the workspace namespace, mirroring existing
workspace-scoped route patterns:

- `GET /api/workspaces/:wsId/usage`
  Filters: `from`, `to` (date range), `provider`, `model`, `agentId`, `workflowId`,
  `instanceId`. Returns aggregated token totals + row count for the filtered set.

- `GET /api/workspaces/:wsId/usage/by/:dimension`
  `dimension ∈ { model | provider | agent | workflow | workflow_version | step | day }`.
  Returns grouped token totals — the queries a dashboard will consume.

Responses sum token columns and `cost_usd` (NULL today, live once pricing lands). All
queries are constrained to `:wsId` for tenant isolation.

## Forward-compat for cost

The only deferred work is *populating* `cost_usd`. A later phase adds a `jm_model_prices`
table (provider, model, per-token rates, effective_date) and computes cost at write time,
snapshotting the rate used. Nothing in this phase changes for that: the `cost_usd` column,
`raw_usage` blob, and per-(call×model) rows are already in place, and the read API already
sums `cost_usd`.

## Testing

- **Provider unit test** — Claude `modelUsage` → `TokenUsage[]` mapping, including the
  multi-model case and missing-field tolerance.
- **Handler test** — `recordTokenUsage` writes correct rows for: normal multi-model usage;
  the `usage_reported = false` path (provider returned nothing); and that a write failure
  does not fail the step.
- **API test** — aggregation grouping per dimension; date-range filtering; workspace
  isolation (one workspace cannot read another's usage).

## Files touched

- `packages/migrations/src/sql/064_token_usage.sql` — new table + indexes.
- `packages/core/src/types/coding.types.ts` — `TokenUsage`, `RunCustomPromptResult.usage`.
- `packages/agent-runtime/src/providers/claude/operations/run-custom-prompt.ts` — map `modelUsage`.
- `packages/agent-runtime/src/providers/opencode/index.ts` (+ aisdk) — extract usage.
- `packages/agent-runtime/src/runner/runner-types.ts`, `dispatch.ts`, `run-cli.ts` — thread `usage`.
- `packages/orchestrator/src/workers/steps/custom-ai-step-handler.ts` — persist usage.
- `packages/orchestrator/src/workers/steps/agent-run-step-handler.ts` — persist usage.
- `packages/orchestrator/src/...` — `recordTokenUsage` writer + a usage store/query module.
- `packages/api-server/src/...` — usage read routes.
