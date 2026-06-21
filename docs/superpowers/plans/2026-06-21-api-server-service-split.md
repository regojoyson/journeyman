# api-server → 3-Service Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the monolithic `@journeyman/api-server` (~4,800 LOC) into four focused packages and run them as **three independent processes** — `api-http` (UI REST + SSE), `api-webhooks` (public webhook receiver), and `api-control-plane` (singleton background timers) — sharing one Postgres + Conductor.

**Architecture:** A thin composition root (`@journeyman/api-server`) wires concrete adapters and exposes three `cli-start-*` entrypoints. Three cluster packages (`api-http`, `api-webhooks`, `api-control-plane`) hold the route/loop logic; a shared kernel (`api-context`) holds the `Composition` contract, schemas, SSE, audit, and cross-cluster pure services. One Docker image, three commands. nginx routes `/webhooks/in/*` to the webhook service and everything else under `/api/*` to the HTTP service; the control-plane takes no ingress.

**Tech Stack:** TypeScript (NodeNext, `tsx`), Fastify 5, `pg`, npm workspaces, Conductor, Docker Compose + Kubernetes (kustomize), nginx.

---

## ⚠️ Working Agreements (override defaults)

These three constraints were set by the user and **override** the generic TDD/commit cadence in the writing-plans skill:

1. **NO commits.** Do not run `git commit`, `git add`, branch, or push at any point. Leave all changes in the working tree on the current `master` branch.
2. **Stay on `master`.** Do not create a worktree or feature branch.
3. **Typecheck at the END only.** Do not typecheck after every task. The single verification gate is **Phase 6**. (You may optionally run `npm run typecheck -w <pkg>` while debugging a specific package, but the required gate is at the end.)

Because of (1), no task below contains a commit step. Because of (3), no task contains a per-task typecheck step.

## Nature of this work

This is ~90% **mechanical relocation** (move files between packages, re-point imports) and ~10% **new wiring** (3 entrypoints, a `startControlPlane` function, a pure `buildComposition`, deploy config). Accordingly:

- For **moved files**, the task gives the exact source→destination path and the import-rewrite rule. The file's *body* is unchanged unless explicitly noted — do not reproduce it.
- For **new or changed files**, the task gives the complete content.
- The **existing test suite travels with its code** and is the regression net. The only net-new behavior worth a unit test is `startControlPlane` (Task 5.3).

## Package & file map (decided up front)

| New package | Layer | Contains |
|---|---|---|
| `@journeyman/api-context` | backend | `Composition` interface + `CompositionConfig`; `sse/sse-stream`; `schemas/*`; services: `audit`, `human-task-timeout`, `parse-duration`, `resolve-human-task`, `match-human-tasks`, `recompute-wait-status`, `engine-reconciler`, `listens-for` |
| `@journeyman/api-webhooks` | backend | routes: `webhooks` (receiver), `webhooks-management`, `webhook-presets`; services: `webhook-ingest`, `webhook-trigger-fire`, `webhook-secret-lookup`, `webhook-test-delivery`, `agent-webhook-fire`, `jsonpath`, `workflow-trigger-index` |
| `@journeyman/api-control-plane` | backend | services: `agent-scheduler`, `webhook-wait-sweeper`, `notify-on-terminal`, `notify-on-human-task-pause`, `agent-metrics`, `agent-alerts`; **new** `start-control-plane.ts` |
| `@journeyman/api-http` | backend | routes: `health`, `flows`, `agents`, `connections`, `workflow-instances`, `usage`, `human-tasks`, `forms`, `steps`, `agent-triggers`, `workflow-triggers`, `builder-apply`, `builder-chat`, `proposed-custom-steps`; services: `form-submission`, `assert-flow-ready` |
| `@journeyman/api-server` (slimmed root) | backend | `composition.ts` (pure wiring), `server-http.ts`, `server-webhooks.ts`, `cli-start-http.ts`, `cli-start-webhooks.ts`, `cli-start-control-plane.ts`, `index.ts` |

**Dependency direction (one-way):** `api-server` (root) → {`api-http`, `api-webhooks`, `api-control-plane`} → `api-context` → `@journeyman/core`, `@journeyman/identity`, `@journeyman/orchestrator`, `@journeyman/sandbox`.

> **Boundary note (be honest):** `check:boundaries` enforces *layers* (ui/backend/shared), and all five packages are `backend`, so the checker will **not** mechanically forbid a cluster importing another cluster. The one-way rule is maintained **by construction**: only the root package imports cluster packages and decides per-entrypoint registration. Reviewers should watch for accidental cluster→cluster imports; they won't fail CI automatically.

---

## Phase 0 — Scaffold the four new packages

No code moves yet. Create empty, compilable packages and register them in the workspace + boundary checker.

### Task 0.1: Create `api-context` package skeleton

**Files:**
- Create: `packages/api-context/package.json`
- Create: `packages/api-context/tsconfig.json`
- Create: `packages/api-context/src/index.ts`

- [ ] **Step 1: Write `packages/api-context/package.json`**

```json
{
  "name": "@journeyman/api-context",
  "version": "0.1.0",
  "description": "Shared kernel for the api-* services: Composition contract, schemas, SSE, audit, and cross-cluster pure services.",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "files": ["src"],
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@journeyman/core": "*",
    "@journeyman/identity": "*",
    "@journeyman/orchestrator": "*",
    "@journeyman/sandbox": "*",
    "@journeyman/agents": "*",
    "@journeyman/notification-provider": "*",
    "cron-parser": "^4.9.0",
    "fastify": "^5.8.5",
    "pg": "^8.13.0",
    "zod": "^4"
  },
  "devDependencies": {
    "@types/node": "^25.6.0",
    "@types/pg": "^8.11.10",
    "typescript": "^6.0.3",
    "vitest": "^2.0.0"
  }
}
```

> **[dry-run fix B3]** `@journeyman/agents` + `cron-parser` + `@journeyman/notification-provider` are here because `agent-scheduler.ts` and `agent-alerts.ts` now live in `api-context` (the http agents route imports `syncScheduleState`/`clearScheduleState`; the control-plane imports `startAgentScheduler` — both from the kernel).

- [ ] **Step 2: Write `packages/api-context/tsconfig.json`** (identical to `packages/analytics/tsconfig.json`)

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "allowImportingTsExtensions": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: Write a placeholder `packages/api-context/src/index.ts`** (real exports added in Phase 1)

```typescript
// Exports are populated in Phase 1 once files are relocated here.
export {};
```

### Task 0.2: Create `api-webhooks`, `api-control-plane`, `api-http` skeletons

**Files:**
- Create: `packages/api-webhooks/{package.json,tsconfig.json,src/index.ts}`
- Create: `packages/api-control-plane/{package.json,tsconfig.json,src/index.ts}`
- Create: `packages/api-http/{package.json,tsconfig.json,src/index.ts}`

- [ ] **Step 1: Write the three `tsconfig.json` files** — each is byte-identical to the `api-context` tsconfig in Task 0.1 Step 2.

- [ ] **Step 2: Write `packages/api-webhooks/package.json`**

