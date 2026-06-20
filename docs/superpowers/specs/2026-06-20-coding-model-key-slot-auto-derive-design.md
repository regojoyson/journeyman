# Auto-derive the coding-model API-key env var name

**Date:** 2026-06-20
**Status:** Design — approved direction, pending spec review

## In plain words

Today, when you set up a coding model that needs an API key, there's a text box
called **"Env var name"** where you type something like `MINIMAX_API_KEY`. That
box is the source of a real bug: a user typed `MININMAX_API_KEY` (extra "N"), so
at run time the key was placed under the wrong label, the AI tool never found it,
and MiniMax returned `401 login fail`.

The key insight: **that name never needs to be typed by a human.** The system
already knows the provider and the model, so it can always work out the correct
label itself. Binding the secret to the coding model is what actually carries the
credential into the run — the name is just an internal label used to hand the
value over.

This change removes the typed field for every provider and derives the label
automatically, so a typo of this kind becomes impossible by construction.

## Background: what `apiKeySlot` actually is

`CodingModelConfig.apiKeySlot` is an **internal env-var handoff key**, not
something the AI vendor requires the user to choose. The data flow:

1. The coding model binds an org secret directly (`api_key_secret_id`).
2. At run time the worker fetches that secret and writes it into the run's env
   under `env[apiKeySlot]`.
3. The env crosses into the sandbox via the runner's stdin payload.
4. The runner reads the value back out of `env[apiKeySlot]` and hands it to the
   coding provider.

### Does the label matter? It depends on the path

| Provider / mode | How the key reaches the SDK | Name matters? |
|---|---|---|
| `aisdk` (any model) | passed **explicitly** as `apiKey` to the SDK factory | No — any label works |
| `opencode`, custom endpoint (`baseUrl` set) | passed **explicitly** in the provider block `options.apiKey` | No |
| `opencode`, cloud model (no `baseUrl`) | OpenCode's built-in catalog reads `process.env[STD_NAME]` | **Yes** — must be the standard name |
| `claude` | Claude Agent SDK reads `ANTHROPIC_API_KEY` from env | **Yes** — already hard-set, field hidden |

So the label only ever matters on cloud fallback paths, and in those cases the
**correct** label is fully determined by the provider/model. There is no case
where a human needs to choose it. (`suggestedKeySlotName()` already maps
`openai → OPENAI_API_KEY`, `google → GEMINI_API_KEY`, etc.)

## Current usage map (what this touches)

- `packages/core/src/types/coding-models.types.ts` — `CodingModelConfig.apiKeySlot`.
- `packages/core/src/registries/opencode-slots.ts` — `openCodeModelSlots()` /
  `codingModelSlots()` derive a slot from `apiKeySlot`; `suggestedKeySlotName()`
  derives the standard name from a model id.
- `packages/coding-models/src/validate-config.ts` — validates `apiKeySlot`.
- `packages/coding-models/src/routes/org.ts` — `needsKey = Boolean(apiKeySlot)`
  drives the "must bind a secret" rule (`validateBinding`).
- `packages/web/src/routes/AdminCodingModelsPage.tsx` — the "Requires an API key"
  toggle and the "Env var name" text field; `requiresKey = Boolean(apiKeySlot)`.
- `packages/orchestrator/src/cli-worker.ts` — `modelKeyResolver` returns
  `{ slot: config.apiKeySlot, value }`.
- `packages/orchestrator/src/workers/worker-harness.ts` — `env[mk.slot] = mk.value`.
- `packages/orchestrator/src/workers/steps/agent-run-step-handler.ts` — a second
  injection: `env[config.apiKeySlot] = value`.
- `packages/agent-runtime/src/providers/aisdk/model.ts` — `apiKey = env[apiKeySlot]`.
- `packages/agent-runtime/src/providers/opencode/server-config.ts` —
  `apiKey = env[apiKeySlot]`.

## Design

### 1. One shared deriver in `@journeyman/core`

Add a single source of truth that computes the env-var label from
`(provider, config, modelId)`. Both the worker (writes `env[label]`) and the
runner (reads `env[label]`) call it, so they can never disagree.

```ts
// packages/core/src/registries/coding-model-key-slot.ts
export function codingModelKeySlot(input: {
  provider: string;
  config: CodingModelConfig | undefined;
  modelId: string | undefined;
}): string {
  const { provider, config, modelId } = input;
  if (provider === "claude") return "ANTHROPIC_API_KEY";
  if (provider === "aisdk") {
    // aisdk always passes apiKey explicitly, so the label is cosmetic; pick a
    // stable, readable name keyed off the SDK package.
    const byNpm: Record<string, string> = {
      "@ai-sdk/anthropic": "ANTHROPIC_API_KEY",
      "@ai-sdk/openai": "OPENAI_API_KEY",
      "@ai-sdk/google": "GOOGLE_GENERATIVE_AI_API_KEY",
    };
    return byNpm[config?.npm ?? ""] ?? "AISDK_API_KEY";
  }
  if (provider === "opencode") {
    // Cloud models read this from process.env, so the standard name is required.
    return suggestedKeySlotName(modelId) || "OPENCODE_API_KEY";
  }
  return "API_KEY";
}
```

