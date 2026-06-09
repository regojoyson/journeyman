# OpenCode Model-Owned Secret Slot — Design

**Date:** 2026-06-09
**Status:** Approved (design)
**Fixes / supersedes part of:** `2026-06-09-opencode-custom-model-config-design.md`
(the catalog-slots + provider-block-gating decisions below replace what that spec shipped)

## Problem

After adding custom-endpoint config, the OpenCode entry in `PROVIDER_CATALOG` was given
five static key slots (`OPENCODE_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`,
`GEMINI_API_KEY`, `OPENROUTER_API_KEY`). Both the flow-editor secrets panel
(`RequiredSecretsTab`) and the worker read that list, so **every OpenCode step shows all
five secret dropdowns** regardless of the chosen model. It's confusing and wrong: a step
using Claude should ask for one key, not five.

## Goal

Make the **coding model own its secret**: when an admin creates an OpenCode coding model,
they declare whether it needs an API key and, if so, the secret/env-var name. In a workflow,
selecting that model shows **exactly that one key as a required slot** for the user to map —
the same pattern as the GitHub Issues provider's fixed `GITHUB_ACCESS_TOKEN`. The mapped
secret is injected into the sandbox environment where OpenCode runs.

## Decisions (locked with stakeholder)

1. **Model declares its secret** (not auto-derived at runtime). The admin sets it on the
   coding model. Reuse the existing `config.apiKeySlot` field as "the secret key name this
   model requires"; presence = requires a key, empty = no key.
2. **Smart prefill** in the form: when "Requires an API key" is toggled on, prefill the key
   name from the model id's providerID (`anthropic/…`→`ANTHROPIC_API_KEY`,
   `openai/…`→`OPENAI_API_KEY`, `google/…`→`GEMINI_API_KEY`, otherwise
   `${PROVIDERID}_API_KEY`). The admin can override; the stored value is authoritative.
3. **Required, not optional.** In the workflow the declared key is shown as **required**; the
   user must map a secret (publish-blocking, like GitHub Issues).
4. **Custom endpoint shows only the model's declared key** (or nothing if blank). No fallback
   guess for keyless local servers.

## Form layout (admin, OpenCode only)

Two subsections in the coding-model form, shown when provider = `opencode`:

1. **Authentication**
   - Toggle **"Requires an API key"**.
   - When on → text input **"Secret key name"**, prefilled from the providerID (editable),
     stored as `config.apiKeySlot`.
2. **Custom endpoint (optional)** — Base URL + npm package (local/self-hosted). The API-key
   field is *not* here (cloud models need keys too); it lives in Authentication.

Examples:
| Model | Requires key | Secret key name | Base URL |
|---|---|---|---|
| `anthropic/claude-sonnet-4-6` | on | `ANTHROPIC_API_KEY` (prefilled) | — |
| `openai/gpt-4o` | on | `OPENAI_API_KEY` (prefilled) | — |
| `lmstudio/llama-3.1` | off | — | `http://host.docker.internal:1234/v1` |
| `myvllm/mistral` | on | `MY_VLLM_KEY` (typed) | `https://llm.internal/v1` |

## Workflow secrets panel (per scenario)

- Claude model selected → one row `ANTHROPIC_API_KEY (required)`; user maps a secret.
- Switch the model to OpenAI → the row swaps to `OPENAI_API_KEY (required)` automatically.
- LM Studio model → **no** key row ("this model needs no API key").
- vLLM model → one row `MY_VLLM_KEY (required)`.

Before: five dropdowns. After: exactly the one the selected model declares (or none).

## Components / changes

### 1. Shared helper (single source of truth) — `@journeyman/core`

A pure function so editor, worker, and flow validation can't drift:
```ts
import type { SecretSlotDef } from "./types/secret-slot.types.ts";
import type { CodingModelConfig } from "./types/coding-models.types.ts";

/** Required key slot(s) an OpenCode model needs, derived from its declared config. */
export function openCodeModelSlots(config: CodingModelConfig | undefined): SecretSlotDef[] {
  if (config?.apiKeySlot) {
    return [{ name: config.apiKeySlot, description: "API key for this model.", optional: false }];
  }
  return [];
}

/** Smart default key name for the form, from an OpenCode model id "providerID/modelID". */
export function suggestedKeySlotName(modelId: string | undefined): string {
  const providerID = modelId && modelId.includes("/") ? modelId.split("/", 1)[0] : "";
  if (!providerID) return "";
  const overrides: Record<string, string> = { google: "GEMINI_API_KEY" };
  return overrides[providerID] ?? `${providerID.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_API_KEY`;
}
```

### 2. Provider catalog — drop the static OpenCode slots

`packages/core/src/registries/provider-catalog.ts`: the opencode entry's `slots` becomes
`[]`. OpenCode has no framework-level key; the model defines it. (This is the change that
removes the five dropdowns.)

### 3. Editor secrets panel — `RequiredSecretsTab`

`packages/flow-editor/src/properties-panel/RequiredSecretsTab.tsx`: for an OpenCode step,
stop sourcing provider slots from the catalog. Instead:
- The selected coding model is fetched for the node's provider (the `/api/coding-models`
  response already includes `config`). Find the model whose `modelId === node.model`.