```json
{
  "name": "@journeyman/api-webhooks",
  "version": "0.1.0",
  "description": "Public webhook ingress: receiver, ingest pipeline, trigger-fire, and webhook management routes.",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "files": ["src"],
  "scripts": { "typecheck": "tsc --noEmit", "test": "vitest run" },
  "dependencies": {
    "@journeyman/api-context": "*",
    "@journeyman/core": "*",
    "@journeyman/identity": "*",
    "@journeyman/webhooks": "*",
    "fastify": "^5.8.5",
    "pg": "^8.13.0",
    "zod": "^4"
  },
  "devDependencies": {
    "@types/node": "^25.6.0",
    "@types/pg": "^8.11.10",
    "typescript": "^6.0.3",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 3: Write `packages/api-control-plane/package.json`**

```json
{
  "name": "@journeyman/api-control-plane",
  "version": "0.1.0",
  "description": "Singleton background loops: run syncer, webhook-wait sweeper, agent scheduler, sandbox/provisioning reapers, terminal notifications & metrics.",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "files": ["src"],
  "scripts": { "typecheck": "tsc --noEmit", "test": "vitest run" },
  "dependencies": {
    "@journeyman/api-context": "*",
    "@journeyman/core": "*",
    "@journeyman/orchestrator": "*",
    "@journeyman/sandbox": "*",
    "@journeyman/notification-provider": "*",
    "pg": "^8.13.0"
  },
  "devDependencies": {
    "@types/node": "^25.6.0",
    "@types/pg": "^8.11.10",
    "typescript": "^6.0.3",
    "vitest": "^2.0.0"
  }
}
```

> The exact dependency list (e.g. whether `notification-provider`/`cron-parser` are needed) is finalized when files move in Phases 2–4; add any package that a relocated file imports and remove unused ones. The Phase 6 typecheck will surface a missing dep as a resolution error.

- [ ] **Step 4: Write `packages/api-http/package.json`**

```json
{
  "name": "@journeyman/api-http",
  "version": "0.1.0",
  "description": "Authenticated UI REST + SSE routes (flows, agents, runs, forms, human-tasks, triggers, steps).",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "files": ["src"],
  "scripts": { "typecheck": "tsc --noEmit", "test": "vitest run" },
  "dependencies": {
    "@journeyman/api-context": "*",
    "@journeyman/core": "*",
    "@journeyman/identity": "*",
    "@journeyman/agents": "*",
    "@journeyman/builder": "*",
    "@journeyman/coding-models": "*",
    "@journeyman/connections": "*",
    "@journeyman/custom-steps": "*",
    "@journeyman/git-provider": "*",
    "@journeyman/mcp": "*",
    "@journeyman/orchestrator": "*",
    "@journeyman/sandbox": "*",
    "@journeyman/skills": "*",
    "@journeyman/steps": "*",
    "@journeyman/secrets": "*",
    "fastify": "^5.8.5",
    "pg": "^8.13.0",
    "zod": "^4"
  },
  "devDependencies": {
    "@types/node": "^25.6.0",
    "@types/pg": "^8.11.10",
    "typescript": "^6.0.3",
    "vitest": "^2.0.0"
  }
}
```

> **[dry-run fix B1]** The api-http route files import these delegated packages directly (e.g. `flows.ts` → orchestrator/coding-models/custom-steps/secrets/steps; `builder-chat.ts` → builder/mcp/sandbox/skills/steps; `connections.ts` → connections/git-provider/secrets; `agents.ts` → agents). Without them the package won't typecheck.

- [ ] **Step 5: Write a placeholder `src/index.ts`** in each of the three packages:

```typescript
export {};
```

### Task 0.3: Register the new packages in the workspace & boundary checker

**Files:**
- Modify: `scripts/check-import-boundaries.mjs` (the `PACKAGE_LAYERS` map, around lines 31–52)
- Verify: root `package.json` `workspaces` glob already matches `packages/*` (it does — no edit needed)

- [ ] **Step 1: Add the four packages to `PACKAGE_LAYERS`** in `scripts/check-import-boundaries.mjs`, in the `backend` group alongside `@journeyman/api-server`:

```javascript
  "@journeyman/api-server": "backend",
  "@journeyman/api-context": "backend",
  "@journeyman/api-http": "backend",
  "@journeyman/api-webhooks": "backend",
  "@journeyman/api-control-plane": "backend",
```

- [ ] **Step 2: Install so npm links the new workspaces**

Run: `npm install`
Expected: completes without error; `node_modules/@journeyman/api-context` (and the other three) become symlinks into `packages/`.

---

## Phase 1 — Extract the shared kernel (`api-context`)

Everything else depends on this, so it moves first. The `Composition` interface moves here **minus** the `webhookWaitSweeper` field (that becomes control-plane-local; see Task 1.2).

### Task 1.1: Move shared schemas, SSE, and the audit service

**Files (move source → dest; bodies unchanged):**
- `packages/api-server/src/schemas/flow.ts` → `packages/api-context/src/schemas/flow.ts`
- `packages/api-server/src/schemas/run.ts` → `packages/api-context/src/schemas/run.ts`
- `packages/api-server/src/schemas/update-flow.ts` → `packages/api-context/src/schemas/update-flow.ts`
- `packages/api-server/src/schemas/clone-flow.ts` → `packages/api-context/src/schemas/clone-flow.ts`
- `packages/api-server/src/sse/sse-stream.ts` → `packages/api-context/src/sse/sse-stream.ts`
- `packages/api-server/src/services/audit.ts` → `packages/api-context/src/services/audit.ts`
- `packages/api-server/src/services/audit.test.ts` → `packages/api-context/src/services/audit.test.ts`

- [ ] **Step 1: `git mv` each file** to its destination (using `git mv` keeps history; it does **not** create a commit). Example:

```bash
mkdir -p packages/api-context/src/schemas packages/api-context/src/sse packages/api-context/src/services
git mv packages/api-server/src/schemas/flow.ts packages/api-context/src/schemas/flow.ts
git mv packages/api-server/src/schemas/run.ts packages/api-context/src/schemas/run.ts
git mv packages/api-server/src/schemas/update-flow.ts packages/api-context/src/schemas/update-flow.ts
git mv packages/api-server/src/schemas/clone-flow.ts packages/api-context/src/schemas/clone-flow.ts
git mv packages/api-server/src/sse/sse-stream.ts packages/api-context/src/sse/sse-stream.ts
git mv packages/api-server/src/services/audit.ts packages/api-context/src/services/audit.ts
git mv packages/api-server/src/services/audit.test.ts packages/api-context/src/services/audit.test.ts
```

- [ ] **Step 2: Fix internal relative imports** inside the moved files. These files import only from `@journeyman/core` / `zod` / each other, so relative paths between two files that *both* moved (same folder) stay valid. No `../composition.ts` references exist in these. (If `tsc` later flags one, repoint it per the rule in Task 1.4 Step 2.)

### Task 1.2: Move the `Composition` interface into `api-context` (minus `webhookWaitSweeper`)

**Files:**
- Create: `packages/api-context/src/composition-types.ts`
- Modify (later, Phase 5): `packages/api-server/src/composition.ts` will import this type instead of declaring it.

- [ ] **Step 1: Create `packages/api-context/src/composition-types.ts`** with the interface lifted from `composition.ts` lines 56–84, **dropping the `webhookWaitSweeper` field** and importing the human-task-timeout interface from its new location (Task 1.3):

```typescript
import type { Pool } from "pg";
import type { FastifyRequest } from "fastify"; // re-exported indirectly; kept for parity if needed
import type {
  IAuthProvider, IConditionEvaluator, IEventBus,
  IWorkflowStore, IWorkflowVersionStore, INodeExecutionStore, IOrchestratorEngine,
  IStepRegistry, IWorkflowInstanceStore, IWebhookEventStore, IWebhookStore, IWorkflowTriggerStore,
} from "@journeyman/core";
import type { ConductorClient, IHumanTaskResolutionStore } from "@journeyman/orchestrator";
import type { SandboxInstanceRoutesDeps } from "@journeyman/sandbox";
import type { HumanTaskTimeoutService } from "./services/human-task-timeout.ts";

export interface Composition {
  workflows: IWorkflowStore;
  workflowVersions: IWorkflowVersionStore;
  workflowInstances: IWorkflowInstanceStore;
  nodeExecutions: INodeExecutionStore;
  events: IEventBus;
  webhookEvents: IWebhookEventStore;
  webhooks: IWebhookStore;
  workflowTriggers: IWorkflowTriggerStore;
  humanTaskResolutions: IHumanTaskResolutionStore;
  humanTaskTimeouts: HumanTaskTimeoutService;
  conductorClient: ConductorClient;
  orchestrator: IOrchestratorEngine;
  registry: IStepRegistry;
  auth: IAuthProvider;
  conditions: IConditionEvaluator;
  /** The pg Pool (null when using the memory backend). */
  pool: Pool | null;
  /** Deps for the manual sandbox-cleanup routes (null when no pool). */
  sandboxInstanceRoutesDeps?: SandboxInstanceRoutesDeps;
  /** Closed when the server shuts down. */
  shutdown: () => Promise<void>;
}

