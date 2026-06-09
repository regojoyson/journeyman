# Remove the In-Memory Store Backend (Postgres-only) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make PostgreSQL the only persistence backend by deleting the `memory` store classes, the `STORE_BACKEND` env var, the runtime toggle, and their tests.

**Architecture:** `api-server/src/composition.ts` is the single wiring point. Today it branches on `cfg.storeBackend` between `Postgres*` and `Memory*` store sets. We collapse it to always build the `Postgres*` set with a live `pg` pool, delete the `Memory*` classes and the orchestration tests that used them as DB-free fixtures, replace the worker's `MemoryEventBus` no-pool fallback with an inline no-op `IEventBus` (preserving the worker's env-only mode), and strip `STORE_BACKEND` from all config and docs.

**Tech Stack:** TypeScript (Node, ESM `.ts` imports), npm workspaces, `pg`, Vitest.

**Execution note (user overrides):** Do **not** commit or run tests per task. Make all edits, then run typecheck + boundary check + tests **once** at the end, and make a **single** commit (Task 11).

---

### Task 1: Delete the memory store directory

**Files:**
- Delete: `packages/orchestrator/src/stores/memory/` (entire directory)

This directory contains 8 store implementations and 4 test files, none of which are used once the toggle is gone:
`memory-event-bus.ts`, `memory-flow-grants-store.ts`, `memory-flow-store.ts`, `memory-webhook-event-store.ts`, `memory-webhook-store.ts`, `memory-workflow-instance-grants-store.ts`, `memory-workflow-instance-store.ts`, `memory-workflow-trigger-store.ts`, `mark-skipped.test.ts`, `matcher-decouple.test.ts`, `memory-workflow-instance-store.test.ts`, `memory-webhook-event-store.test.ts`.

- [ ] **Step 1: Delete the directory**

```bash
git rm -r packages/orchestrator/src/stores/memory
```

Expected: `rm 'packages/orchestrator/src/stores/memory/...'` printed for all 12 files.

---

### Task 2: Remove `MemoryHumanTaskResolutionStore`

**Files:**
- Modify: `packages/orchestrator/src/stores/human-task-resolution-store.ts`

This file holds both the Postgres and Memory implementations plus a shared `rowToObj` helper. Remove only the Memory class. Keep `PostgresHumanTaskResolutionStore`, the `IHumanTaskResolutionStore` interface, `HumanTaskResolutionRow`, and `rowToObj`.

- [ ] **Step 1: Delete the `MemoryHumanTaskResolutionStore` class**

Remove this entire block (currently lines 57–73), leaving `PostgresHumanTaskResolutionStore` above it and `function rowToObj` below it intact:

```typescript
export class MemoryHumanTaskResolutionStore implements IHumanTaskResolutionStore {
  private rows: HumanTaskResolutionRow[] = [];
  private nextId = 1;
  async create(input: Omit<HumanTaskResolutionRow, "id" | "resolvedAt">): Promise<HumanTaskResolutionRow> {
    const row: HumanTaskResolutionRow = { id: String(this.nextId++), resolvedAt: new Date(), ...input };
    this.rows.push(row);
    return row;
  }
  async listForRun(runId: string): Promise<HumanTaskResolutionRow[]> {
    return this.rows.filter(r => r.runId === runId).slice().sort((a, b) => +a.resolvedAt - +b.resolvedAt);
  }
  async latestForNode(runId: string, nodeId: string): Promise<HumanTaskResolutionRow | null> {
    const list = this.rows.filter(r => r.runId === runId && r.nodeId === nodeId)
      .sort((a, b) => +b.resolvedAt - +a.resolvedAt);
    return list[0] ?? null;
  }
}
```

---

### Task 3: Remove `Memory*` exports from the orchestrator barrel

**Files:**
- Modify: `packages/orchestrator/src/index.ts`

Remove every `Memory*` store export. Keep `InMemoryStepRegistry` and all `Postgres*` exports.

