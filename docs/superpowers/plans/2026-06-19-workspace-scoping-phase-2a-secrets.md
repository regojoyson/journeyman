# Workspace Scoping — Phase 2a: Secrets Cutover — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move secrets from user/org scoping to **workspace/org** scoping — drop the `user_id` tier and the env-var/global tier from the resolve path; a secret row is org-scoped (`workspace_id IS NULL`) or workspace-scoped; runtime resolution becomes **Workspace > Org**.

**Architecture:** `jm_secrets.user_id` → `workspace_id`. `SecretScope` becomes `"workspace" | "org"`. `resolveSecrets`/`resolveBindings` read the workspace from `RunContext.workspace` (added in Phase 1) instead of `ctx.user.id`; when no workspace is in context (`workspaceId = null`) resolution falls back to the org tier only — so the runtime keeps working before the Flows cutover wires an instance's workspace. All direct consumers (mcp resolver, orchestrator worker, webhook secret lookup, `flows.ts`, web + flow-editor clients) are updated in this plan so the build stays green.

**Tech Stack:** TypeScript (ESM, `.ts` imports), PostgreSQL 16 via `pg`, Fastify 5, vitest 4. Migrations are append-only `0NN_name.sql`.

**Depends on:** Phase 1 (merged) — `jm_workspaces`, `jm_workspace_members`, `RunContext.workspace`, `makeRequireWorkspacePermission`, `makeRequireOrgRole`, `can()`.

**Migration number:** `049` (047 is taken twice — `047_workspaces` + `047_agent_safety`; `048_audit_log` exists).

**Clean break:** Existing user-scoped secret rows are deleted by the migration (not migrated). Org-scoped rows are preserved.

**Scope guard:** This is one of several Phase 2 per-resource plans. Do NOT change mcp/skills/agents/etc. scoping here beyond the minimal call-site edits needed to keep the build compiling (explicitly listed in Task 7). Runtime *workspace-tier* secret resolution lights up fully only once the Flows cutover populates an instance's `workspaceId`; until then `workspaceId` is null at runtime and org-tier secrets resolve (intended intermediate state).

---

## File Structure

**Create:**
- `packages/migrations/src/sql/049_secrets_workspace_scope.sql` — drop user secrets, swap `user_id`→`workspace_id`.
- `packages/secrets/src/db.test.ts` — fakeDb tests for the rewritten db functions.
- `packages/secrets/src/resolver.test.ts` — workspace>org cascade tests.

**Modify:**
- `packages/core/src/types/secrets.types.ts` — `SecretScope`, `SecretRecord`.
- `packages/core/src/types/flow.types.ts` — `SecretBinding` scope union.
- `packages/secrets/src/db.ts` — workspace functions, rewritten SQL, drop user/global helpers from resolve path.
- `packages/secrets/src/resolver.ts` — workspace>org, drop global.
- `packages/secrets/src/visibility.ts` — query `workspace_id`, drop global tag.
- `packages/secrets/src/resolve-bindings.ts` — workspace/org pinned modes.
- `packages/secrets/src/routes/` — workspace routes, keep org routes, drop `/me/*`, promote workspace→org, workspace-scoped resolve + visible-names.
- `packages/mcp/src/resolver.ts` — `ResolveCtx.userId`→`workspaceId`.
- `packages/orchestrator/src/cli-worker.ts` — build resolve ctx with `workspace` instead of `user`.
- `packages/api-server/src/services/webhook-secret-lookup.ts` — workspace branch / org SQL.
- `packages/api-server/src/routes/flows.ts` — scope value strings.
- `packages/web/src/api/secrets.ts` + `packages/flow-editor/src/api/secrets.ts` — workspace URLs.

---

## Task 1: Core type changes

**Files:**
- Modify: `packages/core/src/types/secrets.types.ts`
- Modify: `packages/core/src/types/flow.types.ts`

- [ ] **Step 1: Update `SecretScope` and `SecretRecord`**

In `packages/core/src/types/secrets.types.ts`, replace:

```typescript
export type SecretScope = "user" | "org" | "global";
```

with:

```typescript
export type SecretScope = "workspace" | "org";
```

and in `SecretRecord` replace the `userId` field:

```typescript
  userId: string | null;
```

with:

```typescript
  workspaceId: string | null;
```

- [ ] **Step 2: Update `SecretBinding`**

In `packages/core/src/types/flow.types.ts`, the pinned binding's `scope` now uses the narrowed `SecretScope` automatically (it references `SecretScope`). Confirm the type reads:

```typescript
export type SecretBinding =
  | { mode: "auto" }
  | { mode: "pinned"; scope: SecretScope; name: string };
```

No literal change needed if it already references `SecretScope`; if it inlines `"user" | "org" | "global"`, replace with `SecretScope`.

- [ ] **Step 3: Typecheck core (expect downstream breakage elsewhere, core itself compiles)**

Run: `npm run typecheck -w @journeyman/core`
Expected: PASS (core has no internal user-scope usage).

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/types/secrets.types.ts packages/core/src/types/flow.types.ts
git commit -m "feat(core): secrets scope = workspace|org; SecretRecord.workspaceId"
```

---

## Task 2: Migration 049 — swap user_id → workspace_id

**Files:**
- Create: `packages/migrations/src/sql/049_secrets_workspace_scope.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 049_secrets_workspace_scope.sql
-- Workspace scoping for secrets. Clean break: user-scoped secret rows are dropped
-- (not migrated). Org-scoped rows (user_id IS NULL) are preserved as org secrets.

