# Coding-model secret binding — design

**Date:** 2026-06-19
**Status:** Approved (design); pending implementation plan

## Problem

A coding model today stores only the *name* of an API-key slot (e.g. `ANTHROPIC_API_KEY`)
in `CodingModelConfig.apiKeySlot`. The actual secret is mapped separately, **per workflow
step and per agent**, via `WorkflowNode.secretBindings`. Consequences:

- The same secret must be re-bound in every workflow and every agent that uses a model.
- It is easy to forget, producing runs that fail at execution time with a missing key.
- The model and its credential live apart, even though a model is useless without its key.

## Goal

Bind the secret **on the coding model itself**, once. After that, any workflow or agent
simply selects the model and runs end-to-end — no per-step secret mapping. The org admin
who creates a model picks an existing **org secret** for its API key, or creates one inline.

## Decisions (settled during brainstorming)

1. **Coding models become org-scoped.** Each org owns its own list of models. There is no
   shared platform-wide catalog and no "master template" list. (Today the table is
   platform-wide; in practice it is hand-populated with little/no seeded data.)
2. **The model fully owns its API key.** The model's bound secret is the single source. The
   API-key slot disappears from the per-step "Required secrets" UI and from publish-time slot
   collection. Workflows/agents only choose a model.
3. **The existing "Requires an API key" toggle is the on/off control.** Toggle on ⇒ a secret
   must be picked or created before the model can be saved. Toggle off ⇒ no secret (local /
   self-hosted endpoints that need no key).
4. **Org admins manage their org's models**, mirroring how org secrets are managed today.
5. **Storage:** the model row references the bound org secret by **id** via a real foreign key
   with `ON DELETE RESTRICT` (recommended; flag during review). `apiKeySlot` is retained but
   now means only "the env-var name the provider expects".
6. **Migration:** existing model rows are assigned to a single designated org (configurable);
   admins recreate elsewhere as needed. This is the one migration judgement call.

## Current state (reference)

| Concern | Where it lives today |
|---|---|
| Model catalog table | `jm_coding_models` — platform-wide, unique `(provider, model_id)` |
| Model CRUD | `/api/admin/coding-models`, `requirePlatformAdmin` (`packages/coding-models/src/routes/admin.ts`) |
| Model config type | `CodingModelConfig { baseUrl?, npm?, apiKeySlot? }` (`packages/core/src/types/coding-models.types.ts`) |
| Claude key slot | provider-level optional slot `ANTHROPIC_API_KEY` in `PROVIDER_CATALOG` (`packages/core/src/registries/provider-catalog.ts`) |
| opencode/aisdk key slot | model `config.apiKeySlot`, surfaced via `openCodeModelSlots()` (`packages/core/src/registries/opencode-slots.ts`) |
| Per-step binding | `WorkflowNode.secretBindings: Record<slot, SecretBinding>`; `SecretBinding = {mode:"auto"} | {mode:"pinned",scope,name}` |
| Secrets | `jm_secrets`, org- and workspace-scoped; org CRUD `/api/orgs/:orgId/secrets` (org admin) |
| Runtime slot collection | `worker-harness.ts` (provider + step slots) and inline in `agent-run-step-handler.ts` |
| Runtime model config lookup | `modelConfigResolver` → `findCodingModel(pool, provider, modelId)` (`cli-worker.ts`) |
| Binding resolution | `bindingResolver` → `resolveBindings()` (`packages/secrets/src/resolve-bindings.ts`) |
| Model form UI | `packages/web/src/routes/AdminCodingModelsPage.tsx` (route `/orgs/:orgId/coding-models`) |

The Authentication section (toggle + key-name field) currently renders **only for
opencode/aisdk** (`AdminCodingModelsPage.tsx:288`); Claude has no auth section because its key
is a provider-level slot.

## Target design

### 1. Org-scoping of coding models

