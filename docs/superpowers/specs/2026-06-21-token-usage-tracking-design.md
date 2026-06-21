# Token Usage Tracking — Design

**Date:** 2026-06-21
**Status:** Approved (design)
**Scope:** Capture + store + workspace-scoped read API. No UI. Cost-in-currency deferred (schema-ready).

## Problem

Token usage is never captured today. Providers report it, but every provider reports it
in a different shape and in a different place, and the code throws it away:

- **Claude** (Agent SDK): the `result` message carries `usage` (aggregate) and
  `modelUsage: Record<model, ModelUsage>` (per-model) — logged and discarded.
- **aisdk** (Vercel AI SDK): `generateText` returns `result.usage`
  (`{ inputTokens, outputTokens, totalTokens }`) — never read.
- **OpenCode**: `res.data.info` carries `tokens` (`{ input, output, reasoning,
  cache: { read, write } }`), `cost`, `modelID`, `providerID` — code reads only
  `error`/`structured`, so usage isn't even accessed.

`RunCustomPromptResult` and `RunnerResponse` have no usage field, so usage is lost at every
boundary. The only token-adjacent table, `jm_agent_run_counters`, tracks daily run *counts*,
not tokens.

We want to track token usage for **workflow instances, workflow steps, and agents**, across
**any provider and any model**, always recording which provider, vendor, and model were used,
scoped at the **workspace** level, so a dashboard can be built later.

## Goals

- Capture token usage for **every AI operation**, not just the explicit AI steps:
  `runCustomPrompt` (used by `custom-ai` and `agent-run`) **and** `scanRepos` /
  `checkoutRepo` (used by `start-feature-branch` and `list-workspace-files`), which also
  drive the model (Claude `query()`, OpenCode `session.prompt()`).
- Work for any coding provider (Claude, aisdk, OpenCode, …) and any model/vendor.
- Record provider + vendor + exact model id on every usage record.
- Capture usage on **all output modes** (`none`/`text`/`structured`), not just structured.
- Capture usage on **failed/aborted** runs, best-effort.
- Work across **all sandbox backends** (local, Docker, Windows).
- Allow slicing by: workspace, workflow (template), workflow version, run (instance), step,
  agent, provider, vendor, model, user, outcome, and time.
- Expose a workspace-scoped read/aggregation API for a future dashboard.
- Be forward-compatible with currency cost (a per-model price table added later) with **no
  schema rework**.

## Non-goals (this phase)

- No dollar/currency cost computation. `cost_usd` column exists but stays `NULL`.
- No price table (`jm_model_prices`) yet.
- No web UI / dashboard.

## Decisions (from brainstorming + dry-run)

1. **Atomic events table + rollup** — one append-only row per (LLM call × model) is the
   source of truth; instance/step/agent/workflow totals are `SUM ... GROUP BY` at read time.
2. **Row granularity = per (call × model)** — Claude's `modelUsage` is a map, so one call
   can use several models; each gets its own row. Honors "which model I used" exactly.
3. **Full token breakdown + raw blob, cost NULL** — store input/output/cache/reasoning token
   columns plus a `raw_usage` JSONB; keep a nullable `cost_usd` column for later.
4. **Every dimension stamped on every row**, denormalized so dashboards slice without joins.
5. **Capture all AI operations** — `runCustomPrompt` (`custom-ai`, `agent-run`) **and**
   `scanRepos` / `checkoutRepo` (`start-feature-branch`, `list-workspace-files`). The latter
   two return `ScanReposResult` / `CheckoutRepoResult`, so `usage?: TokenUsage[]` is added to
   those result types and their runner-dispatch cases too. Same table, same normalization;
   `step_type` is just the calling step's type.