-- 1. Drop user-scoped rows (clean break — not carried into the workspace model).
DELETE FROM jm_secrets WHERE user_id IS NOT NULL;

-- 2. Drop the old scope constraint + index that reference user_id.
ALTER TABLE jm_secrets DROP CONSTRAINT IF EXISTS jm_secrets_scope_unique;
DROP INDEX IF EXISTS idx_jm_secrets_org_user;

-- 3. Swap the scope column.
ALTER TABLE jm_secrets DROP COLUMN user_id;
ALTER TABLE jm_secrets
  ADD COLUMN workspace_id UUID REFERENCES jm_workspaces(id) ON DELETE CASCADE;

-- 4. New scope rules: workspace_id IS NULL => org secret; else workspace secret.
--    Unique per (org_id, workspace_id, name), treating NULL workspace as a value.
ALTER TABLE jm_secrets
  ADD CONSTRAINT jm_secrets_scope_unique
  UNIQUE NULLS NOT DISTINCT (org_id, workspace_id, name);

CREATE INDEX IF NOT EXISTS idx_jm_secrets_org_workspace
  ON jm_secrets (org_id, workspace_id);
```

- [ ] **Step 2: Apply and verify**

> Requires dev Postgres (`npm run infra:up` or the postgres service) on `localhost:5433`.

Run: `npm run migrate`
Expected: `applying 049_secrets_workspace_scope` then `migrations done`.

- [ ] **Step 3: Verify the new shape**

Run:
```bash
PG=$(docker ps -qf name=journeyman-dev-postgres)
docker exec -i "$PG" psql -U postgres -d journeyman -c "\d jm_secrets" \
  -c "SELECT conname FROM pg_constraint WHERE conrelid='jm_secrets'::regclass AND conname='jm_secrets_scope_unique';"
```
Expected: a `workspace_id uuid` column (no `user_id`); the `jm_secrets_scope_unique` constraint present.

- [ ] **Step 4: Commit**

```bash
git add packages/migrations/src/sql/049_secrets_workspace_scope.sql
git commit -m "feat(migrations): 049 secrets workspace_id scope (drop user_id)"
```

---

## Task 3: Rewrite `db.ts` (workspace functions + resolve SQL)

**Files:**
- Modify: `packages/secrets/src/db.ts`

- [ ] **Step 1: Replace org/user insert + list functions with org/workspace**

Replace `insertUserSecret` and `listUserSecrets` (and adjust `insertOrgSecret`/`listOrgSecrets` row mapping to use `workspace_id`). The insert SQL column list changes from `user_id` to `workspace_id`:

```typescript
export interface InsertInput {
  orgId: string;
  name: string;
  value: string;
  description?: string | null;
  createdBy: string;
}

export async function insertOrgSecret(pool: Pool, input: InsertInput): Promise<SecretRecord> {
  validateName(input.name);
  const sealed = seal(input.value);
  const r = await pool.query(
    `INSERT INTO jm_secrets (org_id, workspace_id, name, description, ciphertext, iv, auth_tag, created_by)
     VALUES ($1, NULL, $2, $3, $4, $5, $6, $7)
     RETURNING id, org_id, workspace_id, name, description, created_by, created_at, updated_at`,
    [input.orgId, input.name, input.description ?? null, sealed.ciphertext, sealed.iv, sealed.authTag, input.createdBy],
  ).catch(rethrowDuplicate);
  return rowToRecord(r.rows[0]);
}

export async function insertWorkspaceSecret(
  pool: Pool,
  input: InsertInput & { workspaceId: string },
): Promise<SecretRecord> {
  validateName(input.name);
  const sealed = seal(input.value);
  const r = await pool.query(
    `INSERT INTO jm_secrets (org_id, workspace_id, name, description, ciphertext, iv, auth_tag, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, org_id, workspace_id, name, description, created_by, created_at, updated_at`,
    [input.orgId, input.workspaceId, input.name, input.description ?? null,
     sealed.ciphertext, sealed.iv, sealed.authTag, input.createdBy],
  ).catch(rethrowDuplicate);
  return rowToRecord(r.rows[0]);
}

export async function listOrgSecrets(pool: Pool, orgId: string): Promise<SecretRecord[]> {
  const r = await pool.query(
    `SELECT id, org_id, workspace_id, name, description, created_by, created_at, updated_at
     FROM jm_secrets WHERE org_id = $1 AND workspace_id IS NULL ORDER BY name`,
    [orgId],
  );
  return r.rows.map(rowToRecord);
}

export async function listWorkspaceSecrets(pool: Pool, workspaceId: string): Promise<SecretRecord[]> {
  const r = await pool.query(
    `SELECT id, org_id, workspace_id, name, description, created_by, created_at, updated_at
     FROM jm_secrets WHERE workspace_id = $1 ORDER BY name`,
    [workspaceId],
  );
  return r.rows.map(rowToRecord);
}
```

> Update the existing `rowToRecord` helper (or inline mapping) to map `workspace_id` → `workspaceId` instead of `user_id` → `userId`. Keep `seal`/`rethrowDuplicate`/`validateName` as they are.

- [ ] **Step 2: Rewrite update/delete to be workspace-scope-aware**

```typescript
export interface UpdateInput {
  id: string;
  orgId: string;
  workspaceId: string | null; // null => org secret
  value?: string;
  description?: string | null;
}

