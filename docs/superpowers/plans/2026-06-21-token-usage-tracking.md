# Token Usage Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture per-(call×model) token usage from every AI operation (Claude / aisdk / OpenCode) across local and sandboxed runs, persist it to a new workspace-scoped `jm_token_usage` table, and expose a read/aggregation API.

**Architecture:** Each coding provider normalizes its native usage shape into a shared `TokenUsage[]` returned on the operation result. The result flows to the worker step handler (local: in-process; sandboxed: via `RunnerResponse`), which writes append-only rows with `recordTokenUsage()` (idempotent via `ON CONFLICT DO NOTHING`). Agent runs additionally feed the existing `jm_agent_run_counters` rollup. A Fastify route exposes workspace-scoped aggregates.

**Tech Stack:** TypeScript (ESM, `.ts` imports), PostgreSQL 16 via `pg`, Fastify, vitest, Claude Agent SDK, Vercel AI SDK 6, OpenCode SDK.

**Spec:** `docs/superpowers/specs/2026-06-21-token-usage-tracking-design.md`

### Execution constraints (from requester)
- Work directly on the **`master`** branch. Do **not** create a branch or worktree.
- **No git commits.** Skip all commit steps. Leave changes in the working tree.
- Run **`npm run typecheck`** (and `npm run check:boundaries`) **once at the very end** (Task 11). Run unit tests per-task as written, but defer the final full verification to the end.

---

## File Structure

**Create:**
- `packages/agent-runtime/src/providers/claude/utils/usage.ts` — `modelUsageToTokenUsage()`
- `packages/agent-runtime/src/providers/claude/utils/usage.test.ts`
- `packages/agent-runtime/src/providers/aisdk/utils/usage.ts` — `aiSdkUsageToTokenUsage()`, `accumulateUsage()`, `vendorFromConfig()`
- `packages/agent-runtime/src/providers/aisdk/utils/usage.test.ts`
- `packages/agent-runtime/src/providers/opencode/utils/usage.ts` — `openCodeInfoToTokenUsage()`
- `packages/agent-runtime/src/providers/opencode/utils/usage.test.ts`
- `packages/orchestrator/src/usage/record-token-usage.ts` — `recordTokenUsage()`
- `packages/orchestrator/src/usage/record-token-usage.test.ts`
- `packages/orchestrator/src/usage/usage-queries.ts` — `buildUsageAggregateQuery()`
- `packages/orchestrator/src/usage/usage-queries.test.ts`
- `packages/migrations/src/sql/064_token_usage.sql`
- `packages/api-server/src/routes/usage.ts` — `registerUsageRoutes()`

**Modify:**
- `packages/core/src/types/coding.types.ts` — `TokenUsage` type + `RunCustomPromptResult.usage`
- `packages/core/src/types/git.types.ts` — `usage` on `ScanReposResult` / `CheckoutRepoResult`
- `packages/core/src/index.ts` — export `TokenUsage` (if types are re-exported there)
- `packages/agent-runtime/src/providers/claude/operations/{run-custom-prompt,scan-repos,checkout-repo}.ts`
- `packages/agent-runtime/src/providers/aisdk/operations/{run-custom-prompt,scan-repos,checkout-repo}.ts`
- `packages/agent-runtime/src/providers/opencode/operations/{run-custom-prompt,scan-repos,checkout-repo}.ts`
- `packages/agent-runtime/src/runner/runner-types.ts` — `RunnerResponse.usage`
- `packages/agent-runtime/src/runner/dispatch.ts` — thread `usage` on `custom-prompt`
- `packages/orchestrator/src/sandbox/sandbox-instance-coding-provider.ts` — map `r.usage` for `runCustomPrompt`
- `packages/orchestrator/src/workers/steps/{custom-ai,agent-run,start-feature-branch,list-workspace-files}-step-handler.ts`
- `packages/orchestrator/src/cli-worker.ts` — pass `pool` to two handlers
- `packages/orchestrator/src/index.ts` — export `recordTokenUsage`, usage query helpers (as needed)
- `packages/api-server/src/server.ts` — register usage routes

---

## Task 1: Core `TokenUsage` type + result fields

**Files:**
- Modify: `packages/core/src/types/coding.types.ts`
- Modify: `packages/core/src/types/git.types.ts:55-87`
- Modify: `packages/core/src/index.ts`

Pure type changes — verification is the final typecheck (Task 11). No unit test.

- [ ] **Step 1: Add `TokenUsage` and extend `RunCustomPromptResult`**

In `packages/core/src/types/coding.types.ts`, add near the other result types:

```ts
/** Normalized per-(call×model) token usage. Every provider maps its native shape to this. */
export interface TokenUsage {
  /** Execution engine: "claude" | "aisdk" | "opencode" | … */
  provider: string;
  /** Underlying API vendor: "anthropic" | "openai" | "google" | … when known. */
  vendor?: string;
  /** Exact model id reported by the provider. */
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  reasoningTokens?: number;
  totalTokens?: number;
  /** Full provider usage blob for forensics / future fields. */
  raw?: unknown;
}
```

Then add `usage` to the existing `RunCustomPromptResult`:

```ts
export interface RunCustomPromptResult {
  result?: string;
  structured?: unknown;
  error?: string;
  sessionId?: string;
  /** One entry per model used in the call. Empty/undefined ⇒ provider reported nothing. */
  usage?: TokenUsage[];
}
```

- [ ] **Step 2: Extend `ScanReposResult` / `CheckoutRepoResult`**

In `packages/core/src/types/git.types.ts`, add a `usage` field to both types (the file already imports from `coding.types.ts`, so import `TokenUsage` there):

```ts
import type { AgentLogLevel, CodingCliLogFn, TokenUsage } from "./coding.types.ts";
```

```ts
export type ScanReposResult = SessionResult & {
  repos: RepoInfo[];
  error?: string;
  usage?: TokenUsage[];
};
```

```ts
export type CheckoutRepoResult = SessionResult & {
  repos: CheckoutResult[];
  newBranch: string;
  error?: string;
  usage?: TokenUsage[];
};
```

- [ ] **Step 3: Ensure `TokenUsage` is exported from the package entry**

In `packages/core/src/index.ts`, confirm `coding.types.ts` types are re-exported (search for an existing `export * from "./types/coding.types.ts"` or equivalent). If types are exported individually, add `TokenUsage` to that list. If a barrel `export *` already covers it, no change.

