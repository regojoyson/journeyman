# Workspace Scoping — Phase 1: Identity Core — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Workspaces and per-workspace roles under Orgs, plus an extensible permission-based authorization layer (`can()`), without yet cutting any resource over to workspace scoping.

**Architecture:** Pure permission logic (enum, role→permission grants, `evaluateCan`) lives in `@journeyman/core` so any package can use it with zero dependencies. `@journeyman/identity` adds workspace/member DB access, a DB-backed `can()` and two Fastify preHandlers (`requireWorkspacePermission`, `requireOrgRole`), and extends bootstrap to create a default workspace. Migration `047` adds two tables and backfills a default workspace for existing orgs so the running system stays functional. No resource tables change in this phase.

**Tech Stack:** TypeScript (ESM, `.ts` imports), PostgreSQL 16 via `pg` (raw SQL, no ORM), Fastify 5, vitest 4. Migrations are append-only `0NN_name.sql` files run by `journeyman-migrate`.

**Scope guard:** This plan is Phase 1 of 3. Phase 2 (resource cutover) and Phase 3 (UI) are separate plans, written after this lands — they depend on the interfaces built here. Do **not** modify any resource table, resolver, or resource route in this phase.

---

## File Structure

**Create:**
- `packages/core/src/types/workspace.types.ts` — `WorkspaceRole`, `WorkspacePermission`, `WORKSPACE_PERMISSIONS`, `WorkspaceRecord`, `WorkspaceMemberRecord`, `WorkspaceContext`, `WorkspaceMemberLike`.
- `packages/core/src/workspace-permissions.ts` — `ROLE_GRANTS`, `roleGrants()`, `resolvePermissions()`, `evaluateCan()` (all pure).
- `packages/core/src/workspace-permissions.test.ts` — truth-table tests for the above.
- `packages/migrations/src/sql/047_workspaces.sql` — `jm_workspaces` + `jm_workspace_members` + backfill.
- `packages/identity/src/db-workspaces.ts` — workspace + member CRUD (accepts a `Queryable`).
- `packages/identity/src/db-workspaces.test.ts` — fakeDb tests for query/params/row-mapping.
- `packages/identity/src/authz.ts` — `loadWorkspaceAccess()`, `can()`, `makeRequireWorkspacePermission()`, `makeRequireOrgRole()`.
- `packages/identity/src/authz.test.ts` — fakeDb tests for the loader, `can()`, and preHandlers.

**Modify:**
- `packages/core/src/index.ts` — export the two new core modules.
- `packages/core/src/types/identity.types.ts` — add optional `workspace` field to `RunContext`.
- `packages/identity/src/bootstrap.ts` — create default workspace + maintainer membership in the bootstrap transaction.
- `packages/identity/src/index.ts` — export `db-workspaces` + `authz`.
- `packages/identity/package.json` — add `"test": "vitest run"` script + `vitest` devDependency.

---

## Task 1: Core permission types

**Files:**
- Create: `packages/core/src/types/workspace.types.ts`

- [ ] **Step 1: Create the types file**

```typescript
// packages/core/src/types/workspace.types.ts

/** Workspace-level role. Ordered maintainer > contributor > observer. */
export type WorkspaceRole = "maintainer" | "contributor" | "observer";

/**
 * Stable permission contracts. Routes bind to these names, never to roles.
 * Adding a permission here never breaks existing call sites.
 */
export const WORKSPACE_PERMISSIONS = [
  "workspace.view",
  "resource.read",
  "resource.write",
  "resource.delete",
  "members.manage",
  "settings.manage",
] as const;

export type WorkspacePermission = (typeof WORKSPACE_PERMISSIONS)[number];

export interface WorkspaceRecord {
  id: string;
  orgId: string;
  slug: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface WorkspaceMemberRecord {
  id: string;
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
  /** Reserved future per-member permission override slot. Unused in Phase 1. */
  permissions: WorkspacePermission[] | null;
  createdAt: Date;
}

/** Minimal member shape needed to resolve permissions (decouples pure logic from the DB record). */
export interface WorkspaceMemberLike {
  role: WorkspaceRole;
  permissions?: WorkspacePermission[] | null;
}

/** Resolved workspace access attached to RunContext by requireWorkspacePermission. */
export interface WorkspaceContext {
  id: string;
  orgId: string;
  /** null when access is granted via platform/org admin without explicit membership. */
  role: WorkspaceRole | null;
  permissions: WorkspacePermission[];
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck -w @journeyman/core`
Expected: PASS (no usages yet; file compiles).

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/types/workspace.types.ts
git commit -m "feat(core): workspace permission + record types"
```

---

## Task 2: Core permission logic (pure, TDD)

**Files:**
- Create: `packages/core/src/workspace-permissions.test.ts`
- Create: `packages/core/src/workspace-permissions.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/workspace-permissions.test.ts
import { describe, it, expect } from "vitest";
import { WORKSPACE_PERMISSIONS } from "./types/workspace.types.ts";
import { roleGrants, resolvePermissions, evaluateCan } from "./workspace-permissions.ts";

