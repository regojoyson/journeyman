# Usage & Cost Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a workspace-scoped "Usage & Cost" dashboard that turns recorded `jm_token_usage` token counts into dollars via an org-scoped, versioned model-pricing table, then surfaces cost/optimization/forensic/trend views.

**Architecture:** Three layers built in order. (1) A new `jm_model_pricing` table + admin CRUD (in `@journeyman/coding-models`) + write-time cost computation in `recordTokenUsage` + a one-time backfill. (2) New read-only aggregate endpoints on the standalone `@journeyman/analytics` service (port 4002). (3) A new `@journeyman/usage-dashboard` frontend package mounted in `@journeyman/web` at `/workspaces/:wsId/usage`.

**Tech Stack:** TypeScript, Fastify, PostgreSQL via `pg` (no ORM), React 19 + `@tanstack/react-query`, Vitest, custom inline-SVG/CSS charts (no charting library).

**Spec:** `docs/superpowers/specs/2026-06-21-usage-cost-dashboard-design.md`

---

## File Structure

**Phase 1 — Pricing & cost**
- Create `packages/core/src/types/model-pricing.types.ts` — `ModelPricing`, `ModelPricingCreateInput`, `ModelPricingUpdateInput`.
- Modify `packages/core/src/index.ts` (or the types barrel) — export the new types.
- Create `packages/migrations/src/sql/066_model_pricing.sql` — the table + indexes.
- Create `packages/coding-models/src/pricing-db.ts` — CRUD + `resolveActivePrice`.
- Create `packages/coding-models/src/pricing-db.test.ts` — row-mapping + SQL-shape unit tests.
- Create `packages/coding-models/src/routes/pricing.ts` — `registerOrgModelPricingRoutes`.
- Modify `packages/coding-models/src/routes/index.ts` — call the new register fn.
- Create `packages/orchestrator/src/usage/model-pricing.ts` — `computeCostUsd` + `resolveActivePrice` re-export-free SQL helper.
- Create `packages/orchestrator/src/usage/model-pricing.test.ts` — `computeCostUsd` unit tests.
- Modify `packages/orchestrator/src/usage/record-token-usage.ts` — look up price, compute `cost_usd`, add it to the INSERT.
- Modify `packages/orchestrator/src/usage/record-token-usage.test.ts` — assert `cost_usd` param.
- Create `scripts/backfill-token-cost.mjs` — one-time effective-dated cost backfill.
- Create `packages/web/src/api/modelPricing.ts` — fetch client.
- Modify `packages/web/src/routes/AdminCodingModelsPage.tsx` — add a pricing sub-section.

**Phase 2 — Analytics endpoints**
- Modify `packages/core/src/types/analytics.types.ts` — usage response types.
- Create `packages/analytics/src/db/usage.ts` — aggregate SQL functions.
- Create `packages/analytics/src/db/usage.test.ts` — `deriveCacheSavings` + dimension-whitelist unit tests.
- Create `packages/analytics/src/routes/usage.ts` — the `/usage/*` routes.
- Modify `packages/analytics/src/routes/index.ts` — register the usage routes.

**Phase 3 — Frontend**
- Create `packages/usage-dashboard/package.json`, `tsconfig.json`, `src/*`.
- Create `packages/web/src/api/usage.ts` — fetch wrappers.
- Create `packages/web/src/routes/UsageDashboardPage.tsx` — page wrapper.
- Modify `packages/web/src/App.tsx` — route.
- Modify `packages/web/src/components/nav-config.ts` — nav item.
- Modify `packages/web/package.json` — add the package dep.

---

## PHASE 1 — Pricing data model & cost computation

### Task 1: `ModelPricing` types in core

**Files:**
- Create: `packages/core/src/types/model-pricing.types.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Create the type file**

```typescript
// packages/core/src/types/model-pricing.types.ts

