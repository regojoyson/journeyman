# Coding-Model Pricing In The Model Form Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move model pricing into the single coding-model create/edit form (saved with the model), delete the separate "Model pricing" section, and lightly polish the page — keeping the versioned `jm_model_pricing` table and cost pipeline unchanged.

**Architecture:** The coding-model create/update payload gains an optional `pricing` object. The coding-model POST/PATCH handlers, after writing the model, upsert the active price in `jm_model_pricing` for `(org, provider, modelId)` (superseding the prior active row only when rates changed). The `ModelForm` modal gains a Pricing section that prefills from the active price on edit. The standalone pricing section/table is removed.

**Tech Stack:** TypeScript, Fastify, PostgreSQL via `pg`, React 19 + `@tanstack/react-query`, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-21-coding-model-pricing-in-form-design.md`

> **Execution constraints (from the user): work on `master`, do NOT commit, run a single `npm run typecheck` at the end.** The per-task "Commit" and DB/curl steps below are therefore replaced by typecheck/test-only verification; ignore any commit instructions.

---

## File Structure

- Modify `packages/core/src/types/model-pricing.types.ts` — add `ModelPriceInput`.
- Modify `packages/core/src/types/coding-models.types.ts` — add optional `pricing` to `CodingModelCreateInput`.
- Modify `packages/coding-models/src/pricing-db.ts` — add `hasAnyRate`, `ratesEqual`, `getActivePrice`, `upsertActivePrice`.
- Modify `packages/coding-models/src/pricing-db.test.ts` — unit-test `hasAnyRate` + `ratesEqual`.
- Modify `packages/coding-models/src/routes/org.ts` — upsert active price in POST/PATCH.
- Create `packages/web/src/routes/coding-model-pricing.ts` — pure `activePriceFor` selector.
- Create `packages/web/src/routes/coding-model-pricing.test.ts` — unit-test the selector.
- Modify `packages/web/src/routes/AdminCodingModelsPage.tsx` — Pricing section + prefill in `ModelForm`; delete `ModelPricingSection`; add price indicator column.

---

### Task 1: Add the pricing-input type to core

**Files:**
- Modify: `packages/core/src/types/model-pricing.types.ts`
- Modify: `packages/core/src/types/coding-models.types.ts`

- [ ] **Step 1: Add `ModelPriceInput`**

Append to `packages/core/src/types/model-pricing.types.ts`:

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

- [ ] **Step 2: Add optional `pricing` to the coding-model create input**

In `packages/core/src/types/coding-models.types.ts`, import the new type at the top (or add an inline import) and extend `CodingModelCreateInput`. Add this field to the `CodingModelCreateInput` type body:

```typescript
  /** Optional pricing entered in the model form; persisted to jm_model_pricing on save. */
  pricing?: import("./model-pricing.types.ts").ModelPriceInput;
```

(`CodingModelUpdateInput = Partial<CodingModelCreateInput>` automatically inherits `pricing`.)

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck -w @journeyman/core`
Expected: PASS.

---

### Task 2: Pricing-db helpers — change detection + active-price upsert

**Files:**
- Modify: `packages/coding-models/src/pricing-db.ts`
- Modify: `packages/coding-models/src/pricing-db.test.ts`

- [ ] **Step 1: Write failing tests for the pure helpers**

Append to `packages/coding-models/src/pricing-db.test.ts`:

```typescript
import { hasAnyRate, ratesEqual } from "./pricing-db.ts";
import type { ModelPricing } from "@journeyman/core";

describe("hasAnyRate", () => {
  it("is false for undefined or all-empty", () => {
    expect(hasAnyRate(undefined)).toBe(false);
    expect(hasAnyRate({})).toBe(false);
    expect(hasAnyRate({ inputPer1m: null, outputPer1m: undefined })).toBe(false);
  });
  it("is true when any rate is a number (including 0)", () => {
    expect(hasAnyRate({ inputPer1m: 0 })).toBe(true);
    expect(hasAnyRate({ outputPer1m: 75 })).toBe(true);
  });
});

describe("ratesEqual", () => {
  const active = {
    inputPer1m: 15, outputPer1m: 75, cacheReadPer1m: 1.5, cacheCreationPer1m: 18.75, reasoningPer1m: null,
  } as ModelPricing;
  it("treats matching rates as equal (ignores currency/effective dates)", () => {
    expect(ratesEqual(active, { inputPer1m: 15, outputPer1m: 75, cacheReadPer1m: 1.5, cacheCreationPer1m: 18.75, reasoningPer1m: null })).toBe(true);
  });
  it("detects a changed rate", () => {
    expect(ratesEqual(active, { inputPer1m: 16, outputPer1m: 75, cacheReadPer1m: 1.5, cacheCreationPer1m: 18.75, reasoningPer1m: null })).toBe(false);
  });
  it("treats undefined input rate as unchanged from null active rate", () => {
    expect(ratesEqual(active, { inputPer1m: 15, outputPer1m: 75, cacheReadPer1m: 1.5, cacheCreationPer1m: 18.75 })).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -w @journeyman/coding-models -- pricing-db`
