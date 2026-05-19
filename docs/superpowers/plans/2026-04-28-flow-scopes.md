# Flow Scopes (User / Org / Global) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the user/org/global scope model for flows using a grants table + run definition snapshots, per [docs/superpowers/specs/2026-04-28-flow-scopes-design.md](../specs/2026-04-28-flow-scopes-design.md).

**Architecture:** Add a `jm_flow_grants` table that decouples flow ownership/visibility from the flow row; scope is derived from the flow's owner grant. Add `is_platform_admin` flag on users, propagate it through JWT and middleware. Snapshot the flow version definition + scope onto each run record so runs are durable past flow changes. Adapt the existing flow API and web UI to evaluate access via grants and to expose clone / promote actions.

**Tech Stack:** TypeScript, Fastify, PostgreSQL (`pg`), Zod, React (web), npm workspaces.

**User constraints (override skill defaults):**
- **No commits during implementation.** Implement everything as a single uncommitted working tree change.
- **Run typecheck only at the end** (`npm run typecheck`). Do not typecheck per-task.
- **No test cases / no automated tests.** Skip TDD steps.

---

## File map

### New files
- `packages/migrations/src/sql/004_flow_scopes.sql` — schema migration.
- `packages/identity/src/platform-admin.ts` — `isPlatformAdminUser(pool, userId)` helper + count helper.
- `packages/identity/src/routes/admin-platform.ts` — `GET/PATCH /admin/users/:id/platform-admin` routes.
- `packages/orchestrator/src/stores/postgres/postgres-flow-grants-store.ts` — `PostgresFlowGrantsStore` for `jm_flow_grants`.
- `packages/orchestrator/src/stores/memory/memory-flow-grants-store.ts` — in-memory equivalent.
- `packages/api-server/src/services/flow-access.ts` — pure access-evaluation helpers (`canRead`/`canEdit`/`canDelete`/`canCreateAtScope`/`canPromote`/`deriveScope`).
- `packages/api-server/src/routes/flow-grants.ts` — grants management endpoints.
- `packages/api-server/src/schemas/clone-flow.ts` — Zod body for clone.
- `packages/api-server/src/schemas/promote-flow.ts` — Zod body for promote.
- `packages/web/src/api/flow-grants.ts` — web client for clone/promote/grants.
- `packages/web/src/routes/AdminFlowsPage.tsx` — moderation page.

### Modified files
- `packages/core/src/types/flow.types.ts` — extend `Flow`, add `FlowGrant`/`FlowScope`/`FlowGrantRole` types.
- `packages/core/src/types/identity.types.ts` — add `isPlatformAdmin` to `UserRecord`, `RunContext`, `AccessTokenClaims`.
- `packages/core/src/types/run.types.ts` — extend `Run` with snapshot fields.
- `packages/core/src/interfaces/flow-store.interface.ts` — extend `IFlowStore`/`CreateFlowArgs`/add `IFlowGrantsStore`.
- `packages/core/src/interfaces/run-store.interface.ts` — extend `CreateRunArgs` with snapshot inputs.
- `packages/core/src/index.ts` — export new types/interfaces.
- `packages/identity/src/db.ts` — add `setUserPlatformAdmin`, `countPlatformAdmins`, extend `rowToUser`.
- `packages/identity/src/jwt.ts` — include `isPlatformAdmin` in access token claims.
- `packages/identity/src/middleware.ts` — read `isPlatformAdmin` from claims/db, populate `RunContext`.
- `packages/identity/src/routes/auth.ts` — sign tokens with `isPlatformAdmin` flag.
- `packages/identity/src/routes/bootstrap.ts` — set first user as platform admin.
- `packages/identity/src/routes/index.ts` — register the new admin routes.
- `packages/identity/src/index.ts` — export new helpers.
- `packages/orchestrator/src/index.ts` — export new stores.
- `packages/orchestrator/src/stores/postgres/postgres-flow-store.ts` — new shape, snapshot helpers, list-via-grants.
- `packages/orchestrator/src/stores/memory/memory-flow-store.ts` — match new interface.
- `packages/orchestrator/src/stores/postgres/postgres-run-store.ts` — write/read snapshot fields.
- `packages/orchestrator/src/stores/memory/memory-run-store.ts` — match new interface.
- `packages/orchestrator/src/conductor/conductor-orchestrator.ts` (or wherever `submit()` lives — locate at task start) — pass snapshot fields to `runs.create`.
- `packages/api-server/src/composition.ts` — instantiate the grants store, expose on `Composition`.
- `packages/api-server/src/routes/flows.ts` — wire access checks, clone, promote, scope filtering.
- `packages/api-server/src/server.ts` — register new flow-grants routes.
- `packages/api-server/src/schemas/flow.ts` — add `scope`/`orgId` to create body.
- `packages/web/src/AuthContext.tsx` — add `isPlatformAdmin`.
- `packages/web/src/AuthGate.tsx` — surface `isPlatformAdmin` from `/me`.
- `packages/web/src/api/flows.ts` — pass `scope`/`orgId` on create, list filter.
- `packages/web/src/routes/FlowsListPage.tsx` — scope filter chips, scope badges, clone button, promote menu.
- `packages/web/src/routes/FlowEditorPage.tsx` — read-only banner when caller cannot edit.
- `packages/web/src/routes/NewFlowPage.tsx` — scope selector in create form.
- `packages/web/src/App.tsx` — register `/admin/flows` route.
- `packages/web/src/components/AppShell.tsx` — add `Admin → Flows` nav item for org admins.

---

## Task 1 — Core types

**Files:**
- Modify: `packages/core/src/types/identity.types.ts`
- Modify: `packages/core/src/types/flow.types.ts`
- Modify: `packages/core/src/types/run.types.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1.1: Extend `UserRecord`, `RunContext`, `AccessTokenClaims` in `identity.types.ts`**

In `packages/core/src/types/identity.types.ts`, add `isPlatformAdmin` to all three:

```ts
export interface UserRecord {
  id: string;
  username: string;
  displayName: string | null;
  status: "active" | "disabled" | "deleted";
  isPlatformAdmin: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface RunContext {
  user: { id: string; username: string };
  org: { id: string; slug: string };
  membershipId: string;
  role: Role;
  isPlatformAdmin: boolean;
  tokenKind: "access-jwt" | "api-token";
  apiTokenId?: string;
}

export interface AccessTokenClaims {
  sub: string;
  org: string;
  role: Role;
  pa: boolean;        // is_platform_admin (short key for token size)
  kind: "access";
  iat: number;
  exp: number;
}
```

- [ ] **Step 1.2: Add scope/grant types to `flow.types.ts`**

In `packages/core/src/types/flow.types.ts`, add at the bottom:

```ts
export type FlowScope = "user" | "org" | "global";
export type FlowGrantPrincipalType = FlowScope;
export type FlowGrantRole = "owner" | "editor" | "viewer";

export interface FlowGrant {
  id: string;
  flowId: string;
  principalType: FlowGrantPrincipalType;
  principalId: string | null;
  role: FlowGrantRole;
  createdAt: Date;
  createdBy: string | null;
}
```

Replace the existing `Flow` interface with:

```ts
export interface Flow {
  id: string;
  name: string;
  description: string | null;
  currentVersionId: string | null;
  createdByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;

