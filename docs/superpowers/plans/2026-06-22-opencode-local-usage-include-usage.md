# OpenCode Local-Model Token Usage (include_usage) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the opencode provider request `stream_options.include_usage` for custom OpenAI-compatible endpoints, so locally-hosted models (e.g. Qwen via LM Studio) report real token counts instead of zeros.

**Architecture:** Add an optional `includeUsage` field to `CodingModelConfig` in `@journeyman/core`. In the opencode `buildProviderBlock`, default it on for the `@ai-sdk/openai-compatible` npm and pass it into the provider-block `options`, which opencode forwards to `createOpenAICompatible`. No other provider or model path changes.

**Tech Stack:** TypeScript, vitest, `@ai-sdk/openai-compatible`, opencode SDK.

**Execution constraints (per request):** Work on `master` directly. **No commits.** Run typecheck **once at the end**, not per task. TDD per task (write test → see it fail → implement → see it pass).

**Spec:** [docs/superpowers/specs/2026-06-22-opencode-local-usage-include-usage-design.md](../specs/2026-06-22-opencode-local-usage-include-usage-design.md)

---

## File Structure

- **Modify** `packages/core/src/types/coding-models.types.ts` — add `includeUsage?: boolean` to `CodingModelConfig`.
- **Modify** `packages/agent-runtime/src/providers/opencode/server-config.ts` — resolve & emit `includeUsage` in `buildProviderBlock`'s `options`.
- **Modify** `packages/agent-runtime/src/providers/opencode/server-config.test.ts` — add new assertions; update two existing assertions that pin the exact `options` object.

Test command (run from repo root):
```bash
npx vitest run packages/agent-runtime/src/providers/opencode/server-config.test.ts
```

---

## Task 1: Add `includeUsage` to `CodingModelConfig`

This is a pure type addition. No runtime behavior yet; it unblocks Task 2.

**Files:**
- Modify: `packages/core/src/types/coding-models.types.ts:6-18`

- [ ] **Step 1: Add the field to the interface**

In `packages/core/src/types/coding-models.types.ts`, add `includeUsage` between `requiresApiKey` and the deprecated `apiKeySlot`:

```ts
export interface CodingModelConfig {
  /** Custom endpoint base URL, e.g. http://host.docker.internal:1234/v1. */
  baseUrl?: string;
  /** AI-SDK npm package for the provider; defaults to "@ai-sdk/openai-compatible". */
  npm?: string;
  /** Whether this model needs an API key bound (replaces the old typed apiKeySlot). */
  requiresApiKey?: boolean;
  /**
   * Whether to request token usage on streamed responses via
   * `stream_options.include_usage`. OpenCode streams, and OpenAI-compatible
   * servers (e.g. LM Studio, vLLM) only attach usage to streamed responses when
   * this is set. Defaults to true for the "@ai-sdk/openai-compatible" npm; set
   * false for a strict endpoint that rejects stream_options. Ignored by non-
   * openai-compatible providers unless explicitly set. OpenCode-only (the aisdk
   * provider uses non-streaming generateText and already returns usage).
   */
  includeUsage?: boolean;
  /**
   * @deprecated Legacy typed env-var label. No longer read; the label is derived
   * by codingModelKeySlot(). Kept only so old JSONB rows still parse.
   */
  apiKeySlot?: string;
}
```

- [ ] **Step 2: Type-check this package compiles**

Run: `npx tsc --noEmit -p packages/core`
Expected: PASS (no errors). A pure optional-field addition does not break existing usages.

---

## Task 2: Emit `includeUsage` from `buildProviderBlock`

**Files:**
- Modify: `packages/agent-runtime/src/providers/opencode/server-config.ts:51-75`
- Test: `packages/agent-runtime/src/providers/opencode/server-config.test.ts`

- [ ] **Step 1: Update the two existing tests that pin the exact `options` object**

The default openai-compatible path will now include `includeUsage: true`, so two existing assertions must be updated to match (otherwise they would fail for the right reason — the new field).

