# Workspace Scoping — Phase 2b: Sandboxes Cutover — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drop the `user` sandbox tier. A sandbox is **system**-scoped (platform default) or **org**-scoped. Visibility/resolution stays Org + System (no user tier). No workspace tier yet (deferred per spec §4).

**Architecture:** `jm_sandboxes` keeps its `scope` TEXT column + `org_id`, but `user_id` and `scope='user'` are removed. `SandboxScope` becomes `"org" | "system"`. The list/fetch SQL drops the `OR (scope='user' …)` clause. CRUD becomes org-only (no `/me/*` routes). Unlike secrets, sandboxes have **no workspace tier and no `wsId` dependency**, so the web client is fully updated here.

**Tech Stack:** TypeScript (ESM), PostgreSQL 16 via `pg`, Fastify 5, vitest 4.

**Depends on:** Phase 1 (merged). Independent of Phase 2a.

**Migration number:** `050`.

**Clean break:** Existing `scope='user'` sandbox rows are deleted by the migration. System and org rows are preserved.

**Scope guard:** One of the Phase 2 per-resource plans. Touch only sandbox scoping and its direct consumers.

---

## File Structure

**Create:**
- `packages/migrations/src/sql/050_sandboxes_drop_user_scope.sql`

**Modify:**
- `packages/core/src/types/sandbox.types.ts` — `SandboxScope`, drop `userId` from `Sandbox`/`CreateSandboxArgs`/`UpdateSandboxArgs`.
- `packages/sandbox/src/db.ts` — drop user clauses + `userId` params; rewrite `listVisibleSandboxes`/`fetchSandboxById`.
- `packages/sandbox/src/db.test.ts` — update to org/system only.
- `packages/sandbox/src/resolver.ts` — `ResolveSandboxCtx` drops `userId`.
- `packages/sandbox/src/resolver.test.ts` — update ctx.
- `packages/sandbox/src/routes/index.ts` — remove `/users/me/sandboxes*` routes; org routes pass `userId: null` removed.
- `packages/orchestrator/src/cli-worker.ts` + `packages/orchestrator/src/sandbox/ensure-workspace.ts` — resolve ctx drops `userId`.
- `packages/api-server/src/routes/builder-chat.ts` — `listVisibleSandboxes(pool, orgId)`.
- `packages/web/src/routes/SandboxesPage.tsx` — drop `scope` prop (always org).
- `packages/web/src/api/sandboxes.ts` — drop `listMy`/`createMy` (user endpoints).
- `packages/web/src/App.tsx` — remove `/me/sandboxes` route.

---

## Task 1: Core type changes

**Files:**
- Modify: `packages/core/src/types/sandbox.types.ts`

- [ ] **Step 1: Narrow `SandboxScope` and drop `userId`**

```typescript
export type SandboxScope = "org" | "system";
```

In `interface Sandbox`, remove the `userId` field (and its comment). In `CreateSandboxArgs`, remove `userId`. In `UpdateSandboxArgs`, remove `userId`. Keep `orgId: string | null` everywhere (null for system, set for org).

- [ ] **Step 2: Typecheck core**

Run: `npm run typecheck -w @journeyman/core`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/types/sandbox.types.ts
git commit -m "feat(core): SandboxScope = org|system; drop userId"
```

---

## Task 2: Migration 050 — drop user scope

**Files:**
- Create: `packages/migrations/src/sql/050_sandboxes_drop_user_scope.sql`

- [ ] **Step 1: Write the migration**

> The scope-shape CHECK references `user_id`, so it must be replaced before dropping the column. The `scope IN (...)` value check has an auto-generated name from the original `033_workers.sql` (survived the table renames), so it is located and dropped by definition via a `DO` block.

```sql
-- 050_sandboxes_drop_user_scope.sql
-- Drop the user tier from sandboxes. Clean break: scope='user' rows are deleted.
-- System (org_id NULL) and org (org_id set) rows are preserved.

-- 1. Delete user-scoped rows.
DELETE FROM jm_sandboxes WHERE scope = 'user';