/** Per-(provider×model) price, org-scoped and effective-dated. Rates are USD per 1M tokens. */
export type ModelPricing = {
  id: string;
  orgId: string;
  provider: string;
  vendor?: string;
  model: string;
  inputPer1m: number | null;
  outputPer1m: number | null;
  cacheReadPer1m: number | null;
  cacheCreationPer1m: number | null;
  reasoningPer1m: number | null;
  currency: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ModelPricingCreateInput = {
  provider: string;
  vendor?: string;
  model: string;
  inputPer1m?: number | null;
  outputPer1m?: number | null;
  cacheReadPer1m?: number | null;
  cacheCreationPer1m?: number | null;
  reasoningPer1m?: number | null;
  currency?: string;
  /** ISO timestamp; defaults to now() server-side when omitted. */
  effectiveFrom?: string;
};

export type ModelPricingUpdateInput = Partial<Omit<ModelPricingCreateInput, "provider" | "model">>;
```

- [ ] **Step 2: Export from the core barrel**

Find the existing type exports in `packages/core/src/index.ts` (e.g. the line exporting `coding-models.types`) and add alongside them:

```typescript
export type {
  ModelPricing,
  ModelPricingCreateInput,
  ModelPricingUpdateInput,
} from "./types/model-pricing.types.ts";
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck -w @journeyman/core`
Expected: PASS (no errors).

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/types/model-pricing.types.ts packages/core/src/index.ts
git commit -m "feat(core): add ModelPricing types"
```

---

### Task 2: `jm_model_pricing` migration

**Files:**
- Create: `packages/migrations/src/sql/066_model_pricing.sql`

- [ ] **Step 1: Create the migration**

Matches the style of `064_token_usage.sql` (header comment, `IF NOT EXISTS`, snake_case columns). The unique partial index enforces **one active price per (org, provider, model)** so write-time lookup is never ambiguous; vendor is informational only.

```sql
-- 066_model_pricing.sql — org-scoped, effective-dated model pricing.
-- Source for jm_token_usage.cost_usd. One active row (effective_to IS NULL) per (org, provider, model).

CREATE TABLE IF NOT EXISTS jm_model_pricing (
  id                     TEXT PRIMARY KEY,
  org_id                 UUID NOT NULL REFERENCES jm_orgs(id) ON DELETE CASCADE,
  provider               TEXT NOT NULL,
  vendor                 TEXT,
  model                  TEXT NOT NULL,
  input_per_1m           NUMERIC(12,4),
  output_per_1m          NUMERIC(12,4),
  cache_read_per_1m      NUMERIC(12,4),
  cache_creation_per_1m  NUMERIC(12,4),
  reasoning_per_1m       NUMERIC(12,4),
  currency               TEXT NOT NULL DEFAULT 'USD',
  effective_from         TIMESTAMPTZ NOT NULL DEFAULT now(),
  effective_to           TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS jm_model_pricing_lookup_idx
  ON jm_model_pricing (org_id, provider, model, effective_from DESC);

CREATE UNIQUE INDEX IF NOT EXISTS jm_model_pricing_one_active_idx
  ON jm_model_pricing (org_id, provider, model)
  WHERE effective_to IS NULL;
```

- [ ] **Step 2: Apply the migration**

Run: `npm run migrate`
Expected: log line `applying 066_model_pricing`; no error. (If the dev DB on 5433 was never migrated, this also applies earlier ones.)

- [ ] **Step 3: Verify the table exists**

Run: `psql "$DATABASE_URL" -c "\d jm_model_pricing"`
Expected: table prints with the columns above and the two indexes listed.

- [ ] **Step 4: Commit**

```bash
git add packages/migrations/src/sql/066_model_pricing.sql
git commit -m "feat(migrations): jm_model_pricing table (066)"
```

---

### Task 3: Pricing DB layer

**Files:**
- Create: `packages/coding-models/src/pricing-db.ts`
- Test: `packages/coding-models/src/pricing-db.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/coding-models/src/pricing-db.test.ts
import { describe, it, expect } from "vitest";
import { rowToPricing, buildInsertParams } from "./pricing-db.ts";

describe("rowToPricing", () => {
  it("maps snake_case columns to a ModelPricing", () => {
    const p = rowToPricing({
      id: "mp_1", org_id: "org1", provider: "claude", vendor: "anthropic", model: "claude-opus-4-8",
      input_per_1m: "15.0000", output_per_1m: "75.0000", cache_read_per_1m: "1.5000",
      cache_creation_per_1m: "18.7500", reasoning_per_1m: null, currency: "USD",
      effective_from: "2026-06-01T00:00:00Z", effective_to: null,
      created_at: "2026-06-01T00:00:00Z", updated_at: "2026-06-01T00:00:00Z",
    });
    expect(p.inputPer1m).toBe(15);
    expect(p.reasoningPer1m).toBeNull();
    expect(p.vendor).toBe("anthropic");
    expect(p.effectiveTo).toBeNull();
  });
});

describe("buildInsertParams", () => {
  it("defaults currency and numeric rates", () => {
    const { params } = buildInsertParams("org1", { provider: "claude", model: "x" });
    // params: [id, orgId, provider, vendor, model, input, output, cacheRead, cacheCreate, reasoning, currency, effectiveFrom]
    expect(params[1]).toBe("org1");
    expect(params[2]).toBe("claude");
    expect(params[10]).toBe("USD");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @journeyman/coding-models -- pricing-db`
Expected: FAIL — cannot find module `./pricing-db.ts` / exports undefined.

- [ ] **Step 3: Implement the DB layer**

```typescript
// packages/coding-models/src/pricing-db.ts
import type { Pool } from "pg";
import type { ModelPricing, ModelPricingCreateInput, ModelPricingUpdateInput } from "@journeyman/core";

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

export function rowToPricing(r: any): ModelPricing {
  return {
    id: r.id,
    orgId: r.org_id,
    provider: r.provider,
    vendor: r.vendor ?? undefined,
    model: r.model,
    inputPer1m: num(r.input_per_1m),
    outputPer1m: num(r.output_per_1m),
    cacheReadPer1m: num(r.cache_read_per_1m),
    cacheCreationPer1m: num(r.cache_creation_per_1m),
    reasoningPer1m: num(r.reasoning_per_1m),
    currency: r.currency,
    effectiveFrom: r.effective_from,
    effectiveTo: r.effective_to ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function newId(): string {
  return `mp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Returns { id, params } for the INSERT (column order documented in insertModelPricing). */
export function buildInsertParams(orgId: string, input: ModelPricingCreateInput) {
  const id = newId();
  const params = [
    id, orgId, input.provider, input.vendor ?? null, input.model,
    input.inputPer1m ?? null, input.outputPer1m ?? null, input.cacheReadPer1m ?? null,
    input.cacheCreationPer1m ?? null, input.reasoningPer1m ?? null,
    input.currency ?? "USD", input.effectiveFrom ?? null,
  ];
  return { id, params };
}

export async function listModelPricingByOrg(pool: Pool, orgId: string): Promise<ModelPricing[]> {
  const { rows } = await pool.query(
    `SELECT * FROM jm_model_pricing WHERE org_id = $1
     ORDER BY provider, model, effective_from DESC`,
    [orgId],
  );
  return rows.map(rowToPricing);
}

export async function getModelPricing(pool: Pool, orgId: string, id: string): Promise<ModelPricing | null> {
  const { rows } = await pool.query(
    `SELECT * FROM jm_model_pricing WHERE id = $1 AND org_id = $2`, [id, orgId],
  );
  return rows[0] ? rowToPricing(rows[0]) : null;
}

/**
 * Insert a new price row. If an active (effective_to IS NULL) row exists for the same
 * (org, provider, model), close it at the new row's effective_from so there is exactly one
 * active price at a time.
 */
export async function insertModelPricing(
  pool: Pool, orgId: string, input: ModelPricingCreateInput,
): Promise<ModelPricing> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const effFrom = input.effectiveFrom ?? new Date().toISOString();
    await client.query(
      `UPDATE jm_model_pricing SET effective_to = $4, updated_at = now()
       WHERE org_id = $1 AND provider = $2 AND model = $3 AND effective_to IS NULL`,
      [orgId, input.provider, input.model, effFrom],
    );
    const { id, params } = buildInsertParams(orgId, { ...input, effectiveFrom: effFrom });
    const { rows } = await client.query(
      `INSERT INTO jm_model_pricing
         (id, org_id, provider, vendor, model, input_per_1m, output_per_1m, cache_read_per_1m,
          cache_creation_per_1m, reasoning_per_1m, currency, effective_from)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      params,
    );
    await client.query("COMMIT");
    return rowToPricing(rows[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** Patch rate/currency fields on an existing row in place (does not version). */
export async function updateModelPricing(
  pool: Pool, orgId: string, id: string, patch: ModelPricingUpdateInput,
): Promise<ModelPricing | null> {
  const existing = await getModelPricing(pool, orgId, id);
  if (!existing) return null;
  const next = { ...existing, ...patch };
  const { rows } = await pool.query(
    `UPDATE jm_model_pricing SET
       vendor = $3, input_per_1m = $4, output_per_1m = $5, cache_read_per_1m = $6,
       cache_creation_per_1m = $7, reasoning_per_1m = $8, currency = $9, updated_at = now()
     WHERE id = $1 AND org_id = $2 RETURNING *`,
    [id, orgId, next.vendor ?? null, next.inputPer1m, next.outputPer1m, next.cacheReadPer1m,
     next.cacheCreationPer1m, next.reasoningPer1m, next.currency],
  );
  return rows[0] ? rowToPricing(rows[0]) : null;
}

export async function deleteModelPricing(pool: Pool, orgId: string, id: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `DELETE FROM jm_model_pricing WHERE id = $1 AND org_id = $2`, [id, orgId],
  );
  return (rowCount ?? 0) > 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @journeyman/coding-models -- pricing-db`
Expected: PASS (3 assertions).

- [ ] **Step 5: Commit**

```bash
git add packages/coding-models/src/pricing-db.ts packages/coding-models/src/pricing-db.test.ts
git commit -m "feat(coding-models): model-pricing DB layer"
```

---

### Task 4: Pricing CRUD routes

**Files:**
- Create: `packages/coding-models/src/routes/pricing.ts`
- Modify: `packages/coding-models/src/routes/index.ts`

- [ ] **Step 1: Implement the routes**

Mirrors `routes/org.ts`: admin auth, `req.runContext!.org.id` scope check, 400/403/404 codes.

```typescript
// packages/coding-models/src/routes/pricing.ts
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { makeRequireAuth } from "@journeyman/identity";
import {
  deleteModelPricing, getModelPricing, insertModelPricing,
  listModelPricingByOrg, updateModelPricing,
} from "../pricing-db.ts";

export async function registerOrgModelPricingRoutes(app: FastifyInstance, pool: Pool) {
  const requireAuth = makeRequireAuth({ pool });

  app.get(
    "/api/orgs/:orgId/model-pricing",
    { preHandler: requireAuth({ role: "admin" }) },
    async (req, reply) => {
      const { orgId } = req.params as { orgId: string };
      if (req.runContext!.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      return listModelPricingByOrg(pool, orgId);
    },
  );

  app.post(
    "/api/orgs/:orgId/model-pricing",
    { preHandler: requireAuth({ role: "admin" }) },
    async (req, reply) => {
      const { orgId } = req.params as { orgId: string };
      if (req.runContext!.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      const b = req.body as any;
      if (!b?.provider || !b?.model) {
        return reply.code(400).send({ error: "provider, model required" });
      }
      const rec = await insertModelPricing(pool, orgId, {
        provider: String(b.provider), vendor: b.vendor, model: String(b.model),
        inputPer1m: b.inputPer1m, outputPer1m: b.outputPer1m, cacheReadPer1m: b.cacheReadPer1m,
        cacheCreationPer1m: b.cacheCreationPer1m, reasoningPer1m: b.reasoningPer1m,
        currency: b.currency, effectiveFrom: b.effectiveFrom,
      });
      reply.code(201);
      return rec;
    },
  );

  app.patch(
    "/api/orgs/:orgId/model-pricing/:id",
    { preHandler: requireAuth({ role: "admin" }) },
    async (req, reply) => {
      const { orgId, id } = req.params as { orgId: string; id: string };
      if (req.runContext!.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      const updated = await updateModelPricing(pool, orgId, id, req.body as any);
      if (!updated) return reply.code(404).send({ error: "Not found" });
      return updated;
    },
  );

  app.delete(
    "/api/orgs/:orgId/model-pricing/:id",
    { preHandler: requireAuth({ role: "admin" }) },
    async (req, reply) => {
      const { orgId, id } = req.params as { orgId: string; id: string };
      if (req.runContext!.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      const ok = await deleteModelPricing(pool, orgId, id);
      if (!ok) return reply.code(404).send({ error: "Not found" });
      reply.code(204);
      return null;
    },
  );
}
```

- [ ] **Step 2: Wire into the package's route registrar**

In `packages/coding-models/src/routes/index.ts`, import and call the new registrar alongside the existing ones:

```typescript
import { registerOrgModelPricingRoutes } from "./pricing.ts";

export async function registerCodingModelRoutes(app: FastifyInstance, pool: Pool) {
  await registerOrgCodingModelRoutes(app, pool);
  await registerPublicCodingModelRoutes(app, pool);
  await registerOrgModelPricingRoutes(app, pool);
}
```

(No change needed in `api-server/src/server-app.ts` — it already calls `registerCodingModelRoutes(app, c.pool)`.)

- [ ] **Step 3: Typecheck + boundaries**

Run: `npm run typecheck -w @journeyman/coding-models && npm run check:boundaries`
Expected: PASS.

- [ ] **Step 4: Smoke-test the route**

Restart the API server (`npm run start:api-server` — it does not hot-reload). Then:

Run: `curl -s -X POST "http://localhost:4000/api/orgs/$ORG_ID/model-pricing" -H "Content-Type: application/json" --cookie "$AUTH_COOKIE" -d '{"provider":"claude","model":"claude-opus-4-8","inputPer1m":15,"outputPer1m":75,"cacheReadPer1m":1.5,"cacheCreationPer1m":18.75}'`
Expected: `201` with a JSON body containing `"id":"mp_..."` and `"effectiveTo":null`.

- [ ] **Step 5: Commit**

```bash
git add packages/coding-models/src/routes/pricing.ts packages/coding-models/src/routes/index.ts
git commit -m "feat(coding-models): model-pricing CRUD routes"
```

---

### Task 5: Cost computation helper (orchestrator)

**Files:**
- Create: `packages/orchestrator/src/usage/model-pricing.ts`
- Test: `packages/orchestrator/src/usage/model-pricing.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/orchestrator/src/usage/model-pricing.test.ts
import { describe, it, expect } from "vitest";
import { computeCostUsd, type PriceRates } from "./model-pricing.ts";

const rates: PriceRates = {
  inputPer1m: 15, outputPer1m: 75, cacheReadPer1m: 1.5, cacheCreationPer1m: 18.75, reasoningPer1m: 75,
};

describe("computeCostUsd", () => {
  it("sums each token type at its per-1M rate", () => {
    // 1M input @15 + 1M output @75 = 90
    const cost = computeCostUsd(rates, { inputTokens: 1_000_000, outputTokens: 1_000_000 });
    expect(cost).toBeCloseTo(90, 6);
  });
  it("prices cache and reasoning tokens", () => {
    const cost = computeCostUsd(rates, { cacheReadTokens: 2_000_000, reasoningTokens: 1_000_000 });
    expect(cost).toBeCloseTo(3 + 75, 6);
  });
  it("treats null rates as zero", () => {
    const cost = computeCostUsd({ ...rates, inputPer1m: null }, { inputTokens: 1_000_000 });
    expect(cost).toBe(0);
  });
  it("returns null when no rate is set at all", () => {
    const cost = computeCostUsd(
      { inputPer1m: null, outputPer1m: null, cacheReadPer1m: null, cacheCreationPer1m: null, reasoningPer1m: null },
      { inputTokens: 1_000_000 },
    );
    expect(cost).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @journeyman/orchestrator -- model-pricing`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// packages/orchestrator/src/usage/model-pricing.ts
import type { Pool } from "pg";

export interface PriceRates {
  inputPer1m: number | null;
  outputPer1m: number | null;
  cacheReadPer1m: number | null;
  cacheCreationPer1m: number | null;
  reasoningPer1m: number | null;
}

export interface CostTokens {
  inputTokens?: number | null;
  outputTokens?: number | null;
  cacheReadTokens?: number | null;
  cacheCreationTokens?: number | null;
  reasoningTokens?: number | null;
}

/**
 * Dollar cost for one usage row. Returns null when the price row has no rates at all
 * (so the caller stores NULL = "unpriced"). A null individual rate counts as 0.
 */
export function computeCostUsd(rates: PriceRates, t: CostTokens): number | null {
  const allNull =
    rates.inputPer1m === null && rates.outputPer1m === null && rates.cacheReadPer1m === null &&
    rates.cacheCreationPer1m === null && rates.reasoningPer1m === null;
  if (allNull) return null;
  const per = (tokens: number | null | undefined, rate: number | null) =>
    ((tokens ?? 0) / 1_000_000) * (rate ?? 0);
  return (
    per(t.inputTokens, rates.inputPer1m) +
    per(t.outputTokens, rates.outputPer1m) +
    per(t.cacheReadTokens, rates.cacheReadPer1m) +
    per(t.cacheCreationTokens, rates.cacheCreationPer1m) +
    per(t.reasoningTokens, rates.reasoningPer1m)
  );
}

/**
 * The currently-active price (effective_to IS NULL) for (org, provider, model), or null.
 * Used at write time. Self-contained SQL — orchestrator owns its jm_* queries.
 */
export async function resolveActivePrice(
  pool: Pool, orgId: string | null, provider: string, model: string | null,
): Promise<PriceRates | null> {
  if (!orgId || !model) return null;
  const { rows } = await pool.query(
    `SELECT input_per_1m, output_per_1m, cache_read_per_1m, cache_creation_per_1m, reasoning_per_1m
     FROM jm_model_pricing
     WHERE org_id = $1 AND provider = $2 AND model = $3 AND effective_to IS NULL
     LIMIT 1`,
    [orgId, provider, model],
  );
  if (!rows[0]) return null;
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    inputPer1m: n(rows[0].input_per_1m), outputPer1m: n(rows[0].output_per_1m),
    cacheReadPer1m: n(rows[0].cache_read_per_1m), cacheCreationPer1m: n(rows[0].cache_creation_per_1m),
    reasoningPer1m: n(rows[0].reasoning_per_1m),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @journeyman/orchestrator -- model-pricing`
Expected: PASS (4 assertions).

- [ ] **Step 5: Commit**

```bash
git add packages/orchestrator/src/usage/model-pricing.ts packages/orchestrator/src/usage/model-pricing.test.ts
git commit -m "feat(orchestrator): cost computation + active-price lookup"
```

---

### Task 6: Populate `cost_usd` in `recordTokenUsage`

**Files:**
- Modify: `packages/orchestrator/src/usage/record-token-usage.ts`
- Modify: `packages/orchestrator/src/usage/record-token-usage.test.ts`

- [ ] **Step 1: Add a failing test for the cost param**

Append to `record-token-usage.test.ts`. The fake pool must now also answer the price-lookup SELECT; return a price row so cost is computed.

```typescript
it("looks up the active price and writes cost_usd into the INSERT", async () => {
  const calls: { sql: string; params: unknown[] }[] = [];
  const pool = {
    query: async (sql: string, params: unknown[]) => {
      calls.push({ sql, params });
      if (sql.includes("FROM jm_model_pricing")) {
        return { rows: [{ input_per_1m: 15, output_per_1m: 75, cache_read_per_1m: 1.5,
          cache_creation_per_1m: 18.75, reasoning_per_1m: 75 }] };
      }
      return { rowCount: 1, rows: [] };
    },
  } as any;
  await recordTokenUsage(pool, {
    ...base,
    usage: [{ provider: "claude", vendor: "anthropic", model: "claude-opus-4-8",
      inputTokens: 1_000_000, outputTokens: 1_000_000, totalTokens: 2_000_000 }],
  });
  const insert = calls.find((c) => c.sql.includes("INSERT INTO jm_token_usage"))!;
  expect(insert.sql).toContain("cost_usd");
  // 1M input @15 + 1M output @75 = 90
  expect(insert.params).toContain(90);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @journeyman/orchestrator -- record-token-usage`
Expected: FAIL — INSERT SQL lacks `cost_usd`; `90` not in params.

- [ ] **Step 3: Modify the INSERT and the loop**

In `record-token-usage.ts`:

(a) Add the import near the top:

```typescript
import { computeCostUsd, resolveActivePrice } from "./model-pricing.ts";
```

(b) Replace the `INSERT` constant — add `cost_usd` as the final column and `$26`:

```typescript
const INSERT = `
  INSERT INTO jm_token_usage (
    workspace_id, org_id, workflow_id, workflow_version_id, workflow_name,
    workflow_instance_id, node_id, step_type, step_name, attempt,
    agent_id, agent_name, triggered_by_user_id, provider, vendor, model, outcome,
    input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
    reasoning_tokens, total_tokens, usage_reported, raw_usage, cost_usd
  ) VALUES (
    $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26
  )
  ON CONFLICT (workflow_instance_id, node_id, attempt, provider, COALESCE(model, '')) DO NOTHING`;
```

(c) Inside the `for` loop, before `pool.query(INSERT, ...)`, resolve price and compute cost (best-effort — failures fall back to null so the row still records):

```typescript
    for (const { u, reported } of rows) {
      const model = u.model ?? args.requestedModel ?? null;
      let costUsd: number | null = null;
      try {
        const rates = await resolveActivePrice(pool, args.orgId, u.provider ?? args.provider, model);
        if (rates) {
          costUsd = computeCostUsd(rates, {
            inputTokens: u.inputTokens, outputTokens: u.outputTokens,
            cacheReadTokens: u.cacheReadTokens, cacheCreationTokens: u.cacheCreationTokens,
            reasoningTokens: u.reasoningTokens,
          });
        }
      } catch { /* unpriced — leave costUsd null */ }
      const res = await pool.query(INSERT, [
        args.workspaceId, args.orgId, args.workflowId, args.workflowVersionId, args.workflowName,
        args.workflowInstanceId, args.nodeId, args.stepType, args.stepName, args.attempt,
        args.agentId, args.agentName, args.triggeredByUserId, u.provider ?? args.provider,
        u.vendor ?? null, model, args.outcome,
        u.inputTokens ?? null, u.outputTokens ?? null, u.cacheReadTokens ?? null,
        u.cacheCreationTokens ?? null, u.reasoningTokens ?? null, u.totalTokens ?? null,
        reported, u.raw != null ? JSON.stringify(u.raw) : null, costUsd,
      ]);
      inserted += res.rowCount ?? 0;
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w @journeyman/orchestrator -- record-token-usage`
Expected: PASS — including the existing tests (the fake pool that returns `{ rowCount: 1 }` for all queries still works: `resolveActivePrice` sees no `rows` field → returns null → cost null → row still inserts).

> Note: the existing `fakePool()` helper returns `{ rowCount: 1 }` without a `rows` property. `resolveActivePrice` reads `rows[0]` on that — guard it: the helper's return has no `rows`, so `rows[0]` throws. Update `fakePool()` to return `{ rowCount: 1, rows: [] }` so the price lookup yields null. Make that one-line edit in the test file.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck -w @journeyman/orchestrator`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/orchestrator/src/usage/record-token-usage.ts packages/orchestrator/src/usage/record-token-usage.test.ts
git commit -m "feat(orchestrator): write cost_usd at token-usage record time"
```

---

### Task 7: Backfill script for existing history

**Files:**
- Create: `scripts/backfill-token-cost.mjs`

- [ ] **Step 1: Write the script**

A single effective-dated `UPDATE … FROM LATERAL` costs every NULL row against the price active at that row's `created_at`. Idempotent (only touches `cost_usd IS NULL`).

```javascript
#!/usr/bin/env node
// scripts/backfill-token-cost.mjs — one-time: fill jm_token_usage.cost_usd from jm_model_pricing.
// Effective-dated: each row is priced at the rate active when it ran. Re-runnable; only NULLs touched.
import { Pool } from "pg";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL not set"); process.exit(1); }
const pool = new Pool({ connectionString: url });

const SQL = `
  UPDATE jm_token_usage u SET cost_usd = (
      COALESCE(u.input_tokens,0)/1e6 * COALESCE(p.input_per_1m,0)
    + COALESCE(u.output_tokens,0)/1e6 * COALESCE(p.output_per_1m,0)
    + COALESCE(u.cache_read_tokens,0)/1e6 * COALESCE(p.cache_read_per_1m,0)
    + COALESCE(u.cache_creation_tokens,0)/1e6 * COALESCE(p.cache_creation_per_1m,0)
    + COALESCE(u.reasoning_tokens,0)/1e6 * COALESCE(p.reasoning_per_1m,0)
  )
  FROM LATERAL (
    SELECT * FROM jm_model_pricing mp
    WHERE mp.org_id = u.org_id AND mp.provider = u.provider AND mp.model = u.model
      AND mp.effective_from <= u.created_at
      AND (mp.effective_to IS NULL OR u.created_at < mp.effective_to)
    ORDER BY mp.effective_from DESC LIMIT 1
  ) p
  WHERE u.cost_usd IS NULL;`;

async function main() {
  const { rowCount } = await pool.query(SQL);
  console.log(`backfilled cost_usd on ${rowCount} rows`);
  await pool.end();
}
main().catch((err) => { console.error(err); process.exit(1); });
```

- [ ] **Step 2: Dry-check then run**

Run: `node scripts/backfill-token-cost.mjs`
Expected: prints `backfilled cost_usd on N rows` (N = count of previously-null rows that matched a price). Running it again prints `0`.

- [ ] **Step 3: Verify**

Run: `psql "$DATABASE_URL" -c "SELECT count(*) FILTER (WHERE cost_usd IS NOT NULL) AS priced, count(*) FILTER (WHERE cost_usd IS NULL) AS unpriced FROM jm_token_usage;"`
Expected: `priced` > 0 once at least one matching price exists; remaining `unpriced` are models with no price row (expected).

- [ ] **Step 4: Commit**

```bash
git add scripts/backfill-token-cost.mjs
git commit -m "feat(scripts): backfill jm_token_usage.cost_usd from pricing"
```

---

### Task 8: Pricing admin UI

**Files:**
- Create: `packages/web/src/api/modelPricing.ts`
- Modify: `packages/web/src/routes/AdminCodingModelsPage.tsx`

- [ ] **Step 1: Create the fetch client**

Mirrors `packages/web/src/api/codingModels.ts` (cookie auth, `jsonOrThrow`). Reuse that file's `jsonOrThrow` import path.

```typescript
// packages/web/src/api/modelPricing.ts
import type { ModelPricing, ModelPricingCreateInput, ModelPricingUpdateInput } from "@journeyman/core";

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error((await res.text()) || res.statusText);
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const modelPricingApi = {
  orgList: (orgId: string) =>
    fetch(`/api/orgs/${encodeURIComponent(orgId)}/model-pricing`, { credentials: "include" })
      .then(jsonOrThrow<ModelPricing[]>),
  orgCreate: (orgId: string, body: ModelPricingCreateInput) =>
    fetch(`/api/orgs/${encodeURIComponent(orgId)}/model-pricing`, {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    }).then(jsonOrThrow<ModelPricing>),
  orgUpdate: (orgId: string, id: string, body: ModelPricingUpdateInput) =>
    fetch(`/api/orgs/${encodeURIComponent(orgId)}/model-pricing/${id}`, {
      method: "PATCH", credentials: "include",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    }).then(jsonOrThrow<ModelPricing>),
  orgDelete: (orgId: string, id: string) =>
    fetch(`/api/orgs/${encodeURIComponent(orgId)}/model-pricing/${id}`, {
      method: "DELETE", credentials: "include",
    }).then(jsonOrThrow<void>),
};
```

- [ ] **Step 2: Add a pricing section to the admin page**

In `AdminCodingModelsPage.tsx`, below the existing coding-models table, add a "Model pricing" section following the same `useQuery` + `useMutation` + table + inline-form pattern already used on the page. Use the same `orgId` source the page already uses for `codingModelsApi.orgList(orgId)`.

```tsx
// near the other imports
import { modelPricingApi } from "../api/modelPricing.ts";
// (useQuery, useMutation, useQueryClient already imported on this page)

function ModelPricingSection({ orgId }: { orgId: string }) {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["model-pricing", orgId], queryFn: () => modelPricingApi.orgList(orgId) });
  const create = useMutation({
    mutationFn: (b: import("@journeyman/core").ModelPricingCreateInput) => modelPricingApi.orgCreate(orgId, b),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["model-pricing", orgId] }),
  });
  const del = useMutation({
    mutationFn: (id: string) => modelPricingApi.orgDelete(orgId, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["model-pricing", orgId] }),
  });

  const [form, setForm] = useState({ provider: "", model: "", inputPer1m: "", outputPer1m: "", cacheReadPer1m: "", cacheCreationPer1m: "", reasoningPer1m: "" });
  const num = (s: string) => (s.trim() === "" ? null : Number(s));
  const submit = () => create.mutate({
    provider: form.provider, model: form.model,
    inputPer1m: num(form.inputPer1m), outputPer1m: num(form.outputPer1m),
    cacheReadPer1m: num(form.cacheReadPer1m), cacheCreationPer1m: num(form.cacheCreationPer1m),
    reasoningPer1m: num(form.reasoningPer1m),
  });

  return (
    <section style={{ marginTop: 32 }}>
      <h2>Model pricing</h2>
      <p style={{ opacity: 0.7, fontSize: 13 }}>USD per 1M tokens. A new price for an existing model supersedes the previous one (effective from now); history keeps its old cost.</p>
      <table>
        <thead><tr><th>Provider</th><th>Model</th><th>Input</th><th>Output</th><th>Cache read</th><th>Cache write</th><th>Active</th><th></th></tr></thead>
        <tbody>
          {list.data?.map((p) => (
            <tr key={p.id}>
              <td>{p.provider}</td><td>{p.model}</td>
              <td>{p.inputPer1m ?? "—"}</td><td>{p.outputPer1m ?? "—"}</td>
              <td>{p.cacheReadPer1m ?? "—"}</td><td>{p.cacheCreationPer1m ?? "—"}</td>
              <td>{p.effectiveTo ? "no" : "yes"}</td>
              <td><button onClick={() => del.mutate(p.id)}>Delete</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        <input placeholder="provider" value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })} />
        <input placeholder="model" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} />
        <input placeholder="input/1M" value={form.inputPer1m} onChange={(e) => setForm({ ...form, inputPer1m: e.target.value })} />
        <input placeholder="output/1M" value={form.outputPer1m} onChange={(e) => setForm({ ...form, outputPer1m: e.target.value })} />
        <input placeholder="cacheRead/1M" value={form.cacheReadPer1m} onChange={(e) => setForm({ ...form, cacheReadPer1m: e.target.value })} />
        <input placeholder="cacheWrite/1M" value={form.cacheCreationPer1m} onChange={(e) => setForm({ ...form, cacheCreationPer1m: e.target.value })} />
        <button disabled={!form.provider || !form.model} onClick={submit}>Add price</button>
      </div>
    </section>
  );
}
```

Then render `<ModelPricingSection orgId={orgId} />` at the bottom of the page's returned JSX (using the page's existing `orgId`).

- [ ] **Step 3: Typecheck the web package**

Run: `npm run typecheck -w @journeyman/web`
Expected: PASS.

- [ ] **Step 4: Verify in the browser**

The Vite dev frontend hot-reloads. Open `/orgs/:orgId/coding-models` as an admin; confirm the "Model pricing" section lists rows, "Add price" creates one (appears with Active = yes), and Delete removes it.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/api/modelPricing.ts packages/web/src/routes/AdminCodingModelsPage.tsx
git commit -m "feat(web): model-pricing admin section"
```

