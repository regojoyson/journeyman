# Workers Foundation Implementation Plan (Plan 1 of 7)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce the pluggable `IExecutionEnvironment` abstraction, an in-memory backend registry, and the `local` (passthrough) backend in a new `@journeyman/workers` package — fully unit-tested, with **zero runtime behavior change** (nothing wires it into the harness yet).

**Architecture:** Per the spec [`docs/superpowers/specs/2026-05-30-workers-managed-compute-targets-design.md`](../specs/2026-05-30-workers-managed-compute-targets-design.md), a *Worker* is a configured instance of a *worker type*; types are pluggable backends implementing `IExecutionEnvironment` (provision → exec → destroy → list). This plan delivers the interface (in `@journeyman/core`), a registry, and the `local` backend which runs operations in-process — the default that preserves today's behavior. Docker, management UI, runner extraction, etc. are later plans.

**Tech Stack:** TypeScript (NodeNext/Bundler, `.ts`-extension relative imports), npm workspaces, vitest 2.1.9. No build step (source is run via `tsx`).

---

## Phase Roadmap (this plan = Plan 1)

| Plan | Scope | Spec refs |
|---|---|---|
| **1 (this doc)** | `IExecutionEnvironment` + registry + `local` backend in `@journeyman/workers`. No harness wiring. | §3, §4, §5, §13.1 |
| 2 | Runner entrypoint extraction in `coding-cli` (operations runnable in-process or via stdin/stdout); base runner bundle/image incl. git/ssh/certs. | §5, §6, §8, §13.2 |
| 3 | Workers management: `workers` table + migration, CRUD/catalog/test API, management UI, flow-level + per-step worker picker, run-start resolution. | §7, §13.3 |
| 4 | `DockerExecutionEnvironment` (per-instance, push), `sandbox_instances`, provision/exec/teardown, image-ref path; harness routing of `requiresWorkspace` steps. | §6, §9, §10, §13.4 |
| 5 | Dockerfile path: auto-wrap + build/cache + glibc/musl detection. | §8, §13.5 |
| 6 | Reaper + manual cleanup CLI/API; logging continuity (stderr NDJSON → ctx.log; build/provision logs). | §10, §15, §13.6 |
| 7 | Later worker types (machine/agent/ECS/K8s/cloud), shared mode, per-step containers, domain allowlisting. | §13.7 |

Each plan produces working, testable software on its own. Only Plan 1 is detailed below.

---

## File Structure (Plan 1)

- `packages/core/src/types/execution-environment.types.ts` — **Create.** All shared types/interfaces for the abstraction (`WorkerType`, `IExecutionEnvironment`, `ExecutionEnvironmentBackend`, `IExecutionEnvironmentRegistry`, etc.).
- `packages/core/src/index.ts` — **Modify.** Re-export the new types.
- `packages/workers/package.json` — **Create.** New workspace package manifest.
- `packages/workers/tsconfig.json` — **Create.** Mirror `packages/mcp/tsconfig.json`.
- `packages/workers/src/index.ts` — **Create.** Package public exports.
- `packages/workers/src/registry/in-memory-execution-environment-registry.ts` — **Create.** Registry impl.
- `packages/workers/src/registry/in-memory-execution-environment-registry.test.ts` — **Create.** Registry tests.
- `packages/workers/src/backends/contract.ts` — **Create.** Reusable contract test suite for any backend.
- `packages/workers/src/backends/local/local-execution-environment.ts` — **Create.** `local` env impl.
- `packages/workers/src/backends/local/local-execution-environment.test.ts` — **Create.** Local env tests + contract.
- `packages/workers/src/backends/local/local-backend.ts` — **Create.** `local` backend (factory + config validation).
- `packages/workers/src/backends/local/local-backend.test.ts` — **Create.** Local backend tests.
- `packages/workers/src/default-registry.ts` — **Create.** `createDefaultRegistry()` helper.
- `packages/workers/src/default-registry.test.ts` — **Create.** Default registry test.
- `scripts/check-import-boundaries.mjs` — **Modify.** Classify `@journeyman/workers` as `backend`.

---

## Task 1: Core execution-environment types

**Files:**
- Create: `packages/core/src/types/execution-environment.types.ts`
- Modify: `packages/core/src/index.ts`

This task adds only types/interfaces (no behavior), so it is verified by typecheck rather than a unit test.

- [ ] **Step 1: Create the types file**

