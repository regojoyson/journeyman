# Capture streamed token usage from custom OpenAI-compatible endpoints

**Date:** 2026-06-22
**Status:** Approved (design)
**Area:** `agent-runtime` (opencode provider), `core` types

## Problem

When running the **opencode** provider against a locally-hosted / custom OpenAI-compatible
model (e.g. Qwen via LM Studio), the usage row records the model name but **zero tokens**,
so the computed cost is always `$0`.

### Root cause (confirmed)

The opencode provider **streams** its requests. An OpenAI-compatible server only attaches a
`usage` block to a *streamed* response when the client sends
`stream_options: { include_usage: true }`. opencode's provider block for a custom endpoint
does not set that flag, so the streamed response carries no usage, and the counts are
coerced to `0`. The model *name* survives because it comes from a different field
(`info.modelID`), not from `info.tokens`.

This was verified directly against an LM Studio host (`qwen/qwen3.6-35b-a3b`):

| Probe | Result |
|---|---|
| Non-streaming (`stream:false`) | `usage` present: `prompt_tokens`, `completion_tokens`, `total_tokens`, `reasoning_tokens` |
| Streaming, **no** `include_usage` | Final chunk has **no** `usage` field → zeros |
| Streaming, **with** `stream_options.include_usage:true` | Final chunk carries `usage` with real counts |

### Why "cost" reads zero

Cost is computed, never reported by the model: `cost_usd = tokens × per-million price`
([`record-token-usage.ts`](../../../packages/orchestrator/src/usage/record-token-usage.ts),
[`model-pricing.ts`](../../../packages/orchestrator/src/usage/model-pricing.ts)). With tokens
at zero, cost is zero regardless of pricing. So the real fix is recovering true **token
counts**; dollar cost for a local model is legitimately ~$0 unless a notional price is added
to `jm_model_pricing` (already supported, no code needed).

## Goal

Real token counts — and therefore non-zero usage rows — for opencode runs against custom
OpenAI-compatible endpoints, without affecting any other provider or model type.

## Design

### Change set (three files)

1. **`packages/core/src/types/coding-models.types.ts`** — add one optional field:

   ```ts
   export interface CodingModelConfig {
     baseUrl?: string;
     npm?: string;
     requiresApiKey?: boolean;
     includeUsage?: boolean;   // request stream_options.include_usage; defaults on for openai-compatible
     apiKeySlot?: string;      // @deprecated
   }
   ```

2. **`packages/agent-runtime/src/providers/opencode/server-config.ts`** — in
   `buildProviderBlock`, resolve the flag and add it to the provider `options`:

   ```ts
   const npm = modelConfig.npm ?? "@ai-sdk/openai-compatible";
   const includeUsage = modelConfig.includeUsage ?? (npm === "@ai-sdk/openai-compatible" ? true : undefined);
   const options: Record<string, unknown> = {
     ...(modelConfig.baseUrl ? { baseURL: modelConfig.baseUrl } : {}),
     ...(apiKey ? { apiKey } : {}),
     ...(includeUsage !== undefined ? { includeUsage } : {}),
   };
   ```

   `includeUsage` is a documented provider setting of `@ai-sdk/openai-compatible`
   ("Include usage information in streaming responses"), so it threads through opencode's
   provider-block `options` into `createOpenAICompatible`.

3. **`packages/agent-runtime/src/providers/opencode/server-config.test.ts`** — add
   assertions:
   - `includeUsage: true` is emitted by default for an openai-compatible custom endpoint.
   - It is omitted (or `false`) when `modelConfig.includeUsage: false`.
   - It is **not** injected for a non-openai-compatible `npm` unless explicitly set.

### Behavior matrix

| Setup | Result |
|---|---|
| Built-in Anthropic / OpenAI (no `baseUrl`) | No provider block emitted at all — unaffected |
| Custom endpoint, `@ai-sdk/openai-compatible` (LM Studio, vLLM, Together…) | `includeUsage: true` by default — the fix |
| Custom endpoint, `@ai-sdk/anthropic` | `includeUsage` not injected (Anthropic has native streamed usage) |
| Custom endpoint, `@ai-sdk/openai` | `includeUsage` not injected (official OpenAI provider already sends it) |
| Any of the above with explicit `includeUsage` | Explicit value wins |

The new default touches only **custom `openai-compatible` endpoints** — the family that
needs the flag and universally supports it.

## Decisions / clarifications recorded

- **No double counting.** `includeUsage` does not add a second request. There is exactly one
  streamed `session.prompt` per prompt; the flag only makes its **final** chunk carry usage.
  Usage is read once from `res.data.info.tokens`, mapped to one `TokenUsage` by
  `openCodeInfoToTokenUsage()`, and written once by `recordTokenUsage()`. Today that field is
  simply empty — we are filling the single existing source, not adding a new one. opencode and
  aisdk are mutually exclusive per run, so there is no cross-provider duplication either.

- **No effect on other model types.** The change lives inside `buildProviderBlock`, which only
  runs when `modelConfig.baseUrl` is set. Built-in cloud providers emit no provider block and
  are untouched; the default is further gated to the `@ai-sdk/openai-compatible` npm.

- **aisdk provider unchanged.** It uses non-streaming `generateText`
  ([`run-custom-prompt.ts`](../../../packages/agent-runtime/src/providers/aisdk/operations/run-custom-prompt.ts)),
  which already returns usage in the response body. The new `includeUsage` field is
  opencode-streaming-only.

- **Scope choice:** default-on, overridable (vs. hardcoded or opt-in-only) — chosen so local
  models work out of the box while a rare strict endpoint that rejects `stream_options` can
  disable it.

## Out of scope

- Dollar-cost computation for local models (free; add a `jm_model_pricing` row for a notional
  cost — existing path, no code).
- aisdk provider changes.
- UI exposure of the `includeUsage` field.

## Verification

1. Unit tests in `server-config.test.ts` pass (default-on, override, npm gating).
2. `npm run check` (typecheck + import boundaries) passes.
3. Live check: run an opencode prompt against the LM Studio Qwen endpoint and confirm the
   `jm_token_usage` row shows non-zero `input_tokens` / `output_tokens` matching what LM
   Studio reports. This is the definitive confirmation that opencode forwards the
   `includeUsage` option through to `createOpenAICompatible`.

## Risk

Low. The only assumption is that opencode forwards arbitrary provider-block `options` keys
into the SDK provider factory; `includeUsage` is a real SDK setting and the live check above
confirms the end-to-end path. If opencode were to strip unknown keys, the fallback is
opencode's documented `options` passthrough — but no evidence suggests that.