- [ ] **Step 1: Delete the `MemoryWorkflowStore` / `MemoryWorkflowVersionStore` export**

Remove:

```typescript
export {
  MemoryWorkflowStore, MemoryWorkflowVersionStore,
} from "./stores/memory/memory-flow-store.ts";
```

- [ ] **Step 2: Delete the `MemoryWorkflowInstanceStore` / `MemoryNodeExecutionStore` export**

Remove:

```typescript
export {
  MemoryWorkflowInstanceStore, MemoryNodeExecutionStore,
} from "./stores/memory/memory-workflow-instance-store.ts";
```

- [ ] **Step 3: Delete the `MemoryEventBus` export**

Remove:

```typescript
export { MemoryEventBus } from "./stores/memory/memory-event-bus.ts";
```

- [ ] **Step 4: Drop `MemoryHumanTaskResolutionStore` from the human-task export**

Change this block:

```typescript
export {
  PostgresHumanTaskResolutionStore,
  MemoryHumanTaskResolutionStore,
  type IHumanTaskResolutionStore,
  type HumanTaskResolutionRow,
} from "./stores/human-task-resolution-store.ts";
```

to:

```typescript
export {
  PostgresHumanTaskResolutionStore,
  type IHumanTaskResolutionStore,
  type HumanTaskResolutionRow,
} from "./stores/human-task-resolution-store.ts";
```

- [ ] **Step 5: Delete the remaining four `Memory*` store exports**

Remove these four lines:

```typescript
export { MemoryWorkflowGrantsStore } from "./stores/memory/memory-flow-grants-store.ts";
export { MemoryWorkflowInstanceGrantsStore } from "./stores/memory/memory-workflow-instance-grants-store.ts";
export { MemoryWebhookEventStore } from "./stores/memory/memory-webhook-event-store.ts";
export { MemoryWebhookStore } from "./stores/memory/memory-webhook-store.ts";
export { MemoryWorkflowTriggerStore } from "./stores/memory/memory-workflow-trigger-store.ts";
```

(That is all five `Memory*` lines in the grants/webhook/trigger group — leave the adjacent `Postgres*` exports.)

---

### Task 4: Replace the worker's `MemoryEventBus` fallback with a no-op bus

**Files:**
- Modify: `packages/orchestrator/src/cli-worker.ts`

The worker supports a DB-less "env-only" mode (no `DATABASE_URL`). `MemoryEventBus` was only used there, and the code already warns those events are invisible to the viewer — an in-process bus in a separate worker process has no cross-process value. Replace it with an inline no-op `IEventBus` so the env-only mode survives without any memory store.

- [ ] **Step 1: Remove the `MemoryEventBus` import**

Delete this line (currently line 34):

```typescript
import { MemoryEventBus } from "./stores/memory/memory-event-bus.ts";
```

- [ ] **Step 2: Confirm `IEventBus` is importable**

`IEventBus` comes from `@journeyman/core`. Check the existing imports at the top of `cli-worker.ts`. If `IEventBus` is not already imported, add it to the existing `import type { ... } from "@journeyman/core";` block. If there is no such block, add:

```typescript
import type { IEventBus } from "@journeyman/core";
```

- [ ] **Step 3: Replace the events assignment**

Change this block (currently lines 394–398):

```typescript
// Use the same Postgres event bus as the api-server so step events are visible
// in the run viewer. Fall back to in-memory only when DATABASE_URL isn't set.
const events = pool ? new PostgresEventBus(pool) : new MemoryEventBus();
if (!pool) {
  log.warn("DATABASE_URL not set — step events will be in-memory only and invisible to the workflow instance viewer");
}
```

to:

```typescript
// Use the same Postgres event bus as the api-server so step events are visible
// in the run viewer. With no DATABASE_URL (env-only mode) events are dropped.
const noopEventBus: IEventBus = {
  append: async () => undefined,
  subscribe: () => () => undefined,
};
const events: IEventBus = pool ? new PostgresEventBus(pool) : noopEventBus;
if (!pool) {
  log.warn("DATABASE_URL not set — step events are dropped and invisible to the workflow instance viewer");
}
```

