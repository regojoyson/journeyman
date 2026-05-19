# Phase 1 — Foundation: Hand-Authored Flows on Conductor

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the new orchestration stack end-to-end with no UI. A user can `curl` a hand-written flow JSON to `@journeyman/api-server`, the server converts it to Conductor JSON, Conductor executes it through a Node worker that runs the existing `analyze` phase, results are persisted in Postgres, and the run is fetchable via REST. The architectural exit criterion is that any concrete adapter (e.g. `PostgresFlowStore`) can be swapped to an in-memory equivalent by editing only `composition.ts`.

**Architecture:** Two new monorepo packages — `@journeyman/orchestrator` (the only package that talks to Conductor) and `@journeyman/api-server` (Fastify HTTP layer). All cross-cutting concerns are pluggable via interfaces in `@journeyman/core`. The composition root in `api-server/src/composition.ts` is the single place where concrete adapters are picked. Existing `@journeyman/pipeline` is left frozen; the `analyze` phase is reused (re-imported, not copied) and wrapped as a Conductor worker.

**Tech Stack:** TypeScript (NodeNext modules, strict), Fastify 4, `pg` (node-postgres), `zod` for runtime validation, `vitest` for tests, Conductor (Orkes OSS) via Docker Compose, Redis (Conductor dep), Postgres 15+, `node-fetch`-style HTTP via global `fetch` (Node 22+).

---

## Spec Reference

Source spec: `docs/superpowers/specs/2026-04-27-visual-flow-orchestration-design.md`. This plan implements **only Section 12 → "Phase 1 — Foundation"** plus the prerequisite interfaces from Section 9.4. Out of scope: any UI work, gateways, loops, retries beyond what Conductor does natively, MCP & credential scopes (a stub `EnvCredentialStore` only), SSE.

## File Structure

New files created/modified, grouped by responsibility. Each file has one clear job.

### `@journeyman/core` (extended — adapter interfaces)

| File | Purpose |
|---|---|
| `packages/core/src/types/flow.types.ts` | `FlowDefinition`, `FlowNode`, `FlowEdge`, `FlowVersion`, `FlowSchemaVersion` constant, `Flow` aggregate. Pure data types. |
| `packages/core/src/types/run.types.ts` | `Run`, `RunStatus`, `RunEvent`, `RunEventType`, `NodeExecution`. |
| `packages/core/src/types/phase-handler.types.ts` | `PhaseInput`, `PhaseOutput`, `PhaseFailure`, `PhaseContext` (stripped-down, generic — no monolithic `PipelineContext` deps). |
| `packages/core/src/interfaces/orchestrator-engine.interface.ts` | `IOrchestratorEngine` — submit/get/cancel a run on whatever engine. |
| `packages/core/src/interfaces/flow-store.interface.ts` | `IFlowStore`, `IFlowVersionStore` — flow persistence. |
| `packages/core/src/interfaces/run-store.interface.ts` | `IRunStore`, `INodeExecutionStore` — run persistence. |
| `packages/core/src/interfaces/event-bus.interface.ts` | `IEventBus` — append + tail run events. |
| `packages/core/src/interfaces/phase-registry.interface.ts` | `IPhaseHandler`, `IPhaseRegistry` — register/lookup phase types. |
| `packages/core/src/interfaces/workspace-provider.interface.ts` | `IWorkspaceProvider`, `IWorkspace`. |
| `packages/core/src/interfaces/credential-store.interface.ts` | `ICredentialStore`, `CredentialRef`. |
| `packages/core/src/interfaces/condition-evaluator.interface.ts` | `IConditionEvaluator`. |
| `packages/core/src/interfaces/auth-provider.interface.ts` | `IAuthProvider`, `IUserContext`. |
| `packages/core/src/interfaces/flow-json-converter.interface.ts` | `IFlowJsonConverter` — flow JSON ↔ engine-native JSON. |
| `packages/core/src/index.ts` | extended re-exports |

### `@journeyman/orchestrator` (new package)

| File | Purpose |
|---|---|
| `packages/orchestrator/package.json` | npm package metadata |
| `packages/orchestrator/tsconfig.json` | TS config (mirror existing pattern) |
| `packages/orchestrator/vitest.config.ts` | test runner config |
| `packages/orchestrator/src/index.ts` | barrel exports |
| `packages/orchestrator/src/engines/conductor/conductor-orchestrator.ts` | `ConductorOrchestrator` impl |
| `packages/orchestrator/src/engines/conductor/conductor-client.ts` | thin REST client over Conductor's HTTP API |
| `packages/orchestrator/src/flow-json/conductor-converter.ts` | `ConductorJsonConverter` |
| `packages/orchestrator/src/flow-json/conductor-converter.test.ts` | unit tests |
| `packages/orchestrator/src/stores/postgres/pg-pool.ts` | shared `Pool` factory |
| `packages/orchestrator/src/stores/postgres/postgres-flow-store.ts` | `PostgresFlowStore` |
| `packages/orchestrator/src/stores/postgres/postgres-run-store.ts` | `PostgresRunStore` |
| `packages/orchestrator/src/stores/postgres/postgres-event-bus.ts` | `PostgresEventBus` |
| `packages/orchestrator/src/stores/memory/memory-flow-store.ts` | `MemoryFlowStore` (used in tests + adapter-swap proof) |
| `packages/orchestrator/src/stores/memory/memory-run-store.ts` | `MemoryRunStore` |
| `packages/orchestrator/src/stores/memory/memory-event-bus.ts` | `MemoryEventBus` |
| `packages/orchestrator/src/stores/memory/memory-flow-store.test.ts` | reference behavioral tests |
| `packages/orchestrator/src/registry/in-memory-phase-registry.ts` | `InMemoryPhaseRegistry` |
| `packages/orchestrator/src/registry/in-memory-phase-registry.test.ts` | tests |
| `packages/orchestrator/src/workspace/directory-workspace-provider.ts` | `DirectoryWorkspaceProvider` |
| `packages/orchestrator/src/credentials/env-credential-store.ts` | `EnvCredentialStore` |
| `packages/orchestrator/src/conditions/jsonlogic-evaluator.ts` | `JsonLogicEvaluator` |
| `packages/orchestrator/src/auth/no-auth-provider.ts` | `NoAuthProvider` |
| `packages/orchestrator/src/workers/worker-harness.ts` | long-poll loop, dispatches tasks to `IPhaseHandler`s |
| `packages/orchestrator/src/workers/worker-harness.test.ts` | unit test against mock client |
| `packages/orchestrator/src/workers/phases/analyze-phase-handler.ts` | wraps `@journeyman/pipeline` `AnalyzePhase` as `IPhaseHandler` |
| `packages/orchestrator/src/migrations/001_initial.sql` | DDL |
| `packages/orchestrator/src/migrations/run-migrations.ts` | tiny SQL runner |
| `packages/orchestrator/src/migrations/run-migrations.test.ts` | smoke test against pg |

### `@journeyman/api-server` (new package)

| File | Purpose |
|---|---|
| `packages/api-server/package.json` | npm package metadata |
| `packages/api-server/tsconfig.json` | TS config |
| `packages/api-server/vitest.config.ts` | test runner config |
| `packages/api-server/src/index.ts` | barrel exports + `startServer()` |
| `packages/api-server/src/composition.ts` | THE wiring point — only file that picks concretes |
| `packages/api-server/src/composition.test.ts` | proves adapter-swap exit criterion |
| `packages/api-server/src/cli-start.ts` | CLI entry: load env, build composition, start server |
| `packages/api-server/src/server.ts` | Fastify factory |
| `packages/api-server/src/routes/flows.ts` | `POST /flows`, `GET /flows/:id`, `POST /flows/:id/runs` |
| `packages/api-server/src/routes/flows.test.ts` | route tests with memory adapters |
| `packages/api-server/src/routes/runs.ts` | `GET /runs/:id` |
| `packages/api-server/src/routes/runs.test.ts` | route tests |
| `packages/api-server/src/routes/health.ts` | `GET /healthz` |
| `packages/api-server/src/schemas/flow.ts` | zod schema for flow request body |
| `packages/api-server/src/schemas/run.ts` | zod schema for run request body |

### Repo root

| File | Purpose |
|---|---|
| `infra/docker-compose.yml` | Conductor + Redis + (existing local) Postgres |
| `infra/conductor-config/conductor.properties` | minimal Conductor config |
| `infra/README.md` | how to start the stack locally |
| `examples/flows/analyze-only.flow.json` | demo flow JSON used by the curl smoke test |
| `package.json` | add `infra:up`, `infra:down`, new `start:api-server`, `start:worker` scripts |

---

## Task 1: Add adapter-interface scaffold to `@journeyman/core`

**Files:**
- Create: `packages/core/src/types/flow.types.ts`
- Create: `packages/core/src/types/run.types.ts`
- Create: `packages/core/src/types/phase-handler.types.ts`
- Modify: `packages/core/src/index.ts`
- Test: (none — pure types, validated by typecheck)

- [ ] **Step 1.1: Write `flow.types.ts`**

```typescript
// packages/core/src/types/flow.types.ts

/**
 * Flow JSON schema version. Bumped when flow JSON shape changes
 * incompatibly. ConductorJsonConverter migrates older versions on read.
 */
export const FLOW_SCHEMA_VERSION = 1 as const;
export type FlowSchemaVersion = typeof FLOW_SCHEMA_VERSION;

export type FlowNodeType =
  | "start"
  | "end"
  | "phase"
  // node types reserved for later phases — intentionally listed so converter
  // can reject them in Phase 1 with a clear "not yet supported" error
  | "gateway-xor"
  | "gateway-and"
  | "loop"
  | "subflow"
  | "if"
  | "timer"
  | "retry-block"
  | "try-catch"
  | "human-task";

export interface FlowNode {
  id: string;
  type: FlowNodeType;
  /** Human-readable label shown on the canvas tile. */
  displayName?: string;
  /** Phase type ("analyze", "clone-repos", …) — required when type === "phase". */
  phaseType?: string;
  /** Free-form configuration consumed by the phase handler. */
  config?: Record<string, unknown>;
  /** Reserved — populated in Phase 5. */
  retry?: Record<string, unknown>;
  /** Position on canvas — opaque to engine; preserved on round-trip. */
  position?: { x: number; y: number };
}

export type FlowEdgeType = "default" | "conditional" | "error" | "else";

export interface FlowEdge {
  id: string;
  source: string;       // node id
  target: string;       // node id
  type?: FlowEdgeType;  // default = "default"
  /** JSONLogic expression — applies when type === "conditional". */
  condition?: unknown;
  /** Reserved — labels for "then" / "else" outputs of the `if` node. */
  label?: string;
}

export interface FlowDefinition {
  schemaVersion: FlowSchemaVersion;
  nodes: FlowNode[];
  edges: FlowEdge[];
  /** Cycle visit-count guard (per spec §4). 0 = no cycles allowed in Phase 1. */
  maxCycleVisits?: number;
}

export interface FlowVersion {
  id: string;
  flowId: string;
  versionNumber: number;
  definition: FlowDefinition;
  createdByUserId: string | null;
  createdAt: Date;
}

export interface Flow {
  id: string;
  ownerUserId: string | null;
  name: string;
  description: string | null;
  currentVersionId: string | null;
  createdAt: Date;
  updatedAt: Date;
}
```

- [ ] **Step 1.2: Write `run.types.ts`**

```typescript
// packages/core/src/types/run.types.ts

export type RunStatus =
  | "pending"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

export type TriggerSource = "manual" | "webhook" | "schedule" | "api";

export interface Run {
  id: string;
  flowVersionId: string;
  status: RunStatus;
  triggerSource: TriggerSource;
  startedByUserId: string | null;
  /** Engine-side workflow id (Conductor's `workflowId`). */
  engineWorkflowId: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  durationMs: number | null;
  failedAtNodeId: string | null;
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown> | null;
}

export type RunEventType =
  | "phase.started"
  | "phase.log"
  | "phase.failed"
  | "phase.retrying"
  | "phase.completed"
  | "node.cycled"
  | "run.started"
  | "run.completed"
  | "run.failed"
  | "run.cancelled";

export interface RunEvent {
  id: number;             // monotonically increasing — used for SSE replay-since
  runId: string;
  nodeId: string | null;
  eventType: RunEventType;
  payload: Record<string, unknown>;
  ts: Date;
}

export type NodeExecutionStatus =
  | "pending"
  | "running"
  | "retrying"
  | "completed"
  | "failed"
  | "skipped";

export interface NodeExecution {
  id: string;
  runId: string;
  nodeId: string;
  attempt: number;
  status: NodeExecutionStatus;
  startedAt: Date | null;
  completedAt: Date | null;
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  errorClass: string | null;
  errorMessage: string | null;
}
```

- [ ] **Step 1.3: Write `phase-handler.types.ts`**

```typescript
// packages/core/src/types/phase-handler.types.ts

export type PhaseInput = Record<string, unknown>;
export type PhaseOutput = Record<string, unknown>;

/**
 * Returned by an IPhaseHandler when execution fails. The orchestrator decides
 * whether to retry based on `retryable` and the node's retry policy.
 */
export interface PhaseFailure {
  errorClass: string;
  message: string;
  /** True ⇒ orchestrator may retry. False ⇒ short-circuit, route to error edge. */
  retryable: boolean;
  details?: Record<string, unknown>;
}

/**
 * Minimal context handed to IPhaseHandler.run(). Intentionally narrow — phase
 * handlers must not depend on the legacy PipelineContext.
 */
export interface PhaseContext {
  runId: string;
  nodeId: string;
  attempt: number;
  workspaceDir: string;
  signal: AbortSignal;
  /** Resolved env vars for this phase (from ICredentialStore). */
  env: Record<string, string>;
  /** Append a phase.log event for live UI streaming. */
  log(line: string, meta?: Record<string, unknown>): void;
}
```

- [ ] **Step 1.4: Write the 11 interface files**

Each file is a single TypeScript file in `packages/core/src/interfaces/` exporting one or two interfaces. Write each one verbatim.

`packages/core/src/interfaces/orchestrator-engine.interface.ts`:

```typescript
import type { FlowDefinition } from "../types/flow.types.ts";
import type { Run, RunStatus } from "../types/run.types.ts";

export interface SubmitRunArgs {
  flowVersionId: string;
  flowDefinition: FlowDefinition;
  inputs: Record<string, unknown>;
  startedByUserId: string | null;
}

export interface IOrchestratorEngine {
  /** Hand a flow to the engine. Returns the persisted Run id. */
  submit(args: SubmitRunArgs): Promise<{ runId: string; engineWorkflowId: string }>;
  /** Fetch current state. */
  getRun(runId: string): Promise<Run | null>;
  /** Best-effort cancel. */
  cancel(runId: string, reason?: string): Promise<void>;
  /** Engine-specific status sync — pulled by the API server periodically until SSE lands. */
  syncStatus(runId: string): Promise<RunStatus>;
}
```

`packages/core/src/interfaces/flow-store.interface.ts`:

```typescript
import type { Flow, FlowDefinition, FlowVersion } from "../types/flow.types.ts";

export interface CreateFlowArgs {
  name: string;
  description?: string;
  ownerUserId: string | null;
  initialDefinition: FlowDefinition;
  createdByUserId: string | null;
}

export interface IFlowStore {
  create(args: CreateFlowArgs): Promise<{ flow: Flow; version: FlowVersion }>;
  getById(flowId: string): Promise<Flow | null>;
  list(opts?: { ownerUserId?: string | null; limit?: number }): Promise<Flow[]>;
}

export interface IFlowVersionStore {
  /** Append a new version; returns it with version_number = previous + 1. */
  appendVersion(args: {
    flowId: string;
    definition: FlowDefinition;
    createdByUserId: string | null;
  }): Promise<FlowVersion>;
  getById(versionId: string): Promise<FlowVersion | null>;
  listByFlow(flowId: string): Promise<FlowVersion[]>;
}
```

`packages/core/src/interfaces/run-store.interface.ts`:

```typescript
import type { Run, NodeExecution, RunStatus, TriggerSource } from "../types/run.types.ts";

export interface CreateRunArgs {
  flowVersionId: string;
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

`packages/core/src/interfaces/event-bus.interface.ts`:

```typescript
import type { RunEvent, RunEventType } from "../types/run.types.ts";

export interface AppendEventArgs {
  runId: string;
  nodeId?: string | null;
  eventType: RunEventType;
  payload: Record<string, unknown>;
}

export interface IEventBus {
  append(args: AppendEventArgs): Promise<RunEvent>;
  list(runId: string, opts?: { sinceId?: number; limit?: number }): Promise<RunEvent[]>;
  /** Async iterator that yields events as they're appended (Phase 3 SSE). */
  subscribe(runId: string, opts?: { sinceId?: number }): AsyncIterable<RunEvent>;
}
```

`packages/core/src/interfaces/phase-registry.interface.ts`:

```typescript
import type { PhaseContext, PhaseInput, PhaseOutput, PhaseFailure } from "../types/phase-handler.types.ts";

export type PhaseResult =
  | { kind: "success"; output: PhaseOutput }
  | { kind: "failure"; failure: PhaseFailure };

export interface IPhaseHandler {
  /** Stable phase type id, e.g. "analyze". */
  readonly phaseType: string;
  /** JSON Schema describing this phase's required `config` shape. */
  readonly configSchema?: unknown;
  run(input: PhaseInput, ctx: PhaseContext): Promise<PhaseResult>;
}

export interface IPhaseRegistry {
  register(handler: IPhaseHandler): void;
  get(phaseType: string): IPhaseHandler | null;
  list(): IPhaseHandler[];
}
```

`packages/core/src/interfaces/workspace-provider.interface.ts`:

```typescript
export interface IWorkspace {
  /** Absolute path on whatever filesystem the worker can read/write. */
  readonly path: string;
  destroy(): Promise<void>;
}

export interface IWorkspaceProvider {
  create(opts: { runId: string; nodeId: string }): Promise<IWorkspace>;
}
```

`packages/core/src/interfaces/credential-store.interface.ts`:

```typescript
/**
 * Reference to a credential. v1 only supports "env:<NAME>".
 * Phase 5 adds "user:<NAME>" and "flow:<NAME>" with overrides.
 */
export type CredentialRef = string;

export interface ICredentialStore {
  /**
   * Resolve refs into a flat env-var map suitable for passing to a child process.
   * Throws CredentialNotFoundError on any unresolved ref.
   */
  resolve(refs: Record<string, CredentialRef>, scope: {
    userId: string | null;
    flowId: string | null;
  }): Promise<Record<string, string>>;
}

export class CredentialNotFoundError extends Error {
  constructor(public readonly ref: string) {
    super(`Credential not found: ${ref}`);
    this.name = "CredentialNotFoundError";
  }
}
```

`packages/core/src/interfaces/condition-evaluator.interface.ts`:

```typescript
export interface IConditionEvaluator {
  /** Returns the boolean result of evaluating `expression` against `data`. */
  evaluate(expression: unknown, data: Record<string, unknown>): boolean;
}
```

`packages/core/src/interfaces/auth-provider.interface.ts`:

```typescript
import type { FastifyRequest } from "fastify";

export interface IUserContext {
  userId: string | null;
  roles: string[];
}

export interface IAuthProvider {
  /** Resolve a user from a request. Returns the anonymous user when no auth header. */
  authenticate(req: FastifyRequest): Promise<IUserContext>;
}
```

`packages/core/src/interfaces/flow-json-converter.interface.ts`:

```typescript
import type { FlowDefinition } from "../types/flow.types.ts";

/**
 * Converter between the canonical Journeyman FlowDefinition and an
 * engine-specific JSON shape (Conductor in v1, Temporal/Flowable later).
 */
export interface IFlowJsonConverter<TEngineDef = unknown> {
  toEngineJson(def: FlowDefinition, opts: {
    /** Stable, unique workflow name for the engine. */
    workflowName: string;
    workflowVersion: number;
  }): TEngineDef;
}
```

- [ ] **Step 1.5: Update `packages/core/src/index.ts`**

```typescript
// existing exports unchanged …
export type {
  // existing
  ICodingCLI, IGitProvider, ITicketProvider, INotificationProvider,
} from "./interfaces/coding-cli.interface.ts";
// ^ keep the lines that already exist; do not delete them.

// === New Phase 1 adapter surface ===
export type {
  IOrchestratorEngine, SubmitRunArgs,
} from "./interfaces/orchestrator-engine.interface.ts";
export type {
  IFlowStore, IFlowVersionStore, CreateFlowArgs,
} from "./interfaces/flow-store.interface.ts";
export type {
  IRunStore, INodeExecutionStore, CreateRunArgs,
} from "./interfaces/run-store.interface.ts";
export type {
  IEventBus, AppendEventArgs,
} from "./interfaces/event-bus.interface.ts";
export type {
  IPhaseHandler, IPhaseRegistry, PhaseResult,
} from "./interfaces/phase-registry.interface.ts";
export type {
  IWorkspace, IWorkspaceProvider,
} from "./interfaces/workspace-provider.interface.ts";
export type {
  ICredentialStore, CredentialRef,
} from "./interfaces/credential-store.interface.ts";
export { CredentialNotFoundError } from "./interfaces/credential-store.interface.ts";
export type { IConditionEvaluator } from "./interfaces/condition-evaluator.interface.ts";
export type { IAuthProvider, IUserContext } from "./interfaces/auth-provider.interface.ts";
export type { IFlowJsonConverter } from "./interfaces/flow-json-converter.interface.ts";

// === New Phase 1 data types ===
export type {
  Flow, FlowDefinition, FlowEdge, FlowEdgeType, FlowNode, FlowNodeType, FlowVersion,
  FlowSchemaVersion,
} from "./types/flow.types.ts";
export { FLOW_SCHEMA_VERSION } from "./types/flow.types.ts";
export type {
  Run, RunEvent, RunEventType, RunStatus, TriggerSource,
  NodeExecution, NodeExecutionStatus,
} from "./types/run.types.ts";
export type {
  PhaseContext, PhaseFailure, PhaseInput, PhaseOutput,
} from "./types/phase-handler.types.ts";
```

Note: keep all existing export lines exactly as they were. Only **add** the new ones above. The existing block in `index.ts` re-exports types from `coding-cli.interface.ts`, `git-provider.interface.ts`, `ticket.interface.ts`, `notification.interface.ts`, and the existing pipeline interface. Leave them.

- [ ] **Step 1.6: Verify typecheck passes**

Run: `npm run typecheck -w @journeyman/core`
Expected: no errors. (`fastify` peer-dep is already optional in `core/package.json`, so the auth interface's `FastifyRequest` import is fine.)

- [ ] **Step 1.7: Commit**

```bash
git add packages/core/src/types packages/core/src/interfaces packages/core/src/index.ts
git commit -m "$(cat <<'EOF'
feat(core): add Phase 1 adapter interfaces and flow/run types

Adds 11 new interfaces (IOrchestratorEngine, IFlowStore, IFlowVersionStore,
IRunStore, INodeExecutionStore, IEventBus, IPhaseHandler, IPhaseRegistry,
IWorkspaceProvider, ICredentialStore, IConditionEvaluator, IAuthProvider,
IFlowJsonConverter) and the supporting Flow/Run/PhaseHandler type
families. No implementations yet — see spec §9.4 "interface-first" rule.
EOF
)"
```

---

## Task 2: Scaffold `@journeyman/orchestrator` package shell

**Files:**
- Create: `packages/orchestrator/package.json`
- Create: `packages/orchestrator/tsconfig.json`
- Create: `packages/orchestrator/vitest.config.ts`
- Create: `packages/orchestrator/src/index.ts`

- [ ] **Step 2.1: Write `packages/orchestrator/package.json`**

```json
{
  "name": "@journeyman/orchestrator",
  "version": "0.1.0",
  "description": "Engine-agnostic orchestration layer. Conductor adapter, flow JSON converter, worker harness, and pluggable stores.",
  "type": "module",
  "main": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "files": ["src"],
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "migrate": "tsx src/migrations/run-migrations.ts"
  },
  "dependencies": {
    "@journeyman/core": "*",
    "@journeyman/pipeline": "*",
    "json-logic-js": "^2.0.5",
    "pg": "^8.13.0"
  },
  "devDependencies": {
    "@types/json-logic-js": "^2.0.7",
    "@types/node": "^25.6.0",
    "@types/pg": "^8.11.10",
    "tsx": "^4.21.0",
    "typescript": "^6.0.3",
    "vitest": "^2.1.4"
  }
}
```

- [ ] **Step 2.2: Write `packages/orchestrator/tsconfig.json`**

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
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 2.3: Write `packages/orchestrator/vitest.config.ts`**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    testTimeout: 10_000,
  },
});
```

- [ ] **Step 2.4: Write minimal `packages/orchestrator/src/index.ts`**

```typescript
// Barrel export — populated by later tasks.
export {};
```

- [ ] **Step 2.5: Run install and typecheck**

```bash
npm install
npm run typecheck -w @journeyman/orchestrator
```
Expected: install succeeds; typecheck passes (empty source is valid).

- [ ] **Step 2.6: Commit**

```bash
git add packages/orchestrator package-lock.json
git commit -m "feat(orchestrator): scaffold empty @journeyman/orchestrator package"
```

---

## Task 3: Scaffold `@journeyman/api-server` package shell

**Files:**
- Create: `packages/api-server/package.json`
- Create: `packages/api-server/tsconfig.json`
- Create: `packages/api-server/vitest.config.ts`
- Create: `packages/api-server/src/index.ts`

- [ ] **Step 3.1: Write `packages/api-server/package.json`**

```json
{
  "name": "@journeyman/api-server",
  "version": "0.1.0",
  "description": "Fastify HTTP gateway: REST + SSE for the Journeyman visual flow builder. Composition root for all adapters.",
  "type": "module",
  "main": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "bin": {
    "journeyman-api-server": "./src/cli-start.ts"
  },
  "files": ["src"],
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "start": "tsx src/cli-start.ts"
  },
  "dependencies": {
    "@fastify/cors": "^8.5.0",
    "@fastify/sensible": "^5.6.0",
    "@journeyman/core": "*",
    "@journeyman/orchestrator": "*",
    "dotenv": "^17.4.2",
    "fastify": "^4.28.1",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/node": "^25.6.0",
    "tsx": "^4.21.0",
    "typescript": "^6.0.3",
    "vitest": "^2.1.4"
  }
}
```

- [ ] **Step 3.2: Write `packages/api-server/tsconfig.json`**

Same content as Task 2.2 (`packages/orchestrator/tsconfig.json`). Copy verbatim.

- [ ] **Step 3.3: Write `packages/api-server/vitest.config.ts`**

Same content as Task 2.3. Copy verbatim.

- [ ] **Step 3.4: Write minimal `packages/api-server/src/index.ts`**

```typescript
// Barrel export — populated by later tasks.
export {};
```

- [ ] **Step 3.5: Install and typecheck**

```bash
npm install
npm run typecheck -w @journeyman/api-server
```
Expected: install succeeds, typecheck passes.

- [ ] **Step 3.6: Commit**

```bash
git add packages/api-server package-lock.json
git commit -m "feat(api-server): scaffold empty @journeyman/api-server package"
```

---

## Task 4: Postgres migration runner + initial schema

**Files:**
- Create: `packages/orchestrator/src/migrations/001_initial.sql`
- Create: `packages/orchestrator/src/migrations/run-migrations.ts`
- Create: `packages/orchestrator/src/stores/postgres/pg-pool.ts`
- Test: `packages/orchestrator/src/migrations/run-migrations.test.ts`

- [ ] **Step 4.1: Write `001_initial.sql`**

```sql
-- packages/orchestrator/src/migrations/001_initial.sql
-- Phase 1 schema. New tables only — legacy pipeline tables (if any) untouched.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS jm_flows (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id   TEXT,
  name            TEXT NOT NULL,
  description     TEXT,
  current_version_id UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS jm_flow_versions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_id         UUID NOT NULL REFERENCES jm_flows(id) ON DELETE CASCADE,
  version_number  INTEGER NOT NULL,
  definition      JSONB NOT NULL,
  created_by_user_id TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (flow_id, version_number)
);

ALTER TABLE jm_flows
  ADD CONSTRAINT jm_flows_current_version_fk
  FOREIGN KEY (current_version_id) REFERENCES jm_flow_versions(id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE IF NOT EXISTS jm_runs (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_version_id      UUID NOT NULL REFERENCES jm_flow_versions(id),
  status               TEXT NOT NULL,
  trigger_source       TEXT NOT NULL,
  started_by_user_id   TEXT,
  engine_workflow_id   TEXT,
  started_at           TIMESTAMPTZ,
  completed_at         TIMESTAMPTZ,
  duration_ms          INTEGER,
  failed_at_node_id    TEXT,
  inputs               JSONB NOT NULL DEFAULT '{}'::jsonb,
  outputs              JSONB,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS jm_runs_status_idx       ON jm_runs (status);
CREATE INDEX IF NOT EXISTS jm_runs_engine_wfid_idx  ON jm_runs (engine_workflow_id);
CREATE INDEX IF NOT EXISTS jm_runs_flow_version_idx ON jm_runs (flow_version_id);

CREATE TABLE IF NOT EXISTS jm_run_events (
  id          BIGSERIAL PRIMARY KEY,
  run_id      UUID NOT NULL REFERENCES jm_runs(id) ON DELETE CASCADE,
  node_id     TEXT,
  event_type  TEXT NOT NULL,
  payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
  ts          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS jm_run_events_run_idx ON jm_run_events (run_id, id);

CREATE TABLE IF NOT EXISTS jm_node_executions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id        UUID NOT NULL REFERENCES jm_runs(id) ON DELETE CASCADE,
  node_id       TEXT NOT NULL,
  attempt       INTEGER NOT NULL,
  status        TEXT NOT NULL,
  started_at    TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ,
  input         JSONB NOT NULL DEFAULT '{}'::jsonb,
  output        JSONB,
  error_class   TEXT,
  error_message TEXT,
  UNIQUE (run_id, node_id, attempt)
);
```

- [ ] **Step 4.2: Write `pg-pool.ts`**

```typescript
// packages/orchestrator/src/stores/postgres/pg-pool.ts
import { Pool } from "pg";

export interface PgConfig {
  connectionString: string;
  max?: number;
}

export function createPool(cfg: PgConfig): Pool {
  return new Pool({
    connectionString: cfg.connectionString,
    max: cfg.max ?? 10,
  });
}
```

- [ ] **Step 4.3: Write `run-migrations.ts`**

