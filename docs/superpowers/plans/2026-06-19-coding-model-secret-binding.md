# Coding-model secret binding — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make coding models org-scoped and let each model carry its own bound org secret for its API key, so workflows and agents only pick a model and run end-to-end.

**Architecture:** A coding model row gains `org_id` (org ownership) and `api_key_secret_id` (FK to `jm_secrets`, `ON DELETE RESTRICT`). The model form's existing "Requires an API key" toggle now reveals an org-secret picker with inline create. At run time a new `modelKeyResolver` fetches the model's bound secret and injects it under the provider's expected env var (`config.apiKeySlot`), replacing per-step binding of that key. The Claude provider-level `ANTHROPIC_API_KEY` slot is removed from the catalog so it no longer appears in per-step secret UI.

**Tech stack:** TypeScript, Fastify, PostgreSQL (`pg`, no ORM), React + TanStack Query, npm workspaces monorepo.

**Execution constraints (per user):** Do **not** commit at any step. Run the typecheck gate **once, at the very end** (Task 12). Targeted unit tests are included for pure backend logic and run as part of the final gate.

---

## File structure

| File | Responsibility | Action |
|---|---|---|
| `packages/migrations/src/sql/058_coding_models_org_scope.sql` | Add `org_id` + `api_key_secret_id`, re-scope uniqueness/default index | Create |
| `packages/core/src/types/coding-models.types.ts` | `CodingModel` / inputs gain `orgId`, `apiKeySecretId` | Modify |
| `packages/core/src/registries/provider-catalog.ts` | Drop Claude `ANTHROPIC_API_KEY` provider slot (model-owned now) | Modify |
| `packages/secrets/src/db.ts` | `fetchSecretById` + `getOrgSecretMeta` | Modify |
| `packages/secrets/src/index.ts` | Export the new functions | Modify |
| `packages/coding-models/src/db.ts` | Org-scoped queries; persist `api_key_secret_id` | Modify |
| `packages/coding-models/src/routes/org.ts` | New org-scoped CRUD routes | Create |
| `packages/coding-models/src/routes/public.ts` | Org-filter the public list | Modify |
| `packages/coding-models/src/routes/index.ts` | Register org routes; drop admin routes | Modify |
| `packages/coding-models/src/routes/admin.ts` | Deleted (retired) | Delete |
| `packages/coding-models/src/index.ts` | Stop exporting admin route registrar | Modify |
| `packages/orchestrator/src/workers/worker-harness.ts` | Inject model-owned key after binding resolution | Modify |
| `packages/orchestrator/src/workers/steps/agent-run-step-handler.ts` | Same injection for agents | Modify |
| `packages/orchestrator/src/cli-worker.ts` | Wire `modelKeyResolver`; pass `orgId` to model resolvers | Modify |
| `packages/api-server/src/routes/flows.ts` | Drop model-key slot from publish-time collection | Modify |
| `packages/web/src/api/codingModels.ts` | Org-scoped client + `listOrgSecrets` import | Modify |
| `packages/web/src/api/secrets.ts` | Add `listOrgSecrets` fetch | Modify |
| `packages/web/src/routes/AdminCodingModelsPage.tsx` | Org API + auth section for all providers + secret picker w/ inline create | Modify |
| `packages/flow-editor/src/properties-panel/RequiredSecretsTab.tsx` | Remove model-key slot from per-step UI | Modify |

---

## Task 1: Migration — org-scope coding models + secret FK

**Files:**
- Create: `packages/migrations/src/sql/058_coding_models_org_scope.sql`

Existing rows are preserved and assigned to the earliest org (the one "designated org" from the spec). `org_id` is added nullable, backfilled, then set `NOT NULL`. Uniqueness and the "one default per provider" index become per-org. `api_key_secret_id` is a nullable FK with `ON DELETE RESTRICT`.

- [ ] **Step 1: Write the migration file**

```sql
-- 058_coding_models_org_scope.sql
-- Coding models become org-scoped, and each model can bind an org secret for its API key.
-- Existing rows are preserved and assigned to the earliest org (single designated org).

ALTER TABLE jm_coding_models ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES jm_orgs(id) ON DELETE CASCADE;
ALTER TABLE jm_coding_models ADD COLUMN IF NOT EXISTS api_key_secret_id UUID REFERENCES jm_secrets(id) ON DELETE RESTRICT;

-- Backfill existing rows to the earliest org so nothing is orphaned.
UPDATE jm_coding_models
   SET org_id = (SELECT id FROM jm_orgs ORDER BY created_at ASC LIMIT 1)
 WHERE org_id IS NULL;

-- If there are coding models but no orgs at all, the backfill above leaves NULLs;
-- delete those rather than block the NOT NULL (only possible on a brand-new/empty install).
DELETE FROM jm_coding_models WHERE org_id IS NULL;

ALTER TABLE jm_coding_models ALTER COLUMN org_id SET NOT NULL;

-- Re-scope uniqueness and the default index to be per-org.
ALTER TABLE jm_coding_models DROP CONSTRAINT IF EXISTS jm_coding_models_provider_model_id_key;
DROP INDEX IF EXISTS jm_coding_models_provider_idx;
DROP INDEX IF EXISTS jm_coding_models_one_default_per_provider;

ALTER TABLE jm_coding_models
  ADD CONSTRAINT jm_coding_models_org_provider_model_key UNIQUE (org_id, provider, model_id);

CREATE INDEX jm_coding_models_org_provider_idx
  ON jm_coding_models (org_id, provider) WHERE enabled = true;

CREATE UNIQUE INDEX jm_coding_models_one_default_per_org_provider
  ON jm_coding_models (org_id, provider) WHERE is_default = true;
```

- [ ] **Step 2: Verify it parses against a dev DB (optional, if infra is up)**

Run: `npm run migrate`
Expected: log line `applying 058_coding_models_org_scope`, no error. If infra is down, skip — the final typecheck does not run migrations.

---

## Task 2: Core types — add `orgId` and `apiKeySecretId`

**Files:**
- Modify: `packages/core/src/types/coding-models.types.ts`

- [ ] **Step 1: Add the fields to `CodingModel` and the inputs**