export async function updateSecret(pool: Pool, input: UpdateInput): Promise<boolean> {
  const sets: string[] = [];
  const params: unknown[] = [input.id, input.orgId];
  const wsClause = input.workspaceId === null ? "AND workspace_id IS NULL" : "AND workspace_id = $3";
  if (input.workspaceId !== null) params.push(input.workspaceId);
  if (input.value !== undefined) {
    const sealed = seal(input.value);
    params.push(sealed.ciphertext, sealed.iv, sealed.authTag);
    sets.push(`ciphertext = $${params.length - 2}`, `iv = $${params.length - 1}`, `auth_tag = $${params.length}`);
  }
  if (input.description !== undefined) {
    params.push(input.description);
    sets.push(`description = $${params.length}`);
  }
  if (sets.length === 0) return false;
  sets.push("updated_at = now()");
  const r = await pool.query(
    `UPDATE jm_secrets SET ${sets.join(", ")} WHERE id = $1 AND org_id = $2 ${wsClause}`,
    params,
  );
  return (r.rowCount ?? 0) > 0;
}

export async function deleteSecret(
  pool: Pool, id: string, orgId: string, workspaceId: string | null,
): Promise<boolean> {
  const wsClause = workspaceId === null ? "AND workspace_id IS NULL" : "AND workspace_id = $3";
  const params: unknown[] = workspaceId === null ? [id, orgId] : [id, orgId, workspaceId];
  const r = await pool.query(
    `DELETE FROM jm_secrets WHERE id = $1 AND org_id = $2 ${wsClause}`,
    params,
  );
  return (r.rowCount ?? 0) > 0;
}
```

- [ ] **Step 3: Rewrite resolve + pinned helpers to workspace scope**

```typescript
export interface ResolverRow { name: string; workspaceId: string | null; value: string; }

export async function fetchForResolve(
  pool: Pool, orgId: string | null, workspaceId: string | null, names: string[],
): Promise<ResolverRow[]> {
  if (!orgId) return [];
  const hasWs = !!workspaceId;
  const r = await pool.query(
    `SELECT name, workspace_id, ciphertext, iv, auth_tag
       FROM jm_secrets
      WHERE org_id = $1
        AND name = ANY($2::text[])
        AND ${hasWs ? "(workspace_id = $3 OR workspace_id IS NULL)" : "workspace_id IS NULL"}`,
    hasWs ? [orgId, names, workspaceId] : [orgId, names],
  );
  return r.rows.map((row: any) => ({
    name: row.name,
    workspaceId: row.workspace_id,
    value: open({ ciphertext: row.ciphertext, iv: row.iv, authTag: row.auth_tag }),
  }));
}

export async function fetchPinnedWorkspaceSecret(
  pool: Pool, workspaceId: string, name: string,
): Promise<string | null> {
  const r = await pool.query(
    `SELECT ciphertext, iv, auth_tag FROM jm_secrets WHERE workspace_id = $1 AND name = $2`,
    [workspaceId, name],
  );
  if (!r.rows[0]) return null;
  return open({ ciphertext: r.rows[0].ciphertext, iv: r.rows[0].iv, authTag: r.rows[0].auth_tag });
}

export async function fetchPinnedOrgSecret(
  pool: Pool, orgId: string, name: string,
): Promise<string | null> {
  const r = await pool.query(
    `SELECT ciphertext, iv, auth_tag FROM jm_secrets WHERE org_id = $1 AND workspace_id IS NULL AND name = $2`,
    [orgId, name],
  );
  if (!r.rows[0]) return null;
  return open({ ciphertext: r.rows[0].ciphertext, iv: r.rows[0].iv, authTag: r.rows[0].auth_tag });
}