```typescript
// packages/orchestrator/src/migrations/run-migrations.ts
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createLogger } from "@journeyman/core";
import type { Pool } from "pg";
import { createPool } from "../stores/postgres/pg-pool.ts";

const log = createLogger("orchestrator:migrate");
const __dirname = dirname(fileURLToPath(import.meta.url));

export async function runMigrations(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS jm_schema_migrations (
      id   TEXT PRIMARY KEY,
      ran_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  const files = (await readdir(__dirname))
    .filter(f => f.endsWith(".sql"))
    .sort();
  for (const file of files) {
    const id = file.replace(/\.sql$/, "");
    const exists = await pool.query(
      "SELECT 1 FROM jm_schema_migrations WHERE id = $1", [id],
    );
    if (exists.rowCount && exists.rowCount > 0) {
      log.info(`skip ${id} (already applied)`);
      continue;
    }
    const sql = await readFile(join(__dirname, file), "utf8");
    log.info(`applying ${id}`);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query(
        "INSERT INTO jm_schema_migrations (id) VALUES ($1)", [id],
      );
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.DATABASE_URL;
  if (!url) { log.error("DATABASE_URL not set"); process.exit(1); }
  const pool = createPool({ connectionString: url });
  runMigrations(pool)
    .then(() => { log.info("migrations done"); return pool.end(); })
    .catch(err => { log.error(err, "migration failed"); process.exit(1); });
}
```

- [ ] **Step 4.4: Write the failing test**

```typescript
// packages/orchestrator/src/migrations/run-migrations.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { runMigrations } from "./run-migrations.ts";

const url = process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/journeyman_test";

describe("runMigrations", () => {
  let pool: Pool;
  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    await pool.query("DROP TABLE IF EXISTS jm_node_executions, jm_run_events, jm_runs, jm_flow_versions, jm_flows, jm_schema_migrations CASCADE");
  });
  afterAll(async () => { await pool.end(); });

  it("creates all Phase 1 tables and is idempotent", async () => {
    await runMigrations(pool);
    await runMigrations(pool); // second run must be no-op

    const tables = await pool.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name LIKE 'jm_%'
      ORDER BY table_name
    `);
    const names = tables.rows.map(r => r.table_name);
    expect(names).toEqual([
      "jm_flow_versions",
      "jm_flows",
      "jm_node_executions",
      "jm_run_events",
      "jm_runs",
      "jm_schema_migrations",
    ]);
  });
});
```

- [ ] **Step 4.5: Run the test (will FAIL — no DB yet)**

Run: `npm test -w @journeyman/orchestrator -- run-migrations.test`
Expected: FAIL with connection refused. This is fine — Task 5 brings up the DB.

- [ ] **Step 4.6: Commit (test will be re-run after Task 5)**

```bash
git add packages/orchestrator/src/migrations packages/orchestrator/src/stores/postgres/pg-pool.ts
git commit -m "feat(orchestrator): add Phase 1 SQL migrations and pg pool factory"
```

---

## Task 5: Local infra — Docker Compose with Conductor + Redis + Postgres

**Files:**
- Create: `infra/docker-compose.yml`
- Create: `infra/conductor-config/conductor.properties`
- Create: `infra/README.md`
- Modify: `package.json` (root) — add `infra:up`, `infra:down`, `migrate` scripts

- [ ] **Step 5.1: Write `infra/docker-compose.yml`**

```yaml
# infra/docker-compose.yml
# Local dev stack for Phase 1: Conductor + Redis + Postgres.
# Conductor uses the OSS image from Orkes.

version: "3.9"

services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: journeyman
    ports: ["5432:5432"]
    volumes: ["pgdata:/var/lib/postgresql/data"]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      retries: 10

  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      retries: 10

  conductor:
    image: orkesio/orkes-conductor-community-standalone:latest
    ports:
      - "8080:8080"   # Conductor REST API
      - "5000:5000"   # Conductor UI
    environment:
      - CONFIG_PROP=/app/config/conductor.properties
    volumes:
      - ./conductor-config:/app/config
    depends_on:
      redis:
        condition: service_healthy
      postgres:
        condition: service_healthy

volumes:
  pgdata:
```

- [ ] **Step 5.2: Write `infra/conductor-config/conductor.properties`**

```properties
# infra/conductor-config/conductor.properties
# Minimal standalone-mode config for local dev.

conductor.db.type=postgres
spring.datasource.url=jdbc:postgresql://postgres:5432/journeyman
spring.datasource.username=postgres
spring.datasource.password=postgres
spring.datasource.hikari.maximum-pool-size=10

conductor.queue.type=redis_standalone
conductor.redis.hosts=redis:6379:us-east-1
conductor.redis.workflowNamespacePrefix=conductor
conductor.redis.queueNamespacePrefix=conductor

conductor.app.workflowOffsetTimeout=PT30S
```

- [ ] **Step 5.3: Write `infra/README.md`**

```markdown
# Local Infra

Phase 1 stack: Postgres, Redis, Conductor.

## Bring up

```bash
npm run infra:up        # docker compose up -d
npm run migrate         # apply Journeyman SQL migrations against Postgres
```

## URLs

- Conductor REST: http://localhost:8080/api
- Conductor UI:   http://localhost:5000
- Postgres:       postgres://postgres:postgres@localhost:5432/journeyman
- Redis:          redis://localhost:6379

## Bring down

```bash
npm run infra:down      # docker compose down
npm run infra:reset     # docker compose down -v   (DESTROYS volumes)
```

## Test database

The vitest suite expects a separate test DB:

```bash
psql postgres://postgres:postgres@localhost:5432 -c "CREATE DATABASE journeyman_test"
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/journeyman_test npm test -w @journeyman/orchestrator
```
```

- [ ] **Step 5.4: Modify root `package.json` scripts**

Open `package.json` (the root one) and replace its `"scripts"` block with:

```json
"scripts": {
  "typecheck": "npm run typecheck --workspaces --if-present",
  "test": "npm test --workspaces --if-present",
  "start": "tsx packages/pipeline-server/src/cli-start.ts config/pipeline.yaml",
  "validate": "tsx packages/pipeline/src/cli.ts validate-config --config config/pipeline.yaml",
  "run-once": "tsx packages/pipeline/src/cli.ts run",
  "sweep": "tsx packages/pipeline/src/cli.ts sweep --config config/pipeline.yaml",
  "generate:schemas": "npm run generate:schemas -w packages/pipeline",
  "infra:up": "docker compose -f infra/docker-compose.yml up -d",
  "infra:down": "docker compose -f infra/docker-compose.yml down",
  "infra:reset": "docker compose -f infra/docker-compose.yml down -v",
  "migrate": "DATABASE_URL=${DATABASE_URL:-postgres://postgres:postgres@localhost:5432/journeyman} npm run migrate -w @journeyman/orchestrator",
  "start:api-server": "npm start -w @journeyman/api-server"
}
```

(Keep all existing keys, just add the four new ones.)

- [ ] **Step 5.5: Bring stack up and run migration test**

```bash
npm run infra:up
# Wait ~20 seconds for Conductor to come up
psql postgres://postgres:postgres@localhost:5432 -c "CREATE DATABASE IF NOT EXISTS journeyman_test" || \
  psql postgres://postgres:postgres@localhost:5432 -c "CREATE DATABASE journeyman_test"
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/journeyman_test npm test -w @journeyman/orchestrator
```
Expected: 1 test passes ("creates all Phase 1 tables and is idempotent").

- [ ] **Step 5.6: Commit**

```bash
git add infra package.json
git commit -m "feat(infra): add docker-compose stack (Conductor+Redis+Postgres) and infra scripts"
```

---

## Task 6: Memory store implementations + behavioral tests

The memory stores are the reference implementations: simple, easy to read, used in unit tests, and crucial for the "swap one adapter" architectural exit criterion.

**Files:**
- Create: `packages/orchestrator/src/stores/memory/memory-flow-store.ts`
- Create: `packages/orchestrator/src/stores/memory/memory-run-store.ts`
- Create: `packages/orchestrator/src/stores/memory/memory-event-bus.ts`
- Test: `packages/orchestrator/src/stores/memory/memory-flow-store.test.ts`

- [ ] **Step 6.1: Write the failing test for `MemoryFlowStore`**

```typescript
// packages/orchestrator/src/stores/memory/memory-flow-store.test.ts
import { describe, it, expect } from "vitest";
import { MemoryFlowStore, MemoryFlowVersionStore } from "./memory-flow-store.ts";
import { FLOW_SCHEMA_VERSION, type FlowDefinition } from "@journeyman/core";

const sampleDef: FlowDefinition = {
  schemaVersion: FLOW_SCHEMA_VERSION,
  nodes: [
    { id: "start", type: "start" },
    { id: "end", type: "end" },
  ],
  edges: [{ id: "e1", source: "start", target: "end" }],
};

describe("MemoryFlowStore", () => {
  it("creates a flow with an initial version", async () => {
    const versions = new MemoryFlowVersionStore();
    const flows = new MemoryFlowStore(versions);
    const { flow, version } = await flows.create({
      name: "demo",
      ownerUserId: null,
      initialDefinition: sampleDef,
      createdByUserId: null,
    });
    expect(flow.name).toBe("demo");
    expect(version.versionNumber).toBe(1);
    expect(flow.currentVersionId).toBe(version.id);
    expect(version.definition).toEqual(sampleDef);
  });

  it("appendVersion increments versionNumber", async () => {
    const versions = new MemoryFlowVersionStore();
    const flows = new MemoryFlowStore(versions);
    const { flow } = await flows.create({
      name: "x", ownerUserId: null, initialDefinition: sampleDef, createdByUserId: null,
    });
    const v2 = await versions.appendVersion({
      flowId: flow.id, definition: sampleDef, createdByUserId: null,
    });
    expect(v2.versionNumber).toBe(2);
    const list = await versions.listByFlow(flow.id);
    expect(list.map(v => v.versionNumber)).toEqual([1, 2]);
  });

  it("getById returns null for unknown id", async () => {
    const flows = new MemoryFlowStore(new MemoryFlowVersionStore());
    expect(await flows.getById("missing")).toBeNull();
  });
});
```

- [ ] **Step 6.2: Run test (FAIL — module not found)**

Run: `npm test -w @journeyman/orchestrator -- memory-flow-store.test`
Expected: FAIL — cannot find module `./memory-flow-store.ts`.

- [ ] **Step 6.3: Implement `memory-flow-store.ts`**

```typescript
// packages/orchestrator/src/stores/memory/memory-flow-store.ts
import { randomUUID } from "node:crypto";
import type {
  CreateFlowArgs, Flow, FlowDefinition, FlowVersion,
  IFlowStore, IFlowVersionStore,
} from "@journeyman/core";

export class MemoryFlowVersionStore implements IFlowVersionStore {
  private rows = new Map<string, FlowVersion>();

  async appendVersion(args: {
    flowId: string;
    definition: FlowDefinition;
    createdByUserId: string | null;
  }): Promise<FlowVersion> {
    const existing = [...this.rows.values()].filter(v => v.flowId === args.flowId);
    const next = existing.length === 0
      ? 1
      : Math.max(...existing.map(v => v.versionNumber)) + 1;
    const v: FlowVersion = {
      id: randomUUID(),
      flowId: args.flowId,
      versionNumber: next,
      definition: args.definition,
      createdByUserId: args.createdByUserId,
      createdAt: new Date(),
    };
    this.rows.set(v.id, v);
    return v;
  }

  async getById(versionId: string): Promise<FlowVersion | null> {
    return this.rows.get(versionId) ?? null;
  }

  async listByFlow(flowId: string): Promise<FlowVersion[]> {
    return [...this.rows.values()]
      .filter(v => v.flowId === flowId)
      .sort((a, b) => a.versionNumber - b.versionNumber);
  }
}

export class MemoryFlowStore implements IFlowStore {
  private rows = new Map<string, Flow>();

  constructor(private versions: MemoryFlowVersionStore) {}

  async create(args: CreateFlowArgs): Promise<{ flow: Flow; version: FlowVersion }> {
    const flowId = randomUUID();
    const version = await this.versions.appendVersion({
      flowId,
      definition: args.initialDefinition,
      createdByUserId: args.createdByUserId,
    });
    const now = new Date();
    const flow: Flow = {
      id: flowId,
      ownerUserId: args.ownerUserId,
      name: args.name,
      description: args.description ?? null,
      currentVersionId: version.id,
      createdAt: now,
      updatedAt: now,
    };
    this.rows.set(flowId, flow);
    return { flow, version };
  }

  async getById(flowId: string): Promise<Flow | null> {
    return this.rows.get(flowId) ?? null;
  }

  async list(opts: { ownerUserId?: string | null; limit?: number } = {}): Promise<Flow[]> {
    let out = [...this.rows.values()];
    if (opts.ownerUserId !== undefined) {
      out = out.filter(f => f.ownerUserId === opts.ownerUserId);
    }
    if (opts.limit) out = out.slice(0, opts.limit);
    return out;
  }
}
```

- [ ] **Step 6.4: Run test — should PASS**

Run: `npm test -w @journeyman/orchestrator -- memory-flow-store.test`
Expected: 3 tests pass.

- [ ] **Step 6.5: Implement `memory-run-store.ts`**

```typescript
// packages/orchestrator/src/stores/memory/memory-run-store.ts
import { randomUUID } from "node:crypto";
import type {
  CreateRunArgs, INodeExecutionStore, IRunStore, NodeExecution, Run, RunStatus,
} from "@journeyman/core";

export class MemoryRunStore implements IRunStore {
  private rows = new Map<string, Run>();

  async create(args: CreateRunArgs): Promise<Run> {
    const run: Run = {
      id: randomUUID(),
      flowVersionId: args.flowVersionId,
      status: "pending",
      triggerSource: args.triggerSource,
      startedByUserId: args.startedByUserId,
      engineWorkflowId: null,
      startedAt: null,
      completedAt: null,
      durationMs: null,
      failedAtNodeId: null,
      inputs: args.inputs,
      outputs: null,
    };
    this.rows.set(run.id, run);
    return run;
  }

  async getById(runId: string): Promise<Run | null> {
    return this.rows.get(runId) ?? null;
  }

  async setEngineWorkflowId(runId: string, engineWorkflowId: string): Promise<void> {
    const r = this.rows.get(runId);
    if (!r) return;
    this.rows.set(runId, { ...r, engineWorkflowId });
  }

  async setStatus(runId: string, status: RunStatus, opts: {
    failedAtNodeId?: string;
    completedAt?: Date;
    durationMs?: number;
    outputs?: Record<string, unknown>;
  } = {}): Promise<void> {
    const r = this.rows.get(runId);
    if (!r) return;
    this.rows.set(runId, {
      ...r,
      status,
      failedAtNodeId: opts.failedAtNodeId ?? r.failedAtNodeId,
      completedAt: opts.completedAt ?? r.completedAt,
      durationMs: opts.durationMs ?? r.durationMs,
      outputs: opts.outputs ?? r.outputs,
      startedAt: r.startedAt ?? (status === "running" ? new Date() : null),
    });
  }

  async list(opts: { flowId?: string; status?: RunStatus; limit?: number } = {}): Promise<Run[]> {
    let out = [...this.rows.values()];
    if (opts.status) out = out.filter(r => r.status === opts.status);
    if (opts.limit) out = out.slice(0, opts.limit);
    return out;
  }
}

export class MemoryNodeExecutionStore implements INodeExecutionStore {
  private rows = new Map<string, NodeExecution>();

  async upsert(execution: NodeExecution): Promise<void> {
    this.rows.set(execution.id, execution);
  }

