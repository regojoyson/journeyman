# Phase 0 — Registry-Driven Backend Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the execution-environment **registry** the single seam for selecting, provisioning, gating, and tearing down sandbox backends — removing the scattered `if (type === "docker"/"local")` branches in `ensure-workspace.ts`, `cli-worker.ts`, `composition.ts`, `sandbox-instances.ts`, and `cli-sandbox-instance.ts`.

**Architecture:** Each `ExecutionEnvironmentBackend.create(worker)` becomes fully self-contained (builds its own client from `worker.config.connection`, owns reconnect + image-spec resolution). Add an optional `checkRunnable(worker)` hook so docker's image-readiness gate moves out of the orchestrator. Provision/teardown call sites collapse to `registry.get(type).create(worker)`. The registry is built **per-process** (worker, api-server, CLI) from injected deps — there is no shared singleton. This is **behavior-preserving** for `local` and `docker`, guarded by the existing `runExecutionEnvironmentContract` suite plus new unit tests.

**Tech Stack:** TypeScript (Node 22, ESM, `.ts` extensions in imports), Vitest, npm workspaces. Packages: `@journeyman/core` (types), `@journeyman/sandbox` (backends/registry), `@journeyman/orchestrator` (worker + ensure-workspace), `@journeyman/api-server` (composition/teardown).

**Reference spec:** [2026-06-12-windows-sandbox-design.md](../specs/2026-06-12-windows-sandbox-design.md) §3.3 and findings 7, 10, 11.

---

## File Structure

**Modify (core types):**
- `packages/core/src/types/execution-environment.types.ts` — add `ProvisionedEnv.imageRef?`, `ExecutionEnvironmentBackend.checkRunnable?`.

**Modify (sandbox backends + registry):**
- `packages/sandbox/src/backends/local/local-backend.ts` — `runOperation` optional.
- `packages/sandbox/src/backends/local/local-execution-environment.ts` — `runOperation` optional; `exec` throws if missing.
- `packages/sandbox/src/backends/docker/docker-backend.ts` — deps become `{ makeClient, defaultImage, runnerCmd?, resolveImageRef?, onImagePending?, verifyImageFresh? }`; `create` builds a per-connection client and captures config; implement `checkRunnable`.
- `packages/sandbox/src/backends/docker/docker-execution-environment.ts` — `provision` resolves reconnect + image-spec from captured config (logic moved from `cli-worker.ts`).
- `packages/sandbox/src/default-registry.ts` — `DefaultRegistryOptions` carries per-connection factories; register configured backends.

**Create (sandbox):**
- `packages/sandbox/src/destroy-sandbox-instance.ts` — `destroySandboxInstance(registry, sb)` shared teardown helper.
- `packages/sandbox/src/destroy-sandbox-instance.test.ts`

**Modify (orchestrator):**
- `packages/orchestrator/src/sandbox/ensure-workspace.ts` — deps gain `registry` + `checkRunnable`; delete `provisionDocker`/`provisionLocal`/image-gating; `connect()` becomes registry-driven.
- `packages/orchestrator/src/cli-worker.ts` — build the worker's registry; delete the provision closures; relocate kit/image callbacks into the docker backend deps.

**Modify (api-server + CLI teardown):**
- `packages/api-server/src/composition.ts` — build a teardown registry; replace `dockerDestroy`/`destroyByType` with `destroySandboxInstance(registry, sb)`.
- `packages/sandbox/src/cli-sandbox-instance.ts` — use `destroySandboxInstance`.
- `packages/sandbox/src/routes/sandbox-instances.ts` — unchanged signature; receives the registry-backed `destroy`.

**Tests added/extended:**
- `packages/sandbox/src/backends/docker/docker-backend.test.ts`, `local-backend.test.ts`
- `packages/sandbox/src/default-registry.test.ts` (extend)
- `packages/orchestrator/src/sandbox/ensure-workspace.test.ts`

---

## Task 1: Add `imageRef` to ProvisionedEnv and `checkRunnable` to the backend interface

**Files:**
- Modify: `packages/core/src/types/execution-environment.types.ts`

- [ ] **Step 1: Add the two optional fields**

In `packages/core/src/types/execution-environment.types.ts`, add `imageRef` to `ProvisionedEnv`:

```typescript
/** Handle to a provisioned environment for a single run. */
export interface ProvisionedEnv {
  runId: string;
  type: SandboxType;
  /** Opaque backend handle (e.g. container id, or "local:<runId>"). */
  handle: string;
  /** Optional named volume (Docker). */
  volume?: string;
  /** Absolute path steps should treat as their workspace (e.g. "/workspace" or a local dir). */
  workspaceDir: string;
  /** Resolved image ref the backend provisioned with (Docker); persisted for reconnect/teardown. */
  imageRef?: string;
}
```

And add `checkRunnable` to `ExecutionEnvironmentBackend`:

```typescript
export interface ExecutionEnvironmentBackend {
  readonly type: SandboxType;
  readonly supportedModes: ExecutionMode[];
  readonly supportedConnectivity: Connectivity[];
  /** Throws if the worker's config is invalid for this type. */
  validateConfig(config: unknown): void;
  /**
   * Optional run-gate called before provisioning. Backends that depend on a
   * pre-built artifact (docker managed images) throw a retryable
   * ImageNotReadyError or a terminal ConfigurationError here. No-op when absent.
   */
  checkRunnable?(worker: ResolvedSandbox): void | Promise<void>;
  create(worker: ResolvedSandbox): IExecutionEnvironment;
}
```

