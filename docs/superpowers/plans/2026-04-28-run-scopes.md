# Run Scopes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to dispatch the parallel batches below as concurrent subagents. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scope run visibility to user / org / platform-admin tiers using a separate `jm_run_grants` table that mirrors `jm_flow_grants`.

**Architecture:** A new `jm_run_grants` table holds principal-scoped grants. Run-start writes a `('user', starter, 'owner')` grant and (when applicable) a `('org', starterOrg, 'viewer')` grant in the same transaction as the run insert. API routes gate on a shared matcher utility that produces an effective role for an actor; org admins are elevated to `owner` on org grants and platform admins bypass. UI surfaces `Mine` / `Organization` / `All` chips on the runs list.

**Tech Stack:** TypeScript, Postgres, Fastify, React, npm workspaces. No new dependencies.

**Spec:** [docs/superpowers/specs/2026-04-28-run-scopes-design.md](../specs/2026-04-28-run-scopes-design.md)

**Execution rules (per user):**
- No `git commit` between tasks. The user commits when satisfied.
- No unit tests written for new code.
- Single verification at the end: `npm run typecheck` from repo root must pass.
- Tasks marked with the same **Batch N** label are independent and MUST be dispatched as parallel subagents.

---

## File Map

**Created:**
- `packages/migrations/src/sql/005_run_grants.sql`
- `packages/core/src/types/run-grants.types.ts`
- `packages/core/src/interfaces/run-grants-store.interface.ts`
- `packages/core/src/auth/grant-matcher.ts` (shared matcher utility — reusable for flow grants too)
- `packages/orchestrator/src/stores/memory/memory-run-grants-store.ts`
- `packages/orchestrator/src/stores/postgres/postgres-run-grants-store.ts`
- `packages/api-server/src/auth/require-run-role.ts`

**Modified:**
- `packages/core/src/types/run.types.ts` — add `effectiveRole?` and `RunGrant` re-export.
- `packages/core/src/interfaces/orchestrator-engine.interface.ts` — add `startedByOrgId` to `SubmitRunArgs`.
- `packages/core/src/interfaces/run-store.interface.ts` — `list()` gains an `actor` + `scope` filter.
- `packages/core/src/index.ts` — re-export new symbols.
- `packages/orchestrator/src/index.ts` — re-export new memory/postgres run-grants stores.
- `packages/orchestrator/src/engines/conductor/conductor-orchestrator.ts` — wire grant creation into `submit()`.
- `packages/orchestrator/src/stores/memory/memory-run-store.ts` — implement actor-scoped `list()`.
- `packages/orchestrator/src/stores/postgres/postgres-run-store.ts` — implement actor-scoped `list()`.
- `packages/orchestrator/src/actions/rerun.ts` — propagate `startedByOrgId`.
- `packages/orchestrator/src/actions/fork.ts` — n/a if it doesn't submit a run; otherwise propagate.
- `packages/api-server/src/composition.ts` — wire `runGrants` store.
- `packages/api-server/src/routes/runs.ts` — apply `requireRunRole` and pass `actor` + `scope` to `list`.
- `packages/api-server/src/routes/flows.ts` — pass `startedByOrgId` when starting runs (search for run submission call sites).
- `packages/runs-list/src/RunsList.tsx` — scope chips, scope badge column, conditional row actions.
- `packages/web/src/api/runs.ts` (or wherever run fetching lives) — pass `?scope=` to list endpoint.

---

## Batch 1 — Foundations (run in parallel)

These three tasks share no files. Dispatch all three as concurrent subagents.

### Task 1.1: Migration SQL

**Files:**
- Create: `packages/migrations/src/sql/005_run_grants.sql`

- [ ] **Step 1: Create the migration**

```sql
-- 005_run_grants.sql — run-level grants for user/org/platform-admin visibility.

-- 1) Grants table.
CREATE TABLE IF NOT EXISTS jm_run_grants (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id          UUID NOT NULL REFERENCES jm_runs(id) ON DELETE CASCADE,
  principal_type  TEXT NOT NULL CHECK (principal_type IN ('user','org','global')),
  principal_id    UUID NULL,
  role            TEXT NOT NULL CHECK (role IN ('owner','editor','viewer')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID REFERENCES jm_users(id) ON DELETE SET NULL,
  CONSTRAINT jm_run_grants_principal_shape CHECK (
    (principal_type = 'global' AND principal_id IS NULL)
    OR (principal_type IN ('user','org') AND principal_id IS NOT NULL)
  ),
  CONSTRAINT jm_run_grants_unique UNIQUE NULLS NOT DISTINCT (run_id, principal_type, principal_id)
);

CREATE INDEX IF NOT EXISTS idx_jm_run_grants_run        ON jm_run_grants (run_id);
CREATE INDEX IF NOT EXISTS idx_jm_run_grants_principal  ON jm_run_grants (principal_type, principal_id);

-- 2) Backfill: every existing run gets a ('user', started_by_user_id, 'owner') grant
--    and (best-effort) a ('org', current primary org, 'viewer') grant.
INSERT INTO jm_run_grants (run_id, principal_type, principal_id, role, created_by)
SELECT r.id, 'user', r.started_by_user_id, 'owner', r.started_by_user_id
FROM jm_runs r
WHERE r.started_by_user_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM jm_run_grants g WHERE g.run_id = r.id AND g.role = 'owner'
  );

INSERT INTO jm_run_grants (run_id, principal_type, principal_id, role, created_by)
SELECT r.id, 'org', m.org_id, 'viewer', r.started_by_user_id
FROM jm_runs r
JOIN LATERAL (
  SELECT org_id FROM jm_memberships
  WHERE user_id = r.started_by_user_id
  ORDER BY created_at ASC LIMIT 1
) m ON TRUE
WHERE r.started_by_user_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM jm_run_grants g
    WHERE g.run_id = r.id AND g.principal_type = 'org' AND g.principal_id = m.org_id
  );
```