Expected: FAIL — `hasAnyRate`/`ratesEqual` not exported.

- [ ] **Step 3: Implement the helpers + upsert**

Add to `packages/coding-models/src/pricing-db.ts` (the file already imports `Pool` and the model-pricing types; add `ModelPriceInput` to the type import):

```typescript
import type { ModelPricing, ModelPricingCreateInput, ModelPricingUpdateInput, ModelPriceInput } from "@journeyman/core";

const RATE_KEYS = ["inputPer1m", "outputPer1m", "cacheReadPer1m", "cacheCreationPer1m", "reasoningPer1m"] as const;

export function hasAnyRate(p: ModelPriceInput | undefined): boolean {
  return !!p && RATE_KEYS.some((k) => typeof p[k] === "number");
}

/** Compare an existing active price's rates to a submitted input. null and undefined are equal. */
export function ratesEqual(active: ModelPricing, input: ModelPriceInput): boolean {
  return RATE_KEYS.every((k) => (active[k] ?? null) === (input[k] ?? null));
}

/** The active (effective_to IS NULL) price for (org, provider, model), or null. */
export async function getActivePrice(
  pool: Pool, orgId: string, provider: string, model: string,
): Promise<ModelPricing | null> {
  const { rows } = await pool.query(
    `SELECT * FROM jm_model_pricing
     WHERE org_id = $1 AND provider = $2 AND model = $3 AND effective_to IS NULL
     LIMIT 1`,
    [orgId, provider, model],
  );
  return rows[0] ? rowToPricing(rows[0]) : null;
}

/**
 * Set the active price for (org, provider, model) from a form input. No-op when no rate is set
 * or when the rates match the current active price. Otherwise supersedes via insertModelPricing.
 */
export async function upsertActivePrice(
  pool: Pool, orgId: string, provider: string, model: string, input: ModelPriceInput | undefined,
): Promise<void> {
  if (!hasAnyRate(input)) return;
  const active = await getActivePrice(pool, orgId, provider, model);
  if (active && ratesEqual(active, input!)) return;
  await insertModelPricing(pool, orgId, {
    provider, model,
    inputPer1m: input!.inputPer1m ?? null, outputPer1m: input!.outputPer1m ?? null,
    cacheReadPer1m: input!.cacheReadPer1m ?? null, cacheCreationPer1m: input!.cacheCreationPer1m ?? null,
    reasoningPer1m: input!.reasoningPer1m ?? null, currency: input!.currency,
  });
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -w @journeyman/coding-models -- pricing-db`
Expected: PASS (existing tests + the new `hasAnyRate`/`ratesEqual` cases).

---

### Task 3: Upsert pricing in the coding-model routes

**Files:**
- Modify: `packages/coding-models/src/routes/org.ts`

- [ ] **Step 1: Import the upsert helper**

In `packages/coding-models/src/routes/org.ts`, add to the existing `../db.ts`… imports block a new import:

```typescript
import { upsertActivePrice } from "../pricing-db.ts";
```

- [ ] **Step 2: Upsert after create**

In the POST handler, immediately after `const rec = await insertCodingModel(...)` and before `reply.code(201); return rec;`, add:

```typescript
        await upsertActivePrice(pool, orgId, rec.provider, rec.modelId, b.pricing);
```

- [ ] **Step 3: Upsert after update**

In the PATCH handler, after `const updated = await updateCodingModel(pool, orgId, id, req.body as any);` and before `return updated;`, add (guard for the not-found case which returns earlier in that try — `updated` is non-null here):

```typescript
        if (updated) {
          await upsertActivePrice(pool, orgId, updated.provider, updated.modelId, (req.body as { pricing?: import("@journeyman/core").ModelPriceInput }).pricing);
        }
```

- [ ] **Step 4: Typecheck + boundaries**

Run: `npm run typecheck -w @journeyman/coding-models && npm run check:boundaries`
Expected: PASS.

---

### Task 4: Pure prefill selector for the form