  // Hydrated from owner grant by the API/store layer:
  scope: FlowScope;
  orgId: string | null;
  ownerUserId: string | null;
  grants?: FlowGrant[];
}
```

(Remove the standalone `ownerUserId` field that previously sat on `Flow`. The hydrated field with the same name replaces it.)

- [ ] **Step 1.3: Extend `Run` with snapshot fields in `run.types.ts`**

In `packages/core/src/types/run.types.ts`, replace the `Run` interface with:

```ts
export interface Run {
  id: string;
  flowId: string | null;            // advisory; nullable if source flow deleted
  flowVersionId: string | null;     // advisory; nullable if source version deleted
  flowNameSnapshot: string;
  flowScopeSnapshot: "user" | "org" | "global";
  definitionSnapshot: import("./flow.types.ts").FlowGraph;
  status: RunStatus;
  triggerSource: TriggerSource;
  startedByUserId: string | null;
  engineWorkflowId: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  durationMs: number | null;
  failedAtNodeId: string | null;
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown> | null;
}
```

- [ ] **Step 1.4: Update `packages/core/src/index.ts` exports**

Add (after the existing flow type exports):

```ts
export type {
  FlowScope, FlowGrantPrincipalType, FlowGrantRole, FlowGrant,
} from "./types/flow.types.ts";
```

(No removal needed — keep existing exports of `Flow`, `FlowVersion`, `FlowGraph`, etc.)

---

## Task 2 — Store interfaces

**Files:**
- Modify: `packages/core/src/interfaces/flow-store.interface.ts`
- Modify: `packages/core/src/interfaces/run-store.interface.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 2.1: Extend `CreateFlowArgs` and `IFlowStore`**

Replace the contents of `packages/core/src/interfaces/flow-store.interface.ts` with:

```ts
import type {
  Flow, FlowGrant, FlowGrantRole, FlowGraph, FlowScope, FlowVersion,
} from "../types/flow.types.ts";

export interface CreateFlowArgs {
  scope: FlowScope;
  name: string;
  description?: string;
  /** Required when scope === "user" or "org". Null when scope === "global". */
  orgId: string | null;
  /** Required when scope === "user". Null otherwise. */
  ownerUserId: string | null;
  initialDefinition: FlowGraph;
  createdByUserId: string | null;
}

export interface FlowListFilter {
  /** Caller for visibility evaluation. */
  callerUserId: string | null;
  callerOrgId: string | null;
  callerIsPlatformAdmin: boolean;
  callerIsOrgAdmin: boolean;     // for callerOrgId
  scope?: FlowScope;
  /** Restrict to a specific org (admin moderation view). */
  orgId?: string;
  limit?: number;
}

export interface IFlowStore {
  create(args: CreateFlowArgs): Promise<{ flow: Flow; version: FlowVersion }>;
  getById(flowId: string): Promise<Flow | null>;
  list(filter: FlowListFilter): Promise<Flow[]>;
  /** Update name/description metadata. Does NOT touch versions or grants. */
  updateMeta(flowId: string, patch: { name?: string; description?: string | null }): Promise<Flow | null>;
  delete(flowId: string): Promise<void>;
}

export interface IFlowVersionStore {
  appendVersion(args: {
    flowId: string;
    definition: FlowGraph;
    createdByUserId: string | null;
  }): Promise<FlowVersion>;
  getById(versionId: string): Promise<FlowVersion | null>;
  listByFlow(flowId: string): Promise<FlowVersion[]>;
}

export interface CreateGrantArgs {
  flowId: string;
  principalType: "user" | "org" | "global";
  principalId: string | null;
  role: FlowGrantRole;
  createdBy: string | null;
}

export interface IFlowGrantsStore {
  create(args: CreateGrantArgs): Promise<FlowGrant>;
  listByFlow(flowId: string): Promise<FlowGrant[]>;
  /** Returns grants that match the caller (user grants, org grants for caller's org, all global grants). */
  listForCaller(args: {
    callerUserId: string | null;
    callerOrgId: string | null;
  }): Promise<FlowGrant[]>;
  delete(grantId: string): Promise<void>;
  /** Owner grant for a flow, or null. */
  getOwnerGrant(flowId: string): Promise<FlowGrant | null>;
}
```

- [ ] **Step 2.2: Extend `CreateRunArgs`**

Replace `packages/core/src/interfaces/run-store.interface.ts`:

```ts
import type { FlowGraph } from "../types/flow.types.ts";
import type { Run, NodeExecution, RunStatus, TriggerSource } from "../types/run.types.ts";

export interface CreateRunArgs {
  flowId: string | null;
  flowVersionId: string | null;
  flowNameSnapshot: string;
  flowScopeSnapshot: "user" | "org" | "global";
  definitionSnapshot: FlowGraph;
  triggerSource: TriggerSource;
  startedByUserId: string | null;
  inputs: Record<string, unknown>;
}

export interface IRunStore {
  create(args: CreateRunArgs): Promise<Run>;
  getById(runId: string): Promise<Run | null>;
  setEngineWorkflowId(runId: string, engineWorkflowId: string): Promise<void>;
  setStatus(runId: string, status: RunStatus, opts?: {
    failedAtNodeId?: string;
    completedAt?: Date;
    durationMs?: number;
    outputs?: Record<string, unknown>;
  }): Promise<void>;
  list(opts?: {
    flowId?: string;
    status?: RunStatus;
    limit?: number;
  }): Promise<Run[]>;
}

export interface INodeExecutionStore {
  upsert(execution: NodeExecution): Promise<void>;
  listByRun(runId: string): Promise<NodeExecution[]>;
}
```

- [ ] **Step 2.3: Export new interface symbols from `packages/core/src/index.ts`**

Add to the existing flow-store interface export:

```ts
export type {
  IFlowStore, IFlowVersionStore, IFlowGrantsStore,
  CreateFlowArgs, FlowListFilter, CreateGrantArgs,
} from "./interfaces/flow-store.interface.ts";
```

---

## Task 3 — Migration SQL

**Files:**
- Create: `packages/migrations/src/sql/004_flow_scopes.sql`

- [ ] **Step 3.1: Write the migration**

Create `packages/migrations/src/sql/004_flow_scopes.sql` with:

```sql
-- 004_flow_scopes.sql — flow grants + run snapshots + platform admin flag.

-- 1) Pre-flight: refuse migration if any flow has a NULL owner.
DO $$
DECLARE n INTEGER;
BEGIN
  SELECT COUNT(*) INTO n FROM jm_flows WHERE owner_user_id IS NULL;
  IF n > 0 THEN
    RAISE EXCEPTION 'Migration 004 aborted: % flows have NULL owner_user_id', n;
  END IF;
END $$;

-- 2) Platform admin flag.
ALTER TABLE jm_users
  ADD COLUMN IF NOT EXISTS is_platform_admin BOOLEAN NOT NULL DEFAULT FALSE;

-- 3) Bootstrap: first user becomes platform admin (idempotent — only flips if no platform admin yet).
DO $$
DECLARE first_user UUID;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM jm_users WHERE is_platform_admin = TRUE) THEN
    SELECT id INTO first_user FROM jm_users ORDER BY created_at ASC LIMIT 1;
    IF first_user IS NOT NULL THEN
      UPDATE jm_users SET is_platform_admin = TRUE WHERE id = first_user;
    END IF;
  END IF;
END $$;

-- 4) Grants table.
CREATE TABLE IF NOT EXISTS jm_flow_grants (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_id         UUID NOT NULL REFERENCES jm_flows(id) ON DELETE CASCADE,
  principal_type  TEXT NOT NULL CHECK (principal_type IN ('user','org','global')),
  principal_id    UUID NULL,
  role            TEXT NOT NULL CHECK (role IN ('owner','editor','viewer')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID REFERENCES jm_users(id) ON DELETE SET NULL,
  CONSTRAINT jm_flow_grants_principal_shape CHECK (
    (principal_type = 'global' AND principal_id IS NULL)
    OR (principal_type IN ('user','org') AND principal_id IS NOT NULL)
  ),
  CONSTRAINT jm_flow_grants_unique UNIQUE NULLS NOT DISTINCT (flow_id, principal_type, principal_id)
);
CREATE INDEX IF NOT EXISTS idx_jm_flow_grants_flow ON jm_flow_grants (flow_id);
CREATE INDEX IF NOT EXISTS idx_jm_flow_grants_user ON jm_flow_grants (principal_type, principal_id) WHERE principal_type = 'user';
CREATE INDEX IF NOT EXISTS idx_jm_flow_grants_org  ON jm_flow_grants (principal_type, principal_id) WHERE principal_type = 'org';

-- 5) Backfill: one owner grant per existing flow.
--    Existing jm_flows.owner_user_id is TEXT (legacy) — cast to UUID.
INSERT INTO jm_flow_grants (flow_id, principal_type, principal_id, role, created_by)
SELECT f.id, 'user', f.owner_user_id::uuid, 'owner', f.owner_user_id::uuid
FROM jm_flows f
WHERE NOT EXISTS (
  SELECT 1 FROM jm_flow_grants g WHERE g.flow_id = f.id AND g.role = 'owner'
);

-- 6) Add audit column on flows; populate from owner_user_id legacy column.
ALTER TABLE jm_flows
  ADD COLUMN IF NOT EXISTS created_by_user_id UUID REFERENCES jm_users(id) ON DELETE SET NULL;

UPDATE jm_flows SET created_by_user_id = owner_user_id::uuid
WHERE created_by_user_id IS NULL;

-- Note: owner_user_id (TEXT) is kept as a tombstone for one release. The application reads
-- ownership exclusively via jm_flow_grants from this point on. Drop in migration 005.

-- 7) Run snapshot columns.
ALTER TABLE jm_runs
  ADD COLUMN IF NOT EXISTS flow_id              UUID REFERENCES jm_flows(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS flow_name_snapshot   TEXT,
  ADD COLUMN IF NOT EXISTS flow_scope_snapshot  TEXT,
  ADD COLUMN IF NOT EXISTS definition_snapshot  JSONB;

-- Backfill: pull from existing flow_version_id.
UPDATE jm_runs r
SET flow_id              = fv.flow_id,
    flow_name_snapshot   = COALESCE(f.name, '<deleted>'),
    flow_scope_snapshot  = 'user',
    definition_snapshot  = fv.definition
FROM jm_flow_versions fv
LEFT JOIN jm_flows f ON f.id = fv.flow_id
WHERE r.flow_version_id = fv.id
  AND r.flow_name_snapshot IS NULL;

-- For any run whose flow_version_id is dangling (shouldn't happen but be safe):
UPDATE jm_runs
SET flow_name_snapshot  = COALESCE(flow_name_snapshot, '<unknown>'),
    flow_scope_snapshot = COALESCE(flow_scope_snapshot, 'user'),
    definition_snapshot = COALESCE(definition_snapshot, '{}'::jsonb);

ALTER TABLE jm_runs
  ALTER COLUMN flow_name_snapshot   SET NOT NULL,
  ALTER COLUMN flow_scope_snapshot  SET NOT NULL,
  ALTER COLUMN definition_snapshot  SET NOT NULL,
  ADD CONSTRAINT jm_runs_flow_scope_check CHECK (flow_scope_snapshot IN ('user','org','global'));

-- 8) Relax flow_version_id FK to ON DELETE SET NULL.
ALTER TABLE jm_runs DROP CONSTRAINT IF EXISTS jm_runs_flow_version_id_fkey;
ALTER TABLE jm_runs
  ALTER COLUMN flow_version_id DROP NOT NULL,
  ADD CONSTRAINT jm_runs_flow_version_id_fkey
    FOREIGN KEY (flow_version_id) REFERENCES jm_flow_versions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS jm_runs_flow_id_idx ON jm_runs (flow_id);
```

---

## Task 4 — Identity DB helpers + JWT

**Files:**
- Modify: `packages/identity/src/db.ts`
- Modify: `packages/identity/src/jwt.ts`
- Modify: `packages/identity/src/middleware.ts`
- Modify: `packages/identity/src/routes/auth.ts`
- Modify: `packages/identity/src/routes/bootstrap.ts`
- Create: `packages/identity/src/platform-admin.ts`
- Modify: `packages/identity/src/index.ts`

- [ ] **Step 4.1: Update `rowToUser` and add platform-admin helpers in `db.ts`**

In `packages/identity/src/db.ts`, change `rowToUser`:

```ts
function rowToUser(r: any): UserRecord {
  return {
    id: r.id, username: r.username, displayName: r.display_name,
    status: r.status,
    isPlatformAdmin: !!r.is_platform_admin,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}
```

Append new helpers:

```ts
export async function setUserPlatformAdmin(
  pool: Pool, userId: string, value: boolean,
): Promise<void> {
  await pool.query(
    "UPDATE jm_users SET is_platform_admin = $1, updated_at = now() WHERE id = $2",
    [value, userId],
  );
}

export async function countPlatformAdmins(pool: Pool): Promise<number> {
  const r = await pool.query(
    "SELECT COUNT(*)::int AS n FROM jm_users WHERE is_platform_admin = TRUE AND status = 'active'",
  );
  return r.rows[0].n;
}

export async function isUserPlatformAdmin(pool: Pool, userId: string): Promise<boolean> {
  const r = await pool.query(
    "SELECT is_platform_admin FROM jm_users WHERE id = $1", [userId],
  );
  return !!r.rows[0]?.is_platform_admin;
}
```

- [ ] **Step 4.2: Add `pa` claim to JWT in `jwt.ts`**

Replace the body of `signAccessToken` and update the signature:

```ts
export function signAccessToken(input: {
  userId: string; orgId: string; role: Role; isPlatformAdmin: boolean;
}): string {
  return jwt.sign(
    {
      sub: input.userId, org: input.orgId, role: input.role,
      pa: input.isPlatformAdmin, kind: "access",
    },
    secret(),
    { algorithm: "HS256", expiresIn: ACCESS_TTL_SECONDS },
  );
}

export function verifyAccessToken(token: string): AccessTokenClaims {
  const claims = jwt.verify(token, secret(), { algorithms: ["HS256"] }) as AccessTokenClaims;
  if (claims.kind !== "access") throw new Error("Wrong token kind");
  // Backwards-compat: tokens issued before pa-claim default to false.
  if (typeof claims.pa !== "boolean") (claims as any).pa = false;
  return claims;
}
```

- [ ] **Step 4.3: Populate `isPlatformAdmin` in `middleware.ts`**

Edit `packages/identity/src/middleware.ts`. Inside the JWT branch, after `userId = claims.sub; orgId = claims.org; role = claims.role;` add:

```ts
        let isPlatformAdmin = false;
```

Replace it with logic:

```ts
        let isPlatformAdmin = false;

        if (isApiToken(tok)) {
          const row = await findActiveApiToken(deps.pool, sha256(tok));
          if (!row) throw new UnauthorizedError("Invalid api token");
          userId = row.user_id; orgId = row.org_id;
          tokenKind = "api-token"; apiTokenId = row.id;
          void touchApiTokenLastUsed(deps.pool, row.id).catch(() => {});
          const m = await findMembership(deps.pool, userId, orgId);
          if (!m) throw new ForbiddenError("Membership missing");
          role = m.role;
          // For api tokens, look up the flag fresh.
          isPlatformAdmin = await isUserPlatformAdmin(deps.pool, userId);
        } else {
          const claims = verifyAccessToken(tok);
          userId = claims.sub; orgId = claims.org; role = claims.role;
          tokenKind = "access-jwt";
          isPlatformAdmin = !!claims.pa;
        }
```

Replace the dev-mode block to include the flag:

```ts
        if (!enforce) {
          req.runContext = {
            user: { id: "dev-user", username: "dev" },
            org:  { id: "dev-org",  slug: "dev" },
            membershipId: "dev-membership",
            role: "admin",
            isPlatformAdmin: true,
            tokenKind: "access-jwt",
          };
          return;
        }
```

And the final `req.runContext` assignment:

```ts
        req.runContext = {
          user: { id: u.id, username: u.username },
          org:  { id: o.id, slug: o.slug },
          membershipId: m.id,
          role,
          isPlatformAdmin,
          tokenKind,
          apiTokenId,
        };
```

Add the import at the top of the file:

```ts
import { findActiveApiToken, findMembership, getOrg, getUser, isUserPlatformAdmin, touchApiTokenLastUsed } from "./db.ts";
```

- [ ] **Step 4.4: Update `auth.ts` to pass the flag when signing**

In `packages/identity/src/routes/auth.ts`, find every call to `signAccessToken({...})` and add `isPlatformAdmin: user.isPlatformAdmin`. The user record already comes from `findUserByUsername` / `getUser` which return `UserRecord` (now with the flag from Step 4.1). For each call site, the change is:

```ts
const access = signAccessToken({
  userId: user.id,
  orgId: activeOrgId,
  role: m.role,
  isPlatformAdmin: user.isPlatformAdmin,
});
```

(Apply at every `signAccessToken(` call site in this file — there are typically 2-3.)

- [ ] **Step 4.5: Bootstrap sets first user as platform admin**

In `packages/identity/src/routes/bootstrap.ts`, locate the SQL or function call that creates the very first user. After creation, before commit:

```ts
await client.query(
  "UPDATE jm_users SET is_platform_admin = TRUE WHERE id = $1",
  [userId],
);
```

(`userId` is whatever local variable holds the new user's id in that file — check the existing code at task time.) The migration 004 also handles the case of pre-existing data, so this is just for fresh installs.

- [ ] **Step 4.6: Create platform-admin helper module**

Create `packages/identity/src/platform-admin.ts`:

```ts
import type { Pool } from "pg";
import { countPlatformAdmins, isUserPlatformAdmin, setUserPlatformAdmin } from "./db.ts";

export interface PlatformAdminService {
  isPlatformAdmin(userId: string): Promise<boolean>;
  /** Throws if removing would leave zero active platform admins. */
  setPlatformAdmin(userId: string, value: boolean): Promise<void>;
  count(): Promise<number>;
}

export function makePlatformAdminService(pool: Pool): PlatformAdminService {
  return {
    isPlatformAdmin: (userId) => isUserPlatformAdmin(pool, userId),
    async setPlatformAdmin(userId, value) {
      if (value === false) {
        const target = await isUserPlatformAdmin(pool, userId);
        if (target) {
          const total = await countPlatformAdmins(pool);
          if (total <= 1) {
            throw new Error("Cannot remove last platform admin");
          }
        }
      }
      await setUserPlatformAdmin(pool, userId, value);
    },
    count: () => countPlatformAdmins(pool),
  };
}
```

- [ ] **Step 4.7: Re-export from `packages/identity/src/index.ts`**

Append:

```ts
export {
  setUserPlatformAdmin, countPlatformAdmins, isUserPlatformAdmin,
} from "./db.ts";
export { makePlatformAdminService } from "./platform-admin.ts";
export type { PlatformAdminService } from "./platform-admin.ts";
```

---

## Task 5 — Platform-admin route

**Files:**
- Create: `packages/identity/src/routes/admin-platform.ts`
- Modify: `packages/identity/src/routes/index.ts`

- [ ] **Step 5.1: Create the route module**

Create `packages/identity/src/routes/admin-platform.ts`:

```ts
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { makeRequireAuth } from "../middleware.ts";
import { makePlatformAdminService } from "../platform-admin.ts";

export function registerPlatformAdminRoutes(app: FastifyInstance, pool: Pool) {
  const requireAuth = makeRequireAuth({ pool });
  const svc = makePlatformAdminService(pool);

  app.get("/admin/users/:id/platform-admin", { preHandler: requireAuth() }, async (req, reply) => {
    const ctx = req.runContext!;
    if (!ctx.isPlatformAdmin) { reply.code(403); return { error: "forbidden" }; }
    const { id } = req.params as { id: string };
    return { value: await svc.isPlatformAdmin(id) };
  });

  app.patch("/admin/users/:id/platform-admin", { preHandler: requireAuth() }, async (req, reply) => {
    const ctx = req.runContext!;
    if (!ctx.isPlatformAdmin) { reply.code(403); return { error: "forbidden" }; }
    const { id } = req.params as { id: string };
    const body = req.body as { value?: unknown };
    if (typeof body?.value !== "boolean") { reply.code(400); return { error: "value_must_be_boolean" }; }
    try {
      await svc.setPlatformAdmin(id, body.value);
    } catch (e: any) {
      reply.code(409); return { error: e.message ?? "conflict" };
    }
    return { value: body.value };
  });
}
```

- [ ] **Step 5.2: Register in `routes/index.ts`**

In `packages/identity/src/routes/index.ts`, import and register:

```ts
import { registerPlatformAdminRoutes } from "./admin-platform.ts";
// ... existing registrations ...
registerPlatformAdminRoutes(app, pool);
```

(Put it next to other admin route registrations; the exact line depends on the file's current layout — match the surrounding pattern.)

---

## Task 6 — Postgres flow grants store

**Files:**
- Create: `packages/orchestrator/src/stores/postgres/postgres-flow-grants-store.ts`
- Modify: `packages/orchestrator/src/index.ts`

- [ ] **Step 6.1: Create the postgres store**

Create `packages/orchestrator/src/stores/postgres/postgres-flow-grants-store.ts`:

```ts
import type { Pool } from "pg";
import type {
  CreateGrantArgs, FlowGrant, IFlowGrantsStore,
} from "@journeyman/core";

function rowToGrant(r: any): FlowGrant {
  return {
    id: r.id,
    flowId: r.flow_id,
    principalType: r.principal_type,
    principalId: r.principal_id,
    role: r.role,
    createdAt: new Date(r.created_at),
    createdBy: r.created_by,
  };
}

export class PostgresFlowGrantsStore implements IFlowGrantsStore {
  constructor(private pool: Pool) {}

  async create(args: CreateGrantArgs): Promise<FlowGrant> {
    const { rows } = await this.pool.query(
      `INSERT INTO jm_flow_grants (flow_id, principal_type, principal_id, role, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [args.flowId, args.principalType, args.principalId, args.role, args.createdBy],
    );
    return rowToGrant(rows[0]);
  }

  async listByFlow(flowId: string): Promise<FlowGrant[]> {
    const { rows } = await this.pool.query(
      "SELECT * FROM jm_flow_grants WHERE flow_id = $1 ORDER BY created_at",
      [flowId],
    );
    return rows.map(rowToGrant);
  }

  async listForCaller(args: {
    callerUserId: string | null;
    callerOrgId: string | null;
  }): Promise<FlowGrant[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM jm_flow_grants
        WHERE principal_type = 'global'
           OR (principal_type = 'user' AND principal_id = $1)
           OR (principal_type = 'org'  AND principal_id = $2)`,
      [args.callerUserId, args.callerOrgId],
    );
    return rows.map(rowToGrant);
  }

  async delete(grantId: string): Promise<void> {
    await this.pool.query("DELETE FROM jm_flow_grants WHERE id = $1", [grantId]);
  }

  async getOwnerGrant(flowId: string): Promise<FlowGrant | null> {
    const { rows } = await this.pool.query(
      "SELECT * FROM jm_flow_grants WHERE flow_id = $1 AND role = 'owner' LIMIT 1",
      [flowId],
    );
    return rows[0] ? rowToGrant(rows[0]) : null;
  }
}
```

- [ ] **Step 6.2: Memory equivalent**

Create `packages/orchestrator/src/stores/memory/memory-flow-grants-store.ts`:

```ts
import { randomUUID } from "node:crypto";
import type {
  CreateGrantArgs, FlowGrant, IFlowGrantsStore,
} from "@journeyman/core";

export class MemoryFlowGrantsStore implements IFlowGrantsStore {
  private rows = new Map<string, FlowGrant>();

  async create(args: CreateGrantArgs): Promise<FlowGrant> {
    const g: FlowGrant = {
      id: randomUUID(),
      flowId: args.flowId,
      principalType: args.principalType,
      principalId: args.principalId,
      role: args.role,
      createdAt: new Date(),
      createdBy: args.createdBy,
    };
    this.rows.set(g.id, g);
    return g;
  }

  async listByFlow(flowId: string): Promise<FlowGrant[]> {
    return [...this.rows.values()].filter(g => g.flowId === flowId);
  }

  async listForCaller(args: { callerUserId: string | null; callerOrgId: string | null }): Promise<FlowGrant[]> {
    return [...this.rows.values()].filter(g =>
      g.principalType === "global"
      || (g.principalType === "user" && g.principalId === args.callerUserId)
      || (g.principalType === "org"  && g.principalId === args.callerOrgId),
    );
  }

  async delete(grantId: string): Promise<void> { this.rows.delete(grantId); }

  async getOwnerGrant(flowId: string): Promise<FlowGrant | null> {
    return [...this.rows.values()].find(g => g.flowId === flowId && g.role === "owner") ?? null;
  }
}
```

- [ ] **Step 6.3: Export from orchestrator index**

In `packages/orchestrator/src/index.ts`, add:

```ts
export { PostgresFlowGrantsStore } from "./stores/postgres/postgres-flow-grants-store.ts";
export { MemoryFlowGrantsStore } from "./stores/memory/memory-flow-grants-store.ts";
```

---

## Task 7 — Postgres flow store: hydration + create-with-grant

**Files:**
- Modify: `packages/orchestrator/src/stores/postgres/postgres-flow-store.ts`

- [ ] **Step 7.1: Replace `rowToFlow` with grant-aware hydration**

Replace the file's contents with:

```ts
import type { Pool } from "pg";
import type {
  CreateFlowArgs, Flow, FlowGrant, FlowGraph, FlowListFilter, FlowVersion,
  IFlowGrantsStore, IFlowStore, IFlowVersionStore,
} from "@journeyman/core";

function rowToFlowBase(row: any): Omit<Flow, "scope" | "orgId" | "ownerUserId"> {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    currentVersionId: row.current_version_id,
    createdByUserId: row.created_by_user_id,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function hydrateFromOwnerGrant(
  base: Omit<Flow, "scope" | "orgId" | "ownerUserId">,
  ownerGrant: FlowGrant | null,
  ownerOrgIdHint: string | null,
): Flow {
  // ownerOrgIdHint: when ownerGrant.principal_type='user' we don't know the org from the grant alone.
  // Caller supplies the user's primary org id (resolved via memberships) — null when unknown.
  if (!ownerGrant) {
    // Defensive: should never happen post-migration. Treat as 'user' scope with null pointers.
    return { ...base, scope: "user", orgId: null, ownerUserId: null };
  }
  switch (ownerGrant.principalType) {
    case "global":
      return { ...base, scope: "global", orgId: null, ownerUserId: null };
    case "org":
      return { ...base, scope: "org", orgId: ownerGrant.principalId, ownerUserId: null };
    case "user":
      return { ...base, scope: "user", orgId: ownerOrgIdHint, ownerUserId: ownerGrant.principalId };
  }
}

function rowToVersion(row: any): FlowVersion {
  return {
    id: row.id,
    flowId: row.flow_id,
    versionNumber: row.version_number,
    definition: row.definition as FlowGraph,
    createdByUserId: row.created_by_user_id,
    createdAt: new Date(row.created_at),
  };
}

export class PostgresFlowVersionStore implements IFlowVersionStore {
  constructor(private pool: Pool) {}

  async appendVersion(args: {
    flowId: string;
    definition: FlowGraph;
    createdByUserId: string | null;
  }): Promise<FlowVersion> {
    const { rows } = await this.pool.query(
      `INSERT INTO jm_flow_versions (flow_id, version_number, definition, created_by_user_id)
       VALUES ($1,
               COALESCE((SELECT MAX(version_number) + 1 FROM jm_flow_versions WHERE flow_id = $1), 1),
               $2::jsonb, $3)
       RETURNING *`,
      [args.flowId, JSON.stringify(args.definition), args.createdByUserId],
    );
    await this.pool.query("UPDATE jm_flows SET current_version_id = $1, updated_at = now() WHERE id = $2", [rows[0].id, args.flowId]);
    return rowToVersion(rows[0]);
  }

  async getById(versionId: string): Promise<FlowVersion | null> {
    const { rows } = await this.pool.query(
      "SELECT * FROM jm_flow_versions WHERE id = $1", [versionId],
    );
    return rows[0] ? rowToVersion(rows[0]) : null;
  }

  async listByFlow(flowId: string): Promise<FlowVersion[]> {
    const { rows } = await this.pool.query(
      "SELECT * FROM jm_flow_versions WHERE flow_id = $1 ORDER BY version_number", [flowId],
    );
    return rows.map(rowToVersion);
  }
}

export class PostgresFlowStore implements IFlowStore {
  constructor(
    private pool: Pool,
    private versions: PostgresFlowVersionStore,
    private grants: IFlowGrantsStore,
  ) {}

  async create(args: CreateFlowArgs): Promise<{ flow: Flow; version: FlowVersion }> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET CONSTRAINTS ALL DEFERRED");
      const flowRes = await client.query(
        `INSERT INTO jm_flows (name, description, created_by_user_id)
         VALUES ($1, $2, $3) RETURNING *`,
        [args.name, args.description ?? null, args.createdByUserId],
      );
      const flowId = flowRes.rows[0].id;

      const verRes = await client.query(
        `INSERT INTO jm_flow_versions (flow_id, version_number, definition, created_by_user_id)
         VALUES ($1, 1, $2::jsonb, $3) RETURNING *`,
        [flowId, JSON.stringify(args.initialDefinition), args.createdByUserId],
      );
      await client.query(
        "UPDATE jm_flows SET current_version_id = $1 WHERE id = $2",
        [verRes.rows[0].id, flowId],
      );

      // Owner grant.
      const principalType = args.scope;
      const principalId =
        args.scope === "user"   ? args.ownerUserId :
        args.scope === "org"    ? args.orgId       :
        /* global */              null;
      await client.query(
        `INSERT INTO jm_flow_grants (flow_id, principal_type, principal_id, role, created_by)
         VALUES ($1, $2, $3, 'owner', $4)`,
        [flowId, principalType, principalId, args.createdByUserId],
      );

      const finalFlow = await client.query("SELECT * FROM jm_flows WHERE id = $1", [flowId]);
      await client.query("COMMIT");

      const base = rowToFlowBase(finalFlow.rows[0]);
      const owner = await this.grants.getOwnerGrant(flowId);
      const orgHint = args.scope === "user" ? args.orgId : null;
      return {
        flow: hydrateFromOwnerGrant(base, owner, orgHint),
        version: rowToVersion(verRes.rows[0]),
      };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async getById(flowId: string): Promise<Flow | null> {
    const { rows } = await this.pool.query("SELECT * FROM jm_flows WHERE id = $1", [flowId]);
    if (!rows[0]) return null;
    const base = rowToFlowBase(rows[0]);
    const owner = await this.grants.getOwnerGrant(flowId);
    const orgHint = await this.resolveUserPrimaryOrgId(owner);
    const flow = hydrateFromOwnerGrant(base, owner, orgHint);
    flow.grants = await this.grants.listByFlow(flowId);
    return flow;
  }

  async list(filter: FlowListFilter): Promise<Flow[]> {
    // Build the visibility predicate per the permission model.
    // - platform admin: everything (with optional scope/orgId narrowing).
    // - else: any flow the caller has a matching grant on, plus
    //         (if caller is org admin of filter.orgId or callerOrgId)
    //         user-scope flows whose owner is a member of that org.
    const params: any[] = [];
    const push = (v: any) => { params.push(v); return `$${params.length}`; };

    const conds: string[] = [];

    if (filter.callerIsPlatformAdmin) {
      // No grant predicate; all rows visible.
    } else {
      const userP = push(filter.callerUserId);
      const orgP  = push(filter.callerOrgId);
      const orClauses: string[] = [
        `EXISTS (SELECT 1 FROM jm_flow_grants g WHERE g.flow_id = f.id AND g.principal_type = 'global')`,
        `EXISTS (SELECT 1 FROM jm_flow_grants g WHERE g.flow_id = f.id AND g.principal_type = 'user' AND g.principal_id = ${userP})`,
        `EXISTS (SELECT 1 FROM jm_flow_grants g WHERE g.flow_id = f.id AND g.principal_type = 'org'  AND g.principal_id = ${orgP})`,
      ];
      if (filter.callerIsOrgAdmin && filter.callerOrgId) {
        // Org admin sees user-scope flows owned by members of their org.
        orClauses.push(
          `EXISTS (
             SELECT 1 FROM jm_flow_grants g
             JOIN jm_memberships m ON m.user_id = g.principal_id AND m.org_id = ${orgP}
             WHERE g.flow_id = f.id AND g.principal_type = 'user' AND g.role = 'owner'
           )`,
        );
      }
      conds.push(`(${orClauses.join(" OR ")})`);
    }

    // Scope/orgId narrowing.
    if (filter.scope) {
      const sp = push(filter.scope);
      conds.push(`EXISTS (SELECT 1 FROM jm_flow_grants g WHERE g.flow_id = f.id AND g.role = 'owner' AND g.principal_type = ${sp})`);
    }
    if (filter.orgId) {
      const op = push(filter.orgId);
      conds.push(`EXISTS (
        SELECT 1 FROM jm_flow_grants g
        WHERE g.flow_id = f.id AND g.role = 'owner' AND (
          g.principal_type = 'org' AND g.principal_id = ${op}
          OR g.principal_type = 'user' AND EXISTS (
            SELECT 1 FROM jm_memberships m WHERE m.user_id = g.principal_id AND m.org_id = ${op}
          )
        )
      )`);
    }

    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    const limit = filter.limit ? `LIMIT ${Number(filter.limit)}` : "LIMIT 200";
    const sql = `SELECT f.* FROM jm_flows f ${where} ORDER BY f.created_at DESC ${limit}`;
    const { rows } = await this.pool.query(sql, params);

    // Hydrate each flow's owner grant. N+1 acceptable for now (small lists).
    const out: Flow[] = [];
    for (const r of rows) {
      const base = rowToFlowBase(r);
      const owner = await this.grants.getOwnerGrant(r.id);
      const orgHint = await this.resolveUserPrimaryOrgId(owner);
      out.push(hydrateFromOwnerGrant(base, owner, orgHint));
    }
    return out;
  }

  async updateMeta(flowId: string, patch: { name?: string; description?: string | null }): Promise<Flow | null> {
    const sets: string[] = [];
    const params: any[] = [];
    const push = (v: any) => { params.push(v); return `$${params.length}`; };
    if (patch.name !== undefined)        sets.push(`name = ${push(patch.name)}`);
    if (patch.description !== undefined) sets.push(`description = ${push(patch.description)}`);
    if (sets.length === 0) return this.getById(flowId);
    sets.push("updated_at = now()");
    params.push(flowId);
    await this.pool.query(`UPDATE jm_flows SET ${sets.join(", ")} WHERE id = $${params.length}`, params);
    return this.getById(flowId);
  }

  async delete(flowId: string): Promise<void> {
    await this.pool.query("DELETE FROM jm_flows WHERE id = $1", [flowId]);
  }

  /** When the owner grant is a user grant, look up that user's primary org. Used purely as a UI hint. */
  private async resolveUserPrimaryOrgId(owner: FlowGrant | null): Promise<string | null> {
    if (!owner || owner.principalType !== "user" || !owner.principalId) return null;
    const r = await this.pool.query(
      "SELECT org_id FROM jm_memberships WHERE user_id = $1 ORDER BY created_at LIMIT 1",
      [owner.principalId],
    );
    return r.rows[0]?.org_id ?? null;
  }
}
```

---

## Task 8 — Memory flow store update

**Files:**
- Modify: `packages/orchestrator/src/stores/memory/memory-flow-store.ts`

- [ ] **Step 8.1: Match the new interface**

Replace `MemoryFlowStore` (keep `MemoryFlowVersionStore` mostly intact):

```ts
import { randomUUID } from "node:crypto";
import type {
  CreateFlowArgs, Flow, FlowGrant, FlowGraph, FlowListFilter, FlowVersion,
  IFlowGrantsStore, IFlowStore, IFlowVersionStore,
} from "@journeyman/core";

// ... keep MemoryFlowVersionStore unchanged ...

export class MemoryFlowStore implements IFlowStore {
  private rows = new Map<string, {
    id: string; name: string; description: string | null;
    currentVersionId: string | null; createdByUserId: string | null;
    createdAt: Date; updatedAt: Date;
  }>();

  constructor(
    private versions: MemoryFlowVersionStore,
    private grants: IFlowGrantsStore,
  ) {}

  async create(args: CreateFlowArgs): Promise<{ flow: Flow; version: FlowVersion }> {
    const id = randomUUID();
    const now = new Date();
    this.rows.set(id, {
      id, name: args.name, description: args.description ?? null,
      currentVersionId: null, createdByUserId: args.createdByUserId,
      createdAt: now, updatedAt: now,
    });
    const version = await this.versions.appendVersion({
      flowId: id, definition: args.initialDefinition, createdByUserId: args.createdByUserId,
    });
    const row = this.rows.get(id)!;
    row.currentVersionId = version.id;

    const principalId =
      args.scope === "user"  ? args.ownerUserId :
      args.scope === "org"   ? args.orgId       :
      null;
    await this.grants.create({
      flowId: id, principalType: args.scope, principalId,
      role: "owner", createdBy: args.createdByUserId,
    });

    const owner = await this.grants.getOwnerGrant(id);
    return { flow: hydrate(row, owner, args.scope === "user" ? args.orgId : null), version };
  }

  async getById(flowId: string): Promise<Flow | null> {
    const row = this.rows.get(flowId);
    if (!row) return null;
    const owner = await this.grants.getOwnerGrant(flowId);
    const flow = hydrate(row, owner, null);
    flow.grants = await this.grants.listByFlow(flowId);
    return flow;
  }

  async list(filter: FlowListFilter): Promise<Flow[]> {
    const out: Flow[] = [];
    for (const row of this.rows.values()) {
      const owner = await this.grants.getOwnerGrant(row.id);
      if (!owner) continue;
      // Visibility check.
      let visible = filter.callerIsPlatformAdmin;
      if (!visible) {
        if (owner.principalType === "global") visible = true;
        else if (owner.principalType === "user" && owner.principalId === filter.callerUserId) visible = true;
        else if (owner.principalType === "org"  && owner.principalId === filter.callerOrgId) visible = true;
        else if (filter.callerIsOrgAdmin && owner.principalType === "user") {
          // Approximate: not enforcing membership lookup in memory store. Allow if same orgId hint matches.
          visible = false;
        }
      }
      if (!visible) continue;
      if (filter.scope && owner.principalType !== filter.scope) continue;
      out.push(hydrate(row, owner, null));
    }
    return filter.limit ? out.slice(0, filter.limit) : out;
  }

  async updateMeta(flowId: string, patch: { name?: string; description?: string | null }): Promise<Flow | null> {
    const row = this.rows.get(flowId);
    if (!row) return null;
    if (patch.name !== undefined) row.name = patch.name;
    if (patch.description !== undefined) row.description = patch.description;
    row.updatedAt = new Date();
    return this.getById(flowId);
  }

  async delete(flowId: string): Promise<void> { this.rows.delete(flowId); }
}

function hydrate(
  row: { id: string; name: string; description: string | null; currentVersionId: string | null;
         createdByUserId: string | null; createdAt: Date; updatedAt: Date; },
  owner: FlowGrant | null,
  orgHint: string | null,
): Flow {
  const base = {
    id: row.id, name: row.name, description: row.description,
    currentVersionId: row.currentVersionId, createdByUserId: row.createdByUserId,
    createdAt: row.createdAt, updatedAt: row.updatedAt,
  };
  if (!owner) return { ...base, scope: "user", orgId: null, ownerUserId: null };
  if (owner.principalType === "global") return { ...base, scope: "global", orgId: null, ownerUserId: null };
  if (owner.principalType === "org")    return { ...base, scope: "org", orgId: owner.principalId, ownerUserId: null };
  return { ...base, scope: "user", orgId: orgHint, ownerUserId: owner.principalId };
}
```

---

## Task 9 — Run store snapshot fields

**Files:**
- Modify: `packages/orchestrator/src/stores/postgres/postgres-run-store.ts`
- Modify: `packages/orchestrator/src/stores/memory/memory-run-store.ts`

- [ ] **Step 9.1: Update Postgres run store**

Replace `rowToRun` and `create`:

```ts
function rowToRun(row: any): Run {
  return {
    id: row.id,
    flowId: row.flow_id,
    flowVersionId: row.flow_version_id,
    flowNameSnapshot: row.flow_name_snapshot,
    flowScopeSnapshot: row.flow_scope_snapshot,
    definitionSnapshot: row.definition_snapshot,
    status: row.status,
    triggerSource: row.trigger_source,
    startedByUserId: row.started_by_user_id,
    engineWorkflowId: row.engine_workflow_id,
    startedAt: row.started_at ? new Date(row.started_at) : null,
    completedAt: row.completed_at ? new Date(row.completed_at) : null,
    durationMs: row.duration_ms,
    failedAtNodeId: row.failed_at_node_id,
    inputs: row.inputs ?? {},
    outputs: row.outputs,
  };
}

// in PostgresRunStore.create:
async create(args: CreateRunArgs): Promise<Run> {
  const { rows } = await this.pool.query(
    `INSERT INTO jm_runs
       (flow_id, flow_version_id, flow_name_snapshot, flow_scope_snapshot, definition_snapshot,
        status, trigger_source, started_by_user_id, inputs)
     VALUES ($1, $2, $3, $4, $5::jsonb, 'pending', $6, $7, $8::jsonb)
     RETURNING *`,
    [
      args.flowId, args.flowVersionId,
      args.flowNameSnapshot, args.flowScopeSnapshot,
      JSON.stringify(args.definitionSnapshot),
      args.triggerSource, args.startedByUserId,
      JSON.stringify(args.inputs),
    ],
  );
  return rowToRun(rows[0]);
}
```

- [ ] **Step 9.2: Update Memory run store identically**

Mirror the new fields onto the in-memory map and `create()` signature in `packages/orchestrator/src/stores/memory/memory-run-store.ts`. Keep all other methods unchanged.

---

## Task 10 — Orchestrator submit signature

**Files:**
- Modify: orchestrator file containing `IOrchestratorEngine.submit` (`packages/orchestrator/src/conductor/conductor-orchestrator.ts` and any wrapper). If unsure, run `grep -rn "submit(" packages/orchestrator/src/ packages/core/src/`.

- [ ] **Step 10.1: Locate and update submit signature**

The engine submits a run and writes via `runs.create(...)`. The new fields must be passed through. Update the `submit` argument type to:

```ts
{
  flowId: string | null;
  flowVersionId: string | null;
  flowNameSnapshot: string;
  flowScopeSnapshot: "user" | "org" | "global";
  definitionSnapshot: FlowGraph;
  inputs: Record<string, unknown>;
  startedByUserId: string | null;
}
```

Pass all five snapshot fields straight into `this.runs.create({ ... })`. Drop the old `flowDefinition` parameter (if any) — `definitionSnapshot` replaces it.

---

## Task 11 — Composition wiring

**Files:**
- Modify: `packages/api-server/src/composition.ts`

- [ ] **Step 11.1: Add grants store to `Composition`**

Add `flowGrants: IFlowGrantsStore;` to the `Composition` interface. Import `IFlowGrantsStore` from `@journeyman/core`.

In `buildComposition`, instantiate it before the flow store and pass it in:

```ts
let flowGrants: IFlowGrantsStore;

if (useMemory) {
  flowGrants = new MemoryFlowGrantsStore();
  const v = new MemoryFlowVersionStore();
  flowVersions = v;
  flows = new MemoryFlowStore(v, flowGrants);
  // ... rest unchanged ...
} else {
  pool = createPool({ connectionString: cfg.databaseUrl });
  flowGrants = new PostgresFlowGrantsStore(pool);
  const v = new PostgresFlowVersionStore(pool);
  flowVersions = v;
  flows = new PostgresFlowStore(pool, v, flowGrants);
  // ... rest unchanged ...
}
```

Add the appropriate imports at the top:

```ts
import {
  // ...existing...
  PostgresFlowGrantsStore,
  MemoryFlowGrantsStore,
} from "@journeyman/orchestrator";
```

Add `flowGrants` to the returned object in `buildComposition`.

---

## Task 12 — Access service

**Files:**
- Create: `packages/api-server/src/services/flow-access.ts`

- [ ] **Step 12.1: Pure helpers for access decisions**

Create `packages/api-server/src/services/flow-access.ts`:

```ts
import type { Flow, FlowGrant, FlowGrantRole, FlowScope } from "@journeyman/core";

export interface Caller {
  userId: string;
  orgId: string;
  role: "admin" | "member";
  isPlatformAdmin: boolean;
}

const ROLE_ORDER: Record<FlowGrantRole, number> = { viewer: 1, editor: 2, owner: 3 };

export function effectiveRole(flow: Flow, caller: Caller): FlowGrantRole | null {
  if (caller.isPlatformAdmin) return "owner";
  const grants = flow.grants ?? [];
  let best: FlowGrantRole | null = null;
  for (const g of grants) {
    let match = false;
    if (g.principalType === "global") match = true;
    else if (g.principalType === "user" && g.principalId === caller.userId) match = true;
    else if (g.principalType === "org"  && g.principalId === caller.orgId) match = true;
    if (match) {
      if (!best || ROLE_ORDER[g.role] > ROLE_ORDER[best]) best = g.role;
    }
  }
  // Org admin owns any flow with an org grant for their org (already covered above
  // if the grant exists). Org admin moderation read on user flows owned by org members
  // is enforced at the list query level, not here.
  if (caller.role === "admin") {
    const orgOwn = grants.find(g => g.principalType === "org" && g.principalId === caller.orgId);
    if (orgOwn) best = "owner";
  }
  return best;
}

export function canRead(flow: Flow, caller: Caller): boolean {
  return effectiveRole(flow, caller) !== null;
}
export function canEdit(flow: Flow, caller: Caller): boolean {
  const r = effectiveRole(flow, caller);
  return r === "editor" || r === "owner";
}
export function canDelete(flow: Flow, caller: Caller): boolean {
  return effectiveRole(flow, caller) === "owner";
}
export function canCreateAtScope(scope: FlowScope, caller: Caller): boolean {
  if (caller.isPlatformAdmin) return true;
  if (scope === "user") return true;
  if (scope === "org") return caller.role === "admin";
  if (scope === "global") return false; // only platform admin (handled above)
  return false;
}
export function canPromoteTo(target: "org" | "global", caller: Caller): boolean {
  if (target === "global") return caller.isPlatformAdmin;
  return caller.role === "admin" || caller.isPlatformAdmin;
}
```

---

## Task 13 — Flow API: schemas

**Files:**
- Modify: `packages/api-server/src/schemas/flow.ts`
- Create: `packages/api-server/src/schemas/clone-flow.ts`
- Create: `packages/api-server/src/schemas/promote-flow.ts`

- [ ] **Step 13.1: Update create body to accept scope**

In `packages/api-server/src/schemas/flow.ts`, change:

```ts
export const createFlowBody = z.object({
  scope: z.enum(["user", "org", "global"]).default("user"),
  orgId: z.string().uuid().optional(),
  name: z.string().min(1),
  description: z.string().optional(),
  // ownerUserId removed — server derives from caller for user-scope.
  definition: /* existing nested object */,
});
```

(Keep the existing `definition` schema body verbatim — only the surrounding shape changes.)

- [ ] **Step 13.2: Clone schema**

Create `packages/api-server/src/schemas/clone-flow.ts`:

```ts
import { z } from "zod";
export const cloneFlowBody = z.object({
  name: z.string().min(1).optional(),
});
export type CloneFlowBody = z.infer<typeof cloneFlowBody>;
```

- [ ] **Step 13.3: Promote schema**

Create `packages/api-server/src/schemas/promote-flow.ts`:

```ts
import { z } from "zod";
export const promoteFlowBody = z.object({
  targetScope: z.enum(["org", "global"]),
  orgId: z.string().uuid().optional(),
  name: z.string().min(1).optional(),
});
export type PromoteFlowBody = z.infer<typeof promoteFlowBody>;
```

---

## Task 14 — Flow API routes: create/list/get/update + clone + promote

**Files:**
- Modify: `packages/api-server/src/routes/flows.ts`

- [ ] **Step 14.1: Replace the file**

Replace `packages/api-server/src/routes/flows.ts` with:

```ts
import type { FastifyInstance } from "fastify";
import type { Composition } from "../composition.ts";
import { createFlowBody } from "../schemas/flow.ts";
import { createRunBody } from "../schemas/run.ts";
import { updateFlowBody } from "../schemas/update-flow.ts";
import { cloneFlowBody } from "../schemas/clone-flow.ts";
import { promoteFlowBody } from "../schemas/promote-flow.ts";
import type { FlowGraph, FlowScope } from "@journeyman/core";
import { makeRequireAuth } from "@journeyman/identity";
import {
  canCreateAtScope, canDelete, canEdit, canPromoteTo, canRead,
  type Caller,
} from "../services/flow-access.ts";

function callerFromCtx(ctx: NonNullable<import("fastify").FastifyRequest["runContext"]>): Caller {
  return {
    userId: ctx.user.id,
    orgId: ctx.org.id,
    role: ctx.role,
    isPlatformAdmin: ctx.isPlatformAdmin,
  };
}

export function registerFlowRoutes(app: FastifyInstance, c: Composition): void {
  const requireAuth = makeRequireAuth({ pool: c.pool! });

  app.post("/flows", { preHandler: requireAuth() }, async (req, reply) => {
    const ctx = req.runContext!;
    const caller = callerFromCtx(ctx);
    const body = createFlowBody.parse(req.body);

    if (!canCreateAtScope(body.scope as FlowScope, caller)) {
      reply.code(403); return { error: "forbidden" };
    }

    const orgId =
      body.scope === "user"   ? caller.orgId :
      body.scope === "org"    ? (body.orgId ?? caller.orgId) :
      /* global */              null;
    const ownerUserId = body.scope === "user" ? caller.userId : null;

    const { flow, version } = await c.flows.create({
      scope: body.scope as FlowScope,
      name: body.name,
      description: body.description,
      orgId,
      ownerUserId,
      initialDefinition: body.definition as FlowGraph,
      createdByUserId: caller.userId,
    });
    reply.code(201);
    return { flow, version };
  });

  app.get("/flows", { preHandler: requireAuth() }, async (req) => {
    const ctx = req.runContext!;
    const q = req.query as { scope?: string; orgId?: string; limit?: string };
    const flows = await c.flows.list({
      callerUserId: ctx.user.id,
      callerOrgId: ctx.org.id,
      callerIsPlatformAdmin: ctx.isPlatformAdmin,
      callerIsOrgAdmin: ctx.role === "admin",
      scope: q.scope as FlowScope | undefined,
      orgId: q.orgId,
      limit: q.limit ? Number(q.limit) : undefined,
    });
    return { flows };
  });

  app.get("/flows/:id", { preHandler: requireAuth() }, async (req, reply) => {
    const ctx = req.runContext!; const caller = callerFromCtx(ctx);
    const { id } = req.params as { id: string };
    const flow = await c.flows.getById(id);
    if (!flow) { reply.code(404); return { error: "not_found" }; }
    if (!canRead(flow, caller)) { reply.code(403); return { error: "forbidden" }; }
    return { flow };
  });

  app.put("/flows/:id", { preHandler: requireAuth() }, async (req, reply) => {
    const ctx = req.runContext!; const caller = callerFromCtx(ctx);
    const { id } = req.params as { id: string };
    const body = updateFlowBody.parse(req.body);

    const flow = await c.flows.getById(id);
    if (!flow) { reply.code(404); return { error: "not_found" }; }
    if (!canEdit(flow, caller)) { reply.code(403); return { error: "forbidden" }; }

    if (body.name !== undefined || body.description !== undefined) {
      await c.flows.updateMeta(id, { name: body.name, description: body.description });
    }
    let newVersion = null;
    if (body.definition) {
      newVersion = await c.flowVersions.appendVersion({
        flowId: id, definition: body.definition as FlowGraph, createdByUserId: caller.userId,
      });
    }
    const updated = await c.flows.getById(id);
    return { flow: updated, version: newVersion };
  });

  app.delete("/flows/:id", { preHandler: requireAuth() }, async (req, reply) => {
    const ctx = req.runContext!; const caller = callerFromCtx(ctx);
    const { id } = req.params as { id: string };
    const flow = await c.flows.getById(id);
    if (!flow) { reply.code(404); return { error: "not_found" }; }
    if (!canDelete(flow, caller)) { reply.code(403); return { error: "forbidden" }; }
    await c.flows.delete(id);
    reply.code(204).send();
  });

  app.get("/flows/:id/versions/current", { preHandler: requireAuth() }, async (req, reply) => {
    const ctx = req.runContext!; const caller = callerFromCtx(ctx);
    const { id } = req.params as { id: string };
    const flow = await c.flows.getById(id);
    if (!flow) { reply.code(404); return { error: "not_found" }; }
    if (!canRead(flow, caller)) { reply.code(403); return { error: "forbidden" }; }
    if (!flow.currentVersionId) { reply.code(409); return { error: "flow_has_no_versions" }; }
    const version = await c.flowVersions.getById(flow.currentVersionId);
    if (!version) { reply.code(500); return { error: "version_missing" }; }
    return { version };
  });

  app.get("/flow_versions/:id", { preHandler: requireAuth() }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const version = await c.flowVersions.getById(id);
    if (!version) { reply.code(404); return { error: "not_found" }; }
    return { version };
  });

  app.post("/flows/:id/runs", { preHandler: requireAuth() }, async (req, reply) => {
    const ctx = req.runContext!; const caller = callerFromCtx(ctx);
    const { id } = req.params as { id: string };
    const body = createRunBody.parse(req.body);

    const flow = await c.flows.getById(id);
    if (!flow) { reply.code(404); return { error: "not_found" }; }
    if (!canRead(flow, caller)) { reply.code(403); return { error: "forbidden" }; }
    if (!flow.currentVersionId) { reply.code(409); return { error: "flow_has_no_versions" }; }
    const version = await c.flowVersions.getById(flow.currentVersionId);
    if (!version) { reply.code(500); return { error: "version_missing" }; }

    const { runId, engineWorkflowId } = await c.orchestrator.submit({
      flowId: flow.id,
      flowVersionId: version.id,
      flowNameSnapshot: flow.name,
      flowScopeSnapshot: flow.scope,
      definitionSnapshot: version.definition,
      inputs: body.inputs,
      startedByUserId: caller.userId,
    });

    reply.code(202);
    return { runId, engineWorkflowId };
  });

  // ----- Snapshot actions -----

  app.post("/flows/:id/clone", { preHandler: requireAuth() }, async (req, reply) => {
    const ctx = req.runContext!; const caller = callerFromCtx(ctx);
    const { id } = req.params as { id: string };
    const body = cloneFlowBody.parse(req.body ?? {});
    const src = await c.flows.getById(id);
    if (!src) { reply.code(404); return { error: "not_found" }; }
    if (!canRead(src, caller)) { reply.code(403); return { error: "forbidden" }; }
    if (!src.currentVersionId) { reply.code(409); return { error: "flow_has_no_versions" }; }
    const ver = await c.flowVersions.getById(src.currentVersionId);
    if (!ver) { reply.code(500); return { error: "version_missing" }; }

    const { flow } = await c.flows.create({
      scope: "user",
      name: body.name ?? `${src.name} (copy)`,
      description: src.description ?? undefined,
      orgId: caller.orgId,
      ownerUserId: caller.userId,
      initialDefinition: ver.definition,
      createdByUserId: caller.userId,
    });
    reply.code(201);
    return { id: flow.id };
  });

  app.post("/flows/:id/promote", { preHandler: requireAuth() }, async (req, reply) => {
    const ctx = req.runContext!; const caller = callerFromCtx(ctx);
    const { id } = req.params as { id: string };
    const body = promoteFlowBody.parse(req.body);
    const src = await c.flows.getById(id);
    if (!src) { reply.code(404); return { error: "not_found" }; }
    if (!canRead(src, caller)) { reply.code(403); return { error: "forbidden" }; }
    if (!canPromoteTo(body.targetScope, caller)) { reply.code(403); return { error: "forbidden" }; }
    if (!src.currentVersionId) { reply.code(409); return { error: "flow_has_no_versions" }; }
    const ver = await c.flowVersions.getById(src.currentVersionId);
    if (!ver) { reply.code(500); return { error: "version_missing" }; }

    const orgId =
      body.targetScope === "org"
        ? (body.orgId ?? src.orgId ?? caller.orgId)
        : null;

    const { flow } = await c.flows.create({
      scope: body.targetScope,
      name: body.name ?? src.name,
      description: src.description ?? undefined,
      orgId,
      ownerUserId: null,
      initialDefinition: ver.definition,
      createdByUserId: caller.userId,
    });
    reply.code(201);
    return { id: flow.id };
  });
}
```

---

## Task 15 — Flow grants management routes

**Files:**
- Create: `packages/api-server/src/routes/flow-grants.ts`
- Modify: `packages/api-server/src/server.ts`

- [ ] **Step 15.1: Implement the grants routes**

Create `packages/api-server/src/routes/flow-grants.ts`:

```ts
import type { FastifyInstance } from "fastify";
import type { Composition } from "../composition.ts";
import { makeRequireAuth } from "@journeyman/identity";
import { canDelete, canRead } from "../services/flow-access.ts";

export function registerFlowGrantsRoutes(app: FastifyInstance, c: Composition): void {
  const requireAuth = makeRequireAuth({ pool: c.pool! });

  app.get("/flows/:id/grants", { preHandler: requireAuth() }, async (req, reply) => {
    const ctx = req.runContext!;
    const { id } = req.params as { id: string };
    const flow = await c.flows.getById(id);
    if (!flow) { reply.code(404); return { error: "not_found" }; }
    if (!canRead(flow, {
      userId: ctx.user.id, orgId: ctx.org.id, role: ctx.role, isPlatformAdmin: ctx.isPlatformAdmin,
    })) { reply.code(403); return { error: "forbidden" }; }
    return { grants: await c.flowGrants.listByFlow(id) };
  });

  app.post("/flows/:id/grants", { preHandler: requireAuth() }, async (req, reply) => {
    const ctx = req.runContext!;
    const { id } = req.params as { id: string };
    const flow = await c.flows.getById(id);
    if (!flow) { reply.code(404); return { error: "not_found" }; }
    if (!canDelete(flow, {
      userId: ctx.user.id, orgId: ctx.org.id, role: ctx.role, isPlatformAdmin: ctx.isPlatformAdmin,
    })) { reply.code(403); return { error: "forbidden" }; }

    const body = req.body as {
      principalType?: "user" | "org" | "global";
      principalId?: string | null;
      role?: "owner" | "editor" | "viewer";
    };
    if (!body?.principalType || !body?.role) { reply.code(400); return { error: "bad_request" }; }
    if (body.role === "owner") { reply.code(409); return { error: "owner_grants_immutable_in_this_version" }; }

    const grant = await c.flowGrants.create({
      flowId: id,
      principalType: body.principalType,
      principalId: body.principalType === "global" ? null : (body.principalId ?? null),
      role: body.role,
      createdBy: ctx.user.id,
    });
    reply.code(201);
    return { grant };
  });

  app.delete("/flows/:id/grants/:grantId", { preHandler: requireAuth() }, async (req, reply) => {
    const ctx = req.runContext!;
    const { id, grantId } = req.params as { id: string; grantId: string };
    const flow = await c.flows.getById(id);
    if (!flow) { reply.code(404); return { error: "not_found" }; }
    if (!canDelete(flow, {
      userId: ctx.user.id, orgId: ctx.org.id, role: ctx.role, isPlatformAdmin: ctx.isPlatformAdmin,
    })) { reply.code(403); return { error: "forbidden" }; }

    const grants = await c.flowGrants.listByFlow(id);
    const target = grants.find(g => g.id === grantId);
    if (!target) { reply.code(404); return { error: "not_found" }; }
    if (target.role === "owner") { reply.code(409); return { error: "cannot_delete_owner_grant" }; }
    await c.flowGrants.delete(grantId);
    reply.code(204).send();
  });
}
```

- [ ] **Step 15.2: Register in `server.ts`**

In `packages/api-server/src/server.ts`, import and call after `registerFlowRoutes`:

```ts
import { registerFlowGrantsRoutes } from "./routes/flow-grants.ts";
// ...
registerFlowRoutes(app, c);
registerFlowGrantsRoutes(app, c);
```

---

## Task 16 — Web auth context: surface `isPlatformAdmin`

**Files:**
- Modify: `packages/web/src/AuthContext.tsx`
- Modify: `packages/web/src/AuthGate.tsx`

- [ ] **Step 16.1: Extend the context**

In `packages/web/src/AuthContext.tsx`:

```tsx
export interface AuthCtx {
  activeOrgId: string;
  role: "admin" | "member" | string;
  isPlatformAdmin: boolean;
  user: AuthUser | null;
  org: AuthOrg | null;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthCtx>({
  activeOrgId: "",
  role: "",
  isPlatformAdmin: false,
  user: null,
  org: null,
  logout: async () => {},
});
```

- [ ] **Step 16.2: Populate from `/me`**

In `packages/web/src/AuthGate.tsx`, locate where the `/me` (or equivalent session endpoint) response is consumed and the `AuthContext` value is constructed. Pull `isPlatformAdmin` from the response and pass it through. The session endpoint should already include the flag once Step 4.4 is done (the `/me` route returns the `UserRecord` which now contains `isPlatformAdmin`). If the server's `/me` doesn't currently expose it, add `isPlatformAdmin: user.isPlatformAdmin` to the `/me` response in `packages/identity/src/routes/users.ts` (or wherever `/me` lives).

---

## Task 17 — Web flows API client

**Files:**
- Modify: `packages/web/src/api/flows.ts`
- Create: `packages/web/src/api/flow-grants.ts`

- [ ] **Step 17.1: Update `createFlow` and add scope-aware list**

In `packages/web/src/api/flows.ts`, change `createFlow`:

```ts
export async function createFlow(args: {
  scope: "user" | "org" | "global";
  orgId?: string;
  name: string;
  description?: string;
  definition: FlowGraph;
}): Promise<{ flow: Flow; version: FlowVersion }> {
  return await api<{ flow: Flow; version: FlowVersion }>("/flows", {
    method: "POST", body: JSON.stringify(args),
  });
}

export async function listFlows(filter?: { scope?: "user" | "org" | "global"; orgId?: string }): Promise<Flow[]> {
  const qs = new URLSearchParams();
  if (filter?.scope) qs.set("scope", filter.scope);
  if (filter?.orgId) qs.set("orgId", filter.orgId);
  const path = qs.toString() ? `/flows?${qs.toString()}` : "/flows";
  const res = await api<{ flows: Flow[] }>(path);
  return res.flows;
}
```

- [ ] **Step 17.2: Add clone/promote/delete client**

Create `packages/web/src/api/flow-grants.ts`:

```ts
import { api } from "./client.ts";

export async function cloneFlow(flowId: string, name?: string): Promise<{ id: string }> {
  return await api<{ id: string }>(`/flows/${encodeURIComponent(flowId)}/clone`, {
    method: "POST", body: JSON.stringify({ name }),
  });
}

export async function promoteFlow(flowId: string, args: {
  targetScope: "org" | "global"; orgId?: string; name?: string;
}): Promise<{ id: string }> {
  return await api<{ id: string }>(`/flows/${encodeURIComponent(flowId)}/promote`, {
    method: "POST", body: JSON.stringify(args),
  });
}

export async function deleteFlow(flowId: string): Promise<void> {
  await api(`/flows/${encodeURIComponent(flowId)}`, { method: "DELETE" });
}
```

---

## Task 18 — Web: flows list page

**Files:**
- Modify: `packages/web/src/routes/FlowsListPage.tsx`

- [ ] **Step 18.1: Add scope filter chips, badges, and row actions**

Open the file and locate where the flow list renders rows. Add:

1. State for `scopeFilter: "all" | "user" | "org" | "global"` (default `"all"`).
2. Filter chips above the list (`Mine` / `Organization` / `Global` / `All`). On click, refetch via `listFlows({ scope })`.
3. A `<span>` badge next to each flow's name showing `flow.scope`.
4. Row actions:
   - If `caller-owns(flow)` (compare `flow.ownerUserId === user.id` for user-scope, or `role==='admin'` for org-scope where `flow.orgId === activeOrgId`, or `isPlatformAdmin` for global): show **Edit**, **Delete**, **Clone**, plus **Promote → Org** (when scope=user) / **Promote → Global** (when scope=org or scope=user).
   - Else: show **Clone**, **Open (read-only)**.
5. Wire **Clone** to `cloneFlow(flow.id)` then navigate to `/flows/<new>/edit`.
6. Wire **Promote → Org** to `promoteFlow(flow.id, { targetScope: "org" })`.
7. Wire **Promote → Global** to `promoteFlow(flow.id, { targetScope: "global" })`.
8. Wire **Delete** to `deleteFlow(flow.id)` with a `window.confirm` guard.

Concrete TSX scaffold for the chips (insert above the existing list):

```tsx
const [scopeFilter, setScopeFilter] = useState<"all" | "user" | "org" | "global">("all");

useEffect(() => {
  listFlows(scopeFilter === "all" ? undefined : { scope: scopeFilter }).then(setFlows);
}, [scopeFilter]);

return (
  <>
    <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
      {(["all", "user", "org", "global"] as const).map(s => (
        <button
          key={s}
          onClick={() => setScopeFilter(s)}
          style={{
            padding: "4px 10px",
            background: scopeFilter === s ? "#222" : "#eee",
            color: scopeFilter === s ? "#fff" : "#222",
            borderRadius: 4, border: "none",
          }}
        >
          {s === "user" ? "Mine" : s === "org" ? "Organization" : s === "global" ? "Global" : "All"}
        </button>
      ))}
    </div>
    {/* existing list, with new badges + actions */}
  </>
);
```

Concrete TSX for the badge inside each row:

```tsx
<span style={{
  fontSize: 11, padding: "1px 6px", marginLeft: 8,
  background: flow.scope === "global" ? "#7c3aed" : flow.scope === "org" ? "#2563eb" : "#6b7280",
  color: "#fff", borderRadius: 3,
}}>{flow.scope}</span>
```

Concrete helper for "is editable":

```tsx
function canEditFlow(
  flow: Flow,
  ctx: { userId: string; orgId: string; role: string; isPlatformAdmin: boolean },
): boolean {
  if (ctx.isPlatformAdmin) return true;
  if (flow.scope === "global") return false;
  if (flow.scope === "org")    return ctx.role === "admin" && flow.orgId === ctx.orgId;
  /* user */                    return flow.ownerUserId === ctx.userId;
}
```

---

## Task 19 — Web: new-flow page scope selector

**Files:**
- Modify: `packages/web/src/routes/NewFlowPage.tsx`

- [ ] **Step 19.1: Add a scope selector**

Add a `<select>` (or radio group) bound to local state `scope` defaulting to `"user"`. Show the option as follows:

```tsx
const { role, isPlatformAdmin } = useAuth();
const allowed: ("user" | "org" | "global")[] = [
  "user",
  ...(role === "admin" || isPlatformAdmin ? ["org"] as const : []),
  ...(isPlatformAdmin ? ["global"] as const : []),
];

<label>
  Scope:
  <select value={scope} onChange={e => setScope(e.target.value as any)}>
    {allowed.map(s => (
      <option key={s} value={s}>
        {s === "user" ? "Personal (only me)" : s === "org" ? "Organization" : "Global (all orgs)"}
      </option>
    ))}
  </select>
</label>
```

When submitting, pass `scope` to `createFlow({ scope, name, description, definition })`. Drop any `ownerUserId` field from the request.

---

## Task 20 — Web: flow editor read-only banner

**Files:**
- Modify: `packages/web/src/routes/FlowEditorPage.tsx`

- [ ] **Step 20.1: Render banner when not editable**

After fetching the flow, compute `editable` using the same `canEditFlow` helper (extract to `packages/web/src/api/flow-access.ts` if needed). If not editable:

```tsx
{!editable && (
  <div style={{
    padding: "8px 12px", marginBottom: 12,
    background: "#fef3c7", border: "1px solid #f59e0b", borderRadius: 4,
  }}>
    This is a {flow.scope} template. <button onClick={onClone}>Clone to my flows</button> to make changes.
  </div>
)}
```

Pass `readOnly={!editable}` (or whatever prop the editor accepts) to the underlying graph editor component, and disable the save button when read-only. `onClone` calls `cloneFlow(flow.id)` and navigates to `/flows/<new>/edit`.

---

## Task 21 — Web: admin flows page

**Files:**
- Create: `packages/web/src/routes/AdminFlowsPage.tsx`
- Modify: `packages/web/src/App.tsx`
- Modify: `packages/web/src/components/AppShell.tsx`

- [ ] **Step 21.1: Create the moderation page**

Create `packages/web/src/routes/AdminFlowsPage.tsx`. Structure: two sections.

```tsx
import { useEffect, useState } from "react";
import type { Flow } from "@journeyman/core";
import { listFlows } from "../api/flows.ts";
import { promoteFlow } from "../api/flow-grants.ts";
import { useAuth } from "../AuthContext.tsx";

export function AdminFlowsPage() {
  const { activeOrgId, isPlatformAdmin } = useAuth();
  const [userFlows, setUserFlows]   = useState<Flow[]>([]);
  const [orgFlows, setOrgFlows]     = useState<Flow[]>([]);

  async function refresh() {
    setUserFlows(await listFlows({ scope: "user", orgId: activeOrgId }));
    if (isPlatformAdmin) setOrgFlows(await listFlows({ scope: "org" }));
  }
  useEffect(() => { void refresh(); }, [activeOrgId, isPlatformAdmin]);

  return (
    <div>
      <h2>User flows in this org</h2>
      <table>
        <thead><tr><th>Name</th><th>Owner</th><th></th></tr></thead>
        <tbody>
          {userFlows.map(f => (
            <tr key={f.id}>
              <td>{f.name}</td>
              <td>{f.ownerUserId ?? "—"}</td>
              <td>
                <button onClick={async () => {
                  await promoteFlow(f.id, { targetScope: "org" });
                  await refresh();
                }}>Promote to Org</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {isPlatformAdmin && (
        <>
          <h2>Org flows (all orgs)</h2>
          <table>
            <thead><tr><th>Name</th><th>Org</th><th></th></tr></thead>
            <tbody>
              {orgFlows.map(f => (
                <tr key={f.id}>
                  <td>{f.name}</td>
                  <td>{f.orgId ?? "—"}</td>
                  <td>
                    <button onClick={async () => {
                      await promoteFlow(f.id, { targetScope: "global" });
                      await refresh();
                    }}>Promote to Global</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 21.2: Register route + nav**

In `packages/web/src/App.tsx`, add (next to the other admin routes):

```tsx
import { AdminFlowsPage } from "./routes/AdminFlowsPage.tsx";
// ...
<Route
  path="/admin/flows"
  element={role === "admin" ? <AdminFlowsPage /> : <Navigate to="/" replace />}
/>
```

In `packages/web/src/components/AppShell.tsx`, find the admin nav block (where `Admin → Users` and `Admin → Secrets` already appear) and add a `Admin → Flows` link next to them, gated by `role === "admin"`.

---

## Task 22 — Verification

**Files:** none (verification only).

- [ ] **Step 22.1: Run typecheck across the workspace**

Run from repo root:

```bash
npm run typecheck
```

Expected: no TypeScript errors. Resolve any errors before considering the implementation complete. Common error categories to expect and how to address:

- `Property 'scope' is missing on type Flow` in old call sites that built `Flow` literals → propagate `scope`/`orgId`/`ownerUserId` from the store.
- `Property 'isPlatformAdmin' is missing` in tests/mocks of `RunContext` or `UserRecord` → add the field.
- `Argument of type ... is not assignable` on `runs.create({...})` → ensure all snapshot fields are passed.
- `Property 'flowDefinition' does not exist` on orchestrator submit → renamed to `definitionSnapshot`.

- [ ] **Step 22.2: Manual smoke list**

Without committing, walk through these in the running app to confirm the feature behaves:

1. Login as bootstrap user (now platform admin). New "Global" option appears in `New Flow`.
2. Create a global flow. Log in as a different org's member. The global flow appears with a `global` badge. Click `Clone` → land in editor with a copy.
3. Log in as an org admin. Create an org flow. A regular member of the same org sees it; a member of another org does not.
4. Org admin opens `Admin → Flows`, sees a member's user-scope flow, clicks `Promote to Org` → it appears as an org flow.
5. Run a flow, then delete the flow. The run still opens; viewer shows the snapshotted name and definition.

---

## Self-Review Notes

Coverage check (spec → tasks):
- Data model: Tasks 1, 2, 3, 6, 7, 8.
- Permission model: Task 12; enforced in Task 14, 15.
- API surface (CRUD + clone/promote): Task 14.
- API surface (grants management): Task 15.
- Run resolution / snapshots: Tasks 1, 2, 9, 10, 14 (submit call site).
- UI: Tasks 16, 17, 18, 19, 20, 21.
- Migration: Task 3 + bootstrap touch in Task 4.
- Backwards compatibility (legacy `owner_user_id` TEXT column kept): handled in Task 3 step 6.
- Future-work hooks (grants endpoint reserved): Task 15.

Per user constraints: **no per-task commit steps**, **no test cases**, **typecheck only at the very end** in Task 22.