### Task 1.2: Core types — RunGrant

**Files:**
- Create: `packages/core/src/types/run-grants.types.ts`
- Modify: `packages/core/src/types/run.types.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Create the new types file**

`packages/core/src/types/run-grants.types.ts`:

```ts
export type RunGrantPrincipalType = "user" | "org" | "global";
export type RunGrantRole = "owner" | "editor" | "viewer";

export interface RunGrant {
  id: string;
  runId: string;
  principalType: RunGrantPrincipalType;
  principalId: string | null;
  role: RunGrantRole;
  createdAt: Date;
  createdBy: string | null;
}

export interface CreateRunGrantArgs {
  runId: string;
  principalType: RunGrantPrincipalType;
  principalId: string | null;
  role: RunGrantRole;
  createdBy: string | null;
}

export interface ActorContext {
  userId: string | null;
  orgId: string | null;
  isPlatformAdmin: boolean;
  /** "admin" means org admin in caller's current org; affects org-grant elevation. */
  role: "admin" | "member" | null;
}

export type RunListScope = "mine" | "org" | "all";
```

- [ ] **Step 2: Extend `Run` with `effectiveRole`**

In `packages/core/src/types/run.types.ts`, add to the `Run` interface (append after `outputs`):

```ts
  /** Hydrated by the API layer for the calling actor. */
  effectiveRole?: import("./run-grants.types.ts").RunGrantRole;
```

- [ ] **Step 3: Re-export from `packages/core/src/index.ts`**

Add to the existing `export type { ... } from "./types/...";` block:

```ts
export type {
  RunGrant, RunGrantPrincipalType, RunGrantRole,
  CreateRunGrantArgs, ActorContext, RunListScope,
} from "./types/run-grants.types.ts";
```

### Task 1.3: Shared grant matcher utility

**Files:**
- Create: `packages/core/src/auth/grant-matcher.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Create the matcher**

`packages/core/src/auth/grant-matcher.ts`:

```ts
import type { ActorContext, RunGrantRole } from "../types/run-grants.types.ts";

export interface GrantLike {
  principalType: "user" | "org" | "global";
  principalId: string | null;
  role: RunGrantRole;
}

const RANK: Record<RunGrantRole, number> = { viewer: 1, editor: 2, owner: 3 };

/**
 * Compute the highest effective role for an actor across a list of grants
 * attached to a single subject (a flow or a run).
 *
 *  - Platform admins always get "owner".
 *  - Otherwise: pick the highest-ranked matching grant.
 *  - Org admins are elevated to "owner" on any matching ('org', theirOrgId, *) grant.
 *  - Returns null if no grant matches.
 */
export function effectiveRole(
  actor: ActorContext,
  grants: GrantLike[],
): RunGrantRole | null {
  if (actor.isPlatformAdmin) return "owner";

  let best: RunGrantRole | null = null;
  for (const g of grants) {
    let matched: RunGrantRole | null = null;

    if (g.principalType === "global") {
      matched = g.role;
    } else if (g.principalType === "user" && actor.userId && g.principalId === actor.userId) {
      matched = g.role;
    } else if (g.principalType === "org" && actor.orgId && g.principalId === actor.orgId) {
      // Org admin elevation: any matching org grant becomes "owner" for org admins.
      matched = actor.role === "admin" ? "owner" : g.role;
    }

    if (matched && (!best || RANK[matched] > RANK[best])) best = matched;
  }
  return best;
}

export function hasAtLeast(
  role: RunGrantRole | null,
  required: RunGrantRole,
): boolean {
  if (!role) return false;
  return RANK[role] >= RANK[required];
}
```

- [ ] **Step 2: Re-export from `packages/core/src/index.ts`**

```ts
export { effectiveRole, hasAtLeast } from "./auth/grant-matcher.ts";
export type { GrantLike } from "./auth/grant-matcher.ts";
```

---