-- 2. Replace the scope-shape CHECK (it references user_id).
ALTER TABLE jm_sandboxes DROP CONSTRAINT IF EXISTS jm_sandboxes_scope_shape;

-- 3. Drop the scope-value CHECK (auto-named; locate by its definition).
DO $$
DECLARE c text;
BEGIN
  SELECT conname INTO c FROM pg_constraint
   WHERE conrelid = 'jm_sandboxes'::regclass AND contype = 'c'
     AND pg_get_constraintdef(oid) ILIKE '%scope%user%';
  IF c IS NOT NULL THEN
    EXECUTE format('ALTER TABLE jm_sandboxes DROP CONSTRAINT %I', c);
  END IF;
END $$;

-- 4. Drop the user_id column + its index.
DROP INDEX IF EXISTS idx_jm_workers_org_user;
ALTER TABLE jm_sandboxes DROP COLUMN user_id;

-- 5. Re-add narrowed checks (org | system only).
ALTER TABLE jm_sandboxes
  ADD CONSTRAINT jm_sandboxes_scope_check CHECK (scope IN ('org','system'));
ALTER TABLE jm_sandboxes
  ADD CONSTRAINT jm_sandboxes_scope_shape CHECK (
       (scope = 'system' AND org_id IS NULL)
    OR (scope = 'org'    AND org_id IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS idx_jm_sandboxes_org ON jm_sandboxes (org_id);
```

- [ ] **Step 2: Apply + verify**

Run: `npm run migrate`
Expected: `applying 050_sandboxes_drop_user_scope` then `migrations done`.

- [ ] **Step 3: Verify**

```bash
PG=$(docker ps -qf name=journeyman-dev-postgres)
docker exec -i "$PG" psql -U postgres -d journeyman \
  -c "SELECT column_name FROM information_schema.columns WHERE table_name='jm_sandboxes' AND column_name IN ('user_id','scope');" \
  -c "SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='jm_sandboxes'::regclass AND contype='c';"
```
Expected: `scope` column present, `user_id` gone; the two CHECKs reference only `org`/`system` (no `user`).

- [ ] **Step 4: Commit**

```bash
git add packages/migrations/src/sql/050_sandboxes_drop_user_scope.sql
git commit -m "feat(migrations): 050 drop sandbox user scope + user_id"
```

---

## Task 3: db.ts — drop user clauses

**Files:**
- Modify: `packages/sandbox/src/db.ts`

- [ ] **Step 1: Update `COLS` and `rowToSandbox`**

Remove `user_id` from the `COLS` constant. In `rowToSandbox`, remove the `userId: r.user_id` mapping.

- [ ] **Step 2: Rewrite insert/list/get/update/delete to org-only**

```typescript
export async function insertSandbox(db: Queryable, input: CreateSandboxArgs): Promise<Sandbox> {
  const { rows } = await db.query(
    `INSERT INTO jm_sandboxes
       (scope, org_id, name, type, execution_mode, connectivity, config, tags, enabled, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10)
     RETURNING ${COLS}`,
    [
      input.scope, input.orgId, input.name, input.type, input.executionMode,
      input.connectivity ?? null, JSON.stringify(input.config ?? {}),
      JSON.stringify(input.tags ?? []), input.enabled ?? true, input.createdBy,
    ],
  );
  return rowToSandbox(rows[0]);
}

export async function listSandboxes(db: Queryable, orgId: string): Promise<Sandbox[]> {
  const { rows } = await db.query(
    `SELECT ${COLS} FROM jm_sandboxes WHERE org_id = $1 ORDER BY name`,
    [orgId],
  );
  return rows.map(rowToSandbox);
}

export async function getSandbox(db: Queryable, id: string, orgId: string): Promise<Sandbox | null> {
  const { rows } = await db.query(
    `SELECT ${COLS} FROM jm_sandboxes WHERE id = $1 AND org_id = $2`,
    [id, orgId],
  );
  return rows[0] ? rowToSandbox(rows[0]) : null;
}
```

Update `updateSandbox` and `deleteSandbox` to drop the `userId` arg and the `user_id IS NOT DISTINCT FROM` clause:

```typescript
export interface UpdateSandboxArgs {
  id: string;
  orgId: string;
  name?: string;
  executionMode?: ExecutionMode;
  connectivity?: Connectivity | null;
  config?: Record<string, unknown>;
  tags?: string[];
  enabled?: boolean;
}
// in updateSandbox: params.push(input.id, input.orgId); ... WHERE id = $i AND org_id = $i+1
// in deleteSandbox(db, id, orgId): WHERE id = $1 AND org_id = $2
```

> `UpdateSandboxArgs` is imported from core; the core change in Task 1 already dropped `userId`. Re-declare locally only if the package defines its own. Confirm whether `UpdateSandboxArgs` lives in core (it does — `sandbox.types.ts`); then no local re-declaration is needed, just stop passing `userId`.

- [ ] **Step 3: Rewrite `listVisibleSandboxes` and `fetchSandboxById` (drop user clause)**

```typescript
/** System defaults + this org's org-scoped, enabled only. */
export async function listVisibleSandboxes(db: Queryable, orgId: string): Promise<Sandbox[]> {
  const { rows } = await db.query(
    `SELECT ${COLS} FROM jm_sandboxes
     WHERE enabled = true AND (scope = 'system' OR (scope = 'org' AND org_id = $1))
     ORDER BY scope, name`,
    [orgId],
  );
  return rows.map(rowToSandbox);
}

/** Fetch a single sandbox visible to the org (system OR org scope). */
export async function fetchSandboxById(db: Queryable, orgId: string, id: string): Promise<Sandbox | null> {
  const { rows } = await db.query(
    `SELECT ${COLS} FROM jm_sandboxes
     WHERE id = $1 AND enabled = true AND (scope = 'system' OR (scope = 'org' AND org_id = $2))`,
    [id, orgId],
  );
  return rows[0] ? rowToSandbox(rows[0]) : null;
}
```

- [ ] **Step 4: Typecheck (errors expected in routes/resolver/consumers, fixed next)**

Run: `npm run typecheck -w @journeyman/sandbox`
Expected: errors only in `resolver.ts`, `routes/index.ts` (and their tests). `db.ts` compiles.

- [ ] **Step 5: Commit**

```bash
git add packages/sandbox/src/db.ts
git commit -m "feat(sandbox): org/system-only db access (drop user clauses)"
```

---

## Task 4: resolver + resolver test

**Files:**
- Modify: `packages/sandbox/src/resolver.ts`
- Modify: `packages/sandbox/src/resolver.test.ts`

- [ ] **Step 1: Drop `userId` from `ResolveSandboxCtx`**

```typescript
export interface ResolveSandboxCtx { orgId: string; }

export async function resolveSandbox(
  db: Queryable,
  ctx: ResolveSandboxCtx,
  workerId: string | undefined,
): Promise<ResolvedSandbox> {
  if (!workerId) throw new SandboxNotFoundError("no sandbox selected for this workflow");
  const w = await fetchSandboxById(db, ctx.orgId, workerId);
  if (!w) throw new SandboxNotFoundError(`sandbox '${workerId}' not found or not visible`);
  return toResolved(w);
}
```

- [ ] **Step 2: Update `resolver.test.ts`**

Change the fake-db assertions: `fetchSandboxById` is now called with `(id, orgId)` and the SQL no longer contains `scope = 'user'`. Update the ctx in tests to `{ orgId: "o1" }` and params to `["w1", "o1"]`.

```typescript
// example expectation after change:
const rec = await resolveSandbox(db, { orgId: "o1" }, "w1");
expect(db.calls[0].params).toEqual(["w1", "o1"]);
expect(db.calls[0].text).not.toMatch(/scope = 'user'/i);
```

- [ ] **Step 3: Run resolver test**

Run: `npx vitest run packages/sandbox/src/resolver.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/sandbox/src/resolver.ts packages/sandbox/src/resolver.test.ts
git commit -m "feat(sandbox): resolver drops user scope (org+system only)"
```

---

## Task 5: routes — remove user routes

**Files:**
- Modify: `packages/sandbox/src/routes/index.ts`

- [ ] **Step 1: Delete the `/api/orgs/:orgId/users/me/sandboxes*` routes**

Remove the five user-scoped handlers (list, create, patch, rebuild, delete under `/users/me/sandboxes`).

- [ ] **Step 2: Update the org-scoped handlers to the new db signatures**

- `POST /api/orgs/:orgId/sandboxes`: `insertSandbox(pool, { scope: "org", orgId, name, type, ... , createdBy })` — drop `userId: null`.
- `GET /api/orgs/:orgId/sandboxes`: `listSandboxes(pool, orgId)` — drop the `{ orgId, userId: null }` object form.
- `GET /api/orgs/:orgId/sandboxes/:id`: `getSandbox(pool, id, orgId)`.
- `PATCH /api/orgs/:orgId/sandboxes/:id`: `updateSandbox(pool, { id, orgId, ... })` — drop `userId`.
- `DELETE /api/orgs/:orgId/sandboxes/:id`: `deleteSandbox(pool, id, orgId)`.
- `GET /api/orgs/:orgId/sandboxes/visible`: `listVisibleSandboxes(pool, orgId)` — drop `ctx.user.id`.

Keep auth as-is (`requireAuth({ role: "admin" })` for mutations, `requireAuth()` for reads). The `/visible`, `/types`, `/test-connection` routes stay.

- [ ] **Step 3: Typecheck sandbox package — clean**

Run: `npm run typecheck -w @journeyman/sandbox`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/sandbox/src/routes/index.ts
git commit -m "feat(sandbox): drop /me user routes; org routes on new signatures"
```

---

## Task 6: consumers (orchestrator, builder, web)

**Files:**
- Modify: `packages/orchestrator/src/sandbox/ensure-workspace.ts`
- Modify: `packages/orchestrator/src/cli-worker.ts`
- Modify: `packages/api-server/src/routes/builder-chat.ts`
- Modify: `packages/web/src/api/sandboxes.ts`
- Modify: `packages/web/src/routes/SandboxesPage.tsx`
- Modify: `packages/web/src/App.tsx`

- [ ] **Step 1: orchestrator resolve ctx**

In `ensure-workspace.ts`, the `deps.resolveSandbox(args.sandboxId, { userId, orgId })` call becomes `deps.resolveSandbox(args.sandboxId, { orgId: args.orgId })`. The `resolveSandbox` dep type's ctx drops `userId`. In `cli-worker.ts` the `resolveSandbox: async (sandboxId, ctx) => { ... resolveSandbox(pool, ctx, sandboxId) }` callback now receives `ctx: { orgId }`; pass it straight through. Keep `args.userId` on `ensureWorkspace` args if used elsewhere (it may still be used for secret/mcp resolution); only the sandbox resolve call drops it.

- [ ] **Step 2: builder-chat inventory**

In `packages/api-server/src/routes/builder-chat.ts`, change `listVisibleSandboxes(pool, orgId, userId)` → `listVisibleSandboxes(pool, orgId)`.

- [ ] **Step 3: web API — drop user endpoints**

In `packages/web/src/api/sandboxes.ts`, remove `listMy` and `createMy` (the `/users/me/sandboxes` calls) and the `userBase` helper. Keep `listVisible`, `listOrg`, `createOrg`, and the org-scoped get/patch/delete/rebuild. Narrow the local `SandboxScope` type to `"org" | "system"`.

- [ ] **Step 4: web SandboxesPage — drop the scope prop**

In `packages/web/src/routes/SandboxesPage.tsx`, change the signature to `props: { orgId: string }` and make `refresh()` always call `sandboxesApi.listOrg(props.orgId)`. Remove the `props.scope === "user"` branch and any "your sandboxes" vs "org sandboxes" labeling that depended on it.

- [ ] **Step 5: web App.tsx — remove the /me/sandboxes route**

In `packages/web/src/App.tsx`, delete the `<Route path="/me/sandboxes" .../>` line. Update the `/admin/sandboxes` route to `<SandboxesPage orgId={activeOrgId} />` (no `scope` prop).

> The sidebar already lists sandboxes under the org/admin section (spec §9a); the `/me/sandboxes` nav entry is removed in the Phase 3 sidebar work, but deleting the route now prevents a dead link. If a `My Sandboxes` nav item exists in `Sidebar.tsx`, remove it here too.

- [ ] **Step 6: build-wide check**

Run: `npm run typecheck && npm run check:boundaries`
Expected: PASS across all workspaces.

- [ ] **Step 7: Commit**

```bash
git add packages/orchestrator/src/sandbox/ensure-workspace.ts packages/orchestrator/src/cli-worker.ts packages/api-server/src/routes/builder-chat.ts packages/web/src/api/sandboxes.ts packages/web/src/routes/SandboxesPage.tsx packages/web/src/App.tsx
git commit -m "refactor: update sandbox consumers to org/system scope"
```

---

## Task 7: db tests + full verification

**Files:**
- Modify: `packages/sandbox/src/db.test.ts`

- [ ] **Step 1: Update db tests to org/system only**

- `listVisibleSandboxes`: now called `(db, "o1")`; assert SQL contains `scope = 'system'` and `scope = 'org'` and does NOT contain `scope = 'user'`; params `["o1"]`.
- `fetchSandboxById`: now `(db, "o1", "w1")`; params `["w1", "o1"]`; SQL has no `scope = 'user'`.
- `listSandboxes`: now `(db, "o1")`; params `["o1"]`.
- `insertSandbox`: assert the insert column list has no `user_id` and params don't include a user id.
- Update `getSandbox`/`deleteSandbox` calls to the 3-arg/`(id, orgId)` forms.

- [ ] **Step 2: Run sandbox + sandbox-record tests**

Run: `npm test -w @journeyman/sandbox`
Expected: PASS (`db.test.ts`, `resolver.test.ts`, `sandbox-record.test.ts`).

- [ ] **Step 3: ensure-workspace test**

Run: `npx vitest run packages/orchestrator/src/sandbox/ensure-workspace.test.ts`
Expected: PASS (update the test's resolveSandbox ctx to `{ orgId }` if it asserts on it).

- [ ] **Step 4: Full repo check**

Run: `npm run typecheck && npm run check:boundaries`
Expected: PASS. (Pre-existing `bg-black` theme-lint in `EditAgentModal.tsx` still fails `check:theme-colors` — unrelated; do not let it block.)

- [ ] **Step 5: Commit**

```bash
git add packages/sandbox/src/db.test.ts
git commit -m "test(sandbox): org/system-only db + resolver tests"
```

---

## Self-Review (completed during planning)

**Spec coverage (§4 sandboxes row):** scope `system+org`, drop user → migration `050` (Task 2) + types (Task 1) + db (Task 3) + resolver (Task 4) + routes (Task 5) + consumers (Task 6) + tests (Tasks 4,7). No workspace tier (deferred per §4). Sandboxes stay under `/orgs/:orgId/sandboxes` (spec §9b).

**Type consistency:** `listVisibleSandboxes(db, orgId)`, `fetchSandboxById(db, orgId, id)`, `getSandbox(db, id, orgId)`, `deleteSandbox(db, id, orgId)`, `ResolveSandboxCtx = { orgId }`, and `CreateSandboxArgs`/`UpdateSandboxArgs`/`Sandbox` without `userId` are consistent across db.ts, resolver.ts, routes, orchestrator, builder-chat, and web. The `scope` literal `"system" | "org"` matches the migrated CHECK constraints.

**Placeholder scan:** none — every code step has full code; run steps have exact commands + expected output. The migration's scope-value CHECK is dropped robustly by a `DO` block locating it by definition (its name is auto-generated and unknown), and the scope-shape CHECK is replaced before `DROP COLUMN user_id` (which it references).

**Out of scope:** other Phase 2 resources; Phase 3 sidebar (removal of any `My Sandboxes` nav entry is done opportunistically in Task 6 Step 5 if present, to avoid a dead link).