- [ ] **Step 2: Type-check core**

Run: `npm run typecheck -w @journeyman/core`
Expected: PASS (these are additive optional fields).

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/types/execution-environment.types.ts
git commit -m "feat(core): add ProvisionedEnv.imageRef and ExecutionEnvironmentBackend.checkRunnable"
```

---

## Task 2: Make LocalBackend's `runOperation` optional (teardown without coding deps)

**Why:** A teardown-only process (api-server, CLI) must build `LocalBackend`/`LocalExecutionEnvironment` to call `destroy()` without supplying the coding-provider `runOperation` (finding 10).

**Files:**
- Modify: `packages/sandbox/src/backends/local/local-execution-environment.ts`
- Modify: `packages/sandbox/src/backends/local/local-backend.ts`
- Test: `packages/sandbox/src/backends/local/local-backend.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/sandbox/src/backends/local/local-backend.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalBackend } from "./local-backend.ts";
import type { ResolvedSandbox } from "@journeyman/core";

const worker: ResolvedSandbox = {
  id: "w1", type: "local", executionMode: "shared", config: {},
};

describe("LocalBackend without runOperation", () => {
  it("create + provision + destroy works for teardown (no runOperation)", async () => {
    const backend = new LocalBackend({ defaultBaseDir: join(tmpdir(), "jm-local-test") });
    const env = backend.create(worker);
    const p = await env.provision("run-teardown", {});
    await expect(env.destroy(p)).resolves.toBeUndefined();
  });

  it("exec without runOperation throws a clear error", async () => {
    const backend = new LocalBackend({ defaultBaseDir: join(tmpdir(), "jm-local-test") });
    const env = backend.create(worker);
    const p = await env.provision("run-exec", {});
    await expect(env.exec(p, { op: "echo", stdin: {} })).rejects.toThrow(
      /runOperation not configured/,
    );
    await env.destroy(p);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test -w @journeyman/sandbox -- local-backend`
Expected: FAIL — `LocalBackendDeps.runOperation` is required, so the construction without it is a type error / runtime nothing; the exec-error message doesn't exist yet.

- [ ] **Step 3: Make `runOperation` optional in the execution environment**

In `packages/sandbox/src/backends/local/local-execution-environment.ts`, change the deps and `exec`:

```typescript
export interface LocalExecutionEnvironmentDeps {
  runOperation?: OperationRunner;
  baseDir: string;
  retainWorkspace?: boolean;
}
```

```typescript
  async exec(env: ProvisionedEnv, op: ExecOp): Promise<ExecResult> {
    if (!this.deps.runOperation) {
      throw new Error("LocalExecutionEnvironment.exec: runOperation not configured (teardown-only env)");
    }
    return this.deps.runOperation(op, { workspaceDir: env.workspaceDir });
  }
```

- [ ] **Step 4: Make `runOperation` optional in the backend**

In `packages/sandbox/src/backends/local/local-backend.ts`:

```typescript
export interface LocalBackendDeps {
  runOperation?: OperationRunner;
  defaultBaseDir: string;
}
```

```typescript
  create(worker: ResolvedSandbox): IExecutionEnvironment {
    this.validateConfig(worker.config);
    const cfg = (worker.config ?? {}) as LocalWorkerConfig;
    return new LocalExecutionEnvironment({
      ...(this.deps.runOperation ? { runOperation: this.deps.runOperation } : {}),
      baseDir: cfg.baseDir ?? this.deps.defaultBaseDir,
      retainWorkspace: cfg.retainWorkspace,
    });
  }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -w @journeyman/sandbox -- local-backend`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/sandbox/src/backends/local/
git commit -m "feat(sandbox): make LocalBackend runOperation optional for teardown-only use"
```

---

## Task 3: Move docker provision (reconnect + image spec) into DockerExecutionEnvironment

**Why:** Today `cli-worker.ts`'s `provisionDocker` closure builds the spec, resolves the kit image, and handles reconnect, then calls `env.provision`. To make `create(worker)` self-contained, that logic moves into the env (config captured at construction; kit resolution injected).

**Files:**
- Modify: `packages/sandbox/src/backends/docker/docker-execution-environment.ts`

- [ ] **Step 1: Extend the env deps to capture config + image resolution**

In `packages/sandbox/src/backends/docker/docker-execution-environment.ts`, replace the deps interface and constructor usage:

```typescript
export interface DockerExecutionEnvironmentDeps {
  client: IDockerClient;
  runnerCmd?: string[];
  defaultImage?: string;
  /** Worker config captured at create() — carries connection, image recipe, __existingHandle, network, etc. */
  config?: Record<string, unknown>;
  /**
   * Resolve the image ref to provision with, ensuring it's present on this daemon.
   * Injected by the backend deps (orchestrator owns kit/registry specifics).
   * Falls back to defaultImage when absent.
   */
  resolveImageRef?: (config: Record<string, unknown>, client: IDockerClient) => Promise<string>;
}
```

- [ ] **Step 2: Rewrite `provision` to own reconnect + spec building**

Replace the `provision` method:

```typescript
  async provision(runId: string, spec: ExecutionEnvironmentSpec): Promise<ProvisionedEnv> {
    const config = this.deps.config ?? {};

    // Reconnect path: an existing container handle was recorded (connect()).
    const existingHandle = config["__existingHandle"];
    if (existingHandle) {
      return {
        runId,
        type: "docker",
        handle: String(existingHandle),
        volume: (config["__existingVolume"] as string | undefined) ?? undefined,
        workspaceDir: WORKSPACE,
      };
    }

    // Fresh provision: resolve the image ref (kit base or pre-built), then run idle.
    const imageRef = this.deps.resolveImageRef
      ? await this.deps.resolveImageRef(config, this.deps.client)
      : (spec.imageRef ?? this.deps.defaultImage);
    if (!imageRef) throw new Error("docker provision requires an imageRef or defaultImage");

    const volume = `jm-run-${runId}`;
    const network = config["network"] === "none" ? ("none" as const) : ("full" as const);
    const env = (config["env"] as Record<string, string> | undefined) ?? spec.env;
    const resources = (config["resources"] as ExecutionEnvironmentSpec["resources"] | undefined) ?? spec.resources;

    await this.deps.client.createVolume(volume);
    const handle = await this.deps.client.runIdle({
      image: imageRef,
      volume,
      mountPath: WORKSPACE,
      labels: { "journeyman.runId": runId },
      ...(env ? { env } : {}),
      ...(resources?.cpus ? { cpus: resources.cpus } : {}),
      ...(resources?.memoryMb ? { memoryMb: resources.memoryMb } : {}),
      network,
    });
    return { runId, type: "docker", handle, volume, workspaceDir: WORKSPACE, imageRef };
  }
```

> Note: `exec`, `destroy`, `list`, `materialize` are unchanged. `ExecutionEnvironmentSpec` is already imported.

- [ ] **Step 3: Type-check sandbox**

Run: `npm run typecheck -w @journeyman/sandbox`
Expected: PASS.

- [ ] **Step 4: Run the docker env tests (existing)**

Run: `npm test -w @journeyman/sandbox -- docker-execution-environment`
Expected: PASS (existing tests construct the env directly; passing `config`/`resolveImageRef` is optional, and `spec.imageRef` still works via the fallback).

- [ ] **Step 5: Commit**

```bash
git add packages/sandbox/src/backends/docker/docker-execution-environment.ts
git commit -m "refactor(sandbox): docker env owns reconnect + image-ref resolution from captured config"
```

---

## Task 4: Make DockerBackend self-contained (per-connection client + checkRunnable)

**Files:**
- Modify: `packages/sandbox/src/backends/docker/docker-backend.ts`
- Test: `packages/sandbox/src/backends/docker/docker-backend.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/sandbox/src/backends/docker/docker-backend.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { DockerBackend } from "./docker-backend.ts";
import type { IDockerClient } from "./docker-client.ts";
import type { ResolvedSandbox } from "@journeyman/core";

function fakeClient(): IDockerClient {
  return {
    createVolume: vi.fn(async () => {}),
    runIdle: vi.fn(async () => "container-123"),
    exec: vi.fn(async () => ({ stdout: "{}", exitCode: 0 })),
    removeContainer: vi.fn(async () => {}),
    removeVolume: vi.fn(async () => {}),
    listByLabel: vi.fn(async () => []),
    putArchive: vi.fn(async () => {}),
    imageExists: vi.fn(async () => true),
    ping: vi.fn(async () => {}),
  } as unknown as IDockerClient;
}

const worker: ResolvedSandbox = {
  id: "w1", type: "docker", executionMode: "per-instance",
  config: { connection: { host: "tcp://docker:2375" } },
};

describe("DockerBackend.create builds a per-connection client", () => {
  it("calls makeClient with the worker connection", () => {
    const client = fakeClient();
    const makeClient = vi.fn(() => client);
    const backend = new DockerBackend({ makeClient, defaultImage: "img:dev" });
    backend.create(worker);
    expect(makeClient).toHaveBeenCalledWith({ host: "tcp://docker:2375" });
  });

  it("checkRunnable throws ImageNotReadyError when a recipe image is pending", async () => {
    const backend = new DockerBackend({ makeClient: () => fakeClient(), defaultImage: "img:dev" });
    const pending: ResolvedSandbox = {
      ...worker,
      config: { connection: { host: "tcp://docker:2375" }, image: { kind: "dockerfile", content: "FROM x" } },
      imageState: "pending",
    };
    await expect(Promise.resolve(backend.checkRunnable!(pending))).rejects.toMatchObject({
      name: "ImageNotReadyError",
    });
  });

  it("checkRunnable is a no-op when there is no image recipe", async () => {
    const backend = new DockerBackend({ makeClient: () => fakeClient(), defaultImage: "img:dev" });
    await expect(Promise.resolve(backend.checkRunnable!(worker))).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test -w @journeyman/sandbox -- docker-backend`
Expected: FAIL — `DockerBackendDeps` has no `makeClient`, and `checkRunnable` does not exist.

- [ ] **Step 3: Define the gate errors and the new deps**

In `packages/sandbox/src/backends/docker/docker-backend.ts`, add the error helpers at top (after imports):

```typescript
/** Image still building/pending — retryable (Conductor backs off). */
export class ImageNotReadyError extends Error {
  constructor(msg: string) { super(msg); this.name = "ImageNotReadyError"; }
}
function configurationError(msg: string): Error {
  const e = new Error(msg) as Error & { name: string };
  e.name = "ConfigurationError";
  return e;
}
```

Replace `DockerBackendDeps`:

```typescript
export interface DockerBackendDeps {
  /** Build a docker client from a sandbox connection (per-connection, per-process). */
  makeClient: (connection: unknown) => IDockerClient;
  /** Default/base runner image when no recipe image is resolved. */
  defaultImage: string;
  runnerCmd?: string[];
  /** Resolve the image ref to provision with (kit base or pre-built), ensuring it's present. */
  resolveImageRef?: (config: Record<string, unknown>, client: IDockerClient) => Promise<string>;
  /** Re-enqueue a build when a ready image went missing. Optional (gating only). */
  onImagePending?: (sandboxId: string) => Promise<void>;
  /** Re-verify a ready image is still the latest. Optional (gating only). */
  verifyImageFresh?: (args: {
    sandboxId: string; config: Record<string, unknown>;
    storedFingerprint: string; storedImageRef: string;
  }) => Promise<{ fresh: boolean; reason?: string }>;
}
```

- [ ] **Step 4: Implement `checkRunnable` and the self-contained `create`**

Replace the `create` method and add `checkRunnable` (the gate logic is relocated verbatim from `ensure-workspace.ts` lines 121-159):

```typescript
  async checkRunnable(worker: ResolvedSandbox): Promise<void> {
    const config = (worker.config ?? {}) as Record<string, unknown>;
    const img = config["image"] as { kind?: string; imageRef?: string; content?: string } | undefined;
    const hasRecipe =
      (img?.kind === "ref" && !!img.imageRef?.trim()) ||
      (img?.kind === "dockerfile" && !!img.content?.trim());
    if (!hasRecipe) return;

    const state = worker.imageState ?? "none";
    if (state === "failed") {
      throw configurationError(`sandbox image build failed: ${worker.imageError ?? "see build log"}`);
    }
    if (state === "pending" || state === "building" || state === "none") {
      throw new ImageNotReadyError("sandbox image is not ready yet");
    }
    if (state === "ready" && !worker.imageRef) {
      if (this.deps.onImagePending) await this.deps.onImagePending(worker.id);
      throw new ImageNotReadyError("sandbox image was pruned; rebuilding");
    }
    if (this.deps.verifyImageFresh) {
      const v = await this.deps.verifyImageFresh({
        sandboxId: worker.id,
        config,
        storedFingerprint: worker.imageFingerprint ?? "",
        storedImageRef: worker.imageRef ?? "",
      });
      if (!v.fresh) {
        if (this.deps.onImagePending) await this.deps.onImagePending(worker.id);
        throw new ImageNotReadyError(v.reason ?? "sandbox image is stale; rebuilding");
      }
    }
    // ready + fresh → stamp the resolved ref so provision uses it.
    (config as Record<string, unknown>)["__imageRef"] = worker.imageRef;
  }

  create(worker: ResolvedSandbox): IExecutionEnvironment {
    this.validateConfig(worker.config);
    const config = (worker.config ?? {}) as Record<string, unknown>;
    const client = this.deps.makeClient(config["connection"]);
    return new DockerExecutionEnvironment({
      client,
      defaultImage: this.deps.defaultImage,
      ...(this.deps.runnerCmd ? { runnerCmd: this.deps.runnerCmd } : {}),
      config,
      ...(this.deps.resolveImageRef ? { resolveImageRef: this.deps.resolveImageRef } : {}),
    });
  }
```

> The `__imageRef` stamping in `checkRunnable` mirrors the old ensure-workspace behavior; `DockerExecutionEnvironment.provision`'s `resolveImageRef` reads it (Task 7 wires the cli-worker implementation that returns `config.__imageRef ?? kit base`).

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -w @journeyman/sandbox -- docker-backend`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/sandbox/src/backends/docker/docker-backend.ts packages/sandbox/src/backends/docker/docker-backend.test.ts
git commit -m "feat(sandbox): DockerBackend builds per-connection client + owns checkRunnable gate"
```

---

## Task 5: Extend `createDefaultRegistry` for per-process, factory-based deps

**Files:**
- Modify: `packages/sandbox/src/default-registry.ts`
- Test: `packages/sandbox/src/default-registry.test.ts` (extend)

- [ ] **Step 1: Update the options + builder**

Replace `packages/sandbox/src/default-registry.ts`:

```typescript
import type { OperationRunner } from "@journeyman/core";
import { InMemoryExecutionEnvironmentRegistry } from "./registry/in-memory-execution-environment-registry.ts";
import { LocalBackend } from "./backends/local/local-backend.ts";
import { DockerBackend, type DockerBackendDeps } from "./backends/docker/docker-backend.ts";

export interface DefaultRegistryOptions {
  /** Local backend deps. `runOperation` omitted ⇒ teardown-only (no exec). */
  runOperation?: OperationRunner;
  defaultBaseDir: string;
  /** When provided, also register the docker backend (per-connection factory-based). */
  docker?: DockerBackendDeps;
}

/** Build a per-process registry: `local` always, `docker` when configured. */
export function createDefaultRegistry(
  opts: DefaultRegistryOptions,
): InMemoryExecutionEnvironmentRegistry {
  const registry = new InMemoryExecutionEnvironmentRegistry();
  registry.register(
    new LocalBackend({
      ...(opts.runOperation ? { runOperation: opts.runOperation } : {}),
      defaultBaseDir: opts.defaultBaseDir,
    }),
  );
  if (opts.docker) registry.register(new DockerBackend(opts.docker));
  return registry;
}
```

- [ ] **Step 2: Update the existing test to the new docker deps shape**

In `packages/sandbox/src/default-registry.test.ts`, replace the docker option (was `{ client, defaultImage }`) with a factory:

```typescript
const registry = createDefaultRegistry({
  runOperation,
  defaultBaseDir: tmpdir(),
  docker: { makeClient: () => client, defaultImage: "journeyman/runner-base:dev" },
});
expect(registry.available()).toContain("local");
expect(registry.available()).toContain("docker");
```

- [ ] **Step 3: Run the test**

Run: `npm test -w @journeyman/sandbox -- default-registry`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/sandbox/src/default-registry.ts packages/sandbox/src/default-registry.test.ts
git commit -m "feat(sandbox): per-process registry with factory-based docker deps"
```

---

## Task 6: Add the shared `destroySandboxInstance` teardown helper

**Files:**
- Create: `packages/sandbox/src/destroy-sandbox-instance.ts`
- Test: `packages/sandbox/src/destroy-sandbox-instance.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/sandbox/src/destroy-sandbox-instance.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { destroySandboxInstance } from "./destroy-sandbox-instance.ts";
import type { SandboxInstanceRecord } from "./sandbox-instance-store.ts";
import type { IExecutionEnvironmentRegistry } from "@journeyman/core";

function recordOf(type: string): SandboxInstanceRecord {
  return { runId: "r1", type, handle: "h1", volume: "v1", imageRef: null, owner: null, connection: { host: "tcp://docker:2375" }, status: "active" };
}

describe("destroySandboxInstance", () => {
  it("creates the backend for the record type and calls destroy with the rebuilt env", async () => {
    const destroy = vi.fn(async () => {});
    const create = vi.fn(() => ({ destroy } as never));
    const registry = { get: vi.fn(() => ({ create })) } as unknown as IExecutionEnvironmentRegistry;
    await destroySandboxInstance(registry, recordOf("docker"));
    expect(registry.get).toHaveBeenCalledWith("docker");
    expect(destroy).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "r1", type: "docker", handle: "h1", volume: "v1" }),
    );
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test -w @journeyman/sandbox -- destroy-sandbox-instance`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the helper**

Create `packages/sandbox/src/destroy-sandbox-instance.ts`:

```typescript
import type { IExecutionEnvironmentRegistry, ResolvedSandbox, SandboxType } from "@journeyman/core";
import type { SandboxInstanceRecord } from "./sandbox-instance-store.ts";

/**
 * Tear down a tracked sandbox instance via the registry — the single teardown
 * path used by the api-server reaper, the admin routes, and the CLI. Synthesizes
 * a minimal ResolvedSandbox from the record (connection is enough for destroy).
 */
export async function destroySandboxInstance(
  registry: IExecutionEnvironmentRegistry,
  sb: SandboxInstanceRecord,
): Promise<void> {
  const type = sb.type as SandboxType;
  const worker: ResolvedSandbox = {
    id: sb.runId,
    type,
    executionMode: "shared",
    config: { connection: sb.connection ?? undefined },
  };
  const env = registry.get(type).create(worker);
  await env.destroy({
    runId: sb.runId,
    type,
    handle: sb.handle,
    ...(sb.volume ? { volume: sb.volume } : {}),
    workspaceDir: type === "local" ? sb.handle.replace(/^local:/, "") : "/workspace",
  });
}
```

> For `local`, the api-server's `LocalBackend` is built with `defaultBaseDir` set to `LOCAL_WORKSPACE_BASE`, so `destroy` removes `${baseDir}/${runId}` (`provision`'s dir convention). `workspaceDir` is recomputed by `LocalExecutionEnvironment.destroy` from the env passed; passing the run dir keeps parity with today's `rm` path.

- [ ] **Step 4: Export it**

In `packages/sandbox/src/index.ts`, add:

```typescript
export { destroySandboxInstance } from "./destroy-sandbox-instance.ts";
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -w @journeyman/sandbox -- destroy-sandbox-instance`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/sandbox/src/destroy-sandbox-instance.ts packages/sandbox/src/destroy-sandbox-instance.test.ts packages/sandbox/src/index.ts
git commit -m "feat(sandbox): shared destroySandboxInstance teardown helper"
```

---

## Task 7: Convert `ensure-workspace.ts` to registry-driven provisioning + gating

**Files:**
- Modify: `packages/orchestrator/src/sandbox/ensure-workspace.ts`
- Test: `packages/orchestrator/src/sandbox/ensure-workspace.test.ts`

- [ ] **Step 1: Replace the deps interface**

In `packages/orchestrator/src/sandbox/ensure-workspace.ts`, delete the `ImageNotReadyError`/`configurationError` definitions (they now live in the docker backend) and the `provisionDocker`/`provisionLocal`/`onImagePending`/`verifyImageFresh` deps. Replace `EnsureWorkspaceDeps` with:

```typescript
import type { IExecutionEnvironment, IExecutionEnvironmentRegistry, ProvisionedEnv } from "@journeyman/core";

export interface EnsureWorkspaceDeps {
  getSandboxInstance(runId: string): Promise<{
    runId: string; type: string; status: string; handle: string;
    volume?: string | null; connection?: unknown;
  } | null>;
  claim(row: { runId: string; type: string; owner: string }): Promise<boolean>;
  markActive(runId: string, patch: {
    handle: string; volume?: string | null; imageRef?: string | null; connection?: unknown;
  }): Promise<void>;
  waitActive(runId: string, timeoutMs: number): Promise<{
    handle: string; volume?: string | null; connection?: unknown;
  }>;
  resolveSandbox(sandboxId: string | undefined, ctx: { userId: string; orgId: string }): Promise<{
    id: string; type: string; config: Record<string, unknown>;
    imageState?: string; imageFingerprint?: string | null; imageRef?: string | null; imageError?: string | null;
  }>;
  /** The per-process backend registry. */
  registry: IExecutionEnvironmentRegistry;
}
```

- [ ] **Step 2: Replace the gating block with `checkRunnable`**

Replace the entire `if (worker.type === "docker") { … }` block (old lines 119-160) with:

```typescript
  // Run-gating is a backend concern (docker checks managed-image readiness).
  // Called AFTER the active/provisioning early-returns so reconnect skips it,
  // and BEFORE claim/provision so a not-ready throw still triggers Conductor retry.
  const backend = deps.registry.get(worker.type as never);
  if (backend.checkRunnable) {
    await backend.checkRunnable({
      id: worker.id, type: worker.type as never, executionMode: "shared",
      config: worker.config,
      ...(worker.imageState ? { imageState: worker.imageState as never } : {}),
      imageFingerprint: worker.imageFingerprint ?? null,
      imageRef: worker.imageRef ?? null,
      imageError: worker.imageError ?? null,
    });
  }
```

- [ ] **Step 3: Replace the local/docker provision branches with a single registry path**

Replace old lines 171-203 (the `if (worker.type === "local") { … }` and the docker fall-through) with:

```typescript
  // We are the builder. One path for every backend type.
  log(`Provisioning ${worker.type} workspace…`);
  try {
    const env = backend.create({
      id: worker.id, type: worker.type as never, executionMode: "shared", config: worker.config,
    });
    const provisioned = await env.provision(args.runId, {});
    await deps.markActive(args.runId, {
      handle: provisioned.handle,
      volume: provisioned.volume ?? null,
      imageRef: provisioned.imageRef ?? null,
      connection: (worker.config as Record<string, unknown>)["connection"],
    });
    if (args.verbose && provisioned.imageRef) log(`Workspace image: ${provisioned.imageRef}`);
    log("Workspace ready");
    return { env, provisioned };
  } catch (err) {
    log(`Workspace provisioning failed: ${(err as Error).message}`);
    throw err;
  }
```

- [ ] **Step 4: Make `connect()` registry-driven**

Replace `connect()`:

```typescript
async function connect(
  deps: EnsureWorkspaceDeps,
  sb: { runId: string; type: string; handle: string; volume?: string | null; connection?: unknown },
): Promise<EnsureWorkspaceResult> {
  const env = deps.registry.get(sb.type as never).create({
    id: sb.runId,
    type: sb.type as never,
    executionMode: "shared",
    config: {
      connection: sb.connection,
      __existingHandle: sb.handle,
      __existingVolume: sb.volume,
    },
  });
  const provisioned = await env.provision(sb.runId, {});
  return { env, provisioned };
}
```

> For `local`, `__existingHandle` is ignored by `LocalExecutionEnvironment.provision` (idempotent mkdir) — same as today.

- [ ] **Step 5: Remove the now-unused `export { ImageNotReadyError }` line**

Delete the trailing `export { ImageNotReadyError };`. (The worker-harness maps errors by `name`, not by importing the class — verify with: `grep -rn "ImageNotReadyError" packages/orchestrator/src`. If any import remains, repoint it to `@journeyman/sandbox`'s exported `ImageNotReadyError`; export it from sandbox's index if needed.)

- [ ] **Step 6: Write/Update the ensure-workspace test**

Create or extend `packages/orchestrator/src/sandbox/ensure-workspace.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { ensureWorkspace } from "./ensure-workspace.ts";
import type { IExecutionEnvironmentRegistry } from "@journeyman/core";

function fakeRegistry(opts: { checkRunnable?: () => Promise<void> }): IExecutionEnvironmentRegistry {
  const env = {
    provision: vi.fn(async (runId: string) => ({ runId, type: "local", handle: `local:${runId}`, workspaceDir: `/tmp/${runId}` })),
    destroy: vi.fn(), exec: vi.fn(), list: vi.fn(), materialize: vi.fn(),
  };
  const backend = { create: vi.fn(() => env), ...(opts.checkRunnable ? { checkRunnable: opts.checkRunnable } : {}) };
  return { get: vi.fn(() => backend), register: vi.fn(), available: vi.fn(() => []) } as unknown as IExecutionEnvironmentRegistry;
}

const baseDeps = (registry: IExecutionEnvironmentRegistry) => ({
  getSandboxInstance: vi.fn(async () => null),
  claim: vi.fn(async () => true),
  markActive: vi.fn(async () => {}),
  waitActive: vi.fn(async () => ({ handle: "" })),
  resolveSandbox: vi.fn(async () => ({ id: "w1", type: "local", config: {} })),
  registry,
});

describe("ensureWorkspace (registry-driven)", () => {
  it("provisions via the registry and marks active", async () => {
    const registry = fakeRegistry({});
    const deps = baseDeps(registry);
    const res = await ensureWorkspace(deps, { runId: "run-1", sandboxId: "w1", userId: "u", orgId: "o" });
    expect(res.provisioned.handle).toBe("local:run-1");
    expect(deps.markActive).toHaveBeenCalledWith("run-1", expect.objectContaining({ handle: "local:run-1" }));
  });

  it("propagates a not-ready throw from checkRunnable (before claim)", async () => {
    const err = Object.assign(new Error("not ready"), { name: "ImageNotReadyError" });
    const registry = fakeRegistry({ checkRunnable: async () => { throw err; } });
    const deps = baseDeps(registry);
    deps.resolveSandbox = vi.fn(async () => ({ id: "w1", type: "docker", config: {}, imageState: "pending" }));
    await expect(ensureWorkspace(deps, { runId: "run-2", sandboxId: "w1", userId: "u", orgId: "o" }))
      .rejects.toMatchObject({ name: "ImageNotReadyError" });
    expect(deps.claim).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 7: Run the tests**

Run: `npm test -w @journeyman/orchestrator -- ensure-workspace`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/orchestrator/src/sandbox/ensure-workspace.ts packages/orchestrator/src/sandbox/ensure-workspace.test.ts
git commit -m "refactor(orchestrator): ensure-workspace selects/gates/provisions via the registry"
```

---

## Task 8: Build the registry in `cli-worker.ts` and delete the provision closures

**Files:**
- Modify: `packages/orchestrator/src/cli-worker.ts`

- [ ] **Step 1: Build the worker registry (relocating kit/image logic into docker deps)**

In `packages/orchestrator/src/cli-worker.ts`, before the `ensureWs` definition, construct the registry. The `resolveImageRef`/`verifyImageFresh`/`onImagePending` callbacks are the **verbatim bodies** previously inside the `provisionDocker`/`verifyImageFresh` closures:

```typescript
import { createDefaultRegistry } from "@journeyman/sandbox";

const workerRegistry = createDefaultRegistry({
  runOperation: createCodingOperationRunner({
    makeProvider: (envVars) => createCodingProvider(undefined, { env: envVars }),
  }),
  defaultBaseDir: workspaceBaseDir,
  docker: {
    makeClient: (connection) => makeDockerClient(connection as Parameters<typeof makeDockerClient>[0]),
    defaultImage: RUNNER_IMAGE,
    resolveImageRef: async (config, client) => {
      const preBuilt = config["__imageRef"] as string | undefined;
      const { base: baseRef } = await kitRefs();
      const imageRef = preBuilt ?? baseRef;
      if (!preBuilt) await ensureKitImage(client, baseRef, REGISTRY_AUTH);
      return imageRef;
    },
    onImagePending: async (id) => { if (pool) await markImagePending(pool, id); },
    verifyImageFresh: async ({ config, storedFingerprint, storedImageRef }) => {
      const connection = (config as Record<string, unknown>)["connection"];
      const client = makeDockerClient(connection as Parameters<typeof makeDockerClient>[0]);
      const { bundle } = await kitRefs();
      await ensureKitImage(client, bundle, REGISTRY_AUTH);
      const inputs = await resolveBuildInputs({
        image: (config as Record<string, unknown>)["image"] as never,
        client, bundleRef: bundle,
      });
      const present = await client.imageExists(storedImageRef);
      const fresh = present && inputs.fingerprint === storedFingerprint;
      return {
        fresh,
        ...(fresh ? {} : { reason: `image drift: expected ${inputs.fingerprint}, have ${storedFingerprint || "none"}${present ? "" : " (image pruned)"}` }),
      };
    },
  },
});
```

- [ ] **Step 2: Replace the `ensureWs` deps to use the registry**

Replace the `ensureWorkspace({ … }, a)` deps object — delete `provisionLocal`, `provisionDocker`, `onImagePending`, `verifyImageFresh`, and add `registry`. Keep `getSandboxInstance`/`claim`/`markActive`/`waitActive`/`resolveSandbox`; make `resolveSandbox` return `id`:

```typescript
const ensureWs = (a: { runId: string; sandboxId: string | undefined; userId: string | null; orgId: string | null; log?: (line: string) => void; verbose?: boolean }) =>
  ensureWorkspace(
    {
      getSandboxInstance: (id) => (pool ? getSandboxInstance(pool, id) : Promise.resolve(null)),
      claim: (row) => (pool ? claimSandboxInstance(pool, row) : Promise.resolve(true)),
      markActive: (id, patch) => (pool ? markSandboxInstanceActive(pool, id, patch) : Promise.resolve()),
      waitActive: (id, ms) => (pool ? waitActive(pool, id, ms) : Promise.reject(new Error("no pool"))),
      resolveSandbox: async (sandboxId, ctx) => {
        if (pool) {
          const w = await resolveSandbox(pool, ctx, sandboxId);
          return {
            id: w.id, type: w.type, config: (w.config ?? {}) as Record<string, unknown>,
            imageState: w.imageState, imageFingerprint: w.imageFingerprint, imageRef: w.imageRef, imageError: w.imageError,
          };
        }
        return { id: "local", type: "local" as const, config: {} };
      },
      registry: workerRegistry,
    },
    a,
  );
```

> `resolveSandbox` (the `@journeyman/sandbox` resolver) already returns `id` on `ResolvedSandbox` — confirm with `grep -n "id:" packages/sandbox/src/resolver.ts`. If the local-fallback `w.id` is missing, the `id: w.id` line still type-checks because `ResolvedSandbox.id` is `string`.

- [ ] **Step 3: Remove now-dead imports**

If `LocalExecutionEnvironment` / `DockerExecutionEnvironment` / `ProvisionedEnv` are no longer referenced elsewhere in `cli-worker.ts`, remove their imports. Verify: `grep -n "DockerExecutionEnvironment\|LocalExecutionEnvironment" packages/orchestrator/src/cli-worker.ts`. Keep `makeDockerClient`, `kitRefs`, `ensureKitImage`, `resolveBuildInputs`, `REGISTRY_AUTH`, `markImagePending` (still used by the registry deps + the prune loop).

- [ ] **Step 4: Type-check the orchestrator**

Run: `npm run typecheck -w @journeyman/orchestrator`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/orchestrator/src/cli-worker.ts
git commit -m "refactor(orchestrator): cli-worker builds the registry; provision closures deleted"
```

---

## Task 9: Route all teardown through `destroySandboxInstance`

**Files:**
- Modify: `packages/api-server/src/composition.ts`
- Modify: `packages/sandbox/src/cli-sandbox-instance.ts`

- [ ] **Step 1: api-server — build a teardown registry and replace destroyByType**

In `packages/api-server/src/composition.ts`, replace the `dockerDestroy` + `destroyByType` definitions (lines 120-144) with a teardown registry + the shared helper:

```typescript
import { createDefaultRegistry, destroySandboxInstance, makeDockerClient } from "@journeyman/sandbox";

// Teardown-only registry: local backend has no runOperation (destroy is filesystem-only).
const teardownRegistry = createDefaultRegistry({
  defaultBaseDir: LOCAL_WORKSPACE_BASE,
  docker: {
    makeClient: (connection) => makeDockerClient(connection as Parameters<typeof makeDockerClient>[0]),
    defaultImage: RUNNER_IMAGE,
  },
});

const destroyByType = (sb: SandboxInstanceRecord): Promise<void> => destroySandboxInstance(teardownRegistry, sb);
```

> `destroyByType` keeps its name and signature, so the `sandboxReaper`, the `SandboxInstanceReaper`, and `sandboxInstanceRoutesDeps` need no further change. Update `sandboxInstanceRoutesDeps` to use `destroyByType` instead of `dockerDestroy`:

```typescript
const sandboxInstanceRoutesDeps: SandboxInstanceRoutesDeps | undefined = pool ? { destroy: destroyByType, isRunActive } : undefined;
```

- [ ] **Step 2: CLI — use the shared helper**

Replace the `destroy` function in `packages/sandbox/src/cli-sandbox-instance.ts`:

```typescript
import { createDefaultRegistry } from "./default-registry.ts";
import { destroySandboxInstance } from "./destroy-sandbox-instance.ts";

const LOCAL_WORKSPACE_BASE = process.env.JOURNEYMAN_WORKSPACE_BASE_DIR ?? `${process.cwd()}/.journeyman/workspaces`;
const teardownRegistry = createDefaultRegistry({
  defaultBaseDir: LOCAL_WORKSPACE_BASE,
  docker: { makeClient: (connection) => makeDockerClient(connection as DockerConnection), defaultImage: RUNNER_IMAGE },
});

async function destroy(sb: SandboxInstanceRecord): Promise<void> {
  await destroySandboxInstance(teardownRegistry, sb);
  await markSandboxInstanceDestroyed(pool, sb.runId);
}
```

> Remove the now-unused `DockerExecutionEnvironment` import from this file if nothing else uses it.

- [ ] **Step 3: Type-check both packages**

Run: `npm run typecheck -w @journeyman/api-server && npm run typecheck -w @journeyman/sandbox`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/api-server/src/composition.ts packages/sandbox/src/cli-sandbox-instance.ts
git commit -m "refactor: route all sandbox teardown through destroySandboxInstance(registry)"
```

---

## Task 10: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Type-check everything**

Run: `npm run typecheck`
Expected: PASS across all workspaces.

- [ ] **Step 2: Import boundaries**

Run: `npm run check:boundaries`
Expected: PASS (no new cross-layer edges — orchestrator/api-server → sandbox is already allowed).

- [ ] **Step 3: Full test suite**

Run: `npm test`
Expected: PASS, with the contract suite (`runExecutionEnvironmentContract`) green for `local` and `docker`, plus the new `local-backend`, `docker-backend`, `default-registry`, `destroy-sandbox-instance`, and `ensure-workspace` tests. Compare against the known baseline (the 5 pre-existing failures in `deps-campaign-test-baseline` — no NEW failures allowed).

- [ ] **Step 4: Grep for leftover type-switches (should be gone from the run path)**

Run: `grep -rn 'type === "docker"\|type === "local"\|provisionDocker\|provisionLocal\|dockerDestroy' packages/orchestrator/src packages/api-server/src`
Expected: no matches in `ensure-workspace.ts`, `cli-worker.ts`, `composition.ts` (the registry now owns selection). Remaining matches in unrelated files (e.g. the image-prune loop, which is image-not-instance teardown) are acceptable — confirm each is out of scope.

- [ ] **Step 5: Final commit (if any cleanup)**

```bash
git add -A
git commit -m "chore(sandbox): Phase 0 registry-driven selection — verification pass"
```

---

## Self-Review Notes

- **Spec coverage (§3.3):** Backends self-contained (Tasks 3-4) ✓; `checkRunnable` gate with throw-location + reconnect-bypass constraints (Tasks 4, 7) ✓; per-process registry with factory deps (Tasks 5, 8, 9) ✓; one `destroySandboxInstance` helper across all teardown entrypoints (Tasks 6, 9) ✓; `LocalBackend.runOperation` optional (Task 2) ✓; worker-harness unchanged (type-agnostic `wsEnv.exec`) ✓.
- **Behavior preservation:** docker reconnect (`__existingHandle`), image-ref resolution (kit base vs pre-built), and freshness/gating are relocated **verbatim** (Tasks 3, 4, 8), guarded by the contract suite + new unit tests.
- **Out of scope (later plans):** the Windows backend, agent-protocol, UI, step-timeout verification, packaging — all in Plans B/C/D per the spec.