> **Note for the implementer:** `IEventBus` may define more or differently-named methods than `append`/`subscribe`. Before writing the no-op, open `packages/core/src/**` and read the `IEventBus` interface (grep: `grep -rn "interface IEventBus" packages/core/src`). Implement a no-op for **every** method on the interface, matching the exact method names and signatures. The `append`/`subscribe` shape above is the expected one based on existing call sites (`events.append(...)` in `composition.ts`), but verify against the interface and adjust if it differs.

---

### Task 5: Collapse the `composition.ts` store-backend branch

**Files:**
- Modify: `packages/api-server/src/composition.ts`

Remove the `Memory*` imports, the `storeBackend` config field, and the `if (useMemory)` branch. Always build the `Postgres*` stores with a live pool. Leave the downstream `pool ? … : undefined` / `if (pool)` guards as-is — they remain correct (pool is always set now) and removing them is unrelated risk; keeping `pool` typed `Pool | null` means zero ripple.

- [ ] **Step 1: Remove the `Memory*` imports from the orchestrator import block**

In the large `import { ... } from "@journeyman/orchestrator";` block, delete these lines:

```typescript
  MemoryWorkflowGrantsStore,
  MemoryWorkflowInstanceGrantsStore,
  MemoryWorkflowStore,
  MemoryWorkflowVersionStore,
  MemoryWorkflowInstanceStore,
  MemoryNodeExecutionStore,
  MemoryEventBus,
  MemoryWebhookEventStore,
  MemoryWebhookStore,
  MemoryWorkflowTriggerStore,
  MemoryHumanTaskResolutionStore,
```

Leave `InMemoryStepRegistry`, `createPool`, every `Postgres*` import, and all other entries in the block intact.

- [ ] **Step 2: Remove the `storeBackend` field from `CompositionConfig`**

Change:

```typescript
export interface CompositionConfig {
  databaseUrl: string;
  conductorBaseUrl: string;
  /** "postgres" (production) or "memory" (tests, demos). Default postgres. */
  storeBackend?: "postgres" | "memory";
}
```

to:

```typescript
export interface CompositionConfig {
  databaseUrl: string;
  conductorBaseUrl: string;
}
```

- [ ] **Step 3: Replace the `useMemory` branch with unconditional Postgres wiring**

Change this block (the `const useMemory` line, the `let` declarations, and the entire `if (useMemory) { … } else { … }`):

```typescript
export function buildComposition(cfg: CompositionConfig): Composition {
  const useMemory = cfg.storeBackend === "memory";

  let workflowGrants: IWorkflowGrantsStore;
  let workflowInstanceGrants: IWorkflowInstanceGrantsStore;
  let workflows: IWorkflowStore;
  let workflowVersions: IWorkflowVersionStore;
  let workflowInstances: IWorkflowInstanceStore;
  let nodeExecutions: INodeExecutionStore;
  let events: IEventBus;
  let webhookEvents: IWebhookEventStore;
  let webhooks: IWebhookStore;
  let workflowTriggers: IWorkflowTriggerStore;
  let humanTaskResolutions: IHumanTaskResolutionStore;
  let pool: Pool | null = null;

  if (useMemory) {
    const v = new MemoryWorkflowVersionStore();
    workflowVersions = v;
    workflowGrants = new MemoryWorkflowGrantsStore();
    workflowInstanceGrants = new MemoryWorkflowInstanceGrantsStore();
    workflows = new MemoryWorkflowStore(v, workflowGrants);
    const memoryInstances = new MemoryWorkflowInstanceStore();
    workflowInstances = memoryInstances;
    nodeExecutions = new MemoryNodeExecutionStore(memoryInstances);
    events = new MemoryEventBus();
    webhookEvents = new MemoryWebhookEventStore();
    webhooks = new MemoryWebhookStore();
    workflowTriggers = new MemoryWorkflowTriggerStore();
    humanTaskResolutions = new MemoryHumanTaskResolutionStore();
  } else {
    pool = createPool({ connectionString: cfg.databaseUrl });
    const v = new PostgresWorkflowVersionStore(pool);
    workflowVersions = v;
    workflowGrants = new PostgresWorkflowGrantsStore(pool);
    workflowInstanceGrants = new PostgresWorkflowInstanceGrantsStore(pool);
    workflows = new PostgresWorkflowStore(pool, v, workflowGrants);
    workflowInstances = new PostgresWorkflowInstanceStore(pool);
    nodeExecutions = new PostgresNodeExecutionStore(pool);
    events = new PostgresEventBus(pool);
    webhookEvents = new PostgresWebhookEventStore(pool);
    webhooks = new PostgresWebhookStore(pool);
    workflowTriggers = new PostgresWorkflowTriggerStore(pool);
    humanTaskResolutions = new PostgresHumanTaskResolutionStore(pool);
  }
```