---

## PHASE 2 — Analytics usage endpoints

### Task 9: Usage response types in core

**Files:**
- Modify: `packages/core/src/types/analytics.types.ts`

- [ ] **Step 1: Add the types**

Append to `analytics.types.ts` (it already exports `AnalyticsWindow`, `TokenStat`, etc.):

```typescript
export type UsageDimensionKey =
  | "model" | "provider" | "agent" | "workflow" | "workflow_version" | "step";

export interface UsageTotals {
  rows: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  costUsd: number | null;
  unpricedRows: number;
}

export interface UsageSummary extends UsageTotals {
  runs: number;
  costPerRun: number | null;
  cacheReadHitRatio: number;
  cacheSavingsUsd: number | null;
  /** Same totals for the immediately-preceding window, for deltas. */
  previous: UsageTotals & { runs: number };
}

export interface UsageTimeseriesPoint {
  day: string;
  costUsd: number | null;
  totalTokens: number;
}

export interface UsageBreakdownRow {
  key: string;
  label: string;
  costUsd: number | null;
  totalTokens: number;
  runs: number;
  costPerRun: number | null;
  cacheReadHitRatio: number;
  /** Earliest created_at in the group — used to order workflow versions chronologically. */
  firstSeen: string | null;
}

export interface UsageWaste {
  costUsd: number | null;
  totalTokens: number;
  rows: number;
  fractionOfTotalCost: number | null;
  topAgent: { agentId: string | null; agentName: string | null; costUsd: number | null } | null;
}

export interface UsageInstanceStep {
  nodeId: string;
  stepType: string;
  stepName: string | null;
  attempt: number;
  outcome: string;
  model: string | null;
  totalTokens: number;
  costUsd: number | null;
}

export interface UsageInstanceDetail {
  instanceId: string;
  costUsd: number | null;
  totalTokens: number;
  steps: UsageInstanceStep[];
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck -w @journeyman/core`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/types/analytics.types.ts
git commit -m "feat(core): usage dashboard response types"
```

---

### Task 10: Analytics usage DB layer

**Files:**
- Create: `packages/analytics/src/db/usage.ts`
- Test: `packages/analytics/src/db/usage.test.ts`

These functions follow the existing `db/tokens.ts` signature `(pool: Pool, wsId: string, since: Date) => Promise<T>`. The DB-touching SQL is verified by the route smoke test in Task 11; the **pure** derivation (cache savings, $/run) and the dimension whitelist are unit-tested here.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/analytics/src/db/usage.test.ts
import { describe, it, expect } from "vitest";
import { DIMENSION_SQL, costPerRun, cacheReadHitRatio } from "./usage.ts";

describe("DIMENSION_SQL whitelist", () => {
  it("maps known dimensions and omits unknown ones", () => {
    expect(DIMENSION_SQL.model).toBe("provider, model");
    expect(DIMENSION_SQL.agent).toContain("agent_id");
    expect((DIMENSION_SQL as Record<string, string>).bogus).toBeUndefined();
  });
});

describe("derivations", () => {
  it("costPerRun divides cost by runs, null when no runs or no cost", () => {
    expect(costPerRun(100, 50)).toBe(2);
    expect(costPerRun(null, 50)).toBeNull();
    expect(costPerRun(100, 0)).toBeNull();
  });
  it("cacheReadHitRatio = cacheRead / (cacheRead + input)", () => {
    expect(cacheReadHitRatio(75, 25)).toBeCloseTo(0.75, 6);
    expect(cacheReadHitRatio(0, 0)).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @journeyman/analytics -- usage`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// packages/analytics/src/db/usage.ts