- [ ] **Step 4: Quick compile check (scoped)**

Run: `npm run typecheck -w @journeyman/core`
Expected: PASS (no errors).

---

## Task 2: Claude usage adapter

**Files:**
- Create: `packages/agent-runtime/src/providers/claude/utils/usage.ts`
- Test: `packages/agent-runtime/src/providers/claude/utils/usage.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { modelUsageToTokenUsage } from "./usage.ts";

describe("modelUsageToTokenUsage", () => {
  it("fans a multi-model map into one row per model", () => {
    const out = modelUsageToTokenUsage({
      "claude-opus-4-8": { inputTokens: 1200, outputTokens: 800, cacheReadInputTokens: 5000, cacheCreationInputTokens: 10 },
      "claude-haiku-4-5": { inputTokens: 300, outputTokens: 50, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
    });
    expect(out).toHaveLength(2);
    const opus = out.find((u) => u.model === "claude-opus-4-8")!;
    expect(opus).toMatchObject({
      provider: "claude", vendor: "anthropic", model: "claude-opus-4-8",
      inputTokens: 1200, outputTokens: 800, cacheReadTokens: 5000, cacheCreationTokens: 10,
    });
    expect(opus.totalTokens).toBe(2000);
    expect(opus.raw).toBeDefined();
  });

  it("returns [] for empty/undefined input", () => {
    expect(modelUsageToTokenUsage(undefined)).toEqual([]);
    expect(modelUsageToTokenUsage({})).toEqual([]);
  });

  it("tolerates missing fields", () => {
    const out = modelUsageToTokenUsage({ m1: { inputTokens: 5 } as any });
    expect(out[0]).toMatchObject({ model: "m1", inputTokens: 5 });
    expect(out[0].outputTokens).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @journeyman/agent-runtime -- claude/utils/usage`
Expected: FAIL — cannot find module `./usage.ts`.

- [ ] **Step 3: Implement the adapter**

```ts
import type { TokenUsage } from "@journeyman/core";

type ClaudeModelUsage = {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
};

/** Map the Claude SDK result message `modelUsage` map → one TokenUsage per model. */
export function modelUsageToTokenUsage(
  modelUsage: Record<string, ClaudeModelUsage> | undefined | null,
): TokenUsage[] {
  if (!modelUsage) return [];
  return Object.entries(modelUsage).map(([model, u]) => {
    const inputTokens = u.inputTokens;
    const outputTokens = u.outputTokens;
    const totalTokens =
      inputTokens !== undefined || outputTokens !== undefined
        ? (inputTokens ?? 0) + (outputTokens ?? 0)
        : undefined;
    return {
      provider: "claude",
      vendor: "anthropic",
      model,
      inputTokens,
      outputTokens,
      cacheReadTokens: u.cacheReadInputTokens,
      cacheCreationTokens: u.cacheCreationInputTokens,
      totalTokens,
      raw: u,
    };
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @journeyman/agent-runtime -- claude/utils/usage`
Expected: PASS (3 tests).

---

## Task 3: aisdk usage adapter (incl. double-call accumulation + vendor)

**Files:**
- Create: `packages/agent-runtime/src/providers/aisdk/utils/usage.ts`
- Test: `packages/agent-runtime/src/providers/aisdk/utils/usage.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { aiSdkUsageToTokenUsage, accumulateUsage, vendorFromConfig } from "./usage.ts";

describe("aiSdkUsageToTokenUsage", () => {
  it("maps a single-model usage object", () => {
    const out = aiSdkUsageToTokenUsage(
      { inputTokens: 100, outputTokens: 40, totalTokens: 140 },
      "gpt-4o",
      "openai",
    );
    expect(out).toEqual([{
      provider: "aisdk", vendor: "openai", model: "gpt-4o",
      inputTokens: 100, outputTokens: 40, totalTokens: 140,
      reasoningTokens: undefined, cacheReadTokens: undefined,
      raw: { inputTokens: 100, outputTokens: 40, totalTokens: 140 },
    }]);
  });

  it("returns [] when usage is missing", () => {
    expect(aiSdkUsageToTokenUsage(undefined, "gpt-4o", "openai")).toEqual([]);
  });
});

describe("accumulateUsage", () => {
  it("sums token fields for the same model across two calls", () => {
    const a = aiSdkUsageToTokenUsage({ inputTokens: 100, outputTokens: 40, totalTokens: 140 }, "gpt-4o", "openai");
    const b = aiSdkUsageToTokenUsage({ inputTokens: 10, outputTokens: 5, totalTokens: 15 }, "gpt-4o", "openai");
    const out = accumulateUsage([...a, ...b]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ model: "gpt-4o", inputTokens: 110, outputTokens: 45, totalTokens: 155 });
  });

  it("keeps distinct models separate", () => {
    const out = accumulateUsage([
      ...aiSdkUsageToTokenUsage({ inputTokens: 1 }, "a", "openai"),
      ...aiSdkUsageToTokenUsage({ inputTokens: 2 }, "b", "openai"),
    ]);
    expect(out).toHaveLength(2);
  });
});

describe("vendorFromConfig", () => {
  it("derives vendor from the ai-sdk npm package", () => {
    expect(vendorFromConfig({ npm: "@ai-sdk/openai" }, "gpt-4o")).toBe("openai");
    expect(vendorFromConfig({ npm: "@ai-sdk/anthropic" }, "claude-3-5-sonnet")).toBe("anthropic");
  });
  it("falls back to the model-id prefix", () => {
    expect(vendorFromConfig(undefined, "gpt-4o")).toBe("openai");
    expect(vendorFromConfig(undefined, "claude-3-5-sonnet")).toBe("anthropic");
  });
  it("returns undefined when unknown", () => {
    expect(vendorFromConfig(undefined, "some-local-model")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @journeyman/agent-runtime -- aisdk/utils/usage`
Expected: FAIL — cannot find module `./usage.ts`.

- [ ] **Step 3: Implement the adapter**

