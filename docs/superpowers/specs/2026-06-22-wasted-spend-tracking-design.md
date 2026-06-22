# Wasted Spend — accurate failure cost tracking

**Date:** 2026-06-22
**Status:** Design approved, pending implementation plan
**Packages touched:** `agent-runtime`, `core`, `analytics`, `usage-dashboard`

## Problem

The usage dashboard shows **"Wasted spend — $0.00 on failed / retried runs (0% of total)"** even when many
workflow instances and agents have failed.

### Root cause

"Wasted spend" is computed purely from `cost_usd` on `jm_token_usage` rows where
`outcome <> 'success' OR attempt > 1` ([`packages/analytics/src/db/usage.ts:143`](../../../packages/analytics/src/db/usage.ts)).
That number is structurally ~$0 for two independent reasons:

1. **Failed AI runs record zero tokens.** In
   [`run-custom-prompt.ts`](../../../packages/agent-runtime/src/providers/claude/operations/run-custom-prompt.ts),
   token usage is only returned on the SDK **error-*result*** path (line ~160). When the run **throws / is
   aborted** (line ~172) or `cli.js` is missing (line ~65), it returns `{ error }` with **no usage**. A row is
   still written with `outcome:'error'` but `total_tokens = 0`, so `computeCostUsd` prices it at **$0**
   (or `NULL` when the model is unpriced). Confirmed against the dev DB: the single `error` row had
   `total_tokens = 0`.

2. **Most failed *instances* never produce a failed token row at all.** `recordTokenUsage` is only reached
   *after* `runCustomPrompt` returns
   ([`custom-ai-step-handler.ts:255`](../../../packages/orchestrator/src/workers/steps/custom-ai-step-handler.ts)).
   Instances that fail in a non-LLM step (clone, PR, branch), fail before the LLM runs, or throw host-side
   produce no error-outcome row. The waste query measures *failed token rows*, not *failed runs* — different
   populations. Dev DB: 10 of 15 instances failed, but only 2 instances ever produced any token row.

Dollars only ever exist for steps that call an LLM; non-LLM steps cost $0 by nature.

## Goal

Make "Wasted spend" honest in both directions:

- **Headline (dollars):** real money lost on **LLM steps that failed / were aborted / were retried** — made
  accurate by capturing the tokens a failed run actually burned.
- **Caveat (count):** **failed + cancelled workflow runs that recorded no measurable LLM cost** — so a low/zero
  dollar figure is never misleading.

> Example: *"Wasted spend — $12.40 on failed/retried AI steps. 8 more runs failed or were cancelled with no AI
> cost recorded."*

Explicitly **not** in scope: inventing a dollar cost for a run that failed in a non-LLM step (no tokens to
price → surfaced as a count instead).

## Design

### 1. Capture fix — `agent-runtime`

**Mechanic (important):** `modelUsage` exists *only* on the final `result` message
([sdk.d.ts:2722](../../../.claude/sdk.d.ts)). A run that **throws before producing a result** has no
`modelUsage` to read, so snapshotting it would capture nothing. However, each streamed **`assistant`** message
carries its own per-turn `message.usage` (`input_tokens`, `output_tokens`, `cache_read_input_tokens`,
`cache_creation_input_tokens`) plus `message.model`
([sdk.d.ts:2221](../../../.claude/sdk.d.ts)).

In [`run-custom-prompt.ts`](../../../packages/agent-runtime/src/providers/claude/operations/run-custom-prompt.ts):

- Maintain an **accumulator keyed by model** inside the streaming loop, summing `message.usage` from every
  `assistant` message as it arrives. Helper: convert the accumulator → `TokenUsage[]` (one entry per model),
  mirroring the shape `modelUsageToTokenUsage` produces.
- On the **throw / abort** catch path (~line 172) return `{ sessionId, error, usage: accumulated }` instead of
  dropping usage. The `cli.js`-missing early return (~line 65) returns whatever has accumulated (typically none).
- The existing **error-result** path (~line 160) keeps using `modelUsage` from the result (authoritative when a
  result *is* produced); the accumulator is the fallback for the no-result case.

**Provider applicability (refined during implementation):**

- **Claude** (`query()` async iterator) — accumulate per-`assistant`-message usage; return it on throw/abort.
  Implemented.
- **aisdk** (`generateText`) — not streaming, but `generateText` fires an **`onStepFinish(step)`** callback per
  step with `step.usage`. A hoisted accumulator (composed with the existing step logger) collects per-step
  usage so the `catch` returns `{ error, usage: accumulateUsage(rows) }`. `result.usage` stays authoritative on
  success. No streaming rewrite needed. Implemented.
- **OpenCode** (`client.session.prompt`) — **left as-is by decision.** Its soft-error path already returns
  `usage` (`res.data.info.tokens`); its *only* usage-losing path is **abort**, which `throw`s and discards the
  already-computed usage. But aborts = cancelled instances already covered by the 🔢 caveat count, and changing
  the abort path to return instead of throw would break the established abort contract and its two abort tests.
  Not worth the risk for a case the caveat already counts.

Net effect: a failed AI step records the tokens consumed before dying → `recordTokenUsage` prices them → the
headline dollar number becomes real. No schema or recording-layer changes needed
(`custom-ai-step-handler` already passes `outcome:'error'`/`'aborted'` and `result.usage`).

### 2. Analytics — `core` type + `usageWaste` query

Extend `UsageWaste` in [`packages/core/src/types/analytics.types.ts`](../../../packages/core/src/types/analytics.types.ts):