  async listByRun(runId: string): Promise<NodeExecution[]> {
    return [...this.rows.values()].filter(x => x.runId === runId);
  }
}
```

- [ ] **Step 6.6: Implement `memory-event-bus.ts`**

```typescript
// packages/orchestrator/src/stores/memory/memory-event-bus.ts
import type { AppendEventArgs, IEventBus, RunEvent } from "@journeyman/core";

export class MemoryEventBus implements IEventBus {
  private rows: RunEvent[] = [];
  private nextId = 1;
  private listeners = new Map<string, Array<(ev: RunEvent) => void>>();

  async append(args: AppendEventArgs): Promise<RunEvent> {
    const ev: RunEvent = {
      id: this.nextId++,
      runId: args.runId,
      nodeId: args.nodeId ?? null,
      eventType: args.eventType,
      payload: args.payload,
      ts: new Date(),
    };
    this.rows.push(ev);
    for (const fn of (this.listeners.get(args.runId) ?? [])) fn(ev);
    return ev;
  }

  async list(runId: string, opts: { sinceId?: number; limit?: number } = {}): Promise<RunEvent[]> {
    let out = this.rows.filter(e => e.runId === runId);
    if (opts.sinceId !== undefined) out = out.filter(e => e.id > opts.sinceId!);
    if (opts.limit) out = out.slice(0, opts.limit);
    return out;
  }

  async *subscribe(runId: string, opts: { sinceId?: number } = {}): AsyncIterable<RunEvent> {
    // Replay history first
    for (const ev of await this.list(runId, opts)) yield ev;
    // Then live-stream
    const queue: RunEvent[] = [];
    let resolve: (() => void) | null = null;
    const push = (ev: RunEvent) => {
      queue.push(ev);
      if (resolve) { resolve(); resolve = null; }
    };
    const list = this.listeners.get(runId) ?? [];
    list.push(push);
    this.listeners.set(runId, list);
    try {
      while (true) {
        if (queue.length === 0) await new Promise<void>(r => { resolve = r; });
        while (queue.length) yield queue.shift()!;
      }
    } finally {
      const arr = this.listeners.get(runId) ?? [];
      this.listeners.set(runId, arr.filter(f => f !== push));
    }
  }
}
```

- [ ] **Step 6.7: Run typecheck and full test suite**

```bash
npm run typecheck -w @journeyman/orchestrator
npm test -w @journeyman/orchestrator
```
Expected: typecheck passes; the migrations test + the 3 memory-flow-store tests all pass.

- [ ] **Step 6.8: Commit**

```bash
git add packages/orchestrator/src/stores/memory
git commit -m "feat(orchestrator): add in-memory FlowStore/RunStore/EventBus + tests"
```

---

## Task 7: Postgres store implementations

Implement the same three stores against Postgres. Behavior must match the in-memory ones (same interfaces — that's the whole point).

**Files:**
- Create: `packages/orchestrator/src/stores/postgres/postgres-flow-store.ts`
- Create: `packages/orchestrator/src/stores/postgres/postgres-run-store.ts`
- Create: `packages/orchestrator/src/stores/postgres/postgres-event-bus.ts`
- Test: `packages/orchestrator/src/stores/postgres/postgres-flow-store.test.ts`

- [ ] **Step 7.1: Write `postgres-flow-store.test.ts` (failing)**

```typescript
// packages/orchestrator/src/stores/postgres/postgres-flow-store.test.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Pool } from "pg";
import { runMigrations } from "../../migrations/run-migrations.ts";
import { PostgresFlowStore, PostgresFlowVersionStore } from "./postgres-flow-store.ts";
import { FLOW_SCHEMA_VERSION, type FlowDefinition } from "@journeyman/core";

const url = process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/journeyman_test";
const sampleDef: FlowDefinition = {
  schemaVersion: FLOW_SCHEMA_VERSION,
  nodes: [{ id: "s", type: "start" }, { id: "e", type: "end" }],
  edges: [{ id: "e1", source: "s", target: "e" }],
};

describe("PostgresFlowStore", () => {
  let pool: Pool;
  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    await runMigrations(pool);
  });
  afterAll(async () => { await pool.end(); });
  beforeEach(async () => {
    await pool.query("TRUNCATE jm_flows, jm_flow_versions CASCADE");
  });

  it("creates a flow with an initial version", async () => {
    const versions = new PostgresFlowVersionStore(pool);
    const flows = new PostgresFlowStore(pool, versions);
    const { flow, version } = await flows.create({
      name: "demo", ownerUserId: null,
      initialDefinition: sampleDef, createdByUserId: null,
    });
    expect(flow.name).toBe("demo");
    expect(version.versionNumber).toBe(1);
    expect(flow.currentVersionId).toBe(version.id);
  });

  it("appendVersion increments correctly", async () => {
    const versions = new PostgresFlowVersionStore(pool);
    const flows = new PostgresFlowStore(pool, versions);
    const { flow } = await flows.create({
      name: "x", ownerUserId: null, initialDefinition: sampleDef, createdByUserId: null,
    });
    const v2 = await versions.appendVersion({
      flowId: flow.id, definition: sampleDef, createdByUserId: null,
    });
    expect(v2.versionNumber).toBe(2);
  });
});
```

- [ ] **Step 7.2: Run test (FAIL — module not found)**

Run: `TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/journeyman_test npm test -w @journeyman/orchestrator -- postgres-flow-store`
Expected: FAIL.

- [ ] **Step 7.3: Implement `postgres-flow-store.ts`**

```typescript
// packages/orchestrator/src/stores/postgres/postgres-flow-store.ts
import type { Pool } from "pg";
import type {
  CreateFlowArgs, Flow, FlowDefinition, FlowVersion,
  IFlowStore, IFlowVersionStore,
} from "@journeyman/core";

