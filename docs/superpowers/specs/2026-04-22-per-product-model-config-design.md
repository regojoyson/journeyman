# Per-Product Model Configuration Design

**Date:** 2026-04-22  
**Status:** Approved

## Problem

All coding-CLI providers currently pass no `model` to `query()`, relying on SDK defaults. There is no way for a product or flow to specify which model each phase should use, or to configure different models for different products.

## Goal

Allow any coding-CLI provider (Claude, OpenCode, Gemini, Codex) to be instantiated with a per-phase model config. Different products/flows create their own provider instance with their own config.

## Design

### 1. Core Types (`@journeyman/core`)

New types added to `packages/core/src/types/coding-cli.types.ts`:

```typescript
export type CodingCLIPhase =
  | "scanRepos"
  | "checkoutRepo"
  | "commitPushRepos"
  | "cleanupRepos"
  | "createWorkspace"
  | "analyze"
  | "plan"
  | "implement";

export interface CodingCLIProviderConfig {
  defaultModel?: string;                          // fallback for any unspecified phase
  models?: Partial<Record<CodingCLIPhase, string>>; // per-phase overrides
}
```

`CodingCLIPhase` is the exhaustive union of all `ICodingCLI` method names.

### 2. Provider Constructor

Each provider accepts `CodingCLIProviderConfig` as an optional constructor argument:

```typescript
class ClaudeProvider implements ICodingCLI {
  constructor(private config: CodingCLIProviderConfig = {}) {}

  private resolveModel(phase: CodingCLIPhase): string | undefined {
    return this.config.models?.[phase] ?? this.config.defaultModel;
  }
}
```

Resolution order: **phase override → defaultModel → undefined (SDK default)**.

If `model` resolves to `undefined`, `query()` uses its own default — no breaking change.

### 3. Operation Opts (`@journeyman/core`)

All 8 operation option types gain an optional `model?` field:

```typescript
export interface AnalyzeOptions extends SessionOptions {
  // ... existing fields unchanged ...
  model?: string;
}
// Same for: ScanReposOptions, CheckoutRepoOptions, CommitPushReposOptions,
//           CleanupReposOptions, CreateWorkspaceOptions, PlanOptions, ImplementOptions
```

### 4. Provider → Operation Wiring

The provider passes `model` into each operation via spread:

```typescript
analyze(opts: AnalyzeOptions): Promise<AnalyzeResult> {
  return analyze({ ...opts, model: this.resolveModel("analyze") });
}
// Same pattern for all 8 operations
```

### 5. Operation → SDK Wiring

Each operation forwards `model` to `query()` options:

```typescript
const response = query({
  prompt: buildPrompt(opts),
  options: {
    ...(opts.model ? { model: opts.model } : {}),
    // ... rest of options unchanged
  },
});
```

### 6. Other Providers

`GeminiProvider`, `CodexProvider`, `OpenCodeProvider` follow the same pattern — constructor accepts `CodingCLIProviderConfig`, each implements `resolveModel` and wires it into their own SDK calls.

## Usage

```typescript
// Product A — quality-optimized
const providerA = new ClaudeProvider({
  defaultModel: "claude-sonnet-4-6",
  models: {
    analyze:   "claude-opus-4-7",
    implement: "claude-haiku-4-5",
  },
});

// Product B — speed-optimized
const providerB = new ClaudeProvider({
  defaultModel: "claude-haiku-4-5",
});

// OpenCode product
const providerC = new OpenCodeProvider({
  defaultModel: "o3",
  models: { implement: "o4-mini" },
});
```

## Files Changed

| File | Change |
|------|--------|
| `packages/core/src/types/coding-cli.types.ts` | Add `CodingCLIPhase`, `CodingCLIProviderConfig`; add `model?` to all 8 opts types |
| `packages/core/src/index.ts` | Export new types |
| `packages/coding-cli/src/providers/claude/index.ts` | Add constructor, `resolveModel`, wire into all 8 method calls |
| `packages/coding-cli/src/providers/claude/operations/*.ts` | Add `model` forwarding to `query()` (8 files) |
| `packages/coding-cli/src/providers/gemini/index.ts` | Add constructor + `resolveModel` stub |
| `packages/coding-cli/src/providers/codex/index.ts` | Add constructor + `resolveModel` stub |
| `packages/coding-cli/src/providers/opencode/index.ts` | Add constructor + `resolveModel`, wire into operations |

## Notes

- Git operations (`scanRepos`, `checkoutRepo`, `commitPushRepos`, `cleanupRepos`, `createWorkspace`) do not call `query()` — they run bash directly. Their `model` field is accepted in opts but unused. `CodingCLIPhase` includes them for completeness so the config shape mirrors the full `ICodingCLI` surface.

## Non-Goals

- No per-call `opts.model` override from the caller (callers don't set model; the provider owns that)
- No model validation — invalid model strings are passed through to the SDK as-is
- No `ICodingCLI` interface change — config is a constructor concern, not an interface concern