import type { Pool } from "pg";
import type {
  UsageSummary, UsageTotals, UsageTimeseriesPoint, UsageBreakdownRow,
  UsageWaste, UsageInstanceDetail, UsageDimensionKey,
} from "@journeyman/core";

/** GROUP BY expression per dashboard dimension. Whitelisted — never interpolate caller input. */
export const DIMENSION_SQL: Record<UsageDimensionKey, string> = {
  model: "provider, model",
  provider: "provider",
  agent: "agent_id, agent_name",
  workflow: "workflow_id, workflow_name",
  workflow_version: "workflow_version_id",
  step: "step_type",
};

export function costPerRun(cost: number | null, runs: number): number | null {
  if (cost === null || runs <= 0) return null;
  return cost / runs;
}

export function cacheReadHitRatio(cacheRead: number, input: number): number {
  const denom = cacheRead + input;
  return denom <= 0 ? 0 : cacheRead / denom;
}

const TOTALS_COLS = `
  COUNT(*)::int AS rows,
  COUNT(DISTINCT workflow_instance_id)::int AS runs,
  COALESCE(SUM(input_tokens),0)::bigint AS input_tokens,
  COALESCE(SUM(output_tokens),0)::bigint AS output_tokens,
  COALESCE(SUM(cache_read_tokens),0)::bigint AS cache_read_tokens,
  COALESCE(SUM(cache_creation_tokens),0)::bigint AS cache_creation_tokens,
  COALESCE(SUM(reasoning_tokens),0)::bigint AS reasoning_tokens,
  COALESCE(SUM(total_tokens),0)::bigint AS total_tokens,
  SUM(cost_usd) AS cost_usd,
  COUNT(*) FILTER (WHERE cost_usd IS NULL)::int AS unpriced_rows`;