**Files:**
- Create: `packages/web/src/routes/coding-model-pricing.ts`
- Create: `packages/web/src/routes/coding-model-pricing.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/web/src/routes/coding-model-pricing.test.ts
import { describe, it, expect } from "vitest";
import { activePriceFor } from "./coding-model-pricing.ts";
import type { ModelPricing } from "@journeyman/core";

const row = (over: Partial<ModelPricing>): ModelPricing => ({
  id: "mp", orgId: "o", provider: "claude", vendor: undefined, model: "claude-opus-4-8",
  inputPer1m: 15, outputPer1m: 75, cacheReadPer1m: null, cacheCreationPer1m: null, reasoningPer1m: null,
  currency: "USD", effectiveFrom: "2026-06-01T00:00:00Z", effectiveTo: null,
  createdAt: "", updatedAt: "", ...over,
});

describe("activePriceFor", () => {
  it("returns the active row matching provider+model as a ModelPriceInput", () => {
    const p = activePriceFor([row({})], "claude", "claude-opus-4-8");
    expect(p).toEqual({ inputPer1m: 15, outputPer1m: 75, cacheReadPer1m: null, cacheCreationPer1m: null, reasoningPer1m: null, currency: "USD" });
  });
  it("ignores superseded (effectiveTo set) rows", () => {
    const p = activePriceFor([row({ effectiveTo: "2026-06-10T00:00:00Z", inputPer1m: 99 })], "claude", "claude-opus-4-8");
    expect(p).toBeNull();
  });
  it("returns null when nothing matches", () => {
    expect(activePriceFor([row({})], "claude", "other-model")).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -w @journeyman/web -- coding-model-pricing`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// packages/web/src/routes/coding-model-pricing.ts
import type { ModelPricing, ModelPriceInput } from "@journeyman/core";