In `packages/core/src/types/coding-models.types.ts`, change the `CodingModel` type and both input types:

```typescript
export type CodingModel = {
  id: string;
  orgId: string;
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
  config?: CodingModelConfig;
  /** Org secret (jm_secrets.id, workspace_id IS NULL) that fills config.apiKeySlot at run time. */
  apiKeySecretId?: string;
  createdAt: string;
  updatedAt: string;
};

export type CodingModelCreateInput = {
  provider: string;
  modelId: string;
  label: string;
  description?: string;
  sortOrder?: number;
  enabled?: boolean;
  deprecated?: boolean;
  isDefault?: boolean;
  supportsThinking?: boolean;
  contextWindow?: number;
  config?: CodingModelConfig;
  apiKeySecretId?: string;
};

export type CodingModelUpdateInput = Partial<CodingModelCreateInput>;
```

Also update the `CodingModelConfig.apiKeySlot` doc comment to reflect its new meaning:

```typescript
  /** Env-var name the provider expects the API key under (e.g. ANTHROPIC_API_KEY); blank = no key. */
  apiKeySlot?: string;
```

---

## Task 3: Core — remove the Claude provider-level key slot

**Files:**
- Modify: `packages/core/src/registries/provider-catalog.ts:26-28`

The Claude API key is now model-owned, so it must not be collected as a per-step provider slot. opencode/aisdk already declare no catalog slots (their key lived in model config).

- [ ] **Step 1: Drop the `slots` array from the claude entry**

Change:

```typescript
{ kind: "coding-cli", value: "claude", label: "Claude", implemented: true, isDefault: true, slots: [
  { name: "ANTHROPIC_API_KEY", description: "Anthropic API key. Optional.", optional: true },
]},
```

to:

```typescript
{ kind: "coding-cli", value: "claude", label: "Claude", implemented: true, isDefault: true },
```

---

## Task 4: Secrets — `fetchSecretById` + `getOrgSecretMeta`

**Files:**
- Modify: `packages/secrets/src/db.ts`
- Modify: `packages/secrets/src/index.ts`
- Test: `packages/secrets/src/db.fetch-by-id.test.ts`

`fetchSecretById` returns the decrypted value of an org secret (workspace_id IS NULL) by id, scoped to the org. `getOrgSecretMeta` lets the route validate that a chosen secret id is a real org secret in the caller's org before binding.

- [ ] **Step 1: Write a failing test for `fetchSecretById`**

Create `packages/secrets/src/db.fetch-by-id.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { fetchSecretById } from "./db.ts";

describe("fetchSecretById", () => {
  it("is exported and callable", () => {
    expect(typeof fetchSecretById).toBe("function");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test --workspace @journeyman/secrets -- db.fetch-by-id`
Expected: FAIL — `fetchSecretById` is not exported.

- [ ] **Step 3: Add `fetchSecretById` and `getOrgSecretMeta` to `db.ts`**

Append to `packages/secrets/src/db.ts` (it already imports `open` from `./crypto.ts`):

```typescript
/**
 * Fetch + decrypt one org-scope secret (workspace_id IS NULL) by id, scoped to the org.
 * Returns null when the id is not an org secret in this org.
 */
export async function fetchSecretById(
  pool: Pool,
  orgId: string,
  secretId: string,
): Promise<string | null> {
  const r = await pool.query(
    `SELECT ciphertext, iv, auth_tag
       FROM jm_secrets
      WHERE id = $1 AND org_id = $2 AND workspace_id IS NULL`,
    [secretId, orgId],
  );
  const row = r.rows[0];
  if (!row) return null;
  return open({ ciphertext: row.ciphertext, iv: row.iv, authTag: row.auth_tag });
}

/**
 * Lightweight metadata lookup used to validate a bound secret id is an org secret
 * (workspace_id IS NULL) in the given org. Returns { id, name } or null.
 */
export async function getOrgSecretMeta(
  pool: Pool,
  orgId: string,
  secretId: string,
): Promise<{ id: string; name: string } | null> {
  const r = await pool.query(
    `SELECT id, name FROM jm_secrets
      WHERE id = $1 AND org_id = $2 AND workspace_id IS NULL`,
    [secretId, orgId],
  );
  return r.rows[0] ? { id: r.rows[0].id, name: r.rows[0].name } : null;
}
```

- [ ] **Step 4: Export from the package entrypoint**

In `packages/secrets/src/index.ts`, ensure `fetchSecretById` and `getOrgSecretMeta` are re-exported. If the file uses `export * from "./db.ts";` no change is needed; otherwise add them to the explicit export list. Verify by checking the existing export style in that file and matching it.

- [ ] **Step 5: Re-run the test**

Run: `npm test --workspace @journeyman/secrets -- db.fetch-by-id`
Expected: PASS.

---

## Task 5: Coding-models db — org scoping + persist `api_key_secret_id`

**Files:**
- Modify: `packages/coding-models/src/db.ts`

All reads/writes become org-scoped, and `api_key_secret_id` is persisted and mapped. `findCodingModel` and `findDefaultCodingModel` and `listEnabledCodingModelsByProvider` take `orgId`. The "is_default" reset queries scope by `org_id`.

- [ ] **Step 1: Update `rowToModel` to map the new columns**

In `packages/coding-models/src/db.ts`, change `rowToModel`:

```typescript
function rowToModel(r: any): CodingModel {
  return {
    id: r.id,
    orgId: r.org_id,
    provider: r.provider,
    modelId: r.model_id,
    label: r.label,
    description: r.description ?? undefined,
    sortOrder: r.sort_order,
    enabled: r.enabled,
    deprecated: r.deprecated,
    isDefault: r.is_default,
    supportsThinking: r.supports_thinking,
    contextWindow: r.context_window ?? undefined,
    config: r.config && Object.keys(r.config).length ? r.config : undefined,
    apiKeySecretId: r.api_key_secret_id ?? undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
```

- [ ] **Step 2: Make `insertCodingModel` org-scoped and persist the FK**

Change the signature to `insertCodingModel(pool, orgId, input)` and update the default-reset + INSERT:

```typescript
export async function insertCodingModel(
  pool: Pool,
  orgId: string,
  input: CodingModelCreateInput,
): Promise<CodingModel> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (input.isDefault) {
      await client.query(
        `UPDATE jm_coding_models SET is_default = false, updated_at = now()
         WHERE org_id = $1 AND provider = $2 AND is_default = true`,
        [orgId, input.provider],
      );
    }
    const id = newId();
    let rows;
    try {
      ({ rows } = await client.query(
        `INSERT INTO jm_coding_models
           (id, org_id, provider, model_id, label, description, sort_order, enabled,
            deprecated, is_default, supports_thinking, context_window, config, api_key_secret_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         RETURNING *`,
        [
          id,
          orgId,
          input.provider,
          input.modelId,
          input.label,
          input.description ?? null,
          input.sortOrder ?? 0,
          input.enabled ?? true,
          input.deprecated ?? false,
          input.isDefault ?? false,
          input.supportsThinking ?? false,
          input.contextWindow ?? null,
          JSON.stringify(input.config ?? {}),
          input.apiKeySecretId ?? null,
        ],
      ));
    } catch (err: any) {
      if (err?.code === "23505") {
        throw new DuplicateCodingModelError(input.provider, input.modelId);
      }
      throw err;
    }
    await client.query("COMMIT");
    return rowToModel(rows[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
```

- [ ] **Step 3: Make list/find/default queries org-scoped**

Replace these functions:

```typescript
export async function listCodingModelsByOrg(pool: Pool, orgId: string): Promise<CodingModel[]> {
  const { rows } = await pool.query(
    `SELECT * FROM jm_coding_models WHERE org_id = $1 ORDER BY provider, sort_order, label`,
    [orgId],
  );
  return rows.map(rowToModel);
}

export async function listEnabledCodingModelsByProvider(
  pool: Pool,
  orgId: string,
  provider: string,
): Promise<CodingModel[]> {
  const { rows } = await pool.query(
    `SELECT * FROM jm_coding_models
     WHERE org_id = $1 AND provider = $2 AND enabled = true
     ORDER BY sort_order, label`,
    [orgId, provider],
  );
  return rows.map(rowToModel);
}

export async function findDefaultCodingModel(
  pool: Pool,
  orgId: string,
  provider: string,
): Promise<CodingModel | null> {
  const { rows } = await pool.query(
    `SELECT * FROM jm_coding_models
     WHERE org_id = $1 AND provider = $2 AND enabled = true AND is_default = true
     LIMIT 1`,
    [orgId, provider],
  );
  return rows[0] ? rowToModel(rows[0]) : null;
}

export async function findCodingModel(
  pool: Pool,
  orgId: string,
  provider: string,
  modelId: string,
): Promise<CodingModel | null> {
  const { rows } = await pool.query(
    `SELECT * FROM jm_coding_models WHERE org_id = $1 AND provider = $2 AND model_id = $3 LIMIT 1`,
    [orgId, provider, modelId],
  );
  return rows[0] ? rowToModel(rows[0]) : null;
}
```

Note: `listAllCodingModels` (platform-wide) is removed; replace its only caller (admin route, being deleted) — no other callers remain after this plan. Delete `listAllCodingModels`.

- [ ] **Step 4: Make `getCodingModel` org-scoped and `updateCodingModel` persist the FK**

`getCodingModel` gains `orgId`:

```typescript
export async function getCodingModel(pool: Pool, orgId: string, id: string): Promise<CodingModel | null> {
  const { rows } = await pool.query(
    `SELECT * FROM jm_coding_models WHERE id = $1 AND org_id = $2`,
    [id, orgId],
  );
  return rows[0] ? rowToModel(rows[0]) : null;
}
```

In `updateCodingModel`, change the lookup to be org-scoped, scope the default-reset by `org_id`, and add `api_key_secret_id` to the SET list. Change the signature to `updateCodingModel(pool, orgId, id, patch)`:

```typescript
export async function updateCodingModel(
  pool: Pool,
  orgId: string,
  id: string,
  patch: CodingModelUpdateInput,
): Promise<CodingModel | null> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: existingRows } = await client.query(
      `SELECT * FROM jm_coding_models WHERE id = $1 AND org_id = $2 FOR UPDATE`,
      [id, orgId],
    );
    if (existingRows.length === 0) {
      await client.query("ROLLBACK");
      return null;
    }
    const existing = rowToModel(existingRows[0]);
    const next = { ...existing, ...patch };
    if (patch.isDefault === true && !existing.isDefault) {
      await client.query(
        `UPDATE jm_coding_models SET is_default = false, updated_at = now()
         WHERE org_id = $1 AND provider = $2 AND is_default = true AND id <> $3`,
        [orgId, next.provider, id],
      );
    }
    let rows;
    try {
      ({ rows } = await client.query(
        `UPDATE jm_coding_models SET
           provider = $3,
           model_id = $4,
           label = $5,
           description = $6,
           sort_order = $7,
           enabled = $8,
           deprecated = $9,
           is_default = $10,
           supports_thinking = $11,
           context_window = $12,
           config = $13,
           api_key_secret_id = $14,
           updated_at = now()
         WHERE id = $1 AND org_id = $2
         RETURNING *`,
        [
          id,
          orgId,
          next.provider,
          next.modelId,
          next.label,
          next.description ?? null,
          next.sortOrder,
          next.enabled,
          next.deprecated,
          next.isDefault,
          next.supportsThinking,
          next.contextWindow ?? null,
          JSON.stringify(next.config ?? {}),
          next.apiKeySecretId ?? null,
        ],
      ));
    } catch (err: any) {
      if (err?.code === "23505") {
        throw new DuplicateCodingModelError(next.provider, next.modelId);
      }
      throw err;
    }
    await client.query("COMMIT");
    return rowToModel(rows[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
```

- [ ] **Step 5: Make `deleteCodingModel` org-scoped**

```typescript
export async function deleteCodingModel(pool: Pool, orgId: string, id: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `DELETE FROM jm_coding_models WHERE id = $1 AND org_id = $2`,
    [id, orgId],
  );
  return (rowCount ?? 0) > 0;
}
```

Note: deleting a model whose bound secret is referenced is unaffected (the FK is from the model to the secret, not the reverse). Deleting a *secret* that a model binds will fail with FK error 23503 — handled in the org-secrets delete path (out of scope here; the RESTRICT is intentional per spec).

---

## Task 6: Coding-models — org-scoped CRUD routes

**Files:**
- Create: `packages/coding-models/src/routes/org.ts`
- Modify: `packages/coding-models/src/routes/public.ts`
- Modify: `packages/coding-models/src/routes/index.ts`
- Delete: `packages/coding-models/src/routes/admin.ts`
- Modify: `packages/coding-models/src/index.ts`

- [ ] **Step 1: Create the org route module**

Create `packages/coding-models/src/routes/org.ts`:

```typescript
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import type { CodingModelConfig } from "@journeyman/core";
import { makeRequireAuth } from "@journeyman/identity";
import { getOrgSecretMeta } from "@journeyman/secrets";
import {
  DuplicateCodingModelError,
  deleteCodingModel,
  getCodingModel,
  insertCodingModel,
  listCodingModelsByOrg,
  updateCodingModel,
} from "../db.ts";
import { isValidCodingProvider, LIST_CODING_PROVIDERS } from "../validate-provider.ts";
import { validateCodingModelConfig } from "../validate-config.ts";

/**
 * Validate the secret binding: when config.apiKeySlot is set the model needs a key,
 * so api_key_secret_id must reference a real org secret in this org. When apiKeySlot
 * is blank the binding must be cleared. Returns an error message, or null.
 */
async function validateBinding(
  pool: Pool,
  orgId: string,
  config: CodingModelConfig | undefined,
  apiKeySecretId: string | undefined | null,
): Promise<string | null> {
  const needsKey = Boolean(config?.apiKeySlot?.trim());
  if (needsKey) {
    if (!apiKeySecretId) return "apiKeySecretId is required when the model requires an API key";
    const meta = await getOrgSecretMeta(pool, orgId, apiKeySecretId);
    if (!meta) return "apiKeySecretId must reference an org secret in this org";
  }
  return null;
}

export async function registerOrgCodingModelRoutes(app: FastifyInstance, pool: Pool) {
  const requireAuth = makeRequireAuth({ pool });

  app.get(
    "/api/orgs/:orgId/coding-models",
    { preHandler: requireAuth({ role: "admin" }) },
    async (req, reply) => {
      const { orgId } = req.params as { orgId: string };
      if (req.runContext!.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      return listCodingModelsByOrg(pool, orgId);
    },
  );

  app.post(
    "/api/orgs/:orgId/coding-models",
    { preHandler: requireAuth({ role: "admin" }) },
    async (req, reply) => {
      const { orgId } = req.params as { orgId: string };
      if (req.runContext!.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      const b = req.body as any;
      if (!b?.provider || !b?.modelId || !b?.label) {
        return reply.code(400).send({ error: "provider, modelId, label required" });
      }
      if (!isValidCodingProvider(b.provider)) {
        return reply.code(400).send({
          error: `Unknown coding-cli provider: ${b.provider}. Allowed: ${LIST_CODING_PROVIDERS.join(", ")}`,
        });
      }
      const cfgErr = validateCodingModelConfig(String(b.provider), b.config);
      if (cfgErr) return reply.code(400).send({ error: cfgErr });
      const bindErr = await validateBinding(pool, orgId, b.config, b.apiKeySecretId);
      if (bindErr) return reply.code(400).send({ error: bindErr });
      try {
        const rec = await insertCodingModel(pool, orgId, {
          provider: String(b.provider),
          modelId: String(b.modelId),
          label: String(b.label),
          description: b.description,
          sortOrder: b.sortOrder,
          enabled: b.enabled,
          deprecated: b.deprecated,
          isDefault: b.isDefault,
          supportsThinking: b.supportsThinking,
          contextWindow: b.contextWindow,
          config: b.config,
          apiKeySecretId: b.apiKeySecretId,
        });
        reply.code(201);
        return rec;
      } catch (err) {
        if (err instanceof DuplicateCodingModelError) {
          return reply.code(409).send({ error: err.message });
        }
        throw err;
      }
    },
  );

  app.patch(
    "/api/orgs/:orgId/coding-models/:id",
    { preHandler: requireAuth({ role: "admin" }) },
    async (req, reply) => {
      const { orgId, id } = req.params as { orgId: string; id: string };
      if (req.runContext!.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      const existing = await getCodingModel(pool, orgId, id);
      if (!existing) return reply.code(404).send({ error: "Not found" });
      const patch = req.body as Record<string, unknown> | undefined;
      const effectiveProvider =
        typeof patch?.provider === "string" ? (patch.provider as string) : existing.provider;
      if (patch && Object.prototype.hasOwnProperty.call(patch, "provider")) {
        if (!isValidCodingProvider(patch.provider)) {
          return reply.code(400).send({
            error: `Unknown coding-cli provider: ${String(patch.provider)}. Allowed: ${LIST_CODING_PROVIDERS.join(", ")}`,
          });
        }
      }
      if (patch && Object.prototype.hasOwnProperty.call(patch, "config")) {
        const cfgErr = validateCodingModelConfig(
          effectiveProvider,
          patch.config as CodingModelConfig | undefined,
        );
        if (cfgErr) return reply.code(400).send({ error: cfgErr });
      }
      // Validate the binding against the effective (post-patch) config + secret id.
      const effConfig = (patch && Object.prototype.hasOwnProperty.call(patch, "config")
        ? (patch.config as CodingModelConfig | undefined)
        : existing.config);
      const effSecretId = (patch && Object.prototype.hasOwnProperty.call(patch, "apiKeySecretId")
        ? (patch.apiKeySecretId as string | undefined)
        : existing.apiKeySecretId);
      const bindErr = await validateBinding(pool, orgId, effConfig, effSecretId);
      if (bindErr) return reply.code(400).send({ error: bindErr });
      try {
        const updated = await updateCodingModel(pool, orgId, id, req.body as any);
        return updated;
      } catch (err) {
        if (err instanceof DuplicateCodingModelError) {
          return reply.code(409).send({ error: err.message });
        }
        throw err;
      }
    },
  );

  app.delete(
    "/api/orgs/:orgId/coding-models/:id",
    { preHandler: requireAuth({ role: "admin" }) },
    async (req, reply) => {
      const { orgId, id } = req.params as { orgId: string; id: string };
      if (req.runContext!.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      const ok = await deleteCodingModel(pool, orgId, id);
      if (!ok) return reply.code(404).send({ error: "Not found" });
      reply.code(204);
      return null;
    },
  );
}
```

Note: `validateCodingModelConfig` still only enforces opencode/aisdk specifics. For claude, `config.apiKeySlot` is accepted and passed through (the new `validateBinding` is what enforces a bound secret). This is intentional — no change needed in `validate-config.ts`.

- [ ] **Step 2: Org-filter the public list route**

Replace `packages/coding-models/src/routes/public.ts`:

```typescript
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { makeRequireAuth } from "@journeyman/identity";
import { listEnabledCodingModelsByProvider } from "../db.ts";

export async function registerPublicCodingModelRoutes(app: FastifyInstance, pool: Pool) {
  const requireAuth = makeRequireAuth({ pool });

  app.get(
    "/api/coding-models",
    { preHandler: requireAuth() },
    async (req, reply) => {
      const provider = (req.query as { provider?: string }).provider;
      if (!provider || typeof provider !== "string") {
        return reply.code(400).send({ error: "provider query param required" });
      }
      const orgId = req.runContext?.org.id;
      if (!orgId) return reply.code(400).send({ error: "org context required" });
      return listEnabledCodingModelsByProvider(pool, orgId, provider);
    },
  );
}
```

- [ ] **Step 3: Update route registration**

Replace `packages/coding-models/src/routes/index.ts`:

```typescript
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { registerOrgCodingModelRoutes } from "./org.ts";
import { registerPublicCodingModelRoutes } from "./public.ts";

export async function registerCodingModelRoutes(app: FastifyInstance, pool: Pool) {
  await registerOrgCodingModelRoutes(app, pool);
  await registerPublicCodingModelRoutes(app, pool);
}
```

- [ ] **Step 4: Delete the admin route module and its export**

Delete the file `packages/coding-models/src/routes/admin.ts`.

In `packages/coding-models/src/index.ts`, remove any `export ... registerAdminCodingModelRoutes` / `export * from "./routes/admin.ts"` line. Add an export for the org routes if the file explicitly re-exports route registrars (match existing style). Verify no other file imports `registerAdminCodingModelRoutes`:

Run: `grep -rn "registerAdminCodingModelRoutes\|listAllCodingModels" packages --include=*.ts`
Expected: no results (all removed).

---

## Task 7: Add `@journeyman/secrets` dep to coding-models (if missing)

**Files:**
- Modify: `packages/coding-models/package.json`

`org.ts` now imports from `@journeyman/secrets`. The import-boundary check requires the dependency to be declared.

- [ ] **Step 1: Check whether the dep already exists**

Run: `grep -n "@journeyman/secrets" packages/coding-models/package.json`
Expected: if present, skip Step 2.

- [ ] **Step 2: Add it to dependencies**

In `packages/coding-models/package.json`, add to the `dependencies` object (match the existing `@journeyman/*` version style, typically `"*"` or `"workspace:*"` — copy the form used by `@journeyman/identity` in the same file):

```json
"@journeyman/secrets": "*"
```

Then run `npm install` to relink workspaces.

Run: `npm install`
Expected: completes without error.

---

## Task 8: Orchestrator — model-key resolver + injection

**Files:**
- Modify: `packages/orchestrator/src/cli-worker.ts`
- Modify: `packages/orchestrator/src/workers/worker-harness.ts`
- Modify: `packages/orchestrator/src/workers/steps/agent-run-step-handler.ts`

A new optional `modelKeyResolver` dep returns `{ slot, value }` for a model's bound secret. The harness and agent handler call it after binding resolution and merge the result into the env. `modelResolver`/`modelConfigResolver` gain `orgId`.

- [ ] **Step 1: Add `modelKeyResolver` to the harness deps type and wire injection**

In `packages/orchestrator/src/workers/worker-harness.ts`, find the deps interface (the type that declares `bindingResolver`, `modelResolver`, `modelConfigResolver`). Add:

```typescript
  modelKeyResolver?: (input: {
    provider: string;
    modelId: string;
    orgId: string | null;
  }) => Promise<{ slot: string; value: string } | null>;
```

Update the existing `modelResolver` and `modelConfigResolver` signatures in the same interface to include `orgId`:

```typescript
  modelResolver?: (input: { provider: string; orgId: string | null }) => Promise<string | undefined>;
  modelConfigResolver?: (input: { provider: string; modelId: string; orgId: string | null }) => Promise<CodingModelConfig | undefined>;
```

- [ ] **Step 2: Pass `orgId` to the model resolvers and inject the model key**

In `worker-harness.ts`, the `orgId` variable is already in scope where secrets are resolved. At the `modelResolver` call (around line 281) change:

```typescript
          const sysModel = await this.deps.modelResolver({ provider, orgId });
```

At the `modelConfigResolver` call (around line 301) change:

```typescript
        const mc = await this.deps.modelConfigResolver({ provider: cfgProvider, modelId: resolvedModel, orgId });
```

Then, immediately after the `modelConfigResolver` block (after line 306), add model-key injection:

```typescript
    // Inject the model-owned API key: the coding model binds an org secret directly,
    // so the per-step binding no longer carries it. Resolve + merge into the env.
    if (
      this.deps.modelKeyResolver &&
      typeof resolvedModel === "string" && resolvedModel &&
      typeof cfgProvider === "string" && cfgProvider
    ) {
      try {
        const mk = await this.deps.modelKeyResolver({ provider: cfgProvider, modelId: resolvedModel, orgId });
        if (mk) resolvedEnv[mk.slot] = mk.value;
      } catch (err: any) {
        rlog.warn({ err: err?.message }, "model key resolver failed; continuing without model-owned key");
      }
    }
```

(`resolvedEnv` is the variable assigned from `bindingResolver` at line 191 and is in scope here.)

- [ ] **Step 3: Inject the model key in the agent handler**

In `packages/orchestrator/src/workers/steps/agent-run-step-handler.ts`:

(a) Remove the `openCodeModelSlots(modelConfig)` line from slot collection (line 117) — the model key is no longer a binding slot. The block becomes:

```typescript
    const providerSlots = PROVIDER_CATALOG.find((p) => p.kind === "coding-cli" && p.value === provider)?.slots ?? [];
    const slotsByName = new Map<string, { name: string; optional?: boolean }>();
    for (const s of providerSlots) slotsByName.set(s.name, s);
    const effectiveSlots = Array.from(slotsByName.values());
```

(b) After the `bindingResolver` try/catch that assigns `env` (after line 132), add injection. The handler reaches `modelKeyResolver` via `this.deps` — add `modelKeyResolver?` to the agent handler's deps type the same way as in Step 1, then:

```typescript
    // Inject the model-owned API key (mirrors worker-harness).
    if (this.deps.modelKeyResolver && model) {
      try {
        const mk = await this.deps.modelKeyResolver({ provider, modelId: model, orgId });
        if (mk) env[mk.slot] = mk.value;
      } catch (err: any) {
        log.warn({ err: err?.message }, "model key resolver failed; continuing without model-owned key");
      }
    }
```

Note: `model` is declared later in the current code (line 140). Move the `const model = ...` declaration (line 140) to just above this injection block so it is defined when referenced. If the handler's deps are a shared type with the harness, adding `modelKeyResolver?` once covers both; otherwise add it to both deps types.

(c) **Cover any other self-resolving handlers.** The agent handler re-resolves its own `env` instead of using the harness `resolvedEnv`. Confirm whether other step handlers do the same:

Run: `grep -rln "bindingResolver" packages/orchestrator/src/workers/steps`
For each handler that calls `bindingResolver` and builds its own `env` (rather than relying on the harness-provided `ctx.env`), apply the same model-key injection block from (b). The harness-level injection (Step 2) covers every handler that consumes `ctx.env`; only the self-resolving ones need the extra block. List in the implementation notes which handlers you patched.

- [ ] **Step 4: Wire the resolvers in `cli-worker.ts`**

In `packages/orchestrator/src/cli-worker.ts`, update the imports from `@journeyman/coding-models` to include `findCodingModel` (now org-scoped) and add `fetchSecretById` from `@journeyman/secrets`. Then replace the `modelResolver` / `modelConfigResolver` and add `modelKeyResolver` in the `new WorkerHarness({...})` deps (lines 413-422):

```typescript
  modelResolver: async ({ provider, orgId }) => {
    if (!pool || !orgId) return undefined;
    const m = await findDefaultCodingModel(pool, orgId, provider);
    return m?.modelId;
  },
  modelConfigResolver: async ({ provider, modelId, orgId }) => {
    if (!pool || !orgId) return undefined;
    const m = await findCodingModel(pool, orgId, provider, modelId);
    return m?.config;
  },
  modelKeyResolver: async ({ provider, modelId, orgId }) => {
    if (!pool || !orgId) return null;
    const m = await findCodingModel(pool, orgId, provider, modelId);
    const slot = m?.config?.apiKeySlot?.trim();
    if (!m?.apiKeySecretId || !slot) return null;
    const value = await fetchSecretById(pool, orgId, m.apiKeySecretId);
    if (value == null) return null;
    return { slot, value };
  },
```

Add the import near the other `@journeyman/secrets` imports:

```typescript
import { resolveBindings, fetchSecretById } from "@journeyman/secrets";
```

(Adjust to merge with the existing `@journeyman/secrets` import line rather than duplicating it.)

---

## Task 9: api-server — drop model-key slot from publish-time collection

**Files:**
- Modify: `packages/api-server/src/routes/flows.ts:72-86`

The model key is no longer a per-step binding, so it must not be collected as a declared slot at publish time (otherwise it would be wrongly flagged as inaccessible/orphan).

- [ ] **Step 1: Remove the `modelSlots` block and its use**

In `packages/api-server/src/routes/flows.ts`, delete the `modelSlots` computation (lines 72-80) and remove `modelSlots` from the two unions (lines 84 and 86). The block becomes:

```typescript
      const providerSlots = providerValue
        ? PROVIDER_CATALOG.find(p => p.kind === "coding-cli" && p.value === providerValue)?.slots ?? []
        : [];
      declaredSlotNames = new Set([
        ...dbSlots.map(s => s.name),
        ...providerSlots.map(s => s.name),
      ]);
      for (const slot of [...dbSlots, ...providerSlots]) {
        if (slot.optional) continue;
        if (bindings[slot.name] === undefined && !visibleNames.has(slot.name)) {
          inaccessible.add(slot.name);
        }
      }
```

- [ ] **Step 2: Remove now-unused imports**

If `findCodingModel` and `openCodeModelSlots` are no longer referenced elsewhere in `flows.ts`, remove them from the import statements.

Run: `grep -n "findCodingModel\|openCodeModelSlots" packages/api-server/src/routes/flows.ts`
Expected: no results (both removed). If `openCodeModelSlots` is used elsewhere in the file, leave that import.

---

## Task 10: flow-editor — remove model-key slot from per-step UI

**Files:**
- Modify: `packages/flow-editor/src/properties-panel/RequiredSecretsTab.tsx:79-130`

The model key is model-owned; the per-step "Required secrets" tab must no longer surface it. With the Claude provider slot removed (Task 3), `providerSlots` is already empty for coding-cli; here we also drop the `openCodeSlots` derivation.

- [ ] **Step 1: Delete the `openCodeSlots` derivation block (lines 79-87)**

Remove:

```typescript
  const modelKeyedProvider = effectiveProvider === "opencode" || effectiveProvider === "aisdk";
  const codingModels = useCodingModels(modelKeyedProvider ? effectiveProvider : undefined);
  const effectiveModelId = node.model ?? flow.defaults?.defaultModel ?? undefined;
  const openCodeSlots: SecretSlotDef[] =
    modelKeyedProvider
      ? openCodeModelSlots(codingModels.find(m => m.modelId === effectiveModelId)?.config)
      : [];
```

- [ ] **Step 2: Remove `openCodeSlots` from the custom-ai union (line 120)**

Change:

```typescript
      const base = [...providerSlots, ...openCodeSlots, ...(stepDef?.slots ?? [])];
```

to:

```typescript
      const base = [...providerSlots, ...(stepDef?.slots ?? [])];
```

- [ ] **Step 3: Remove now-unused imports**

Remove `useCodingModels` and `openCodeModelSlots` imports if no longer referenced in this file.

Run: `grep -n "useCodingModels\|openCodeModelSlots\|openCodeSlots" packages/flow-editor/src/properties-panel/RequiredSecretsTab.tsx`
Expected: no results.

---

## Task 11: web — org client + model form with secret picker

**Files:**
- Modify: `packages/web/src/api/secrets.ts`
- Modify: `packages/web/src/api/codingModels.ts`
- Modify: `packages/web/src/routes/AdminCodingModelsPage.tsx`

- [ ] **Step 1: Add `listOrgSecrets` to the web secrets API**

In `packages/web/src/api/secrets.ts`, add (uses the existing `api` helper imported at the top):

```typescript
export interface OrgSecretMeta { id: string; name: string; description?: string | null }

/** List org-scope secrets (admin only). Returns metadata, never values. */
export function listOrgSecrets(orgId: string): Promise<OrgSecretMeta[]> {
  return api<OrgSecretMeta[]>(`/api/orgs/${encodeURIComponent(orgId)}/secrets`);
}
```

- [ ] **Step 2: Rewrite `codingModels.ts` as an org-scoped client**

Replace `packages/web/src/api/codingModels.ts`:

```typescript
import type {
  CodingModel,
  CodingModelCreateInput,
  CodingModelUpdateInput,
} from "@journeyman/core";

async function jsonOrThrow<T>(r: Response): Promise<T> {
  if (r.ok) {
    if (r.status === 204) return undefined as T;
    return r.json() as Promise<T>;
  }
  const body = await r.json().catch(() => ({}));
  throw new Error((body as any)?.error ?? `HTTP ${r.status}`);
}

export const codingModelsApi = {
  list: (provider: string) =>
    fetch(`/api/coding-models?provider=${encodeURIComponent(provider)}`, { credentials: "include" })
      .then(jsonOrThrow<CodingModel[]>),

  orgList: (orgId: string) =>
    fetch(`/api/orgs/${encodeURIComponent(orgId)}/coding-models`, { credentials: "include" })
      .then(jsonOrThrow<CodingModel[]>),

  orgCreate: (orgId: string, body: CodingModelCreateInput) =>
    fetch(`/api/orgs/${encodeURIComponent(orgId)}/coding-models`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(jsonOrThrow<CodingModel>),

  orgUpdate: (orgId: string, id: string, body: CodingModelUpdateInput) =>
    fetch(`/api/orgs/${encodeURIComponent(orgId)}/coding-models/${id}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(jsonOrThrow<CodingModel>),

  orgDelete: (orgId: string, id: string) =>
    fetch(`/api/orgs/${encodeURIComponent(orgId)}/coding-models/${id}`, {
      method: "DELETE",
      credentials: "include",
    }).then(jsonOrThrow<void>),
};
```

- [ ] **Step 3: Point the page at the org API and read `orgId` from the route**

In `packages/web/src/routes/AdminCodingModelsPage.tsx`:

(a) Add imports:

```typescript
import { useParams } from "react-router-dom";
import { listOrgSecrets, createOrgSecret, type OrgSecretMeta } from "../api/secrets.ts";
```

(b) At the top of `AdminCodingModelsPage()`, get `orgId`:

```typescript
  const { orgId = "" } = useParams<{ orgId: string }>();