```ts
import type { TokenUsage, CodingModelConfig } from "@journeyman/core";

type AiSdkUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
  cachedInputTokens?: number;
};

/** Best-effort vendor for an aisdk run: prefer the configured ai-sdk package, else the model-id prefix. */
export function vendorFromConfig(
  config: CodingModelConfig | undefined,
  model: string | undefined,
): string | undefined {
  const npm = config?.npm;
  if (npm) {
    const m = /^@ai-sdk\/([a-z0-9-]+)/.exec(npm);
    if (m && m[1] !== "openai-compatible") return m[1];
  }
  const id = (model ?? "").toLowerCase();
  if (id.startsWith("gpt") || id.startsWith("o1") || id.startsWith("o3")) return "openai";
  if (id.startsWith("claude")) return "anthropic";
  if (id.startsWith("gemini")) return "google";
  return undefined;
}

/** Map one aisdk `result.usage` object → a single TokenUsage (model id known from opts, not the result). */
export function aiSdkUsageToTokenUsage(
  usage: AiSdkUsage | undefined | null,
  model: string,
  vendor: string | undefined,
): TokenUsage[] {
  if (!usage) return [];
  return [{
    provider: "aisdk",
    vendor,
    model,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    reasoningTokens: usage.reasoningTokens,
    cacheReadTokens: usage.cachedInputTokens,
    raw: usage,
  }];
}

const add = (a?: number, b?: number) =>
  a === undefined && b === undefined ? undefined : (a ?? 0) + (b ?? 0);

/** Sum token fields across rows that share the same (provider, model). Used for aisdk's force-JSON retry. */
export function accumulateUsage(rows: TokenUsage[]): TokenUsage[] {
  const byKey = new Map<string, TokenUsage>();
  for (const r of rows) {
    const key = `${r.provider}::${r.model}`;
    const prev = byKey.get(key);
    if (!prev) { byKey.set(key, { ...r }); continue; }
    byKey.set(key, {
      ...prev,
      inputTokens: add(prev.inputTokens, r.inputTokens),
      outputTokens: add(prev.outputTokens, r.outputTokens),
      totalTokens: add(prev.totalTokens, r.totalTokens),
      reasoningTokens: add(prev.reasoningTokens, r.reasoningTokens),
      cacheReadTokens: add(prev.cacheReadTokens, r.cacheReadTokens),
      cacheCreationTokens: add(prev.cacheCreationTokens, r.cacheCreationTokens),
    });
  }
  return [...byKey.values()];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @journeyman/agent-runtime -- aisdk/utils/usage`
Expected: PASS.

---

## Task 4: OpenCode usage adapter

**Files:**
- Create: `packages/agent-runtime/src/providers/opencode/utils/usage.ts`
- Test: `packages/agent-runtime/src/providers/opencode/utils/usage.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { openCodeInfoToTokenUsage } from "./usage.ts";

describe("openCodeInfoToTokenUsage", () => {
  it("maps info.tokens with cache block", () => {
    const out = openCodeInfoToTokenUsage({
      modelID: "claude-3-5-sonnet",
      providerID: "anthropic",
      tokens: { input: 200, output: 60, reasoning: 12, cache: { read: 900, write: 5 } },
    });
    expect(out).toEqual([{
      provider: "opencode", vendor: "anthropic", model: "claude-3-5-sonnet",
      inputTokens: 200, outputTokens: 60, reasoningTokens: 12,
      cacheReadTokens: 900, cacheCreationTokens: 5, totalTokens: 260,
      raw: expect.anything(),
    }]);
  });

  it("returns [] when tokens absent", () => {
    expect(openCodeInfoToTokenUsage({ modelID: "x", providerID: "y" })).toEqual([]);
    expect(openCodeInfoToTokenUsage(undefined)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @journeyman/agent-runtime -- opencode/utils/usage`
Expected: FAIL — cannot find module `./usage.ts`.

- [ ] **Step 3: Implement the adapter**

```ts
import type { TokenUsage } from "@journeyman/core";

type OpenCodeInfo = {
  modelID?: string;
  providerID?: string;
  tokens?: {
    input?: number;
    output?: number;
    reasoning?: number;
    cache?: { read?: number; write?: number };
  };
};

/** Map an OpenCode assistant `info` block → a single TokenUsage (or [] when no tokens reported). */
export function openCodeInfoToTokenUsage(info: OpenCodeInfo | undefined | null): TokenUsage[] {
  if (!info || !info.tokens) return [];
  const t = info.tokens;
  const totalTokens =
    t.input !== undefined || t.output !== undefined ? (t.input ?? 0) + (t.output ?? 0) : undefined;
  return [{
    provider: "opencode",
    vendor: info.providerID,
    model: info.modelID ?? "",
    inputTokens: t.input,
    outputTokens: t.output,
    reasoningTokens: t.reasoning,
    cacheReadTokens: t.cache?.read,
    cacheCreationTokens: t.cache?.write,
    totalTokens,
    raw: info,
  }];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @journeyman/agent-runtime -- opencode/utils/usage`
Expected: PASS.

---

## Task 5: Wire adapters into provider operations

No new unit tests here (the adapters are tested; these are integration edits verified by the final typecheck + existing provider tests). Each operation must attach `usage` on **all** output modes and on the failure path.

**Files:**
- Modify: `packages/agent-runtime/src/providers/claude/operations/run-custom-prompt.ts`
- Modify: `packages/agent-runtime/src/providers/claude/operations/scan-repos.ts`
- Modify: `packages/agent-runtime/src/providers/claude/operations/checkout-repo.ts`
- Modify: `packages/agent-runtime/src/providers/aisdk/operations/run-custom-prompt.ts`
- Modify: `packages/agent-runtime/src/providers/aisdk/operations/scan-repos.ts`
- Modify: `packages/agent-runtime/src/providers/aisdk/operations/checkout-repo.ts`
- Modify: `packages/agent-runtime/src/providers/opencode/operations/run-custom-prompt.ts`
- Modify: `packages/agent-runtime/src/providers/opencode/operations/scan-repos.ts`
- Modify: `packages/agent-runtime/src/providers/opencode/operations/checkout-repo.ts`

- [ ] **Step 1: Claude `run-custom-prompt.ts`**

Import the adapter at the top:

```ts
import { modelUsageToTokenUsage } from "../utils/usage.ts";
```

In the `for await` loop, the result message handling currently branches on `outputMode` and returns early for failures. Extract usage from the result message **before** building the output, and attach it to every branch. Concretely, inside `if ((msg as any).type === "result") {`:

```ts
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
```

- [ ] **Step 2: Claude `scan-repos.ts` and `checkout-repo.ts`**

