# Workers Management Backend Implementation Plan (Plan 3 of 7)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist and manage **Workers** — a DB-backed, user/org/system-scoped catalog with CRUD + visible-list REST API and a `resolveWorker()` resolver (workerId → `ResolvedWorker`), mirroring `@journeyman/mcp`. Also add the `workerId` association fields to the flow definition.

**Architecture:** A `jm_workers` table (seeded with a built-in `local` "Local Workspace" default) backed by store functions in `@journeyman/workers/db`, a `resolveWorker()` that turns a `workerId` (or the default) into the `ResolvedWorker` shape Plan 1's backends consume, and Fastify routes mirroring the mcp org/user/visible pattern. Store + resolver take a structural `Queryable` seam so they are unit-tested with a fake `query` (the repo has no live-DB test harness). The flow definition gains `defaults.workerId` (workflow-level) and `WorkflowNode.workerId` (per-step override).

**Tech Stack:** TypeScript (Bundler resolution, `.ts` imports), `pg`, Fastify, vitest 2.1.9. Mirrors `@journeyman/mcp`.

**Depends on:** Plan 1 (`WorkerType`, `ExecutionMode`, `Connectivity`, `ResolvedWorker` in `@journeyman/core`).

**Out of scope (separate plans):** Workers **management UI** + flow-editor worker picker → **Plan 3-UI**. **Run-start provisioning/use** of the resolved worker (calling `provision`/`exec`) and a "test connection/build" endpoint → **Plan 4** (needs the Docker backend). Promote-to-org → later.

---

## File Structure (Plan 3)

- `packages/core/src/types/worker.types.ts` — **Create.** `WorkerScope`, `WorkerRecord`, `CreateWorkerArgs`, `UpdateWorkerArgs`.
- `packages/core/src/index.ts` — **Modify.** Re-export the worker record types; add `workerId?` to `WorkflowDefaults` and `WorkflowNode` (in `flow.types.ts`).
- `packages/core/src/types/flow.types.ts` — **Modify.** Add `workerId?: string` to `WorkflowDefaults` and `WorkflowNode`.
- `packages/migrations/src/sql/033_workers.sql` — **Create.** `jm_workers` table + seed default local worker.
- `packages/workers/src/worker-record.ts` — **Create.** `validateWorkerInput()` + `rowToWorker()`.
- `packages/workers/src/worker-record.test.ts` — **Create.**
- `packages/workers/src/db.ts` — **Create.** `Queryable` seam + CRUD + visible/fetch-by-id.
- `packages/workers/src/db.test.ts` — **Create.**
- `packages/workers/src/resolver.ts` — **Create.** `resolveWorker()`.
- `packages/workers/src/resolver.test.ts` — **Create.**
- `packages/workers/src/routes/index.ts` — **Create.** `registerWorkerRoutes(app, pool)` (org + user + visible CRUD).
- `packages/workers/src/index.ts` — **Modify.** Export db/resolver/routes surface.
- `packages/workers/package.json` — **Modify.** Add `pg` + `@journeyman/identity` deps, `@types/pg` dev.
- `packages/api-server/src/server.ts` — **Modify.** Register worker routes.

---

## Task 1: Core worker record types + flow association fields

**Files:**
- Create: `packages/core/src/types/worker.types.ts`
- Modify: `packages/core/src/types/flow.types.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Create the worker record types**

Create `packages/core/src/types/worker.types.ts`:

```typescript
import type { WorkerType, ExecutionMode, Connectivity } from "./execution-environment.types.ts";

export type WorkerScope = "user" | "org" | "system";