Create `packages/core/src/types/execution-environment.types.ts` with exactly:

```typescript
/**
 * Pluggable execution-environment abstraction. A Worker is a configured instance
 * of a worker *type*; each type is a backend implementing IExecutionEnvironment.
 * See docs/superpowers/specs/2026-05-30-workers-managed-compute-targets-design.md.
 */

export type WorkerType =
  | "local"
  | "docker"
  | "machine-linux"
  | "machine-windows"
  | "ecs"
  | "ec2"
  | "kubernetes"
  | "cloud";

export type ExecutionMode = "per-instance" | "shared";
export type Connectivity = "push" | "agent";

/** Resolved, ready-to-provision spec (built from a Worker's config at run start). */
export interface ExecutionEnvironmentSpec {
  imageRef?: string;
  env?: Record<string, string>;
  resources?: { cpus?: number; memoryMb?: number; timeoutSec?: number };
  network?: "none" | "full";
  mounts?: Array<{ source: string; target: string; readOnly?: boolean }>;
}

/** Handle to a provisioned environment for a single run. */
export interface ProvisionedEnv {
  runId: string;
  type: WorkerType;
  /** Opaque backend handle (e.g. container id, or "local:<runId>"). */
  handle: string;
  /** Optional named volume (Docker). */
  volume?: string;
  /** Absolute path steps should treat as their workspace (e.g. "/workspace" or a local dir). */
  workspaceDir: string;
}

/** A single operation to run inside the environment. */
export interface ExecOp {
  /** Operation id, e.g. "analyze" | "plan" | "implement" | "custom-prompt" | "clone". */
  op: string;
  /** JSON request payload for the operation. */
  stdin: unknown;
  /** Per-exec secrets, injected only for this call. */
  env?: Record<string, string>;
  signal?: AbortSignal;
  /** Forwarded log lines (e.g. runner stderr) → step logs. */
  onLog?: (line: string, meta?: Record<string, unknown>) => void;
}

export interface ExecResult {
  ok: boolean;
  structured?: unknown;
  error?: string;
}

/**
 * Executes a single operation. The `local` backend calls this in-process;
 * the Docker backend (later plan) pipes it into a container runner.
 */
export type OperationRunner = (
  op: ExecOp,
  ctx: { workspaceDir: string },
) => Promise<ExecResult>;

/** Uniform contract every worker type implements. */
export interface IExecutionEnvironment {
  readonly type: WorkerType;
  /** No-op for shared/local; provisions a fresh unit + workspace for per-instance. */
  provision(runId: string, spec: ExecutionEnvironmentSpec): Promise<ProvisionedEnv>;
  exec(env: ProvisionedEnv, op: ExecOp): Promise<ExecResult>;
  destroy(env: ProvisionedEnv): Promise<void>;
  list(filter?: { runId?: string; orphanedOnly?: boolean }): Promise<ProvisionedEnv[]>;
}

/** A Worker record resolved to the fields a backend needs at run start. */
export interface ResolvedWorker {
  id: string;
  type: WorkerType;
  executionMode: ExecutionMode;
  connectivity?: Connectivity;
  /** Type-specific config, validated by the backend. */
  config: unknown;
}

/** A pluggable worker *type*. Registered by name; callers never change. */
export interface ExecutionEnvironmentBackend {
  readonly type: WorkerType;
  readonly supportedModes: ExecutionMode[];
  readonly supportedConnectivity: Connectivity[];
  /** Throws if the worker's config is invalid for this type. */
  validateConfig(config: unknown): void;
  create(worker: ResolvedWorker): IExecutionEnvironment;
}

export interface IExecutionEnvironmentRegistry {
  register(backend: ExecutionEnvironmentBackend): void;
  /** Throws if no backend registered for the type. */
  get(type: WorkerType): ExecutionEnvironmentBackend;
  /** Worker types this deployment has configured. */
  available(): WorkerType[];
}
```

- [ ] **Step 2: Re-export from core**

In `packages/core/src/index.ts`, add this export block (place it near the other `export type { ... } from "./types/..."` lines):

```typescript
export type {
  WorkerType,
  ExecutionMode,
  Connectivity,
  ExecutionEnvironmentSpec,
  ProvisionedEnv,
  ExecOp,
  ExecResult,
  OperationRunner,
  IExecutionEnvironment,
  ResolvedWorker,
  ExecutionEnvironmentBackend,
  IExecutionEnvironmentRegistry,
} from "./types/execution-environment.types.ts";
```