function rowToTotals(r: any): UsageTotals & { runs: number } {
  return {
    rows: Number(r.rows), runs: Number(r.runs),
    inputTokens: Number(r.input_tokens), outputTokens: Number(r.output_tokens),
    cacheReadTokens: Number(r.cache_read_tokens), cacheCreationTokens: Number(r.cache_creation_tokens),
    reasoningTokens: Number(r.reasoning_tokens), totalTokens: Number(r.total_tokens),
    costUsd: r.cost_usd === null ? null : Number(r.cost_usd),
    unpricedRows: Number(r.unpriced_rows),
  };
}

async function totalsBetween(pool: Pool, wsId: string, from: Date, to: Date) {
  const { rows } = await pool.query(
    `SELECT ${TOTALS_COLS} FROM jm_token_usage
     WHERE workspace_id = $1 AND created_at >= $2 AND created_at < $3`,
    [wsId, from, to],
  );
  return rowToTotals(rows[0]);
}

export async function usageSummary(
  pool: Pool, wsId: string, since: Date, now: Date,
): Promise<UsageSummary> {
  const cur = await totalsBetween(pool, wsId, since, now);
  const prevSpan = now.getTime() - since.getTime();
  const prevFrom = new Date(since.getTime() - prevSpan);
  const prev = await totalsBetween(pool, wsId, prevFrom, since);
  return {
    ...cur,
    costPerRun: costPerRun(cur.costUsd, cur.runs),
    cacheReadHitRatio: cacheReadHitRatio(cur.cacheReadTokens, cur.inputTokens),
    // Dollar savings need a per-model input-vs-cache-read rate spread (lost after aggregation).
    // v1 reports cacheReadHitRatio instead; see the note below. Kept null so the field stays present.
    cacheSavingsUsd: null,
    previous: prev,
  };
}

export async function usageTimeseries(
  pool: Pool, wsId: string, since: Date,
): Promise<UsageTimeseriesPoint[]> {
  const { rows } = await pool.query(
    `SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day,
            SUM(cost_usd) AS cost_usd,
            COALESCE(SUM(total_tokens),0)::bigint AS total_tokens
     FROM jm_token_usage
     WHERE workspace_id = $1 AND created_at >= $2
     GROUP BY 1 ORDER BY 1`,
    [wsId, since],
  );
  return rows.map((r) => ({
    day: r.day, costUsd: r.cost_usd === null ? null : Number(r.cost_usd),
    totalTokens: Number(r.total_tokens),
  }));
}

export async function usageByDimension(
  pool: Pool, wsId: string, since: Date, dimension: UsageDimensionKey,
): Promise<UsageBreakdownRow[]> {
  const group = DIMENSION_SQL[dimension];
  if (!group) throw new Error(`unknown dimension: ${dimension}`);
  const { rows } = await pool.query(
    `SELECT ${group} AS gk,
            COUNT(DISTINCT workflow_instance_id)::int AS runs,
            COALESCE(SUM(input_tokens),0)::bigint AS input_tokens,
            COALESCE(SUM(cache_read_tokens),0)::bigint AS cache_read_tokens,
            COALESCE(SUM(total_tokens),0)::bigint AS total_tokens,
            SUM(cost_usd) AS cost_usd,
            MIN(created_at) AS first_seen
     FROM jm_token_usage
     WHERE workspace_id = $1 AND created_at >= $2
     GROUP BY ${group} ORDER BY cost_usd DESC NULLS LAST, total_tokens DESC`,
    [wsId, since],
  );
  return rows.map((r) => {
    const cost = r.cost_usd === null ? null : Number(r.cost_usd);
    const runs = Number(r.runs);
    return {
      key: String(r.gk ?? "—"),
      label: String(r.gk ?? "—"),
      costUsd: cost, totalTokens: Number(r.total_tokens), runs,
      costPerRun: costPerRun(cost, runs),
      cacheReadHitRatio: cacheReadHitRatio(Number(r.cache_read_tokens), Number(r.input_tokens)),
      firstSeen: r.first_seen ? new Date(r.first_seen).toISOString() : null,
    };
  });
}

export async function usageWaste(pool: Pool, wsId: string, since: Date): Promise<UsageWaste> {
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(total_tokens),0)::bigint AS total_tokens,
            COUNT(*)::int AS rows, SUM(cost_usd) AS cost_usd
     FROM jm_token_usage
     WHERE workspace_id = $1 AND created_at >= $2 AND (outcome <> 'success' OR attempt > 1)`,
    [wsId, since],
  );
  const totalCostRow = await pool.query(
    `SELECT SUM(cost_usd) AS cost_usd FROM jm_token_usage WHERE workspace_id = $1 AND created_at >= $2`,
    [wsId, since],
  );
  const topAgentRow = await pool.query(
    `SELECT agent_id, agent_name, SUM(cost_usd) AS cost_usd
     FROM jm_token_usage
     WHERE workspace_id = $1 AND created_at >= $2 AND (outcome <> 'success' OR attempt > 1)
     GROUP BY agent_id, agent_name ORDER BY cost_usd DESC NULLS LAST LIMIT 1`,
    [wsId, since],
  );
  const wasteCost = rows[0].cost_usd === null ? null : Number(rows[0].cost_usd);
  const totalCost = totalCostRow.rows[0].cost_usd === null ? null : Number(totalCostRow.rows[0].cost_usd);
  const ta = topAgentRow.rows[0];
  return {
    costUsd: wasteCost, totalTokens: Number(rows[0].total_tokens), rows: Number(rows[0].rows),
    fractionOfTotalCost: wasteCost !== null && totalCost && totalCost > 0 ? wasteCost / totalCost : null,
    topAgent: ta ? { agentId: ta.agent_id ?? null, agentName: ta.agent_name ?? null,
      costUsd: ta.cost_usd === null ? null : Number(ta.cost_usd) } : null,
  };
}

export async function usageInstance(
  pool: Pool, wsId: string, instanceId: string,
): Promise<UsageInstanceDetail> {
  const { rows } = await pool.query(
    `SELECT node_id, step_type, step_name, attempt, outcome, model,
            COALESCE(SUM(total_tokens),0)::bigint AS total_tokens, SUM(cost_usd) AS cost_usd
     FROM jm_token_usage
     WHERE workspace_id = $1 AND workflow_instance_id = $2
     GROUP BY node_id, step_type, step_name, attempt, outcome, model
     ORDER BY cost_usd DESC NULLS LAST`,
    [wsId, instanceId],
  );
  const steps = rows.map((r) => ({
    nodeId: r.node_id, stepType: r.step_type, stepName: r.step_name ?? null,
    attempt: Number(r.attempt), outcome: r.outcome, model: r.model ?? null,
    totalTokens: Number(r.total_tokens), costUsd: r.cost_usd === null ? null : Number(r.cost_usd),
  }));
  const costUsd = steps.some((s) => s.costUsd !== null)
    ? steps.reduce((a, s) => a + (s.costUsd ?? 0), 0) : null;
  return {
    instanceId, costUsd,
    totalTokens: steps.reduce((a, s) => a + s.totalTokens, 0), steps,
  };
}
```