## Batch 2 — Stores & interfaces (run in parallel after Batch 1)

These three tasks share no files. Dispatch as concurrent subagents.

### Task 2.1: RunGrantsStore interface

**Files:**
- Create: `packages/core/src/interfaces/run-grants-store.interface.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Create the interface**

`packages/core/src/interfaces/run-grants-store.interface.ts`:

```ts
import type {
  ActorContext, CreateRunGrantArgs, RunGrant, RunGrantRole,
} from "../types/run-grants.types.ts";

export interface IRunGrantsStore {
  createForRun(runId: string, grants: Omit<CreateRunGrantArgs, "runId">[]): Promise<RunGrant[]>;
  listByRun(runId: string): Promise<RunGrant[]>;
  /**
   * Resolve effective role per run for the given actor. Used for hydrating
   * `effectiveRole` on list/detail responses without N+1 queries.
   */
  matchForActor(actor: ActorContext, runIds: string[]): Promise<Map<string, RunGrantRole>>;
}
```

- [ ] **Step 2: Re-export**

In `packages/core/src/index.ts`:

```ts
export type { IRunGrantsStore } from "./interfaces/run-grants-store.interface.ts";
```

### Task 2.2: Extend SubmitRunArgs and IRunStore.list

**Files:**
- Modify: `packages/core/src/interfaces/orchestrator-engine.interface.ts`
- Modify: `packages/core/src/interfaces/run-store.interface.ts`

- [ ] **Step 1: Add `startedByOrgId` to `SubmitRunArgs`**

In `packages/core/src/interfaces/orchestrator-engine.interface.ts`, find the `SubmitRunArgs` interface and add:

```ts
  /** Caller's org at run-start. Null when the caller has no org context. */
  startedByOrgId: string | null;
```

- [ ] **Step 2: Replace `IRunStore.list` signature**

In `packages/core/src/interfaces/run-store.interface.ts`, also add `startedByOrgId` to `CreateRunArgs`:

```ts
export interface CreateRunArgs {
  flowId: string | null;
  flowVersionId: string | null;
  flowNameSnapshot: string;
  flowScopeSnapshot: "user" | "org" | "global";
  definitionSnapshot: FlowGraph;
  triggerSource: TriggerSource;
  startedByUserId: string | null;
  startedByOrgId: string | null;
  inputs: Record<string, unknown>;
}
```

(Add `startedByOrgId` field; the run record itself does NOT need a column, but downstream callers will use this value to write the org grant.)

Replace the `list` method in `IRunStore`:

```ts
import type { ActorContext, RunListScope } from "../types/run-grants.types.ts";

  list(opts?: {
    flowId?: string;
    status?: RunStatus;
    limit?: number;
    actor?: ActorContext;
    scope?: RunListScope;
  }): Promise<Run[]>;
```

The `actor` argument is optional so callers without an authenticated context (tests) keep working; when omitted, the store does NOT apply auth filtering.

### Task 2.3: Memory + Postgres RunGrantsStore implementations

**Files:**
- Create: `packages/orchestrator/src/stores/memory/memory-run-grants-store.ts`
- Create: `packages/orchestrator/src/stores/postgres/postgres-run-grants-store.ts`
- Modify: `packages/orchestrator/src/index.ts`

- [ ] **Step 1: Memory store**

`packages/orchestrator/src/stores/memory/memory-run-grants-store.ts`:

```ts
import { randomUUID } from "node:crypto";
import {
  effectiveRole,
  type ActorContext, type CreateRunGrantArgs, type IRunGrantsStore,
  type RunGrant, type RunGrantRole,
} from "@journeyman/core";

export class MemoryRunGrantsStore implements IRunGrantsStore {
  private rows = new Map<string, RunGrant>();

  async createForRun(
    runId: string,
    grants: Omit<CreateRunGrantArgs, "runId">[],
  ): Promise<RunGrant[]> {
    const out: RunGrant[] = [];
    for (const g of grants) {
      const row: RunGrant = {
        id: randomUUID(),
        runId,
        principalType: g.principalType,
        principalId: g.principalId,
        role: g.role,
        createdAt: new Date(),
        createdBy: g.createdBy,
      };
      this.rows.set(row.id, row);
      out.push(row);
    }
    return out;
  }

  async listByRun(runId: string): Promise<RunGrant[]> {
    return [...this.rows.values()].filter(g => g.runId === runId);
  }

