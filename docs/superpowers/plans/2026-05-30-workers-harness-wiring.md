# Workers Harness & Orchestrator Wiring Implementation Plan (Plan 5 of 7)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> ⚠️ **REVIEW BEFORE EXECUTING.** Unlike Plans 1–4 (additive), this plan modifies the live run pipeline. A mistake affects *all* runs. Execute in order; after each task run the regression check (a `local`-worker run must behave exactly as today). Full end-to-end verification requires the Conductor + DB + worker stack; the per-task checks here are unit + typecheck + the local-backend regression.

**Goal:** Make a workflow actually run on its selected worker: provision a sandbox at run start, route `requiresWorkspace` step operations through it (`SandboxCodingProvider`/`SandboxGitProvider` → `env.exec`), and tear it down when the run reaches a terminal state. The `local` worker (default) keeps today's in-process behavior unchanged.

**Architecture:** Provisioning happens in `ConductorOrchestrator.submit()` (api-server process): resolve `defaults.workerId` → `resolveWorker` → if non-`local`, `provision` a container and `recordSandbox` into `jm_sandbox_instances`. The worker harness (separate process) looks up the active sandbox per task by `workflowInstanceId` and, for `requiresWorkspace` handlers, exposes it on `StepContext.exec`. Workspace handlers use a `SandboxCodingProvider`/`SandboxGitProvider` (implementing the existing `ICodingCLI`/`IGitProvider`) that forwards each op to `env.exec` — so handler logic is unchanged, only *where* the op runs differs. Teardown fires in `ConductorOrchestrator.syncStatus()` when a run goes terminal. `clone` runs in-container via a new dispatch op backed by the baked-in `git`.

**Tech Stack:** TypeScript, vitest, `pg`. Builds on Plans 1–4.

**Depends on:** Plan 1 (interfaces/registry), Plan 2 (runner/dispatch), Plan 3 (`resolveWorker`, `workerId` fields), Plan 4 (`DockerExecutionEnvironment`, `sandbox-store`, `jm_sandbox_instances`).

**Out of scope:** Dockerfile build/auto-wrap (§8 — separate plan); reaper + manual cleanup CLI/API + logging-continuity NDJSON (Plan 6); multi-host sticky routing (use a `remote` Docker connection per Plan 4/§16).

---

## Key design decisions (read first)