### 2. Replace `apiKeySlot`-as-flag with an explicit signal

`apiKeySlot` currently does double duty: it's both the label and the "this model
needs a key" flag. We remove it as a stored label and add an explicit boolean.

- Add `requiresApiKey?: boolean` to `CodingModelConfig`.
- The "Requires an API key" toggle sets `config.requiresApiKey`; it no longer
  touches any label string.
- `apiKeySlot` is no longer read anywhere. (It may remain in old JSONB rows but
  is ignored — see Migration.)

### 3. UI: remove the "Env var name" field entirely

In `AdminCodingModelsPage.tsx`:

- Delete the "Env var name" `<Field>` (the `apiKeySlot` input) for all providers.
- `requiresKey` reads `config.requiresApiKey` instead of `Boolean(apiKeySlot)`.
- The toggle handler sets/clears `requiresApiKey` and clears `apiKeySecretId`
  when turned off. No more `suggestedKeySlotName`/`ANTHROPIC_API_KEY` defaulting
  in the form.
- The "Requires an API key" + "Org secret" picker is the entire auth section.

### 4. Validation / routes

- `validate-config.ts`: drop all `apiKeySlot` checks. (Optionally validate that
  `requiresApiKey` is a boolean.)
- `org.ts` `validateBinding`: `needsKey = Boolean(config?.requiresApiKey)`.
  The "must reference an org secret" rule is unchanged.

### 5. Slot helpers

- `opencode-slots.ts`: `openCodeModelSlots()` / `codingModelSlots()` derive the
  slot from `requiresApiKey` (via `codingModelKeySlot`) instead of `apiKeySlot`.
  Return `[]` when `requiresApiKey` is false/undefined.
- `suggestedKeySlotName()` stays — it becomes an internal helper used by
  `codingModelKeySlot`, no longer surfaced to the form.

### 6. Worker: derive the label, single path

- `cli-worker.ts` `modelKeyResolver`: gate on `config.requiresApiKey` (not
  `apiKeySlot`); compute `slot = codingModelKeySlot({ provider, config, modelId })`;
  return `{ slot, value }` as before.
- `worker-harness.ts`: unchanged (`env[mk.slot] = mk.value`).
- `agent-run-step-handler.ts`: the second injection site must use the same helper
  (`env[codingModelKeySlot(...)] = value`) and gate on `requiresApiKey`. Prefer
  consolidating so there is exactly one code path that injects the model-owned
  key; if both must remain, both call the shared helper.

### 7. Runner: derive the label instead of reading it

- `aisdk/model.ts`: replace `const slot = config.apiKeySlot` with
  `const slot = codingModelKeySlot({ provider: "aisdk", config, modelId })`.
- `opencode/server-config.ts`: replace `env[config.apiKeySlot]` with
  `env[codingModelKeySlot({ provider: "opencode", config, modelId: model })]`.

Because the worker and runner both call `codingModelKeySlot` with the same
inputs, the write label and the read label always match.

## Migration

- Add `requiresApiKey: true` to `config` for existing `jm_coding_models` rows
  that currently have a non-empty `config.apiKeySlot`. (Append-only SQL migration
  in `packages/migrations/`.)
- Leave the legacy `apiKeySlot` value in JSONB; it is ignored after this change.
  (Optional: strip it in the same migration for cleanliness.)
- No secret data changes. Models that never bound a secret (e.g. the MiniMax row
  in this incident) still need a secret bound by the user — that is unchanged and
  out of scope here.

## Out of scope

- Fixing the specific MiniMax-M3 row's missing/ workspace-scoped secret binding
  (a data fix, handled separately).
- Why the model was originally saved with a slot but no binding
  (`validateBinding` bypass) — worth a follow-up but not part of this change.

## Testing

- `coding-model-key-slot` unit tests: each provider/mode returns the expected
  label (claude, aisdk per-npm + fallback, opencode cloud + custom).
- `validate-config` / `org` route: binding required iff `requiresApiKey`.
- `aisdk/model` + `opencode/server-config`: read the key from the derived label
  given an env populated under that label.
- Worker/runner round-trip: worker writes under `codingModelKeySlot(...)`, runner
  reads the same label — assert the key arrives.
- Migration test: a row with `apiKeySlot` set gets `requiresApiKey: true`.

## Acceptance

- The "Env var name" field is gone from the model form for every provider.
- A coding model works with only: "Requires an API key" on + an org secret bound.
- No typed string can desync the write/read label; a MiniMax-style 401 caused by
  a label typo is impossible.