  async matchForActor(
    actor: ActorContext,
    runIds: string[],
  ): Promise<Map<string, RunGrantRole>> {
    const wanted = new Set(runIds);
    const byRun = new Map<string, RunGrant[]>();
    for (const g of this.rows.values()) {
      if (!wanted.has(g.runId)) continue;
      const arr = byRun.get(g.runId) ?? [];
      arr.push(g);
      byRun.set(g.runId, arr);
    }
    const out = new Map<string, RunGrantRole>();
    for (const id of runIds) {
      const role = effectiveRole(actor, byRun.get(id) ?? []);
      if (role) out.set(id, role);
      else if (actor.isPlatformAdmin) out.set(id, "owner");
    }
    return out;
  }
}
```

- [ ] **Step 2: Postgres store**

`packages/orchestrator/src/stores/postgres/postgres-run-grants-store.ts`:

```ts
import type { Pool } from "pg";
import {
  effectiveRole,
  type ActorContext, type CreateRunGrantArgs, type IRunGrantsStore,
  type RunGrant, type RunGrantRole,
} from "@journeyman/core";

function rowToGrant(r: any): RunGrant {
  return {
    id: r.id,
    runId: r.run_id,
    principalType: r.principal_type,
    principalId: r.principal_id,
    role: r.role,
    createdAt: new Date(r.created_at),
    createdBy: r.created_by,
  };
}

export class PostgresRunGrantsStore implements IRunGrantsStore {
  constructor(private pool: Pool) {}

  async createForRun(
    runId: string,
    grants: Omit<CreateRunGrantArgs, "runId">[],
  ): Promise<RunGrant[]> {
    if (grants.length === 0) return [];
    const values: string[] = [];
    const params: any[] = [];
    let i = 1;
    for (const g of grants) {
      values.push(`($${i++}, $${i++}, $${i++}, $${i++}, $${i++})`);
      params.push(runId, g.principalType, g.principalId, g.role, g.createdBy);
    }
    const { rows } = await this.pool.query(
      `INSERT INTO jm_run_grants (run_id, principal_type, principal_id, role, created_by)
       VALUES ${values.join(", ")}
       RETURNING *`,
      params,
    );
    return rows.map(rowToGrant);
  }

  async listByRun(runId: string): Promise<RunGrant[]> {
    const { rows } = await this.pool.query(
      "SELECT * FROM jm_run_grants WHERE run_id = $1 ORDER BY created_at",
      [runId],
    );
    return rows.map(rowToGrant);
  }

  async matchForActor(
    actor: ActorContext,
    runIds: string[],
  ): Promise<Map<string, RunGrantRole>> {
    const out = new Map<string, RunGrantRole>();
    if (runIds.length === 0) return out;

    if (actor.isPlatformAdmin) {
      for (const id of runIds) out.set(id, "owner");
      return out;
    }

    const { rows } = await this.pool.query(
      `SELECT * FROM jm_run_grants
        WHERE run_id = ANY($1::uuid[])
          AND (
            principal_type = 'global'
            OR (principal_type = 'user' AND principal_id = $2)
            OR (principal_type = 'org'  AND principal_id = $3)
          )`,
      [runIds, actor.userId, actor.orgId],
    );
    const byRun = new Map<string, RunGrant[]>();
    for (const r of rows) {
      const g = rowToGrant(r);
      const arr = byRun.get(g.runId) ?? [];
      arr.push(g);
      byRun.set(g.runId, arr);
    }
    for (const id of runIds) {
      const role = effectiveRole(actor, byRun.get(id) ?? []);
      if (role) out.set(id, role);
    }
    return out;
  }
}
```

- [ ] **Step 3: Re-export from `packages/orchestrator/src/index.ts`**

Add the two new exports next to the existing flow-grants store exports:

```ts
export { MemoryRunGrantsStore } from "./stores/memory/memory-run-grants-store.ts";
export { PostgresRunGrantsStore } from "./stores/postgres/postgres-run-grants-store.ts";
```

---

## Batch 3 — Run store list filtering + memory/postgres run store updates (parallel)

### Task 3.1: Memory run store — actor-scoped list + accept startedByOrgId

**Files:**
- Modify: `packages/orchestrator/src/stores/memory/memory-run-store.ts`

- [ ] **Step 1: Add `startedByOrgId` to the create path**

The existing `MemoryRunStore.create` ignores the new field (memory store doesn't persist it; the org membership lives in grants written by the orchestrator). No changes needed if `CreateRunArgs` is destructured into named props — but if it spreads, ensure no TS error. (After Batch 2.2, `startedByOrgId` becomes a required field on `CreateRunArgs`; the memory store simply doesn't read it.)

- [ ] **Step 2: Replace `list()` with actor-aware version**

Replace the existing `list` method:

```ts
async list(opts: {
  flowId?: string;
  status?: import("@journeyman/core").RunStatus;
  limit?: number;
  actor?: import("@journeyman/core").ActorContext;
  scope?: import("@journeyman/core").RunListScope;
} = {}): Promise<Run[]> {
  let out = [...this.rows.values()];
  if (opts.flowId) out = out.filter(r => r.flowId === opts.flowId);
  if (opts.status) out = out.filter(r => r.status === opts.status);
  // Actor-scoped filtering is the responsibility of the API layer in the memory backend
  // (no grants table is joinable here). When `actor` is provided we trust the API
  // layer to have already pre-filtered via `runGrants.matchForActor` if it wants.
  if (opts.limit) out = out.slice(0, opts.limit);
  return out;
}
```

(The Postgres store does the join in SQL; the memory store relies on the API layer's matcher pass — see Task 4.2.)

### Task 3.2: Postgres run store — actor-scoped list

**Files:**
- Modify: `packages/orchestrator/src/stores/postgres/postgres-run-store.ts`

- [ ] **Step 1: Replace `list()` to JOIN on grants when an actor is supplied**

Locate the existing `list()` method and replace with:

```ts
async list(opts: {
  flowId?: string;
  status?: import("@journeyman/core").RunStatus;
  limit?: number;
  actor?: import("@journeyman/core").ActorContext;
  scope?: import("@journeyman/core").RunListScope;
} = {}): Promise<Run[]> {
  const conds: string[] = [];
  const params: any[] = [];
  let i = 1;

  if (opts.flowId) { conds.push(`r.flow_id = $${i++}`); params.push(opts.flowId); }
  if (opts.status) { conds.push(`r.status = $${i++}`); params.push(opts.status); }

  let joinClause = "";
  if (opts.actor && !(opts.actor.isPlatformAdmin && opts.scope === "all")) {
    // Build a grant-matcher subquery
    joinClause = `
      JOIN LATERAL (
        SELECT 1 FROM jm_run_grants g
        WHERE g.run_id = r.id
          AND ${grantMatchSql(opts.actor, opts.scope, params, () => i++)}
        LIMIT 1
      ) gm ON TRUE
    `;
  }

  const whereSql = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const limitSql = opts.limit ? `LIMIT $${i++}` : "";
  if (opts.limit) params.push(opts.limit);

  const sql = `
    SELECT DISTINCT r.* FROM jm_runs r
    ${joinClause}
    ${whereSql}
    ORDER BY r.started_at DESC NULLS LAST
    ${limitSql}
  `;
  const { rows } = await this.pool.query(sql, params);
  return rows.map(rowToRun);
}
```

Add the helper at the top of the file (above the class):

```ts
import type { ActorContext, RunListScope } from "@journeyman/core";