- **No factory-signature change.** Sandbox access is threaded via a new **optional** `StepContext.exec`. Only the ~6 workspace handlers branch on it; everything else is untouched.
- **`requiresWorkspace` flag** (optional, on `IStepHandler`) tells the harness which steps need a sandbox lookup.
- **`local` backend = unchanged.** When the resolved worker is `local` (the default), `submit` provisions nothing, `StepContext.exec` is undefined, handlers run in-process via `DirectoryWorkspaceProvider` exactly as today. This is the regression guard.
- **Clone** is a new `clone` dispatch op (Plan 2's runner only had `ICodingCLI` ops); it shells the baked-in `git` inside the container.

---

## File Structure (Plan 5)

- `packages/core/src/types/step-handler.types.ts` — **Modify.** Add optional `exec?` to `StepContext`.
- `packages/core/src/interfaces/step-registry.interface.ts` — **Modify.** Add optional `requiresWorkspace?` to `IStepHandler`.
- `packages/orchestrator/src/sandbox/sandbox-coding-provider.ts` — **Create.** `ICodingCLI` → `env.exec`.
- `packages/orchestrator/src/sandbox/sandbox-coding-provider.test.ts` — **Create.**
- `packages/orchestrator/src/sandbox/sandbox-git-provider.ts` — **Create.** `IGitProvider.cloneRepos` → `env.exec`.
- `packages/orchestrator/src/sandbox/sandbox-git-provider.test.ts` — **Create.**
- `packages/coding-cli/src/runner/dispatch.ts` — **Modify.** Add the `clone` op (shells `git`).
- `packages/coding-cli/src/runner/dispatch.test.ts` — **Modify.** Cover `clone`.
- `packages/orchestrator/src/workers/steps/custom-ai-step-handler.ts` (+ `clone-repos`, `create-workspace`, `list-workspace-files`, `cleanup-workspace`, `start-feature-branch`) — **Modify.** Set `requiresWorkspace=true`; use `ctx.exec` when present.
- `packages/orchestrator/src/workers/worker-harness.ts` — **Modify.** `sandboxResolver` dep; resolve `ctx.exec`.
- `packages/orchestrator/src/cli-worker.ts` — **Modify.** Build registry + `sandboxResolver`; wire `createCodingOperationRunner` for `local`.
- `packages/orchestrator/src/engines/conductor/conductor-orchestrator.ts` — **Modify.** Provision in `submit`; teardown in `syncStatus`.
- `packages/api-server/src/composition.ts` — **Modify.** Pass sandbox deps to the orchestrator.

---

## Task 1: Core — `StepContext.exec` + `IStepHandler.requiresWorkspace`

**Files:**
- Modify: `packages/core/src/types/step-handler.types.ts`
- Modify: `packages/core/src/interfaces/step-registry.interface.ts`

- [ ] **Step 1: Add `exec` to `StepContext`**

In `packages/core/src/types/step-handler.types.ts`, add the import and field:

```typescript
import type { ExecOp, ExecResult } from "./execution-environment.types.ts";
```

Add to the `StepContext` interface (after `log`):

```typescript
  /**
   * Present only for sandboxed runs (non-local worker) on workspace-touching steps.
   * Forwards an operation to the run's execution environment (container).
   */
  exec?: (op: ExecOp) => Promise<ExecResult>;
```

- [ ] **Step 2: Add `requiresWorkspace` to `IStepHandler`**

In `packages/core/src/interfaces/step-registry.interface.ts`, add to the `IStepHandler` interface:

```typescript
  /** True ⇒ this step touches the run workspace and should run inside the run's sandbox when one exists. */
  readonly requiresWorkspace?: boolean;
```

- [ ] **Step 3: Typecheck core**

Run: `npm run typecheck -w @journeyman/core`
Expected: PASS.

---

## Task 2: `SandboxCodingProvider`

**Files:**
- Create: `packages/orchestrator/src/sandbox/sandbox-coding-provider.ts`
- Test: `packages/orchestrator/src/sandbox/sandbox-coding-provider.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/orchestrator/src/sandbox/sandbox-coding-provider.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import type { ExecOp, ExecResult } from "@journeyman/core";
import { SandboxCodingProvider } from "./sandbox-coding-provider.ts";

function execEnv(handler: (op: ExecOp) => ExecResult) {
  const calls: ExecOp[] = [];
  const exec = async (op: ExecOp): Promise<ExecResult> => {
    calls.push(op);
    return handler(op);
  };
  return { exec, calls };
}

describe("SandboxCodingProvider", () => {
  it("runCustomPrompt forwards to op 'custom-prompt' and maps structured output", async () => {
    const { exec, calls } = execEnv(() => ({ ok: true, structured: { hi: 1 } }));
    const p = new SandboxCodingProvider(exec);
    const r = await p.runCustomPrompt({ prompt: "x", outputMode: "structured", env: { K: "v" } });
    expect(r.structured).toEqual({ hi: 1 });
    expect(calls[0].op).toBe("custom-prompt");
    expect(calls[0].env).toEqual({ K: "v" });
    // functions must not be serialized into the request payload
    expect((calls[0].stdin as Record<string, unknown>).onLog).toBeUndefined();
  });

  it("runCustomPrompt maps an error result", async () => {
    const { exec } = execEnv(() => ({ ok: false, error: "boom" }));
    const p = new SandboxCodingProvider(exec);
    const r = await p.runCustomPrompt({ prompt: "x", outputMode: "text" });
    expect(r.error).toBe("boom");
  });

  it("scanRepos forwards to op 'scan-repos' and returns structured as the result", async () => {
    const { exec, calls } = execEnv(() => ({ ok: true, structured: { repos: [] } }));
    const p = new SandboxCodingProvider(exec);
    const r = await p.scanRepos({ parentDir: "/workspace" });
    expect(r.repos).toEqual([]);
    expect(calls[0].op).toBe("scan-repos");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/orchestrator/src/sandbox/sandbox-coding-provider.test.ts`
Expected: FAIL — cannot resolve `./sandbox-coding-provider.ts`.

- [ ] **Step 3: Write the implementation**

Create `packages/orchestrator/src/sandbox/sandbox-coding-provider.ts`:

```typescript
import type {
  CheckoutRepoOptions, CheckoutRepoResult,
  CleanupReposOptions, CleanupReposResult,
  CreateWorkspaceOptions, CreateWorkspaceResult,
  ExecOp, ExecResult,
  ICodingCLI,
  RunCustomPromptOptions, RunCustomPromptResult,
  ScanReposOptions, ScanReposResult,
} from "@journeyman/core";

type ExecFn = (op: ExecOp) => Promise<ExecResult>;

/** Strip non-serializable fields (callbacks, AbortSignal) before sending opts over the wire. */
function payload(opts: Record<string, unknown>): Record<string, unknown> {
  const { onLog, signal, ...rest } = opts as Record<string, unknown> & { onLog?: unknown; signal?: unknown };
  return rest;
}

/**
 * An ICodingCLI that forwards every operation to a run's execution environment
 * (container) via env.exec, instead of running it in-process. Handler logic is
 * unchanged; only the execution location differs.
 */
export class SandboxCodingProvider implements ICodingCLI {
  constructor(private exec: ExecFn) {}

  async runCustomPrompt(opts: RunCustomPromptOptions): Promise<RunCustomPromptResult> {
    const r = await this.exec({
      op: "custom-prompt",
      stdin: payload(opts as unknown as Record<string, unknown>),
      ...(opts.env ? { env: opts.env } : {}),
      ...(opts.signal ? { signal: opts.signal } : {}),
      ...(opts.onLog ? { onLog: opts.onLog } : {}),
    });
    if (!r.ok) return { error: r.error ?? "sandbox exec failed" };
    const s = r.structured as { result?: string } | undefined;
    return typeof s === "object" && s && "result" in s
      ? { result: s.result }
      : { structured: r.structured };
  }

  async scanRepos(opts: ScanReposOptions): Promise<ScanReposResult> {
    const r = await this.exec({ op: "scan-repos", stdin: payload(opts as unknown as Record<string, unknown>),
      ...(opts.signal ? { signal: opts.signal } : {}) });
    if (!r.ok) return { repos: [], error: r.error };
    return r.structured as ScanReposResult;
  }

  async checkoutRepo(opts: CheckoutRepoOptions): Promise<CheckoutRepoResult> {
    const r = await this.exec({ op: "checkout-repo", stdin: payload(opts as unknown as Record<string, unknown>),
      ...(opts.signal ? { signal: opts.signal } : {}), ...(opts.onLog ? { onLog: opts.onLog } : {}) });
    if (!r.ok) return { repos: [], newBranch: "", error: r.error };
    return r.structured as CheckoutRepoResult;
  }

  async cleanupRepos(opts: CleanupReposOptions): Promise<CleanupReposResult> {
    const r = await this.exec({ op: "cleanup-repos", stdin: payload(opts as unknown as Record<string, unknown>),
      ...(opts.signal ? { signal: opts.signal } : {}) });
    if (!r.ok) return { repos: [], error: r.error };
    return r.structured as CleanupReposResult;
  }

  async createWorkspace(opts: CreateWorkspaceOptions): Promise<CreateWorkspaceResult> {
    const r = await this.exec({ op: "create-workspace", stdin: payload(opts as unknown as Record<string, unknown>),
      ...(opts.signal ? { signal: opts.signal } : {}) });
    if (!r.ok) return { folderName: "", repoDir: "", error: r.error };
    return r.structured as CreateWorkspaceResult;
  }
}
```

> **Verify during implementation:** confirm `ICodingCLI` has exactly these 5 methods (`packages/core/src/interfaces/coding-cli.interface.ts`). If the workspace handlers call additional methods (`listWorkspaceFiles`, `startFeatureBranch`), add matching methods here + matching dispatch ops in Task 3, mirroring this pattern.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/orchestrator/src/sandbox/sandbox-coding-provider.test.ts`
Expected: PASS (3 tests).

---

## Task 3: `clone` dispatch op + `SandboxGitProvider`

**Files:**
- Modify: `packages/coding-cli/src/runner/dispatch.ts`
- Modify: `packages/coding-cli/src/runner/dispatch.test.ts`
- Create: `packages/orchestrator/src/sandbox/sandbox-git-provider.ts`
- Test: `packages/orchestrator/src/sandbox/sandbox-git-provider.test.ts`

- [ ] **Step 1: Add a `clone` op to the runner dispatch (in-container `git clone`)**

In `packages/coding-cli/src/runner/dispatch.ts`, add a clone branch. Add the import at the top:

```typescript
import { spawn } from "node:child_process";
```

Add a helper above `dispatchOperation`:

```typescript
function gitClone(url: string, dir: string, branch?: string): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    const args = ["clone", ...(branch ? ["--branch", branch] : []), url, dir];
    const child = spawn("git", args, { cwd: "/workspace" });
    let stderr = "";
    child.stderr.on("data", (d: Buffer) => { stderr += d.toString("utf8"); });
    child.on("error", (e) => resolve({ ok: false, error: e.message }));
    child.on("close", (code) => resolve(code === 0 ? { ok: true } : { ok: false, error: stderr.trim() }));
  });
}
```

Add a `case` inside the `switch (op)` in `dispatchOperation`, before `default`:

```typescript
    case "clone": {
      const url = String((opts as { repoUrl?: string; url?: string }).repoUrl ?? (opts as { url?: string }).url ?? "");
      const dir = String((opts as { dir?: string }).dir ?? "repo");
      const branch = (opts as { branch?: string }).branch;
      if (!url) return { ok: false, error: "clone requires repoUrl" };
      const r = await gitClone(url, dir, branch);
      return r.ok ? { ok: true, structured: { dir } } : { ok: false, error: r.error };
    }