export interface CompositionConfig {
  databaseUrl: string;
  conductorBaseUrl: string;
}
```

> **Why drop `webhookWaitSweeper`:** grep confirms no route reads it; it's only `.start()`-ed and used by its own fire-handler. Keeping it on the shared interface would force `api-context` to import `api-control-plane` (where the sweeper now lives) → an import cycle. The sweeper becomes a local inside `startControlPlane` (Task 5.3).

- [ ] **Step 2: Confirm no route reads `webhookWaitSweeper`** before relying on its removal:

Run: `grep -rn "webhookWaitSweeper" packages/api-server/src/routes`
Expected: **no output**. (If any line appears, that route must be reworked; stop and flag it.)

### Task 1.3: Move the cross-cluster pure services

**Files (move source → dest; `.test.ts` siblings move with them):**
- `services/human-task-timeout.ts` → `packages/api-context/src/services/human-task-timeout.ts`
- `services/parse-duration.ts` (+ `parse-duration.test.ts`) → `packages/api-context/src/services/`
- `services/resolve-human-task.ts` (+ `resolve-human-task.first-wins.test.ts`) → `packages/api-context/src/services/`
- `services/match-human-tasks.ts` (+ `match-human-tasks.gate.test.ts`) → `packages/api-context/src/services/`
- `services/recompute-wait-status.ts` (+ `recompute-wait-status.test.ts`) → `packages/api-context/src/services/`
- `services/engine-reconciler.ts` (+ `engine-reconciler.status.test.ts`) → `packages/api-context/src/services/`
- `services/listens-for.ts` (+ `listens-for.test.ts`) → `packages/api-context/src/services/`
- **[dry-run fix B3]** `services/agent-scheduler.ts` (+ `agent-scheduler.test.ts`) → `packages/api-context/src/services/` — it's shared (http route helpers + control-plane loop).
- **[dry-run fix B3]** `services/agent-alerts.ts` (+ `agent-alerts.test.ts`) → `packages/api-context/src/services/` — `agent-scheduler.ts` imports it as a sibling.

- [ ] **Step 1: `git mv` each file and its test** into `packages/api-context/src/services/`.

- [ ] **Step 2: Repoint imports inside the moved services.** Within `api-context`, sibling imports (`./match-human-tasks.ts`, `./recompute-wait-status.ts`, `./human-task-timeout.ts`) stay relative. Any import of the `Composition` type changes to `from "../composition-types.ts"`. Any `applyFirstWinsCancellation` import stays `from "@journeyman/orchestrator"`.

For example, in `resolve-human-task.ts` the type import becomes:

```typescript
import type { Composition } from "../composition-types.ts";
```

### Task 1.4: Populate `api-context` barrel exports and repoint api-server's internal references

**Files:**
- Modify: `packages/api-context/src/index.ts`
- Modify: every remaining `packages/api-server/src/**` file that imported a now-moved file.

- [ ] **Step 1: Write `packages/api-context/src/index.ts`**

**[dry-run fix B5]** Exact export names were verified against source — use these verbatim:

```typescript
export type { Composition, CompositionConfig } from "./composition-types.ts";
export type { HumanTaskTimeoutService } from "./services/human-task-timeout.ts";
export { InMemoryHumanTaskTimeoutService } from "./services/human-task-timeout.ts";
export { openSseStream, type SseStream } from "./sse/sse-stream.ts";
export { audit, listAudit, type AuditEntryInput, type AuditEntry } from "./services/audit.ts";
export { parseDurationMs } from "./services/parse-duration.ts";
export {
  resolveHumanTask, HumanTaskNotWaitingError, HumanTaskMissingValueError,
  type ResolveSource, type ResolveHumanTaskInput,
} from "./services/resolve-human-task.ts";
export {
  matchAndResolveWebhookWaits,
  type WebhookEventInfo, type WaitOutcome, type MatchResult,
} from "./services/match-human-tasks.ts";
export { recomputeWaitStatus } from "./services/recompute-wait-status.ts";
export { reconcileWorkflowInstance, type ReconcileResult } from "./services/engine-reconciler.ts";
export { eventPassesListensFor } from "./services/listens-for.ts";
// agent scheduling (shared: http route helpers + control-plane loop)
export {
  nextRun, syncScheduleState, clearScheduleState, tickOnce, startAgentScheduler,
} from "./services/agent-scheduler.ts";
export { evaluateAlerts } from "./services/agent-alerts.ts";
export * as flowSchemas from "./schemas/flow.ts";
export * as runSchemas from "./schemas/run.ts";
export * from "./schemas/update-flow.ts";
export * from "./schemas/clone-flow.ts";
```

> If `agent-alerts.ts` exports a different/additional symbol than `evaluateAlerts`, match it to source. Every symbol api-server previously imported via `./services/x.ts` or `./schemas/x.ts` must be re-exported here.

- [ ] **Step 2: Repoint references across the still-in-place api-server files.** For each remaining file under `packages/api-server/src` that imported a moved file, replace the relative import with the package import. Find them:

Run: `grep -rln "schemas/\|sse/sse-stream\|services/audit\|services/parse-duration\|services/resolve-human-task\|services/match-human-tasks\|services/recompute-wait-status\|services/engine-reconciler\|services/listens-for\|services/human-task-timeout" packages/api-server/src`

Then in each hit, replace e.g. `import { resolveHumanTask } from "../services/resolve-human-task.ts";` with `import { resolveHumanTask } from "@journeyman/api-context";`. The `Composition` type import (currently `from "./composition.ts"`) is handled in Phase 5.

---

## Phase 2 — Extract the webhook package (`api-webhooks`)

### Task 2.1: Move webhook routes and services

**Files (move source → dest; `.test.ts` siblings move too):**
- `routes/webhooks.ts` → `packages/api-webhooks/src/routes/webhooks.ts`
- `routes/webhooks-management.ts` → `packages/api-webhooks/src/routes/webhooks-management.ts`
- `routes/webhook-presets.ts` → `packages/api-webhooks/src/routes/webhook-presets.ts`
- `services/webhook-ingest.ts` → `packages/api-webhooks/src/services/webhook-ingest.ts`
- `services/webhook-trigger-fire.ts` (+ `webhook-trigger-fire.isolation.test.ts`) → `packages/api-webhooks/src/services/`
- `services/webhook-secret-lookup.ts` → `packages/api-webhooks/src/services/`
- `services/webhook-test-delivery.ts` (+ `webhook-test-delivery.eventtype.test.ts`) → `packages/api-webhooks/src/services/`
- `services/agent-webhook-fire.ts` (+ `agent-webhook-fire.test.ts`) → `packages/api-webhooks/src/services/`
- `services/jsonpath.ts` (+ `jsonpath.test.ts`) → `packages/api-webhooks/src/services/`
- **[dry-run fix B2]** `services/workflow-trigger-index.ts` does **NOT** belong here — its only importer is `routes/flows.ts` (api-http). It moves to `api-http` in Task 4.1, not here.
- `routes/flows.webhook-required-mapping.test.ts` → **stays with flows** (Phase 4, api-http) — do **not** move here.

- [ ] **Step 1: `git mv` each file/test** into the matching `packages/api-webhooks/src/{routes,services}/` folder.

- [ ] **Step 2: Repoint imports in moved files.**
  - `Composition` type → `import type { Composition } from "@journeyman/api-context";`
  - Any shared service (`resolveHumanTask`, `recomputeWaitStatus`, `parseDurationMs`, `listensFor`, `matchHumanTasks`, `recordAudit`) → `from "@journeyman/api-context";`
  - Sibling webhook services (`./webhook-ingest.ts`, `./jsonpath.ts`, `./workflow-trigger-index.ts`, etc.) → stay relative.
  - `@journeyman/webhooks`, `@journeyman/core`, `@journeyman/identity` → unchanged.

### Task 2.2: Write `api-webhooks` barrel exports

**Files:**
- Modify: `packages/api-webhooks/src/index.ts`

- [ ] **Step 1: Write `packages/api-webhooks/src/index.ts`** exposing the three route registrars separately (so the root can register the public receiver and the management routes in *different* services):

```typescript
// Public, unauthenticated inbound receiver — POST /webhooks/in/:tenantToken.
// Registered ONLY by the api-webhooks service entrypoint.
export { registerWebhookRoutes } from "./routes/webhooks.ts";

// Authenticated UI management — paths under /api/...; registered by the api-http
// service entrypoint (they share the /api prefix with the rest of the UI API).
export { registerWebhookManagementRoutes } from "./routes/webhooks-management.ts";
export { registerWebhookPresetRoutes } from "./routes/webhook-presets.ts";
```

> **[dry-run fix]** Only the three route registrars need exporting — the webhook *services* (`fireWebhookTriggers`, `resolveWebhookSecret`, etc.) are imported by `webhook-ingest.ts` as in-package siblings, so they don't go in the barrel. Note `webhook-ingest.ts` and `webhook-trigger-fire.ts` import `matchAndResolveWebhookWaits` / `WaitOutcome` / `eventPassesListensFor` from `@journeyman/api-context` (repoint those in Task 2.1 Step 2).

---

## Phase 3 — Extract the control-plane package (`api-control-plane`)

### Task 3.1: Move the background-loop services

**Files (move source → dest; tests too):**
- `services/webhook-wait-sweeper.ts` (+ `webhook-wait-sweeper.test.ts`) → `packages/api-control-plane/src/services/`
- `services/notify-on-terminal.ts` (+ `notify-on-terminal.test.ts`) → `packages/api-control-plane/src/services/`
- `services/agent-metrics.ts` (+ `agent-metrics.test.ts`) → `packages/api-control-plane/src/services/`
- **[dry-run fix B3]** `agent-scheduler.ts` and `agent-alerts.ts` do **NOT** move here — they went to `api-context` (Task 1.3) because the http agents route needs them. The control-plane imports `startAgentScheduler` from `@journeyman/api-context`.
- **[dry-run note]** `services/notify-on-human-task-pause.ts` has **no static importer** (verify with `grep -rn "notify-on-human-task-pause" packages/api-server/src`). If truly unused, leave it in place / delete it rather than moving it. If a dynamic caller exists, move it here.

- [ ] **Step 1: `git mv` each file/test** into `packages/api-control-plane/src/services/`.

- [ ] **Step 2: Repoint imports in moved files.**
  - `Composition` type, `parseDurationMs`, `resolveHumanTask`, `recomputeWaitStatus` → `from "@journeyman/api-context";`
  - `WebhookWaitSweeper` references its own siblings relatively.
  - Concrete adapters (`@journeyman/orchestrator`, `@journeyman/sandbox`, `@journeyman/notification-provider`) → unchanged.

### Task 3.2: Write `api-control-plane` barrel exports (partial — `startControlPlane` added in Phase 5)

**Files:**
- Modify: `packages/api-control-plane/src/index.ts`

- [ ] **Step 1: Write `packages/api-control-plane/src/index.ts`**

```typescript
export { WebhookWaitSweeper } from "./services/webhook-wait-sweeper.ts";
export { makeNotifyOnTerminal } from "./services/notify-on-terminal.ts";
export { makeRecordTerminalMetrics } from "./services/agent-metrics.ts";
// startControlPlane is added in Task 5.3.
```

> **[dry-run fix B3]** `startAgentScheduler` is **not** exported here — it lives in `@journeyman/api-context`. `start-control-plane.ts` imports it from there (see Task 5.3).

---

## Phase 4 — Extract the HTTP package (`api-http`)

### Task 4.1: Move UI routes and their two local services

**Files (move source → dest; tests too):**
- `routes/health.ts`, `routes/flows.ts` (+ `flows.webhook-required-mapping.test.ts`), `routes/agents.ts`, `routes/connections.ts`, `routes/workflow-instances.ts`, `routes/usage.ts`, `routes/human-tasks.ts`, `routes/forms.ts`, `routes/steps.ts`, `routes/agent-triggers.ts`, `routes/workflow-triggers.ts`, `routes/builder-apply.ts`, `routes/builder-chat.ts`, `routes/proposed-custom-steps.ts` (+ `proposed-custom-steps.test.ts`) → `packages/api-http/src/routes/`
- `services/form-submission.ts` → `packages/api-http/src/services/`
- `services/assert-flow-ready.ts` → `packages/api-http/src/services/`
- **[dry-run fix B2]** `services/workflow-trigger-index.ts` → `packages/api-http/src/services/` (only `flows.ts` imports it; self-contained — core/pg only).
- **[dry-run note]** `routes/proposed-custom-steps.ts` is **not** an HTTP route — it exports the pure helper `shapesFromProposedSteps` (used by `flows.ts`). Move it (it's fine under `routes/` for minimal churn, or rename to `services/`), but do **not** register it as a route (see Task 4.2).

- [ ] **Step 1: `git mv` each file/test** into `packages/api-http/src/{routes,services}/`.

- [ ] **Step 2: Repoint imports in moved files.**
  - `Composition` type → `from "@journeyman/api-context";`
  - shared services + schemas + `sseStream` + `recordAudit` → `from "@journeyman/api-context";`
  - `makeRequireAuth`, `makeRequireWorkspacePermission` → stay `from "@journeyman/identity";`
  - sibling services (`./form-submission.ts`, `./assert-flow-ready.ts`) → relative.
  - `registerStepsRoutes` etc. unchanged in signature.

### Task 4.2: Write `api-http` barrel exports

**Files:**
- Modify: `packages/api-http/src/index.ts`

- [ ] **Step 1: Write `packages/api-http/src/index.ts`** re-exporting every registrar the HTTP entrypoint needs:

```typescript
export { registerHealthRoutes } from "./routes/health.ts";
export { registerWorkflowRoutes } from "./routes/flows.ts";
export { registerAgentRoutes } from "./routes/agents.ts";
export { registerConnectionRoutes } from "./routes/connections.ts";
export { registerWorkflowInstanceRoutes } from "./routes/workflow-instances.ts";
export { registerUsageRoutes } from "./routes/usage.ts";
export { registerHumanTaskRoutes } from "./routes/human-tasks.ts";
export { registerFormRoutes } from "./routes/forms.ts";
export { registerStepsRoutes } from "./routes/steps.ts";
export { registerAgentTriggerRoutes } from "./routes/agent-triggers.ts";
export { registerWorkflowTriggersRoute } from "./routes/workflow-triggers.ts";
export { registerBuilderApplyRoute } from "./routes/builder-apply.ts";
export { registerBuilderChatRoute } from "./routes/builder-chat.ts";
```

> Names verified against source — use as-is. **[dry-run note]** Do **not** add a `proposed-custom-steps` registrar — it has none; `flows.ts` imports `shapesFromProposedSteps` from it as an in-package sibling, so no barrel entry is needed.

---

## Phase 5 — Slim the root: pure composition, control-plane lifecycle, three entrypoints

After Phases 1–4, `packages/api-server/src` should contain only `composition.ts`, `server.ts`, `cli-start.ts`, `index.ts`. This phase rewrites them.

### Task 5.1: Make `buildComposition` pure (start no loops)

**Files:**
- Modify: `packages/api-server/src/composition.ts`

The current `buildComposition` (lines 86–263) **starts** the `SandboxInstanceReaper` and `ProvisioningReaper` and constructs the `WebhookWaitSweeper`. Move all loop *starting* out; keep only construction of stores, orchestrator, teardown helpers, and the `sandboxInstanceRoutesDeps` (still needed by the HTTP manual-cleanup route).

- [ ] **Step 1: Edit `composition.ts`** — apply these changes:
  1. Replace the local `interface Composition {…}` / `interface CompositionConfig {…}` declarations with an import:
     ```typescript
     import type { Composition, CompositionConfig } from "@journeyman/api-context";
     import { InMemoryHumanTaskTimeoutService } from "@journeyman/api-context";
     ```
  2. **Delete** the `reaperStop` / `provisioningReaperStop` blocks (current lines ~160–184) and the `SandboxInstanceReaper` / `ProvisioningReaper` imports — these move to `startControlPlane`.
  3. **Delete** the `webhookWaitSweeper` assignment block (current lines ~227–260) and the `WebhookWaitSweeper` import — moves to `startControlPlane`.
  4. Keep `teardownRegistry`, `destroyByType`, `isRunActive`, `logRun`, `sandboxProvisioner` (no-op), `sandboxReaper`, and `sandboxInstanceRoutesDeps` — the orchestrator and the HTTP cleanup route still need them.
  5. Simplify `shutdown` to just close the pool: `shutdown: async () => { if (pool) await pool.end(); }`.
  6. Remove `webhookWaitSweeper` from the returned `composition` object literal.
  7. **[dry-run fix B4]** Repoint the terminal-callback imports — `makeNotifyOnTerminal` (was `./services/notify-on-terminal.ts`) and `makeRecordTerminalMetrics` (was `./services/agent-metrics.ts`) now come from `@journeyman/api-control-plane`:
     ```typescript
     import { makeNotifyOnTerminal, makeRecordTerminalMetrics } from "@journeyman/api-control-plane";
     ```
     Keep the existing `notifyOnTerminal` wiring into the orchestrator (lines ~193–204) intact — only the import source changes. (These callbacks fire only where the syncer runs, i.e. the control-plane process, but wiring them everywhere is harmless.)

- [ ] **Step 2: Export the reaper/sweeper building blocks `startControlPlane` will need.** `buildComposition` already exposes `pool`, `orchestrator`, `events`, `workflowInstances`, and `sandboxInstanceRoutesDeps` (which carries `destroy` + `isRunActive`) on the `Composition`. `startControlPlane` rebuilds `listActive`/`markDestroyed`/`findStuck` from `pool`. No extra exports needed beyond what the (now pure) `Composition` already carries. Verify by reading `startControlPlane` (Task 5.3) against the `Composition` fields.

### Task 5.2: Split `server.ts` into `server-http.ts` and `server-webhooks.ts`

**Files:**
- Create: `packages/api-server/src/server-http.ts`
- Create: `packages/api-server/src/server-webhooks.ts`
- Delete: `packages/api-server/src/server.ts` (after the two builders replace it)

- [ ] **Step 1: Write `packages/api-server/src/server-http.ts`** — the UI API + all delegated routes + webhook **management** routes, but **no** `startAgentScheduler` and **no** webhook receiver:

```typescript
import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import sensible from "@fastify/sensible";
import { ZodError } from "zod";
import type { Composition } from "@journeyman/api-context";
import {
  registerHealthRoutes, registerWorkflowRoutes, registerAgentRoutes,
  registerConnectionRoutes, registerWorkflowInstanceRoutes, registerUsageRoutes,
  registerHumanTaskRoutes, registerFormRoutes, registerStepsRoutes,
  registerAgentTriggerRoutes, registerWorkflowTriggersRoute,
  registerBuilderApplyRoute, registerBuilderChatRoute,
} from "@journeyman/api-http";
import { registerWebhookManagementRoutes, registerWebhookPresetRoutes } from "@journeyman/api-webhooks";
import { registerIdentityRoutes } from "@journeyman/identity";
import { registerSecretsRoutes } from "@journeyman/secrets";
import { registerMcpRoutes } from "@journeyman/mcp";
import { registerBuilderRoutes } from "@journeyman/builder";
import { registerSandboxRoutes, registerSandboxInstanceRoutes } from "@journeyman/sandbox";
import { registerSkillRoutes } from "@journeyman/skills";
import { registerCustomStepRoutes } from "@journeyman/custom-steps";
import { registerCodingModelRoutes } from "@journeyman/coding-models";

export async function buildHttpServer(c: Composition): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" } });
  await app.register(cors, { origin: true, credentials: true });
  await app.register(sensible);
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) { reply.code(400).send({ error: "bad_request", issues: err.issues }); return; }
    reply.send(err);
  });

  registerHealthRoutes(app);
  await registerIdentityRoutes(app, c.pool!);
  if (c.pool) {
    await registerSecretsRoutes(app, c.pool);
    await registerMcpRoutes(app, c.pool);
    await registerBuilderRoutes(app, c.pool);
    await registerSandboxRoutes(app, c.pool);
    if (c.sandboxInstanceRoutesDeps) await registerSandboxInstanceRoutes(app, c.pool, c.sandboxInstanceRoutesDeps);
    await registerSkillRoutes(app, c.pool);
    await registerCustomStepRoutes(app, c.pool);
    await registerCodingModelRoutes(app, c.pool);
    registerAgentRoutes(app, c);
    await app.register(async (s) => registerConnectionRoutes(s, c), { prefix: "/api" });
    registerAgentTriggerRoutes(app, c);
    registerWebhookPresetRoutes(app, c);
  }
  registerStepsRoutes(app);
  if (c.pool) registerWebhookManagementRoutes(app, c);
  await app.register(async (s) => {
    registerWorkflowRoutes(s, c);
    registerWorkflowInstanceRoutes(s, c);
    registerUsageRoutes(s, c);
    registerHumanTaskRoutes(s, c);
    registerFormRoutes(s, c);
    registerWorkflowTriggersRoute(s, c);
    registerBuilderApplyRoute(s, c);
    registerBuilderChatRoute(s, c);
  }, { prefix: "/api" });

  return app;
}
```

> Preserve the **exact** prefix/mount semantics from the original `server.ts` (the `/api` prefix wrappers and the inline-`/api` connection routes). The only deletions vs. the original are: the webhook **receiver** registration (`registerWebhookRoutes`) and the `startAgentScheduler` call — both move elsewhere.

- [ ] **Step 2: Write `packages/api-server/src/server-webhooks.ts`** — only the public receiver + health:

```typescript
import Fastify, { type FastifyInstance } from "fastify";
import sensible from "@fastify/sensible";
import { ZodError } from "zod";
import type { Composition } from "@journeyman/api-context";
import { registerHealthRoutes } from "@journeyman/api-http";
import { registerWebhookRoutes } from "@journeyman/api-webhooks";

export async function buildWebhookServer(c: Composition): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" } });
  await app.register(sensible);
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) { reply.code(400).send({ error: "bad_request", issues: err.issues }); return; }
    reply.send(err);
  });
  registerHealthRoutes(app);            // GET /healthz for container probes
  registerWebhookRoutes(app, c);        // POST /webhooks/in/:tenantToken
  return app;
}
```

- [ ] **Step 3: Delete the old `server.ts`**: `git rm packages/api-server/src/server.ts`.

### Task 5.3: Create `startControlPlane` in `api-control-plane`

**Files:**
- Create: `packages/api-control-plane/src/start-control-plane.ts`
- Create: `packages/api-control-plane/src/start-control-plane.test.ts`
- Modify: `packages/api-control-plane/src/index.ts` (export it)

This consolidates **every** background loop. It receives the (pure) `Composition` plus a `reconcilePaused` callback (engine-reconciler lives in api-context; the root passes it to avoid a control-plane→reconciler-from-context confusion — actually it's already in api-context, so import directly).

- [ ] **Step 1: Write the failing test `packages/api-control-plane/src/start-control-plane.test.ts`**

```typescript
import { describe, it, expect, vi } from "vitest";
import { startControlPlane } from "./start-control-plane.ts";

function fakeComposition() {
  return {
    pool: { query: vi.fn().mockResolvedValue({ rows: [] }), end: vi.fn() },
    orchestrator: {},
    events: { append: vi.fn().mockResolvedValue(undefined) },
    workflowInstances: { getById: vi.fn(), setStatus: vi.fn(), listByStatus: vi.fn().mockResolvedValue([]) },
    nodeExecutions: {},
    humanTaskTimeouts: { schedule: vi.fn(), cancel: vi.fn(), cancelAllForRun: vi.fn() },
    sandboxInstanceRoutesDeps: { destroy: vi.fn(), isRunActive: vi.fn().mockResolvedValue(false) },
  } as any;
}

describe("startControlPlane", () => {
  it("returns a stop() that is safe to call and stops all loops", () => {
    const c = fakeComposition();
    const stop = startControlPlane(c);
    expect(typeof stop).toBe("function");
    expect(() => stop()).not.toThrow();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test -w @journeyman/api-control-plane -- start-control-plane`
Expected: FAIL — `startControlPlane is not a function` / module not found.

- [ ] **Step 3: Write `packages/api-control-plane/src/start-control-plane.ts`** — lifting the loop construction that previously lived in `composition.ts` (reapers) + `server.ts` (scheduler) + `cli-start.ts` (syncer + sweeper):

```typescript
import type { Composition } from "@journeyman/api-context";
import { parseDurationMs, reconcileWorkflowInstance, resolveHumanTask } from "@journeyman/api-context";
import type { WorkflowInstanceStatus } from "@journeyman/core";
import {
  WorkflowInstanceSyncer, SandboxInstanceReaper as _unused, // see note
  ProvisioningReaper, findStuckProvisioningRuns,
} from "@journeyman/orchestrator";
import {
  SandboxInstanceReaper, getSandboxInstance, markSandboxInstanceDestroyed,
  listActiveSandboxInstances,
} from "@journeyman/sandbox";
import { startAgentScheduler } from "@journeyman/api-context"; // [dry-run fix B3] scheduler lives in the kernel
import { WebhookWaitSweeper } from "./services/webhook-wait-sweeper.ts";

/**
 * Starts every background/control-plane loop. MUST run in exactly ONE process
 * (the api-control-plane service). Returns a stop() that halts all loops.
 */