to:

```typescript
export function buildComposition(cfg: CompositionConfig): Composition {
  // Postgres is the only persistence backend. `pool` is typed `Pool | null`
  // so the downstream sandbox-reaper guards (`pool ? … : undefined`) compile
  // unchanged; it is always non-null in practice.
  const pool: Pool | null = createPool({ connectionString: cfg.databaseUrl });
  const v = new PostgresWorkflowVersionStore(pool);
  const workflowVersions: IWorkflowVersionStore = v;
  const workflowGrants: IWorkflowGrantsStore = new PostgresWorkflowGrantsStore(pool);
  const workflowInstanceGrants: IWorkflowInstanceGrantsStore = new PostgresWorkflowInstanceGrantsStore(pool);
  const workflows: IWorkflowStore = new PostgresWorkflowStore(pool, v, workflowGrants);
  const workflowInstances: IWorkflowInstanceStore = new PostgresWorkflowInstanceStore(pool);
  const nodeExecutions: INodeExecutionStore = new PostgresNodeExecutionStore(pool);
  const events: IEventBus = new PostgresEventBus(pool);
  const webhookEvents: IWebhookEventStore = new PostgresWebhookEventStore(pool);
  const webhooks: IWebhookStore = new PostgresWebhookStore(pool);
  const workflowTriggers: IWorkflowTriggerStore = new PostgresWorkflowTriggerStore(pool);
  const humanTaskResolutions: IHumanTaskResolutionStore = new PostgresHumanTaskResolutionStore(pool);
```

> Everything after this point (the `humanTaskTimeouts` line onward) is unchanged. The closing brace of the old `else` block is removed by this replacement — make sure the next existing line, `const humanTaskTimeouts: HumanTaskTimeoutService = new InMemoryHumanTaskTimeoutService();`, follows directly.

---

### Task 6: Remove `storeBackend` from the api-server CLI config

**Files:**
- Modify: `packages/api-server/src/cli-start.ts`

- [ ] **Step 1: Delete the `storeBackend` config line**

Change:

```typescript
const cfg = {
  databaseUrl: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5433/journeyman",
  conductorBaseUrl: process.env.CONDUCTOR_BASE_URL ?? "http://localhost:8080/api",
  storeBackend: (process.env.STORE_BACKEND as "memory" | "postgres" | undefined) ?? "postgres",
};
```

to:

```typescript
const cfg = {
  databaseUrl: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5433/journeyman",
  conductorBaseUrl: process.env.CONDUCTOR_BASE_URL ?? "http://localhost:8080/api",
};
```

---

### Task 7: Delete the memory-only integration test

**Files:**
- Delete: `packages/api-server/src/services/webhook-wait-sweeper.integration.test.ts`

This test builds its composition with `storeBackend: "memory"` and `databaseUrl: ""`. It cannot run once the memory backend is gone and is not being rewritten against Postgres.

- [ ] **Step 1: Delete the file**

```bash
git rm packages/api-server/src/services/webhook-wait-sweeper.integration.test.ts
```

