# OpenCode Custom Model Config — Design

**Date:** 2026-06-09
**Status:** Approved (design)
**Builds on:** `2026-06-08-opencode-provider-parity-design.md` (OpenCode provider parity)

## Goal

Let an admin define an **OpenCode coding model that points at any endpoint** — built-in cloud
providers (Claude, OpenAI, Gemini), local runtimes (Ollama, LM Studio), or self-hosted /
gateway OpenAI-compatible servers (vLLM, internal proxies). When the provider type is
`opencode`, the coding-model form surfaces an optional **Custom endpoint** section (base URL,
npm package, API-key secret slot). At run time that config is threaded to the OpenCode
provider, which emits OpenCode's `Config.provider` block so the model resolves to the right
URL and credentials.

## Background — how it works today

- Coding models live in `jm_coding_models` (`packages/migrations/src/sql/013_coding_models.sql`)
  — flat scalar columns, **no place for provider-specific config**.
- `CodingModel` type: `packages/core/src/types/coding-models.types.ts`. CRUD:
  `packages/coding-models/src/db.ts`. Admin routes: `packages/coding-models/src/routes/admin.ts`.
- Admin UI: `packages/web/src/routes/AdminCodingModelsPage.tsx` (provider dropdown + flat
  fields; no provider-conditional fields yet).
- A step's chosen model is resolved to a `model` **string** (`resolveModelForStep`,
  `custom-ai-step-handler` reads `input.model`) and passed per-operation as `opts.model`. The
  runner builds the provider with `createCodingProvider(key, { env })` — **it never sees the
  model's config** (no DB access in the container).
- The OpenCode provider (parity spec) parses `opts.model` as `"providerID/modelID"` and, when
  no `provider` block is configured, relies on OpenCode's **built-in catalog** (known URL +
  standard env-var key) — so cloud providers already work with just a key.
- Secret slots: provider slots come from `PROVIDER_CATALOG`
  (`packages/core/src/registries/provider-catalog.ts`); the OpenCode entry currently advertises
  only a generic `OPENCODE_API_KEY` slot. Per-step `secretBindings` resolve slot → env value
  (`custom-ai-step-handler` merges provider slots + step slots, then calls `bindingResolver`).

## Decisions (locked with stakeholder)

1. **Fields (Standard):** `baseUrl`, `npm` (default `@ai-sdk/openai-compatible`), `apiKeySlot`
   (name of the secret slot holding the key; blank = no key).
2. **API key:** per-model configurable slot name, resolved via the existing secret-binding
   mechanism. Local servers (Ollama, LM Studio) leave it blank.
3. **providerID is not stored** — it is the first segment of the model id
   (`ollama/llama3.1` → providerID `ollama`). Config only supplies what OpenCode can't infer.
4. **Backward compatible:** no config ⇒ no `provider` block ⇒ OpenCode uses its built-in
   catalog. Existing cloud OpenCode models are unaffected.

## Behaviour summary (the three scenarios)

| | Claude (cloud) | OpenAI (cloud) | LM Studio (local) |
|---|---|---|---|
| model id | `anthropic/claude-sonnet-4-6` | `openai/gpt-4o` | `lmstudio/llama-3.1` |
| Custom-endpoint section | empty | empty | Base URL filled |
| Key | `ANTHROPIC_API_KEY` secret | `OPENAI_API_KEY` secret | none (or named slot) |
| `provider` block emitted | No (built-in) | No (built-in) | Yes (URL + adapter) |
| OpenCode calls | api.anthropic.com | api.openai.com | the LM Studio URL |

**Rule:** cloud ⇒ bind the standard provider key, leave custom empty. Local/self-hosted ⇒ fill
Base URL (+ a key slot only if the server requires auth).

## Components / changes

### 1. Storage — `config` JSONB column

New migration (next number in `packages/migrations/src/sql/`):
```sql
ALTER TABLE jm_coding_models ADD COLUMN config JSONB NOT NULL DEFAULT '{}';
```
JSONB chosen over typed columns: one migration serves all future provider-specific config; the
TS layer keeps it typed.