export function startControlPlane(c: Composition): () => void {
  const stops: Array<() => void> = [];

  // 1. Run-status syncer (Conductor → DB) + paused-run reconciliation.
  const syncer = new WorkflowInstanceSyncer({
    workflowInstances: c.workflowInstances,
    orchestrator: c.orchestrator,
    events: c.events,
    intervalMs: Number(process.env.RUN_SYNC_INTERVAL_MS ?? 1500),
    reconcilePaused: (id) => reconcileWorkflowInstance(c, id).then(() => undefined),
  });
  syncer.start();
  stops.push(() => syncer.stop());

  // 2. Webhook-wait max-age sweeper.
  const maxAgeStr = (process.env.JOURNEYMAN_WEBHOOK_WAIT_MAX_AGE ?? "30d").trim();
  const intervalStr = (process.env.JOURNEYMAN_WEBHOOK_WAIT_SWEEP_INTERVAL ?? "5m").trim();
  const sweeperDisabled = maxAgeStr === "" || maxAgeStr.toLowerCase() === "off";
  const maxAgeMs = sweeperDisabled ? 0 : parseDurationMs(maxAgeStr);
  if (!sweeperDisabled && maxAgeMs === 0) {
    throw new Error(`Invalid JOURNEYMAN_WEBHOOK_WAIT_MAX_AGE: "${maxAgeStr}". Use "30d", "12h", "90m", or "off".`);
  }
  const intervalMs = parseDurationMs(intervalStr) || 5 * 60_000;
  const sweeper = new WebhookWaitSweeper({
    maxAgeMs, intervalMs, batchSize: 500,
    nodeExecutions: c.nodeExecutions, workflowInstances: c.workflowInstances,
    fire: async ({ workflowInstanceId, nodeId, defaults }) => {
      try {
        await resolveHumanTask(c, {
          workflowInstanceId, nodeId, values: defaults, payload: {},
          actor: null, source: "timeout", resolvedBy: "max_age_sweep",
        });
      } catch { /* already resolved or cancelled — not an error */ }
    },
  });
  sweeper.start();
  stops.push(() => sweeper.stop());

  // 3. Scheduled-agent firing.
  const schedulerStop = startAgentScheduler(c.pool!, { orchestrator: c.orchestrator });
  if (typeof schedulerStop === "function") stops.push(schedulerStop);

  // 4. Sandbox-instance reaper.
  if (c.pool) {
    const reaper = new SandboxInstanceReaper({
      listActive: () => listActiveSandboxInstances(c.pool!),
      isRunActive: c.sandboxInstanceRoutesDeps!.isRunActive,
      destroy: c.sandboxInstanceRoutesDeps!.destroy,
      markDestroyed: (id) => markSandboxInstanceDestroyed(c.pool!, id),
    });
    stops.push(reaper.start(Number(process.env.SANDBOX_REAP_INTERVAL_MS ?? 60_000)));

    // 5. Stuck-provisioning reaper.
    const PROVISION_TIMEOUT_MS = Number(process.env.PROVISION_TIMEOUT_MS ?? 600_000);
    const provisioningReaper = new ProvisioningReaper({
      findStuck: () => findStuckProvisioningRuns(c.pool!, PROVISION_TIMEOUT_MS),
      failRun: async (id: string) => {
        await c.events.append({ workflowInstanceId: id, eventType: "step.log",
          payload: { line: "Run failed: sandbox provisioning timed out" } }).catch(() => undefined);
        await c.workflowInstances.setStatus(id, "failed" as WorkflowInstanceStatus, { completedAt: new Date() });
      },
    });
    stops.push(provisioningReaper.start(Number(process.env.PROVISION_REAP_INTERVAL_MS ?? 60_000)));
  }

  return () => { for (const s of stops) { try { s(); } catch { /* idempotent */ } } };
}
```

> **Reconcile the imports with reality:** open the original `composition.ts` and `cli-start.ts` and copy the *exact* `SandboxInstanceReaper`/`ProvisioningReaper`/`WorkflowInstanceSyncer` import sources and constructor option names. The placeholder `_unused` import line above is a reminder to **remove** the wrong-source import — `SandboxInstanceReaper` comes from `@journeyman/sandbox`, `ProvisioningReaper`/`findStuckProvisioningRuns`/`WorkflowInstanceSyncer` from `@journeyman/orchestrator` (per the original `composition.ts` import block). Delete the `_unused` alias before finishing.

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npm test -w @journeyman/api-control-plane -- start-control-plane`
Expected: PASS.