function rowToFlow(row: any): Flow {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    name: row.name,
    description: row.description,
    currentVersionId: row.current_version_id,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function rowToVersion(row: any): FlowVersion {
  return {
    id: row.id,
    flowId: row.flow_id,
    versionNumber: row.version_number,
    definition: row.definition as FlowDefinition,
    createdByUserId: row.created_by_user_id,
    createdAt: new Date(row.created_at),
  };
}

export class PostgresFlowVersionStore implements IFlowVersionStore {
  constructor(private pool: Pool) {}

  async appendVersion(args: {
    flowId: string;
    definition: FlowDefinition;
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
  constructor(private pool: Pool, private versions: PostgresFlowVersionStore) {}

  async create(args: CreateFlowArgs): Promise<{ flow: Flow; version: FlowVersion }> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET CONSTRAINTS ALL DEFERRED");
      const flowRes = await client.query(
        `INSERT INTO jm_flows (owner_user_id, name, description)
         VALUES ($1, $2, $3) RETURNING *`,
        [args.ownerUserId, args.name, args.description ?? null],
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
      const finalFlow = await client.query("SELECT * FROM jm_flows WHERE id = $1", [flowId]);
      await client.query("COMMIT");
      return {
        flow: rowToFlow(finalFlow.rows[0]),
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
    return rows[0] ? rowToFlow(rows[0]) : null;
  }

  async list(opts: { ownerUserId?: string | null; limit?: number } = {}): Promise<Flow[]> {
    const params: any[] = [];
    let where = "";
    if (opts.ownerUserId !== undefined) {
      params.push(opts.ownerUserId);
      where = `WHERE owner_user_id ${opts.ownerUserId === null ? "IS NULL" : "= $1"}`;
      if (opts.ownerUserId === null) params.pop();
    }
    const limit = opts.limit ? `LIMIT ${Number(opts.limit)}` : "";
    const { rows } = await this.pool.query(
      `SELECT * FROM jm_flows ${where} ORDER BY created_at DESC ${limit}`, params,
    );
    return rows.map(rowToFlow);
  }
}
```

- [ ] **Step 7.4: Run test — should PASS**

Run: `TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/journeyman_test npm test -w @journeyman/orchestrator -- postgres-flow-store`
Expected: 2 tests pass.

- [ ] **Step 7.5: Implement `postgres-run-store.ts`**

```typescript
// packages/orchestrator/src/stores/postgres/postgres-run-store.ts
import type { Pool } from "pg";
import type {
  CreateRunArgs, INodeExecutionStore, IRunStore, NodeExecution, Run, RunStatus,
} from "@journeyman/core";

function rowToRun(row: any): Run {
  return {
    id: row.id,
    flowVersionId: row.flow_version_id,
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

export class PostgresRunStore implements IRunStore {
  constructor(private pool: Pool) {}

  async create(args: CreateRunArgs): Promise<Run> {
    const { rows } = await this.pool.query(
      `INSERT INTO jm_runs (flow_version_id, status, trigger_source, started_by_user_id, inputs)
       VALUES ($1, 'pending', $2, $3, $4::jsonb) RETURNING *`,
      [args.flowVersionId, args.triggerSource, args.startedByUserId, JSON.stringify(args.inputs)],
    );
    return rowToRun(rows[0]);
  }

  async getById(runId: string): Promise<Run | null> {
    const { rows } = await this.pool.query("SELECT * FROM jm_runs WHERE id = $1", [runId]);
    return rows[0] ? rowToRun(rows[0]) : null;
  }

  async setEngineWorkflowId(runId: string, engineWorkflowId: string): Promise<void> {
    await this.pool.query(
      "UPDATE jm_runs SET engine_workflow_id = $1 WHERE id = $2", [engineWorkflowId, runId],
    );
  }

  async setStatus(runId: string, status: RunStatus, opts: {
    failedAtNodeId?: string;
    completedAt?: Date;
    durationMs?: number;
    outputs?: Record<string, unknown>;
  } = {}): Promise<void> {
    await this.pool.query(
      `UPDATE jm_runs SET
         status = $1,
         failed_at_node_id = COALESCE($2, failed_at_node_id),
         completed_at = COALESCE($3, completed_at),
         duration_ms = COALESCE($4, duration_ms),
         outputs = COALESCE($5::jsonb, outputs),
         started_at = COALESCE(started_at, CASE WHEN $1 = 'running' THEN now() ELSE NULL END)
       WHERE id = $6`,
      [
        status,
        opts.failedAtNodeId ?? null,
        opts.completedAt ?? null,
        opts.durationMs ?? null,
        opts.outputs ? JSON.stringify(opts.outputs) : null,
        runId,
      ],
    );
  }

  async list(opts: { flowId?: string; status?: RunStatus; limit?: number } = {}): Promise<Run[]> {
    const conds: string[] = [];
    const params: any[] = [];
    if (opts.status) { params.push(opts.status); conds.push(`status = $${params.length}`); }
    if (opts.flowId) {
      params.push(opts.flowId);
      conds.push(`flow_version_id IN (SELECT id FROM jm_flow_versions WHERE flow_id = $${params.length})`);
    }
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    const limit = opts.limit ? `LIMIT ${Number(opts.limit)}` : "LIMIT 100";
    const { rows } = await this.pool.query(
      `SELECT * FROM jm_runs ${where} ORDER BY created_at DESC ${limit}`, params,
    );
    return rows.map(rowToRun);
  }
}

function rowToExec(row: any): NodeExecution {
  return {
    id: row.id,
    runId: row.run_id,
    nodeId: row.node_id,
    attempt: row.attempt,
    status: row.status,
    startedAt: row.started_at ? new Date(row.started_at) : null,
    completedAt: row.completed_at ? new Date(row.completed_at) : null,
    input: row.input ?? {},
    output: row.output,
    errorClass: row.error_class,
    errorMessage: row.error_message,
  };
}

export class PostgresNodeExecutionStore implements INodeExecutionStore {
  constructor(private pool: Pool) {}

  async upsert(e: NodeExecution): Promise<void> {
    await this.pool.query(
      `INSERT INTO jm_node_executions
         (id, run_id, node_id, attempt, status, started_at, completed_at,
          input, output, error_class, error_message)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, $11)
       ON CONFLICT (run_id, node_id, attempt) DO UPDATE SET
         status = EXCLUDED.status,
         started_at = EXCLUDED.started_at,
         completed_at = EXCLUDED.completed_at,
         output = EXCLUDED.output,
         error_class = EXCLUDED.error_class,
         error_message = EXCLUDED.error_message`,
      [
        e.id, e.runId, e.nodeId, e.attempt, e.status,
        e.startedAt, e.completedAt,
        JSON.stringify(e.input),
        e.output ? JSON.stringify(e.output) : null,
        e.errorClass, e.errorMessage,
      ],
    );
  }

  async listByRun(runId: string): Promise<NodeExecution[]> {
    const { rows } = await this.pool.query(
      "SELECT * FROM jm_node_executions WHERE run_id = $1 ORDER BY started_at NULLS LAST",
      [runId],
    );
    return rows.map(rowToExec);
  }
}
```

- [ ] **Step 7.6: Implement `postgres-event-bus.ts`**

```typescript
// packages/orchestrator/src/stores/postgres/postgres-event-bus.ts
import type { Pool } from "pg";
import type { AppendEventArgs, IEventBus, RunEvent } from "@journeyman/core";

function rowToEvent(row: any): RunEvent {
  return {
    id: Number(row.id),
    runId: row.run_id,
    nodeId: row.node_id,
    eventType: row.event_type,
    payload: row.payload ?? {},
    ts: new Date(row.ts),
  };
}

export class PostgresEventBus implements IEventBus {
  constructor(private pool: Pool, private pollIntervalMs: number = 500) {}

  async append(args: AppendEventArgs): Promise<RunEvent> {
    const { rows } = await this.pool.query(
      `INSERT INTO jm_run_events (run_id, node_id, event_type, payload)
       VALUES ($1, $2, $3, $4::jsonb) RETURNING *`,
      [args.runId, args.nodeId ?? null, args.eventType, JSON.stringify(args.payload)],
    );
    return rowToEvent(rows[0]);
  }

  async list(runId: string, opts: { sinceId?: number; limit?: number } = {}): Promise<RunEvent[]> {
    const params: any[] = [runId];
    let cond = "";
    if (opts.sinceId !== undefined) { params.push(opts.sinceId); cond = `AND id > $${params.length}`; }
    const limit = opts.limit ? `LIMIT ${Number(opts.limit)}` : "";
    const { rows } = await this.pool.query(
      `SELECT * FROM jm_run_events WHERE run_id = $1 ${cond} ORDER BY id ${limit}`, params,
    );
    return rows.map(rowToEvent);
  }

  async *subscribe(runId: string, opts: { sinceId?: number } = {}): AsyncIterable<RunEvent> {
    let last = opts.sinceId ?? 0;
    while (true) {
      const batch = await this.list(runId, { sinceId: last });
      for (const ev of batch) { yield ev; last = ev.id; }
      await new Promise(r => setTimeout(r, this.pollIntervalMs));
    }
  }
}
```

(Note: SSE-grade `LISTEN/NOTIFY` is a Phase 3 concern. Polling is fine for Phase 1.)

- [ ] **Step 7.7: Run typecheck and tests**

```bash
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/journeyman_test \
  npm run typecheck -w @journeyman/orchestrator && \
  npm test -w @journeyman/orchestrator
```
Expected: typecheck passes; all existing tests pass.

- [ ] **Step 7.8: Commit**

```bash
git add packages/orchestrator/src/stores/postgres
git commit -m "feat(orchestrator): add Postgres FlowStore/RunStore/EventBus"
```

---

## Task 8: `JsonLogicEvaluator` (condition adapter)

**Files:**
- Create: `packages/orchestrator/src/conditions/jsonlogic-evaluator.ts`
- Test: `packages/orchestrator/src/conditions/jsonlogic-evaluator.test.ts`

- [ ] **Step 8.1: Write failing test**

```typescript
// packages/orchestrator/src/conditions/jsonlogic-evaluator.test.ts
import { describe, it, expect } from "vitest";
import { JsonLogicEvaluator } from "./jsonlogic-evaluator.ts";

describe("JsonLogicEvaluator", () => {
  const ev = new JsonLogicEvaluator();

  it("evaluates a simple equality", () => {
    expect(ev.evaluate({ "==": [{ var: "x" }, 1] }, { x: 1 })).toBe(true);
    expect(ev.evaluate({ "==": [{ var: "x" }, 1] }, { x: 2 })).toBe(false);
  });

  it("returns false for null/undefined expression (no condition = true at engine level, but evaluator says false)", () => {
    expect(ev.evaluate(null, {})).toBe(false);
    expect(ev.evaluate(undefined, {})).toBe(false);
  });

  it("coerces truthy/falsy", () => {
    expect(ev.evaluate({ "!!": [{ var: "x" }] }, { x: "hi" })).toBe(true);
    expect(ev.evaluate({ "!!": [{ var: "x" }] }, { x: "" })).toBe(false);
  });
});
```

- [ ] **Step 8.2: Run test (FAIL)**

Run: `npm test -w @journeyman/orchestrator -- jsonlogic-evaluator`
Expected: FAIL — module not found.

- [ ] **Step 8.3: Implement**

```typescript
// packages/orchestrator/src/conditions/jsonlogic-evaluator.ts
import jsonLogic from "json-logic-js";
import type { IConditionEvaluator } from "@journeyman/core";

export class JsonLogicEvaluator implements IConditionEvaluator {
  evaluate(expression: unknown, data: Record<string, unknown>): boolean {
    if (expression == null) return false;
    return Boolean(jsonLogic.apply(expression as any, data));
  }
}
```

- [ ] **Step 8.4: Run test — PASS**

Run: `npm test -w @journeyman/orchestrator -- jsonlogic-evaluator`
Expected: 3 tests pass.

- [ ] **Step 8.5: Commit**

```bash
git add packages/orchestrator/src/conditions
git commit -m "feat(orchestrator): add JsonLogicEvaluator (IConditionEvaluator impl)"
```

---

## Task 9: `EnvCredentialStore`, `NoAuthProvider`, `DirectoryWorkspaceProvider`, `InMemoryPhaseRegistry`

Four trivial adapter implementations. One commit at the end.

**Files:**
- Create: `packages/orchestrator/src/credentials/env-credential-store.ts`
- Create: `packages/orchestrator/src/auth/no-auth-provider.ts`
- Create: `packages/orchestrator/src/workspace/directory-workspace-provider.ts`
- Create: `packages/orchestrator/src/registry/in-memory-phase-registry.ts`
- Test: `packages/orchestrator/src/registry/in-memory-phase-registry.test.ts`

- [ ] **Step 9.1: Write `env-credential-store.ts`**

```typescript
// packages/orchestrator/src/credentials/env-credential-store.ts
import {
  CredentialNotFoundError,
  type CredentialRef,
  type ICredentialStore,
} from "@journeyman/core";

/**
 * v1 credential store: refs are env-var names. e.g. ref `"env:GITHUB_TOKEN"`
 * resolves to `process.env.GITHUB_TOKEN`. Throws if missing.
 */
export class EnvCredentialStore implements ICredentialStore {
  constructor(private env: NodeJS.ProcessEnv = process.env) {}

  async resolve(
    refs: Record<string, CredentialRef>,
    _scope: { userId: string | null; flowId: string | null },
  ): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    for (const [varName, ref] of Object.entries(refs)) {
      const m = /^env:(.+)$/.exec(ref);
      if (!m) throw new CredentialNotFoundError(ref);
      const value = this.env[m[1]];
      if (value === undefined) throw new CredentialNotFoundError(ref);
      out[varName] = value;
    }
    return out;
  }
}
```

- [ ] **Step 9.2: Write `no-auth-provider.ts`**

```typescript
// packages/orchestrator/src/auth/no-auth-provider.ts
import type { FastifyRequest } from "fastify";
import type { IAuthProvider, IUserContext } from "@journeyman/core";

export class NoAuthProvider implements IAuthProvider {
  async authenticate(_req: FastifyRequest): Promise<IUserContext> {
    return { userId: null, roles: ["anonymous"] };
  }
}
```

- [ ] **Step 9.3: Write `directory-workspace-provider.ts`**

```typescript
// packages/orchestrator/src/workspace/directory-workspace-provider.ts
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { IWorkspace, IWorkspaceProvider } from "@journeyman/core";

export interface DirectoryWorkspaceConfig {
  baseDir?: string;
}

export class DirectoryWorkspaceProvider implements IWorkspaceProvider {
  constructor(private cfg: DirectoryWorkspaceConfig = {}) {}

  async create(opts: { runId: string; nodeId: string }): Promise<IWorkspace> {
    const base = this.cfg.baseDir ?? join(tmpdir(), "journeyman-workspaces");
    const path = join(base, opts.runId, opts.nodeId);
    await mkdir(path, { recursive: true });
    return {
      path,
      destroy: async () => { await rm(path, { recursive: true, force: true }); },
    };
  }
}
```

- [ ] **Step 9.4: Write the failing test for `InMemoryPhaseRegistry`**

```typescript
// packages/orchestrator/src/registry/in-memory-phase-registry.test.ts
import { describe, it, expect } from "vitest";
import { InMemoryPhaseRegistry } from "./in-memory-phase-registry.ts";
import type { IPhaseHandler } from "@journeyman/core";

const fake: IPhaseHandler = {
  phaseType: "fake",
  async run() { return { kind: "success", output: {} }; },
};

describe("InMemoryPhaseRegistry", () => {
  it("registers and retrieves a handler", () => {
    const r = new InMemoryPhaseRegistry();
    r.register(fake);
    expect(r.get("fake")?.phaseType).toBe("fake");
    expect(r.get("missing")).toBeNull();
    expect(r.list()).toHaveLength(1);
  });

  it("throws on duplicate registration", () => {
    const r = new InMemoryPhaseRegistry();
    r.register(fake);
    expect(() => r.register(fake)).toThrow(/already registered/);
  });
});
```

- [ ] **Step 9.5: Implement `in-memory-phase-registry.ts`**

```typescript
// packages/orchestrator/src/registry/in-memory-phase-registry.ts
import type { IPhaseHandler, IPhaseRegistry } from "@journeyman/core";

export class InMemoryPhaseRegistry implements IPhaseRegistry {
  private byType = new Map<string, IPhaseHandler>();

  register(handler: IPhaseHandler): void {
    if (this.byType.has(handler.phaseType)) {
      throw new Error(`Phase '${handler.phaseType}' already registered`);
    }
    this.byType.set(handler.phaseType, handler);
  }

  get(phaseType: string): IPhaseHandler | null {
    return this.byType.get(phaseType) ?? null;
  }

  list(): IPhaseHandler[] {
    return [...this.byType.values()];
  }
}
```

- [ ] **Step 9.6: Run typecheck and tests**

```bash
npm run typecheck -w @journeyman/orchestrator
npm test -w @journeyman/orchestrator
```
Expected: all pass.

- [ ] **Step 9.7: Commit**

```bash
git add packages/orchestrator/src/credentials \
        packages/orchestrator/src/auth \
        packages/orchestrator/src/workspace \
        packages/orchestrator/src/registry
git commit -m "feat(orchestrator): add Env credentials, NoAuth, DirectoryWorkspace, InMemoryPhaseRegistry"
```

---

## Task 10: Conductor JSON converter

**Files:**
- Create: `packages/orchestrator/src/flow-json/conductor-converter.ts`
- Test: `packages/orchestrator/src/flow-json/conductor-converter.test.ts`

- [ ] **Step 10.1: Write the failing test**

```typescript
// packages/orchestrator/src/flow-json/conductor-converter.test.ts
import { describe, it, expect } from "vitest";
import { ConductorJsonConverter, UnsupportedNodeTypeError } from "./conductor-converter.ts";
import { FLOW_SCHEMA_VERSION, type FlowDefinition } from "@journeyman/core";

const linear: FlowDefinition = {
  schemaVersion: FLOW_SCHEMA_VERSION,
  nodes: [
    { id: "start", type: "start" },
    { id: "step1", type: "phase", phaseType: "analyze", config: { dirPath: "/tmp/x" } },
    { id: "end", type: "end" },
  ],
  edges: [
    { id: "e1", source: "start", target: "step1" },
    { id: "e2", source: "step1", target: "end" },
  ],
};

describe("ConductorJsonConverter", () => {
  const c = new ConductorJsonConverter();

  it("converts a 1-phase linear flow into a Conductor workflow def", () => {
    const out = c.toEngineJson(linear, { workflowName: "wf_demo", workflowVersion: 1 });
    expect(out.name).toBe("wf_demo");
    expect(out.version).toBe(1);
    expect(out.tasks).toHaveLength(1);
    expect(out.tasks[0].taskReferenceName).toBe("step1");
    expect(out.tasks[0].name).toBe("analyze");
    expect(out.tasks[0].type).toBe("SIMPLE");
    expect(out.tasks[0].inputParameters).toEqual({ dirPath: "/tmp/x" });
  });

  it("rejects unsupported node types in Phase 1", () => {
    const def: FlowDefinition = {
      schemaVersion: FLOW_SCHEMA_VERSION,
      nodes: [
        { id: "start", type: "start" },
        { id: "x", type: "gateway-xor" },
        { id: "end", type: "end" },
      ],
      edges: [
        { id: "e1", source: "start", target: "x" },
        { id: "e2", source: "x", target: "end" },
      ],
    };
    expect(() => c.toEngineJson(def, { workflowName: "wf", workflowVersion: 1 }))
      .toThrow(UnsupportedNodeTypeError);
  });

  it("rejects flows that aren't linear in Phase 1", () => {
    const def: FlowDefinition = {
      schemaVersion: FLOW_SCHEMA_VERSION,
      nodes: [
        { id: "start", type: "start" },
        { id: "a", type: "phase", phaseType: "analyze" },
        { id: "b", type: "phase", phaseType: "analyze" },
        { id: "end", type: "end" },
      ],
      edges: [
        { id: "e1", source: "start", target: "a" },
        { id: "e2", source: "start", target: "b" }, // start has TWO outgoing — branching not allowed yet
        { id: "e3", source: "a", target: "end" },
        { id: "e4", source: "b", target: "end" },
      ],
    };
    expect(() => c.toEngineJson(def, { workflowName: "wf", workflowVersion: 1 }))
      .toThrow(/linear/i);
  });
});
```

- [ ] **Step 10.2: Run test (FAIL)**

Run: `npm test -w @journeyman/orchestrator -- conductor-converter`
Expected: FAIL — module not found.

- [ ] **Step 10.3: Implement**

```typescript
// packages/orchestrator/src/flow-json/conductor-converter.ts
import type {
  FlowDefinition, FlowNode, IFlowJsonConverter,
} from "@journeyman/core";

export interface ConductorTaskDef {
  name: string;
  taskReferenceName: string;
  type: "SIMPLE";
  inputParameters: Record<string, unknown>;
}

export interface ConductorWorkflowDef {
  name: string;
  version: number;
  schemaVersion: 2;
  tasks: ConductorTaskDef[];
}

export class UnsupportedNodeTypeError extends Error {
  constructor(public readonly nodeType: string) {
    super(`Node type '${nodeType}' is not supported in Phase 1`);
    this.name = "UnsupportedNodeTypeError";
  }
}

export class ConductorJsonConverter implements IFlowJsonConverter<ConductorWorkflowDef> {
  toEngineJson(def: FlowDefinition, opts: {
    workflowName: string;
    workflowVersion: number;
  }): ConductorWorkflowDef {
    // Phase 1 supports linear only: exactly one start, one end, each node has
    // at most one outgoing edge, and the path through `phase` nodes is unique.
    const nodesById = new Map(def.nodes.map(n => [n.id, n]));
    const outgoing = new Map<string, string[]>();
    for (const e of def.edges) {
      const arr = outgoing.get(e.source) ?? [];
      arr.push(e.target);
      outgoing.set(e.source, arr);
    }

    // Validate types
    for (const n of def.nodes) {
      if (!["start", "end", "phase"].includes(n.type)) {
        throw new UnsupportedNodeTypeError(n.type);
      }
    }

    // Find start
    const starts = def.nodes.filter(n => n.type === "start");
    if (starts.length !== 1) throw new Error("Flow must have exactly one start node");
    const ends = def.nodes.filter(n => n.type === "end");
    if (ends.length !== 1) throw new Error("Phase 1 supports exactly one end node");

    // Walk the chain
    const tasks: ConductorTaskDef[] = [];
    let current = starts[0].id;
    const visited = new Set<string>();
    while (true) {
      if (visited.has(current)) throw new Error("Cycles are not supported in Phase 1");
      visited.add(current);
      const next = outgoing.get(current) ?? [];
      if (next.length > 1) {
        throw new Error("Flow must be linear in Phase 1 (no branching)");
      }
      if (next.length === 0) break;
      const node = nodesById.get(next[0])!;
      if (node.type === "phase") {
        if (!node.phaseType) throw new Error(`Phase node '${node.id}' missing phaseType`);
        tasks.push(toSimpleTask(node));
      }
      current = node.id;
    }

    return {
      name: opts.workflowName,
      version: opts.workflowVersion,
      schemaVersion: 2,
      tasks,
    };
  }
}

function toSimpleTask(node: FlowNode): ConductorTaskDef {
  return {
    name: node.phaseType!,
    taskReferenceName: node.id,
    type: "SIMPLE",
    inputParameters: { ...(node.config ?? {}) },
  };
}
```

- [ ] **Step 10.4: Run test — PASS**

Run: `npm test -w @journeyman/orchestrator -- conductor-converter`
Expected: 3 tests pass.

- [ ] **Step 10.5: Commit**

```bash
git add packages/orchestrator/src/flow-json
git commit -m "feat(orchestrator): add ConductorJsonConverter (linear flows only, Phase 1)"
```

---

## Task 11: Conductor REST client + `ConductorOrchestrator`

**Files:**
- Create: `packages/orchestrator/src/engines/conductor/conductor-client.ts`
- Create: `packages/orchestrator/src/engines/conductor/conductor-orchestrator.ts`
- Test: `packages/orchestrator/src/engines/conductor/conductor-orchestrator.test.ts`

- [ ] **Step 11.1: Write `conductor-client.ts`**

```typescript
// packages/orchestrator/src/engines/conductor/conductor-client.ts
import { createLogger } from "@journeyman/core";

const log = createLogger("conductor:client");

export interface ConductorClientConfig {
  baseUrl: string;     // e.g. "http://localhost:8080/api"
  fetchImpl?: typeof fetch;
}

export interface PolledTask {
  taskId: string;
  workflowInstanceId: string;
  taskDefName: string;
  inputData: Record<string, unknown>;
  retryCount: number;
}

export interface TaskCompletionBody {
  workflowInstanceId: string;
  taskId: string;
  status: "COMPLETED" | "FAILED" | "FAILED_WITH_TERMINAL_ERROR";
  outputData?: Record<string, unknown>;
  reasonForIncompletion?: string;
}

export class ConductorClient {
  private fetcher: typeof fetch;
  constructor(private cfg: ConductorClientConfig) {
    this.fetcher = cfg.fetchImpl ?? fetch;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const url = `${this.cfg.baseUrl}${path}`;
    const res = await this.fetcher(url, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
    });
    if (!res.ok) {
      const body = await res.text();
      log.error({ url, status: res.status, body }, "Conductor request failed");
      throw new Error(`Conductor ${init.method ?? "GET"} ${path} → ${res.status}: ${body}`);
    }
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    return text ? JSON.parse(text) as T : undefined as T;
  }

  /** Register or update a workflow definition. */
  async putWorkflowDef(def: unknown): Promise<void> {
    await this.request("/metadata/workflow", { method: "PUT", body: JSON.stringify([def]) });
  }

  /** Register a task definition (the worker will poll for these). */
  async putTaskDef(def: unknown): Promise<void> {
    await this.request("/metadata/taskdefs", { method: "POST", body: JSON.stringify([def]) });
  }

  /** Start a workflow execution. Returns workflow id. */
  async startWorkflow(args: {
    name: string;
    version?: number;
    input: Record<string, unknown>;
  }): Promise<string> {
    return await this.request<string>("/workflow", {
      method: "POST",
      body: JSON.stringify({
        name: args.name,
        version: args.version,
        input: args.input,
      }),
    });
  }

  async getWorkflow(workflowId: string): Promise<{
    workflowId: string;
    status: "RUNNING" | "COMPLETED" | "FAILED" | "TERMINATED" | "PAUSED" | "TIMED_OUT";
    output?: Record<string, unknown>;
  }> {
    return await this.request(`/workflow/${workflowId}?includeTasks=false`);
  }

  async terminate(workflowId: string, reason?: string): Promise<void> {
    const q = reason ? `?reason=${encodeURIComponent(reason)}` : "";
    await this.request(`/workflow/${workflowId}${q}`, { method: "DELETE" });
  }

  async pollTask(taskType: string, workerId: string): Promise<PolledTask | null> {
    const r = await this.request<PolledTask | null>(
      `/tasks/poll/${encodeURIComponent(taskType)}?workerid=${encodeURIComponent(workerId)}`,
    );
    return r ?? null;
  }

  async ackTask(taskId: string, workerId: string): Promise<boolean> {
    return await this.request<boolean>(
      `/tasks/${taskId}/ack?workerid=${encodeURIComponent(workerId)}`,
      { method: "POST" },
    );
  }

  async completeTask(body: TaskCompletionBody): Promise<void> {
    await this.request(`/tasks`, { method: "POST", body: JSON.stringify(body) });
  }
}
```

- [ ] **Step 11.2: Write the failing test for `ConductorOrchestrator`**

```typescript
// packages/orchestrator/src/engines/conductor/conductor-orchestrator.test.ts
import { describe, it, expect, vi } from "vitest";
import { ConductorOrchestrator } from "./conductor-orchestrator.ts";
import { ConductorJsonConverter } from "../../flow-json/conductor-converter.ts";
import { MemoryRunStore } from "../../stores/memory/memory-run-store.ts";
import { MemoryFlowStore, MemoryFlowVersionStore } from "../../stores/memory/memory-flow-store.ts";
import { FLOW_SCHEMA_VERSION, type FlowDefinition } from "@journeyman/core";

const def: FlowDefinition = {
  schemaVersion: FLOW_SCHEMA_VERSION,
  nodes: [
    { id: "s", type: "start" },
    { id: "a", type: "phase", phaseType: "analyze", config: {} },
    { id: "e", type: "end" },
  ],
  edges: [
    { id: "e1", source: "s", target: "a" },
    { id: "e2", source: "a", target: "e" },
  ],
};

describe("ConductorOrchestrator", () => {
  it("submit() registers the workflow def, starts it, and persists run state", async () => {
    const fakeClient = {
      putWorkflowDef: vi.fn().mockResolvedValue(undefined),
      putTaskDef: vi.fn().mockResolvedValue(undefined),
      startWorkflow: vi.fn().mockResolvedValue("wf-instance-123"),
      getWorkflow: vi.fn().mockResolvedValue({ workflowId: "wf-instance-123", status: "RUNNING" }),
      terminate: vi.fn().mockResolvedValue(undefined),
    };
    const versions = new MemoryFlowVersionStore();
    const flows = new MemoryFlowStore(versions);
    const { version } = await flows.create({
      name: "demo", ownerUserId: null, initialDefinition: def, createdByUserId: null,
    });
    const runs = new MemoryRunStore();
    const orch = new ConductorOrchestrator({
      client: fakeClient as any,
      converter: new ConductorJsonConverter(),
      runs,
    });

    const { runId, engineWorkflowId } = await orch.submit({
      flowVersionId: version.id, flowDefinition: def,
      inputs: { foo: "bar" }, startedByUserId: null,
    });

    expect(engineWorkflowId).toBe("wf-instance-123");
    expect(fakeClient.putWorkflowDef).toHaveBeenCalledOnce();
    expect(fakeClient.startWorkflow).toHaveBeenCalledOnce();
    const persisted = await runs.getById(runId);
    expect(persisted?.engineWorkflowId).toBe("wf-instance-123");
  });
});
```

- [ ] **Step 11.3: Run test (FAIL)**

Run: `npm test -w @journeyman/orchestrator -- conductor-orchestrator`
Expected: FAIL — module not found.

- [ ] **Step 11.4: Implement `conductor-orchestrator.ts`**

```typescript
// packages/orchestrator/src/engines/conductor/conductor-orchestrator.ts
import type {
  IOrchestratorEngine, IRunStore, Run, RunStatus, SubmitRunArgs,
} from "@journeyman/core";
import type { ConductorClient } from "./conductor-client.ts";
import type { IFlowJsonConverter } from "@journeyman/core";
import type { ConductorWorkflowDef } from "../../flow-json/conductor-converter.ts";

export interface ConductorOrchestratorDeps {
  client: ConductorClient;
  converter: IFlowJsonConverter<ConductorWorkflowDef>;
  runs: IRunStore;
}

export class ConductorOrchestrator implements IOrchestratorEngine {
  constructor(private deps: ConductorOrchestratorDeps) {}

  async submit(args: SubmitRunArgs): Promise<{ runId: string; engineWorkflowId: string }> {
    // 1. Convert flow → workflow def
    const wfName = `journeyman_v${args.flowVersionId}`;
    const wfDef = this.deps.converter.toEngineJson(args.flowDefinition, {
      workflowName: wfName, workflowVersion: 1,
    });

    // 2. Register workflow def with Conductor (idempotent)
    await this.deps.client.putWorkflowDef(wfDef);

    // 3. Persist a Run row in `pending`
    const run = await this.deps.runs.create({
      flowVersionId: args.flowVersionId,
      triggerSource: "api",
      startedByUserId: args.startedByUserId,
      inputs: args.inputs,
    });

    // 4. Start the workflow
    const engineWorkflowId = await this.deps.client.startWorkflow({
      name: wfName, version: 1, input: args.inputs,
    });

    // 5. Update run with engine id and mark running
    await this.deps.runs.setEngineWorkflowId(run.id, engineWorkflowId);
    await this.deps.runs.setStatus(run.id, "running");

    return { runId: run.id, engineWorkflowId };
  }

  async getRun(runId: string): Promise<Run | null> {
    return await this.deps.runs.getById(runId);
  }

  async cancel(runId: string, reason?: string): Promise<void> {
    const r = await this.deps.runs.getById(runId);
    if (!r?.engineWorkflowId) return;
    await this.deps.client.terminate(r.engineWorkflowId, reason);
    await this.deps.runs.setStatus(runId, "cancelled");
  }

  async syncStatus(runId: string): Promise<RunStatus> {
    const r = await this.deps.runs.getById(runId);
    if (!r?.engineWorkflowId) return r?.status ?? "pending";
    const live = await this.deps.client.getWorkflow(r.engineWorkflowId);
    const mapped = mapConductorStatus(live.status);
    if (mapped !== r.status) {
      const completedAt = ["completed", "failed", "cancelled"].includes(mapped)
        ? new Date() : undefined;
      const durationMs = completedAt && r.startedAt
        ? completedAt.getTime() - r.startedAt.getTime() : undefined;
      await this.deps.runs.setStatus(runId, mapped, {
        completedAt, durationMs,
        outputs: live.output,
      });
    }
    return mapped;
  }
}

function mapConductorStatus(s: string): RunStatus {
  switch (s) {
    case "RUNNING": return "running";
    case "COMPLETED": return "completed";
    case "FAILED": case "TIMED_OUT": return "failed";
    case "PAUSED": return "paused";
    case "TERMINATED": return "cancelled";
    default: return "pending";
  }
}
```

- [ ] **Step 11.5: Run test — PASS**

Run: `npm test -w @journeyman/orchestrator -- conductor-orchestrator`
Expected: 1 test passes.

- [ ] **Step 11.6: Commit**

```bash
git add packages/orchestrator/src/engines
git commit -m "feat(orchestrator): add Conductor REST client and ConductorOrchestrator"
```

---

## Task 12: Worker harness + analyze phase handler

**Files:**
- Create: `packages/orchestrator/src/workers/worker-harness.ts`
- Create: `packages/orchestrator/src/workers/phases/analyze-phase-handler.ts`
- Test: `packages/orchestrator/src/workers/worker-harness.test.ts`

- [ ] **Step 12.1: Write the failing test**

```typescript
// packages/orchestrator/src/workers/worker-harness.test.ts
import { describe, it, expect, vi } from "vitest";
import { WorkerHarness } from "./worker-harness.ts";
import { InMemoryPhaseRegistry } from "../registry/in-memory-phase-registry.ts";
import { DirectoryWorkspaceProvider } from "../workspace/directory-workspace-provider.ts";
import { EnvCredentialStore } from "../credentials/env-credential-store.ts";
import { MemoryEventBus } from "../stores/memory/memory-event-bus.ts";
import type { IPhaseHandler } from "@journeyman/core";

describe("WorkerHarness", () => {
  it("polls a task, dispatches to the handler, completes it on success", async () => {
    const handler: IPhaseHandler = {
      phaseType: "fake",
      run: vi.fn().mockResolvedValue({ kind: "success", output: { ok: true } }),
    };
    const registry = new InMemoryPhaseRegistry();
    registry.register(handler);

    const polled = {
      taskId: "t1",
      workflowInstanceId: "wf1",
      taskDefName: "fake",
      inputData: { foo: 1 },
      retryCount: 0,
    };
    const client = {
      pollTask: vi.fn().mockResolvedValueOnce(polled).mockResolvedValue(null),
      ackTask: vi.fn().mockResolvedValue(true),
      completeTask: vi.fn().mockResolvedValue(undefined),
    };

    const harness = new WorkerHarness({
      client: client as any,
      registry,
      workspace: new DirectoryWorkspaceProvider(),
      credentials: new EnvCredentialStore({}),
      events: new MemoryEventBus(),
      workerId: "test-worker",
      pollIntervalMs: 1,
    });

    await harness.processOnce("fake");

    expect(client.pollTask).toHaveBeenCalledWith("fake", "test-worker");
    expect(handler.run).toHaveBeenCalledOnce();
    expect(client.completeTask).toHaveBeenCalledWith(expect.objectContaining({
      workflowInstanceId: "wf1",
      taskId: "t1",
      status: "COMPLETED",
      outputData: { ok: true },
    }));
  });
});
```

- [ ] **Step 12.2: Run test (FAIL — module not found)**

Run: `npm test -w @journeyman/orchestrator -- worker-harness`
Expected: FAIL.

- [ ] **Step 12.3: Implement `worker-harness.ts`**

```typescript
// packages/orchestrator/src/workers/worker-harness.ts
import { createLogger } from "@journeyman/core";
import type {
  ICredentialStore, IEventBus, IPhaseRegistry, IWorkspaceProvider,
} from "@journeyman/core";
import type { ConductorClient } from "../engines/conductor/conductor-client.ts";

const log = createLogger("orchestrator:worker");

export interface WorkerHarnessDeps {
  client: ConductorClient;
  registry: IPhaseRegistry;
  workspace: IWorkspaceProvider;
  credentials: ICredentialStore;
  events: IEventBus;
  workerId: string;
  pollIntervalMs?: number;
}

export class WorkerHarness {
  private running = false;

  constructor(private deps: WorkerHarnessDeps) {}

  /** Start the long-poll loops for the given phase types. */
  async start(phaseTypes: string[]): Promise<void> {
    this.running = true;
    await Promise.all(phaseTypes.map(t => this.loop(t)));
  }

  stop(): void { this.running = false; }

  private async loop(phaseType: string): Promise<void> {
    const interval = this.deps.pollIntervalMs ?? 500;
    while (this.running) {
      try { await this.processOnce(phaseType); }
      catch (err) { log.error({ err, phaseType }, "poll loop error"); }
      await new Promise(r => setTimeout(r, interval));
    }
  }

  /** Test seam: poll once and process if a task is available. */
  async processOnce(phaseType: string): Promise<void> {
    const task = await this.deps.client.pollTask(phaseType, this.deps.workerId);
    if (!task) return;
    await this.deps.client.ackTask(task.taskId, this.deps.workerId);

    const handler = this.deps.registry.get(phaseType);
    if (!handler) {
      await this.deps.client.completeTask({
        workflowInstanceId: task.workflowInstanceId,
        taskId: task.taskId,
        status: "FAILED_WITH_TERMINAL_ERROR",
        reasonForIncompletion: `No handler for phase '${phaseType}'`,
      });
      return;
    }

    const runId = task.workflowInstanceId;
    const nodeId = task.taskDefName;
    const ws = await this.deps.workspace.create({ runId, nodeId });
    const abort = new AbortController();
    await this.deps.events.append({
      runId, nodeId, eventType: "phase.started",
      payload: { attempt: task.retryCount + 1 },
    });

    try {
      const result = await handler.run(task.inputData, {
        runId, nodeId, attempt: task.retryCount + 1,
        workspaceDir: ws.path, signal: abort.signal,
        env: process.env as Record<string, string>,
        log: (line, meta) => {
          this.deps.events.append({
            runId, nodeId, eventType: "phase.log", payload: { line, meta },
          }).catch(err => log.error(err, "log emit failed"));
        },
      });

      if (result.kind === "success") {
        await this.deps.events.append({
          runId, nodeId, eventType: "phase.completed",
          payload: { output: result.output },
        });
        await this.deps.client.completeTask({
          workflowInstanceId: runId, taskId: task.taskId,
          status: "COMPLETED", outputData: result.output,
        });
      } else {
        await this.deps.events.append({
          runId, nodeId, eventType: "phase.failed",
          payload: { error: result.failure },
        });
        await this.deps.client.completeTask({
          workflowInstanceId: runId, taskId: task.taskId,
          status: result.failure.retryable ? "FAILED" : "FAILED_WITH_TERMINAL_ERROR",
          reasonForIncompletion: result.failure.message,
        });
      }
    } catch (err: any) {
      await this.deps.events.append({
        runId, nodeId, eventType: "phase.failed",
        payload: { error: { errorClass: "UnhandledError", message: String(err?.message ?? err) } },
      });
      await this.deps.client.completeTask({
        workflowInstanceId: runId, taskId: task.taskId,
        status: "FAILED",
        reasonForIncompletion: String(err?.message ?? err),
      });
    } finally {
      await ws.destroy().catch(e => log.warn(e, "workspace destroy failed"));
    }
  }
}
```

- [ ] **Step 12.4: Run test — PASS**

Run: `npm test -w @journeyman/orchestrator -- worker-harness`
Expected: 1 test passes.

- [ ] **Step 12.5: Implement the analyze phase handler**

```typescript
// packages/orchestrator/src/workers/phases/analyze-phase-handler.ts
import { createLogger } from "@journeyman/core";
import type {
  IPhaseHandler, PhaseContext, PhaseInput, PhaseResult,
} from "@journeyman/core";

const log = createLogger("worker:analyze");

/**
 * Phase 1 wrapper around the existing AnalyzePhase from @journeyman/pipeline.
 * It bypasses the legacy PipelineContext by calling the underlying coding
 * provider directly. When pipeline is retired, this handler can become the
 * canonical implementation.
 *
 * Required input keys (all strings):
 *   - dirPath        — absolute path to the repo to analyze
 *   - ticketContent  — markdown body of the ticket
 *
 * Returns:
 *   - analysis       — the AnalyzeResult shape produced by ICodingCLI.analyze
 */
export class AnalyzePhaseHandler implements IPhaseHandler {
  readonly phaseType = "analyze";

  constructor(
    private deps: {
      coding: import("@journeyman/core").ICodingCLI;
    },
  ) {}

  async run(input: PhaseInput, ctx: PhaseContext): Promise<PhaseResult> {
    const dirPath = input.dirPath;
    const ticketContent = input.ticketContent;
    if (typeof dirPath !== "string" || typeof ticketContent !== "string") {
      return {
        kind: "failure",
        failure: {
          errorClass: "InvalidInput",
          message: "analyze requires string `dirPath` and `ticketContent`",
          retryable: false,
        },
      };
    }
    ctx.log(`Analyzing ${dirPath}`);
    const result = await this.deps.coding.analyze({
      dirPath,
      ticketContent,
      sessionId: ctx.runId,
      signal: ctx.signal,
    });
    if ("error" in (result as any) && (result as any).error) {
      log.error({ result }, "analyze failed");
      return {
        kind: "failure",
        failure: {
          errorClass: "AnalyzeFailed",
          message: (result as any).error,
          retryable: true,
        },
      };
    }
    return { kind: "success", output: { analysis: result } };
  }
}
```

- [ ] **Step 12.6: Run typecheck and full test suite**

```bash
npm run typecheck -w @journeyman/orchestrator
npm test -w @journeyman/orchestrator
```
Expected: typecheck passes; all tests pass.

- [ ] **Step 12.7: Commit**

```bash
git add packages/orchestrator/src/workers
git commit -m "feat(orchestrator): add WorkerHarness + analyze phase handler"
```

---

## Task 13: Composition root in `@journeyman/api-server`

This is the architectural keystone — the only file that picks concrete adapters.

**Files:**
- Create: `packages/api-server/src/composition.ts`
- Test: `packages/api-server/src/composition.test.ts`

- [ ] **Step 13.1: Write composition.ts**

```typescript
// packages/api-server/src/composition.ts
//
// THE WIRING POINT.
//
// This is the only file in the codebase allowed to import concrete adapter
// classes. Every other file depends on the interfaces in @journeyman/core.
//
// Replacing an adapter — e.g. swapping PostgresFlowStore for MemoryFlowStore
// for tests, or ConductorOrchestrator for a future TemporalOrchestrator —
// MUST require changing only this file. If a swap forces edits anywhere else,
// the boundaries are wrong (see spec §12 "Architectural exit criterion").

import { Pool } from "pg";
import type {
  IAuthProvider, IConditionEvaluator, ICredentialStore, IEventBus,
  IFlowStore, IFlowVersionStore, INodeExecutionStore, IOrchestratorEngine,
  IPhaseRegistry, IRunStore, IWorkspaceProvider,
} from "@journeyman/core";
import {
  ConductorClient,
  ConductorOrchestrator,
  ConductorJsonConverter,
  PostgresFlowStore,
  PostgresFlowVersionStore,
  PostgresRunStore,
  PostgresNodeExecutionStore,
  PostgresEventBus,
  MemoryFlowStore,
  MemoryFlowVersionStore,
  MemoryRunStore,
  MemoryNodeExecutionStore,
  MemoryEventBus,
  EnvCredentialStore,
  NoAuthProvider,
  DirectoryWorkspaceProvider,
  InMemoryPhaseRegistry,
  JsonLogicEvaluator,
  createPool,
} from "@journeyman/orchestrator";

export interface Composition {
  flows: IFlowStore;
  flowVersions: IFlowVersionStore;
  runs: IRunStore;
  nodeExecutions: INodeExecutionStore;
  events: IEventBus;
  orchestrator: IOrchestratorEngine;
  registry: IPhaseRegistry;
  workspace: IWorkspaceProvider;
  credentials: ICredentialStore;
  auth: IAuthProvider;
  conditions: IConditionEvaluator;
  /** Closed when the server shuts down. */
  shutdown: () => Promise<void>;
}

export interface CompositionConfig {
  databaseUrl: string;
  conductorBaseUrl: string;
  /** "postgres" (production) or "memory" (tests, demos). Default postgres. */
  storeBackend?: "postgres" | "memory";
}

export function buildComposition(cfg: CompositionConfig): Composition {
  const useMemory = cfg.storeBackend === "memory";

  // === Stores
  let flows: IFlowStore;
  let flowVersions: IFlowVersionStore;
  let runs: IRunStore;
  let nodeExecutions: INodeExecutionStore;
  let events: IEventBus;
  let pool: Pool | null = null;

  if (useMemory) {
    const v = new MemoryFlowVersionStore();
    flowVersions = v;
    flows = new MemoryFlowStore(v);
    runs = new MemoryRunStore();
    nodeExecutions = new MemoryNodeExecutionStore();
    events = new MemoryEventBus();
  } else {
    pool = createPool({ connectionString: cfg.databaseUrl });
    const v = new PostgresFlowVersionStore(pool);
    flowVersions = v;
    flows = new PostgresFlowStore(pool, v);
    runs = new PostgresRunStore(pool);
    nodeExecutions = new PostgresNodeExecutionStore(pool);
    events = new PostgresEventBus(pool);
  }

  // === Engine
  const conductorClient = new ConductorClient({ baseUrl: cfg.conductorBaseUrl });
  const orchestrator = new ConductorOrchestrator({
    client: conductorClient,
    converter: new ConductorJsonConverter(),
    runs,
  });

  // === Misc adapters
  const registry = new InMemoryPhaseRegistry();
  const workspace = new DirectoryWorkspaceProvider();
  const credentials = new EnvCredentialStore();
  const auth = new NoAuthProvider();
  const conditions = new JsonLogicEvaluator();

  return {
    flows, flowVersions, runs, nodeExecutions, events,
    orchestrator, registry, workspace, credentials, auth, conditions,
    shutdown: async () => { if (pool) await pool.end(); },
  };
}
```

- [ ] **Step 13.2: Add the missing barrel exports in `@journeyman/orchestrator/src/index.ts`**

Replace `packages/orchestrator/src/index.ts` with:

```typescript
// packages/orchestrator/src/index.ts
export { ConductorClient } from "./engines/conductor/conductor-client.ts";
export { ConductorOrchestrator } from "./engines/conductor/conductor-orchestrator.ts";
export {
  ConductorJsonConverter,
  UnsupportedNodeTypeError,
  type ConductorWorkflowDef,
  type ConductorTaskDef,
} from "./flow-json/conductor-converter.ts";
export {
  PostgresFlowStore, PostgresFlowVersionStore,
} from "./stores/postgres/postgres-flow-store.ts";
export {
  PostgresRunStore, PostgresNodeExecutionStore,
} from "./stores/postgres/postgres-run-store.ts";
export { PostgresEventBus } from "./stores/postgres/postgres-event-bus.ts";
export {
  MemoryFlowStore, MemoryFlowVersionStore,
} from "./stores/memory/memory-flow-store.ts";
export {
  MemoryRunStore, MemoryNodeExecutionStore,
} from "./stores/memory/memory-run-store.ts";
export { MemoryEventBus } from "./stores/memory/memory-event-bus.ts";
export { InMemoryPhaseRegistry } from "./registry/in-memory-phase-registry.ts";
export { DirectoryWorkspaceProvider } from "./workspace/directory-workspace-provider.ts";
export { EnvCredentialStore } from "./credentials/env-credential-store.ts";
export { NoAuthProvider } from "./auth/no-auth-provider.ts";
export { JsonLogicEvaluator } from "./conditions/jsonlogic-evaluator.ts";
export { WorkerHarness } from "./workers/worker-harness.ts";
export { AnalyzePhaseHandler } from "./workers/phases/analyze-phase-handler.ts";
export { createPool } from "./stores/postgres/pg-pool.ts";
export { runMigrations } from "./migrations/run-migrations.ts";
```

(Also add `MemoryNodeExecutionStore` to the `memory-run-store.ts` exports if it was created in Task 6.5 — verify the export line is `export class MemoryNodeExecutionStore`.)

- [ ] **Step 13.3: Write the composition swap test (the architectural exit criterion)**

```typescript
// packages/api-server/src/composition.test.ts
import { describe, it, expect } from "vitest";
import { buildComposition } from "./composition.ts";

describe("buildComposition (architectural exit criterion)", () => {
  it("produces a working composition with memory backend (no DB needed)", () => {
    const c = buildComposition({
      databaseUrl: "postgres://unused",
      conductorBaseUrl: "http://localhost:8080/api",
      storeBackend: "memory",
    });
    expect(c.flows).toBeDefined();
    expect(c.runs).toBeDefined();
    expect(c.events).toBeDefined();
    expect(c.orchestrator).toBeDefined();
    expect(c.registry).toBeDefined();
  });

  it("two consecutive memory builds are isolated (no global state)", async () => {
    const c1 = buildComposition({
      databaseUrl: "x", conductorBaseUrl: "y", storeBackend: "memory",
    });
    const c2 = buildComposition({
      databaseUrl: "x", conductorBaseUrl: "y", storeBackend: "memory",
    });
    expect(c1.flows).not.toBe(c2.flows);
    await c1.shutdown(); await c2.shutdown();
  });
});
```

- [ ] **Step 13.4: Run typecheck + test**

```bash
npm run typecheck -w @journeyman/api-server
npm test -w @journeyman/api-server
```
Expected: typecheck passes; 2 composition tests pass.

- [ ] **Step 13.5: Commit**

```bash
git add packages/api-server/src/composition.ts packages/api-server/src/composition.test.ts \
        packages/orchestrator/src/index.ts
git commit -m "feat(api-server): add composition root and adapter-swap exit-criterion test"
```

---

## Task 14: Fastify server + routes (`POST /flows`, `GET /flows/:id`, `POST /flows/:id/runs`, `GET /runs/:id`)

**Files:**
- Create: `packages/api-server/src/server.ts`
- Create: `packages/api-server/src/schemas/flow.ts`
- Create: `packages/api-server/src/schemas/run.ts`
- Create: `packages/api-server/src/routes/health.ts`
- Create: `packages/api-server/src/routes/flows.ts`
- Create: `packages/api-server/src/routes/runs.ts`
- Test: `packages/api-server/src/routes/flows.test.ts`
- Modify: `packages/api-server/src/index.ts`
- Create: `packages/api-server/src/cli-start.ts`

- [ ] **Step 14.1: Write request schemas**

```typescript
// packages/api-server/src/schemas/flow.ts
import { z } from "zod";

export const createFlowBody = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  ownerUserId: z.string().nullable().optional(),
  definition: z.object({
    schemaVersion: z.literal(1),
    nodes: z.array(z.object({
      id: z.string(),
      type: z.string(),
      displayName: z.string().optional(),
      phaseType: z.string().optional(),
      config: z.record(z.unknown()).optional(),
      position: z.object({ x: z.number(), y: z.number() }).optional(),
    })),
    edges: z.array(z.object({
      id: z.string(),
      source: z.string(),
      target: z.string(),
      type: z.enum(["default", "conditional", "error", "else"]).optional(),
      condition: z.unknown().optional(),
      label: z.string().optional(),
    })),
    maxCycleVisits: z.number().int().nonnegative().optional(),
  }),
});

export type CreateFlowBody = z.infer<typeof createFlowBody>;
```

```typescript
// packages/api-server/src/schemas/run.ts
import { z } from "zod";

export const createRunBody = z.object({
  inputs: z.record(z.unknown()).default({}),
});
export type CreateRunBody = z.infer<typeof createRunBody>;
```

- [ ] **Step 14.2: Write the route modules**

```typescript
// packages/api-server/src/routes/health.ts
import type { FastifyInstance } from "fastify";

export function registerHealthRoutes(app: FastifyInstance): void {
  app.get("/healthz", async () => ({ ok: true }));
}
```

```typescript
// packages/api-server/src/routes/flows.ts
import type { FastifyInstance } from "fastify";
import type { Composition } from "../composition.ts";
import { createFlowBody } from "../schemas/flow.ts";
import { createRunBody } from "../schemas/run.ts";

export function registerFlowRoutes(app: FastifyInstance, c: Composition): void {
  app.post("/flows", async (req, reply) => {
    const body = createFlowBody.parse(req.body);
    const user = await c.auth.authenticate(req);
    const { flow, version } = await c.flows.create({
      name: body.name,
      description: body.description,
      ownerUserId: body.ownerUserId ?? user.userId,
      initialDefinition: body.definition,
      createdByUserId: user.userId,
    });
    reply.code(201);
    return { flow, version };
  });

  app.get("/flows/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const flow = await c.flows.getById(id);
    if (!flow) { reply.code(404); return { error: "not_found" }; }
    return { flow };
  });

  app.post("/flows/:id/runs", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = createRunBody.parse(req.body);
    const user = await c.auth.authenticate(req);

    const flow = await c.flows.getById(id);
    if (!flow) { reply.code(404); return { error: "not_found" }; }
    if (!flow.currentVersionId) {
      reply.code(409); return { error: "flow_has_no_versions" };
    }
    const version = await c.flowVersions.getById(flow.currentVersionId);
    if (!version) { reply.code(500); return { error: "version_missing" }; }

    const { runId, engineWorkflowId } = await c.orchestrator.submit({
      flowVersionId: version.id,
      flowDefinition: version.definition,
      inputs: body.inputs,
      startedByUserId: user.userId,
    });

    reply.code(202);
    return { runId, engineWorkflowId };
  });
}
```

```typescript
// packages/api-server/src/routes/runs.ts
import type { FastifyInstance } from "fastify";
import type { Composition } from "../composition.ts";

