# Coding-Model Pricing In The Model Form — Design

**Date:** 2026-06-21
**Status:** Approved (pending spec review)
**Scope:** UI/UX consolidation of the Coding Models admin page. Pricing becomes a section of the
single create/edit model form; the separate "Model pricing" section is removed. The pricing data
model (`jm_model_pricing`, versioned) and the cost pipeline are untouched.

## Problem

The current Coding Models admin page (`packages/web/src/routes/AdminCodingModelsPage.tsx`) shows
two parallel things: the models table with its create/edit modal, and a separate "Model pricing"
section with its own cramped inline table + add-price form (the row of tiny pill inputs in the
screenshot). This is confusing and visually poor. Pricing is conceptually an attribute of a
coding model, so it should be entered in the same form that creates/edits the model and saved in
one action.

## Goals

- Enter pricing as a **section inside the create/edit model form**; save model + price together.
- **Remove** the separate `ModelPricingSection` (table + inline add-price form) from the page.
- Light polish so the page no longer "looks bad": section dividers, empty-state `—`, consistent
  spacing, and a compact price indicator on the models table.
- Preserve the existing backend: the versioned `jm_model_pricing` table, write-time `cost_usd`
  computation, and the backfill all stay exactly as they are. This is a UI/entry-point change only.

## Non-Goals (YAGNI)

- No change to the `jm_model_pricing` schema, the cost-computation logic, the backfill script, or
  the analytics/usage dashboard.
- No full redesign of the page (table → cards, etc.). Light polish only.
- No multi-version pricing editor in the UI. The form edits "the current price"; versioning
  happens automatically underneath (a changed price supersedes the prior active row).

## Decisions (from brainstorming)

- **Keep the versioned table.** Pricing stays in `jm_model_pricing` keyed by
  `(org, provider, model)`. The form reads/writes the active price. Past usage keeps the cost it
  was charged (`cost_usd` is frozen at write time).
- **Scope:** form consolidation + light polish (not a full page redesign).

---

## Architecture

Three changes: a richer create/update payload on the coding-model routes, a backend upsert of the
active price within those handlers, and the form/page UI.

### 1. Shared pricing-input shape (core)

Add a small reusable type so the form, the API client, and the route share one shape. In
`packages/core/src/types/model-pricing.types.ts`:

```typescript
/** Editable rate fields surfaced in the coding-model form. USD per 1M tokens. */
export type ModelPriceInput = {
  inputPer1m?: number | null;
  outputPer1m?: number | null;
  cacheReadPer1m?: number | null;
  cacheCreationPer1m?: number | null;
  reasoningPer1m?: number | null;
  currency?: string;
};
```

`CodingModelCreateInput` / `CodingModelUpdateInput` (in
`packages/core/src/types/coding-models.types.ts`) gain an optional field:

```typescript
  pricing?: ModelPriceInput;
```

### 2. Backend — coding-model routes upsert the active price

In `packages/coding-models/src/routes/org.ts`, the POST and PATCH handlers, after writing the
coding model, conditionally upsert the active price:

- If `body.pricing` is present **and** at least one rate is a number, call the existing
  `insertModelPricing(pool, orgId, { provider, model: modelId, ...pricing })`. `insertModelPricing`
  already closes the prior active row (`effective_to = now`) and inserts the new one — versioning
  preserved.
- If `body.pricing` is absent or all-empty, write nothing.
- Matching key: the price is stored with `provider = model.provider` and `model = model.modelId`,
  which is exactly what `resolveActivePrice` (in `record-token-usage.ts`) looks up at write time.

A tiny helper decides "any rate set":

```typescript
function hasAnyRate(p: ModelPriceInput | undefined): boolean {
  return !!p && [p.inputPer1m, p.outputPer1m, p.cacheReadPer1m, p.cacheCreationPer1m, p.reasoningPer1m]
    .some((r) => typeof r === "number");
}
```

The standalone `/model-pricing` POST/PATCH routes (`routes/pricing.ts`) stay for API/script use but
are no longer driven by the UI. The GET (list) and DELETE remain — the form uses GET to prefill.

### 3. Frontend — pricing as a form section