In each, import `modelUsageToTokenUsage` and, where the `result` message is handled, attach usage to the returned object. For `scan-repos.ts` the success line is currently `output = { ...(msg.structured_output as ScanReposResult), sessionId };` — change to:

```ts
const usage = modelUsageToTokenUsage((msg as any).modelUsage);
output = { ...(msg.structured_output as ScanReposResult), sessionId, usage };
```

And on the failure branch `return { repos: [], error, sessionId };` → add `usage`:

```ts
const usage = modelUsageToTokenUsage((msg as any).modelUsage);
return { repos: [], error, sessionId, usage };
```

Apply the analogous change in `checkout-repo.ts` (its success/failure return shapes include `repos`, `newBranch`).

- [ ] **Step 3: aisdk `run-custom-prompt.ts`**

Import:

```ts
import { aiSdkUsageToTokenUsage, accumulateUsage, vendorFromConfig } from "../utils/usage.ts";
```

Compute vendor once after resolving the model:

```ts
const vendor = vendorFromConfig(opts.modelConfig, opts.model);
```

Accumulate usage across the primary call and the force-JSON retry. After the first `generateText` resolves into `result`, start a usage array; after the optional `forced` call, add its usage; attach `accumulateUsage(...)` to every return. Pattern:

```ts
const usageRows: TokenUsage[] = aiSdkUsageToTokenUsage(result.usage, opts.model ?? "", vendor);
// ...later, inside the `if (structured === undefined)` retry block, after `forced` resolves:
usageRows.push(...aiSdkUsageToTokenUsage(forced.usage, opts.model ?? "", vendor));
```

Then change each `return { sessionId, ... }` in this function to include `usage: accumulateUsage(usageRows)` — including the `none` early return, the `text` return, the structured success return, and the structured-failure `return { sessionId, error: ... }`. For the outer `catch (err)` return, usage is unavailable (the call threw) — return without `usage` (handler records `usage_reported=false`). Add `import type { TokenUsage } from "@journeyman/core";`.

- [ ] **Step 4: aisdk `scan-repos.ts` / `checkout-repo.ts`**

These do not call the model in the current aisdk implementation (no `generateText`). Leave them functionally unchanged but ensure they still satisfy the `ScanReposResult` / `CheckoutRepoResult` types (the new `usage` field is optional, so no change is required). No edit needed unless an aisdk model call is added later.

- [ ] **Step 5: OpenCode `run-custom-prompt.ts`**

Import:

```ts
import { openCodeInfoToTokenUsage } from "../utils/usage.ts";
```

After `const info = res.data.info as { error?: unknown; structured?: unknown };` widen the cast to include usage fields and compute usage once, before the output-mode branches:

```ts
const info = res.data.info as { error?: unknown; structured?: unknown; tokens?: unknown; modelID?: string; providerID?: string };
const usage = openCodeInfoToTokenUsage(info as any);
```

Attach `usage` to every return in this function: the `info.error` failure return, the `none` return, the `text` return, the structured success return, the salvaged return, and the structured-invalid error return. Example for the `none` branch: `if (opts.outputMode === "none") return { sessionId, usage };`.

- [ ] **Step 6: OpenCode `scan-repos.ts` / `checkout-repo.ts`**

Both read `result.data.info`. Import `openCodeInfoToTokenUsage`, compute `const usage = openCodeInfoToTokenUsage(result.data.info as any);` after the `info` is available, and add `usage` to the returned `ScanReposResult` / `CheckoutRepoResult` (success and error returns).

- [ ] **Step 7: Scoped typecheck**

Run: `npm run typecheck -w @journeyman/agent-runtime`
Expected: PASS.

---

## Task 6: Thread usage through the runner + sandbox bridge

**Files:**
- Modify: `packages/agent-runtime/src/runner/runner-types.ts`
- Modify: `packages/agent-runtime/src/runner/dispatch.ts:42-50`
- Modify: `packages/orchestrator/src/sandbox/sandbox-instance-coding-provider.ts:27-39`

`scanRepos` / `checkoutRepo` already return the whole result object as `structured` (so `usage` rides inside it). Only the `custom-prompt` case splits `structured`/`result` and must carry `usage` separately.

- [ ] **Step 1: Add `usage` to `RunnerResponse`**

In `packages/agent-runtime/src/runner/runner-types.ts`, import the type and extend:

```ts
import type { TokenUsage } from "@journeyman/core";
```

```ts
export interface RunnerResponse {
  ok: boolean;
  structured?: unknown;
  result?: string;
  error?: string;
  /** Token usage for custom-prompt ops (scan/checkout carry usage inside `structured`). */
  usage?: TokenUsage[];
}
```

- [ ] **Step 2: Carry usage in `dispatch.ts` custom-prompt case**

Change the `custom-prompt` case so both the error and success returns include `usage`:

```ts
case "custom-prompt": {
  const r = await provider.runCustomPrompt({
    ...base,
    ...(hooks.onLog ? { onLog: hooks.onLog } : {}),
  } as Parameters<ICodingCLI["runCustomPrompt"]>[0]);
  if (r.error) return { ok: false, error: r.error, usage: r.usage };
  return { ok: true, structured: r.structured, result: r.result, usage: r.usage };
}
```

- [ ] **Step 3: Map usage back in the sandbox provider**

In `packages/orchestrator/src/sandbox/sandbox-instance-coding-provider.ts`, the `runCustomPrompt` method currently returns `{ result }` or `{ structured }`. Add `usage` from the runner response:

```ts
async runCustomPrompt(opts: RunCustomPromptOptions): Promise<RunCustomPromptResult> {
  const r = await this.exec({ /* unchanged */ } as any);
  if (!r.ok) return { error: r.error ?? "sandbox exec failed", usage: (r as any).usage };
  if (typeof r.structured === "string") return { result: r.structured, usage: (r as any).usage };
  return { structured: r.structured, usage: (r as any).usage };
}
```

(The `scanRepos` / `checkoutRepo` methods already `return r.structured as ...` — usage is inside that object, so they need no change.)

- [ ] **Step 4: Scoped typecheck**

Run: `npm run typecheck -w @journeyman/agent-runtime && npm run typecheck -w @journeyman/orchestrator`
Expected: PASS.

---

## Task 7: Migration — `jm_token_usage`