```

(c) Change the list query and mutations to the org client:

```typescript
  const { data, isLoading } = useQuery({
    queryKey: ["org-coding-models", orgId],
    queryFn: () => codingModelsApi.orgList(orgId),
    enabled: !!orgId,
  });
```

```typescript
  const createMut = useMutation({
    mutationFn: (b: CodingModelCreateInput) => codingModelsApi.orgCreate(orgId, b),
    onSuccess: () => { setCreating(null); invalidate(); },
  });
  const updateMut = useMutation({
    mutationFn: (args: { id: string; patch: Partial<CodingModelCreateInput> }) =>
      codingModelsApi.orgUpdate(orgId, args.id, args.patch),
    onSuccess: () => { setEditing(null); invalidate(); },
  });
  const deleteMut = useMutation({
    mutationFn: (id: string) => codingModelsApi.orgDelete(orgId, id),
    onSuccess: invalidate,
  });
```

```typescript
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["org-coding-models", orgId] });
    qc.invalidateQueries({ queryKey: ["coding-models"] });
  };
```

(d) Update the header copy (line 65) from "Managed by platform admins." to "Models available to this org's flows and agents."

(e) Thread `orgId` into `ModelForm` so it can pick/create secrets. Change both render sites (lines 126 and 135) to add `orgId={orgId}`.

- [ ] **Step 4: Add the secret picker + inline create to `ModelForm`**

In the same file, extend `ModelForm`:

(a) Add `orgId: string;` to its props type.

(b) Add the bound-secret state setter next to `setConfig`:

```typescript
  const setApiKeySecretId = (id: string | undefined) =>
    setV((prev) => ({ ...prev, apiKeySecretId: id || undefined }));