> Note on cache savings: computing dollar savings needs the per-model input-vs-cache-read rate spread, which the aggregate has flattened across models. For v1 the summary returns `cacheSavingsUsd: null` and the dashboard shows the **cache-read hit ratio** (a clear, honest optimization signal) instead of a synthesized dollar figure. A future task can compute savings per-model before aggregating. The spec's "cache savings" KPI renders as the hit-ratio percentage until then.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @journeyman/analytics -- usage`
Expected: PASS (4 assertions).

- [ ] **Step 5: Commit**

```bash
git add packages/analytics/src/db/usage.ts packages/analytics/src/db/usage.test.ts
git commit -m "feat(analytics): usage aggregate DB layer"
```

---

### Task 11: Analytics usage routes

**Files:**
- Create: `packages/analytics/src/routes/usage.ts`
- Modify: `packages/analytics/src/routes/index.ts`

- [ ] **Step 1: Implement the routes**

Mirrors the existing analytics route file: `/api/analytics/workspaces/:wsId/` prefix, `requireAuth()` + `requirePerm("resource.read")`, `parseWindow()` and `windowSince()` helpers. Import those from wherever the existing routes import them (e.g. `../window.ts`); reuse the exact import the `overview` route uses.

```typescript
// packages/analytics/src/routes/usage.ts
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { makeRequireAuth, makeRequireWorkspacePermission } from "@journeyman/identity";
import type { UsageDimensionKey } from "@journeyman/core";
import { parseWindow, windowSince } from "../window.ts";
import {
  usageSummary, usageTimeseries, usageByDimension, usageWaste, usageInstance, DIMENSION_SQL,
} from "../db/usage.ts";

export function registerUsageRoutes(app: FastifyInstance, pool: Pool): void {
  const requireAuth = makeRequireAuth({ pool });
  const requirePerm = makeRequireWorkspacePermission({ pool });
  const read = { preHandler: [requireAuth(), requirePerm("resource.read")] };
  const base = "/api/analytics/workspaces/:wsId/usage";

  app.get(`${base}/summary`, read, async (req) => {
    const { wsId } = req.params as { wsId: string };
    const window = parseWindow((req.query as any).window);
    const now = new Date();
    return usageSummary(pool, wsId, windowSince(window, now), now);
  });

  app.get(`${base}/timeseries`, read, async (req) => {
    const { wsId } = req.params as { wsId: string };
    const window = parseWindow((req.query as any).window);
    return usageTimeseries(pool, wsId, windowSince(window, new Date()));
  });

  app.get(`${base}/by/:dimension`, read, async (req, reply) => {
    const { wsId, dimension } = req.params as { wsId: string; dimension: string };
    if (!(dimension in DIMENSION_SQL)) {
      return reply.code(400).send({ error: `unknown dimension '${dimension}'` });
    }
    const window = parseWindow((req.query as any).window);
    return usageByDimension(pool, wsId, windowSince(window, new Date()), dimension as UsageDimensionKey);
  });

  app.get(`${base}/waste`, read, async (req) => {
    const { wsId } = req.params as { wsId: string };
    const window = parseWindow((req.query as any).window);
    return usageWaste(pool, wsId, windowSince(window, new Date()));
  });

  app.get(`${base}/instances/:instanceId`, read, async (req) => {
    const { wsId, instanceId } = req.params as { wsId: string; instanceId: string };
    return usageInstance(pool, wsId, instanceId);
  });
}
```

> If the existing analytics routes parse the window inline rather than via `../window.ts`, copy whatever helper they use (the explore confirmed a `parseWindow()` returning `"24h" | "7d" | "30d"` and a since-date helper exist). Match the existing file's import exactly.

- [ ] **Step 2: Register in the routes index**

In `packages/analytics/src/routes/index.ts`, import and call `registerUsageRoutes(app, pool)` next to the existing `live`/`overview` registrations (same `(app, pool)` signature they use).

- [ ] **Step 3: Typecheck + boundaries**

Run: `npm run typecheck -w @journeyman/analytics && npm run check:boundaries`
Expected: PASS.

- [ ] **Step 4: Smoke-test each endpoint**

Start the analytics service (it loads `.env` via `findEnvFile`; ensure `JWT_SECRET` resolves). With a valid session cookie and a workspace that has token-usage rows:

Run: `curl -s "http://localhost:4002/api/analytics/workspaces/$WS_ID/usage/summary?window=30d" --cookie "$AUTH_COOKIE" | head -c 400`
Expected: JSON with `totalTokens`, `costUsd`, `runs`, `unpricedRows`, `previous`.

Run: `curl -s "http://localhost:4002/api/analytics/workspaces/$WS_ID/usage/by/model?window=30d" --cookie "$AUTH_COOKIE" | head -c 400`
Expected: JSON array of `{ key, label, costUsd, totalTokens, runs, costPerRun, cacheReadHitRatio }`.

Run: `curl -s "http://localhost:4002/api/analytics/workspaces/$WS_ID/usage/by/bogus?window=30d" --cookie "$AUTH_COOKIE"`
Expected: `400` `{"error":"unknown dimension 'bogus'"}`.

- [ ] **Step 5: Commit**

```bash
git add packages/analytics/src/routes/usage.ts packages/analytics/src/routes/index.ts
git commit -m "feat(analytics): /usage summary/timeseries/by/waste/instance routes"
```

---

## PHASE 3 — Frontend dashboard

### Task 12: Scaffold `@journeyman/usage-dashboard`

**Files:**
- Create: `packages/usage-dashboard/package.json`
- Create: `packages/usage-dashboard/tsconfig.json`
- Create: `packages/usage-dashboard/src/format.ts`
- Test: `packages/usage-dashboard/src/format.test.ts`

