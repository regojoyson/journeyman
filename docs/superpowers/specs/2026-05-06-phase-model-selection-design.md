# Phase Model Selection — Design

**Date:** 2026-05-06
**Status:** Approved (brainstorming) — pending implementation plan
**Owner:** Samuel Rego

## Goal

Let users choose which AI model runs each AI-capable phase (built-in `analyze` / `plan` / `implement`, and custom AI phases). Selection has a **workflow-level default** with **per-step overrides**. The available models are managed in the database so admins can add new models without code changes.

## Non-goals

- Per-org or per-user model catalogs (global admin-managed only).
- Per-step coding-provider override (one coding provider per flow remains).
- Saved model presets or capability-based filtering (additive, future).

## Resolution cascade

For each AI step at run time:

1. `step.model` (per-step override in flow definition)
2. `flow.defaultModel` (workflow default)
3. `coding_models` row with `is_default = true` for `flow.providers.coding`
4. `CodingCLIProviderConfig.defaultModel` (provider's hardcoded fallback)

The first defined value wins. If all are absent the provider uses its built-in default — preserving today's behaviour for flows that set nothing.

## Data model

### Migration `013_coding_models.sql`

```sql
CREATE TABLE coding_models (
  id              TEXT PRIMARY KEY,
  provider        TEXT NOT NULL,
  model_id        TEXT NOT NULL,
  label           TEXT NOT NULL,
  description     TEXT,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  enabled         BOOLEAN NOT NULL DEFAULT true,
  deprecated      BOOLEAN NOT NULL DEFAULT false,
  is_default      BOOLEAN NOT NULL DEFAULT false,
  supports_thinking  BOOLEAN NOT NULL DEFAULT false,
  context_window     INTEGER,
  input_cost_per_1m  NUMERIC(10,4),
  output_cost_per_1m NUMERIC(10,4),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, model_id)
);
CREATE INDEX coding_models_provider_idx
  ON coding_models (provider) WHERE enabled = true;
CREATE UNIQUE INDEX coding_models_one_default_per_provider
  ON coding_models (provider) WHERE is_default = true;
```

`provider` is a free `TEXT` column — adding a future provider is a row insert, not a schema change. The partial unique index makes "one default per provider" a database-enforced invariant.

### Core type

`packages/core/src/types/coding-models.types.ts`:

```ts
export type CodingModel = {
  id: string;
  provider: string;
  modelId: string;
  label: string;
  description?: string;
  sortOrder: number;
  enabled: boolean;
  deprecated: boolean;
  isDefault: boolean;
  supportsThinking: boolean;
  contextWindow?: number;
  inputCostPer1M?: number;
  outputCostPer1M?: number;
  createdAt: string;
  updatedAt: string;
};
```

Re-exported from `@journeyman/core`'s root.

## New package: `@journeyman/coding-models`

Mirrors the structure of `@journeyman/custom-phases`:

```
packages/coding-models/
├── package.json
└── src/
    ├── index.ts        ← exports types, db functions, route registrar
    ├── db.ts           ← CRUD + findDefaultModel(provider)
    └── routes/
        ├── admin.ts    ← admin CRUD endpoints
        └── public.ts   ← GET /api/coding-models
```

`db.ts` exposes:

- `listAll()` — admin
- `listEnabled(provider: string)` — public
- `findById(id)`, `findByModelId(provider, modelId)`
- `findDefaultModel(provider)` — used by the worker resolver
- `create`, `update`, `remove` — admin only; `update` and `create` clear other defaults for the same provider in the same transaction when `is_default = true` is set

## API surface

### Admin (require admin session)

| Method | Path | Body / Query |
|---|---|---|
| `GET` | `/api/admin/coding-models` | — |
| `POST` | `/api/admin/coding-models` | full row (no `id`/timestamps) |
| `PATCH` | `/api/admin/coding-models/:id` | partial row |
| `DELETE` | `/api/admin/coding-models/:id` | — |

Validation:
- `provider`, `model_id`, `label` non-empty.
- `(provider, model_id)` unique.
- Numeric fields ≥ 0 if present.
- Setting `is_default = true` auto-clears the prior default for the same provider in the same transaction.

### Public (any authenticated user)

| Method | Path | Behaviour |
|---|---|---|
| `GET` | `/api/coding-models?provider=claude` | Returns rows with `enabled = true` for the provider, ordered by `sort_order, label`. Includes `deprecated` rows so existing flows referencing them still display, but with a deprecated badge. |

## Flow definition changes

In `packages/core/src/types/pipeline.types.ts`:

```ts
export type FlowDefinition = {
  name: string;
  providers: { issue: string; git: string; coding: string; notification: string };
  defaultModel?: string;          // NEW — model_id for providers.coding
  steps: FlowStepDefinition[];
};

export type FlowStepDefinition = {
  id: string;
  phase: string;
  config?: Record<string, unknown>;
  model?: string;                 // NEW — per-step override
  retry?: { attempts: number; backoffMs: number };
  timeoutMs?: number;
  onFailure?: "fail" | "skip" | "retry" | "block";
  requiredSecrets?: string[];
};
```

**Why `model` is a top-level field on the step rather than inside `config`:** it applies uniformly to any AI-capable phase. Keeping it alongside `retry`/`timeoutMs` means built-in and custom AI phases share one wiring point.

**Phase metadata:** add `supportsModelSelection?: boolean` to phase meta (same place `tabs.mcp` lives). Set `true` on `analyze`, `plan`, `implement`, `runCustomPrompt`. The flow editor only shows the model dropdown for steps whose phase declares this flag.

**Save-time validation:** if `flow.defaultModel` or `step.model` is set, verify the value exists in `coding_models` for `flow.providers.coding`. Disabled values are rejected; deprecated values are allowed but flagged.

## Worker integration

`orchestrator/src/cli-worker.ts` and `workers/phases/custom-ai-phase-handler.ts` resolve the model once per step before invoking the phase handler:

```ts
async function resolveModel(
  step: FlowStepDefinition,
  flow: FlowDefinition,
): Promise<string | undefined> {
  if (step.model) return step.model;
  if (flow.defaultModel) return flow.defaultModel;
  const sysDefault = await findDefaultModel(flow.providers.coding);
  return sysDefault?.modelId; // undefined ⇒ provider uses its own fallback
}
```

The result is passed as the existing `model?: string` option on `analyze` / `plan` / `implement` / `runCustomPrompt`. **No provider code changes** — `ClaudeProvider` already honours `options.model`.

## Web UI

### Admin page — `AdminCodingModelsPage.tsx`

Table view with columns: Provider, Model ID, Label, Default, Enabled, Deprecated, Context, $/1M in, $/1M out. Toolbar: provider filter, "New model" button. Edit drawer with all fields; flipping `is_default` warns that the current default for the provider will be replaced. Wired into the existing admin sidebar section.

### Flow editor

Two additions:

1. **Flow settings panel** — `Default model` dropdown. Options come from `GET /api/coding-models?provider=<flow.providers.coding>`. Each row renders as `{label} · {context_window} ctx · ${input}/${output} per 1M` with a `deprecated` badge when relevant. Empty selection ⇒ inherit system default. Changing `providers.coding` clears `defaultModel`.
2. **Step config panel** — for steps whose phase has `supportsModelSelection: true`, render a `Model` dropdown whose first option is `Use flow default (<resolved label>)`. Stored as `step.model` (top-level), never in `step.config`.

### Shared

- `<CodingModelSelect />` — single component used by admin page and flow editor; renders label + context + cost + deprecation badge consistently.
- `packages/web/src/api/codingModels.ts` — `listCodingModels(provider)`, `adminListCodingModels()`, CRUD calls.
- React-query cache keyed `['coding-models', provider]` with 5-minute stale time. Admin mutations invalidate both admin and public keys.

## Backward compatibility

- Existing flows without `defaultModel` or `step.model` keep running unchanged — the resolver returns `undefined` and the provider's hardcoded fallback applies, exactly like today.
- The admin can seed `coding_models` with the current hardcoded provider defaults marked `is_default = true` so the cascade has a sensible terminal step before code-level defaults are reached.

## Out of scope (future, additive)

- **Presets** — named bundles like `{analyze: opus, plan: sonnet}` that a flow can pick.
- **Capability tags** — phases declare required capabilities (`thinking`, `vision`); UI hides incompatible models.
- **Per-org catalogs** — orgs maintain their own list, or toggle visibility on the global one.
- **Per-step coding-provider override.**

Each is an additive migration on top of this design.