`packages/web/src/api/codingModels.ts`: the create/update payload types already come from core, so
they pick up `pricing` automatically. `packages/web/src/api/modelPricing.ts`: keep `orgList` (used
for prefill); the create/update helpers become optional (kept, unused by UI).

`AdminCodingModelsPage.tsx`:
- **Delete** the `ModelPricingSection` component and its `<ModelPricingSection orgId={orgId} />`
  render.
- In `ModelForm`, add a **Pricing** section after Capabilities with five number inputs
  (input / output / cache-read / cache-write / reasoning per 1M) and a currency field defaulting
  to `USD`. Values are held in form state as `v.pricing`.
- **Prefill on edit:** when the form opens for an existing model, fetch the org's prices
  (`modelPricingApi.orgList(orgId)`) and seed `v.pricing` from the active row matching
  `(provider, modelId)` (the row with `effectiveTo === null`). On create, start blank.
- **Submit:** the existing `onSubmit(v)` now carries `v.pricing`; the create/update mutation sends
  it. One save writes both.
- **Models table polish:** replace/augment the sparse columns with a compact "Price" cell showing
  a check when an active price exists for that model, `—` otherwise (derived from the same
  `orgList` query the page already can hold). Tidy spacing and empty states.

---

## Data Flow

1. Admin opens New/Edit model → form fetches org prices and prefills the Pricing section (edit only).
2. Admin fills identity/capabilities/pricing → clicks "Save model".
3. Frontend sends the coding-model create/update payload including `pricing`.
4. Backend writes the coding model, then (if any rate set) upserts the active price in
   `jm_model_pricing` via `insertModelPricing` (superseding the prior active row).
5. `recordTokenUsage` continues to resolve the active price by `(org, provider, model)` at write
   time — unchanged.

## Error Handling & Edge Cases

- **No rates entered:** no price row is written; existing price (if any) is left as-is. Clearing a
  field to blank means "don't change via this save" rather than "delete the price" — deletion stays
  on the (kept) DELETE route / a future affordance. (Documented so behavior is unambiguous.)
- **Edit with unchanged rates:** `insertModelPricing` would otherwise create a redundant version.
  Guard: only upsert when the submitted rates differ from the current active price; otherwise skip.
- **Provider/modelId changed on edit:** the price is keyed by the *new* `(provider, modelId)`; the
  old key's active price is left untouched (it no longer matches any model). Acceptable for v1;
  noted, not handled specially.
- **Validation:** rate inputs accept empty (→ null) or a non-negative number; non-numeric strings
  are coerced to null on submit (same `num()` helper already used).
- **Auth:** unchanged — admin-gated routes, `req.runContext!.org.id` scope check.

## Testing

- **Backend:** unit test `hasAnyRate` (all-empty → false, one number → true, null/undefined → false).
  Extend the org-routes behavior: a create/update with `pricing` results in an `insertModelPricing`
  call; without it, none. (Mirror the existing coding-models test style — fake pool / mocked db.)
- **Frontend:** test the prefill selector — given an `orgList` result, it picks the active
  (`effectiveTo === null`) row matching `(provider, modelId)` and maps it to `ModelPriceInput`;
  returns blank when none. (Pure function, vitest, matching the repo's pure-function test pattern.)
- Existing pricing-db and cost tests remain green (no logic changed there).

## Affected Files

- `packages/core/src/types/model-pricing.types.ts` — add `ModelPriceInput`.
- `packages/core/src/types/coding-models.types.ts` — add optional `pricing` to create/update inputs.
- `packages/coding-models/src/routes/org.ts` — upsert active price in POST/PATCH; `hasAnyRate` helper.
- `packages/web/src/routes/AdminCodingModelsPage.tsx` — delete `ModelPricingSection`; add Pricing
  section + prefill to `ModelForm`; table polish + price indicator.
- `packages/web/src/api/modelPricing.ts` — keep `orgList`; UI no longer calls create/update.
- A new pure helper module for the prefill selector (e.g.
  `packages/web/src/routes/coding-model-pricing.ts`) so it is unit-testable.

## Open Questions

None blocking.