```

- [ ] **Step 2: Cover `clone` in the dispatch test**

Add to `packages/coding-cli/src/runner/dispatch.test.ts`:

```typescript
  it("clone with no repoUrl returns an error (no git spawned)", async () => {
    const r = await dispatchOperation(fakeProvider(), "clone", {});
    expect(r).toEqual({ ok: false, error: "clone requires repoUrl" });
  });
```

Run: `npx vitest run packages/coding-cli/src/runner/dispatch.test.ts`
Expected: PASS (7 tests now).

- [ ] **Step 3: Write the failing test for `SandboxGitProvider`**

Create `packages/orchestrator/src/sandbox/sandbox-git-provider.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import type { ExecOp, ExecResult } from "@journeyman/core";
import { SandboxGitProvider } from "./sandbox-git-provider.ts";

describe("SandboxGitProvider", () => {
  it("cloneRepos forwards each repo to op 'clone' and aggregates results", async () => {
    const ops: ExecOp[] = [];
    const exec = async (op: ExecOp): Promise<ExecResult> => { ops.push(op); return { ok: true, structured: { dir: "repo" } }; };
    const p = new SandboxGitProvider(exec);
    const res = await p.cloneRepos({ repos: "https://git/x.git", workspaceDir: "/workspace", branch: "main" });
    expect(res.error).toBeUndefined();
    expect(ops[0].op).toBe("clone");
    expect((ops[0].stdin as Record<string, unknown>).repoUrl).toBe("https://git/x.git");
  });

  it("cloneRepos returns an error when a clone fails", async () => {
    const exec = async (): Promise<ExecResult> => ({ ok: false, error: "auth failed" });
    const p = new SandboxGitProvider(exec);
    const res = await p.cloneRepos({ repos: ["https://git/x.git"], workspaceDir: "/workspace" });
    expect(res.error).toMatch(/auth failed/);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run packages/orchestrator/src/sandbox/sandbox-git-provider.test.ts`
Expected: FAIL — cannot resolve `./sandbox-git-provider.ts`.

- [ ] **Step 5: Write the implementation**

Create `packages/orchestrator/src/sandbox/sandbox-git-provider.ts`:

```typescript
import type { ExecOp, ExecResult, IGitProvider } from "@journeyman/core";

type ExecFn = (op: ExecOp) => Promise<ExecResult>;

function toUrls(repos: unknown): string[] {
  if (typeof repos === "string") return repos.includes(",") ? repos.split(",").map((s) => s.trim()).filter(Boolean) : [repos];
  if (Array.isArray(repos)) return repos.filter((r): r is string => typeof r === "string");
  return [];
}

function folderName(url: string): string {
  return url.replace(/\.git$/, "").split("/").filter(Boolean).pop() ?? "repo";
}

/**
 * An IGitProvider whose cloneRepos runs `git clone` INSIDE the run's sandbox
 * (via env.exec op "clone"). Only cloneRepos is sandbox-routed; other IGitProvider
 * methods (PRs, etc.) are remote REST and never run here.
 */
export class SandboxGitProvider implements Partial<IGitProvider> {
  constructor(private exec: ExecFn) {}

  async cloneRepos(opts: { repos: string | string[]; workspaceDir: string; branch?: string; signal?: AbortSignal }) {
    const urls = toUrls(opts.repos);
    const results: Array<{ folderName: string; repoDir: string; url: string; branch?: string; error?: string }> = [];
    for (const url of urls) {
      const dir = folderName(url);
      const r = await this.exec({
        op: "clone",
        stdin: { repoUrl: url, dir, ...(opts.branch ? { branch: opts.branch } : {}) },
        ...(opts.signal ? { signal: opts.signal } : {}),
      });
      results.push({
        folderName: dir,
        repoDir: `${opts.workspaceDir}/${dir}`,
        url,
        ...(opts.branch ? { branch: opts.branch } : {}),
        ...(r.ok ? {} : { error: r.error }),
      });
    }
    const firstError = results.find((x) => x.error)?.error;
    return { repos: results, ...(firstError ? { error: firstError } : {}) };
  }
}
```

> **Verify during implementation:** match the exact `IGitProvider.cloneRepos` signature + `CloneResult` shape in `packages/core/src/types/git.types.ts`; adjust the returned object fields to match. The clone-repos handler reads `result.repos`.

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run packages/orchestrator/src/sandbox/sandbox-git-provider.test.ts`
Expected: PASS (2 tests).

---

## Task 4: Step handlers — `requiresWorkspace` + use `ctx.exec`

**Files:** the workspace step handlers under `packages/orchestrator/src/workers/steps/`.

For EACH workspace handler, (a) declare `readonly requiresWorkspace = true;` and (b) prefer `ctx.exec` when present. Example for `custom-ai-step-handler.ts`:

- [ ] **Step 1: `custom-ai-step-handler.ts`**

Add the field to the class:

```typescript
  readonly stepType = "custom-ai";
  readonly requiresWorkspace = true;
```

Replace the provider construction:

```typescript
    const coding = this.deps.coding(provider, ctx.env);
```

with:

```typescript
    const coding = ctx.exec
      ? new SandboxCodingProvider(ctx.exec)
      : this.deps.coding(provider, ctx.env);
```

and add the import at the top:

```typescript
import { SandboxCodingProvider } from "../../sandbox/sandbox-coding-provider.ts";
```

- [ ] **Step 2: `clone-repos-step-handler.ts`**

Add `readonly requiresWorkspace = true;`, import `SandboxGitProvider`, and replace:

```typescript
    const git = this.deps.git(typeof input.provider === "string" ? input.provider : undefined, ctx.env);
```

with:

```typescript
    const git = ctx.exec
      ? new SandboxGitProvider(ctx.exec)
      : this.deps.git(typeof input.provider === "string" ? input.provider : undefined, ctx.env);
```

(`SandboxGitProvider` is `Partial<IGitProvider>` but `cloneRepos` is present; if TS complains about the union type, narrow with a local `const cloneGit = git as Pick<IGitProvider, "cloneRepos">;` before the `.cloneRepos` call.)

- [ ] **Step 3: `create-workspace`, `list-workspace-files`, `cleanup-workspace`, `start-feature-branch`**

For each, add `readonly requiresWorkspace = true;` and the same `ctx.exec ? new SandboxCodingProvider(ctx.exec) : this.deps.coding(...)` swap. (If any call an `ICodingCLI` method not yet in `SandboxCodingProvider`/dispatch, add it per Task 2/3 notes.)

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck -w @journeyman/orchestrator`
Expected: PASS.

---

## Task 5: Worker harness — resolve `ctx.exec`

**Files:**
- Modify: `packages/orchestrator/src/workers/worker-harness.ts`

- [ ] **Step 1: Add a `sandboxResolver` dep**

Add to `WorkerHarnessDeps`:

```typescript
  /** Resolves the active sandbox for a run into an exec fn. Returns null for local/no sandbox. */
  sandboxResolver?: (workflowInstanceId: string) => Promise<((op: ExecOp) => Promise<ExecResult>) | null>;
```

(import `ExecOp`, `ExecResult` from `@journeyman/core`.)

- [ ] **Step 2: Resolve `ctx.exec` before `handler.run`**

In `processOnce`, after the handler is fetched (`const handler = this.deps.registry.get(stepType);`) and before `handler.run(...)`, add:

```typescript
      let execFn: ((op: ExecOp) => Promise<ExecResult>) | undefined;
      if (handler.requiresWorkspace && this.deps.sandboxResolver) {
        execFn = (await this.deps.sandboxResolver(workflowInstanceId)) ?? undefined;
      }
```

Then pass it into the `handler.run(stepInput, { ... })` context object:

```typescript
        ...(execFn ? { exec: execFn } : {}),
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck -w @journeyman/orchestrator`
Expected: PASS.

---

## Task 6: cli-worker — registry + sandboxResolver + local operation runner

**Files:**
- Modify: `packages/orchestrator/src/cli-worker.ts`

- [ ] **Step 1: Build the execution registry**

Add imports:

```typescript
import {
  createDefaultRegistry, DockerExecutionEnvironment, makeProcessCommandRunner, getSandbox,
} from "@journeyman/workers";
import { createCodingOperationRunner } from "@journeyman/coding-cli";
import type { ExecOp, ExecResult, ProvisionedEnv } from "@journeyman/core";
```

After `pool` is created, build the registry + a docker command runner:

```typescript
const RUNNER_IMAGE = process.env.JOURNEYMAN_RUNNER_IMAGE ?? "journeyman/runner-base:dev";
const dockerCmd = makeProcessCommandRunner("docker");
const execRegistry = createDefaultRegistry({
  runOperation: createCodingOperationRunner({
    makeProvider: (env) => new ClaudeProvider({ apiKey: env.ANTHROPIC_API_KEY }),
  }),
  defaultBaseDir: workspaceBaseDir,
  docker: { docker: dockerCmd, defaultImage: RUNNER_IMAGE },
});
```

- [ ] **Step 2: Build the `sandboxResolver`**

```typescript
const sandboxResolver = async (
  workflowInstanceId: string,
): Promise<((op: ExecOp) => Promise<ExecResult>) | null> => {
  if (!pool) return null;
  const sb = await getSandbox(pool, workflowInstanceId);
  if (!sb || sb.status !== "active" || sb.type === "local") return null;
  const backend = execRegistry.get(sb.type as ProvisionedEnv["type"]);
  // For docker, build an env bound to the daemon and exec into the recorded container.
  const env = new DockerExecutionEnvironment({ docker: dockerCmd, defaultImage: RUNNER_IMAGE });
  const provisioned: ProvisionedEnv = {
    runId: sb.runId, type: "docker", handle: sb.handle,
    volume: sb.volume ?? undefined, workspaceDir: "/workspace",
  };
  void backend; // registry.get validates the type is configured
  return (op: ExecOp) => env.exec(provisioned, op);
};
```

- [ ] **Step 3: Pass `sandboxResolver` to the harness**

Add `sandboxResolver,` to the `new WorkerHarness({ ... })` deps.

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck -w @journeyman/orchestrator`
Expected: PASS.

---

## Task 7: Orchestrator — provision at run start

**Files:**
- Modify: `packages/orchestrator/src/engines/conductor/conductor-orchestrator.ts`
- Modify: `packages/api-server/src/composition.ts`

- [ ] **Step 1: Add optional sandbox deps to the orchestrator**

Add to the orchestrator's deps interface:

```typescript
  /** Provisions a sandbox for a run; no-op/absent for local-only deployments. */
  sandboxProvisioner?: (args: {
    workflowInstanceId: string;
    workerId?: string;
    userId: string | null;
    orgId: string | null;
  }) => Promise<void>;
  sandboxReaper?: (workflowInstanceId: string) => Promise<void>;
```

- [ ] **Step 2: Call the provisioner in `submit()`**

After `setStatus(instance.id, "running")`, add:

```typescript
    if (this.deps.sandboxProvisioner) {
      await this.deps.sandboxProvisioner({
        workflowInstanceId: instance.id,
        workerId: args.definitionSnapshot.defaults?.workerId,
        userId: args.startedByUserId ?? null,
        orgId: args.startedByOrgId ?? null,
      }).catch((err) => { /* log; do not fail the run start */ });
    }
```

- [ ] **Step 3: Call the reaper in `syncStatus()` on terminal**

Where `setStatus(workflowInstanceId, mapped, ...)` is called with a terminal `mapped`, add after it:

```typescript
    if (isTerminalStatus(mapped) && this.deps.sandboxReaper) {
      await this.deps.sandboxReaper(workflowInstanceId).catch(() => undefined);
    }
```

(import `isTerminalStatus` from `@journeyman/core`.)

- [ ] **Step 4: Wire the implementations in `composition.ts`**

Build the provisioner/reaper from the pool + a docker env + the workers helpers, and pass them into `new ConductorOrchestrator({ ... })`:

```typescript
import {
  resolveWorker, recordSandbox, getSandbox, markSandboxDestroyed,
  DockerExecutionEnvironment, makeProcessCommandRunner, dockerSpecFromConfig,
} from "@journeyman/workers";

// ...inside buildComposition, when pool exists:
const RUNNER_IMAGE = process.env.JOURNEYMAN_RUNNER_IMAGE ?? "journeyman/runner-base:dev";
const dockerCmd = makeProcessCommandRunner("docker");

const sandboxProvisioner = pool ? async (a: {
  workflowInstanceId: string; workerId?: string; userId: string | null; orgId: string | null;
}) => {
  if (!a.userId || !a.orgId) return;                       // need a scope to resolve workers
  const worker = await resolveWorker(pool!, { orgId: a.orgId, userId: a.userId }, a.workerId);
  if (worker.type === "local") return;                      // local = in-process, no container
  if (worker.type !== "docker") return;                     // other types: later plans
  const env = new DockerExecutionEnvironment({ docker: dockerCmd, defaultImage: RUNNER_IMAGE });
  const spec = dockerSpecFromConfig(worker.config as Record<string, unknown>, RUNNER_IMAGE);
  const provisioned = await env.provision(a.workflowInstanceId, spec);
  await recordSandbox(pool!, {
    runId: a.workflowInstanceId, type: "docker", handle: provisioned.handle,
    volume: provisioned.volume ?? null, imageRef: spec.imageRef ?? null, owner: a.orgId,
  });
} : undefined;

const sandboxReaper = pool ? async (workflowInstanceId: string) => {
  const sb = await getSandbox(pool!, workflowInstanceId);
  if (!sb || sb.status !== "active" || sb.type !== "docker") return;
  const env = new DockerExecutionEnvironment({ docker: dockerCmd, defaultImage: RUNNER_IMAGE });
  await env.destroy({ runId: sb.runId, type: "docker", handle: sb.handle, volume: sb.volume ?? undefined, workspaceDir: "/workspace" });
  await markSandboxDestroyed(pool!, workflowInstanceId);
} : undefined;

const orchestrator = new ConductorOrchestrator({
  client: conductorClient,
  converter: new ConductorJsonConverter(),
  workflowInstances,
  workflowInstanceGrants,
  events,
  ...(sandboxProvisioner ? { sandboxProvisioner } : {}),
  ...(sandboxReaper ? { sandboxReaper } : {}),
});
```

- [ ] **Step 5: add `@journeyman/workers` to api-server deps if not already (Plan 3 added it). Typecheck**

Run: `npm run typecheck -w @journeyman/orchestrator && npm run typecheck -w @journeyman/api-server`
Expected: both PASS.

---

## Task 8: Verification

**Files:** none.

- [ ] **Step 1: Unit suites**

Run: `npm test -w @journeyman/workers && npm test -w @journeyman/coding-cli && npx vitest run packages/orchestrator/src/sandbox`
Expected: all PASS (coding-cli dispatch now 7; new orchestrator sandbox suites pass).

- [ ] **Step 2: Typecheck all touched packages + boundaries**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 3: Local-backend regression (zero behavior change)**

With **no worker configured** (default `local`): start the stack (`npm run infra:up`, `npm run migrate`, `npm run start:api-server`, `npm run start:worker`) and run an existing workflow. Confirm it behaves exactly as before (in-process, `DirectoryWorkspaceProvider`), `StepContext.exec` is undefined, and **no** `jm_sandbox_instances` row is created. If the stack isn't runnable here, note it and rely on the unit + typecheck evidence + the `sandboxProvisioner` early-returns for `local`.

- [ ] **Step 4: Docker-backend smoke (GATED — full stack + Docker)**

Create a `docker` worker (per-instance), set it as the workflow's worker, run a workflow with a `custom-ai` + `clone-repos` step. Confirm: a `jm_sandbox_instances` row appears at start; the container runs the steps (check `docker ps` during the run); the row is marked `destroyed` and the container removed at the end. If not runnable here, document as unverified.

---

## Self-Review

**Spec coverage (Plan 5 scope):**
- §6/§7 run-start provisioning of the selected worker → Task 7.
- §9 `requiresWorkspace` routing of workspace steps through the sandbox; remote steps untouched → Tasks 1, 4 (+ `SandboxCodingProvider`/`SandboxGitProvider` Tasks 2–3).
- §6 clone runs in-container → Task 3 (`clone` dispatch op).
- §10 teardown on terminal state → Task 7 Step 3.
- §12 `local` default = unchanged behavior → design + Task 8 Step 3 regression.
- Deferred & noted: Dockerfile auto-wrap (§8) separate; reaper + manual cleanup + NDJSON logging continuity → Plan 6; non-docker types → Plan 7.

**Placeholder scan:** No TBD/TODO. Testable units (`SandboxCodingProvider`, `SandboxGitProvider`, `clone` op) have full code + tests. Wiring tasks have concrete code at named insertion points (from the run-lifecycle research). Two "verify the exact interface signature" notes (ICodingCLI method set; IGitProvider.cloneRepos/CloneResult shape) are correctness checks against real files, to be confirmed at implementation — not placeholders. The full-stack steps (Task 8 Steps 3–4) are explicitly gated.

**Type consistency:** `ExecOp`/`ExecResult` (Plan 1) flow from `StepContext.exec` (Task 1) → harness `sandboxResolver` (Task 5) → `SandboxCodingProvider`/`SandboxGitProvider` (Tasks 2–3) → `DockerExecutionEnvironment.exec` (Plan 4). `requiresWorkspace` is read in the harness (Task 5) and set on handlers (Task 4). `resolveWorker` (Plan 3) + `dockerSpecFromConfig`/`recordSandbox`/`getSandbox`/`markSandboxDestroyed` (Plans 3–4) are used in `composition.ts` (Task 7). The `clone` op name matches between `SandboxGitProvider` (Task 3 Step 5) and the dispatch case (Task 3 Step 1).