- Add `org_id UUID NOT NULL REFERENCES jm_orgs(id)` to `jm_coding_models`.
- Change uniqueness `(provider, model_id)` → **`(org_id, provider, model_id)`**.
- Change the "one default per provider" partial unique index to be **per org**.
- CRUD routes move to **`/api/orgs/:orgId/coding-models`** (GET/POST/PATCH/DELETE), guarded by
  `requireAuth({ role: "admin" })` plus the `req.runContext.org.id === orgId` check (matching
  org-secrets). The platform-admin routes (`/api/admin/coding-models`) are retired.
- The public list `GET /api/coding-models` becomes **org-filtered** from `runContext.org`.
- The web page already lives at `/orgs/:orgId/coding-models` for org admins; only its API
  client and the "managed by platform admins" copy change.

### 2. Model → secret binding (data)

- Add nullable column **`api_key_secret_id UUID REFERENCES jm_secrets(id) ON DELETE RESTRICT`**
  to `jm_coding_models`. Bound only when the model requires a key.
- `CodingModelConfig.apiKeySlot` is retained as **the env-var name the provider expects**
  (e.g. `ANTHROPIC_API_KEY`). Fixed/derived for Claude; editable for opencode/aisdk.
- `core` types: `CodingModel` gains `orgId` and `apiKeySecretId`; create/update inputs accept
  `apiKeySecretId`.

### 3. Model form UX (`AdminCodingModelsPage.tsx`)

- The "Requires an API key" section is extended to **all key-needing providers, including
  Claude** (no longer gated to opencode/aisdk).
- When the toggle is on, the field becomes a **secret picker**: a dropdown of this org's
  secrets **plus "+ Create new secret"**. "Create new" opens an inline mini-form (name +
  value), creates the org secret via the existing `POST /api/orgs/:orgId/secrets`, selects it —
  no navigation away.
- Save validation: toggle on ⇒ `api_key_secret_id` must be set. Toggle off ⇒ it is cleared.

### 4. What disappears from workflows / agents

- Remove the model's API-key slot from the per-step "Required secrets" UI
  (`RequiredSecretsTab`) and from publish-time slot collection in
  `packages/api-server/src/routes/flows.ts`.
- The Claude provider-level `ANTHROPIC_API_KEY` slot is no longer bound per-step.
- The step's secret UI now shows only non-model slots (git/ticket provider tokens, etc.).

### 5. Runtime resolution

- Extend `modelConfigResolver` (or add a sibling resolver) so the run-time model lookup also
  returns `api_key_secret_id` and `apiKeySlot`.
- Add **`fetchSecretById`** to `@journeyman/secrets` (fetch + decrypt one org secret by id,
  scoped to the run's org).
- Add a **model-key injection** step in `worker-harness.ts` and, mirrored, in
  `agent-run-step-handler.ts`: if the model has a bound secret, fetch+decrypt it and set
  `env[apiKeySlot] = value`. This replaces the old step-binding path for that key.
- **No-DB / env-only dev path is unaffected:** with no DB there is no model binding, so it
  keeps reading `process.env` as today.

## Component breakdown (build order)

1. `migrations` — `org_id`, new uniqueness, `api_key_secret_id` FK.
2. `core` — `CodingModel` / input types (`orgId`, `apiKeySecretId`); `apiKeySlot` semantics doc.
3. `secrets` — `fetchSecretById`.
4. `coding-models` — org-scoped `db.ts` queries; org-scoped routes; retire admin routes;
   resolver returns secret id + slot.
5. `orchestrator` — model-key injection (harness + agent handler); remove model-key step binding.
6. `api-server` — drop model-key slot from publish-time collection in `flows.ts`.
7. `web` — org API client; form auth section for all providers + secret picker with inline
   create; `RequiredSecretsTab` exclusion of the model key slot.

## Open items flagged for review

- FK `ON DELETE RESTRICT` vs `SET NULL` for `api_key_secret_id`.
- The designated-org choice for migrating existing model rows.

## Out of scope

- Workspace-scoped models (org scope only).
- Multiple secrets per model (only the single API key).
- Per-step override of the model's key (explicitly rejected: model fully owns it).