```ts
export interface UsageWaste {
  costUsd: number | null;
  totalTokens: number;
  rows: number;
  fractionOfTotalCost: number | null;
  topAgent: { agentId: string | null; agentName: string | null; costUsd: number | null } | null;
  failedRunsNoCost: number; // NEW — failed/cancelled instances that contributed no dollars
}
```

**Tighten the headline predicate.** Today both the waste sum and the `topAgent` query use
`outcome <> 'success' OR attempt > 1`, which counts the **successful final attempt of a retried run** as
"waste" (e.g. a run that fails attempt 1 at $0.30 then succeeds attempt 2 at $0.50 reads $0.80). The successful
attempt produced the result — it is not wasted. Change **both** queries (the sum and the `topAgent` group-by) to:

```sql
WHERE workspace_id = $1 AND created_at >= $2 AND outcome <> 'success'
```

This counts every failed/aborted attempt (including the failed attempts of runs that later succeeded) but drops
successful retry attempts. Combined with fix #1, the headline now reflects *only truly-wasted* AI dollars.

Add one aggregate to `usageWaste()` in
[`packages/analytics/src/db/usage.ts`](../../../packages/analytics/src/db/usage.ts):

```sql
SELECT count(*)::int AS failed_runs
  FROM jm_workflow_instances
 WHERE workspace_id = $1 AND created_at >= $2
   AND status IN ('failed','cancelled')
   AND id NOT IN (
     SELECT DISTINCT workflow_instance_id
       FROM jm_token_usage
      WHERE workspace_id = $1 AND created_at >= $2 AND cost_usd > 0
   );
```

Columns verified against existing analytics queries (`workspace_id`, `status`, `created_at`,
`id` on `jm_workflow_instances`; statuses include `failed`, `cancelled`). Return it as `failedRunsNoCost`.

The route ([`routes/usage.ts:38`](../../../packages/analytics/src/routes/usage.ts)) and web api
([`web/src/api/usage.ts:15`](../../../packages/web/src/api/usage.ts)) pass `UsageWaste` through unchanged.

### 3. UI — `usage-dashboard`

In [`UsageDashboard.tsx:125`](../../../packages/usage-dashboard/src/UsageDashboard.tsx):

- **Relax the render gate.** Today the card only renders when `p.waste.costUsd !== null`, which hides the most
  important case (failures with no recorded cost). Render when `p.waste` exists and
  (`costUsd !== null` **or** `failedRunsNoCost > 0`). When `costUsd` is null/0, show `$0.00`.
- **Append the caveat** when `failedRunsNoCost > 0`:
  *"{N} more run{s} failed or were cancelled with no AI cost recorded."*

## Data flow — how usage is captured at runtime

A worker never runs the LLM in-process; it forwards the operation into a sandbox and `usage` rides back through
the runner's JSON envelope at every layer. This holds for **local, docker, and windows** backends — each
backend's `exec` forwards `usage` from the runner response (`runOperation` in-process for local;
`parsed.usage` for docker [docker-execution-environment.ts:85](../../../packages/sandbox/src/backends/docker/docker-execution-environment.ts); same envelope for windows).

```
custom-ai-step-handler          ← computes outcome, calls recordTokenUsage(usage)  [agent_id + workflow_instance_id on every row]
  └─ SandboxInstanceCodingProvider.runCustomPrompt   ← returns { error, usage }
       └─ exec()  (local | docker | windows)         ← forwards usage from the runner response
            └─ runner CLI → dispatch.ts:47           ← { ok, error, usage }
                 └─ run-custom-prompt.ts             ← source of usage (fix #1)
```

Agent attribution is independent of sandbox type — `agent_id`/`agent_name`/`workflow_instance_id` are set on
every row at the handler ([custom-ai-step-handler.ts:255](../../../packages/orchestrator/src/workers/steps/custom-ai-step-handler.ts)).

### Failure bucketing (verified by dry run)

| Failure | Row written? | Tokens? | Bucket |
|---|---|---|---|
| AI run errors/aborts, runner survives | yes (`error`/`aborted`) | yes (fix #1) | 💵 headline dollars |
| Runner truncated / no JSON | yes (`exec` returns `ok:false`, no throw) | no → $0 | 🔢 caveat count |
| `exec` transport throws (daemon down, container gone) | no (handler throws pre-record) | no | 🔢 caveat count |
| Non-LLM step failure | no | no | 🔢 caveat count |

Headline (failed/aborted rows *with* cost) and caveat (failed/cancelled *instances* with no `cost_usd>0` row of
any kind) form a clean partition — no run is double-counted. A run whose AI step *succeeded* but failed
downstream has a `cost_usd>0` row, so it appears in neither (its AI spend was not wasted). `workflow_instance_id`
is `NOT NULL`, so the caveat's `NOT IN (...)` subquery is NULL-safe.

## Testing

| Layer | Test |
|---|---|
| `agent-runtime` | Unit: a run that throws **after streaming assistant messages** returns `usage` accumulated across those turns (not empty); accumulator sums per-model. |
| `analytics` (headline) | Predicate test: a retried run (attempt 1 `error` $X, attempt 2 `success` $Y) contributes only $X to waste — the successful retry attempt is excluded. |
| `analytics` (caveat) | Query test with fixtures — failed-with-cost, failed-no-cost, cancelled-no-cost, completed, failed-but-AI-succeeded — asserts `failedRunsNoCost` counts only failed/cancelled instances with no `cost_usd>0` row. |
| `usage-dashboard` | Render test: caveat string appears when `failedRunsNoCost > 0`; card renders with relaxed gate when `costUsd` is null but failures exist. |

## Out of scope

- Re-pricing historical failed rows (fix is forward-looking — past failures already recorded $0 stay $0).
- Attributing dollar cost to non-LLM step failures.
- Changing the `jm_token_usage` schema.
