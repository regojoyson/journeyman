# Wasted Spend — Accurate Failure Cost Tracking — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the usage dashboard's "Wasted spend" reflect real failures — capture tokens burned by failed Claude runs, count failed/cancelled runs that recorded no cost, and stop counting successful retry attempts as waste.

**Architecture:** Three coordinated layers. (1) `agent-runtime` Claude provider accumulates per-assistant-message usage and returns it on the throw/abort path. (2) `analytics` tightens the waste predicate to `outcome <> 'success'` and adds a `failedRunsNoCost` count over `jm_workflow_instances`. (3) `usage-dashboard` relaxes the render gate and shows a caveat line. `core` gains one field on `UsageWaste`.

**Tech Stack:** TypeScript, npm workspaces, Vitest, PostgreSQL (`pg`), React (SSR-tested via `react-dom/server`), Claude Agent SDK.

**Working agreement (per user):** Work directly on `master`. **No git commits** — leave all changes in the working tree. A single `npm run typecheck` is the final gate (Task 6). TDD steps still run their own package tests as they go.

**Spec:** [docs/superpowers/specs/2026-06-22-wasted-spend-tracking-design.md](../specs/2026-06-22-wasted-spend-tracking-design.md)

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `packages/core/src/types/analytics.types.ts` | `UsageWaste` shared type | Add `failedRunsNoCost: number` |
| `packages/agent-runtime/src/providers/claude/utils/usage.ts` | Usage mappers | Add a streaming usage accumulator |
| `packages/agent-runtime/src/providers/claude/utils/usage.test.ts` | Accumulator unit tests | Add tests |
| `packages/agent-runtime/src/providers/claude/operations/run-custom-prompt.ts` | Claude run + failure handling | Accumulate usage; return it on throw |
| `packages/agent-runtime/src/providers/claude/operations/run-custom-prompt.test.ts` | Run behavior tests | Add throw-with-usage test |
| `packages/analytics/src/db/usage.ts` | `usageWaste` query | Tighten predicate; add caveat query; return new field |
| `packages/analytics/src/db/usage.test.ts` | Analytics query tests | Add predicate + assembly tests |
| `packages/usage-dashboard/src/UsageDashboard.tsx` | Dashboard render | Relax gate; caveat line |
| `packages/usage-dashboard/src/UsageDashboard.smoke.test.tsx` | Render tests | Add caveat render test |

---

## Task 1: Add `failedRunsNoCost` to the `UsageWaste` type

**Files:**
- Modify: `packages/core/src/types/analytics.types.ts:150-156`

- [ ] **Step 1: Add the field**

In `packages/core/src/types/analytics.types.ts`, change the `UsageWaste` interface from:

```ts
export interface UsageWaste {
  costUsd: number | null;
  totalTokens: number;
  rows: number;
  fractionOfTotalCost: number | null;
  topAgent: { agentId: string | null; agentName: string | null; costUsd: number | null } | null;
}
```

to:

```ts
export interface UsageWaste {
  costUsd: number | null;
  totalTokens: number;
  rows: number;
  fractionOfTotalCost: number | null;
  topAgent: { agentId: string | null; agentName: string | null; costUsd: number | null } | null;
  /** Failed/cancelled workflow instances that recorded no priced cost (no row with cost_usd>0). */
  failedRunsNoCost: number;
}
```

- [ ] **Step 2: Verify it compiles in isolation**

Run: `npx tsc --noEmit -p packages/core/tsconfig.json`
Expected: PASS (no errors). *(If `core` has no standalone tsconfig, skip — Task 6 covers it.)*

---

## Task 2: Streaming usage accumulator (Claude utils)

**Files:**
- Modify: `packages/agent-runtime/src/providers/claude/utils/usage.ts`
- Test: `packages/agent-runtime/src/providers/claude/utils/usage.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/agent-runtime/src/providers/claude/utils/usage.test.ts`:

```ts
import { createUsageAccumulator } from "./usage.ts";

describe("createUsageAccumulator", () => {
  it("sums per-assistant-message usage keyed by model", () => {
    const acc = createUsageAccumulator();
    acc.add({ type: "assistant", message: { model: "claude-x", usage: {
      input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 5, cache_creation_input_tokens: 1 } } });
    acc.add({ type: "assistant", message: { model: "claude-x", usage: {
      input_tokens: 50, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } });
    const rows = acc.toTokenUsage();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      provider: "claude", vendor: "anthropic", model: "claude-x",
      inputTokens: 150, outputTokens: 30, cacheReadTokens: 5, cacheCreationTokens: 1, totalTokens: 180,
    });
  });

  it("ignores non-assistant messages and messages without usage", () => {
    const acc = createUsageAccumulator();
    acc.add({ type: "result", subtype: "success" });
    acc.add({ type: "assistant", message: { model: "claude-x" } });
    expect(acc.toTokenUsage()).toEqual([]);
  });

  it("separates models", () => {
    const acc = createUsageAccumulator();
    acc.add({ type: "assistant", message: { model: "a", usage: { input_tokens: 1, output_tokens: 1 } } });
    acc.add({ type: "assistant", message: { model: "b", usage: { input_tokens: 2, output_tokens: 2 } } });
    expect(acc.toTokenUsage().map((r) => r.model).sort()).toEqual(["a", "b"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/agent-runtime/src/providers/claude/utils/usage.test.ts`
Expected: FAIL — `createUsageAccumulator is not a function` / no export.

- [ ] **Step 3: Implement the accumulator**

Append to `packages/agent-runtime/src/providers/claude/utils/usage.ts`:

```ts
type Mutable = { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheCreationTokens: number };

export interface UsageAccumulator {
  /** Fold one streamed SDK message; only `assistant` messages with `message.usage` contribute. */
  add(msg: unknown): void;
  /** Snapshot the accumulated usage as one TokenUsage per model. */
  toTokenUsage(): TokenUsage[];
}

/**
 * Accumulates per-assistant-message usage across a streaming `query()` run. Used to recover
 * partial usage when the run throws/aborts before emitting a final `result` message (whose
 * `modelUsage` we'd otherwise rely on). Keyed by `message.model`.
 */
export function createUsageAccumulator(): UsageAccumulator {
  const byModel = new Map<string, Mutable>();
  return {
    add(msg: unknown) {
      const m = msg as { type?: string; message?: { model?: string; usage?: Record<string, number | undefined> } };
      if (m?.type !== "assistant" || !m.message?.usage) return;
      const model = m.message.model ?? "unknown";
      const u = m.message.usage;
      const cur = byModel.get(model) ?? { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 };
      cur.inputTokens += u.input_tokens ?? 0;
      cur.outputTokens += u.output_tokens ?? 0;
      cur.cacheReadTokens += u.cache_read_input_tokens ?? 0;
      cur.cacheCreationTokens += u.cache_creation_input_tokens ?? 0;
      byModel.set(model, cur);
    },
    toTokenUsage(): TokenUsage[] {
      return [...byModel.entries()].map(([model, c]) => ({
        provider: "claude", vendor: "anthropic", model,
        inputTokens: c.inputTokens, outputTokens: c.outputTokens,
        cacheReadTokens: c.cacheReadTokens, cacheCreationTokens: c.cacheCreationTokens,
        totalTokens: c.inputTokens + c.outputTokens,
      }));
    },
  };
}
```

> Note: `usage.ts` already imports `TokenUsage` at the top (`import type { TokenUsage } from "@journeyman/core";`). Reuse it — do not re-import.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/agent-runtime/src/providers/claude/utils/usage.test.ts`
Expected: PASS (all `createUsageAccumulator` tests green, existing `modelUsageToTokenUsage` tests still green).

---

## Task 3: Return accumulated usage on the Claude throw/abort path

**Files:**
- Modify: `packages/agent-runtime/src/providers/claude/operations/run-custom-prompt.ts:9` (import), `:151-176` (loop + catch)
- Test: `packages/agent-runtime/src/providers/claude/operations/run-custom-prompt.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/agent-runtime/src/providers/claude/operations/run-custom-prompt.test.ts` a NEW describe block. It needs its own SDK mock that yields assistant messages then throws, so add it in a separate test file to avoid clashing with the module-level mock already in `run-custom-prompt.test.ts`.

Create: `packages/agent-runtime/src/providers/claude/operations/run-custom-prompt-failure.test.ts`

```ts
import { describe, it, expect, vi } from "vitest";

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: () => (async function* () {
    yield { type: "assistant", message: { model: "claude-x", usage: { input_tokens: 200, output_tokens: 40 } } } as never;
    yield { type: "assistant", message: { model: "claude-x", usage: { input_tokens: 100, output_tokens: 10 } } } as never;
    throw new Error("connection reset");
  })(),
}));