**Files:**
- Create: `packages/migrations/src/sql/064_token_usage.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 064_token_usage.sql — append-only per-(call×model) token usage, workspace-scoped.
-- Source of truth for the future usage dashboard. cost_usd is reserved (NULL this phase).

CREATE TABLE IF NOT EXISTS jm_token_usage (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id          UUID REFERENCES jm_workspaces(id) ON DELETE CASCADE,
  org_id                UUID,
  workflow_id           UUID,
  workflow_version_id   UUID,
  workflow_name         TEXT,
  workflow_instance_id  UUID NOT NULL REFERENCES jm_workflow_instances(id) ON DELETE CASCADE,
  node_id               TEXT NOT NULL,
  step_type             TEXT NOT NULL,
  step_name             TEXT,
  attempt               INTEGER NOT NULL DEFAULT 1,
  agent_id              UUID,
  agent_name            TEXT,
  triggered_by_user_id  UUID,
  provider              TEXT NOT NULL,
  vendor                TEXT,
  model                 TEXT,
  outcome               TEXT NOT NULL DEFAULT 'success',
  input_tokens          BIGINT,
  output_tokens         BIGINT,
  cache_read_tokens     BIGINT,
  cache_creation_tokens BIGINT,
  reasoning_tokens      BIGINT,
  total_tokens          BIGINT,
  usage_reported        BOOLEAN NOT NULL DEFAULT true,
  cost_usd              NUMERIC,
  raw_usage             JSONB,
  session_id            TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS jm_token_usage_ws_created_idx   ON jm_token_usage (workspace_id, created_at);
CREATE INDEX IF NOT EXISTS jm_token_usage_ws_workflow_idx  ON jm_token_usage (workspace_id, workflow_id, created_at);
CREATE INDEX IF NOT EXISTS jm_token_usage_instance_idx     ON jm_token_usage (workflow_instance_id);
CREATE INDEX IF NOT EXISTS jm_token_usage_agent_idx        ON jm_token_usage (agent_id);
CREATE INDEX IF NOT EXISTS jm_token_usage_ws_model_idx     ON jm_token_usage (workspace_id, provider, model);
CREATE INDEX IF NOT EXISTS jm_token_usage_ws_vendor_idx    ON jm_token_usage (workspace_id, vendor);

-- Idempotency: Conductor is at-least-once. A node maps to one terminal call; multi-model
-- calls produce distinct `model`s. COALESCE(model,'') so NULL-model (usage_reported=false)
-- rows also dedupe on redelivery.
CREATE UNIQUE INDEX IF NOT EXISTS jm_token_usage_dedupe_idx
  ON jm_token_usage (workflow_instance_id, node_id, attempt, provider, COALESCE(model, ''));
```

- [ ] **Step 2: Apply the migration locally (optional, if a dev DB is running)**