- [ ] **Step 5: Export it** — add to `packages/api-control-plane/src/index.ts`:

```typescript
export { startControlPlane } from "./start-control-plane.ts";
```

### Task 5.4: Write the three entrypoints + root `index.ts`

**Files:**
- Create: `packages/api-server/src/cli-start-http.ts`
- Create: `packages/api-server/src/cli-start-webhooks.ts`
- Create: `packages/api-server/src/cli-start-control-plane.ts`
- Delete: `packages/api-server/src/cli-start.ts`
- Modify: `packages/api-server/src/index.ts`

All three reuse the same `.env`-discovery block as the old `cli-start.ts` (and `analytics/cli-start.ts`) — this is required so they pick up `JWT_SECRET`/`DATABASE_URL`/`CONDUCTOR_BASE_URL` in local dev.

- [ ] **Step 1: Write `packages/api-server/src/_env.ts`** (shared `.env` loader, lifted verbatim from the old `cli-start.ts` `findEnvFile`):

```typescript
import { config as loadDotenv } from "dotenv";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function findEnvFile(): string | null {
  const candidates: string[] = [];
  const seen = new Set<string>();
  for (const start of [process.cwd(), dirname(fileURLToPath(import.meta.url))]) {
    let dir = start;
    while (true) {
      if (!seen.has(dir)) { seen.add(dir); candidates.push(resolve(dir, ".env")); }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return candidates.find((p) => existsSync(p)) ?? null;
}

export function loadEnv(): void {
  const envFile = findEnvFile();
  if (envFile) loadDotenv({ path: envFile, override: false });
}

export function compositionConfig() {
  return {
    databaseUrl: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5433/journeyman",
    conductorBaseUrl: process.env.CONDUCTOR_BASE_URL ?? "http://localhost:8080/api",
  };
}
```