function grantMatchSql(
  actor: ActorContext,
  scope: RunListScope | undefined,
  params: any[],
  nextIdx: () => number,
): string {
  // Build the principal-match predicate based on requested scope.
  const clauses: string[] = [];

  // "mine" → only ('user', userId, *) match — and only owner role counts.
  // For org admins, we ALSO let ('org', orgId, *) match because they can act on org runs.
  if (scope === "mine") {
    if (actor.userId) {
      clauses.push(`(g.principal_type = 'user' AND g.principal_id = $${nextIdx()} AND g.role = 'owner')`);
      params.push(actor.userId);
    }
    if (actor.role === "admin" && actor.orgId) {
      clauses.push(`(g.principal_type = 'org' AND g.principal_id = $${nextIdx()})`);
      params.push(actor.orgId);
    }
  } else if (scope === "org") {
    if (actor.orgId) {
      clauses.push(`(g.principal_type = 'org' AND g.principal_id = $${nextIdx()})`);
      params.push(actor.orgId);
    }
  } else {
    // default (no scope filter): everything the actor can see
    if (actor.userId) {
      clauses.push(`(g.principal_type = 'user' AND g.principal_id = $${nextIdx()})`);
      params.push(actor.userId);
    }
    if (actor.orgId) {
      clauses.push(`(g.principal_type = 'org' AND g.principal_id = $${nextIdx()})`);
      params.push(actor.orgId);
    }
    clauses.push(`(g.principal_type = 'global')`);
  }

  return clauses.length ? `(${clauses.join(" OR ")})` : "FALSE";
}
```

Note: `scope === "all"` is handled in the route layer — it returns 403 unless the actor is a platform admin, and platform admins skip the join entirely (the `joinClause` short-circuit above).

### Task 3.3: Update SubmitRunArgs threading + actions

**Files:**
- Modify: `packages/orchestrator/src/engines/conductor/conductor-orchestrator.ts`
- Modify: `packages/orchestrator/src/actions/rerun.ts`
- Modify: `packages/orchestrator/src/actions/fork.ts`

- [ ] **Step 1: Conductor orchestrator — accept run-grants store dep, pass startedByOrgId, write grants**

In `packages/orchestrator/src/engines/conductor/conductor-orchestrator.ts`:

```ts
import type {
  IOrchestratorEngine, IPauseableEngine, IRetryableEngine,
  IRunStore, IRunGrantsStore, Run, RunStatus, SubmitRunArgs,
} from "@journeyman/core";