In `packages/agent-runtime/src/providers/opencode/server-config.test.ts`, update the test `"emits a provider block keyed by the model's providerID with baseURL + npm default"` (currently lines 21-33) so the `options` includes the flag:

```ts
  it("emits a provider block keyed by the model's providerID with baseURL + npm default", () => {
    const c = buildServerConfig(cfg, {
      model: "lmstudio/llama-3.1",
      modelConfig: { baseUrl: "http://host.docker.internal:1234/v1" },
    });
    expect(c.provider).toEqual({
      lmstudio: {
        npm: "@ai-sdk/openai-compatible",
        options: { baseURL: "http://host.docker.internal:1234/v1", includeUsage: true },
        models: { "llama-3.1": {} },
      },
    });
  });
```

And update the test `"injects apiKey from env under the derived label"` (currently lines 42-49) so its `options` expectation includes the flag:

```ts
  it("injects apiKey from env under the derived label", () => {
    const c = buildServerConfig(cfg, {
      model: "myvllm/mistral",
      modelConfig: { baseUrl: "http://gw/v1", npm: "@ai-sdk/openai-compatible", requiresApiKey: true },
      env: { MYVLLM_API_KEY: "secret-123" },
    });
    expect((c.provider as any).myvllm.options).toEqual({ baseURL: "http://gw/v1", apiKey: "secret-123", includeUsage: true });
  });
```

- [ ] **Step 2: Add new tests for the include_usage behavior**

Append these tests inside the `describe("buildServerConfig", ...)` block in the same file (e.g. after the `"injects apiKey from env under the derived label"` test):

```ts
  it("defaults includeUsage on for an openai-compatible custom endpoint", () => {
    const c = buildServerConfig(cfg, {
      model: "lmstudio/qwen",
      modelConfig: { baseUrl: "http://host:1234/v1" }, // npm defaults to openai-compatible
    });
    expect((c.provider as any).lmstudio.options.includeUsage).toBe(true);
  });

  it("respects an explicit includeUsage:false override", () => {
    const c = buildServerConfig(cfg, {
      model: "lmstudio/qwen",
      modelConfig: { baseUrl: "http://host:1234/v1", includeUsage: false },
    });
    expect((c.provider as any).lmstudio.options.includeUsage).toBe(false);
  });

  it("does not inject includeUsage for a non-openai-compatible npm unless set", () => {
    const c = buildServerConfig(cfg, {
      model: "custom/claude",
      modelConfig: { baseUrl: "http://gw/v1", npm: "@ai-sdk/anthropic" },
    });
    expect("includeUsage" in (c.provider as any).custom.options).toBe(false);
  });

  it("injects includeUsage for a non-openai-compatible npm when explicitly set", () => {
    const c = buildServerConfig(cfg, {
      model: "custom/claude",
      modelConfig: { baseUrl: "http://gw/v1", npm: "@ai-sdk/anthropic", includeUsage: true },
    });
    expect((c.provider as any).custom.options.includeUsage).toBe(true);
  });
```

- [ ] **Step 3: Run the tests to verify the new ones fail**

Run: `npx vitest run packages/agent-runtime/src/providers/opencode/server-config.test.ts`
Expected: FAIL — the four new tests fail (`includeUsage` is `undefined`, not `true`/`false`/absent-as-expected) and the two updated tests fail because the current code does not emit `includeUsage`. This confirms the tests exercise the new behavior before it exists.

- [ ] **Step 4: Implement `includeUsage` resolution in `buildProviderBlock`**

In `packages/agent-runtime/src/providers/opencode/server-config.ts`, replace the body of `buildProviderBlock` (currently lines 51-75) with the version below. The change: derive `npm` once, compute `includeUsage` (default true only for the openai-compatible npm, explicit value always wins), and add it to `options` when defined.