export function registerRunRoutes(app: FastifyInstance, c: Composition): void {
  app.get("/runs/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    // Pull live status from engine, then return persisted row
    await c.orchestrator.syncStatus(id).catch(() => {/* best-effort */});
    const run = await c.runs.getById(id);
    if (!run) { reply.code(404); return { error: "not_found" }; }
    const executions = await c.nodeExecutions.listByRun(id);
    const events = await c.events.list(id, { limit: 200 });
    return { run, executions, events };
  });
}
```

- [ ] **Step 14.3: Write the Fastify factory**

```typescript
// packages/api-server/src/server.ts
import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import sensible from "@fastify/sensible";
import { ZodError } from "zod";
import type { Composition } from "./composition.ts";
import { registerHealthRoutes } from "./routes/health.ts";
import { registerFlowRoutes } from "./routes/flows.ts";
import { registerRunRoutes } from "./routes/runs.ts";

export async function buildServer(c: Composition): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" } });
  await app.register(cors, { origin: true });
  await app.register(sensible);

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) {
      reply.code(400).send({ error: "bad_request", issues: err.issues });
      return;
    }
    reply.send(err);
  });

  registerHealthRoutes(app);
  registerFlowRoutes(app, c);
  registerRunRoutes(app, c);
  return app;
}
```

- [ ] **Step 14.4: Wire `index.ts` and `cli-start.ts`**

```typescript
// packages/api-server/src/index.ts
export { buildServer } from "./server.ts";
export { buildComposition, type Composition, type CompositionConfig } from "./composition.ts";
```

```typescript
// packages/api-server/src/cli-start.ts
#!/usr/bin/env node
import { config as loadDotenv } from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createLogger } from "@journeyman/core";
import { buildComposition } from "./composition.ts";
import { buildServer } from "./server.ts";