- [ ] **Step 3: Typecheck core**

Run: `npm run typecheck -w @journeyman/core`
Expected: PASS (exit 0, no errors).

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/types/execution-environment.types.ts packages/core/src/index.ts
git commit -m "feat(core): add IExecutionEnvironment abstraction types"
```

---

## Task 2: Scaffold the @journeyman/workers package

**Files:**
- Create: `packages/workers/package.json`
- Create: `packages/workers/tsconfig.json`
- Create: `packages/workers/src/index.ts`
- Modify: `scripts/check-import-boundaries.mjs`

- [ ] **Step 1: Create `packages/workers/package.json`**

```json
{
  "name": "@journeyman/workers",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@journeyman/core": "*"
  },
  "devDependencies": {
    "@types/node": "^25.6.0",
    "typescript": "^6.0.3",
    "vitest": "^2.1.9"
  }
}
```

- [ ] **Step 2: Create `packages/workers/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "allowImportingTsExtensions": true,
    "noEmit": true,
    "resolveJsonModule": true,
    "rootDir": "./src"
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Create a placeholder `packages/workers/src/index.ts`**

```typescript
// Public exports are filled in by later tasks in this plan.
export {};
```

- [ ] **Step 4: Classify the package in the boundary checker**

In `scripts/check-import-boundaries.mjs`, inside the `PKG_LAYER` object, in the `BACKEND LAYER` group, add this line (e.g. right after the `"@journeyman/orchestrator": "backend",` line):

```javascript
  "@journeyman/workers": "backend",
```

- [ ] **Step 5: Install so the workspace is linked**

Run: `npm install`
Expected: completes without error; `node_modules/@journeyman/workers` symlink created.

- [ ] **Step 6: Verify typecheck + boundaries pass**

Run: `npm run typecheck -w @journeyman/workers && npm run check:boundaries`
Expected: both PASS (exit 0).

- [ ] **Step 7: Commit**

```bash
git add packages/workers/package.json packages/workers/tsconfig.json packages/workers/src/index.ts scripts/check-import-boundaries.mjs package-lock.json
git commit -m "feat(workers): scaffold @journeyman/workers package"
```

---

## Task 3: In-memory backend registry

**Files:**
- Create: `packages/workers/src/registry/in-memory-execution-environment-registry.ts`
- Test: `packages/workers/src/registry/in-memory-execution-environment-registry.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/workers/src/registry/in-memory-execution-environment-registry.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import type {
  ExecutionEnvironmentBackend,
  IExecutionEnvironment,
  ResolvedWorker,
  WorkerType,
} from "@journeyman/core";
import { InMemoryExecutionEnvironmentRegistry } from "./in-memory-execution-environment-registry.ts";

const fakeEnv = {} as IExecutionEnvironment;

function fakeBackend(type: WorkerType): ExecutionEnvironmentBackend {
  return {
    type,
    supportedModes: ["shared"],
    supportedConnectivity: [],
    validateConfig: () => {},
    create: (_w: ResolvedWorker) => fakeEnv,
  };
}

describe("InMemoryExecutionEnvironmentRegistry", () => {
  it("registers and gets a backend by type", () => {
    const r = new InMemoryExecutionEnvironmentRegistry();
    r.register(fakeBackend("local"));
    expect(r.get("local").type).toBe("local");
  });

  it("available() lists registered types", () => {
    const r = new InMemoryExecutionEnvironmentRegistry();
    r.register(fakeBackend("local"));
    r.register(fakeBackend("docker"));
    expect(r.available().sort()).toEqual(["docker", "local"]);
  });

  it("throws on duplicate registration", () => {
    const r = new InMemoryExecutionEnvironmentRegistry();
    r.register(fakeBackend("local"));
    expect(() => r.register(fakeBackend("local"))).toThrow(/already registered/);
  });

  it("throws when getting an unregistered type", () => {
    const r = new InMemoryExecutionEnvironmentRegistry();
    expect(() => r.get("docker")).toThrow(/No execution backend/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/workers/src/registry/in-memory-execution-environment-registry.test.ts`
Expected: FAIL — cannot resolve `./in-memory-execution-environment-registry.ts` (module not found).

- [ ] **Step 3: Write the implementation**

Create `packages/workers/src/registry/in-memory-execution-environment-registry.ts`:

```typescript
import type {
  ExecutionEnvironmentBackend,
  IExecutionEnvironmentRegistry,
  WorkerType,
} from "@journeyman/core";

export class InMemoryExecutionEnvironmentRegistry implements IExecutionEnvironmentRegistry {
  private byType = new Map<WorkerType, ExecutionEnvironmentBackend>();

  register(backend: ExecutionEnvironmentBackend): void {
    if (this.byType.has(backend.type)) {
      throw new Error(`Execution backend '${backend.type}' already registered`);
    }
    this.byType.set(backend.type, backend);
  }

  get(type: WorkerType): ExecutionEnvironmentBackend {
    const backend = this.byType.get(type);
    if (!backend) {
      throw new Error(`No execution backend registered for type '${type}'`);
    }
    return backend;
  }

  available(): WorkerType[] {
    return [...this.byType.keys()];
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/workers/src/registry/in-memory-execution-environment-registry.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/workers/src/registry/
git commit -m "feat(workers): in-memory execution-environment registry"
```

---

## Task 4: Local execution environment + reusable contract suite

**Files:**
- Create: `packages/workers/src/backends/contract.ts`
- Create: `packages/workers/src/backends/local/local-execution-environment.ts`
- Test: `packages/workers/src/backends/local/local-execution-environment.test.ts`

- [ ] **Step 1: Write the reusable contract suite**

Create `packages/workers/src/backends/contract.ts`. This is imported by a backend's test file and invoked with a factory; it is not a standalone test file.

```typescript
import { describe, it, expect } from "vitest";
import type { ExecResult, IExecutionEnvironment } from "@journeyman/core";

/**
 * Shared contract every IExecutionEnvironment backend must satisfy.
 * `makeEnv` must return an env whose `exec` echoes `{ op: <op.op> }` as structured output
 * (the local test wires an echo OperationRunner; the Docker test will bake an echo runner).
 */
export function runExecutionEnvironmentContract(
  name: string,
  makeEnv: () => Promise<IExecutionEnvironment> | IExecutionEnvironment,
): void {
  describe(`IExecutionEnvironment contract: ${name}`, () => {
    it("provision returns a handle with a non-empty workspaceDir", async () => {
      const env = await makeEnv();
      const p = await env.provision("run-1", {});
      expect(p.runId).toBe("run-1");
      expect(typeof p.workspaceDir).toBe("string");
      expect(p.workspaceDir.length).toBeGreaterThan(0);
      await env.destroy(p);
    });

    it("exec returns the operation result", async () => {
      const env = await makeEnv();
      const p = await env.provision("run-2", {});
      const r: ExecResult = await env.exec(p, { op: "echo", stdin: { hello: 1 } });
      expect(r.ok).toBe(true);
      expect(r.structured).toEqual({ op: "echo" });
      await env.destroy(p);
    });

    it("destroy is idempotent", async () => {
      const env = await makeEnv();
      const p = await env.provision("run-3", {});
      await env.destroy(p);
      await expect(env.destroy(p)).resolves.toBeUndefined();
    });
  });
}
```

- [ ] **Step 2: Write the failing test for the local env**