---

### Task 8: Remove `STORE_BACKEND` from env example files

**Files:**
- Modify: `.env.example`
- Modify: `.env.production.example`

- [ ] **Step 1: `.env.example` — delete the comment + var (currently lines 16–17)**

Remove these two lines:

```
# memory | postgres
STORE_BACKEND=postgres
```

- [ ] **Step 2: `.env.production.example` — delete the var (currently line 23)**

Remove this line:

```
STORE_BACKEND=postgres
```

---

### Task 9: Remove `STORE_BACKEND` from deploy configs

**Files:**
- Modify: `compose.deploy.yml`
- Modify: `deploy/k8s/base/configmap.yaml`

- [ ] **Step 1: `compose.deploy.yml` — delete both occurrences**

Remove both lines (currently lines 94 and 120):

```yaml
      STORE_BACKEND: postgres
```

- [ ] **Step 2: `deploy/k8s/base/configmap.yaml` — delete the var (currently line 8)**

Remove this line:

```yaml
  STORE_BACKEND: "postgres"
```

---

### Task 10: Remove `STORE_BACKEND` from docs

**Files:**
- Modify: `README.md`
- Modify: `docs/constitution/DEPLOYMENT.md`

- [ ] **Step 1: `README.md` — delete the table row (currently line 243)**

Remove this row:

```
| `STORE_BACKEND` | `postgres` (or `memory` for dev) |
```

- [ ] **Step 2: `docs/constitution/DEPLOYMENT.md` — drop `STORE_BACKEND` from the env list (currently line 50)**

Change:

```
| `PORT`, `LOG_LEVEL`, `STORE_BACKEND` | API server config. |
```

to:

```
| `PORT`, `LOG_LEVEL` | API server config. |
```

---

### Task 11: Verify and commit (single commit, at end)

**Files:** none (verification + commit only)

- [ ] **Step 1: Confirm no stray references remain**

Run:

```bash
grep -rn "STORE_BACKEND\|storeBackend\|MemoryWorkflow\|MemoryNodeExecution\|MemoryEventBus\|MemoryWebhook\|MemoryHumanTask\|MemoryWorkflowTrigger\|MemoryFlow" \
  --include="*.ts" --include="*.mjs" --include="*.js" --include="*.json" --include="*.yml" --include="*.yaml" --include="*.env*" . \
  | grep -v node_modules | grep -v "docs/superpowers/"
```

Expected: **no output**. (Matches under `docs/superpowers/` — the spec/plan/historical plans — are intentionally excluded and fine.)

- [ ] **Step 2: Typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS, no errors.

- [ ] **Step 3: Import-boundary check**

Run:

```bash
npm run check:boundaries
```

Expected: PASS.

- [ ] **Step 4: Tests**

Run:

```bash
npm test
```

Expected: Only the 5 known pre-existing failures (see the deps-campaign test baseline) — **no new failures**. The deleted `memory/*.test.ts` and `webhook-wait-sweeper.integration.test.ts` no longer appear in the run.

- [ ] **Step 5: Single commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
refactor: remove in-memory store backend (postgres-only)

Delete the Memory* store classes, the STORE_BACKEND env var and the
composition useMemory toggle, the worker's MemoryEventBus fallback (replaced
by an inline no-op IEventBus so the env-only worker mode is preserved), and
the memory-only tests. PostgreSQL is now the only persistence backend.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Notes for the implementer

- **`InMemoryStepRegistry`** (`packages/orchestrator/src/registry/in-memory-step-registry.ts`) and **`InMemoryHumanTaskTimeoutService`** (`packages/api-server/src/services/human-task-timeout.ts`) are **not** store backends — they are unconditional in-process services. Do **not** touch them.
- Coverage trade-off is intentional: 5 test files are removed and the Postgres stores have no replacement unit tests. This was explicitly approved in the spec.
- Per the user's overrides: no per-task commits, no per-task test runs — verification and the single commit happen only in Task 11.