### 2. Core types — `CodingModelConfig`

In `packages/core/src/types/coding-models.types.ts`:
```ts
export interface CodingModelConfig {
  /** Custom endpoint base URL (e.g. http://host.docker.internal:1234/v1). */
  baseUrl?: string;
  /** AI-SDK npm package for the provider; default "@ai-sdk/openai-compatible". */
  npm?: string;
  /** Secret-slot name holding the endpoint's API key; blank = no key. */
  apiKeySlot?: string;
}
```
Add `config?: CodingModelConfig` to `CodingModel`, `CodingModelCreateInput`, and (via
`Partial`) `CodingModelUpdateInput`.

### 3. DB CRUD — `db.ts`

- INSERT/UPDATE include the `config` column (serialize the object to JSONB).
- `rowToModel` hydrates `config` from the JSONB row (default `{}` → `undefined` when empty).
- Add `findCodingModel(pool, provider, modelId): Promise<CodingModel | null>` (lookup by the
  unique `(provider, model_id)` pair) for the runtime resolver.

### 4. API + validation — `routes/admin.ts`

- POST/PATCH accept an optional `config` object and forward it to `insert/updateCodingModel`.
- Validate only when `provider === "opencode"`: if `config.baseUrl` is present it must parse as
  a URL (`new URL(...)`); `npm` and `apiKeySlot`, if present, must be non-empty strings. Reject
  with `400` and a clear message otherwise. Non-opencode providers ignore `config`.

### 5. UI — `AdminCodingModelsPage.tsx`

- Extend the form state with `config: { baseUrl, npm, apiKeySlot }`.
- Render a **"Custom endpoint (optional)"** section only when `provider === "opencode"`, with
  three inputs: Base URL, npm package (placeholder `@ai-sdk/openai-compatible`), API key slot.
- Helper line: "Inside Docker, `localhost` is the container — use `host.docker.internal` or a
  reachable service address."
- Cloud OpenCode models leave the section blank.

### 6. Provider key slots for cloud OpenCode models — `provider-catalog.ts`

So cloud-via-OpenCode auth works, the standard provider key env vars must be bindable. Extend
the OpenCode `PROVIDER_CATALOG` entry's `slots` to include the common standard names as optional
slots: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY` (keeping
`OPENCODE_API_KEY`). All optional — a given model uses whichever its provider needs.

### 7. Runtime plumbing — config travels per-operation

The config must reach the provider through `opts` (the runner has no DB):

a. **Option types** — add an optional `modelConfig?: CodingModelConfig` next to the existing
   `model?: string` on `RunCustomPromptOptions` (core `coding.types.ts`) and on
   `ScanReposOptions` / `CheckoutRepoOptions` (core `git.types.ts`).

b. **Resolver dep** — the worker (`cli-worker.ts`) gains a `codingModelResolver({ provider,
   modelId }) => CodingModel | undefined` backed by `findCodingModel` (mirrors the existing
   `modelResolver`/`skillsResolver` injection so step handlers stay DB-free).

c. **Step handlers** — in the coding step handlers (primary: `custom-ai-step-handler`; also the
   scan/checkout handlers, so a custom model can serve as the default), when
   `provider === "opencode"`:
   - resolve the model's `config`;
   - if `config.apiKeySlot` is set, add `{ name: apiKeySlot, optional: true }` to the effective
     secret slots **before** `bindingResolver` runs, so the key lands in `env`;
   - pass `config` as `modelConfig` into the operation opts.

d. **OpenCode `buildServerConfig`** — extend its inputs to `{ mcps, model, modelConfig, env }`.
   When `modelConfig` has `baseUrl`/`npm`/`apiKeySlot`, emit:
   ```ts
   provider: {
     [providerID]: {                                 // providerID = parseOpenCodeModel(model).providerID
       npm: modelConfig.npm ?? "@ai-sdk/openai-compatible",
       options: {
         ...(modelConfig.baseUrl ? { baseURL: modelConfig.baseUrl } : {}),
         ...(modelConfig.apiKeySlot && env?.[modelConfig.apiKeySlot]
           ? { apiKey: env[modelConfig.apiKeySlot] } : {}),
       },
     },
   }
   ```
   No `modelConfig` ⇒ no `provider` block (built-in catalog path, unchanged).
   `OpenCodeProvider.#withServer` passes `opts.model`/`opts.modelConfig`/`opts.env` through.