Run: `npm run migrate`
Expected: applies `064_token_usage.sql` with no error. (If no dev DB is configured, skip — the SQL is verified by Task 8's writer test using a mock pool.)

---

## Task 8: `recordTokenUsage` writer

**Files:**
- Create: `packages/orchestrator/src/usage/record-token-usage.ts`
- Test: `packages/orchestrator/src/usage/record-token-usage.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { recordTokenUsage, type RecordTokenUsageArgs } from "./record-token-usage.ts";

function fakePool() {
  const calls: { sql: string; params: unknown[] }[] = [];
  const pool = { query: async (sql: string, params: unknown[]) => { calls.push({ sql, params }); return { rowCount: 1 }; } };
  return { pool: pool as any, calls };
}

const base: RecordTokenUsageArgs = {
  workspaceId: "ws1", orgId: "org1", workflowId: "wf1", workflowVersionId: "v1", workflowName: "WF",
  workflowInstanceId: "run1", nodeId: "n1", stepType: "custom-ai", stepName: "step", attempt: 1,
  agentId: null, agentName: null, triggeredByUserId: "u1", outcome: "success",
  provider: "claude", requestedModel: "claude-opus-4-8",
  usage: [
    { provider: "claude", vendor: "anthropic", model: "claude-opus-4-8", inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    { provider: "claude", vendor: "anthropic", model: "claude-haiku-4-5", inputTokens: 2, outputTokens: 1, totalTokens: 3 },
  ],
};

describe("recordTokenUsage", () => {
  it("no-ops and returns 0 when pool is absent", async () => {
    expect(await recordTokenUsage(null, base)).toBe(0);
    expect(await recordTokenUsage(undefined, base)).toBe(0);
  });

  it("inserts one row per usage entry and returns inserted count", async () => {
    const { pool, calls } = fakePool();
    const n = await recordTokenUsage(pool, base);
    expect(n).toBe(2);
    expect(calls).toHaveLength(2);
    expect(calls[0].sql).toContain("INSERT INTO jm_token_usage");
    expect(calls[0].sql).toContain("ON CONFLICT");
    expect(calls[0].params).toContain("claude-opus-4-8");
  });

  it("writes one usage_reported=false row with the requested model when usage is empty", async () => {
    const { pool, calls } = fakePool();
    const n = await recordTokenUsage(pool, { ...base, usage: [] });
    expect(n).toBe(1);
    expect(calls).toHaveLength(1);
    expect(calls[0].params).toContain("claude-opus-4-8"); // requestedModel fallback
    expect(calls[0].params).toContain(false);             // usage_reported
  });

  it("does not throw when a query rejects", async () => {
    const pool = { query: async () => { throw new Error("db down"); } } as any;
    await expect(recordTokenUsage(pool, base)).resolves.toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @journeyman/orchestrator -- usage/record-token-usage`
Expected: FAIL — cannot find module `./record-token-usage.ts`.

- [ ] **Step 3: Implement the writer**

```ts
import type { Pool } from "pg";
import { createLogger, type TokenUsage } from "@journeyman/core";

const log = createLogger("usage:record");

export interface RecordTokenUsageArgs {
  workspaceId: string | null;
  orgId: string | null;
  workflowId: string | null;
  workflowVersionId: string | null;
  workflowName: string | null;
  workflowInstanceId: string;
  nodeId: string;
  stepType: string;
  stepName: string | null;
  attempt: number;
  agentId: string | null;
  agentName: string | null;
  triggeredByUserId: string | null;
  outcome: "success" | "error" | "aborted";
  provider: string;
  /** Used as the model on a usage_reported=false row when the provider reported nothing. */
  requestedModel: string | null;
  usage: TokenUsage[];
}

const INSERT = `
  INSERT INTO jm_token_usage (
    workspace_id, org_id, workflow_id, workflow_version_id, workflow_name,
    workflow_instance_id, node_id, step_type, step_name, attempt,
    agent_id, agent_name, triggered_by_user_id, provider, vendor, model, outcome,
    input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
    reasoning_tokens, total_tokens, usage_reported, raw_usage
  ) VALUES (
    $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25
  )
  ON CONFLICT (workflow_instance_id, node_id, attempt, provider, COALESCE(model, '')) DO NOTHING`;

/**
 * Append one jm_token_usage row per model used. Empty usage ⇒ a single usage_reported=false
 * row. Never throws (best-effort logging). Returns the number of rows actually inserted
 * (0 on a duplicate / no pool), so callers can gate downstream rollups on a real insert.
 */
export async function recordTokenUsage(
  pool: Pool | null | undefined,
  args: RecordTokenUsageArgs,
): Promise<number> {
  if (!pool) return 0;
  const rows: Array<{ u: TokenUsage; reported: boolean }> = args.usage.length
    ? args.usage.map((u) => ({ u, reported: true }))
    : [{ u: { provider: args.provider, model: args.requestedModel ?? undefined as any }, reported: false }];

  let inserted = 0;
  try {
    for (const { u, reported } of rows) {
      const res = await pool.query(INSERT, [
        args.workspaceId, args.orgId, args.workflowId, args.workflowVersionId, args.workflowName,
        args.workflowInstanceId, args.nodeId, args.stepType, args.stepName, args.attempt,
        args.agentId, args.agentName, args.triggeredByUserId, u.provider ?? args.provider,
        u.vendor ?? null, u.model ?? args.requestedModel ?? null, args.outcome,
        u.inputTokens ?? null, u.outputTokens ?? null, u.cacheReadTokens ?? null,
        u.cacheCreationTokens ?? null, u.reasoningTokens ?? null, u.totalTokens ?? null,
        reported, u.raw != null ? JSON.stringify(u.raw) : null,
      ]);
      inserted += res.rowCount ?? 0;
    }
  } catch (err) {
    log.warn({ err: (err as Error)?.message, instance: args.workflowInstanceId, node: args.nodeId }, "recordTokenUsage failed (ignored)");
    return inserted;
  }
  return inserted;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @journeyman/orchestrator -- usage/record-token-usage`
Expected: PASS.

- [ ] **Step 5: Export from the package**

In `packages/orchestrator/src/index.ts`, add:

```ts
export { recordTokenUsage } from "./usage/record-token-usage.ts";
export type { RecordTokenUsageArgs } from "./usage/record-token-usage.ts";
```

---

## Task 9: Persist usage from the four step handlers

`recordTokenUsage` fields come mostly from `input` (worker-injected) + `ctx`. A small shared helper resolves `workflowVersionId`/`workflowName` (not in input) from the instance store, cached by the handler's single call.

**Files:**
- Modify: `packages/orchestrator/src/workers/steps/custom-ai-step-handler.ts`
- Modify: `packages/orchestrator/src/workers/steps/agent-run-step-handler.ts`
- Modify: `packages/orchestrator/src/workers/steps/start-feature-branch-step-handler.ts`
- Modify: `packages/orchestrator/src/workers/steps/list-workspace-files-step-handler.ts`
- Modify: `packages/orchestrator/src/cli-worker.ts:204-205`

- [ ] **Step 1: `custom-ai-step-handler.ts` — record after the call**

The handler already has `this.deps.pool`, `input.provider`, `input.model`, `input.workspaceId`, `input.workflowId`, `input.startedByOrgId`, `input.startedByUserId`, `input.agentId`, `input.displayName`. After `const result = await coding.runCustomPrompt({...});` and before the `if (result.error)` branch, capture the common fields and record on both paths:

```ts
import { recordTokenUsage } from "../../usage/record-token-usage.ts";

// after `const result = await coding.runCustomPrompt(...)`
const outcome: "success" | "error" | "aborted" =
  ctx.signal.aborted ? "aborted" : result.error ? "error" : "success";
let versionId: string | null = null;
let wfName: string | null = null;
try {
  const wi = await this.deps.pool.query(
    "SELECT workflow_version_id, workflow_name_snapshot FROM jm_workflow_instances WHERE id = $1",
    [ctx.workflowInstanceId],
  );
  versionId = wi.rows[0]?.workflow_version_id ?? null;
  wfName = wi.rows[0]?.workflow_name_snapshot ?? null;
} catch { /* non-fatal */ }
await recordTokenUsage(this.deps.pool, {
  workspaceId: (typeof input.workspaceId === "string" ? input.workspaceId : null),
  orgId, workflowId, workflowVersionId: versionId, workflowName: wfName,
  workflowInstanceId: ctx.workflowInstanceId, nodeId: ctx.nodeId, stepType: this.stepType,
  stepName: step.name ?? null, attempt: ctx.attempt,
  agentId: (typeof input.agentId === "string" ? input.agentId : null),
  agentName: (typeof input.displayName === "string" ? input.displayName : null),
  triggeredByUserId: userId, outcome, provider: provider ?? "claude",
  requestedModel: model ?? null, usage: result.usage ?? [],
});
```

(`provider`, `model`, `orgId`, `workflowId`, `userId` are already locals in this handler.)

- [ ] **Step 2: `agent-run-step-handler.ts` — record + feed the agent counter**

This handler already has `this.deps.pool`, `userId`, `orgId`, `workflowId`, `input.agentId`, `input.displayName`, `input.provider`, `input.model`. Add the same recording block after `const result = await coding.runCustomPrompt({...})`, using `stepType = this.stepType` and `stepName = (input.displayName as string) ?? null`. Then, **only when rows were actually inserted and this is an agent run**, feed the existing rollup:

```ts
import { recordTokenUsage } from "../../usage/record-token-usage.ts";
import { addUsage } from "@journeyman/agents";

// ...build the same args object as Step 1 (agentId from input.agentId), then:
const insertedRows = await recordTokenUsage(this.deps.pool, args);
const agentId = typeof input.agentId === "string" ? input.agentId : null;
if (insertedRows > 0 && agentId && orgId) {
  const totalTokens = (result.usage ?? []).reduce((s, u) => s + (u.totalTokens ?? 0), 0);
  await addUsage(this.deps.pool, orgId, agentId, totalTokens, 0).catch(() => undefined);
}
```

Confirm `addUsage` is exported from `@journeyman/agents` (`packages/agents/src/index.ts`); if not, add `export { addUsage } from "./safety.ts";`.

- [ ] **Step 3: `start-feature-branch-step-handler.ts` — add pool + record**

Add `pool` to the constructor deps and import the writer + `Pool`:

```ts
import type { Pool } from "pg";
import { recordTokenUsage } from "../../usage/record-token-usage.ts";

constructor(private deps: { coding: ProviderFactory<ICodingCLI>; pool?: Pool }) {}
```

After `const result = await coding.checkoutRepo({...})`, record usage (usage is on `result.usage`):

```ts
const outcome: "success" | "error" | "aborted" =
  ctx.signal.aborted ? "aborted" : (result as any).error ? "error" : "success";
await recordTokenUsage(this.deps.pool, {
  workspaceId: (typeof input.workspaceId === "string" ? input.workspaceId : null),
  orgId: (typeof input.startedByOrgId === "string" ? input.startedByOrgId : null),
  workflowId: (typeof input.workflowId === "string" ? input.workflowId : null),
  workflowVersionId: null, workflowName: null,
  workflowInstanceId: ctx.workflowInstanceId, nodeId: ctx.nodeId, stepType: this.stepType,
  stepName: null, attempt: ctx.attempt,
  agentId: (typeof input.agentId === "string" ? input.agentId : null),
  agentName: (typeof input.displayName === "string" ? input.displayName : null),
  triggeredByUserId: (typeof input.startedByUserId === "string" ? input.startedByUserId : null),
  outcome, provider: (typeof input.provider === "string" ? input.provider : "claude"),
  requestedModel: (typeof input.model === "string" ? input.model : null),
  usage: (result as any).usage ?? [],
});
```

(Workflow version/name omitted here — these steps are lower-volume and a lookup adds little; both columns are nullable.)

- [ ] **Step 4: `list-workspace-files-step-handler.ts` — add pool + record**

Mirror Step 3: add `pool?: Pool` to the constructor, import the writer, and after `const result = await coding.scanRepos({...})` record usage with `stepType: this.stepType` and `usage: (result as any).usage ?? []`.

- [ ] **Step 5: Pass `pool` at registration**

In `packages/orchestrator/src/cli-worker.ts`, update the two registrations (currently `{ coding }`):

```ts
registry.register(new StartFeatureBranchStepHandler({ coding, pool }));
registry.register(new ListWorkspaceFilesStepHandler({ coding, pool }));
```

(`pool` is already in scope at this point in the file.)

- [ ] **Step 6: Scoped typecheck**

Run: `npm run typecheck -w @journeyman/orchestrator`
Expected: PASS.

---

## Task 10: Read API — workspace-scoped aggregation

**Files:**
- Create: `packages/orchestrator/src/usage/usage-queries.ts`
- Test: `packages/orchestrator/src/usage/usage-queries.test.ts`
- Create: `packages/api-server/src/routes/usage.ts`
- Modify: `packages/orchestrator/src/index.ts` (export query helpers)
- Modify: `packages/api-server/src/server.ts`

- [ ] **Step 1: Write the failing test for the query builder**

```ts
import { describe, it, expect } from "vitest";
import { buildUsageAggregateQuery, DIMENSION_COLUMNS } from "./usage-queries.ts";

describe("buildUsageAggregateQuery", () => {
  it("groups by a whitelisted dimension and always scopes by workspace", () => {
    const { sql, params } = buildUsageAggregateQuery("model", { wsId: "ws1" });
    expect(sql).toContain("FROM jm_token_usage");
    expect(sql).toContain("workspace_id = $1");
    expect(sql).toContain("GROUP BY provider, model");
    expect(params).toEqual(["ws1"]);
  });

  it("maps the 'day' dimension to a date_trunc bucket", () => {
    const { sql } = buildUsageAggregateQuery("day", { wsId: "ws1" });
    expect(sql).toContain("date_trunc('day', created_at)");
  });

  it("appends filters as parameters", () => {
    const { sql, params } = buildUsageAggregateQuery("agent", { wsId: "ws1", provider: "claude", from: "2026-06-01" });
    expect(params).toEqual(["ws1", "claude", "2026-06-01"]);
    expect(sql).toContain("provider = $2");
    expect(sql).toContain("created_at >= $3");
  });

  it("rejects an unknown dimension", () => {
    expect(() => buildUsageAggregateQuery("drop_table" as any, { wsId: "ws1" })).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @journeyman/orchestrator -- usage/usage-queries`
Expected: FAIL — cannot find module `./usage-queries.ts`.

- [ ] **Step 3: Implement the query builder**

```ts
export type UsageDimension =
  | "model" | "provider" | "vendor" | "agent" | "workflow" | "workflow_version" | "step" | "day";

export interface UsageFilters {
  wsId: string;
  from?: string;
  to?: string;
  provider?: string;
  vendor?: string;
  model?: string;
  agentId?: string;
  workflowId?: string;
  instanceId?: string;
  outcome?: string;
}

/** GROUP BY expression per dimension. Whitelisted — never interpolate caller input. */
export const DIMENSION_COLUMNS: Record<UsageDimension, string> = {
  model: "provider, model",
  provider: "provider",
  vendor: "vendor",
  agent: "agent_id, agent_name",
  workflow: "workflow_id, workflow_name",
  workflow_version: "workflow_version_id",
  step: "step_type",
  day: "date_trunc('day', created_at)",
};

const SUMS = `
  COUNT(*)::bigint AS rows,
  COALESCE(SUM(input_tokens),0)::bigint AS input_tokens,
  COALESCE(SUM(output_tokens),0)::bigint AS output_tokens,
  COALESCE(SUM(cache_read_tokens),0)::bigint AS cache_read_tokens,
  COALESCE(SUM(cache_creation_tokens),0)::bigint AS cache_creation_tokens,
  COALESCE(SUM(reasoning_tokens),0)::bigint AS reasoning_tokens,
  COALESCE(SUM(total_tokens),0)::bigint AS total_tokens,
  SUM(cost_usd) AS cost_usd`;

/** Build the shared WHERE clause + params. Workspace scope is always $1. */
function buildWhere(filters: UsageFilters): { where: string; params: unknown[] } {
  const params: unknown[] = [filters.wsId];
  const clauses: string[] = ["workspace_id = $1"];
  const add = (col: string, val: unknown, op = "=") => {
    if (val === undefined || val === null || val === "") return;
    params.push(val);
    clauses.push(`${col} ${op} $${params.length}`);
  };
  add("provider", filters.provider);
  add("vendor", filters.vendor);
  add("model", filters.model);
  add("agent_id", filters.agentId);
  add("workflow_id", filters.workflowId);
  add("workflow_instance_id", filters.instanceId);
  add("outcome", filters.outcome);
  add("created_at", filters.from, ">=");
  add("created_at", filters.to, "<=");
  return { where: clauses.join(" AND "), params };
}

/** Grouped totals for GET /usage/by/:dimension. */
export function buildUsageAggregateQuery(
  dimension: UsageDimension,
  filters: UsageFilters,
): { sql: string; params: unknown[] } {
  const group = DIMENSION_COLUMNS[dimension];
  if (!group) throw new Error(`unknown usage dimension: ${dimension}`);
  const { where, params } = buildWhere(filters);
  const sql =
    `SELECT ${group} AS group_key, ${SUMS} FROM jm_token_usage` +
    ` WHERE ${where} GROUP BY ${group} ORDER BY total_tokens DESC`;
  return { sql, params };
}

/** Totals across the filtered set (no GROUP BY) — for GET /usage. */
export function buildUsageTotalsQuery(filters: UsageFilters): { sql: string; params: unknown[] } {
  const { where, params } = buildWhere(filters);
  return { sql: `SELECT ${SUMS} FROM jm_token_usage WHERE ${where}`, params };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @journeyman/orchestrator -- usage/usage-queries`
Expected: PASS.

- [ ] **Step 5: Export the helpers**

In `packages/orchestrator/src/index.ts`:

```ts
export { buildUsageAggregateQuery, buildUsageTotalsQuery, DIMENSION_COLUMNS } from "./usage/usage-queries.ts";
export type { UsageDimension, UsageFilters } from "./usage/usage-queries.ts";
```

- [ ] **Step 6: Implement the routes**

Create `packages/api-server/src/routes/usage.ts`:

```ts
import type { FastifyInstance } from "fastify";
import type { Composition } from "../composition.ts";
import { makeRequireAuth, makeRequireWorkspacePermission } from "@journeyman/identity";
import {
  buildUsageAggregateQuery, buildUsageTotalsQuery, DIMENSION_COLUMNS,
  type UsageDimension, type UsageFilters,
} from "@journeyman/orchestrator";

export function registerUsageRoutes(app: FastifyInstance, c: Composition): void {
  const requireAuth = makeRequireAuth({ pool: c.pool! });
  const requirePerm = makeRequireWorkspacePermission({ pool: c.pool! });
  const read = { preHandler: [requireAuth(), requirePerm("resource.read")] };

  const filtersFrom = (wsId: string, q: Record<string, string | undefined>): UsageFilters => ({
    wsId, from: q.from, to: q.to, provider: q.provider, vendor: q.vendor, model: q.model,
    agentId: q.agentId, workflowId: q.workflowId, instanceId: q.instanceId, outcome: q.outcome,
  });

  app.get("/workspaces/:wsId/usage", read, async (req) => {
    const { wsId } = req.params as { wsId: string };
    const { sql, params } = buildUsageTotalsQuery(filtersFrom(wsId, req.query as any));
    const { rows } = await c.pool!.query(sql, params);
    return rows[0];
  });

  app.get("/workspaces/:wsId/usage/by/:dimension", read, async (req, reply) => {
    const { wsId, dimension } = req.params as { wsId: string; dimension: string };
    if (!(dimension in DIMENSION_COLUMNS)) return reply.code(400).send({ error: `unknown dimension '${dimension}'` });
    const { sql, params } = buildUsageAggregateQuery(dimension as UsageDimension, filtersFrom(wsId, req.query as any));
    const { rows } = await c.pool!.query(sql, params);
    return { dimension, groups: rows };
  });
}
```

- [ ] **Step 7: Register the routes**

In `packages/api-server/src/server.ts`, import and register inside the same `{ prefix: "/api" }` group as `registerWorkflowInstanceRoutes`:

```ts
import { registerUsageRoutes } from "./routes/usage.ts";
// ...inside the prefixed register block, alongside registerWorkflowInstanceRoutes(s, c):
registerUsageRoutes(s, c);
```

- [ ] **Step 8: Scoped typecheck**

Run: `npm run typecheck -w @journeyman/orchestrator && npm run typecheck -w @journeyman/api-server`
Expected: PASS.

---

## Task 11: Final verification (typecheck + boundaries + tests)

No commit. Leave all changes in the working tree on `master`.

- [ ] **Step 1: Full type-check + import boundaries**

Run: `npm run check`
Expected: PASS (this runs `npm run typecheck` across the workspace and `npm run check:boundaries`). If `npm run check` is not a combined script, run both:
Run: `npm run typecheck`
Run: `npm run check:boundaries`
Expected: both PASS.

- [ ] **Step 2: Run the new + affected unit tests**

Run: `npm test -w @journeyman/agent-runtime`
Run: `npm test -w @journeyman/orchestrator`
Run: `npm test -w @journeyman/core`
Expected: PASS (no regressions; new usage tests green).

- [ ] **Step 3: Confirm the working tree holds all changes (no commit)**

Run: `git status`
Expected: modified/created files listed, nothing committed.

---

## Notes for the implementer

- **Import style:** this repo imports with explicit `.ts` extensions and `import type` for types. Match the surrounding files.
- **`createLogger`** comes from `@journeyman/core`. Never `console.log`.
- **Never let usage recording fail a step** — `recordTokenUsage` already swallows errors; do not wrap step logic in its try/catch.
- **`raw_usage`** is stringified JSON via `JSON.stringify(u.raw)`; `pg` stores it into the `jsonb` column.
- **aisdk usage field names** are AI SDK 6 (`inputTokens`/`outputTokens`/`totalTokens`, optional `reasoningTokens`/`cachedInputTokens`). If a field is absent it maps to `undefined` → `NULL`.
- **Idempotency:** the unique index makes redelivered tasks no-ops; the agent counter (`addUsage`) is gated on `insertedRows > 0` so it never double-counts.