- [ ] **Step 2: Write `packages/api-server/src/cli-start-http.ts`**

```typescript
#!/usr/bin/env node
import { createLogger } from "@journeyman/core";
import { loadEnv, compositionConfig } from "./_env.ts";
import { buildComposition } from "./composition.ts";
import { buildHttpServer } from "./server-http.ts";

const log = createLogger("api-http:cli");
loadEnv();

const composition = buildComposition(compositionConfig());
const server = await buildHttpServer(composition);
const port = Number(process.env.PORT ?? 4000);
await server.listen({ port, host: "0.0.0.0" });
log.info({ port }, "api-http listening");

const shutdown = async () => { await server.close(); await composition.shutdown(); process.exit(0); };
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
```

- [ ] **Step 3: Write `packages/api-server/src/cli-start-webhooks.ts`**

```typescript
#!/usr/bin/env node
import { createLogger } from "@journeyman/core";
import { loadEnv, compositionConfig } from "./_env.ts";
import { buildComposition } from "./composition.ts";
import { buildWebhookServer } from "./server-webhooks.ts";

const log = createLogger("api-webhooks:cli");
loadEnv();

const composition = buildComposition(compositionConfig());
const server = await buildWebhookServer(composition);
// Dedicated default port so it doesn't collide with api-http's PORT=4000
// when both read the same env (k8s configMap / .env set PORT=4000).
const port = Number(process.env.WEBHOOKS_PORT ?? 4001);
await server.listen({ port, host: "0.0.0.0" });
log.info({ port }, "api-webhooks listening");

const shutdown = async () => { await server.close(); await composition.shutdown(); process.exit(0); };
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
```

- [ ] **Step 4: Write `packages/api-server/src/cli-start-control-plane.ts`** (starts loops; tiny health server for k8s probes)

```typescript
#!/usr/bin/env node
import Fastify from "fastify";
import { createLogger } from "@journeyman/core";
import { startControlPlane } from "@journeyman/api-control-plane";
import { loadEnv, compositionConfig } from "./_env.ts";
import { buildComposition } from "./composition.ts";

const log = createLogger("api-control-plane:cli");
loadEnv();

const composition = buildComposition(compositionConfig());
const stopLoops = startControlPlane(composition);

// Health-only server so k8s readiness/liveness has a port to probe.
const health = Fastify({ logger: false });
health.get("/healthz", async () => ({ ok: true }));
const port = Number(process.env.CONTROL_PLANE_PORT ?? 4003);
await health.listen({ port, host: "0.0.0.0" });
log.info({ port }, "api-control-plane running (health on :" + port + ")");

const shutdown = async () => { stopLoops(); await health.close(); await composition.shutdown(); process.exit(0); };
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
```

- [ ] **Step 5: Delete the old entrypoint** and rewrite the barrel:

```bash
git rm packages/api-server/src/cli-start.ts
```

`packages/api-server/src/index.ts`:

```typescript
export { buildComposition } from "./composition.ts";
export type { Composition, CompositionConfig } from "@journeyman/api-context";
export { buildHttpServer } from "./server-http.ts";
export { buildWebhookServer } from "./server-webhooks.ts";
```

### Task 5.5: Update `api-server` package.json (deps + scripts + bins)

**Files:**
- Modify: `packages/api-server/package.json`

- [ ] **Step 1: Add the four new workspace deps** to `dependencies`:

```json
    "@journeyman/api-context": "*",
    "@journeyman/api-http": "*",
    "@journeyman/api-webhooks": "*",
    "@journeyman/api-control-plane": "*",
```