Create `packages/workers/src/backends/local/local-execution-environment.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OperationRunner } from "@journeyman/core";
import { LocalExecutionEnvironment } from "./local-execution-environment.ts";
import { runExecutionEnvironmentContract } from "../contract.ts";

const echoRunner: OperationRunner = async (op) => ({ ok: true, structured: { op: op.op } });

runExecutionEnvironmentContract("local", async () => {
  const base = await mkdtemp(join(tmpdir(), "jm-workers-"));
  return new LocalExecutionEnvironment({ runOperation: echoRunner, baseDir: base });
});

describe("LocalExecutionEnvironment", () => {
  it("provision creates the run workspace dir under baseDir", async () => {
    const base = await mkdtemp(join(tmpdir(), "jm-workers-"));
    const env = new LocalExecutionEnvironment({ runOperation: echoRunner, baseDir: base });
    const p = await env.provision("run-x", {});
    expect(p.type).toBe("local");
    expect(p.workspaceDir).toBe(join(base, "run-x"));
    expect(existsSync(p.workspaceDir)).toBe(true);
    await env.destroy(p);
    expect(existsSync(p.workspaceDir)).toBe(false);
  });

  it("destroy keeps the workspace when retainWorkspace is true", async () => {
    const base = await mkdtemp(join(tmpdir(), "jm-workers-"));
    const env = new LocalExecutionEnvironment({ runOperation: echoRunner, baseDir: base, retainWorkspace: true });
    const p = await env.provision("run-y", {});
    await env.destroy(p);
    expect(existsSync(p.workspaceDir)).toBe(true);
  });

  it("exec delegates to the injected operation runner with the run workspaceDir", async () => {
    const base = await mkdtemp(join(tmpdir(), "jm-workers-"));
    const calls: string[] = [];
    const runner: OperationRunner = async (op, c) => {
      calls.push(`${op.op}@${c.workspaceDir}`);
      return { ok: true };
    };
    const env = new LocalExecutionEnvironment({ runOperation: runner, baseDir: base });
    const p = await env.provision("run-z", {});
    await env.exec(p, { op: "analyze", stdin: {} });
    expect(calls).toEqual([`analyze@${join(base, "run-z")}`]);
  });

  it("list returns empty (local does not track instances)", async () => {
    const base = await mkdtemp(join(tmpdir(), "jm-workers-"));
    const env = new LocalExecutionEnvironment({ runOperation: echoRunner, baseDir: base });
    expect(await env.list()).toEqual([]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run packages/workers/src/backends/local/local-execution-environment.test.ts`
Expected: FAIL — cannot resolve `./local-execution-environment.ts`.

- [ ] **Step 4: Write the implementation**

Create `packages/workers/src/backends/local/local-execution-environment.ts`:

```typescript
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type {
  ExecOp,
  ExecResult,
  ExecutionEnvironmentSpec,
  IExecutionEnvironment,
  OperationRunner,
  ProvisionedEnv,
  WorkerType,
} from "@journeyman/core";

export interface LocalExecutionEnvironmentDeps {
  runOperation: OperationRunner;
  baseDir: string;
  retainWorkspace?: boolean;
}

/**
 * The `local` backend: runs operations in-process, no container, no isolation.
 * Each run gets a dynamic instance folder `${baseDir}/${runId}`, shared across the run's steps.
 */
export class LocalExecutionEnvironment implements IExecutionEnvironment {
  readonly type: WorkerType = "local";

  constructor(private deps: LocalExecutionEnvironmentDeps) {}

  async provision(runId: string, _spec: ExecutionEnvironmentSpec): Promise<ProvisionedEnv> {
    const workspaceDir = join(this.deps.baseDir, runId);
    await mkdir(workspaceDir, { recursive: true });
    return { runId, type: "local", handle: `local:${runId}`, workspaceDir };
  }

  async exec(env: ProvisionedEnv, op: ExecOp): Promise<ExecResult> {
    return this.deps.runOperation(op, { workspaceDir: env.workspaceDir });
  }

  async destroy(env: ProvisionedEnv): Promise<void> {
    if (this.deps.retainWorkspace) return;
    await rm(env.workspaceDir, { recursive: true, force: true });
  }

  async list(): Promise<ProvisionedEnv[]> {
    return [];
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run packages/workers/src/backends/local/local-execution-environment.test.ts`
Expected: PASS (contract suite: 3 + local: 4 = 7 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/workers/src/backends/contract.ts packages/workers/src/backends/local/local-execution-environment.ts packages/workers/src/backends/local/local-execution-environment.test.ts
git commit -m "feat(workers): local execution environment + contract suite"
```

---

## Task 5: Local backend (factory + config validation)

**Files:**
- Create: `packages/workers/src/backends/local/local-backend.ts`
- Test: `packages/workers/src/backends/local/local-backend.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/workers/src/backends/local/local-backend.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import type { OperationRunner, ResolvedWorker } from "@journeyman/core";
import { LocalBackend } from "./local-backend.ts";

const noopRunner: OperationRunner = async () => ({ ok: true });
const deps = { runOperation: noopRunner, defaultBaseDir: tmpdir() };

function worker(config: unknown): ResolvedWorker {
  return { id: "w1", type: "local", executionMode: "shared", config };
}

describe("LocalBackend", () => {
  it("declares type local, shared mode, no connectivity", () => {
    const b = new LocalBackend(deps);
    expect(b.type).toBe("local");
    expect(b.supportedModes).toEqual(["shared"]);
    expect(b.supportedConnectivity).toEqual([]);
  });

  it("validateConfig accepts undefined / empty / valid config", () => {
    const b = new LocalBackend(deps);
    expect(() => b.validateConfig(undefined)).not.toThrow();
    expect(() => b.validateConfig({})).not.toThrow();
    expect(() => b.validateConfig({ baseDir: "/tmp/x", retainWorkspace: true })).not.toThrow();
  });

  it("validateConfig rejects bad types", () => {
    const b = new LocalBackend(deps);
    expect(() => b.validateConfig({ baseDir: 5 })).toThrow(/baseDir/);
    expect(() => b.validateConfig({ retainWorkspace: "yes" })).toThrow(/retainWorkspace/);
  });

  it("create returns a working LocalExecutionEnvironment", async () => {
    const b = new LocalBackend(deps);
    const env = b.create(worker({}));
    expect(env.type).toBe("local");
    const p = await env.provision("run-1", {});
    const r = await env.exec(p, { op: "x", stdin: {} });
    expect(r.ok).toBe(true);
    await env.destroy(p);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/workers/src/backends/local/local-backend.test.ts`
Expected: FAIL — cannot resolve `./local-backend.ts`.

- [ ] **Step 3: Write the implementation**

Create `packages/workers/src/backends/local/local-backend.ts`:

```typescript
import type {
  Connectivity,
  ExecutionEnvironmentBackend,
  ExecutionMode,
  IExecutionEnvironment,
  OperationRunner,
  ResolvedWorker,
  WorkerType,
} from "@journeyman/core";
import { LocalExecutionEnvironment } from "./local-execution-environment.ts";

export interface LocalWorkerConfig {
  baseDir?: string;
  retainWorkspace?: boolean;
}

export interface LocalBackendDeps {
  runOperation: OperationRunner;
  defaultBaseDir: string;
}

export class LocalBackend implements ExecutionEnvironmentBackend {
  readonly type: WorkerType = "local";
  readonly supportedModes: ExecutionMode[] = ["shared"];
  readonly supportedConnectivity: Connectivity[] = [];

  constructor(private deps: LocalBackendDeps) {}

  validateConfig(config: unknown): void {
    if (config == null) return;
    if (typeof config !== "object") {
      throw new Error("local worker config must be an object");
    }
    const c = config as Record<string, unknown>;
    if (c.baseDir !== undefined && typeof c.baseDir !== "string") {
      throw new Error("local worker config.baseDir must be a string");
    }
    if (c.retainWorkspace !== undefined && typeof c.retainWorkspace !== "boolean") {
      throw new Error("local worker config.retainWorkspace must be a boolean");
    }
  }

  create(worker: ResolvedWorker): IExecutionEnvironment {
    this.validateConfig(worker.config);
    const cfg = (worker.config ?? {}) as LocalWorkerConfig;
    return new LocalExecutionEnvironment({
      runOperation: this.deps.runOperation,
      baseDir: cfg.baseDir ?? this.deps.defaultBaseDir,
      retainWorkspace: cfg.retainWorkspace,
    });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/workers/src/backends/local/local-backend.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/workers/src/backends/local/local-backend.ts packages/workers/src/backends/local/local-backend.test.ts
git commit -m "feat(workers): local backend with config validation"
```

---

## Task 6: Default registry helper + package exports

**Files:**
- Create: `packages/workers/src/default-registry.ts`
- Test: `packages/workers/src/default-registry.test.ts`
- Modify: `packages/workers/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/workers/src/default-registry.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import type { OperationRunner } from "@journeyman/core";
import { createDefaultRegistry } from "./default-registry.ts";

describe("createDefaultRegistry", () => {
  it("always registers the local backend", () => {
    const runOperation: OperationRunner = async () => ({ ok: true });
    const registry = createDefaultRegistry({ runOperation, defaultBaseDir: tmpdir() });
    expect(registry.available()).toContain("local");
    expect(registry.get("local").type).toBe("local");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/workers/src/default-registry.test.ts`
Expected: FAIL — cannot resolve `./default-registry.ts`.

- [ ] **Step 3: Write the implementation**

Create `packages/workers/src/default-registry.ts`:

```typescript
import type { OperationRunner } from "@journeyman/core";
import { InMemoryExecutionEnvironmentRegistry } from "./registry/in-memory-execution-environment-registry.ts";
import { LocalBackend } from "./backends/local/local-backend.ts";

export interface DefaultRegistryOptions {
  runOperation: OperationRunner;
  defaultBaseDir: string;
}

/** Build a registry pre-populated with the always-available `local` backend. */
export function createDefaultRegistry(
  opts: DefaultRegistryOptions,
): InMemoryExecutionEnvironmentRegistry {
  const registry = new InMemoryExecutionEnvironmentRegistry();
  registry.register(
    new LocalBackend({
      runOperation: opts.runOperation,
      defaultBaseDir: opts.defaultBaseDir,
    }),
  );
  return registry;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/workers/src/default-registry.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Replace the package exports**

Replace the entire contents of `packages/workers/src/index.ts` with:

```typescript
export { InMemoryExecutionEnvironmentRegistry } from "./registry/in-memory-execution-environment-registry.ts";
export { LocalExecutionEnvironment } from "./backends/local/local-execution-environment.ts";
export type { LocalExecutionEnvironmentDeps } from "./backends/local/local-execution-environment.ts";
export { LocalBackend } from "./backends/local/local-backend.ts";
export type { LocalWorkerConfig, LocalBackendDeps } from "./backends/local/local-backend.ts";
export { createDefaultRegistry } from "./default-registry.ts";
export type { DefaultRegistryOptions } from "./default-registry.ts";
```

- [ ] **Step 6: Commit**

```bash
git add packages/workers/src/default-registry.ts packages/workers/src/default-registry.test.ts packages/workers/src/index.ts
git commit -m "feat(workers): default registry helper + public exports"
```

---

## Task 7: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Run the workers package test suite**

Run: `npm test -w @journeyman/workers`
Expected: PASS — all suites (registry 4, local env contract 3 + local 4, local backend 4, default registry 1 = 16 tests).

- [ ] **Step 2: Typecheck the affected packages**

Run: `npm run typecheck -w @journeyman/core && npm run typecheck -w @journeyman/workers`
Expected: both PASS.

- [ ] **Step 3: Run the repo-wide checks**

Run: `npm run check`
Expected: PASS (typecheck across workspaces + import boundaries; `@journeyman/workers` classified as `backend`, importing only `@journeyman/core`).

- [ ] **Step 4: Confirm zero behavior change**

Confirm by inspection that no existing file outside `packages/core/src/index.ts`, `packages/core/src/types/`, `packages/workers/`, and `scripts/check-import-boundaries.mjs` was modified:

Run: `git diff --name-only origin/HEAD...HEAD`
Expected: only files under the paths listed above. Nothing in `orchestrator/`, `coding-cli/`, etc. (the harness is untouched — wiring happens in Plan 4).

- [ ] **Step 5: Final commit (if any uncommitted verification artifacts)**

```bash
git status
# If clean, nothing to do. Otherwise:
# git add -A && git commit -m "chore(workers): plan 1 verification"
```

---

## Self-Review

**Spec coverage (Plan 1 scope only):**
- §3 (`IExecutionEnvironment`, `ExecutionEnvironmentSpec`, `ProvisionedEnv`, `ExecOp`, `ExecResult`) → Task 1.
- §4 (pluggable registry: `ExecutionEnvironmentBackend`, `IExecutionEnvironmentRegistry`, mode/connectivity declarations) → Tasks 1, 3, 5.
- §5 / §18 (`local` passthrough, in-process, per-run workspace dir, `retainWorkspace`) → Tasks 4, 5.
- §13.1 (foundation, zero behavior change, default `local`) → all tasks; Task 7 Step 4 guards it.
- Out-of-Plan-1 (Docker exec, runner extraction, management, harness routing, reaper, logging) → explicitly deferred to Plans 2–7 in the roadmap.

**Placeholder scan:** No TBD/TODO; every code step shows complete code; every command shows expected output. The `index.ts` placeholder in Task 2 Step 3 is intentional and replaced in Task 6 Step 5.

**Type consistency:** `WorkerType`, `ExecutionMode`, `Connectivity`, `OperationRunner`, `ResolvedWorker`, `ExecutionEnvironmentBackend`, `IExecutionEnvironmentRegistry`, `IExecutionEnvironment` (members `type`/`provision`/`exec`/`destroy`/`list`), and `ProvisionedEnv.workspaceDir` are defined once in Task 1 and used identically in Tasks 3–6. `LocalExecutionEnvironmentDeps` (`runOperation`/`baseDir`/`retainWorkspace`) and `LocalBackendDeps` (`runOperation`/`defaultBaseDir`) are consistent between implementation and tests.
