# Coding-Model Admin: Provider Dropdown + Server Validation

**Date:** 2026-05-14
**Status:** Draft

## Problem

When creating or editing a coding model in the platform-admin UI, the **Provider** field is a free-text input ([AdminCodingModelsPage.tsx:168-170](../../../packages/web/src/routes/AdminCodingModelsPage.tsx)). The downstream consumer — the workflow editor's `CodingModelSelect` — filters models with an exact-match SQL `WHERE provider = $1` ([CodingModelSelect.tsx:33](../../../packages/flow-editor/src/components/CodingModelSelect.tsx), [db.ts:106-109](../../../packages/coding-models/src/db.ts)).

The mismatch — loosely created, strictly consumed — means a typo (`"clade"`, `"openai"`) silently breaks the per-step Model dropdown in the flow editor with no error or warning anywhere.

The set of valid coding-cli providers is already defined in code: `PROVIDER_CATALOG` in [provider-catalog.ts](../../../packages/core/src/registries/provider-catalog.ts). The admin form should use it.

## Goals

- Make it impossible to create a coding-model row with an unknown coding-cli provider via the admin UI.
- Reject the same via the admin REST API so non-UI clients can't bypass it.
- Preserve any existing legacy rows with non-catalog provider values; allow admins to fix them in place.

## Non-goals

- No DB schema change (no CHECK constraint, no enum, no FK). Catalog is code-level truth.
- No backfill or cleanup migration for existing bad rows.
- No change to the public `/api/coding-models?provider=...` endpoint or the worker model resolver — both already do exact-match filtering and will work correctly once admin data is clean.
- No catalog change to add `opencode` (flag separately if needed).

## Design

### Admin form — provider dropdown

File: [packages/web/src/routes/AdminCodingModelsPage.tsx](../../../packages/web/src/routes/AdminCodingModelsPage.tsx) (around line 168).

Replace the free-text input with a `<select>`:

- Options: `providersForKind("coding-cli")` from `@journeyman/core` (use the non-filtered variant so admins can register models for not-yet-implemented providers — e.g. staging a Gemini model before the provider ships).
- Option value = `entry.value`; option label = `entry.label`.
- Default selection on create: the catalog's `isDefault` entry for `coding-cli` (currently `claude`).
- Edit mode legacy handling: if the row being edited has a `provider` value not present in the catalog, render an additional disabled option `"<value> (unknown)"` and pre-select it. This ensures legacy rows load with their stored value visible and the admin can switch to a valid value to fix them.

### Server-side validation

File: [packages/coding-models/src/routes/admin.ts](../../../packages/coding-models/src/routes/admin.ts).

Import `providersForKind` from `@journeyman/core` and build a validation set once at module load:

```ts
const VALID_CODING_PROVIDERS = new Set(
  providersForKind("coding-cli").map(p => p.value),
);
```

`POST /api/admin/coding-models` (lines 33-64): after the existing `provider/modelId/label` presence check, validate:

```ts
if (!VALID_CODING_PROVIDERS.has(String(b.provider))) {
  return reply.code(400).send({
    error: `Unknown coding-cli provider: ${b.provider}. Allowed: ${[...VALID_CODING_PROVIDERS].join(", ")}`,
  });
}
```

`PATCH /api/admin/coding-models/:id` (lines 66-84): validate only when `provider` is present in the patch body (PATCH is partial). Same error shape.

### Why two layers

The dropdown alone protects the happy path. The server guard protects against direct API calls and any future UI regression. Data integrity is enforced in exactly one place server-side — no DB constraint to coordinate with catalog edits.

## Files touched

1. [packages/web/src/routes/AdminCodingModelsPage.tsx](../../../packages/web/src/routes/AdminCodingModelsPage.tsx) — provider input → `<select>`; legacy-value fallback in edit mode.
2. [packages/coding-models/src/routes/admin.ts](../../../packages/coding-models/src/routes/admin.ts) — validate provider in POST and PATCH handlers.

No other packages, no DB migration.

## Risks / open questions

- **Legacy rows with unknown providers:** preserved by the edit-mode fallback option, never silently dropped. Read paths (list, get) are unchanged.
- **`opencode` provider:** exists in code under `packages/coding-cli/src/providers/opencode/` but is not in `PROVIDER_CATALOG`. With this change, any coding-model row with `provider = "opencode"` becomes uneditable to a valid state unless the catalog is updated. Out of scope here; tracked separately.