(Leave the existing delegated-route deps — `identity`, `secrets`, `mcp`, `builder`, `sandbox`, `skills`, `custom-steps`, `coding-models`, `orchestrator`, etc. — they're still imported by `server-http.ts` and `composition.ts`. Remove `@journeyman/webhooks` only if `composition.ts` no longer imports it directly.)

- [ ] **Step 2: Replace the `bin` and `scripts`** blocks:

```json
  "bin": {
    "journeyman-api-http": "./src/cli-start-http.ts",
    "journeyman-api-webhooks": "./src/cli-start-webhooks.ts",
    "journeyman-api-control-plane": "./src/cli-start-control-plane.ts"
  },
  "scripts": {
    "start:http": "tsx src/cli-start-http.ts",
    "start:webhooks": "tsx src/cli-start-webhooks.ts",
    "start:control-plane": "tsx src/cli-start-control-plane.ts",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
```

- [ ] **Step 3: Run `npm install`** to relink workspaces.

Run: `npm install`
Expected: no errors.

---

## Phase 6 — Deploy config (3 services, one image)

### Task 6.1: Update root start scripts

**Files:**
- Modify: root `package.json` (scripts around lines 27–29)

- [ ] **Step 1: Replace `start:api-server`** with three scripts:

```json
    "start:api-http": "npm run start:http -w @journeyman/api-server",
    "start:api-webhooks": "npm run start:webhooks -w @journeyman/api-server",
    "start:api-control-plane": "npm run start:control-plane -w @journeyman/api-server",
```

### Task 6.2: Dockerfile — keep one image, default to the HTTP entrypoint

**Files:**
- Modify: `Dockerfile` (the `runtime-api` stage, line ~51)

The image bundles the whole repo (tsx runs sources), so all three entrypoints already ship. Only the default `CMD` needs to point at the HTTP start; compose/k8s override the command for the other two services.

- [ ] **Step 1: Change the `runtime-api` `CMD`** (line ~51) to:

```dockerfile
CMD ["npm", "run", "start:http", "-w", "@journeyman/api-server"]
```

No new Docker stages are needed — `scripts/build-images.sh` continues to build only `api-server:runtime-api`.

### Task 6.3: compose.deploy.yml — three services from the one image

**Files:**
- Modify: `compose.deploy.yml` (replace the single `api-server:` block, lines 86–124)

- [ ] **Step 1: Replace the `api-server:` service** with `api-http`, `api-webhooks`, and `api-control-plane`. All three reuse `image: journeyman/api-server:dev`, share the same `env_file`/`environment`/`volumes`/`depends_on`, and override `command`. `api-control-plane` runs a single replica (compose default).

```yaml
  api-http:
    image: journeyman/api-server:dev
    command: ["npm", "run", "start:http", "-w", "@journeyman/api-server"]
    env_file: .env.production
    extra_hosts:
      - "host.docker.internal:host-gateway"
    environment:
      DATABASE_URL: postgres://postgres:postgres@postgres:5432/journeyman
      CONDUCTOR_BASE_URL: http://conductor:8080/api
      IDENTITY_ENFORCE: "true"
      NODE_ENV: production
      PORT: "4000"
      JOURNEYMAN_BASE_DIR: /data/journeyman
    ports: ["6000:4000"]
    volumes:
      - ${JOURNEYMAN_BASE_DIR:-./.journeyman-data}:/data/journeyman
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://localhost:4000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 5s
      timeout: 5s
      retries: 20
    depends_on:
      migrations: { condition: service_completed_successfully }
      redis: { condition: service_healthy }
      conductor: { condition: service_started }

  api-webhooks:
    image: journeyman/api-server:dev
    command: ["npm", "run", "start:webhooks", "-w", "@journeyman/api-server"]
    env_file: .env.production
    environment:
      DATABASE_URL: postgres://postgres:postgres@postgres:5432/journeyman
      CONDUCTOR_BASE_URL: http://conductor:8080/api
      IDENTITY_ENFORCE: "true"
      NODE_ENV: production
      WEBHOOKS_PORT: "4001"
      JOURNEYMAN_BASE_DIR: /data/journeyman
    ports: ["6001:4001"]
    volumes:
      - ${JOURNEYMAN_BASE_DIR:-./.journeyman-data}:/data/journeyman
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://localhost:4001/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 5s
      timeout: 5s
      retries: 20
    depends_on:
      migrations: { condition: service_completed_successfully }
      redis: { condition: service_healthy }
      conductor: { condition: service_started }

  api-control-plane:
    image: journeyman/api-server:dev
    command: ["npm", "run", "start:control-plane", "-w", "@journeyman/api-server"]
    env_file: .env.production
    environment:
      DATABASE_URL: postgres://postgres:postgres@postgres:5432/journeyman
      CONDUCTOR_BASE_URL: http://conductor:8080/api
      NODE_ENV: production
      CONTROL_PLANE_PORT: "4003"
      JOURNEYMAN_BASE_DIR: /data/journeyman
    volumes:
      - ${JOURNEYMAN_BASE_DIR:-./.journeyman-data}:/data/journeyman
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://localhost:4003/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 5s
      timeout: 5s
      retries: 20
    depends_on:
      migrations: { condition: service_completed_successfully }
      redis: { condition: service_healthy }
      conductor: { condition: service_started }
```

- [ ] **Step 2: Update the `web` service `depends_on`** (was `api-server`) to wait on `api-http`:

```yaml
  web:
    image: journeyman/web:dev
    ports: ["6080:8080"]
    depends_on:
      api-http:
        condition: service_healthy
```

### Task 6.4: nginx — route the public receiver to api-webhooks, the rest to api-http

**Files:**
- Modify: `nginx/web.conf`

- [ ] **Step 1: Point the `/api/` block upstream at `api-http`** (line ~17): change `set $upstream_api "http://api-server:4000";` to `set $upstream_api "http://api-http:4000";`.

- [ ] **Step 2: Point the `/webhooks/in/` block at `api-webhooks`** (line ~43): change `set $upstream_webhook "http://api-server:4000";` to `set $upstream_webhook "http://api-webhooks:4001";`.

> The control-plane has no nginx route (no ingress) — correct, it serves no public API.

### Task 6.5: Kubernetes — three Deployments/Services + ingress split

**Files:**
- Modify: `deploy/k8s/base/api-server.yaml` → becomes three Service+Deployment pairs
- Modify: `deploy/k8s/base/ingress.yaml`
- Modify: `deploy/k8s/base/kustomization.yaml` (if it lists `api-server.yaml` by name, keep the filename or rename consistently)

- [ ] **Step 1: Rewrite `deploy/k8s/base/api-server.yaml`** with three pairs. `api-control-plane` has `replicas: 1` (singleton — non-negotiable) and a health Service on 4003; `api-http`/`api-webhooks` may scale. Each container overrides `command`/`args` and shares `journeyman-config` + `journeyman-secrets`:

```yaml
apiVersion: v1
kind: Service
metadata: { name: api-http }
spec:
  selector: { app: api-http }
  ports: [{ port: 4000, targetPort: 4000 }]
---
apiVersion: apps/v1
kind: Deployment
metadata: { name: api-http }
spec:
  replicas: 1
  selector: { matchLabels: { app: api-http } }
  template:
    metadata: { labels: { app: api-http } }
    spec:
      initContainers:
        - name: wait-for-postgres
          image: postgres:16-alpine
          command: ["sh","-c","until pg_isready -h postgres -U postgres; do echo waiting; sleep 2; done"]
      containers:
        - name: api-http
          image: journeyman/api-server:dev
          command: ["npm","run","start:http","-w","@journeyman/api-server"]
          ports: [{ containerPort: 4000 }]
          envFrom:
            - configMapRef: { name: journeyman-config }
            - secretRef: { name: journeyman-secrets }
          readinessProbe: { tcpSocket: { port: 4000 }, initialDelaySeconds: 10, periodSeconds: 5 }
---
apiVersion: v1
kind: Service
metadata: { name: api-webhooks }
spec:
  selector: { app: api-webhooks }
  ports: [{ port: 4001, targetPort: 4001 }]
---
apiVersion: apps/v1
kind: Deployment
metadata: { name: api-webhooks }
spec:
  replicas: 1
  selector: { matchLabels: { app: api-webhooks } }
  template:
    metadata: { labels: { app: api-webhooks } }
    spec:
      containers:
        - name: api-webhooks
          image: journeyman/api-server:dev
          command: ["npm","run","start:webhooks","-w","@journeyman/api-server"]
          env: [{ name: WEBHOOKS_PORT, value: "4001" }]
          ports: [{ containerPort: 4001 }]
          envFrom:
            - configMapRef: { name: journeyman-config }
            - secretRef: { name: journeyman-secrets }
          readinessProbe: { tcpSocket: { port: 4001 }, initialDelaySeconds: 10, periodSeconds: 5 }
---
apiVersion: apps/v1
kind: Deployment
metadata: { name: api-control-plane }
spec:
  replicas: 1   # MUST stay 1 — timers double-fire with >1 replica
  selector: { matchLabels: { app: api-control-plane } }
  template:
    metadata: { labels: { app: api-control-plane } }
    spec:
      containers:
        - name: api-control-plane
          image: journeyman/api-server:dev
          command: ["npm","run","start:control-plane","-w","@journeyman/api-server"]
          env: [{ name: CONTROL_PLANE_PORT, value: "4003" }]
          ports: [{ containerPort: 4003 }]
          envFrom:
            - configMapRef: { name: journeyman-config }
            - secretRef: { name: journeyman-secrets }
          readinessProbe: { tcpSocket: { port: 4003 }, initialDelaySeconds: 10, periodSeconds: 5 }
```

> If `journeyman-config` sets `PORT=4000`, that's correct for `api-http`; `api-webhooks`/`control-plane` use their dedicated `WEBHOOKS_PORT`/`CONTROL_PLANE_PORT` so they don't collide. Confirm the configMap doesn't force a single `PORT` that would break the webhooks listener — the entrypoints read `WEBHOOKS_PORT`/`CONTROL_PLANE_PORT`, not `PORT`, so this is safe.

- [ ] **Step 2: Update `deploy/k8s/base/ingress.yaml`** — `/api` → `api-http:4000`, add `/webhooks/in` → `api-webhooks:4001`, keep `/api/analytics` first:

```yaml
        paths:
          - path: /api/analytics
            pathType: Prefix
            backend: { service: { name: analytics, port: { number: 4002 } } }
          - path: /webhooks/in
            pathType: Prefix
            backend: { service: { name: api-webhooks, port: { number: 4001 } } }
          - path: /api
            pathType: Prefix
            backend: { service: { name: api-http, port: { number: 4000 } } }
          - path: /
            pathType: Prefix
            backend: { service: { name: web, port: { number: 8080 } } }
```

- [ ] **Step 3: Check `kustomization.yaml`** references. If it lists resources by filename, the path `api-server.yaml` still exists (now holding three pairs) — no rename needed. If anything references a `Service`/`Deployment` named `api-server` by name (e.g. other manifests), update those references to `api-http`.

Run: `grep -rn "api-server" deploy/k8s`
Expected after edits: only image references `journeyman/api-server:dev` remain; no `name: api-server` Service/Deployment references.

---

## Phase 7 — Verification gate (the only typecheck/test pass)

### Task 7.1: Typecheck, boundaries, and tests across the workspace

- [ ] **Step 1: Install (relink all workspaces)**

Run: `npm install`
Expected: success, four new symlinked packages present.

- [ ] **Step 2: Typecheck everything**

Run: `npm run typecheck`
Expected: exit 0. Common failures to fix inline: an import still pointing at a moved `../services/x.ts` (repoint to `@journeyman/api-context` or the right cluster), or a barrel export name mismatch (Tasks 1.4/2.2/3.2/4.2 — open the moved file and match the real export name).

- [ ] **Step 3: Import-boundary check**

Run: `npm run check:boundaries`
Expected: exit 0. If it flags a cross-layer import, the offending file imported a backend-only thing into a shared context — re-evaluate placement.

- [ ] **Step 4: Run the test suite**

Run: `npm test`
Expected: same pass/fail baseline as before the split (the suite moved with its code). Compare against the known pre-existing failures; **no new failures** introduced by the split. Tests that previously imported `../../composition.ts` or `../services/*` need their imports repointed to `@journeyman/api-context` — fix any such import error and re-run.

- [ ] **Step 5: Smoke-check the three entrypoints boot** (optional but recommended; needs `npm run infra:up` + a migrated DB)

```bash
PORT=4000 npm run start:api-http &            # expect "api-http listening" on 4000, GET /healthz → ok
WEBHOOKS_PORT=4001 npm run start:api-webhooks &   # expect "api-webhooks listening" on 4001
CONTROL_PLANE_PORT=4003 npm run start:api-control-plane &  # expect "api-control-plane running" + loop logs
```

Expected: each logs its listen line; `curl localhost:4000/healthz`, `curl localhost:4001/healthz`, `curl localhost:4003/healthz` all return `{"ok":true}` (or the existing health shape). Kill them afterward.

### Task 7.2: Final self-check against the design

- [ ] **Step 1: Confirm the singleton invariant** — only `cli-start-control-plane.ts` calls `startControlPlane`, and neither `server-http.ts` nor `server-webhooks.ts` starts any timer/scheduler/reaper/syncer.

Run: `grep -rn "startControlPlane\|startAgentScheduler\|new WorkflowInstanceSyncer\|Reaper\|WebhookWaitSweeper" packages/api-server/src`
Expected: matches appear **only** in `cli-start-control-plane.ts` (the call) — not in `server-http.ts`, `server-webhooks.ts`, `cli-start-http.ts`, or `cli-start-webhooks.ts`.

- [ ] **Step 2: Confirm `api-server/src` is slim** — only `composition.ts`, `server-http.ts`, `server-webhooks.ts`, `cli-start-*.ts`, `_env.ts`, `index.ts` remain (no `routes/`, no `services/`, no `schemas/`, no `sse/`).

Run: `find packages/api-server/src -type f`
Expected: the six/seven files above only.

---

## Known behavior nuances (document, don't fix)

1. **In-memory human-task timers are now control-plane-local.** `schedule()` runs in the control-plane (via the syncer→engine-reconciler path); `cancel()` calls from the http/webhooks processes hit an *empty* in-memory map and are no-ops. The scheduled timer still fires in the control-plane, but the late resolution is absorbed by the existing **first-wins** cancellation (`applyFirstWinsCancellation`) — net effect is one harmless rejected resolve attempt at timeout. No correctness loss; the durable `WebhookWaitSweeper` remains the backstop.
2. **`api-webhooks` service serves *only* the public receiver.** Webhook *management/presets* (authed, under `/api/...`) run in `api-http` because they share the `/api` prefix; isolating them by path isn't possible without splitting the `/api/workspaces/:wsId/...` namespace. The isolation goal (protect the UI API from public webhook bursts) is still met — the public, untrusted, bursty surface (`/webhooks/in/*`) is the isolated one.
3. **One image, three commands.** No per-service Docker stage; `build-images.sh` is unchanged. Promoting/scaling a service is a deploy concern only.

---

## Execution log — additional corrections discovered while implementing

Two more cross-package dependencies surfaced during execution (their importers used relative `./` paths, so the dry-run grep missed them):

1. **`jsonpath.ts` → `api-context`** (not `api-webhooks`). `match-human-tasks.ts` (a shared api-context service) imports `getByPath` from it. It moved to api-context; no barrel export needed (only used in-package).
2. **`notify-on-human-task-pause.ts` → `api-context`** (not `api-control-plane`). `engine-reconciler.ts` (api-context) imports it. It is NOT unused, as earlier suspected — the grep miss was due to the relative-path import form.

Dependency adjustments made as a result:
- `api-context`: dropped the unused `@journeyman/notification-provider` (agent-alerts/agent-scheduler don't use it); kept `@journeyman/agents` + `cron-parser`.
- `api-control-plane`: added `@journeyman/agents`, `@journeyman/connections`, `@journeyman/secrets` — `notify-on-terminal.ts` imports all three.
- Barrel schemas exported flat (`export *`) rather than namespaced, since `flows.ts` imports the schema symbols by name and there are no cross-file name collisions.

**Verification result (Phase 7):** `npm run typecheck` clean (34 workspaces, 0 errors); `npm run check:boundaries` clean; `npm test` shows **no new failures** — the only failures are pre-existing (`builder`, `identity`, `web` SectionNav, `windows-agent` mTLS integration, and the pure-rename `agent-webhook-fire` spy-args assertion). The new `start-control-plane.test.ts` and all 10 moved api-context test files pass. No commits made; all changes left in the working tree on `master`.

## Self-Review (completed by plan author)

- **Spec coverage:** package split (Phases 1–4) ✓; thin root + pure composition (5.1) ✓; 3 entrypoints (5.4) ✓; control-plane singleton + timer consolidation (5.3, 7.2) ✓; nginx/compose/k8s/Dockerfile (Phase 6) ✓; constraints — no commits / master / typecheck-at-end (Working Agreements + Phase 7) ✓.
- **Placeholder scan:** the only deliberate placeholder is the `_unused` import in Task 5.3 Step 3, explicitly called out to be deleted after copying exact import sources from the original files; barrel-export symbol names are flagged "confirm against the moved file" because the exact exported identifiers must be read from source, not guessed.
- **Type consistency:** `Composition` is defined once (api-context, Task 1.2) and imported everywhere; `startControlPlane(c: Composition): () => void` matches its test (5.3) and its single caller (5.4 Step 4); `buildHttpServer`/`buildWebhookServer` signatures match their entrypoints.