export async function fetchOwnWorkspaceSecret(
  pool: Pool, workspaceId: string, name: string,
): Promise<string | null> {
  return fetchPinnedWorkspaceSecret(pool, workspaceId, name);
}
```

> Delete `insertUserSecret`, `listUserSecrets`, `fetchPinnedUserSecret`, and `fetchOwnUserSecret`. Their callers are updated in Tasks 5–7.

- [ ] **Step 4: Typecheck secrets package (other files still reference old names — fixed in later tasks; this is intermediate)**

Run: `npm run typecheck -w @journeyman/secrets`
Expected: errors only in `resolver.ts`, `visibility.ts`, `resolve-bindings.ts`, `routes/*` (rewritten in Tasks 4–6). `db.ts` itself compiles.

- [ ] **Step 5: Commit**

```bash
git add packages/secrets/src/db.ts
git commit -m "feat(secrets): db functions on workspace_id scope (drop user helpers)"
```

---

## Task 4: Rewrite resolver, visibility, bindings (TDD for resolver)

**Files:**
- Create: `packages/secrets/src/resolver.test.ts`
- Modify: `packages/secrets/src/resolver.ts`
- Modify: `packages/secrets/src/visibility.ts`
- Modify: `packages/secrets/src/resolve-bindings.ts`

- [ ] **Step 1: Write the failing resolver test**

```typescript
// packages/secrets/src/resolver.test.ts
import { describe, it, expect, vi } from "vitest";
import type { RunContext } from "@journeyman/core";

vi.mock("./db.ts", () => ({
  validateName: () => {},
  fetchForResolve: vi.fn(),
}));
import { fetchForResolve } from "./db.ts";
import { resolveSecrets } from "./resolver.ts";

function ctx(workspaceId: string | null): RunContext {
  return {
    user: { id: "u1", username: "a" },
    org: { id: "o1", slug: "acme" },
    membershipId: "m1", role: "member", isPlatformAdmin: false, tokenKind: "access-jwt",
    workspace: workspaceId ? { id: workspaceId, orgId: "o1", role: "contributor", permissions: [] } : undefined,
  };
}

describe("resolveSecrets (workspace > org)", () => {
  it("workspace-scope row wins over org-scope row", async () => {
    (fetchForResolve as any).mockResolvedValue([
      { name: "API_KEY", workspaceId: null, value: "org-val" },
      { name: "API_KEY", workspaceId: "w1", value: "ws-val" },
    ]);
    const r = await resolveSecrets({ pool: {} as any, ctx: ctx("w1"), names: ["API_KEY"] });
    expect(r.values.API_KEY).toBe("ws-val");
  });

  it("falls back to org-scope when no workspace row", async () => {
    (fetchForResolve as any).mockResolvedValue([{ name: "API_KEY", workspaceId: null, value: "org-val" }]);
    const r = await resolveSecrets({ pool: {} as any, ctx: ctx("w1"), names: ["API_KEY"] });
    expect(r.values.API_KEY).toBe("org-val");
  });

  it("with no workspace in context, resolves org tier only", async () => {
    (fetchForResolve as any).mockResolvedValue([{ name: "API_KEY", workspaceId: null, value: "org-val" }]);
    const r = await resolveSecrets({ pool: {} as any, ctx: ctx(null), names: ["API_KEY"] });
    expect(r.values.API_KEY).toBe("org-val");
    // fetchForResolve called with workspaceId = null
    expect((fetchForResolve as any).mock.calls[0][2]).toBeNull();
  });

  it("throws MissingSecretsError when unresolved", async () => {
    (fetchForResolve as any).mockResolvedValue([]);
    await expect(resolveSecrets({ pool: {} as any, ctx: ctx("w1"), names: ["NOPE"] })).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run packages/secrets/src/resolver.test.ts`
Expected: FAIL (resolver still references `ctx.user.id` / global; assertions on workspace precedence fail or import errors).

- [ ] **Step 3: Rewrite `resolver.ts`**

```typescript
import type { Pool } from "pg";
import type { RunContext } from "@journeyman/core";
import { MissingSecretsError } from "@journeyman/core";
import { fetchForResolve, validateName } from "./db.ts";

export interface ResolveInput { pool: Pool; ctx: RunContext; names: string[]; }
export interface ResolveResult { values: Record<string, string>; }

export async function resolveSecrets(input: ResolveInput): Promise<ResolveResult> {
  const names = Array.from(new Set(input.names));
  for (const n of names) validateName(n);
  if (names.length === 0) return { values: {} };

  const workspaceId = input.ctx.workspace?.id ?? null;
  const rows = await fetchForResolve(input.pool, input.ctx.org.id, workspaceId, names);

  // Workspace-scope row beats org-scope row, regardless of fetch order.
  const picked: Record<string, string> = {};
  for (const row of rows) {
    const isWorkspace = row.workspaceId !== null && row.workspaceId === workspaceId;
    if (isWorkspace) picked[row.name] = row.value;
    else if (picked[row.name] === undefined) picked[row.name] = row.value;
  }

  const values: Record<string, string> = {};
  const missing: string[] = [];
  for (const name of names) {
    if (picked[name] !== undefined) values[name] = picked[name];
    else missing.push(name);
  }
  if (missing.length > 0) throw new MissingSecretsError(missing);
  return { values };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run packages/secrets/src/resolver.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Rewrite `visibility.ts`**

```typescript
import type { Pool } from "pg";
import type { RunContext, SecretScope } from "@journeyman/core";

export interface VisibleSecret { name: string; scope: SecretScope; }

export async function listVisibleSecrets(pool: Pool, ctx: RunContext): Promise<VisibleSecret[]> {
  const workspaceId = ctx.workspace?.id ?? null;
  const r = await pool.query<{ name: string; workspace_id: string | null }>(
    `SELECT name, workspace_id FROM jm_secrets
      WHERE org_id = $1 AND (workspace_id IS NULL ${workspaceId ? "OR workspace_id = $2" : ""})`,
    workspaceId ? [ctx.org.id, workspaceId] : [ctx.org.id],
  );
  const out: VisibleSecret[] = r.rows.map(row => ({
    name: row.name,
    scope: (row.workspace_id ? "workspace" : "org") as SecretScope,
  }));
  out.sort((a, b) => a.name.localeCompare(b.name) || a.scope.localeCompare(b.scope));
  return out;
}

export async function listVisibleNames(pool: Pool, ctx: RunContext): Promise<string[]> {
  return [...new Set((await listVisibleSecrets(pool, ctx)).map(s => s.name))].sort();
}
```

> Drops `listGlobalSecretNames()` usage and the `"global"` tag.

- [ ] **Step 6: Rewrite `resolve-bindings.ts` pinned branch**

Replace the pinned-scope block so it handles `workspace` and `org` only:

```typescript
    if (binding.mode === "pinned") {
      validateName(binding.name);
      let v: string | null = null;
      if (binding.scope === "workspace") {
        const wsId = ctx.workspace?.id;
        v = wsId ? await fetchPinnedWorkspaceSecret(pool, wsId, binding.name) : null;
      } else if (binding.scope === "org") {
        v = await fetchPinnedOrgSecret(pool, ctx.org.id, binding.name);
      }
      if (v == null) { missing.push(slot.name); continue; }
      values[slot.name] = v;
      continue;
    }
```

Update the imports at the top of `resolve-bindings.ts`: remove `readGlobalSecrets` and `fetchPinnedUserSecret`; add `fetchPinnedWorkspaceSecret`. The `"auto"` branch (calls `resolveSecrets`) is unchanged.

- [ ] **Step 7: Typecheck secrets package**

Run: `npm run typecheck -w @journeyman/secrets`
Expected: errors now only in `routes/*` (Task 5/6). `resolver.ts`, `visibility.ts`, `resolve-bindings.ts` compile.

- [ ] **Step 8: Commit**

```bash
git add packages/secrets/src/resolver.ts packages/secrets/src/resolver.test.ts packages/secrets/src/visibility.ts packages/secrets/src/resolve-bindings.ts
git commit -m "feat(secrets): workspace>org resolution; drop user+global tiers"
```

---

## Task 5: Workspace + org secret routes

**Files:**
- Modify: `packages/secrets/src/routes/index.ts`
- Modify: `packages/secrets/src/routes/org-secrets.ts`
- Create: `packages/secrets/src/routes/workspace-secrets.ts`
- Delete: `packages/secrets/src/routes/user-secrets.ts`

- [ ] **Step 1: Create workspace secret routes**

```typescript
// packages/secrets/src/routes/workspace-secrets.ts
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { makeRequireAuth, makeRequireWorkspacePermission } from "@journeyman/identity";
import { DuplicateSecretError } from "@journeyman/core";
import {
  insertWorkspaceSecret, listWorkspaceSecrets, updateSecret, deleteSecret,
} from "../db.ts";

export async function registerWorkspaceSecretRoutes(app: FastifyInstance, pool: Pool) {
  const requireAuth = makeRequireAuth({ pool });
  const requirePerm = makeRequireWorkspacePermission({ pool });

  app.get("/api/workspaces/:wsId/secrets",
    { preHandler: [requireAuth(), requirePerm("resource.read")] },
    async (req) => {
      const { wsId } = req.params as { wsId: string };
      const rows = await listWorkspaceSecrets(pool, wsId);
      return rows.map(s => ({ id: s.id, name: s.name, description: s.description,
        createdBy: s.createdBy, createdAt: s.createdAt, updatedAt: s.updatedAt }));
    });

  app.post("/api/workspaces/:wsId/secrets",
    { preHandler: [requireAuth(), requirePerm("resource.write")] },
    async (req, reply) => {
      const { wsId } = req.params as { wsId: string };
      const ctx = req.runContext!;
      const { name, value, description } = req.body as { name: string; value: string; description?: string };
      try {
        const rec = await insertWorkspaceSecret(pool, {
          orgId: ctx.workspace!.orgId, workspaceId: wsId, name, value,
          description: description ?? null, createdBy: ctx.user.id,
        });
        reply.code(201);
        return { id: rec.id, name: rec.name, description: rec.description, createdAt: rec.createdAt };
      } catch (err) {
        if (err instanceof DuplicateSecretError) return reply.code(409).send({ error: "duplicate" });
        return reply.code(400).send({ error: (err as Error).message });
      }
    });

  app.patch("/api/workspaces/:wsId/secrets/:id",
    { preHandler: [requireAuth(), requirePerm("resource.write")] },
    async (req, reply) => {
      const { wsId, id } = req.params as { wsId: string; id: string };
      const ctx = req.runContext!;
      const { value, description } = req.body as { value?: string; description?: string };
      const ok = await updateSecret(pool, { id, orgId: ctx.workspace!.orgId, workspaceId: wsId, value, description });
      if (!ok) return reply.code(404).send({ error: "not_found" });
      return { ok: true };
    });

  app.delete("/api/workspaces/:wsId/secrets/:id",
    { preHandler: [requireAuth(), requirePerm("resource.delete")] },
    async (req, reply) => {
      const { wsId, id } = req.params as { wsId: string; id: string };
      const ctx = req.runContext!;
      const ok = await deleteSecret(pool, id, ctx.workspace!.orgId, wsId);
      if (!ok) return reply.code(404).send({ error: "not_found" });
      return { ok: true };
    });
}
```

> Confirm `DuplicateSecretError` is exported from `@journeyman/core` (it's thrown by `rethrowDuplicate` in db.ts). If it lives in the secrets package instead, import it from there.

- [ ] **Step 2: Update org-secrets routes to use `requireOrgRole`**

In `packages/secrets/src/routes/org-secrets.ts`, keep the four `/api/orgs/:orgId/secrets` routes but swap the org-tier delete/update calls to pass `workspaceId: null`:

- `updateSecret(pool, { id, orgId, workspaceId: null, value, description })`
- `deleteSecret(pool, id, orgId, null)`

Leave `insertOrgSecret`/`listOrgSecrets` calls as-is (already org-tier). Auth stays admin (existing `requireAuth({ role: "admin" })` is fine; optionally switch to `makeRequireOrgRole({pool})("admin")` for consistency).

- [ ] **Step 3: Delete user-secrets routes + update registration**

Delete `packages/secrets/src/routes/user-secrets.ts`. In `packages/secrets/src/routes/index.ts`:

```typescript
import { registerOrgSecretRoutes } from "./org-secrets.ts";
import { registerWorkspaceSecretRoutes } from "./workspace-secrets.ts";
import { registerResolveRoutes } from "./resolve.ts";
import { registerVisibleNamesRoutes } from "./visible-names.ts";
import { registerPromoteSecretRoute } from "./promote.ts";

export async function registerSecretsRoutes(app: FastifyInstance, pool: Pool) {
  await registerOrgSecretRoutes(app, pool);
  await registerWorkspaceSecretRoutes(app, pool);
  await registerResolveRoutes(app, pool);
  await registerVisibleNamesRoutes(app, pool);
  await registerPromoteSecretRoute(app, pool);
}
```

> Removes `registerUserSecretRoutes` and `registerGlobalSecretRoutes` from the chain. (Keep `global-secrets.ts`/`global.ts` files for the admin env-introspection route only if still wired elsewhere; otherwise delete `global-secrets.ts` and drop its import.)

- [ ] **Step 4: Commit**

```bash
git add packages/secrets/src/routes/
git rm packages/secrets/src/routes/user-secrets.ts
git commit -m "feat(secrets): workspace secret routes; org routes; drop /me routes"
```

---

## Task 6: Workspace-scoped resolve, visible-names, promote

**Files:**
- Modify: `packages/secrets/src/routes/resolve.ts`
- Modify: `packages/secrets/src/routes/visible-names.ts`
- Modify: `packages/secrets/src/routes/promote.ts`

- [ ] **Step 1: Move resolve + visible-names under `/workspaces/:wsId`**

In `resolve.ts`, change the route to `/api/workspaces/:wsId/secrets/_resolve` with `preHandler: [requireAuth(), requirePerm("resource.read")]`. The handler uses `req.runContext!` (now carrying `workspace`) and calls `resolveSecrets({ pool, ctx, names: [n] })` unchanged (resolver reads `ctx.workspace`).

In `visible-names.ts`, change to `/api/workspaces/:wsId/secrets/_visible-names` with the same preHandlers; body unchanged (`listVisibleSecrets(pool, ctx)`).

- [ ] **Step 2: Rewrite promote to workspace → org**

```typescript
// packages/secrets/src/routes/promote.ts
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { makeRequireAuth, makeRequireWorkspacePermission } from "@journeyman/identity";
import { fetchPinnedWorkspaceSecret, insertOrgSecret } from "../db.ts";

export async function registerPromoteSecretRoute(app: FastifyInstance, pool: Pool) {
  const requireAuth = makeRequireAuth({ pool });
  const requirePerm = makeRequireWorkspacePermission({ pool });

  app.post("/api/workspaces/:wsId/secrets/:secretName/promote-to-org",
    { preHandler: [requireAuth(), requirePerm("members.manage")] },
    async (req, reply) => {
      const { wsId, secretName } = req.params as { wsId: string; secretName: string };
      const ctx = req.runContext!;
      const value = await fetchPinnedWorkspaceSecret(pool, wsId, secretName);
      if (value === null) return reply.code(404).send({ error: "not_found" });
      const rec = await insertOrgSecret(pool, {
        orgId: ctx.workspace!.orgId, name: secretName, value,
        description: `Promoted from workspace ${wsId} by ${ctx.user.id}`, createdBy: ctx.user.id,
      });
      reply.code(201);
      return { id: rec.id, name: rec.name };
    });
}
```

- [ ] **Step 3: Typecheck secrets package — should now be clean**

Run: `npm run typecheck -w @journeyman/secrets`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/secrets/src/routes/resolve.ts packages/secrets/src/routes/visible-names.ts packages/secrets/src/routes/promote.ts
git commit -m "feat(secrets): workspace-scoped resolve/visible-names; promote workspace->org"
```

---

## Task 7: Update consumers to keep the build green

**Files:**
- Modify: `packages/mcp/src/resolver.ts`
- Modify: `packages/orchestrator/src/cli-worker.ts`
- Modify: `packages/api-server/src/services/webhook-secret-lookup.ts`
- Modify: `packages/api-server/src/routes/flows.ts`
- Modify: `packages/web/src/api/secrets.ts`
- Modify: `packages/flow-editor/src/api/secrets.ts`

- [ ] **Step 1: mcp resolver — `userId` → `workspaceId`**

In `packages/mcp/src/resolver.ts`:

```typescript
export interface ResolveCtx { orgId: string; workspaceId: string | null; }

// ...inside resolveMcpInstances:
const secretRows = allSecretNames.length > 0
  ? await fetchForResolve(pool, ctx.orgId, ctx.workspaceId, allSecretNames)
  : [];

const secretValues: Record<string, string> = {};
for (const row of secretRows) {
  const isWorkspace = row.workspaceId !== null && row.workspaceId === ctx.workspaceId;
  if (isWorkspace) secretValues[row.name] = row.value;
  else if (secretValues[row.name] === undefined) secretValues[row.name] = row.value;
}
```

> Find callers of `resolveMcpInstances` (grep `resolveMcpInstances`) and update each to pass `{ orgId, workspaceId }`. In the worker path, source `workspaceId` from the same place as Step 2 (null until Flows cutover).

- [ ] **Step 2: orchestrator worker — build resolve ctx with `workspace`**

In `packages/orchestrator/src/cli-worker.ts` `resolveStepSecrets` (~line 330), set the synthetic ctx's workspace from the run context. Until the Flows cutover adds an instance `workspaceId`, pass `undefined` (org-tier resolution):

```typescript
const runCtx = {
  user: { id: ctx.userId ?? "", username: "" },
  org: { id: ctx.orgId ?? "", slug: "" },
  membershipId: "", role: "member" as const, isPlatformAdmin: false,
  tokenKind: "access-jwt" as const,
  workspace: ctx.workspaceId
    ? { id: ctx.workspaceId, orgId: ctx.orgId ?? "", role: null, permissions: [] }
    : undefined,
};
const result = await resolveBindings({ pool, ctx: runCtx, bindings, slots });
```

> If the task/run `ctx` type has no `workspaceId` field yet, add an optional `workspaceId?: string` to it; it stays undefined until the Flows cutover populates it. Also update the `resolveMcpInstances` call in the worker to pass `workspaceId: ctx.workspaceId ?? null`.

- [ ] **Step 3: webhook-secret-lookup — workspace/org SQL**

In `packages/api-server/src/services/webhook-secret-lookup.ts`, replace the user-scope branch. Webhooks become workspace-scoped (their own cutover plan), but to compile now: change the org-scope query's `user_id IS NULL` to `workspace_id IS NULL`, and replace the `scope.userId` branch with a workspace lookup keyed by `workspace_id` (the `WebhookScope` type changes in the webhooks cutover; for now, if `scope` still has `userId`, map it through `workspace_id` or guard it). Also update `secretExistsInOrgScope` to use `workspace_id IS NULL` and drop the `readGlobalSecrets` short-circuit.

```typescript
// org-tier existence check:
const r = await pool.query(
  `SELECT 1 FROM jm_secrets WHERE org_id = $1 AND workspace_id IS NULL AND name = $2 LIMIT 1`,
  [orgId, name],
);
return (r.rowCount ?? 0) > 0;
```

> This file couples to `WebhookScope`. If the webhook scope type isn't migrated yet, keep a minimal compiling shim and add a `// TODO(webhooks cutover)` note; the Webhooks plan owns the full fix.

- [ ] **Step 4: flows.ts — scope value strings**

In `packages/api-server/src/routes/flows.ts`, the `listVisibleSecrets` calls are unchanged, but any code comparing `v.scope` to `"user"`/`"global"` must use `"workspace"`/`"org"`. Update the `visibleByScopeName` set construction and any scope checks to the new `SecretScope` values.

- [ ] **Step 5: clients — workspace URLs**

In `packages/web/src/api/secrets.ts` and `packages/flow-editor/src/api/secrets.ts`, change endpoints:
- `createUserSecret(...)` → `createWorkspaceSecret(wsId, name, value, description?)` → `POST /api/workspaces/${wsId}/secrets`
- `fetchVisibleSecrets(orgId)` → `fetchVisibleSecrets(wsId)` → `GET /api/workspaces/${wsId}/secrets/_visible-names`
- `promoteSecretToOrg(orgId, name)` → `promoteSecretToOrg(wsId, name)` → `POST /api/workspaces/${wsId}/secrets/${name}/promote-to-org`
- Org-secret calls stay on `/api/orgs/${orgId}/secrets`.

> The `VisibleSecret.scope` type on the client also narrows to `"workspace" | "org"`. Update any UI that renders the `"user"`/`"global"` labels. (Full page consolidation is Phase 3 §9b — here, just keep the client compiling and pointed at the new routes.)

- [ ] **Step 6: Build-wide check**

Run: `npm run typecheck` then `npm run check:boundaries`
Expected: PASS across all workspaces.

- [ ] **Step 7: Commit**

```bash
git add packages/mcp/src/resolver.ts packages/orchestrator/src/cli-worker.ts packages/api-server/src/services/webhook-secret-lookup.ts packages/api-server/src/routes/flows.ts packages/web/src/api/secrets.ts packages/flow-editor/src/api/secrets.ts
git commit -m "refactor: update secret-resolution consumers to workspace scope"
```

---

## Task 8: db tests + full verification

**Files:**
- Create: `packages/secrets/src/db.test.ts`
- Modify: `packages/secrets/package.json` (add `"test": "vitest run"` + `vitest` devDep if absent)

- [ ] **Step 1: Write fakeDb tests for db.ts**

```typescript
// packages/secrets/src/db.test.ts
import { describe, it, expect } from "vitest";
import { insertWorkspaceSecret, listOrgSecrets, fetchForResolve } from "./db.ts";

type Call = { text: string; params?: unknown[] };
function fakeDb(responder: (c: Call, i: number) => { rows: any[] }) {
  const calls: Call[] = [];
  return { calls, async query(text: string, params?: unknown[]) { calls.push({ text, params }); return responder({ text, params }, calls.length - 1); } } as any;
}
const ROW = { id: "s1", org_id: "o1", workspace_id: "w1", name: "API_KEY", description: null, created_by: "u1", created_at: "2026-06-19T00:00:00Z", updated_at: "2026-06-19T00:00:00Z" };

describe("secrets db (workspace scope)", () => {
  it("insertWorkspaceSecret writes workspace_id and maps record", async () => {
    const db = fakeDb(() => ({ rows: [ROW] }));
    const rec = await insertWorkspaceSecret(db, { orgId: "o1", workspaceId: "w1", name: "API_KEY", value: "v", createdBy: "u1" });
    expect(rec.workspaceId).toBe("w1");
    expect(db.calls[0].text).toMatch(/insert into jm_secrets/i);
    // params: org, workspace, name, description, ciphertext, iv, authtag, createdBy
    expect(db.calls[0].params?.[1]).toBe("w1");
  });

  it("listOrgSecrets filters workspace_id IS NULL", async () => {
    const db = fakeDb(() => ({ rows: [] }));
    await listOrgSecrets(db, "o1");
    expect(db.calls[0].text).toMatch(/workspace_id is null/i);
  });

  it("fetchForResolve with workspaceId uses (workspace_id = $3 OR workspace_id IS NULL)", async () => {
    const db = fakeDb(() => ({ rows: [] }));
    await fetchForResolve(db, "o1", "w1", ["API_KEY"]);
    expect(db.calls[0].text).toMatch(/workspace_id = \$3 or workspace_id is null/i);
    expect(db.calls[0].params).toEqual(["o1", ["API_KEY"], "w1"]);
  });

  it("fetchForResolve without workspaceId queries org tier only", async () => {
    const db = fakeDb(() => ({ rows: [] }));
    await fetchForResolve(db, "o1", null, ["API_KEY"]);
    expect(db.calls[0].text).toMatch(/workspace_id is null/i);
    expect(db.calls[0].params).toEqual(["o1", ["API_KEY"]]);
  });
});
```

- [ ] **Step 2: Run secrets tests**

Run: `npm test -w @journeyman/secrets`
Expected: PASS (`db.test.ts` + `resolver.test.ts`).

- [ ] **Step 3: Apply migration + manual route smoke (optional but recommended)**

With dev Postgres up and migrated, bootstrap (if needed) gives a default workspace. Smoke-test that a workspace secret can be created and resolved via the new routes (curl or the web UI). Confirm an org secret still resolves when no workspace secret of that name exists.

- [ ] **Step 4: Full repo check**

Run: `npm run typecheck && npm run check:boundaries`
Expected: PASS. (Note: the pre-existing `bg-black` theme-lint in `EditAgentModal.tsx` still fails `check:theme-colors` — unrelated to this work; do not let it block this plan.)

- [ ] **Step 5: Commit**

```bash
git add packages/secrets/src/db.test.ts packages/secrets/package.json package-lock.json
git commit -m "test(secrets): workspace-scope db + resolver tests; wire vitest"
```

---

## Self-Review (completed during planning)

**Spec coverage (spec §4 secrets row → tasks):** schema swap (Task 2), db functions (Task 3), resolver workspace>org + drop global (Task 4), routes workspace+org + drop /me + promote workspace→org (Tasks 5–6), consumer updates (Task 7), tests (Tasks 4, 8). `SecretScope`/`SecretRecord`/`SecretBinding` (Task 1).

**Type consistency:** `ResolverRow.workspaceId`, `SecretRecord.workspaceId`, `ResolveCtx.workspaceId`, `fetchForResolve(pool, orgId, workspaceId, names)`, and `resolveSecrets` reading `ctx.workspace?.id` are consistent across db.ts, resolver.ts, mcp resolver, and the worker. `fetchPinnedWorkspaceSecret(pool, workspaceId, name)` and `fetchPinnedOrgSecret(pool, orgId, name)` signatures match their callers in resolve-bindings.ts and promote.ts.

**Placeholder scan:** none — code steps contain full code; run steps have exact commands + expected output. Two explicitly-flagged couplings (webhook scope, runtime workspaceId) are intentional dependencies on the Webhooks and Flows cutover plans, with a defined compiling intermediate (org-tier resolution when workspaceId is null), not placeholders.

**Dependency notes:** (1) Runtime *workspace-tier* resolution requires the Flows cutover to populate an instance's `workspaceId`; until then `workspaceId` is null and org-tier resolves — verified intermediate, build stays green. (2) `webhook-secret-lookup.ts` fully resolves in the Webhooks cutover; this plan keeps it compiling. (3) `DuplicateSecretError` import source must be confirmed (core vs secrets package) in Task 5 Step 1.

**Out of scope (other Phase 2 plans):** mcp/skills/custom-steps/flows/agents/connections/webhooks scope migrations; flow/instance grants removal; builder inventory; Phase 3 UI page consolidation.