- [ ] **Step 1: package.json** (copy of workspace-dashboard's, renamed)

```json
{
  "name": "@journeyman/usage-dashboard",
  "version": "0.1.0",
  "description": "Workspace usage & cost dashboard page.",
  "type": "module",
  "main": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "files": ["src"],
  "scripts": { "typecheck": "tsc --noEmit", "test": "vitest run" },
  "peerDependencies": { "react": "^19.2.7", "react-dom": "^19.2.7" },
  "dependencies": { "@journeyman/core": "*" },
  "devDependencies": {
    "@types/react": "^19.2.17", "@types/react-dom": "^19.2.3",
    "react": "^19.2.7", "react-dom": "^19.2.7",
    "typescript": "^6.0.3", "vitest": "^4.1.8"
  }
}
```

- [ ] **Step 2: tsconfig.json** (exact copy of `packages/workspace-dashboard/tsconfig.json`)

```json
{
  "compilerOptions": {
    "target": "ES2022", "module": "NodeNext", "moduleResolution": "NodeNext",
    "lib": ["ES2022", "DOM", "DOM.Iterable"], "jsx": "react-jsx", "strict": true,
    "noEmit": true, "esModuleInterop": true, "skipLibCheck": true,
    "allowImportingTsExtensions": true, "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"], "exclude": ["node_modules"]
}
```

- [ ] **Step 3: Write the failing format test**

```typescript
// packages/usage-dashboard/src/format.test.ts
import { describe, it, expect } from "vitest";
import { formatUsd, formatTokens, pctDelta } from "./format.ts";

describe("formatUsd", () => {
  it("formats dollars to 2dp", () => expect(formatUsd(1284.5)).toBe("$1,284.50"));
  it("shows an em dash for null", () => expect(formatUsd(null)).toBe("—"));
});
describe("formatTokens", () => {
  it("abbreviates millions", () => expect(formatTokens(847_200_000)).toBe("847.2M"));
  it("abbreviates thousands", () => expect(formatTokens(12_300)).toBe("12.3K"));
});
describe("pctDelta", () => {
  it("computes percent change", () => expect(pctDelta(112, 100)).toBe(12));
  it("returns null when previous is 0", () => expect(pctDelta(5, 0)).toBeNull());
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npm test -w @journeyman/usage-dashboard -- format`
Expected: FAIL — module not found.

- [ ] **Step 5: Implement format.ts**

```typescript
// packages/usage-dashboard/src/format.ts
export function formatUsd(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  return v.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

/** Percent change from prev → cur, rounded to an integer; null when prev is 0. */
export function pctDelta(cur: number, prev: number): number | null {
  if (prev === 0) return null;
  return Math.round(((cur - prev) / prev) * 100);
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm test -w @journeyman/usage-dashboard -- format`
Expected: PASS.

- [ ] **Step 7: Install workspace links + commit**

```bash
npm install
git add packages/usage-dashboard/package.json packages/usage-dashboard/tsconfig.json packages/usage-dashboard/src/format.ts packages/usage-dashboard/src/format.test.ts package-lock.json
git commit -m "feat(usage-dashboard): scaffold package + format helpers"
```

---

### Task 13: Chart widgets + version-regression helper

**Files:**
- Create: `packages/usage-dashboard/src/widgets.tsx`
- Create: `packages/usage-dashboard/src/regression.ts`
- Test: `packages/usage-dashboard/src/regression.test.ts`

- [ ] **Step 1: Copy the chart primitives**

Create `widgets.tsx` by copying `packages/workspace-dashboard/src/widgets.tsx` verbatim (the `COLORS`, `Card`, `Bars`, `HBars`, `Donut`, `Sparkline` components). This keeps the visual language identical and the hardcoded palette consistent (the dashboard intentionally does not use `@journeyman/theme`).

- [ ] **Step 2: Write the failing regression test**

```typescript
// packages/usage-dashboard/src/regression.test.ts
import { describe, it, expect } from "vitest";
import { detectVersionRegression } from "./regression.ts";

describe("detectVersionRegression", () => {
  it("flags the latest version when its $/run jumps over the threshold", () => {
    const r = detectVersionRegression([
      { label: "v3", costPerRun: 1.0 }, { label: "v4", costPerRun: 1.1 }, { label: "v5", costPerRun: 1.85 },
    ], 0.25);
    expect(r).toEqual({ regressed: true, latest: "v5", prior: "v4", increasePct: 68 });
  });
  it("does not flag a modest change", () => {
    const r = detectVersionRegression([{ label: "v4", costPerRun: 1.0 }, { label: "v5", costPerRun: 1.1 }], 0.25);
    expect(r.regressed).toBe(false);
  });
  it("returns regressed=false with fewer than two priced versions", () => {
    expect(detectVersionRegression([{ label: "v5", costPerRun: 1.0 }], 0.25).regressed).toBe(false);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -w @journeyman/usage-dashboard -- regression`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement regression.ts**

```typescript
// packages/usage-dashboard/src/regression.ts
export interface VersionCost { label: string; costPerRun: number | null }
export interface RegressionResult {
  regressed: boolean; latest: string | null; prior: string | null; increasePct: number | null;
}

/** Flags when the most recent version's $/run exceeds the prior version's by `threshold` (fraction). */
export function detectVersionRegression(
  versions: VersionCost[], threshold: number,
): RegressionResult {
  const priced = versions.filter((v) => v.costPerRun !== null) as { label: string; costPerRun: number }[];
  if (priced.length < 2) return { regressed: false, latest: priced.at(-1)?.label ?? null, prior: null, increasePct: null };
  const latest = priced[priced.length - 1];
  const prior = priced[priced.length - 2];
  if (prior.costPerRun <= 0) return { regressed: false, latest: latest.label, prior: prior.label, increasePct: null };
  const inc = (latest.costPerRun - prior.costPerRun) / prior.costPerRun;
  return {
    regressed: inc > threshold, latest: latest.label, prior: prior.label, increasePct: Math.round(inc * 100),
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -w @journeyman/usage-dashboard -- regression`
Expected: PASS (3 assertions).

- [ ] **Step 6: Commit**

```bash
git add packages/usage-dashboard/src/widgets.tsx packages/usage-dashboard/src/regression.ts packages/usage-dashboard/src/regression.test.ts
git commit -m "feat(usage-dashboard): chart widgets + version-regression helper"
```

---

### Task 14: `UsageDashboard` component

**Files:**
- Create: `packages/usage-dashboard/src/UsageDashboard.tsx`
- Create: `packages/usage-dashboard/src/index.ts`

- [ ] **Step 1: Implement the component**

Data-driven like `workspace-dashboard`'s `Dashboard` — it takes already-fetched data + a window controller and renders the sections. Drill-in is signalled via `onSelectInstance`.

```tsx
// packages/usage-dashboard/src/UsageDashboard.tsx
import type {
  AnalyticsWindow, UsageSummary, UsageTimeseriesPoint, UsageBreakdownRow,
  UsageWaste, UsageInstanceDetail, UsageDimensionKey,
} from "@journeyman/core";
import { Card, Bars, HBars, COLORS } from "./widgets.tsx";
import { formatUsd, formatTokens, pctDelta } from "./format.ts";
import { detectVersionRegression } from "./regression.ts";

export interface UsageDashboardProps {
  window: AnalyticsWindow;
  onWindowChange: (w: AnalyticsWindow) => void;
  groupBy: UsageDimensionKey;
  onGroupByChange: (d: UsageDimensionKey) => void;
  summary: UsageSummary | null;
  timeseries: UsageTimeseriesPoint[];
  breakdown: UsageBreakdownRow[];
  waste: UsageWaste | null;
  instance: UsageInstanceDetail | null;
  onSelectInstance?: (id: string) => void;
  workspaceName?: string;
  loading?: boolean;
}

const WINDOWS: AnalyticsWindow[] = ["30d", "7d", "24h"];
const GROUPS: UsageDimensionKey[] = ["model", "agent", "workflow", "workflow_version", "step"];

export function UsageDashboard(p: UsageDashboardProps) {
  const s = p.summary;
  const costDelta = s ? pctDelta(s.costUsd ?? 0, s.previous.costUsd ?? 0) : null;
  const maxCost = Math.max(1, ...p.breakdown.map((b) => b.costUsd ?? 0));

  // Version regression: when grouping by workflow_version, order versions chronologically
  // (by first appearance) and flag when the newest version's $/run jumped >25% over the prior one.
  const regression = p.groupBy === "workflow_version"
    ? detectVersionRegression(
        [...p.breakdown]
          .sort((a, b) => (a.firstSeen ?? "").localeCompare(b.firstSeen ?? ""))
          .map((b) => ({ label: b.label, costPerRun: b.costPerRun })),
        0.25,
      )
    : null;

  return (
    <div style={{ fontSize: 14 }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0 }}>Usage &amp; cost</h2>
          <div style={{ opacity: 0.6, fontSize: 13 }}>workspace · {p.workspaceName ?? "—"}</div>
        </div>
        {/* Segmented pill range toggle (Option A from the spec) */}
        <div style={{ display: "inline-flex", border: "1px solid rgba(127,127,127,.25)", borderRadius: 8, padding: 2 }}>
          {WINDOWS.map((w) => (
            <button key={w} onClick={() => p.onWindowChange(w)}
              style={{ border: "none", borderRadius: 6, padding: "5px 12px", cursor: "pointer",
                background: w === p.window ? COLORS.BLUE : "transparent",
                color: w === p.window ? "#031227" : "inherit" }}>{w}</button>
          ))}
        </div>
      </header>

      {/* Group-by pill row */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
        <span style={{ fontSize: 12, opacity: 0.6 }}>Group by</span>
        {GROUPS.map((g) => (
          <button key={g} onClick={() => p.onGroupByChange(g)}
            style={{ border: "1px solid rgba(127,127,127,.25)", borderRadius: 999, padding: "4px 12px",
              cursor: "pointer", fontSize: 12,
              background: g === p.groupBy ? COLORS.BLUE : "transparent",
              color: g === p.groupBy ? "#031227" : "inherit" }}>{g}</button>
        ))}
      </div>

      {s && s.unpricedRows > 0 && (
        <div style={{ fontSize: 12, background: "rgba(255,194,75,.12)", borderRadius: 8, padding: "8px 12px", marginBottom: 16 }}>
          {s.unpricedRows} usage rows are unpriced (no matching model price). Set pricing in admin → coding models.
        </div>
      )}

      {/* KPI row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 20 }}>
        <Kpi label="Total cost" value={formatUsd(s?.costUsd ?? null)}
          sub={costDelta === null ? undefined : `${costDelta >= 0 ? "+" : ""}${costDelta}% vs prev`} />
        <Kpi label="Total tokens" value={s ? formatTokens(s.totalTokens) : "—"} />
        <Kpi label="Avg cost / run" value={formatUsd(s?.costPerRun ?? null)} sub={s ? `${s.runs} runs` : undefined} />
        <Kpi label="Cache hit ratio" value={s ? `${Math.round(s.cacheReadHitRatio * 100)}%` : "—"} />
      </div>

      <Card title="Cost over time" cap="daily · USD">
        <Bars bars={p.timeseries.map((t) => ({ label: t.day, value: t.costUsd ?? 0 }))} />
      </Card>

      <div style={{ marginTop: 16 }}>
        <Card title={`Cost by ${p.groupBy}`}>
          <HBars rows={p.breakdown.map((b) => ({
            label: b.label, frac: (b.costUsd ?? 0) / maxCost, valueText: formatUsd(b.costUsd),
            title: `${b.label} · ${formatUsd(b.costUsd)} · ${b.runs} runs`,
          }))} />
        </Card>
      </div>

      {regression?.regressed && (
        <div style={{ marginTop: 16, background: "rgba(255,106,106,.12)", borderRadius: 8, padding: "12px 16px", fontSize: 13 }}>
          Version regression — {regression.latest} costs {regression.increasePct}% more per run than {regression.prior}.
        </div>
      )}

      {p.waste && p.waste.costUsd !== null && (
        <div style={{ marginTop: 16, background: "rgba(255,106,106,.12)", borderRadius: 8, padding: "12px 16px", fontSize: 13 }}>
          Wasted spend — {formatUsd(p.waste.costUsd)} on failed / retried runs
          {p.waste.fractionOfTotalCost !== null && ` (${Math.round(p.waste.fractionOfTotalCost * 100)}% of total)`}.
          {p.waste.topAgent?.agentName && ` ${p.waste.topAgent.agentName} accounts for ${formatUsd(p.waste.topAgent.costUsd)}.`}
        </div>
      )}

      {p.onSelectInstance && (
        <div style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
          <span style={{ opacity: 0.6 }}>Drill into a run</span>
          <input placeholder="workflow instance id"
            onKeyDown={(e) => {
              if (e.key === "Enter") p.onSelectInstance!((e.target as HTMLInputElement).value.trim());
            }}
            style={{ flex: "0 1 320px" }} />
        </div>
      )}

      {p.instance && (
        <div style={{ marginTop: 16 }}>
          <Card title={`Run drill-in — ${p.instance.instanceId.slice(0, 8)}`} cap={`${formatUsd(p.instance.costUsd)} · ${formatTokens(p.instance.totalTokens)} tokens`}>
            {p.instance.steps.map((st) => (
              <div key={`${st.nodeId}-${st.attempt}`} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 13, borderBottom: "1px solid rgba(127,127,127,.12)" }}>
                <span>{st.stepType}{st.stepName ? ` · ${st.stepName}` : ""}{st.attempt > 1 ? ` · attempt ${st.attempt}` : ""}</span>
                <span style={{ opacity: 0.6 }}>{formatTokens(st.totalTokens)}</span>
                <span>{formatUsd(st.costUsd)}</span>
              </div>
            ))}
          </Card>
        </div>
      )}
    </div>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{ background: "rgba(127,127,127,.05)", borderRadius: 8, padding: 14 }}>
      <div style={{ fontSize: 13, opacity: 0.6 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 500 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, opacity: 0.6 }}>{sub}</div>}
    </div>
  );
}
```

> If `workspace-dashboard/src/widgets.tsx` already exports a `Kpi`, import it instead of redefining; otherwise this local `Kpi` is fine.

- [ ] **Step 2: Create the barrel export**

```typescript
// packages/usage-dashboard/src/index.ts
export { UsageDashboard } from "./UsageDashboard.tsx";
export type { UsageDashboardProps } from "./UsageDashboard.tsx";
export { formatUsd, formatTokens, pctDelta } from "./format.ts";
export { detectVersionRegression } from "./regression.ts";
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck -w @journeyman/usage-dashboard`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/usage-dashboard/src/UsageDashboard.tsx packages/usage-dashboard/src/index.ts
git commit -m "feat(usage-dashboard): UsageDashboard component"
```

---

### Task 15: Web API client + page wrapper

**Files:**
- Create: `packages/web/src/api/usage.ts`
- Create: `packages/web/src/routes/UsageDashboardPage.tsx`

- [ ] **Step 1: Create the fetch wrappers**

Mirrors `packages/web/src/api/analytics.ts` (uses the shared `api<T>` client → cookie auth, 401 refresh, Vite proxy routes `/api/analytics/*` to port 4002).

```typescript
// packages/web/src/api/usage.ts
import { api } from "./client.ts";
import type {
  AnalyticsWindow, UsageSummary, UsageTimeseriesPoint, UsageBreakdownRow,
  UsageWaste, UsageInstanceDetail, UsageDimensionKey,
} from "@journeyman/core";

const wsBase = (wsId: string) => `/api/analytics/workspaces/${encodeURIComponent(wsId)}/usage`;

export const getUsageSummary = (wsId: string, w: AnalyticsWindow) =>
  api<UsageSummary>(`${wsBase(wsId)}/summary?window=${w}`);
export const getUsageTimeseries = (wsId: string, w: AnalyticsWindow) =>
  api<UsageTimeseriesPoint[]>(`${wsBase(wsId)}/timeseries?window=${w}`);
export const getUsageBreakdown = (wsId: string, w: AnalyticsWindow, d: UsageDimensionKey) =>
  api<UsageBreakdownRow[]>(`${wsBase(wsId)}/by/${d}?window=${w}`);
export const getUsageWaste = (wsId: string, w: AnalyticsWindow) =>
  api<UsageWaste>(`${wsBase(wsId)}/waste?window=${w}`);
export const getUsageInstance = (wsId: string, instanceId: string) =>
  api<UsageInstanceDetail>(`${wsBase(wsId)}/instances/${encodeURIComponent(instanceId)}`);
```

- [ ] **Step 2: Create the page wrapper**

Mirrors `packages/web/src/routes/DashboardPage.tsx` (react-query + `useParams` + `useWorkspace`).

```tsx
// packages/web/src/routes/UsageDashboardPage.tsx
import { useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { AnalyticsWindow, UsageDimensionKey } from "@journeyman/core";
import { UsageDashboard } from "@journeyman/usage-dashboard";
import { useWorkspace } from "../workspace/useWorkspace.ts";
import {
  getUsageSummary, getUsageTimeseries, getUsageBreakdown, getUsageWaste, getUsageInstance,
} from "../api/usage.ts";

export function UsageDashboardPage() {
  const { wsId = "" } = useParams<{ wsId: string }>();
  const { activeWorkspace } = useWorkspace();
  const [window, setWindow] = useState<AnalyticsWindow>("30d");
  const [groupBy, setGroupBy] = useState<UsageDimensionKey>("model");
  const [instanceId, setInstanceId] = useState<string | null>(null);

  const en = { enabled: !!wsId };
  const summary = useQuery({ queryKey: ["usage-summary", wsId, window], queryFn: () => getUsageSummary(wsId, window), ...en });
  const timeseries = useQuery({ queryKey: ["usage-ts", wsId, window], queryFn: () => getUsageTimeseries(wsId, window), ...en });
  const breakdown = useQuery({ queryKey: ["usage-by", wsId, window, groupBy], queryFn: () => getUsageBreakdown(wsId, window, groupBy), ...en });
  const waste = useQuery({ queryKey: ["usage-waste", wsId, window], queryFn: () => getUsageWaste(wsId, window), ...en });
  const instance = useQuery({
    queryKey: ["usage-instance", wsId, instanceId],
    queryFn: () => getUsageInstance(wsId, instanceId!),
    enabled: !!wsId && !!instanceId,
  });

  return (
    <div className="h-full overflow-y-auto">
      <div style={{ padding: 20 }}>
        <UsageDashboard
          window={window} onWindowChange={setWindow}
          groupBy={groupBy} onGroupByChange={setGroupBy}
          summary={summary.data ?? null}
          timeseries={timeseries.data ?? []}
          breakdown={breakdown.data ?? []}
          waste={waste.data ?? null}
          instance={instance.data ?? null}
          onSelectInstance={setInstanceId}
          workspaceName={activeWorkspace?.name}
          loading={summary.isLoading}
        />
      </div>
    </div>
  );
}
```

> Use the same `useWorkspace` import path the existing `DashboardPage.tsx` uses; adjust if it differs.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck -w @journeyman/web`
Expected: FAIL — `@journeyman/usage-dashboard` not yet a dependency of web. Fixed in the next task.

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/api/usage.ts packages/web/src/routes/UsageDashboardPage.tsx
git commit -m "feat(web): usage dashboard API client + page wrapper"
```

---

### Task 16: Mount route + nav + dependency

**Files:**
- Modify: `packages/web/package.json`
- Modify: `packages/web/src/App.tsx`
- Modify: `packages/web/src/components/nav-config.ts`

- [ ] **Step 1: Add the package dependency**

In `packages/web/package.json`, add to `dependencies` (alongside `@journeyman/workspace-dashboard`):

```json
"@journeyman/usage-dashboard": "*",
```

- [ ] **Step 2: Re-link the workspace**

Run: `npm install`
Expected: links `@journeyman/usage-dashboard` into web's `node_modules`.

- [ ] **Step 3: Add the route**

In `packages/web/src/App.tsx`, add immediately after the dashboard route:

```tsx
import { UsageDashboardPage } from "./routes/UsageDashboardPage.tsx";
// ...
<Route path="/workspaces/:wsId/usage" element={<UsageDashboardPage />} />
```

- [ ] **Step 4: Add the nav item**

In `packages/web/src/components/nav-config.ts`, add to the `workspace` group's `items` array (after the dashboard item):

```typescript
{ slug: "usage", icon: "📈", label: "Usage" },
```

- [ ] **Step 5: Typecheck the whole repo**

Run: `npm run typecheck && npm run check:boundaries`
Expected: PASS (web now resolves `@journeyman/usage-dashboard`).

- [ ] **Step 6: Verify in the browser**

Frontend hot-reloads. Ensure the analytics service (4002) and a migrated DB are running. Navigate to a workspace → "Usage" in the nav (or `/workspaces/:wsId/usage`). Confirm: KPI cards populate, range pills switch the window and refetch, group-by pills swap the "Cost by …" breakdown, and the unpriced banner appears only when `unpricedRows > 0`. With a seeded price + backfill, dollar values render; otherwise costs show `—`.

- [ ] **Step 7: Commit**

```bash
git add packages/web/package.json packages/web/src/App.tsx packages/web/src/components/nav-config.ts package-lock.json
git commit -m "feat(web): mount usage dashboard route + nav"
```

---

## Final Verification

- [ ] **Step 1: Full check**

Run: `npm run check` (typecheck + boundaries)
Expected: PASS.

- [ ] **Step 2: All tests**

Run: `npm test`
Expected: the new suites (`pricing-db`, `model-pricing`, `record-token-usage`, analytics `usage`, usage-dashboard `format` + `regression`) PASS. Compare against the known 5 pre-existing failures baseline — no NEW failures.

- [ ] **Step 3: End-to-end smoke**

With API server (4000), analytics (4002), worker, and a migrated DB running: set a price for a model your flows use, run a flow (or `node scripts/backfill-token-cost.mjs` over existing rows), then open `/workspaces/:wsId/usage` and confirm dollar costs, the by-dimension breakdown, and (if any failed/retried runs exist) the wasted-spend banner.