const log = createLogger("api-server:cli");
const envFile = resolve(process.cwd(), ".env");
if (existsSync(envFile)) loadDotenv({ path: envFile, override: false });

const cfg = {
  databaseUrl: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/journeyman",
  conductorBaseUrl: process.env.CONDUCTOR_BASE_URL ?? "http://localhost:8080/api",
  storeBackend: (process.env.STORE_BACKEND as "memory" | "postgres" | undefined) ?? "postgres",
};

const composition = buildComposition(cfg);
const server = await buildServer(composition);
const port = Number(process.env.PORT ?? 4000);
await server.listen({ port, host: "0.0.0.0" });
log.info({ port }, "api-server listening");

const shutdown = async () => {
  log.info("shutting down");
  await server.close();
  await composition.shutdown();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
```

- [ ] **Step 14.5: Write the route test**

```typescript
// packages/api-server/src/routes/flows.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildComposition, type Composition } from "../composition.ts";
import { buildServer } from "../server.ts";
import type { FastifyInstance } from "fastify";
import { FLOW_SCHEMA_VERSION } from "@journeyman/core";

describe("flow routes (memory backend)", () => {
  let server: FastifyInstance;
  let composition: Composition;

  beforeAll(async () => {
    composition = buildComposition({
      databaseUrl: "x",
      conductorBaseUrl: "http://unused",
      storeBackend: "memory",
    });
    // Stub orchestrator.submit so we don't actually call Conductor
    (composition.orchestrator as any).submit = async () => ({
      runId: "fake-run", engineWorkflowId: "fake-wf",
    });
    server = await buildServer(composition);
  });

  afterAll(async () => {
    await server.close();
    await composition.shutdown();
  });

  it("POST /flows creates a flow and returns version 1", async () => {
    const res = await server.inject({
      method: "POST", url: "/flows",
      payload: {
        name: "demo",
        definition: {
          schemaVersion: FLOW_SCHEMA_VERSION,
          nodes: [
            { id: "s", type: "start" },
            { id: "a", type: "phase", phaseType: "analyze" },
            { id: "e", type: "end" },
          ],
          edges: [
            { id: "e1", source: "s", target: "a" },
            { id: "e2", source: "a", target: "e" },
          ],
        },
      },
    });
    expect(res.statusCode).toBe(201);
    const json = res.json();
    expect(json.flow.name).toBe("demo");
    expect(json.version.versionNumber).toBe(1);
  });

  it("POST /flows/:id/runs starts a run and returns 202", async () => {
    const create = await server.inject({
      method: "POST", url: "/flows",
      payload: {
        name: "x",
        definition: {
          schemaVersion: FLOW_SCHEMA_VERSION,
          nodes: [
            { id: "s", type: "start" }, { id: "a", type: "phase", phaseType: "analyze" }, { id: "e", type: "end" },
          ],
          edges: [
            { id: "e1", source: "s", target: "a" }, { id: "e2", source: "a", target: "e" },
          ],
        },
      },
    });
    const flowId = create.json().flow.id;
    const run = await server.inject({
      method: "POST", url: `/flows/${flowId}/runs`,
      payload: { inputs: { foo: 1 } },
    });
    expect(run.statusCode).toBe(202);
    expect(run.json().runId).toBe("fake-run");
  });

  it("POST /flows rejects bad payload with 400", async () => {
    const res = await server.inject({
      method: "POST", url: "/flows",
      payload: { name: "" }, // missing definition; name empty
    });
    expect(res.statusCode).toBe(400);
  });
});
```

- [ ] **Step 14.6: Run typecheck and tests**

```bash
npm run typecheck -w @journeyman/api-server
npm test -w @journeyman/api-server
```
Expected: typecheck passes; 3 route tests pass + 2 composition tests pass.

- [ ] **Step 14.7: Commit**

```bash
git add packages/api-server/src
git commit -m "feat(api-server): add Fastify server with flow + run + health routes"
```

---

## Task 15: End-to-end smoke — `curl` a flow through the live stack

This is the Phase 1 demo. We bring up everything and prove a curl-driven flow makes it through Conductor and back.

**Files:**
- Create: `examples/flows/analyze-only.flow.json`
- Modify: root `package.json` (add `start:worker` helper script)
- Create: `packages/orchestrator/src/cli-worker.ts`

- [ ] **Step 15.1: Write the example flow JSON**

```json
{
  "name": "analyze-only",
  "description": "Phase 1 smoke: a single 'analyze' phase with hand-supplied inputs.",
  "definition": {
    "schemaVersion": 1,
    "nodes": [
      { "id": "s",  "type": "start" },
      {
        "id": "step_analyze",
        "type": "phase",
        "phaseType": "analyze",
        "config": {}
      },
      { "id": "e",  "type": "end" }
    ],
    "edges": [
      { "id": "e1", "source": "s", "target": "step_analyze" },
      { "id": "e2", "source": "step_analyze", "target": "e" }
    ]
  }
}
```

- [ ] **Step 15.2: Write the worker CLI**

```typescript
// packages/orchestrator/src/cli-worker.ts
#!/usr/bin/env node
/**
 * Standalone worker process. Polls Conductor for tasks of the registered
 * phase types and dispatches them to handlers.
 */
import { config as loadDotenv } from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createLogger } from "@journeyman/core";
import { ClaudeProvider } from "@journeyman/coding-cli";
import { ConductorClient } from "./engines/conductor/conductor-client.ts";
import { InMemoryPhaseRegistry } from "./registry/in-memory-phase-registry.ts";
import { DirectoryWorkspaceProvider } from "./workspace/directory-workspace-provider.ts";
import { EnvCredentialStore } from "./credentials/env-credential-store.ts";
import { MemoryEventBus } from "./stores/memory/memory-event-bus.ts";
import { WorkerHarness } from "./workers/worker-harness.ts";
import { AnalyzePhaseHandler } from "./workers/phases/analyze-phase-handler.ts";