import { runCustomPrompt } from "./run-custom-prompt.ts";

describe("runCustomPrompt — usage on failure", () => {
  it("returns tokens accumulated across assistant messages when the run throws", async () => {
    const res = await runCustomPrompt({ prompt: "x", outputMode: "text" });
    expect(res.error).toContain("connection reset");
    expect(res.usage).toBeDefined();
    expect(res.usage).toHaveLength(1);
    expect(res.usage![0]).toMatchObject({ model: "claude-x", inputTokens: 300, outputTokens: 50, totalTokens: 350 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/agent-runtime/src/providers/claude/operations/run-custom-prompt-failure.test.ts`
Expected: FAIL — `res.usage` is `undefined` (current catch path returns `{ sessionId, error }`).

- [ ] **Step 3: Wire the accumulator into the run**

In `packages/agent-runtime/src/providers/claude/operations/run-custom-prompt.ts`, update the import on line 9 from:

```ts
import { modelUsageToTokenUsage } from "../utils/usage.ts";
```

to:

```ts
import { modelUsageToTokenUsage, createUsageAccumulator } from "../utils/usage.ts";
```

Then change the try/catch block (currently lines 151-176) to create the accumulator, feed each message, and return it on throw:

```ts
  const acc = createUsageAccumulator();
  try {
    for await (const msg of query({ prompt: opts.prompt, options: queryOptions as any })) {
      logSdkMessage(msg, opts.onLog, opts.agentLogLevel);
      acc.add(msg);
      if ((msg as any).type === "result") {
        const m = msg as any;
        const usage = modelUsageToTokenUsage(m.modelUsage);
        if (m.subtype !== "success") {
          const error = withStderr(m.errors?.[0] ?? m.subtype ?? "unknown failure");
          log.error({ sessionId, error }, "runCustomPrompt failed");
          return { sessionId, error, usage };
        }
        if (opts.outputMode === "none") {
          out = { sessionId, usage };
        } else if (opts.outputMode === "text") {
          const text = typeof m.result === "string" ? m.result : (m.text ?? "");
          out = { sessionId, result: text, usage };
        } else {
          out = { sessionId, structured: m.structured_output, usage };
        }
      }
    }
  } catch (err) {
    const error = withStderr(String((err as Error)?.message ?? err));
    log.error({ sessionId, error }, "runCustomPrompt threw");
    return { sessionId, error, usage: acc.toTokenUsage() };
  }
```

> Only two lines change semantically: `const acc = createUsageAccumulator();` before the loop, `acc.add(msg);` inside it, and `usage: acc.toTokenUsage()` in the catch return. The result-message branch is unchanged — `modelUsage` stays authoritative when a result exists.

- [ ] **Step 4: Run both prompt test files to verify they pass**

Run: `npx vitest run packages/agent-runtime/src/providers/claude/operations/`
Expected: PASS — new failure test green; existing `run-custom-prompt.test.ts` (tool wiring) still green.

---

## Task 4: Tighten waste predicate + add caveat query (analytics)

**Files:**
- Modify: `packages/analytics/src/db/usage.ts:143-171`
- Test: `packages/analytics/src/db/usage.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/analytics/src/db/usage.test.ts`:

```ts
import { WASTE_OUTCOME_PREDICATE, usageWaste } from "./usage.ts";

describe("waste predicate", () => {
  it("counts failed/aborted attempts only — not successful retries", () => {
    expect(WASTE_OUTCOME_PREDICATE).toBe("outcome <> 'success'");
    expect(WASTE_OUTCOME_PREDICATE).not.toContain("attempt");
  });
});

describe("usageWaste assembly", () => {
  // Fake pool: dispatch canned rows by inspecting the SQL each query runs.
  const pool = {
    query: async (sql: string) => {
      if (sql.includes("jm_workflow_instances")) return { rows: [{ failed_runs: 3 }] };
      if (sql.includes("agent_id")) return { rows: [{ agent_id: "a1", agent_name: "Coder", cost_usd: "0.30" }] };
      if (sql.includes("total_tokens")) return { rows: [{ cost_usd: "0.30", total_tokens: "1500", rows: 2 }] };
      return { rows: [{ cost_usd: "1.20" }] }; // total cost
    },
  } as unknown as import("pg").Pool;

  it("returns failedRunsNoCost and a fraction over total cost", async () => {
    const w = await usageWaste(pool, "ws1", new Date("2026-06-01"));
    expect(w.costUsd).toBe(0.3);
    expect(w.failedRunsNoCost).toBe(3);
    expect(w.fractionOfTotalCost).toBeCloseTo(0.25, 6);
    expect(w.topAgent).toMatchObject({ agentName: "Coder", costUsd: 0.3 });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/analytics/src/db/usage.test.ts`
Expected: FAIL — `WASTE_OUTCOME_PREDICATE` is not exported; `usageWaste` returns no `failedRunsNoCost`.

- [ ] **Step 3: Implement the predicate + caveat query**

In `packages/analytics/src/db/usage.ts`, replace the `usageWaste` function (lines 143-171) with:

```ts
/** Waste = failed/aborted token rows. Excludes successful retries (a successful attempt is not waste). */
export const WASTE_OUTCOME_PREDICATE = "outcome <> 'success'";

export async function usageWaste(pool: Pool, wsId: string, since: Date): Promise<UsageWaste> {
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(total_tokens),0)::bigint AS total_tokens,
            COUNT(*)::int AS rows, SUM(cost_usd) AS cost_usd
     FROM jm_token_usage
     WHERE workspace_id = $1 AND created_at >= $2 AND ${WASTE_OUTCOME_PREDICATE}`,
    [wsId, since],
  );
  const totalCostRow = await pool.query(
    `SELECT SUM(cost_usd) AS cost_usd FROM jm_token_usage WHERE workspace_id = $1 AND created_at >= $2`,
    [wsId, since],
  );
  const topAgentRow = await pool.query(
    `SELECT agent_id, agent_name, SUM(cost_usd) AS cost_usd
     FROM jm_token_usage
     WHERE workspace_id = $1 AND created_at >= $2 AND ${WASTE_OUTCOME_PREDICATE}
     GROUP BY agent_id, agent_name ORDER BY cost_usd DESC NULLS LAST LIMIT 1`,
    [wsId, since],
  );
  const failedRunsRow = await pool.query(
    `SELECT count(*)::int AS failed_runs
     FROM jm_workflow_instances
     WHERE workspace_id = $1 AND created_at >= $2
       AND status IN ('failed','cancelled')
       AND id NOT IN (
         SELECT DISTINCT workflow_instance_id FROM jm_token_usage
         WHERE workspace_id = $1 AND created_at >= $2 AND cost_usd > 0
       )`,
    [wsId, since],
  );
  const wasteCost = rows[0].cost_usd === null ? null : Number(rows[0].cost_usd);
  const totalCost = totalCostRow.rows[0].cost_usd === null ? null : Number(totalCostRow.rows[0].cost_usd);
  const ta = topAgentRow.rows[0];
  return {
    costUsd: wasteCost, totalTokens: Number(rows[0].total_tokens), rows: Number(rows[0].rows),
    fractionOfTotalCost: wasteCost !== null && totalCost && totalCost > 0 ? wasteCost / totalCost : null,
    topAgent: ta ? { agentId: ta.agent_id ?? null, agentName: ta.agent_name ?? null,
      costUsd: ta.cost_usd === null ? null : Number(ta.cost_usd) } : null,
    failedRunsNoCost: Number(failedRunsRow.rows[0].failed_runs),
  };
}
```

> `workflow_instance_id` is `NOT NULL` in `jm_token_usage` (migration 064), so the `NOT IN (...)` subquery is NULL-safe. Column names (`workspace_id`, `status`, `created_at`, `id`) match existing analytics queries in `live.ts`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run packages/analytics/src/db/usage.test.ts`
Expected: PASS — predicate and assembly tests green; existing `DIMENSION_SQL`/derivation tests still green.

---

## Task 5: Relax the render gate + caveat line (usage-dashboard)

**Files:**
- Modify: `packages/usage-dashboard/src/UsageDashboard.tsx:124-130`
- Test: `packages/usage-dashboard/src/UsageDashboard.smoke.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `packages/usage-dashboard/src/UsageDashboard.smoke.test.tsx`:

```ts
import type { UsageWaste } from "@journeyman/core";

function renderWithWaste(waste: UsageWaste) {
  return renderToStaticMarkup(
    <UsageDashboard
      window="30d" onWindowChange={() => {}}
      groupBy="model" onGroupByChange={() => {}}
      summary={summary} timeseries={timeseries} breakdown={breakdown}
      waste={waste} workspaceName="Cadmium"
    />,
  );
}

describe("UsageDashboard waste caveat", () => {
  it("shows the caveat and renders the card even when costUsd is null", () => {
    const html = renderWithWaste({
      costUsd: null, totalTokens: 0, rows: 0, fractionOfTotalCost: null, topAgent: null, failedRunsNoCost: 8,
    });
    expect(html).toContain("Wasted spend");
    expect(html).toContain("$0.00");
    expect(html).toContain("8 more run");
    expect(html).toContain("no AI cost recorded");
  });

  it("hides the card when there is neither cost nor failed runs", () => {
    const html = renderWithWaste({
      costUsd: null, totalTokens: 0, rows: 0, fractionOfTotalCost: null, topAgent: null, failedRunsNoCost: 0,
    });
    expect(html).not.toContain("Wasted spend");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/usage-dashboard/src/UsageDashboard.smoke.test.tsx`
Expected: FAIL — card is hidden when `costUsd` is null (current gate is `p.waste.costUsd !== null`), so "Wasted spend" is absent.

- [ ] **Step 3: Relax the gate and add the caveat**

In `packages/usage-dashboard/src/UsageDashboard.tsx`, replace the waste block (lines 124-130):

```tsx
      {p.waste && p.waste.costUsd !== null && (
        <div style={{ marginTop: 16, background: "rgba(255,106,106,.12)", borderRadius: 8, padding: "12px 16px", fontSize: 13 }}>
          Wasted spend — {formatUsd(p.waste.costUsd)} on failed / retried runs
          {p.waste.fractionOfTotalCost !== null && ` (${Math.round(p.waste.fractionOfTotalCost * 100)}% of total)`}.
          {p.waste.topAgent?.agentName && ` ${p.waste.topAgent.agentName} accounts for ${formatUsd(p.waste.topAgent.costUsd)}.`}
        </div>
      )}
```

with:

```tsx
      {p.waste && (p.waste.costUsd !== null || p.waste.failedRunsNoCost > 0) && (
        <div style={{ marginTop: 16, background: "rgba(255,106,106,.12)", borderRadius: 8, padding: "12px 16px", fontSize: 13 }}>
          Wasted spend — {formatUsd(p.waste.costUsd ?? 0)} on failed / retried runs
          {p.waste.fractionOfTotalCost !== null && ` (${Math.round(p.waste.fractionOfTotalCost * 100)}% of total)`}.
          {p.waste.topAgent?.agentName && ` ${p.waste.topAgent.agentName} accounts for ${formatUsd(p.waste.topAgent.costUsd)}.`}
          {p.waste.failedRunsNoCost > 0 &&
            ` ${p.waste.failedRunsNoCost} more run${p.waste.failedRunsNoCost === 1 ? "" : "s"} failed or were cancelled with no AI cost recorded.`}
        </div>
      )}
```

> `formatUsd(p.waste.costUsd ?? 0)` renders `$0.00` for a null cost (plain `formatUsd(null)` returns `"—"`).

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/usage-dashboard/src/UsageDashboard.smoke.test.tsx`
Expected: PASS — caveat tests green; existing smoke tests (which pass `waste={null}`) still green.

---

## Task 6: Final verification (typecheck + full touched-package tests)

**Files:** none (verification only)

- [ ] **Step 1: Run the new/affected package test suites**

Run:
```bash
npx vitest run \
  packages/agent-runtime/src/providers/claude \
  packages/analytics/src/db/usage.test.ts \
  packages/usage-dashboard/src/UsageDashboard.smoke.test.tsx
```
Expected: PASS — all green.

- [ ] **Step 2: Typecheck the whole workspace**

Run: `npm run typecheck`
Expected: PASS — no type errors. (`UsageWaste` now requires `failedRunsNoCost`; the analytics `usageWaste` return and the dashboard render both supply/consume it. The web `getUsageWaste<UsageWaste>` and `UsageDashboardPage` pass the object straight through, so no change is needed there — but typecheck confirms it.)

- [ ] **Step 3: Report**

Summarize: files changed, test results, typecheck result. **Do not commit** — leave changes in the working tree on `master` for the user to review.

---

## Notes / Out of scope (from spec)

- OpenCode (`session.prompt`) and aisdk (`generateText`) are single request/response calls; their soft-error paths already return usage, and their thrown-without-usage case is covered by the `failedRunsNoCost` count. No change to those providers here.
- No re-pricing of historical rows (forward-looking).
- No `jm_token_usage` schema change.