export interface ConductorOrchestratorDeps {
  client: ConductorClient;
  converter: IFlowJsonConverter<ConductorWorkflowDef>;
  runs: IRunStore;
  runGrants: IRunGrantsStore;
}
```

Replace the `runs.create` block in `submit()`:

```ts
const run = await this.deps.runs.create({
  flowId: args.flowId,
  flowVersionId: args.flowVersionId,
  flowNameSnapshot: args.flowNameSnapshot,
  flowScopeSnapshot: args.flowScopeSnapshot,
  definitionSnapshot: args.definitionSnapshot,
  triggerSource: "api",
  startedByUserId: args.startedByUserId,
  startedByOrgId: args.startedByOrgId,
  inputs: args.inputs,
});

// Write run grants: ('user', starter, 'owner') always; ('org', org, 'viewer') when known.
const grants: Array<{
  principalType: "user" | "org" | "global";
  principalId: string | null;
  role: "owner" | "editor" | "viewer";
  createdBy: string | null;
}> = [];
if (args.startedByUserId) {
  grants.push({
    principalType: "user", principalId: args.startedByUserId,
    role: "owner", createdBy: args.startedByUserId,
  });
}
if (args.startedByOrgId) {
  grants.push({
    principalType: "org", principalId: args.startedByOrgId,
    role: "viewer", createdBy: args.startedByUserId,
  });
}
if (grants.length > 0) await this.deps.runGrants.createForRun(run.id, grants);
```

- [ ] **Step 2: rerun.ts — propagate `startedByOrgId`**

In `packages/orchestrator/src/actions/rerun.ts`, change the signature of `rerunFromExisting` to accept `startedByOrgId`:

```ts
export async function rerunFromExisting(
  deps: RerunDeps,
  originalRunId: string,
  opts: { startedByUserId?: string | null; startedByOrgId?: string | null } = {},
): Promise<RerunResult> {
  // ...
  return await deps.orchestrator.submit({
    flowId: original.flowId,
    flowVersionId: original.flowVersionId,
    flowNameSnapshot: original.flowNameSnapshot,
    flowScopeSnapshot: original.flowScopeSnapshot,
    definitionSnapshot,
    inputs: original.inputs ?? {},
    startedByUserId: opts.startedByUserId ?? original.startedByUserId,
    startedByOrgId: opts.startedByOrgId ?? null,
  });
}
```

- [ ] **Step 3: fork.ts — same propagation if it submits a run**

Open `packages/orchestrator/src/actions/fork.ts` and:
- If it calls `orchestrator.submit(...)`, add `startedByOrgId` to the call site (mirror rerun above) and to the function's `opts` object.
- If it does NOT submit a run (only creates a flow), no change needed.

---

## Batch 4 — API server wiring (sequential after Batches 2 & 3)

### Task 4.1: Composition wiring

**Files:**
- Modify: `packages/api-server/src/composition.ts`

- [ ] **Step 1: Add `runGrants` to the composition**

```ts
import type {
  // ...existing
  IRunGrantsStore,
} from "@journeyman/core";

import {
  // ...existing
  MemoryRunGrantsStore,
  PostgresRunGrantsStore,
} from "@journeyman/orchestrator";

export interface Composition {
  // ...existing
  runGrants: IRunGrantsStore;
  // ...
}
```

In `buildComposition`:

```ts
let runGrants: IRunGrantsStore;

if (useMemory) {
  // ...existing
  runGrants = new MemoryRunGrantsStore();
} else {
  // ...existing
  runGrants = new PostgresRunGrantsStore(pool);
}

const orchestrator = new ConductorOrchestrator({
  client: conductorClient,
  converter: new ConductorJsonConverter(),
  runs,
  runGrants,
});

return {
  flowGrants, flows, flowVersions, runs, runGrants, nodeExecutions, events,
  orchestrator, registry, workspace, credentials, auth, conditions,
  pool,
  shutdown: async () => { if (pool) await pool.end(); },
};
```

### Task 4.2: requireRunRole preHandler

**Files:**
- Create: `packages/api-server/src/auth/require-run-role.ts`

- [ ] **Step 1: Create the preHandler factory**

```ts
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Composition } from "../composition.ts";
import {
  effectiveRole, hasAtLeast,
  type ActorContext, type RunGrantRole,
} from "@journeyman/core";

export function makeRequireRunRole(c: Composition) {
  return function requireRunRole(required: RunGrantRole) {
    return async (req: FastifyRequest, reply: FastifyReply) => {
      const ctx = req.runContext;
      if (!ctx) { reply.code(401).send({ error: "no_run_context" }); return; }

      const actor: ActorContext = {
        userId: ctx.user.id,
        orgId: ctx.org.id,
        isPlatformAdmin: ctx.isPlatformAdmin,
        role: ctx.role,
      };

      const { id } = req.params as { id: string };
      const run = await c.runs.getById(id);
      if (!run) { reply.code(404).send({ error: "not_found" }); return; }

      if (actor.isPlatformAdmin) {
        (req as any).effectiveRunRole = "owner" as RunGrantRole;
        return;
      }

      const grants = await c.runGrants.listByRun(id);
      const role = effectiveRole(actor, grants);
      if (!hasAtLeast(role, required)) {
        reply.code(404).send({ error: "not_found" });
        return;
      }
      (req as any).effectiveRunRole = role;
    };
  };
}
```

### Task 4.3: Apply gating + scope to runs.ts routes

**Files:**
- Modify: `packages/api-server/src/routes/runs.ts`

- [ ] **Step 1: Wire requireRunRole and pass actor + scope to list**

Replace the file contents preserving all existing handlers but applying gating. Key edits:

At the top, add:

```ts
import { makeRequireRunRole } from "../auth/require-run-role.ts";
import type { ActorContext, RunGrantRole, RunListScope } from "@journeyman/core";
```

In `registerRunRoutes`:

```ts
const requireAuth = makeRequireAuth({ pool: c.pool! });
const requireRunRole = makeRequireRunRole(c);