- Compute its key slot via `openCodeModelSlots(model.config)` and render that (required), or
  nothing. For custom-AI steps, still union the step's own DB-defined slots as today.
- Switching the model re-derives the row.

### 4. Coding-model form — Authentication subsection

`packages/web/src/routes/AdminCodingModelsPage.tsx`: add the "Requires an API key" toggle +
"Secret key name" input (prefilled via `suggestedKeySlotName(v.modelId)` when toggled on),
writing `config.apiKeySlot`. Keep Base URL + npm under "Custom endpoint (optional)".

### 5. Worker parity — `custom-ai-step-handler`

`packages/orchestrator/src/workers/steps/custom-ai-step-handler.ts`: for OpenCode, replace
the catalog-union with `openCodeModelSlots(input.modelConfig)` so the resolved (and required)
slot matches the editor exactly. Non-OpenCode providers keep their catalog slots. (The
harness already threads `modelConfig` onto the step input.)

### 6. `buildServerConfig` provider-block fix — gate on `baseUrl`

`packages/agent-runtime/src/providers/opencode/server-config.ts`: `buildProviderBlock`
currently emits a `provider` block when `baseUrl || npm || apiKeySlot` is set. A cloud model
now carries `apiKeySlot` (e.g. `ANTHROPIC_API_KEY`) with no `baseUrl`, which would wrongly
emit an `openai-compatible` block over Anthropic. **Fix: emit the block only when `baseUrl`
is present** (a custom endpoint is defined by its URL). Cloud models → no block → the key
sits in env and OpenCode's built-in provider reads it. Custom endpoints → block with
`baseURL` + `apiKey` from `env[apiKeySlot]`.

## Secret reaches the sandbox (explicit guarantee)

The mapped secret value reaches the environment where OpenCode runs, for both backends:
1. The required slot is in the step's `effectiveSlots`; `bindingResolver` resolves it into
   the `env` object.
2. `env` is passed as `opts.env` to the coding operation.
3. **Docker backend:** `SandboxInstanceCodingProvider` sets `opts.env` on the container
   `exec`, so it is in the runner's `process.env` inside the container → the spawned
   `opencode serve` inherits it. For custom endpoints, `buildServerConfig` also injects
   `env[apiKeySlot]` into the provider block's `options.apiKey`.
4. **Local backend:** `applyEnv` merges `opts.env` into `process.env` around the spawn.

The value is never written into the prompt and never persisted by this feature.

## Error handling

- Required key unmapped in a workflow → publish/validation flags it (existing required-slot
  behavior), same as GitHub Issues.
- Model declares no key but the endpoint actually needs one → OpenCode auth error at run
  time, surfaced in the operation result (unchanged).
- Editor can't find the selected model (stale list) → show no derived slot rather than crash;
  the worker still resolves correctly from `modelConfig` at run time.

## Testing

- **Unit (core):** `openCodeModelSlots` returns one required slot when `apiKeySlot` is set,
  `[]` when not. `suggestedKeySlotName` maps providerIDs (`anthropic`→`ANTHROPIC_API_KEY`,
  `google`→`GEMINI_API_KEY`, `mistral`→`MISTRAL_API_KEY`, no-slash → "").
- **Unit (provider-catalog):** opencode entry has no static slots.
- **Unit (server-config):** `buildProviderBlock` omits the block for a cloud model with only
  `apiKeySlot`; still emits it (with apiKey) for a `baseUrl` model.
- **Editor:** selecting a model with a declared key shows exactly one required slot; switching
  models swaps it; a keyless model shows none.
- **Worker:** `effectiveSlots` for an OpenCode custom-AI step equals the model's declared
  slot (required), not the old five.

## Out of scope

- Per-step model selection / key display for built-in OpenCode steps (scanRepos/checkout) in
  the editor — at run time the worker derives the slot from the resolved default model via the
  same helper; editor support stays deferred.
- Validating that a cloud model's declared key name matches OpenCode's expected env var (the
  prefill guides it; the admin may override).

## Affected files (indicative)

- `packages/core/src/registries/provider-catalog.ts` — empty opencode slots.
- `packages/core/src/registries/opencode-slots.ts` (new) — `openCodeModelSlots`,
  `suggestedKeySlotName` (+ test).
- `packages/flow-editor/src/properties-panel/RequiredSecretsTab.tsx` — model-derived slot.
- `packages/web/src/routes/AdminCodingModelsPage.tsx` — Authentication subsection + prefill.
- `packages/orchestrator/src/workers/steps/custom-ai-step-handler.ts` — use the helper.
- `packages/agent-runtime/src/providers/opencode/server-config.ts` — gate provider block on
  `baseUrl`.