6. **Record usage on failure, best-effort** — when the provider still reports usage on the
   error path (Claude's error result, OpenCode `info.tokens`); aisdk throws on hard errors so
   usage may be unavailable there (record nothing then). `outcome` column distinguishes.
7. **Separate `provider` and `vendor`** — `provider` = execution engine (`aisdk`/`opencode`/
   `claude`); `vendor` = underlying API vendor (`openai`/`anthropic`/`google`/…), derived
   from model config / model id when known, NULL otherwise. Lets the dashboard group e.g.
   "Anthropic spend" across native Claude, aisdk-via-Anthropic, and opencode-via-Anthropic.

## Data model

New migration: `packages/migrations/src/sql/064_token_usage.sql`.
(Read `docs/constitution/DATABASE_ARCHITECTURE.md` before writing it. The runs table is
**`jm_workflow_instances`** — renamed from `jm_runs` in migration 018; node rows are in
`jm_node_executions` keyed by `workflow_instance_id`. So `jm_token_usage.workflow_instance_id`
FKs to `jm_workflow_instances(id)`.)

Table **`jm_token_usage`** — one row per (LLM call × model). Follow existing migration
conventions: `CREATE TABLE IF NOT EXISTS`, `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`,
snake_case columns, `TIMESTAMPTZ NOT NULL DEFAULT now()`, FKs `ON DELETE CASCADE`.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | `DEFAULT gen_random_uuid()` |
| `workspace_id` | uuid FK → `jm_workspaces` | top-level scope, always set |
| `org_id` | uuid | denormalized for org-level rollups |
| `workflow_id` | uuid NULL | workflow **template** — stats per workflow across all runs |
| `workflow_version_id` | uuid NULL | version-over-version comparison |
| `workflow_name` | text NULL | snapshot for display without a join |
| `workflow_instance_id` | uuid FK → run | the run |
| `node_id` | text | the step within the run |
| `step_type` | text | e.g. `custom-ai`, `agent-run` |
| `step_name` | text NULL | custom step / agent display name when known |
| `attempt` | int | step retry attempt |
| `agent_id` | uuid NULL | from `input.agentId` when the run came from an agent |
| `agent_name` | text NULL | from `input.displayName` |
| `triggered_by_user_id` | uuid NULL | `startedByUserId` |
| `provider` | text | execution engine: `claude` / `aisdk` / `opencode` / … |
| `vendor` | text NULL | API vendor: `openai` / `anthropic` / `google` / … (aisdk: from `modelConfig.npm` like `@ai-sdk/openai`, else model-id prefix; opencode: `info.providerID`; claude: `anthropic`) |
| `model` | text NULL | exact model id (source differs per provider — see below); for `usage_reported=false` rows falls back to the requested `input.model` |
| `outcome` | text NOT NULL | `success` / `error` / `aborted` |
| `input_tokens` | bigint NULL | |
| `output_tokens` | bigint NULL | |
| `cache_read_tokens` | bigint NULL | |
| `cache_creation_tokens` | bigint NULL | |
| `reasoning_tokens` | bigint NULL | when the provider reports it |
| `total_tokens` | bigint NULL | convenience sum |
| `usage_reported` | boolean NOT NULL | `false` when the provider returned no usage (so dashboards show "unknown" rather than undercounting) |
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
- `(workspace_id, vendor)`

**Idempotency (Conductor is at-least-once).** A node maps to one terminal LLM call, so
`(workflow_instance_id, node_id, attempt, provider, model)` is unique per delivery (multi-model
calls produce distinct `model`s — still unique). Add a `UNIQUE` constraint on that tuple and
insert with `ON CONFLICT DO NOTHING`. This makes a redelivered task (same `attempt`) a no-op
instead of a double-count. The writer returns whether rows were actually inserted, so the
agent-counter rollup (below) only fires on a real insert.

Hierarchy captured on every row:

```
workspace_id → org_id
  workflow_id (template) → workflow_version_id
    workflow_instance_id (one run)
      node_id (one step) + attempt
        provider + vendor + model → token counts
  agent_id (when run came from an agent)
```

## Provider usage shapes & normalization

Each provider owns the translation from its native shape → a single normalized
`TokenUsage[]`. Nothing downstream sees provider-specific shapes.

```ts
// @journeyman/core — packages/core/src/types/coding.types.ts
export interface TokenUsage {
  provider: string;
  vendor?: string;
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
  usage?: TokenUsage[];   // empty/undefined ⇒ provider reported nothing
}
```

| Provider | Native shape | Per-call rows | `model` source | `vendor` source |
|---|---|---|---|---|
| **claude** | `result.modelUsage: { [model]: { inputTokens, outputTokens, cacheReadInputTokens, cacheCreationInputTokens, costUSD } }` | one per map key | the map keys | `anthropic` |
| **aisdk** | `result.usage: { inputTokens, outputTokens, totalTokens, reasoningTokens?, cachedInputTokens? }` | one | **`opts.model`** (result doesn't echo it) | from `modelConfig` (provider/baseURL) or model-id prefix |
| **opencode** | `res.data.info: { tokens: { input, output, reasoning, cache: { read, write } }, cost, modelID, providerID }` | one | `info.modelID` | `info.providerID` |

Adapter sketches (pure functions in each provider folder):

```ts
// claude — fan the model map into rows
Object.entries(msg.modelUsage).map(([model, u]) => ({
  provider: "claude", vendor: "anthropic", model,
  inputTokens: u.inputTokens, outputTokens: u.outputTokens,
  cacheReadTokens: u.cacheReadInputTokens, cacheCreationTokens: u.cacheCreationInputTokens,
  raw: u,
}));

// aisdk — single model; cache fields absent → undefined → NULL
[{ provider: "aisdk", vendor: vendorOf(opts), model: opts.model,
   inputTokens: u.inputTokens, outputTokens: u.outputTokens,
   reasoningTokens: u.reasoningTokens, cacheReadTokens: u.cachedInputTokens,
   totalTokens: u.totalTokens, raw: u }];

// opencode — different field names
[{ provider: "opencode", vendor: info.providerID, model: info.modelID,
   inputTokens: t.input, outputTokens: t.output, reasoningTokens: t.reasoning,
   cacheReadTokens: t.cache?.read, cacheCreationTokens: t.cache?.write, raw: info }];
```

**Robustness rules:**
- Every token field optional/nullable. A provider that omits cache tokens leaves those NULL
  (not 0 — which would be a lie); `SUM` over NULL behaves correctly.
- `raw_usage` keeps the original blob on every row, so unmapped fields (web-search counts,
  audio tokens, cost) are recoverable later without re-running.
- A provider that reports nothing still produces **one** row with `usage_reported = false`.

## Capture flow (provider → runner → handler → DB)

### Provider-level fixes (dry-run findings)

1. **Extract usage *before* the output-mode branch.** Today every provider returns early for
   `outputMode: "none"` / `"text"` before any usage is attached — and those are the
   implement/edit steps that burn the most tokens. Hoist extraction so usage is attached on
   **all** output modes and on the failure path.
   - Claude: [run-custom-prompt.ts:141](../../packages/agent-runtime/src/providers/claude/operations/run-custom-prompt.ts)
   - aisdk: [run-custom-prompt.ts:144](../../packages/agent-runtime/src/providers/aisdk/operations/run-custom-prompt.ts)
   - opencode: [run-custom-prompt.ts:133](../../packages/agent-runtime/src/providers/opencode/operations/run-custom-prompt.ts)
2. **aisdk double-call:** on a structured miss, aisdk fires a second `generateText`
   ("force JSON" retry). **Accumulate usage across both calls** or the retry is undercounted.
   (Multi-step loops are already aggregated into the top-level `result.usage`.)
3. **opencode:** read `res.data.info.tokens` / `.cost` / `.modelID` / `.providerID`
   (currently only `error`/`structured` are read).
4. **Failure path (best-effort):** when the provider reports usage on error/abort (Claude's
   `SDKResultError` carries `usage`/`modelUsage`; OpenCode `info.tokens` present alongside
   `info.error`), still return `usage` so the handler records it with `outcome != success`.
5. **scanRepos / checkoutRepo:** these also call the model and must extract usage the same
   way. Add `usage?: TokenUsage[]` to `ScanReposResult` / `CheckoutRepoResult`
   (`@journeyman/core`) and populate it in all three providers' `scan-repos.ts` /
   `checkout-repo.ts`.

### Runner boundary (sandbox coverage)

The step handler always runs **in the worker** (holds the DB pool). What changes per sandbox
is only *where the LLM call physically runs*:

```ts
const coding = ctx.exec
  ? new SandboxInstanceCodingProvider(ctx.exec, provider)   // sandboxed: Docker / Windows
  : this.deps.coding(provider, ctx.env);                    // local: in-process
```

- **Local** — provider runs in-process, returns `RunCustomPromptResult.usage` straight to the
  handler.
- **Sandboxed (Docker/Windows/any future backend)** — the call is forwarded via `ctx.exec` and
  returns as a `RunnerResponse`. All sandbox backends share this one runner-over-`exec` bridge,
  so fixing it once covers every backend. Two hops currently drop usage and must thread it:
  1. `packages/agent-runtime/src/runner/runner-types.ts` — add `usage?: TokenUsage[]` to
     `RunnerResponse`; `dispatch.ts` (currently
     [returns `{ ok, structured, result }`](../../packages/agent-runtime/src/runner/dispatch.ts) at the
     `custom-prompt` case — **and the `scan-repos` / `checkout-repo` cases**) and `run-cli.ts`
     pass it through.
  2. `packages/orchestrator/src/sandbox/sandbox-instance-coding-provider.ts` — map `r.usage`
     back onto the returned `RunCustomPromptResult` (currently
     [drops everything but `structured`/`result`](../../packages/orchestrator/src/sandbox/sandbox-instance-coding-provider.ts)):
     ```ts
     return { ...(typeof r.structured === "string" ? { result: r.structured } : { structured: r.structured }),
              usage: r.usage };
     ```

### Step handlers persist

A new helper in `@journeyman/orchestrator`:

```ts
recordTokenUsage(pool, {
  workspaceId, orgId,
  workflowId, workflowVersionId, workflowName,
  workflowInstanceId, nodeId, stepType, stepName, attempt,
  agentId, agentName, triggeredByUserId,
  outcome,          // "success" | "error" | "aborted"
  usage,            // TokenUsage[]; [] ⇒ one usage_reported=false row
});
```

- `custom-ai-step-handler.ts`, `agent-run-step-handler.ts`, **`start-feature-branch-step-handler.ts`,
  and `list-workspace-files-step-handler.ts`** call it after the coding call returns, on **both**
  success and failure branches.
- **Handler wiring:** `custom-ai` and `agent-run` already receive `pool`, but
  `StartFeatureBranchStepHandler` / `ListWorkspaceFilesStepHandler` are constructed with
  `{ coding }` only ([cli-worker.ts:204-205](../../packages/orchestrator/src/cli-worker.ts)).
  Add `pool` to their constructor deps and pass it at registration (pool is already in scope
  there). `pool` is **optional** — the worker can run without `DATABASE_URL`
  ([cli-worker.ts:62](../../packages/orchestrator/src/cli-worker.ts)) — so `recordTokenUsage`
  no-ops when `pool` is absent and never fails a step.
- `outcome` = `aborted` when `ctx.signal.aborted`, else `error` on failure, else `success`.
- Context on hand: `ctx.workflowInstanceId`, `ctx.nodeId`, `ctx.attempt`, `input.provider`,
  `input.model`, `input.startedByUserId` (→ `triggered_by_user_id`),
  `input.startedByOrgId` (→ `org_id`; the run row has no org_id column), `input.workflowId`.
- **Most fields are already on the step input — no per-call DB lookup.** The worker injects
  `workspaceId`, `workflowId`, `startedByUserId`, `startedByOrgId` into every step's input
  ([conductor-converter.ts:393-396](../../packages/orchestrator/src/flow-json/conductor-converter.ts)).
  `agent_id` from `input.agentId`, `agent_name` from `input.displayName`.
- **Only `workflow_version_id` and `workflow_name` are not in input** — fetch them with a single
  lookup on `jm_workflow_instances` by `ctx.workflowInstanceId`, cached per run (they are
  constant for the whole instance). Both are nullable, so a missed lookup is non-fatal.
- Writing usage **must never fail the step** — wrap in try/catch, log on error.

## Relationship to the existing agent usage counter

`packages/agents/src/safety.ts` already has `addUsage(pool, orgId, agentId, tokens, costUsd)`
that upserts into `jm_agent_run_counters` (which has `tokens BIGINT` / `cost_usd NUMERIC`
columns), wired to the agent safety/budget rails (`jm_org_agent_settings.daily_run_cap` /
`budget`). It is currently **dead code — never called** (comment: "called by the worker on
terminal — 4c").

`jm_token_usage` is the detailed source of truth; `jm_agent_run_counters` is a per-agent/day
rollup the budget system reads. **Feed both:** when an *agent* run records usage and rows were
actually inserted (see idempotency above), also call `addUsage(pool, orgId, agentId,
sum(totalTokens), 0)`. `cost_usd` passes `0` this phase (tokens-only); the later pricing phase
fills it. `addUsage` already upserts additively, so guarding the call on a real insert prevents
redelivery double-counts. This revives the dormant agent budget feature at the cost of one extra
call in the agent-run path; non-agent runs skip it.

## Read API (workspace-scoped, no UI)

New routes in `@journeyman/api-server`, registered like existing workspace routes (Fastify;
the global `/api` prefix is applied at registration, so the route paths are
`/workspaces/:wsId/...`). **Auth is mandatory and matches the existing pattern** — every route
uses `read = { preHandler: [requireAuth(), requirePerm("resource.read")] }` where
`requirePerm = makeRequireWorkspacePermission({ pool })`. That guard enforces the caller is a
member of `:wsId` with read permission, so a user cannot read another workspace's usage by
guessing the id. Every query is *also* constrained to `:wsId` in SQL (defence in depth).

- `GET /workspaces/:wsId/usage`
  Filters: `from`, `to`, `provider`, `vendor`, `model`, `agentId`, `workflowId`,
  `instanceId`, `outcome`. Returns aggregated token totals + row count for the filtered set.

- `GET /workspaces/:wsId/usage/by/:dimension`
  `dimension ∈ { model | provider | vendor | agent | workflow | workflow_version | step | day }`.
  Returns grouped token totals — the queries a dashboard will consume.

Responses sum token columns and `cost_usd` (NULL today, live once pricing lands).

## Forward-compat for cost

The only deferred work is *populating* `cost_usd`. A later phase adds a `jm_model_prices`
table (provider/vendor, model, per-token rates, effective_date) and computes cost at write
time, snapshotting the rate used. Nothing in this phase changes for that: the `cost_usd`
column, `raw_usage` blob, `vendor`, and per-(call×model) rows are already in place, and the
read API already sums `cost_usd`.

## Testing

- **Provider unit tests** — native shape → `TokenUsage[]` for each provider:
  - Claude `modelUsage` multi-model fan-out; missing-field tolerance.
  - aisdk single-model mapping **and the double-call accumulation** (force-JSON retry).
  - opencode `info.tokens`/`modelID`/`providerID` mapping.
  - Usage attached on **all** output modes (`none`/`text`/`structured`).
  - Usage attached on the **failure path** where the provider reports it.
  - `scanRepos` / `checkoutRepo` extract usage and surface it on `ScanReposResult` /
    `CheckoutRepoResult`.
- **Runner round-trip test** — `RunnerResponse` carries `usage`; `SandboxInstanceCodingProvider`
  maps it back onto `RunCustomPromptResult` (asserts Docker/Windows coverage).
- **Handler test** — `recordTokenUsage` writes correct rows for: normal multi-model usage; the
  `usage_reported=false` path; `outcome` for success vs error; that a write failure does not fail
  the step; that a redelivered task (same instance/node/attempt/model) inserts **no** duplicate
  rows (`ON CONFLICT DO NOTHING`); and that the agent-counter `addUsage` rollup fires once per
  real insert (not on redelivery).
- **API test** — aggregation grouping per dimension (incl. `vendor`); date-range filtering;
  workspace isolation enforced by `makeRequireWorkspacePermission` (a non-member, or a member of
  a different workspace, gets 403 — not another workspace's data).

## Files touched

- `packages/migrations/src/sql/064_token_usage.sql` — new table + indexes.
- `packages/core/src/types/coding.types.ts` — `TokenUsage`; `usage` on `RunCustomPromptResult`, `ScanReposResult`, `CheckoutRepoResult`.
- `packages/agent-runtime/src/providers/claude/operations/{run-custom-prompt,scan-repos,checkout-repo}.ts` — map `modelUsage`; hoist before output-mode branch; failure path.
- `packages/agent-runtime/src/providers/aisdk/operations/{run-custom-prompt,scan-repos,checkout-repo}.ts` — map `result.usage`; accumulate the double call; vendor from `modelConfig.npm`; all output modes.
- `packages/agent-runtime/src/providers/opencode/operations/{run-custom-prompt,scan-repos,checkout-repo}.ts` — read `info.tokens`/`cost`/`modelID`/`providerID`; all output modes; failure path.
- `packages/agent-runtime/src/runner/runner-types.ts`, `dispatch.ts` (custom-prompt + scan-repos + checkout-repo cases), `run-cli.ts` — thread `usage`.
- `packages/orchestrator/src/sandbox/sandbox-instance-coding-provider.ts` — map `r.usage` back (all three ops).
- `packages/orchestrator/src/workers/steps/{custom-ai,agent-run,start-feature-branch,list-workspace-files}-step-handler.ts` — persist usage (success + failure).
- `packages/orchestrator/src/cli-worker.ts` — pass `pool` to `StartFeatureBranchStepHandler` + `ListWorkspaceFilesStepHandler` at registration (lines ~204-205).
- `packages/orchestrator/src/...` — `recordTokenUsage` writer (no-ops when pool absent; `ON CONFLICT DO NOTHING`; returns inserted-row count) + a usage store/query module.
- `packages/agents/src/safety.ts` — already has `addUsage()`; wire it from the agent-run path (guarded on a real insert). No change to the function itself.
- `packages/api-server/src/...` — usage read routes.