```

(c) Load the org's secrets for the dropdown:

```typescript
  const { data: orgSecrets = [] } = useQuery({
    queryKey: ["org-secrets", props.orgId],
    queryFn: () => listOrgSecrets(props.orgId),
    enabled: !!props.orgId,
  });
```

Add `import { useQuery } from "@tanstack/react-query";` if not already imported in this file.

(d) Make the Authentication section apply to **all** providers (not just opencode/aisdk) and replace the plain "Secret key name" input with the slot-name field plus the secret picker. Replace the entire block currently at lines 288-308 with:

```tsx
        <section className="space-y-3">
          <h3 className="text-sm font-medium text-slate-200">Authentication</h3>
          <Toggle
            label="Requires an API key"
            hint="Bind an org secret here; workflows and agents using this model will use it automatically."
            checked={requiresKey}
            onChange={(b) => {
              setRequiresKey(b);
              if (!b) setApiKeySecretId(undefined);
            }}
          />
          {requiresKey && (
            <>
              {(v.provider === "opencode" || v.provider === "aisdk") && (
                <Field label="Env var name">
                  <input
                    className={`${inputCls} font-mono text-sm`}
                    value={v.config?.apiKeySlot ?? ""}
                    onChange={(e) => setConfig("apiKeySlot", e.target.value)}
                    placeholder="ANTHROPIC_API_KEY"
                  />
                </Field>
              )}
              <SecretBindingField
                orgId={props.orgId}
                secrets={orgSecrets}
                value={v.apiKeySecretId}
                onChange={setApiKeySecretId}
              />
            </>
          )}
        </section>