/** The active price (effectiveTo === null) for a provider+model, mapped to the form's input shape. */
export function activePriceFor(
  prices: ModelPricing[], provider: string, model: string,
): ModelPriceInput | null {
  const active = prices.find(
    (p) => p.effectiveTo === null && p.provider === provider && p.model === model,
  );
  if (!active) return null;
  return {
    inputPer1m: active.inputPer1m, outputPer1m: active.outputPer1m,
    cacheReadPer1m: active.cacheReadPer1m, cacheCreationPer1m: active.cacheCreationPer1m,
    reasoningPer1m: active.reasoningPer1m, currency: active.currency,
  };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -w @journeyman/web -- coding-model-pricing`
Expected: PASS (3 assertions).

---

### Task 5: Add the Pricing section to `ModelForm`

**Files:**
- Modify: `packages/web/src/routes/AdminCodingModelsPage.tsx`

- [ ] **Step 1: Import the selector and the prices API**

At the top of `AdminCodingModelsPage.tsx`, `modelPricingApi` is already imported. Add the selector import:

```typescript
import { activePriceFor } from "./coding-model-pricing.ts";
```

- [ ] **Step 2: In `ModelForm`, fetch prices and add a pricing setter + prefill effect**

`ModelForm` already calls `useState`, `useQuery`, and reads `props.orgId`/`props.initial`. Add `useEffect` to the React import at the top of the file if not present (`import { useState, useEffect } from "react";`). Inside `ModelForm`, after the `orgSecrets` query, add:

```typescript
  const { data: orgPrices = [] } = useQuery({
    queryKey: ["model-pricing", props.orgId],
    queryFn: () => modelPricingApi.orgList(props.orgId),
    enabled: !!props.orgId,
  });

  const setPrice = (k: keyof import("@journeyman/core").ModelPriceInput, raw: string) =>
    setV((prev) => ({
      ...prev,
      pricing: { ...(prev.pricing ?? {}), [k]: raw.trim() === "" ? null : Number(raw) },
    }));

  const isEdit = "id" in props.initial;
  useEffect(() => {
    if (!isEdit || v.pricing !== undefined) return;
    const active = activePriceFor(orgPrices, v.provider, v.modelId);
    if (active) setV((prev) => ({ ...prev, pricing: active }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgPrices, isEdit]);
```

- [ ] **Step 3: Render the Pricing section**

Insert this `<section>` between the Capabilities section (closes at the `</section>` after the Context window field) and the Authentication section:

```tsx
        <section className="space-y-3">
          <h3 className="text-sm font-medium text-slate-200">Pricing</h3>
          <p className="text-xs text-slate-400">
            USD per 1M tokens — optional. Changing a saved price supersedes the old one going forward;
            past usage keeps its cost.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Input / 1M">
              <input className={inputCls} type="number" step="0.0001" min="0"
                value={v.pricing?.inputPer1m ?? ""}
                onChange={(e) => setPrice("inputPer1m", e.target.value)} placeholder="15" />
            </Field>
            <Field label="Output / 1M">
              <input className={inputCls} type="number" step="0.0001" min="0"
                value={v.pricing?.outputPer1m ?? ""}
                onChange={(e) => setPrice("outputPer1m", e.target.value)} placeholder="75" />
            </Field>
            <Field label="Cache read / 1M">
              <input className={inputCls} type="number" step="0.0001" min="0"
                value={v.pricing?.cacheReadPer1m ?? ""}
                onChange={(e) => setPrice("cacheReadPer1m", e.target.value)} placeholder="1.5" />
            </Field>
            <Field label="Cache write / 1M">
              <input className={inputCls} type="number" step="0.0001" min="0"
                value={v.pricing?.cacheCreationPer1m ?? ""}
                onChange={(e) => setPrice("cacheCreationPer1m", e.target.value)} placeholder="18.75" />
            </Field>
            <Field label="Reasoning / 1M">
              <input className={inputCls} type="number" step="0.0001" min="0"
                value={v.pricing?.reasoningPer1m ?? ""}
                onChange={(e) => setPrice("reasoningPer1m", e.target.value)} placeholder="(often = output)" />
            </Field>
          </div>
        </section>
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck -w @journeyman/web`
Expected: PASS. (`v.pricing` is valid because Task 1 added `pricing` to `CodingModelCreateInput`; the submit at `props.onSubmit(v)` now carries it, and the create/update mutations send the whole `v`.)

---

### Task 6: Delete the separate pricing section + add a price indicator column

**Files:**
- Modify: `packages/web/src/routes/AdminCodingModelsPage.tsx`

- [ ] **Step 1: Remove the standalone section render**

Delete this line from the page body (currently after the `{editing && (…)}` block):

```tsx
        <ModelPricingSection orgId={orgId} />
```

- [ ] **Step 2: Delete the `ModelPricingSection` component**

Delete the entire `function ModelPricingSection({ orgId }: { orgId: string }) { … }` definition (the component added previously, spanning its `useQuery`/`useMutation` setup, the table, and the inline add-price form). Leave `ModelForm`, `Field`, `InfoButton`, `Toggle`, `SecretBindingField` intact.

- [ ] **Step 3: Add a prices query + price indicator to the table**

In `AdminCodingModelsPage`, after the existing `data` query, add:

```typescript
  const { data: prices = [] } = useQuery({
    queryKey: ["model-pricing", orgId],
    queryFn: () => modelPricingApi.orgList(orgId),
    enabled: !!orgId,
  });
  const pricedKeys = new Set(
    prices.filter((p) => p.effectiveTo === null).map((p) => `${p.provider}/${p.model}`),
  );
```

Add a header cell after the "Context" `<th>`:

```tsx
                  <th className="px-4 py-3 text-left font-medium">Price</th>
```

Add the matching body cell after the Context `<td>` in each row:

```tsx
                    <td className="px-4 py-3">
                      {pricedKeys.has(`${m.provider}/${m.modelId}`)
                        ? <span className="text-success">✓</span>
                        : <span className="text-slate-600">—</span>}
                    </td>
```

Update the empty-state `colSpan={8}` to `colSpan={9}` (one more column now).

- [ ] **Step 4: Typecheck the web package**

Run: `npm run typecheck -w @journeyman/web`
Expected: PASS. `ModelPricingSection` is gone and no longer referenced; `modelPricingApi` is still used (orgList for prefill + indicator).

- [ ] **Step 5: Browser verify**

Frontend hot-reloads. Open `/orgs/:orgId/coding-models` as admin:
- The separate "Model pricing" section is gone.
- "New model" → the form shows a Pricing section; entering rates and saving creates the model and its price; the table's Price column shows ✓.
- "Edit" an existing priced model → the Pricing fields are prefilled from the active price; changing a rate and saving supersedes it (a new active row); leaving rates unchanged writes no new version.

---

## Final Verification

- [ ] **Step 1: Typecheck the whole repo**

Run: `npm run typecheck`
Expected: PASS across all packages.

- [ ] **Step 2: Run the touched unit suites**

Run: `npx vitest run packages/coding-models/src/pricing-db.test.ts packages/web/src/routes/coding-model-pricing.test.ts`
Expected: PASS — including the new `hasAnyRate`, `ratesEqual`, and `activePriceFor` cases, with existing pricing-db tests still green.