const log = createLogger("worker:cli");
const envFile = resolve(process.cwd(), ".env");
if (existsSync(envFile)) loadDotenv({ path: envFile, override: false });

const baseUrl = process.env.CONDUCTOR_BASE_URL ?? "http://localhost:8080/api";
const client = new ConductorClient({ baseUrl });

const registry = new InMemoryPhaseRegistry();
registry.register(new AnalyzePhaseHandler({ coding: new ClaudeProvider() }));

// Register matching task definitions (idempotent)
for (const handler of registry.list()) {
  await client.putTaskDef({
    name: handler.phaseType,
    retryCount: 0,
    timeoutSeconds: 600,
    timeoutPolicy: "TIME_OUT_WF",
    retryLogic: "FIXED",
    retryDelaySeconds: 0,
    responseTimeoutSeconds: 600,
    ownerEmail: "ops@journeyman.local",
  });
}

const harness = new WorkerHarness({
  client,
  registry,
  workspace: new DirectoryWorkspaceProvider(),
  credentials: new EnvCredentialStore(),
  events: new MemoryEventBus(),
  workerId: process.env.WORKER_ID ?? `worker-${process.pid}`,
  pollIntervalMs: 500,
});

log.info({ phases: registry.list().map(h => h.phaseType) }, "worker starting");
await harness.start(registry.list().map(h => h.phaseType));
```

- [ ] **Step 15.3: Add `start:worker` script to root `package.json`**

In root `package.json`'s `"scripts"` block, add:

```json
"start:worker": "tsx packages/orchestrator/src/cli-worker.ts"
```

- [ ] **Step 15.4: Run the smoke test manually**

In one terminal:
```bash
npm run infra:up
npm run migrate
npm run start:api-server
```

In a second terminal:
```bash
npm run start:worker
```

In a third terminal:
```bash
# Create the flow
FLOW_JSON=$(cat examples/flows/analyze-only.flow.json)
CREATE=$(curl -s -X POST http://localhost:4000/flows \
  -H 'Content-Type: application/json' \
  -d "$FLOW_JSON")
FLOW_ID=$(echo "$CREATE" | python3 -c "import sys,json;print(json.load(sys.stdin)['flow']['id'])")
echo "flow_id=$FLOW_ID"

# Submit a run
RUN=$(curl -s -X POST "http://localhost:4000/flows/$FLOW_ID/runs" \
  -H 'Content-Type: application/json' \
  -d '{"inputs":{"dirPath":"'"$(pwd)"'","ticketContent":"# Test\nDo nothing."}}')
echo "$RUN"
RUN_ID=$(echo "$RUN" | python3 -c "import sys,json;print(json.load(sys.stdin)['runId'])")

# Wait a moment, then fetch
sleep 5
curl -s "http://localhost:4000/runs/$RUN_ID" | python3 -m json.tool
```

Expected: the create call returns `flow.id`. The run call returns `runId` and `engineWorkflowId` with HTTP 202. The Conductor UI at http://localhost:5000 shows the workflow `journeyman_v<flowVersionId>` running. After ~30 seconds the run record reaches `status: "completed"` (or `"failed"` if the AnalyzePhaseHandler returns failure — that's still proof the path works end-to-end). The `events` array contains at least `phase.started` and one of `phase.completed` / `phase.failed`.

- [ ] **Step 15.5: Document the smoke test in `infra/README.md`**

Append to `infra/README.md`:

```markdown
## Phase 1 smoke test

See `examples/flows/analyze-only.flow.json`.

```bash
npm run infra:up
npm run migrate
npm run start:api-server &
npm run start:worker &

# Create flow
curl -X POST http://localhost:4000/flows \
  -H 'Content-Type: application/json' \
  -d @examples/flows/analyze-only.flow.json

# Submit a run (replace <FLOW_ID> with the id printed above)
curl -X POST http://localhost:4000/flows/<FLOW_ID>/runs \
  -H 'Content-Type: application/json' \
  -d '{"inputs":{"dirPath":"/path/to/repo","ticketContent":"# Hello"}}'

# Inspect the run
curl http://localhost:4000/runs/<RUN_ID>
```
```

- [ ] **Step 15.6: Commit**

```bash
git add examples/flows/analyze-only.flow.json packages/orchestrator/src/cli-worker.ts package.json infra/README.md
git commit -m "feat: add Phase 1 end-to-end smoke (analyze-only flow + worker CLI)"
```

---

## Task 16: Final sweep — typecheck, tests, demo recap

- [ ] **Step 16.1: Repo-wide typecheck and tests**

```bash
npm run typecheck
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/journeyman_test npm test
```
Expected: typecheck across all workspaces passes. Tests pass: migrations test, memory store tests, postgres store tests, jsonlogic test, registry test, converter test, conductor-orchestrator test, worker-harness test, composition test, route tests.

- [ ] **Step 16.2: Update the design doc with any deviations**

Open `docs/superpowers/specs/2026-04-27-visual-flow-orchestration-design.md`. If anything in Phase 1 was implemented differently from the spec (e.g. an interface signature changed during implementation), update the spec. Common candidates:
- Confirm the `IRunStore.setStatus` signature matches what was implemented in Task 7.5.
- Confirm `IEventBus.subscribe` returns `AsyncIterable<RunEvent>` exactly as the interface declares.
- Note that `ICondition` returns `false` (not throws) for `null` expressions.

If no changes are needed, write a brief "Phase 1 implementation notes" subsection at the bottom of section 12.

- [ ] **Step 16.3: Commit doc updates**

```bash
git add docs/superpowers/specs/2026-04-27-visual-flow-orchestration-design.md
git commit -m "docs: record Phase 1 implementation notes"
```

- [ ] **Step 16.4: Architectural exit-criterion verification**

This is the spec's stated Phase 1 architectural exit criterion. Perform it manually as the last step.

Open `packages/api-server/src/composition.ts` and:
1. Locate the line `storeBackend?: "postgres" | "memory"` in `CompositionConfig`.
2. Confirm that switching the default to `"memory"` and re-running the test suite (`npm test -w @journeyman/api-server`) leaves all tests green WITHOUT touching any other file.
3. Revert the change.

If the swap requires editing any file other than `composition.ts`, the boundaries are wrong — open a follow-up task to fix the leak before declaring Phase 1 done.

---

## Self-Review Checklist (read after writing the plan, fix inline)

**Spec coverage:**
- [x] All 11 adapter interfaces from §9.4 → Task 1.4
- [x] Two new packages scaffolded → Tasks 2, 3
- [x] Postgres schema → Task 4
- [x] Docker Compose Conductor + Redis + Postgres → Task 5
- [x] All v1 implementations: ConductorOrchestrator → Task 11, ConductorJsonConverter → Task 10, PostgresFlowStore → Task 7, PostgresRunStore → Task 7, PostgresEventBus → Task 7, DirectoryWorkspaceProvider → Task 9, EnvCredentialStore → Task 9, JsonLogicEvaluator → Task 8, NoAuthProvider → Task 9, InMemoryPhaseRegistry → Task 9
- [x] Worker harness + analyze IPhaseHandler → Task 12
- [x] Composition root → Task 13
- [x] Minimal REST surface → Task 14
- [x] Demo (curl through live stack) → Task 15
- [x] Architectural exit criterion → Task 16.4 + Task 13.3 test

**Out-of-scope items deferred to later phases (intentionally not in this plan):**
- React Flow editor (Phase 2)
- SSE endpoint and live-run UI (Phase 3)
- Gateways / loops / cycles (Phase 4)
- Properties panel tabs (Phase 5)
- Resume / fork-edit / pause / cancel UI (Phase 6)
- Legacy retirement (Phase 7)

**Type consistency check:**
- `IFlowStore.create` returns `{ flow; version }` — used consistently in Tasks 6, 7, 14.
- `IPhaseHandler.run` signature `(input, ctx) => Promise<PhaseResult>` — used consistently in Tasks 12 and 1.
- `IEventBus.append` returns `Promise<RunEvent>` — used by `WorkerHarness` in Task 12.
- `ConductorClient.startWorkflow` returns `Promise<string>` (workflow id) — used in Task 11.
- `IOrchestratorEngine.submit` returns `{ runId; engineWorkflowId }` — exposed at the route in Task 14.
- `MemoryNodeExecutionStore` referenced in Task 13.1 was added in Task 6 alongside `MemoryRunStore` (Step 6.5).
- `createPool` exported from orchestrator index in Task 13.2 — defined in Task 4.2.

No placeholders or "implement later" steps. Every step shows actual code or actual commands.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-04-27-phase-1-foundation.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. Good for a 16-task plan like this one — keeps each subagent's context focused.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints. Heavier on this session's context but lower coordination overhead.

**Which approach?**