## Data flow (LM Studio custom-AI step, Docker backend)

1. Step picks model `lmstudio/llama-3.1`; worker resolves provider `opencode` + the model's
   `config` (baseUrl, npm) via `codingModelResolver`.
2. No `apiKeySlot` → no extra secret. (If set, the slot is added and resolved into `env`.)
3. Worker sends RunnerRequest `{ op:"custom-prompt", provider:"opencode",
   opts:{ …, model:"lmstudio/llama-3.1", modelConfig:{ baseUrl, npm }, env, cwd:"/workspace" } }`.
4. Container: `createCodingProvider("opencode", { env })` → `runCustomPrompt` → `buildServerConfig`
   emits `provider.lmstudio = { npm:"@ai-sdk/openai-compatible", options:{ baseURL } }` → managed
   `opencode serve` → `session.prompt({ model:{ providerID:"lmstudio", modelID:"llama-3.1" } })`.
5. OpenCode calls the LM Studio URL; result returns up the normal path.

## Error handling

- Invalid `baseUrl` → `400` at create/update (never persisted).
- Unreachable endpoint / bad URL at run time → OpenCode prompt error, already captured into the
  operation result.
- Missing key for an endpoint that needs one → provider auth error, surfaced the same way.
- `apiKeySlot` names a slot with no bound secret → empty key, no `apiKey` emitted, no crash.

## Testing

- **Unit:**
  - `findCodingModel` returns the row (incl. `config`) by `(provider, modelId)`.
  - `db.ts` round-trips `config` through INSERT/UPDATE/`rowToModel` (incl. empty `{}` → undefined).
  - API validation: rejects a bad `baseUrl` for opencode; ignores `config` for other providers.
  - `buildServerConfig`: emits the `provider` block with baseURL, npm default, and apiKey-from-env;
    omits the block entirely when `modelConfig` is absent.
  - handler adds `apiKeySlot` to effective slots when present.
- **Integration (optional, env-gated):** run a custom-AI step against a local OpenAI-compatible
  server (LM Studio / Ollama mock) and confirm the prompt reaches the configured URL.

## Out of scope (YAGNI)

- Arbitrary headers / extra-options blob, per-provider OAuth.
- UI that browses available models from an endpoint.
- Per-sandbox (vs per-model) endpoint configuration.

## Affected files (indicative)

- `packages/migrations/src/sql/<next>_coding_model_config.sql` — add `config JSONB`.
- `packages/core/src/types/coding-models.types.ts` — `CodingModelConfig` + `config` field.
- `packages/core/src/types/coding.types.ts`, `git.types.ts` — `modelConfig?` on the option types.
- `packages/core/src/registries/provider-catalog.ts` — standard key slots on the opencode entry.
- `packages/coding-models/src/db.ts` — config column + `findCodingModel`.
- `packages/coding-models/src/routes/admin.ts` — accept + validate `config`.
- `packages/web/src/routes/AdminCodingModelsPage.tsx` — conditional Custom endpoint section.
- `packages/orchestrator/src/cli-worker.ts` — `codingModelResolver` wiring.
- `packages/orchestrator/src/workers/steps/custom-ai-step-handler.ts` (+ scan/checkout handlers)
  — resolve config, augment slots, pass `modelConfig`.
- `packages/agent-runtime/src/providers/opencode/server-config.ts` — emit `provider` block.
- `packages/agent-runtime/src/providers/opencode/index.ts` — thread `model`/`modelConfig`/`env`.