```ts
/** Build OpenCode's `provider` entry for a custom endpoint, or undefined if none. */
function buildProviderBlock(
  model: string | undefined,
  modelConfig: CodingModelConfig | undefined,
  env: Record<string, string> | undefined,
): Record<string, unknown> | undefined {
  if (!modelConfig?.baseUrl) return undefined; // a custom endpoint is defined by its URL
  const parsed = model ? parseOpenCodeModel(model) : undefined;
  if (!parsed) return undefined;

  const npm = modelConfig.npm ?? "@ai-sdk/openai-compatible";
  const slot = codingModelKeySlot({ provider: "opencode", config: modelConfig, modelId: model });
  const apiKey = modelConfig.requiresApiKey ? env?.[slot] : undefined;
  // OpenCode streams; OpenAI-compatible servers only return usage on a stream when
  // stream_options.include_usage is set. Default it on for that npm so local models
  // report tokens; an explicit value always wins. Other providers handle usage
  // themselves, so only forward the flag for them when explicitly set.
  const includeUsage = modelConfig.includeUsage ?? (npm === "@ai-sdk/openai-compatible" ? true : undefined);
  const options: Record<string, unknown> = {
    ...(modelConfig.baseUrl ? { baseURL: modelConfig.baseUrl } : {}),
    ...(apiKey ? { apiKey } : {}),
    ...(includeUsage !== undefined ? { includeUsage } : {}),
  };
  return {
    [parsed.providerID]: {
      npm,
      options,
      // A custom provider must declare its models or OpenCode can't resolve the
      // model and throws a generic "UnknownError". Declare the one we target.
      models: { [parsed.modelID]: {} },
    },
  };
}
```

Note: this reuses the `npm` variable for the returned block's `npm` key (previously inlined as `modelConfig.npm ?? "@ai-sdk/openai-compatible"` on line 68) — behavior is identical.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run packages/agent-runtime/src/providers/opencode/server-config.test.ts`
Expected: PASS — all tests in the file pass, including the two updated and four new ones.

---

## Task 3: Final type-check (whole repo)

**Files:** none — verification only.

- [ ] **Step 1: Run the repo type-check**

Run: `npm run typecheck`
Expected: PASS for all workspaces. The only API change is an additive optional field on `CodingModelConfig`, so no existing consumer breaks.

- [ ] **Step 2: (Optional, recommended) run import-boundary + theme checks**

Run: `npm run check:boundaries`
Expected: PASS — no new cross-package imports were introduced (the change uses already-imported `CodingModelConfig` and `codingModelKeySlot`).

---

## Manual / live verification (not automated)

After the automated steps pass, confirm the end-to-end path opencode → LM Studio actually
populates usage (this is the only step that proves opencode forwards the option):

1. Configure (or reuse) a coding model pointing at the LM Studio endpoint
   (`config.baseUrl = http://<host>:1234/v1`, default npm) and run an opencode `custom-ai` step.
2. Inspect the resulting `jm_token_usage` row for that run: `input_tokens` / `output_tokens`
   should be non-zero and match what LM Studio reports for the call.
3. If they are still zero, capture the opencode session event log (`logSessionEvent`) /
   `raw_usage` to confirm whether `info.tokens` arrived populated — that isolates whether the
   remaining gap is opencode forwarding or our mapper.

Dollar `cost_usd` will remain ~$0 for a local model unless a `jm_model_pricing` row exists for
it — that is expected and out of scope (existing path, no code).

---

## Self-Review

- **Spec coverage:** Type field (Task 1) ✓; `buildProviderBlock` default-on + override + npm gating (Task 2) ✓; tests for default/override/gating (Task 2) ✓; behavior matrix cases covered by the four new tests + the "no provider block without baseUrl" existing tests ✓; aisdk untouched (no aisdk task) ✓; final typecheck (Task 3) ✓; live verification documented ✓.
- **Placeholder scan:** none — every code step shows full code.
- **Type consistency:** `includeUsage?: boolean` used identically in Task 1 (definition), Task 2 (`modelConfig.includeUsage`), and tests. `npm` variable name reused consistently within `buildProviderBlock`.
- **Constraint compliance:** no commit steps; single repo-wide typecheck at the end (Task 3); all work on master.