describe("roleGrants", () => {
  it("observer can view + read only", () => {
    expect([...roleGrants("observer")].sort()).toEqual(["resource.read", "workspace.view"]);
  });
  it("contributor adds write + delete", () => {
    const g = roleGrants("contributor");
    expect(g.has("resource.write")).toBe(true);
    expect(g.has("resource.delete")).toBe(true);
    expect(g.has("members.manage")).toBe(false);
  });
  it("maintainer has every permission", () => {
    const g = roleGrants("maintainer");
    for (const p of WORKSPACE_PERMISSIONS) expect(g.has(p)).toBe(true);
  });
});

describe("resolvePermissions", () => {
  it("returns the role grant set (ignores reserved permissions slot in phase 1)", () => {
    expect([...resolvePermissions({ role: "observer", permissions: ["settings.manage"] })].sort())
      .toEqual(["resource.read", "workspace.view"]);
  });
});

describe("evaluateCan", () => {
  it("platform admin can do anything, even with no membership", () => {
    expect(evaluateCan({ isPlatformAdmin: true, isOrgAdmin: false, member: null }, "settings.manage")).toBe(true);
  });
  it("org admin can do anything (implicit maintainer)", () => {
    expect(evaluateCan({ isPlatformAdmin: false, isOrgAdmin: true, member: null }, "members.manage")).toBe(true);
  });
  it("observer cannot write", () => {
    expect(evaluateCan({ isPlatformAdmin: false, isOrgAdmin: false, member: { role: "observer" } }, "resource.write")).toBe(false);
  });
  it("contributor can write but not manage members", () => {
    const m = { role: "contributor" as const };
    expect(evaluateCan({ isPlatformAdmin: false, isOrgAdmin: false, member: m }, "resource.write")).toBe(true);
    expect(evaluateCan({ isPlatformAdmin: false, isOrgAdmin: false, member: m }, "members.manage")).toBe(false);
  });
  it("no access when not a member and not admin", () => {
    expect(evaluateCan({ isPlatformAdmin: false, isOrgAdmin: false, member: null }, "resource.read")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/src/workspace-permissions.test.ts`
Expected: FAIL — cannot resolve `./workspace-permissions.ts` (module not found).

- [ ] **Step 3: Write the implementation**

```typescript
// packages/core/src/workspace-permissions.ts
import type {
  WorkspaceRole,
  WorkspacePermission,
  WorkspaceMemberLike,
} from "./types/workspace.types.ts";

const OBSERVER: WorkspacePermission[] = ["workspace.view", "resource.read"];
const CONTRIBUTOR: WorkspacePermission[] = [...OBSERVER, "resource.write", "resource.delete"];
const MAINTAINER: WorkspacePermission[] = [...CONTRIBUTOR, "members.manage", "settings.manage"];

export const ROLE_GRANTS: Record<WorkspaceRole, WorkspacePermission[]> = {
  observer: OBSERVER,
  contributor: CONTRIBUTOR,
  maintainer: MAINTAINER,
};

export function roleGrants(role: WorkspaceRole): Set<WorkspacePermission> {
  return new Set(ROLE_GRANTS[role]);
}

/**
 * The ONLY function that changes when granular/custom permissions arrive later.
 * Phase 1: permissions derive purely from the member's role.
 */
export function resolvePermissions(member: WorkspaceMemberLike): Set<WorkspacePermission> {
  return roleGrants(member.role);
}

export interface CanInput {
  isPlatformAdmin: boolean;
  isOrgAdmin: boolean;
  member: WorkspaceMemberLike | null;
}

/** Pure access decision. STABLE — all guards bind to this shape. */
export function evaluateCan(input: CanInput, permission: WorkspacePermission): boolean {
  if (input.isPlatformAdmin) return true;
  if (input.isOrgAdmin) return true; // implicit maintainer on every workspace in the org
  if (input.member) return resolvePermissions(input.member).has(permission);
  return false;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/core/src/workspace-permissions.test.ts`
Expected: PASS (all cases green).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/workspace-permissions.ts packages/core/src/workspace-permissions.test.ts
git commit -m "feat(core): pure workspace permission resolution + evaluateCan"
```

---

## Task 3: Export core modules

**Files:**
- Modify: `packages/core/src/index.ts` (add after the `identity.types.ts` export on line ~40)

- [ ] **Step 1: Add the exports**

Add these two lines immediately after the existing `export * from "./types/identity.types.ts";` line:

```typescript
export type * from "./types/workspace.types.ts";
export { WORKSPACE_PERMISSIONS } from "./types/workspace.types.ts";
export { ROLE_GRANTS, roleGrants, resolvePermissions, evaluateCan } from "./workspace-permissions.ts";
```

- [ ] **Step 2: Typecheck + boundaries**

Run: `npm run typecheck -w @journeyman/core && npm run check:boundaries`
Expected: PASS. `core` imports nothing from other `@journeyman/*` packages.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/index.ts
git commit -m "feat(core): export workspace types + permission logic"
```

---

## Task 4: Migration 047 — workspace tables + backfill

**Files:**
- Create: `packages/migrations/src/sql/047_workspaces.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
-- 047_workspaces.sql
-- Phase 1 of workspace scoping: add workspaces + per-workspace membership.
-- Backfills a "Default" workspace per existing org so the running system keeps working.

CREATE TABLE IF NOT EXISTS jm_workspaces (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES jm_orgs(id) ON DELETE CASCADE,
  slug        TEXT NOT NULL,
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, slug)
);

CREATE TABLE IF NOT EXISTS jm_workspace_members (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES jm_workspaces(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES jm_users(id) ON DELETE CASCADE,
  role          TEXT NOT NULL CHECK (role IN ('maintainer','contributor','observer')),
  permissions   JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, user_id)
);

CREATE INDEX IF NOT EXISTS jm_workspaces_org_idx ON jm_workspaces(org_id);
CREATE INDEX IF NOT EXISTS jm_workspace_members_ws_idx ON jm_workspace_members(workspace_id);
CREATE INDEX IF NOT EXISTS jm_workspace_members_user_idx ON jm_workspace_members(user_id);

-- Backfill: one "Default" workspace per org that has none.
INSERT INTO jm_workspaces (org_id, slug, name)
SELECT o.id, 'default', 'Default'
FROM jm_orgs o
WHERE NOT EXISTS (
  SELECT 1 FROM jm_workspaces w WHERE w.org_id = o.id AND w.slug = 'default'
);

-- Backfill: every existing org member becomes a workspace member of that org's default
-- workspace. Org admins -> maintainer, everyone else -> contributor.
INSERT INTO jm_workspace_members (workspace_id, user_id, role)
SELECT w.id, m.user_id,
       CASE WHEN m.role = 'admin' THEN 'maintainer' ELSE 'contributor' END
FROM jm_memberships m
JOIN jm_workspaces w ON w.org_id = m.org_id AND w.slug = 'default'
WHERE NOT EXISTS (
  SELECT 1 FROM jm_workspace_members wm
  WHERE wm.workspace_id = w.id AND wm.user_id = m.user_id
);
```

- [ ] **Step 2: Run the migration against the dev DB to verify it applies**

> Requires dev infra running (`npm run infra:up`) and `DATABASE_URL` pointing at it. Per project memory, `infra:up` does NOT auto-migrate.

Run: `npm run migrate`
Expected: output includes `047_workspaces` as applied; no error.

- [ ] **Step 3: Verify schema + backfill with psql**

Run:
```bash
psql "$DATABASE_URL" -c "\d jm_workspaces" -c "\d jm_workspace_members" \
  -c "SELECT count(*) AS ws FROM jm_workspaces;" \
  -c "SELECT count(*) AS members FROM jm_workspace_members;"
```
Expected: both tables exist with the columns above; `ws` ≥ number of existing orgs; `members` ≥ number of existing memberships.

- [ ] **Step 4: Commit**

```bash
git add packages/migrations/src/sql/047_workspaces.sql
git commit -m "feat(migrations): 047 workspaces + workspace_members + backfill"
```

---

## Task 5: Workspace + member DB access (fakeDb TDD)

**Files:**
- Create: `packages/identity/src/db-workspaces.test.ts`
- Create: `packages/identity/src/db-workspaces.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/identity/src/db-workspaces.test.ts
import { describe, it, expect } from "vitest";
import type { Queryable } from "./db-workspaces.ts";
import {
  createWorkspace,
  getWorkspace,
  listWorkspacesForOrg,
  upsertWorkspaceMember,
  getWorkspaceMember,
  listWorkspaceMembers,
} from "./db-workspaces.ts";

type Call = { text: string; params?: unknown[] };
function fakeDb(responder: (call: Call, i: number) => { rows: any[] }) {
  const calls: Call[] = [];
  const db: Queryable & { calls: Call[] } = {
    calls,
    async query(text: string, params?: unknown[]) {
      const call = { text, params };
      const i = calls.length;
      calls.push(call);
      return responder(call, i);
    },
  };
  return db;
}

const WS_ROW = {
  id: "w1", org_id: "o1", slug: "default", name: "Default",
  created_at: "2026-06-18T00:00:00Z", updated_at: "2026-06-18T00:00:00Z",
};
const MEMBER_ROW = {
  id: "m1", workspace_id: "w1", user_id: "u1", role: "maintainer",
  permissions: null, created_at: "2026-06-18T00:00:00Z",
};

describe("workspace store", () => {
  it("createWorkspace inserts and maps row->record", async () => {
    const db = fakeDb(() => ({ rows: [WS_ROW] }));
    const rec = await createWorkspace(db, { orgId: "o1", slug: "default", name: "Default" });
    expect(rec.id).toBe("w1");
    expect(rec.orgId).toBe("o1");
    expect(db.calls[0].text).toMatch(/insert into jm_workspaces/i);
    expect(db.calls[0].params).toEqual(["o1", "default", "Default"]);
  });

  it("getWorkspace returns null when no row", async () => {
    const db = fakeDb(() => ({ rows: [] }));
    expect(await getWorkspace(db, "missing")).toBeNull();
  });

  it("listWorkspacesForOrg filters by org and orders by name", async () => {
    const db = fakeDb(() => ({ rows: [WS_ROW] }));
    const rows = await listWorkspacesForOrg(db, "o1");
    expect(rows).toHaveLength(1);
    expect(db.calls[0].text).toMatch(/where org_id = \$1/i);
    expect(db.calls[0].params).toEqual(["o1"]);
  });

  it("upsertWorkspaceMember upserts on (workspace_id,user_id) and maps record", async () => {
    const db = fakeDb(() => ({ rows: [MEMBER_ROW] }));
    const rec = await upsertWorkspaceMember(db, { workspaceId: "w1", userId: "u1", role: "maintainer" });
    expect(rec.role).toBe("maintainer");
    expect(rec.permissions).toBeNull();
    expect(db.calls[0].text).toMatch(/on conflict \(workspace_id, user_id\) do update/i);
    expect(db.calls[0].params).toEqual(["w1", "u1", "maintainer"]);
  });

  it("getWorkspaceMember returns null when absent", async () => {
    const db = fakeDb(() => ({ rows: [] }));
    expect(await getWorkspaceMember(db, "w1", "nobody")).toBeNull();
  });

  it("listWorkspaceMembers filters by workspace", async () => {
    const db = fakeDb(() => ({ rows: [MEMBER_ROW] }));
    const rows = await listWorkspaceMembers(db, "w1");
    expect(rows[0].userId).toBe("u1");
    expect(db.calls[0].params).toEqual(["w1"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/identity/src/db-workspaces.test.ts`
Expected: FAIL — module `./db-workspaces.ts` not found.

- [ ] **Step 3: Write the implementation**

```typescript
// packages/identity/src/db-workspaces.ts
import type {
  WorkspaceRecord,
  WorkspaceMemberRecord,
  WorkspaceRole,
} from "@journeyman/core";

/** Minimal query surface so unit tests can pass a fake (matches builder/src/db.ts). */
export interface Queryable {
  query(text: string, params?: unknown[]): Promise<{ rows: any[] }>;
}

function rowToWorkspace(r: any): WorkspaceRecord {
  return {
    id: r.id,
    orgId: r.org_id,
    slug: r.slug,
    name: r.name,
    createdAt: new Date(r.created_at),
    updatedAt: new Date(r.updated_at),
  };
}

function rowToMember(r: any): WorkspaceMemberRecord {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    userId: r.user_id,
    role: r.role,
    permissions: r.permissions ?? null,
    createdAt: new Date(r.created_at),
  };
}

export async function createWorkspace(
  db: Queryable,
  input: { orgId: string; slug: string; name: string },
): Promise<WorkspaceRecord> {
  const r = await db.query(
    `INSERT INTO jm_workspaces (org_id, slug, name)
     VALUES ($1, $2, $3)
     RETURNING id, org_id, slug, name, created_at, updated_at`,
    [input.orgId, input.slug, input.name],
  );
  return rowToWorkspace(r.rows[0]);
}

export async function getWorkspace(db: Queryable, workspaceId: string): Promise<WorkspaceRecord | null> {
  const r = await db.query(
    `SELECT id, org_id, slug, name, created_at, updated_at
     FROM jm_workspaces WHERE id = $1`,
    [workspaceId],
  );
  return r.rows[0] ? rowToWorkspace(r.rows[0]) : null;
}

export async function listWorkspacesForOrg(db: Queryable, orgId: string): Promise<WorkspaceRecord[]> {
  const r = await db.query(
    `SELECT id, org_id, slug, name, created_at, updated_at
     FROM jm_workspaces WHERE org_id = $1 ORDER BY name ASC`,
    [orgId],
  );
  return r.rows.map(rowToWorkspace);
}

export async function deleteWorkspace(db: Queryable, workspaceId: string, orgId: string): Promise<void> {
  await db.query(`DELETE FROM jm_workspaces WHERE id = $1 AND org_id = $2`, [workspaceId, orgId]);
}

export async function upsertWorkspaceMember(
  db: Queryable,
  input: { workspaceId: string; userId: string; role: WorkspaceRole },
): Promise<WorkspaceMemberRecord> {
  const r = await db.query(
    `INSERT INTO jm_workspace_members (workspace_id, user_id, role)
     VALUES ($1, $2, $3)
     ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = EXCLUDED.role
     RETURNING id, workspace_id, user_id, role, permissions, created_at`,
    [input.workspaceId, input.userId, input.role],
  );
  return rowToMember(r.rows[0]);
}

export async function getWorkspaceMember(
  db: Queryable,
  workspaceId: string,
  userId: string,
): Promise<WorkspaceMemberRecord | null> {
  const r = await db.query(
    `SELECT id, workspace_id, user_id, role, permissions, created_at
     FROM jm_workspace_members WHERE workspace_id = $1 AND user_id = $2`,
    [workspaceId, userId],
  );
  return r.rows[0] ? rowToMember(r.rows[0]) : null;
}

export async function listWorkspaceMembers(db: Queryable, workspaceId: string): Promise<WorkspaceMemberRecord[]> {
  const r = await db.query(
    `SELECT id, workspace_id, user_id, role, permissions, created_at
     FROM jm_workspace_members WHERE workspace_id = $1 ORDER BY created_at ASC`,
    [workspaceId],
  );
  return r.rows.map(rowToMember);
}

export async function removeWorkspaceMember(db: Queryable, workspaceId: string, userId: string): Promise<void> {
  await db.query(`DELETE FROM jm_workspace_members WHERE workspace_id = $1 AND user_id = $2`, [workspaceId, userId]);
}

export async function updateWorkspaceMemberRole(
  db: Queryable,
  workspaceId: string,
  userId: string,
  role: WorkspaceRole,
): Promise<void> {
  await db.query(
    `UPDATE jm_workspace_members SET role = $3 WHERE workspace_id = $1 AND user_id = $2`,
    [workspaceId, userId, role],
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/identity/src/db-workspaces.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/identity/src/db-workspaces.ts packages/identity/src/db-workspaces.test.ts
git commit -m "feat(identity): workspace + workspace-member DB access"
```

---

## Task 6: Authorization — loader, can(), and preHandlers (fakeDb TDD)

**Files:**
- Modify: `packages/core/src/types/identity.types.ts` (add `workspace` to `RunContext`)
- Create: `packages/identity/src/authz.test.ts`
- Create: `packages/identity/src/authz.ts`

- [ ] **Step 1: Add the optional `workspace` field to `RunContext`**

In `packages/core/src/types/identity.types.ts`, add an import at the top and one field to `RunContext`:

```typescript
import type { WorkspaceContext } from "./workspace.types.ts";
```

Then inside `interface RunContext { ... }`, add as the last field:

```typescript
  /** Set by requireWorkspacePermission when a :wsId route resolves. */
  workspace?: WorkspaceContext;
```

- [ ] **Step 2: Typecheck core**

Run: `npm run typecheck -w @journeyman/core`
Expected: PASS.

- [ ] **Step 3: Write the failing test**

```typescript
// packages/identity/src/authz.test.ts
import { describe, it, expect } from "vitest";
import type { Queryable } from "./db-workspaces.ts";
import { loadWorkspaceAccess, can, makeRequireWorkspacePermission } from "./authz.ts";
import type { RunContext } from "@journeyman/core";

type Call = { text: string; params?: unknown[] };
function fakeDb(responder: (call: Call, i: number) => { rows: any[] }) {
  const calls: Call[] = [];
  return {
    calls,
    async query(text: string, params?: unknown[]) {
      calls.push({ text, params });
      return responder({ text, params }, calls.length - 1);
    },
  } as Queryable & { calls: Call[] };
}

const baseCtx: RunContext = {
  user: { id: "u1", username: "alice" },
  org: { id: "o1", slug: "acme" },
  membershipId: "mem1",
  role: "member",
  isPlatformAdmin: false,
  tokenKind: "access-jwt",
};

describe("loadWorkspaceAccess", () => {
  it("returns null when the workspace does not exist", async () => {
    const db = fakeDb(() => ({ rows: [] }));
    expect(await loadWorkspaceAccess(db, "u1", "missing")).toBeNull();
  });
  it("maps org-admin + workspace membership", async () => {
    const db = fakeDb(() => ({ rows: [{ org_id: "o1", org_role: "admin", ws_role: "observer", ws_permissions: null }] }));
    const acc = await loadWorkspaceAccess(db, "u1", "w1");
    expect(acc).toEqual({ orgId: "o1", isOrgAdmin: true, member: { role: "observer", permissions: null } });
  });
  it("member null when user has no workspace membership", async () => {
    const db = fakeDb(() => ({ rows: [{ org_id: "o1", org_role: "member", ws_role: null, ws_permissions: null }] }));
    const acc = await loadWorkspaceAccess(db, "u1", "w1");
    expect(acc).toEqual({ orgId: "o1", isOrgAdmin: false, member: null });
  });
});

describe("can", () => {
  it("platform admin bypasses DB membership", async () => {
    const db = fakeDb(() => ({ rows: [{ org_id: "o1", org_role: "member", ws_role: null, ws_permissions: null }] }));
    expect(await can(db, { ...baseCtx, isPlatformAdmin: true }, "w1", "settings.manage")).toBe(true);
  });
  it("contributor can write, cannot manage members", async () => {
    const db = fakeDb(() => ({ rows: [{ org_id: "o1", org_role: "member", ws_role: "contributor", ws_permissions: null }] }));
    expect(await can(db, baseCtx, "w1", "resource.write")).toBe(true);
    const db2 = fakeDb(() => ({ rows: [{ org_id: "o1", org_role: "member", ws_role: "contributor", ws_permissions: null }] }));
    expect(await can(db2, baseCtx, "w1", "members.manage")).toBe(false);
  });
  it("false when workspace missing", async () => {
    const db = fakeDb(() => ({ rows: [] }));
    expect(await can(db, baseCtx, "missing", "resource.read")).toBe(false);
  });
});

describe("makeRequireWorkspacePermission", () => {
  function fakeReplyAndReq(ctx: RunContext, wsId: string) {
    const sent: { code?: number; body?: any } = {};
    const reply = {
      code(c: number) { sent.code = c; return reply; },
      send(b: any) { sent.body = b; return reply; },
    };
    const req: any = { params: { wsId }, runContext: { ...ctx } };
    return { req, reply, sent };
  }

  it("403s an observer trying to write", async () => {
    const pool = fakeDb(() => ({ rows: [{ org_id: "o1", org_role: "member", ws_role: "observer", ws_permissions: null }] }));
    const guard = makeRequireWorkspacePermission({ pool: pool as any })("resource.write");
    const { req, reply, sent } = fakeReplyAndReq(baseCtx, "w1");
    await guard(req, reply);
    expect(sent.code).toBe(403);
  });

  it("passes a maintainer and sets req.runContext.workspace", async () => {
    const pool = fakeDb(() => ({ rows: [{ org_id: "o1", org_role: "member", ws_role: "maintainer", ws_permissions: null }] }));
    const guard = makeRequireWorkspacePermission({ pool: pool as any })("settings.manage");
    const { req, reply, sent } = fakeReplyAndReq(baseCtx, "w1");
    await guard(req, reply);
    expect(sent.code).toBeUndefined();
    expect(req.runContext.workspace).toEqual({
      id: "w1", orgId: "o1", role: "maintainer",
      permissions: expect.arrayContaining(["settings.manage", "resource.write"]),
    });
  });

  it("404s when the workspace does not exist", async () => {
    const pool = fakeDb(() => ({ rows: [] }));
    const guard = makeRequireWorkspacePermission({ pool: pool as any })("resource.read");
    const { req, reply, sent } = fakeReplyAndReq(baseCtx, "missing");
    await guard(req, reply);
    expect(sent.code).toBe(404);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run packages/identity/src/authz.test.ts`
Expected: FAIL — module `./authz.ts` not found.

- [ ] **Step 5: Write the implementation**

```typescript
// packages/identity/src/authz.ts
import type { FastifyRequest, FastifyReply } from "fastify";
import type {
  RunContext,
  WorkspacePermission,
  WorkspaceMemberLike,
  WorkspaceRole,
} from "@journeyman/core";
import { evaluateCan, resolvePermissions, roleGrants } from "@journeyman/core";
import type { Queryable } from "./db-workspaces.ts";

export interface WorkspaceAccess {
  orgId: string;
  isOrgAdmin: boolean;
  member: WorkspaceMemberLike | null;
}

/**
 * Single query: resolves the caller's org-admin status and workspace membership
 * for a given workspace. Returns null if the workspace does not exist.
 */
export async function loadWorkspaceAccess(
  db: Queryable,
  userId: string,
  workspaceId: string,
): Promise<WorkspaceAccess | null> {
  const r = await db.query(
    `SELECT w.org_id            AS org_id,
            m.role              AS org_role,
            wm.role             AS ws_role,
            wm.permissions      AS ws_permissions
     FROM jm_workspaces w
     LEFT JOIN jm_memberships m       ON m.org_id = w.org_id AND m.user_id = $1
     LEFT JOIN jm_workspace_members wm ON wm.workspace_id = w.id AND wm.user_id = $1
     WHERE w.id = $2`,
    [userId, workspaceId],
  );
  const row = r.rows[0];
  if (!row) return null;
  const member: WorkspaceMemberLike | null = row.ws_role
    ? { role: row.ws_role as WorkspaceRole, permissions: row.ws_permissions ?? null }
    : null;
  return { orgId: row.org_id, isOrgAdmin: row.org_role === "admin", member };
}

/** DB-backed access decision. Returns false if the workspace is missing. */
export async function can(
  db: Queryable,
  ctx: RunContext,
  workspaceId: string,
  permission: WorkspacePermission,
): Promise<boolean> {
  const access = await loadWorkspaceAccess(db, ctx.user.id, workspaceId);
  if (!access) return false;
  return evaluateCan(
    { isPlatformAdmin: ctx.isPlatformAdmin, isOrgAdmin: access.isOrgAdmin, member: access.member },
    permission,
  );
}

export interface AuthzDeps {
  pool: Queryable;
}

type PreHandler = (req: FastifyRequest, reply: FastifyReply) => Promise<void>;

/**
 * Guard factory. `requireWorkspacePermission(perm)` returns a preHandler that:
 *  - requires requireAuth to have already populated req.runContext
 *  - reads :wsId, 404s if the workspace is missing
 *  - 403s if the caller lacks `perm`
 *  - otherwise attaches the resolved workspace to req.runContext.workspace
 */
export function makeRequireWorkspacePermission(deps: AuthzDeps) {
  return (permission: WorkspacePermission): PreHandler => {
    return async (req, reply) => {
      const ctx = req.runContext;
      if (!ctx) {
        await reply.code(401).send({ error: "unauthorized" });
        return;
      }
      const wsId = (req.params as { wsId?: string }).wsId;
      if (!wsId) {
        await reply.code(400).send({ error: "missing workspace id" });
        return;
      }
      const access = await loadWorkspaceAccess(deps.pool, ctx.user.id, wsId);
      if (!access) {
        await reply.code(404).send({ error: "workspace not found" });
        return;
      }
      const allowed = evaluateCan(
        { isPlatformAdmin: ctx.isPlatformAdmin, isOrgAdmin: access.isOrgAdmin, member: access.member },
        permission,
      );
      if (!allowed) {
        await reply.code(403).send({ error: "forbidden" });
        return;
      }
      const permissions = ctx.isPlatformAdmin || access.isOrgAdmin
        ? [...roleGrants("maintainer")]
        : access.member
          ? [...resolvePermissions(access.member)]
          : [];
      ctx.workspace = {
        id: wsId,
        orgId: access.orgId,
        role: access.member?.role ?? null,
        permissions,
      };
    };
  };
}

/**
 * Org-level guard. `requireOrgRole('admin')` returns a preHandler that allows
 * platform admins and org admins of the context org through, else 403s.
 * If the route has an :orgId param, it must match the context org.
 */
export function makeRequireOrgRole(_deps: AuthzDeps) {
  return (role: "admin"): PreHandler => {
    return async (req, reply) => {
      const ctx = req.runContext;
      if (!ctx) {
        await reply.code(401).send({ error: "unauthorized" });
        return;
      }
      const orgId = (req.params as { orgId?: string }).orgId;
      if (orgId && orgId !== ctx.org.id && !ctx.isPlatformAdmin) {
        await reply.code(403).send({ error: "forbidden" });
        return;
      }
      if (!ctx.isPlatformAdmin && !(role === "admin" && ctx.role === "admin")) {
        await reply.code(403).send({ error: "forbidden" });
        return;
      }
    };
  };
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run packages/identity/src/authz.test.ts`
Expected: PASS (loader mapping, `can` decisions, and all three preHandler cases green).

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/types/identity.types.ts packages/identity/src/authz.ts packages/identity/src/authz.test.ts
git commit -m "feat(identity): DB-backed can() + requireWorkspacePermission/requireOrgRole guards"
```

---

## Task 7: Bootstrap creates a default workspace

**Files:**
- Modify: `packages/identity/src/bootstrap.ts`

> `bootstrap()` runs inside one transaction on a single client (`pool.connect()` / `client.query`). Read the file first to confirm the client variable name (the existing INSERTs use it). The steps below assume the in-transaction client is named `client`; if it differs, use the actual name.

- [ ] **Step 1: Add workspace + member creation to the bootstrap transaction**

After the existing `INSERT INTO jm_memberships ... role='admin'` statement and before the `UPDATE jm_system_state SET bootstrapped_at = now()` statement, insert:

```typescript
  const wsRes = await client.query(
    `INSERT INTO jm_workspaces (org_id, slug, name)
     VALUES ($1, 'default', 'Default')
     RETURNING id`,
    [orgId],
  );
  const workspaceId = wsRes.rows[0].id as string;

  await client.query(
    `INSERT INTO jm_workspace_members (workspace_id, user_id, role)
     VALUES ($1, $2, 'maintainer')`,
    [workspaceId, userId],
  );
```

> Use the same `orgId` and `userId` variables the existing membership INSERT uses. If those rows are captured differently (e.g. `org.id`, `user.id`), match the existing code's names.

- [ ] **Step 2: Typecheck identity**

Run: `npm run typecheck -w @journeyman/identity`
Expected: PASS.

- [ ] **Step 3: Verify bootstrap end-to-end against a fresh DB**

> Use a throwaway database so the `jm_system_state` bootstrap gate is clean.

Run:
```bash
createdb jm_bootstrap_test 2>/dev/null || true
DATABASE_URL="postgres://localhost/jm_bootstrap_test" npm run migrate
DATABASE_URL="postgres://localhost/jm_bootstrap_test" npx tsx packages/identity/src/cli/bootstrap.ts \
  --org-name "Acme" --org-slug acme --username admin --password "pw-at-least-8-chars"
psql "postgres://localhost/jm_bootstrap_test" \
  -c "SELECT u.is_platform_admin, w.slug AS ws, wm.role AS ws_role
      FROM jm_users u
      JOIN jm_workspace_members wm ON wm.user_id = u.id
      JOIN jm_workspaces w ON w.id = wm.workspace_id;"
```
Expected: one row — `is_platform_admin = t`, `ws = default`, `ws_role = maintainer`.

> Inspect `packages/identity/src/cli/bootstrap.ts` first for its actual flag names; adjust the invocation if they differ. Clean up afterwards: `dropdb jm_bootstrap_test`.

- [ ] **Step 4: Commit**

```bash
git add packages/identity/src/bootstrap.ts
git commit -m "feat(identity): bootstrap creates default workspace + maintainer membership"
```

---

## Task 8: Wire exports + test script, full check

**Files:**
- Modify: `packages/identity/src/index.ts`
- Modify: `packages/identity/package.json`

- [ ] **Step 1: Export the new identity modules**

Add to `packages/identity/src/index.ts`:

```typescript
export * from "./db-workspaces.ts";
export * from "./authz.ts";
```

- [ ] **Step 2: Add the test script + vitest devDependency**

In `packages/identity/package.json`, add `"test": "vitest run"` to `scripts` (beside `typecheck`), and add `"vitest": "^4.1.8"` to `devDependencies`. Then:

Run: `npm install`
Expected: completes; `vitest` linked into `@journeyman/identity`.

- [ ] **Step 3: Run the identity + core test suites**

Run: `npm test -w @journeyman/core && npm test -w @journeyman/identity`
Expected: PASS — `workspace-permissions`, `db-workspaces`, `authz` suites all green.

- [ ] **Step 4: Full repo check**

Run: `npm run check`
Expected: PASS — typecheck across all workspaces, import boundaries (`core` imports no `@journeyman/*`), theme colors.

- [ ] **Step 5: Commit**

```bash
git add packages/identity/src/index.ts packages/identity/package.json package-lock.json
git commit -m "feat(identity): export workspace store + authz; wire vitest"
```

---

## Self-Review (completed during planning)

**Spec coverage (§ → task):**
- §2 new tables `jm_workspaces`/`jm_workspace_members` (incl. `permissions JSONB`) → Task 4.
- §5 `WorkspacePermission` enum, `roleGrants`, `resolvePermissions` → Tasks 1–2; `can()` → Task 6; `requireWorkspacePermission`/`requireOrgRole` → Task 6.
- §5 extension guarantee (only `resolvePermissions` changes later) → Task 2 implementation + reserved `permissions` column (Task 4) + ignored-in-phase-1 test (Task 2).
- §6 `RunContext.workspace` field → Task 6 Step 1.
- §8 bootstrap default workspace + maintainer membership → Task 7.
- §12 testing: permission truth-table (Task 2), resolver/store tests (Task 5), `can()` + guard tests (Task 6), bootstrap verification (Task 7), `npm run check` green (Task 8).

**Out of Phase 1 scope (deferred to Phase 2/3, intentionally not here):** resource table changes, route migration to `/api/workspaces/:wsId/...`, resolver rewrites, removal of `*Scope` enums / flow grants / promote endpoints, workspace CRUD HTTP routes, UI. The guards and stores built here are consumed by those phases.

**Type consistency:** `Queryable` defined once in `db-workspaces.ts` and imported by `authz.ts` + tests. `WorkspaceRole`/`WorkspacePermission`/`WorkspaceMemberLike`/`WorkspaceContext` defined in core, imported everywhere. `evaluateCan` input shape `{ isPlatformAdmin, isOrgAdmin, member }` identical across `workspace-permissions.ts`, `can()`, and the guard. `loadWorkspaceAccess` return `{ orgId, isOrgAdmin, member }` matches its test expectations.

**Placeholder scan:** none — every code step contains full code; every run step has an exact command + expected result.

**Note on DB-backed verification (Tasks 4, 7):** the identity package has no Postgres test harness today, so schema/bootstrap correctness is verified by running migrations + psql/CLI against a real dev/throwaway DB rather than by a mocked unit test. Pure logic and query construction are unit-tested (vitest + fakeDb). Standing up a containerized integration harness is intentionally out of scope for Phase 1.