/** A Worker row as stored in jm_workers. */
export interface WorkerRecord {
  id: string;
  scope: WorkerScope;
  /** Set for org/user scope; null for system. */
  orgId: string | null;
  /** Set for user scope; null for org/system. */
  userId: string | null;
  name: string;
  type: WorkerType;
  executionMode: ExecutionMode;
  connectivity: Connectivity | null;
  config: Record<string, unknown>;
  isDefault: boolean;
  tags: string[];
  enabled: boolean;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateWorkerArgs {
  scope: WorkerScope;
  orgId: string | null;
  userId: string | null;
  name: string;
  type: WorkerType;
  executionMode: ExecutionMode;
  connectivity?: Connectivity | null;
  config?: Record<string, unknown>;
  isDefault?: boolean;
  tags?: string[];
  enabled?: boolean;
  createdBy: string | null;
}

export interface UpdateWorkerArgs {
  id: string;
  orgId: string | null;
  userId: string | null;
  name?: string;
  executionMode?: ExecutionMode;
  connectivity?: Connectivity | null;
  config?: Record<string, unknown>;
  isDefault?: boolean;
  tags?: string[];
  enabled?: boolean;
}
```

- [ ] **Step 2: Add `workerId` to flow defaults and nodes**

In `packages/core/src/types/flow.types.ts`, find the `WorkflowDefaults` interface and add a `workerId` field so it reads:

```typescript
export interface WorkflowDefaults {
  /** Default retry policy. Merged field-by-field into each node's `retry`. */
  retry?: RetryPolicy;
  executorConfig?: Partial<Record<ExecutorKind, { provider?: string }>>;
  defaultModel?: string;
  /** Worker (compute target) this workflow runs on. Unset → system default worker. */
  workerId?: string;
}
```

Then find the `WorkflowNode` interface in the same file and add (next to its other optional fields like `model`/`retry`):

```typescript
  /** Per-step worker override (workspace-independent steps only). Falls back to defaults.workerId. */
  workerId?: string;
```

- [ ] **Step 3: Re-export the worker record types from core**

In `packages/core/src/index.ts`, add below the execution-environment export block from Plan 1:

```typescript
export type {
  WorkerScope,
  WorkerRecord,
  CreateWorkerArgs,
  UpdateWorkerArgs,
} from "./types/worker.types.ts";
```

- [ ] **Step 4: Typecheck core**

Run: `npm run typecheck -w @journeyman/core`
Expected: PASS.

---

## Task 2: Migration — `jm_workers` table + seed default local worker

**Files:**
- Create: `packages/migrations/src/sql/033_workers.sql`

Read `docs/constitution/DATABASE_ARCHITECTURE.md` first if present; the schema below follows the `jm_` prefix + scope conventions used by `009_mcp_instances.sql`.

- [ ] **Step 1: Create the migration**

Create `packages/migrations/src/sql/033_workers.sql`:

```sql
CREATE TABLE IF NOT EXISTS jm_workers (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope          TEXT NOT NULL CHECK (scope IN ('user','org','system')),
  org_id         UUID REFERENCES jm_orgs(id)  ON DELETE CASCADE,
  user_id        UUID REFERENCES jm_users(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  type           TEXT NOT NULL,
  execution_mode TEXT NOT NULL CHECK (execution_mode IN ('per-instance','shared')),
  connectivity   TEXT CHECK (connectivity IN ('push','agent')),
  config         JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_default     BOOLEAN NOT NULL DEFAULT false,
  tags           JSONB NOT NULL DEFAULT '[]'::jsonb,
  enabled        BOOLEAN NOT NULL DEFAULT true,
  created_by     UUID REFERENCES jm_users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT jm_workers_scope_shape CHECK (
       (scope = 'system' AND org_id IS NULL     AND user_id IS NULL)
    OR (scope = 'org'    AND org_id IS NOT NULL AND user_id IS NULL)
    OR (scope = 'user'   AND org_id IS NOT NULL AND user_id IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_jm_workers_org_user ON jm_workers (org_id, user_id);

-- Built-in default: the Local Workspace worker (in-process, no isolation).
INSERT INTO jm_workers (scope, name, type, execution_mode, connectivity, config, is_default, enabled)
SELECT 'system', 'Local Workspace', 'local', 'shared', NULL, '{}'::jsonb, true, true
WHERE NOT EXISTS (
  SELECT 1 FROM jm_workers WHERE scope = 'system' AND type = 'local'
);
```

- [ ] **Step 2: Apply the migration (GATED — Postgres required)**

If a dev Postgres is up (`npm run infra:up`): Run `npm run migrate`
Expected: `033_workers` applied; `psql ... -c "\d jm_workers"` shows the table and one seeded `system`/`local` row.

If no DB is available: skip; note the migration is unapplied in this environment (it runs on next `npm run migrate`). Do **not** fake this.

---

## Task 3: Worker input validation + row mapping (pure, TDD)

**Files:**
- Create: `packages/workers/src/worker-record.ts`
- Test: `packages/workers/src/worker-record.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/workers/src/worker-record.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { validateWorkerInput, rowToWorker, InvalidWorkerInputError } from "./worker-record.ts";

describe("validateWorkerInput", () => {
  const ok = { name: "Java builder", type: "docker", executionMode: "per-instance" };

  it("accepts a valid worker", () => {
    expect(() => validateWorkerInput(ok)).not.toThrow();
  });

  it("rejects empty name", () => {
    expect(() => validateWorkerInput({ ...ok, name: "  " })).toThrow(InvalidWorkerInputError);
  });

  it("rejects an unknown type", () => {
    expect(() => validateWorkerInput({ ...ok, type: "mainframe" })).toThrow(/type/);
  });

  it("rejects an unknown execution mode", () => {
    expect(() => validateWorkerInput({ ...ok, executionMode: "whenever" })).toThrow(/executionMode/);
  });

  it("rejects an unknown connectivity", () => {
    expect(() => validateWorkerInput({ ...ok, connectivity: "carrier-pigeon" })).toThrow(/connectivity/);
  });
});

describe("rowToWorker", () => {
  it("maps a snake_case DB row to a WorkerRecord and parses config/tags", () => {
    const created = new Date("2026-05-30T00:00:00Z");
    const rec = rowToWorker({
      id: "w1",
      scope: "org",
      org_id: "o1",
      user_id: null,
      name: "Java builder",
      type: "docker",
      execution_mode: "per-instance",
      connectivity: "push",
      config: { image: { kind: "ref", imageRef: "x:1" } },
      is_default: false,
      tags: ["java"],
      enabled: true,
      created_by: "u1",
      created_at: created,
      updated_at: created,
    });
    expect(rec).toEqual({
      id: "w1",
      scope: "org",
      orgId: "o1",
      userId: null,
      name: "Java builder",
      type: "docker",
      executionMode: "per-instance",
      connectivity: "push",
      config: { image: { kind: "ref", imageRef: "x:1" } },
      isDefault: false,
      tags: ["java"],
      enabled: true,
      createdBy: "u1",
      createdAt: created,
      updatedAt: created,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/workers/src/worker-record.test.ts`
Expected: FAIL — cannot resolve `./worker-record.ts`.

- [ ] **Step 3: Write the implementation**

Create `packages/workers/src/worker-record.ts`:

```typescript
import type { Connectivity, ExecutionMode, WorkerType } from "@journeyman/core";
import type { WorkerRecord, WorkerScope } from "@journeyman/core";

export class InvalidWorkerInputError extends Error {}

const WORKER_TYPES: WorkerType[] = [
  "local", "docker", "machine-linux", "machine-windows", "ecs", "ec2", "kubernetes", "cloud",
];
const MODES: ExecutionMode[] = ["per-instance", "shared"];
const CONNECTIVITY: Connectivity[] = ["push", "agent"];

export interface WorkerInputShape {
  name?: unknown;
  type?: unknown;
  executionMode?: unknown;
  connectivity?: unknown;
}

/** Validate the shape of a create/update worker request body. Throws InvalidWorkerInputError. */
export function validateWorkerInput(input: WorkerInputShape): void {
  if (typeof input.name !== "string" || input.name.trim().length === 0) {
    throw new InvalidWorkerInputError("worker name is required");
  }
  if (!WORKER_TYPES.includes(input.type as WorkerType)) {
    throw new InvalidWorkerInputError(`unknown worker type '${String(input.type)}'`);
  }
  if (!MODES.includes(input.executionMode as ExecutionMode)) {
    throw new InvalidWorkerInputError(`unknown executionMode '${String(input.executionMode)}'`);
  }
  if (
    input.connectivity !== undefined &&
    input.connectivity !== null &&
    !CONNECTIVITY.includes(input.connectivity as Connectivity)
  ) {
    throw new InvalidWorkerInputError(`unknown connectivity '${String(input.connectivity)}'`);
  }
}

/** Map a jm_workers DB row (snake_case) to a WorkerRecord (camelCase). */
export function rowToWorker(r: Record<string, any>): WorkerRecord {
  return {
    id: r.id,
    scope: r.scope as WorkerScope,
    orgId: r.org_id ?? null,
    userId: r.user_id ?? null,
    name: r.name,
    type: r.type as WorkerType,
    executionMode: r.execution_mode as ExecutionMode,
    connectivity: (r.connectivity ?? null) as Connectivity | null,
    config: (r.config ?? {}) as Record<string, unknown>,
    isDefault: Boolean(r.is_default),
    tags: Array.isArray(r.tags) ? (r.tags as string[]) : [],
    enabled: Boolean(r.enabled),
    createdBy: r.created_by ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/workers/src/worker-record.test.ts`
Expected: PASS (6 tests).

---

## Task 4: DB store (Queryable seam, TDD)

**Files:**
- Create: `packages/workers/src/db.ts`
- Test: `packages/workers/src/db.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/workers/src/db.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import type { Queryable } from "./db.ts";
import {
  insertWorker,
  listWorkers,
  getWorker,
  deleteWorker,
  listVisibleWorkers,
  fetchWorkerById,
} from "./db.ts";

/** Records the last query and returns canned rows. */
function fakeDb(rows: any[] = []): Queryable & { calls: Array<{ text: string; params?: unknown[] }> } {
  const calls: Array<{ text: string; params?: unknown[] }> = [];
  return {
    calls,
    async query(text: string, params?: unknown[]) {
      calls.push({ text, params });
      return { rows };
    },
  };
}

const row = {
  id: "w1", scope: "org", org_id: "o1", user_id: null, name: "Java builder",
  type: "docker", execution_mode: "per-instance", connectivity: "push",
  config: {}, is_default: false, tags: [], enabled: true,
  created_by: "u1", created_at: new Date(), updated_at: new Date(),
};

describe("workers db store", () => {
  it("insertWorker INSERTs and returns the mapped record", async () => {
    const db = fakeDb([row]);
    const rec = await insertWorker(db, {
      scope: "org", orgId: "o1", userId: null, name: "Java builder",
      type: "docker", executionMode: "per-instance", connectivity: "push",
      config: {}, createdBy: "u1",
    });
    expect(db.calls[0].text).toMatch(/insert into jm_workers/i);
    expect(rec.id).toBe("w1");
    expect(rec.type).toBe("docker");
  });

  it("listWorkers scopes org rows with user_id IS NULL", async () => {
    const db = fakeDb([row]);
    await listWorkers(db, { orgId: "o1", userId: null });
    expect(db.calls[0].text).toMatch(/user_id is null/i);
    expect(db.calls[0].params).toEqual(["o1"]);
  });

  it("listWorkers scopes user rows with user_id = $2", async () => {
    const db = fakeDb([row]);
    await listWorkers(db, { orgId: "o1", userId: "u1" });
    expect(db.calls[0].text).toMatch(/user_id = \$2/i);
    expect(db.calls[0].params).toEqual(["o1", "u1"]);
  });

  it("getWorker returns null when no row", async () => {
    const db = fakeDb([]);
    const rec = await getWorker(db, "missing", "o1", null);
    expect(rec).toBeNull();
  });

  it("deleteWorker returns false when nothing deleted", async () => {
    const db = { async query() { return { rows: [] }; } } as Queryable;
    expect(await deleteWorker(db, "x", "o1", null)).toBe(false);
  });

  it("listVisibleWorkers includes system + org + user scope", async () => {
    const db = fakeDb([row]);
    await listVisibleWorkers(db, "o1", "u1");
    expect(db.calls[0].text).toMatch(/scope = 'system'/i);
    expect(db.calls[0].params).toEqual(["o1", "u1"]);
  });

  it("fetchWorkerById matches system OR org OR user scope", async () => {
    const db = fakeDb([row]);
    const rec = await fetchWorkerById(db, "o1", "u1", "w1");
    expect(db.calls[0].text).toMatch(/where id = \$1/i);
    expect(db.calls[0].params).toEqual(["w1", "o1", "u1"]);
    expect(rec?.id).toBe("w1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/workers/src/db.test.ts`
Expected: FAIL — cannot resolve `./db.ts`.

- [ ] **Step 3: Write the implementation**

Create `packages/workers/src/db.ts`:

```typescript
import type { CreateWorkerArgs, UpdateWorkerArgs, WorkerRecord } from "@journeyman/core";
import { rowToWorker } from "./worker-record.ts";

/** Minimal structural seam over a pg Pool/Client so the store is unit-testable. */
export interface Queryable {
  query(text: string, params?: unknown[]): Promise<{ rows: any[] }>;
}

const COLS =
  "id, scope, org_id, user_id, name, type, execution_mode, connectivity, config, is_default, tags, enabled, created_by, created_at, updated_at";

export async function insertWorker(db: Queryable, input: CreateWorkerArgs): Promise<WorkerRecord> {
  const { rows } = await db.query(
    `INSERT INTO jm_workers
       (scope, org_id, user_id, name, type, execution_mode, connectivity, config, is_default, tags, enabled, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10::jsonb,$11,$12)
     RETURNING ${COLS}`,
    [
      input.scope, input.orgId, input.userId, input.name, input.type, input.executionMode,
      input.connectivity ?? null, JSON.stringify(input.config ?? {}), input.isDefault ?? false,
      JSON.stringify(input.tags ?? []), input.enabled ?? true, input.createdBy,
    ],
  );
  return rowToWorker(rows[0]);
}

export async function listWorkers(
  db: Queryable,
  scope: { orgId: string; userId: string | null },
): Promise<WorkerRecord[]> {
  if (scope.userId === null) {
    const { rows } = await db.query(
      `SELECT ${COLS} FROM jm_workers WHERE org_id = $1 AND user_id IS NULL ORDER BY name`,
      [scope.orgId],
    );
    return rows.map(rowToWorker);
  }
  const { rows } = await db.query(
    `SELECT ${COLS} FROM jm_workers WHERE org_id = $1 AND user_id = $2 ORDER BY name`,
    [scope.orgId, scope.userId],
  );
  return rows.map(rowToWorker);
}

export async function getWorker(
  db: Queryable,
  id: string,
  orgId: string,
  userId: string | null,
): Promise<WorkerRecord | null> {
  const { rows } = await db.query(
    `SELECT ${COLS} FROM jm_workers
     WHERE id = $1 AND org_id = $2 AND user_id IS NOT DISTINCT FROM $3`,
    [id, orgId, userId],
  );
  return rows[0] ? rowToWorker(rows[0]) : null;
}

export async function updateWorker(db: Queryable, input: UpdateWorkerArgs): Promise<boolean> {
  const sets: string[] = [];
  const params: unknown[] = [];
  let i = 1;
  const set = (col: string, val: unknown, cast = "") => {
    sets.push(`${col} = $${i}${cast}`);
    params.push(val);
    i += 1;
  };
  if (input.name !== undefined) set("name", input.name);
  if (input.executionMode !== undefined) set("execution_mode", input.executionMode);
  if (input.connectivity !== undefined) set("connectivity", input.connectivity);
  if (input.config !== undefined) set("config", JSON.stringify(input.config), "::jsonb");
  if (input.isDefault !== undefined) set("is_default", input.isDefault);
  if (input.tags !== undefined) set("tags", JSON.stringify(input.tags), "::jsonb");
  if (input.enabled !== undefined) set("enabled", input.enabled);
  if (sets.length === 0) return true;
  sets.push("updated_at = now()");
  params.push(input.id, input.orgId, input.userId);
  const { rows } = await db.query(
    `UPDATE jm_workers SET ${sets.join(", ")}
     WHERE id = $${i} AND org_id = $${i + 1} AND user_id IS NOT DISTINCT FROM $${i + 2}
     RETURNING id`,
    params,
  );
  return rows.length > 0;
}

export async function deleteWorker(
  db: Queryable,
  id: string,
  orgId: string,
  userId: string | null,
): Promise<boolean> {
  const { rows } = await db.query(
    `DELETE FROM jm_workers
     WHERE id = $1 AND org_id = $2 AND user_id IS NOT DISTINCT FROM $3
     RETURNING id`,
    [id, orgId, userId],
  );
  return rows.length > 0;
}

/** System defaults + this org's org-scoped + this user's user-scoped, enabled only. */
export async function listVisibleWorkers(
  db: Queryable,
  orgId: string,
  userId: string,
): Promise<WorkerRecord[]> {
  const { rows } = await db.query(
    `SELECT ${COLS} FROM jm_workers
     WHERE enabled = true AND (
       scope = 'system'
       OR (scope = 'org'  AND org_id = $1)
       OR (scope = 'user' AND org_id = $1 AND user_id = $2)
     )
     ORDER BY scope, name`,
    [orgId, userId],
  );
  return rows.map(rowToWorker);
}

/** Fetch a single worker visible to {orgId,userId} (system OR org OR user scope). */
export async function fetchWorkerById(
  db: Queryable,
  orgId: string,
  userId: string,
  id: string,
): Promise<WorkerRecord | null> {
  const { rows } = await db.query(
    `SELECT ${COLS} FROM jm_workers
     WHERE id = $1 AND enabled = true AND (
       scope = 'system'
       OR (scope = 'org'  AND org_id = $2)
       OR (scope = 'user' AND org_id = $2 AND user_id = $3)
     )`,
    [id, orgId, userId],
  );
  return rows[0] ? rowToWorker(rows[0]) : null;
}

/** The org/user's default worker, falling back to the system default. */
export async function fetchDefaultWorker(
  db: Queryable,
  orgId: string,
  userId: string,
): Promise<WorkerRecord | null> {
  const { rows } = await db.query(
    `SELECT ${COLS} FROM jm_workers
     WHERE enabled = true AND is_default = true AND (
       scope = 'system'
       OR (scope = 'org'  AND org_id = $1)
       OR (scope = 'user' AND org_id = $1 AND user_id = $2)
     )
     ORDER BY CASE scope WHEN 'user' THEN 0 WHEN 'org' THEN 1 ELSE 2 END
     LIMIT 1`,
    [orgId, userId],
  );
  return rows[0] ? rowToWorker(rows[0]) : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/workers/src/db.test.ts`
Expected: PASS (7 tests).

---

## Task 5: `resolveWorker` resolver (TDD)

**Files:**
- Create: `packages/workers/src/resolver.ts`
- Test: `packages/workers/src/resolver.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/workers/src/resolver.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import type { Queryable } from "./db.ts";
import { resolveWorker, WorkerNotFoundError } from "./resolver.ts";

const dockerRow = {
  id: "w1", scope: "org", org_id: "o1", user_id: null, name: "Java builder",
  type: "docker", execution_mode: "per-instance", connectivity: "push",
  config: { image: { kind: "ref", imageRef: "x:1" } }, is_default: false, tags: [],
  enabled: true, created_by: "u1", created_at: new Date(), updated_at: new Date(),
};
const localDefault = { ...dockerRow, id: "sys", scope: "system", org_id: null, user_id: null, name: "Local Workspace", type: "local", execution_mode: "shared", connectivity: null, config: {}, is_default: true };

function dbReturning(rows: any[]): Queryable {
  return { async query() { return { rows }; } };
}

describe("resolveWorker", () => {
  it("resolves an explicit workerId to a ResolvedWorker", async () => {
    const r = await resolveWorker(dbReturning([dockerRow]), { orgId: "o1", userId: "u1" }, "w1");
    expect(r).toEqual({
      id: "w1",
      type: "docker",
      executionMode: "per-instance",
      connectivity: "push",
      config: { image: { kind: "ref", imageRef: "x:1" } },
    });
  });

  it("falls back to the default worker when workerId is undefined", async () => {
    const r = await resolveWorker(dbReturning([localDefault]), { orgId: "o1", userId: "u1" }, undefined);
    expect(r.id).toBe("sys");
    expect(r.type).toBe("local");
    expect(r.connectivity).toBeUndefined();
  });

  it("throws WorkerNotFoundError when an explicit workerId is missing", async () => {
    await expect(
      resolveWorker(dbReturning([]), { orgId: "o1", userId: "u1" }, "ghost"),
    ).rejects.toBeInstanceOf(WorkerNotFoundError);
  });

  it("throws WorkerNotFoundError when no default exists", async () => {
    await expect(
      resolveWorker(dbReturning([]), { orgId: "o1", userId: "u1" }, undefined),
    ).rejects.toBeInstanceOf(WorkerNotFoundError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/workers/src/resolver.test.ts`
Expected: FAIL — cannot resolve `./resolver.ts`.

- [ ] **Step 3: Write the implementation**

Create `packages/workers/src/resolver.ts`:

```typescript
import type { ResolvedWorker } from "@journeyman/core";
import type { Queryable } from "./db.ts";
import { fetchWorkerById, fetchDefaultWorker } from "./db.ts";
import type { WorkerRecord } from "@journeyman/core";

export class WorkerNotFoundError extends Error {}

export interface ResolveWorkerCtx {
  orgId: string;
  userId: string;
}

function toResolved(w: WorkerRecord): ResolvedWorker {
  return {
    id: w.id,
    type: w.type,
    executionMode: w.executionMode,
    connectivity: w.connectivity ?? undefined,
    config: w.config,
  };
}

/**
 * Resolve a workflow's worker at run start: an explicit `workerId` (node override
 * or flow default), or the org/user/system default when none is given.
 */
export async function resolveWorker(
  db: Queryable,
  ctx: ResolveWorkerCtx,
  workerId: string | undefined,
): Promise<ResolvedWorker> {
  if (workerId) {
    const w = await fetchWorkerById(db, ctx.orgId, ctx.userId, workerId);
    if (!w) throw new WorkerNotFoundError(`worker '${workerId}' not found or not visible`);
    return toResolved(w);
  }
  const def = await fetchDefaultWorker(db, ctx.orgId, ctx.userId);
  if (!def) throw new WorkerNotFoundError("no default worker configured");
  return toResolved(def);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/workers/src/resolver.test.ts`
Expected: PASS (4 tests).

---

## Task 6: Fastify CRUD + visible routes

**Files:**
- Create: `packages/workers/src/routes/index.ts`

These routes mirror `@journeyman/mcp` org/user/visible routes. They are verified by typecheck + the api-server boot (Task 8); request/response behavior is covered by the store/resolver unit tests above (the repo has no live-DB route-test harness).

- [ ] **Step 1: Create the routes**

Create `packages/workers/src/routes/index.ts`:

```typescript
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { requireAuth } from "@journeyman/identity";
import {
  insertWorker, listWorkers, getWorker, updateWorker, deleteWorker, listVisibleWorkers,
} from "../db.ts";
import { validateWorkerInput, InvalidWorkerInputError } from "../worker-record.ts";

export async function registerWorkerRoutes(app: FastifyInstance, pool: Pool): Promise<void> {
  // ---- Visible (system + org + user) ----
  app.get("/api/orgs/:orgId/workers/visible", { preHandler: requireAuth() }, async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    const ctx = req.runContext!;
    if (ctx.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
    return listVisibleWorkers(pool, orgId, ctx.user.id);
  });

  // ---- Org-scoped CRUD ----
  app.get("/api/orgs/:orgId/workers", { preHandler: requireAuth() }, async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    if (req.runContext!.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
    return listWorkers(pool, { orgId, userId: null });
  });

  app.post("/api/orgs/:orgId/workers", { preHandler: requireAuth({ role: "admin" }) }, async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    const ctx = req.runContext!;
    if (ctx.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
    const body = req.body as any;
    try {
      validateWorkerInput(body);
      const rec = await insertWorker(pool, {
        scope: "org", orgId, userId: null, name: body.name, type: body.type,
        executionMode: body.executionMode, connectivity: body.connectivity ?? null,
        config: body.config ?? {}, isDefault: body.isDefault ?? false, tags: body.tags ?? [],
        enabled: body.enabled ?? true, createdBy: ctx.user.id,
      });
      reply.code(201);
      return rec;
    } catch (err) {
      if (err instanceof InvalidWorkerInputError) return reply.code(400).send({ error: err.message });
      throw err;
    }
  });

  app.get("/api/orgs/:orgId/workers/:id", { preHandler: requireAuth() }, async (req, reply) => {
    const { orgId, id } = req.params as { orgId: string; id: string };
    if (req.runContext!.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
    const rec = await getWorker(pool, id, orgId, null);
    if (!rec) return reply.code(404).send({ error: "Not found" });
    return rec;
  });

  app.patch("/api/orgs/:orgId/workers/:id", { preHandler: requireAuth({ role: "admin" }) }, async (req, reply) => {
    const { orgId, id } = req.params as { orgId: string; id: string };
    if (req.runContext!.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
    const body = req.body as any;
    const ok = await updateWorker(pool, {
      id, orgId, userId: null, name: body.name, executionMode: body.executionMode,
      connectivity: body.connectivity, config: body.config, isDefault: body.isDefault,
      tags: body.tags, enabled: body.enabled,
    });
    if (!ok) return reply.code(404).send({ error: "Not found" });
    return { ok: true };
  });

  app.delete("/api/orgs/:orgId/workers/:id", { preHandler: requireAuth({ role: "admin" }) }, async (req, reply) => {
    const { orgId, id } = req.params as { orgId: string; id: string };
    if (req.runContext!.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
    const ok = await deleteWorker(pool, id, orgId, null);
    if (!ok) return reply.code(404).send({ error: "Not found" });
    return { ok: true };
  });

  // ---- User-scoped CRUD ----
  app.get("/api/orgs/:orgId/users/me/workers", { preHandler: requireAuth() }, async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    const ctx = req.runContext!;
    if (ctx.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
    return listWorkers(pool, { orgId, userId: ctx.user.id });
  });

  app.post("/api/orgs/:orgId/users/me/workers", { preHandler: requireAuth() }, async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    const ctx = req.runContext!;
    if (ctx.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
    const body = req.body as any;
    try {
      validateWorkerInput(body);
      const rec = await insertWorker(pool, {
        scope: "user", orgId, userId: ctx.user.id, name: body.name, type: body.type,
        executionMode: body.executionMode, connectivity: body.connectivity ?? null,
        config: body.config ?? {}, isDefault: body.isDefault ?? false, tags: body.tags ?? [],
        enabled: body.enabled ?? true, createdBy: ctx.user.id,
      });
      reply.code(201);
      return rec;
    } catch (err) {
      if (err instanceof InvalidWorkerInputError) return reply.code(400).send({ error: err.message });
      throw err;
    }
  });

  app.patch("/api/orgs/:orgId/users/me/workers/:id", { preHandler: requireAuth() }, async (req, reply) => {
    const { orgId, id } = req.params as { orgId: string; id: string };
    const ctx = req.runContext!;
    if (ctx.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
    const body = req.body as any;
    const ok = await updateWorker(pool, {
      id, orgId, userId: ctx.user.id, name: body.name, executionMode: body.executionMode,
      connectivity: body.connectivity, config: body.config, isDefault: body.isDefault,
      tags: body.tags, enabled: body.enabled,
    });
    if (!ok) return reply.code(404).send({ error: "Not found" });
    return { ok: true };
  });

  app.delete("/api/orgs/:orgId/users/me/workers/:id", { preHandler: requireAuth() }, async (req, reply) => {
    const { orgId, id } = req.params as { orgId: string; id: string };
    const ctx = req.runContext!;
    if (ctx.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
    const ok = await deleteWorker(pool, id, orgId, ctx.user.id);
    if (!ok) return reply.code(404).send({ error: "Not found" });
    return { ok: true };
  });
}
```

**Note:** confirm the import name for the auth preHandler. The middleware factory is `makeRequireAuth(deps)` (`packages/identity/src/middleware.ts`); if `@journeyman/identity` does not export a ready-made `requireAuth`, import the same symbol the mcp routes import (open `packages/mcp/src/routes/org-mcp.ts` and copy its exact `import { requireAuth } from "@journeyman/identity"` line / usage). Match mcp verbatim.

---

## Task 7: Wire deps + register routes

**Files:**
- Modify: `packages/workers/package.json`
- Modify: `packages/workers/src/index.ts`
- Modify: `packages/api-server/src/server.ts`

- [ ] **Step 1: Add `pg` + identity deps to `packages/workers/package.json`**

In the `"dependencies"` block, add (so it has `@journeyman/core`, `@journeyman/identity`, `pg`):

```json
  "dependencies": {
    "@journeyman/core": "*",
    "@journeyman/identity": "*",
    "pg": "^8.13.0"
  },
```

In `"devDependencies"`, add `"@types/pg": "^8.11.10"` alongside the existing entries:

```json
  "devDependencies": {
    "@types/node": "^25.6.0",
    "@types/pg": "^8.11.10",
    "typescript": "^6.0.3",
    "vitest": "^2.1.9"
  }
```

Also add `fastify` as an optional peer (mirroring core's pattern) so the routes file typechecks — add after `"devDependencies"`:

```json
  "peerDependencies": { "fastify": "^4.28.1" },
  "peerDependenciesMeta": { "fastify": { "optional": true } }
```

- [ ] **Step 2: Export the management surface from `packages/workers/src/index.ts`**

Append to `packages/workers/src/index.ts`:

```typescript
export type { Queryable } from "./db.ts";
export {
  insertWorker, listWorkers, getWorker, updateWorker, deleteWorker,
  listVisibleWorkers, fetchWorkerById, fetchDefaultWorker,
} from "./db.ts";
export { rowToWorker, validateWorkerInput, InvalidWorkerInputError } from "./worker-record.ts";
export { resolveWorker, WorkerNotFoundError } from "./resolver.ts";
export type { ResolveWorkerCtx } from "./resolver.ts";
export { registerWorkerRoutes } from "./routes/index.ts";
```

- [ ] **Step 3: Register routes in api-server**

In `packages/api-server/src/server.ts`, add the import near the other `@journeyman/*` route imports:

```typescript
import { registerWorkerRoutes } from "@journeyman/workers";
```

Then, inside `if (c.pool) { ... }` (next to `await registerMcpRoutes(app, c.pool);`), add:

```typescript
    await registerWorkerRoutes(app, c.pool);
```

- [ ] **Step 4: Install the new deps**

Run: `npm install`
Expected: completes; `pg`/`@types/pg` linked into `@journeyman/workers`.

---

## Task 8: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Run the workers unit suite**

Run: `npm test -w @journeyman/workers`
Expected: PASS — Plan 1 suites (16) + worker-record (6) + db (7) + resolver (4) = 33 tests.

- [ ] **Step 2: Typecheck core, workers, api-server**

Run: `npm run typecheck -w @journeyman/core && npm run typecheck -w @journeyman/workers && npm run typecheck -w @journeyman/api-server`
Expected: all PASS.

- [ ] **Step 3: Repo-wide checks**

Run: `npm run check`
Expected: PASS. `@journeyman/workers` (backend) now imports `@journeyman/core` + `@journeyman/identity` (both shared) + `pg`/`fastify` (external) — all allowed.

- [ ] **Step 4: Boot smoke (GATED — Postgres required)**

If a dev DB + migration are available: start the api-server (`npm run start:api-server`) and confirm it boots without route-registration errors, then `GET /api/orgs/<orgId>/workers/visible` returns the seeded `Local Workspace` system worker. If no DB: skip and note unverified.

---

## Self-Review

**Spec coverage (Plan 3 scope):**
- §3 Worker entity (scope/type/mode/connectivity/config/isDefault/tags) → Task 1 (`WorkerRecord`) + Task 2 (`jm_workers`).
- §3/§18 system default `local` worker → Task 2 seed.
- §7 association (`defaults.workerId`, node `workerId`) → Task 1 Step 2.
- §7 CRUD + visible API (user/org/system) → Tasks 4, 6.
- §7 run-start *resolution* (`workerId` → ResolvedWorker, default fallback) → Task 5 (`resolveWorker`). (Run-start *use* — provision/exec — is Plan 4.)
- Deferred & noted: management UI + flow-editor picker → Plan 3-UI; test-connection endpoint + provisioning → Plan 4; promote-to-org → later.

**Placeholder scan:** No TBD/TODO. Every code step has complete code; commands show expected output. The Task 6 note to confirm the exact `requireAuth` import symbol against `packages/mcp/src/routes/org-mcp.ts` is a verification instruction (match existing code), not a placeholder — the handler bodies are fully written. DB-dependent steps (Task 2 Step 2, Task 8 Step 4) are explicitly gated with documented fallbacks.

**Type consistency:** `WorkerRecord`/`CreateWorkerArgs`/`UpdateWorkerArgs` (Task 1) are used identically by `db.ts` (Task 4) and `worker-record.ts` (Task 3). `Queryable` is defined once (Task 4) and imported by `resolver.ts` (Task 5) and tests. `resolveWorker(db, ctx, workerId)` returns `ResolvedWorker` (Plan 1) with `connectivity?: undefined` (null→undefined mapping in `toResolved`). Store fn names (`insertWorker`, `listWorkers`, `getWorker`, `updateWorker`, `deleteWorker`, `listVisibleWorkers`, `fetchWorkerById`, `fetchDefaultWorker`) match between `db.ts`, `index.ts` exports, `resolver.ts`, and `routes/index.ts`.