```

For non-opencode/aisdk providers (e.g. claude) the env-var name is fixed via the suggested slot name. Adjust `setRequiresKey` so it always seeds `apiKeySlot` regardless of provider (it already does — it sets `apiKeySlot` from `suggestedKeySlotName(modelId)`), which is correct for claude (yields `CLAUDE_API_KEY`). For claude the SDK reads `ANTHROPIC_API_KEY`, so harden `setRequiresKey` to prefer that for claude:

```typescript
  const setRequiresKey = (b: boolean) =>
    setV((prev) => ({
      ...prev,
      config: {
        ...(prev.config ?? {}),
        apiKeySlot: b
          ? (prev.config?.apiKeySlot
              || (prev.provider === "claude" ? "ANTHROPIC_API_KEY" : suggestedKeySlotName(prev.modelId) || "API_KEY"))
          : undefined,
      },
    }));
```

(e) Add the `SecretBindingField` component at the bottom of the file (next to `Field`/`Toggle`):

```tsx
function SecretBindingField(props: {
  orgId: string;
  secrets: OrgSecretMeta[];
  value: string | undefined;
  onChange: (id: string | undefined) => void;
}) {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [secretValue, setSecretValue] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const createMut = useMutation({
    mutationFn: () => createOrgSecret(props.orgId, name.trim(), secretValue),
    onSuccess: async (rec) => {
      await qc.invalidateQueries({ queryKey: ["org-secrets", props.orgId] });
      props.onChange(rec.id);
      setCreating(false);
      setName(""); setSecretValue(""); setErr(null);
    },
    onError: (e: any) => setErr(e?.message ?? "Failed to create secret"),
  });

  return (
    <Field label="Org secret">
      {!creating ? (
        <div className="flex gap-2">
          <select
            className={inputCls}
            value={props.value ?? ""}
            onChange={(e) => props.onChange(e.target.value || undefined)}
          >
            <option value="">Select a secret…</option>
            {props.secrets.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <button type="button" className={btnGhost} onClick={() => setCreating(true)}>
            + Create new
          </button>
        </div>
      ) : (
        <div className="space-y-2 rounded-md border border-slate-700 p-3">
          <input
            className={`${inputCls} font-mono text-sm`}
            placeholder="SECRET_NAME"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            className={inputCls}
            type="password"
            placeholder="secret value"
            value={secretValue}
            onChange={(e) => setSecretValue(e.target.value)}
          />
          {err && <p className="text-xs text-danger">{err}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" className={btnGhost} onClick={() => { setCreating(false); setErr(null); }}>
              Cancel
            </button>
            <button
              type="button"
              className={btnPrimary}
              disabled={!name.trim() || !secretValue || createMut.isPending}
              onClick={() => createMut.mutate()}
            >
              {createMut.isPending ? "Saving…" : "Create & select"}
            </button>
          </div>
        </div>
      )}
    </Field>
  );
}
```

Add `useQueryClient` and `useMutation` to the `@tanstack/react-query` import if not already present. The org secret name must match `^[A-Z][A-Z0-9_]*$` (backend validates; a 400 surfaces via `err`).

(f) Block save when a key is required but unbound. In the footer Save button (line 372), add a guard:

```tsx
          <button
            className={btnPrimary}
            onClick={() => props.onSubmit(v)}
            disabled={props.submitting || (requiresKey && !v.apiKeySecretId)}
          >
```

---

## Task 12: Final verification gate (typecheck + targeted tests)

**Files:** none

- [ ] **Step 1: Typecheck + import boundaries across the monorepo**

Run: `npm run check`
Expected: PASS (this runs `npm run typecheck` and `npm run check:boundaries`). Fix any type errors or boundary violations surfaced — common ones to expect:
- Call sites of `findCodingModel` / `getCodingModel` / `updateCodingModel` / `deleteCodingModel` / `findDefaultCodingModel` / `listEnabledCodingModelsByProvider` that still pass the old arity (grep to find them: `grep -rn "findCodingModel\|getCodingModel\|findDefaultCodingModel\|listEnabledCodingModelsByProvider" packages --include=*.ts`).
- Any leftover import of removed symbols (`registerAdminCodingModelRoutes`, `listAllCodingModels`).

- [ ] **Step 2: Run the new unit test(s)**

Run: `npm test --workspace @journeyman/secrets -- db.fetch-by-id`
Expected: PASS.

- [ ] **Step 3: Confirm no stray references to retired endpoints**

Run: `grep -rn "/api/admin/coding-models\|adminList\|adminCreate\|adminUpdate\|adminDelete" packages/web/src`
Expected: no results in the coding-models context (the page now uses `orgList`/`orgCreate`/`orgUpdate`/`orgDelete`).

---

## Notes for the implementer

- **No commits.** Per the user's instruction, do not `git add`/`git commit` at any step. Leave all changes in the working tree for review.
- **Typecheck once, at the end** (Task 12). Per-task `grep`/`npm test` checks are cheap sanity checks, not the gate.
- **Env-only worker path** (no `DATABASE_URL`) is intentionally unchanged: with no pool, `modelKeyResolver` returns `null`, and the provider's key is still picked up from `process.env` by `runCustomPrompt` (which merges `process.env`).
- **FK `ON DELETE RESTRICT`** means deleting an org secret bound to a model raises Postgres error `23503`. The org-secrets delete route currently does not translate that into a friendly message — out of scope for this plan, but worth a follow-up so admins see "secret is in use by a coding model" instead of a 500.