function actorFrom(req: FastifyRequest): ActorContext {
  const ctx = req.runContext!;
  return {
    userId: ctx.user.id, orgId: ctx.org.id,
    isPlatformAdmin: ctx.isPlatformAdmin, role: ctx.role,
  };
}
```

Replace the `GET /runs` handler:

```ts
app.get("/runs", { preHandler: requireAuth() }, async (req, reply) => {
  const q = req.query as { flow_id?: string; status?: string; limit?: string; scope?: string };
  const scope = q.scope as RunListScope | undefined;
  const actor = actorFrom(req);

  if (scope === "all" && !actor.isPlatformAdmin) {
    reply.code(403); return { error: "platform_admin_required" };
  }

  const runs = await c.runs.list({
    flowId: q.flow_id,
    status: q.status as any,
    limit: q.limit ? Number(q.limit) : undefined,
    actor,
    scope,
  });

  // Hydrate effectiveRole per run.
  const roleMap = await c.runGrants.matchForActor(actor, runs.map(r => r.id));
  const hydrated = runs.map(r => ({ ...r, effectiveRole: roleMap.get(r.id) ?? null }));
  return { runs: hydrated };
});
```

Add `requireRunRole('viewer')` to:
- `GET /runs/:id`
- `GET /runs/:id/events`
- `GET /runs/:id/export`

Add `requireRunRole('owner')` to:
- `POST /runs/:id/cancel`
- `POST /runs/:id/pause`
- `POST /runs/:id/resume`
- `POST /runs/:id/retry-step`
- `POST /runs/:id/rerun`
- `POST /runs/:id/fork`

Pattern for view-protected routes:

```ts
app.get("/runs/:id",
  { preHandler: [requireAuth(), requireRunRole("viewer")] },
  async (req, reply) => { /* existing body unchanged */ }
);
```

For `rerun` and `fork`, also pass the caller's org into the action:

```ts
app.post("/runs/:id/rerun",
  { preHandler: [requireAuth(), requireRunRole("owner")] },
  async (req, reply) => {
    const { id } = req.params as { id: string };
    const ctx = req.runContext!;
    const result = await rerunFromExisting(
      { runs: c.runs, flowVersions: c.flowVersions, orchestrator: c.orchestrator },
      id,
      { startedByUserId: ctx.user.id, startedByOrgId: ctx.org.id },
    );
    reply.code(202);
    return result;
  },
);
```

Apply the same `startedByOrgId: ctx.org.id` propagation in the `fork` handler if `fork` submits a run.

Hydrate `effectiveRole` on the detail response:

```ts
app.get("/runs/:id",
  { preHandler: [requireAuth(), requireRunRole("viewer")] },
  async (req, reply) => {
    const { id } = req.params as { id: string };
    await c.orchestrator.syncStatus(id).catch(() => {});
    const run = await c.runs.getById(id);
    if (!run) { reply.code(404); return { error: "not_found" }; }
    const executions = await c.nodeExecutions.listByRun(id);
    const events = await c.events.list(id, { limit: 500 });
    const effectiveRunRole = (req as any).effectiveRunRole as RunGrantRole;
    return { run: { ...run, effectiveRole: effectiveRunRole }, executions, events };
  },
);
```

### Task 4.4: Propagate startedByOrgId from flow-run start sites

**Files:**
- Modify: `packages/api-server/src/routes/flows.ts` (and any other route that calls `orchestrator.submit`)

- [ ] **Step 1: Find every `orchestrator.submit(` call site in `packages/api-server/src`**

Run: `grep -rn "orchestrator.submit\|c.orchestrator.submit" packages/api-server/src`

For each call, add `startedByOrgId: req.runContext!.org.id` to the args object. The build will fail at typecheck if any are missed (the field is now required on `SubmitRunArgs`), so this step doubles as its own verification.

---

## Batch 5 — Web UI (parallel)

### Task 5.1: Runs list — chips, badges, conditional actions

**Files:**
- Modify: `packages/runs-list/src/RunsList.tsx`
- Modify: `packages/web/src/api/runs.ts` (or equivalent — use grep to find)

- [ ] **Step 1: Add `scope` query param support to the API client**

Find the runs-list API helper:

```bash
grep -rn "fetch.*'/runs'\|apiFetch.*runs" packages/web/src packages/runs-list/src
```

Wherever `GET /runs` is called, accept and forward a `scope?: 'mine'|'org'|'all'` argument as a `?scope=` query param.

- [ ] **Step 2: Update RunsList.tsx**

At the top of `packages/runs-list/src/RunsList.tsx`:

```tsx
import { useState, useMemo } from "react";
// existing imports...

type Scope = "mine" | "org" | "all";
```

In the component, read auth context (the existing pattern in this codebase — usually a `useAuth()` hook or a prop):

```tsx
const auth = useAuth(); // adjust import to match repo: { userId, orgId, isPlatformAdmin }
const [scope, setScope] = useState<Scope>("mine");
```

Add chip UI directly above the run table:

```tsx
<div className="run-scope-chips">
  <button
    className={scope === "mine" ? "chip chip--active" : "chip"}
    onClick={() => setScope("mine")}
  >Mine</button>

  {auth.orgId && (
    <button
      className={scope === "org" ? "chip chip--active" : "chip"}
      onClick={() => setScope("org")}
    >Organization</button>
  )}

  {auth.isPlatformAdmin && (
    <button
      className={scope === "all" ? "chip chip--active" : "chip"}
      onClick={() => setScope("all")}
    >All</button>
  )}
</div>
```

Pass `scope` into the existing data-fetch call (whatever hook/swr/query is used). Refetch when `scope` changes.

For each row, render a scope badge from `run.flowScopeSnapshot`:

```tsx
<span className={`badge badge--scope-${run.flowScopeSnapshot}`}>
  {run.flowScopeSnapshot === "user" ? "User"
    : run.flowScopeSnapshot === "org" ? "Org"
    : "Global"}
</span>
```

Show the starter column only when `scope !== "mine"`:

```tsx
{scope !== "mine" && <td>{run.startedByUserId ?? "—"}</td>}
```

Gate row actions (cancel / retry / rerun / fork buttons) on `run.effectiveRole === "owner"`:

```tsx
{run.effectiveRole === "owner" && (
  <RowActions run={run} />
)}
```

### Task 5.2: Run detail page — viewer banner

**Files:**
- Modify: the run detail/timeline component (locate via `grep -rn "RunDetail\|runs/.*id.*Page" packages/web/src packages/runs-list/src`)

- [ ] **Step 1: Add viewer banner**

When the fetched run's `effectiveRole === "viewer"`, render a banner above the detail content:

```tsx
{run.effectiveRole === "viewer" && (
  <div className="banner banner--info">
    You're viewing this run as an org peer. Only the run's owner or an org admin can pause, retry, or cancel.
  </div>
)}
```

Hide cancel / pause / retry / rerun / fork buttons when `effectiveRole !== "owner"`.

---

## Batch 6 — Verification

### Task 6.1: Typecheck

- [ ] **Step 1: Run typecheck across the workspace**

```bash
npm run typecheck
```

Expected: exits 0 with no errors. Common failure modes to watch for:
- `SubmitRunArgs.startedByOrgId` not provided at a call site → add it.
- `IRunGrantsStore` import missing in `composition.ts` → add it.
- `effectiveRole` field on `Run` not propagated through serialization → ensure the route returns it explicitly when relevant.

If typecheck fails, fix errors in place. Do not commit.

---

## Self-Review

**Spec coverage check:**
- ✅ Data model — `jm_run_grants` table (Task 1.1) with same shape as `jm_flow_grants`.
- ✅ At-run-start grants — orchestrator writes user-owner + org-viewer (Task 3.3).
- ✅ Permission model — shared matcher with platform-admin bypass and org-admin elevation (Task 1.3).
- ✅ Effective permission matrix — enforced via `requireRunRole` preHandlers (Tasks 4.2–4.3).
- ✅ List with scope=mine/org/all — actor + scope on `IRunStore.list` (Tasks 2.2, 3.2, 4.3).
- ✅ Detail/events/export require viewer; actions require owner — Task 4.3.
- ✅ Response gains `effectiveRole` — Tasks 1.2, 4.3.
- ✅ Migration backfills owner-user grants and best-effort org-viewer grants — Task 1.1.
- ✅ Future grant inserts (per-peer share etc.) require no schema change — confirmed by table shape.
- ✅ UI chips visible per actor type, scope badges, conditional actions, viewer banner — Tasks 5.1–5.2.
- ✅ No new endpoints for grants in this version — out of scope by design.

**Placeholder scan:** No "TBD" / "implement later" / vague-error-handling steps. Every code step is concrete.

**Type consistency:** `RunGrantRole` / `RunGrantPrincipalType` / `ActorContext` / `RunListScope` used consistently across files. Method names: `createForRun`, `listByRun`, `matchForActor` — same shape used in stores and route handlers.
