# Sandbox / Worker Observability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface sandbox/worker lifecycle in the run viewer — provisioning lines from `ensureWorkspace`, clone output from `SandboxGitProvider`, and a skill-delivery line — with concise lines always-on and verbose detail gated by the node's `agentLogLevel`.

**Architecture:** Additive, optional hooks only. `ensureWorkspace` gains an optional `log`/`verbose` in its call args (wired by the harness to a `step.log` emitter + the resolved `agentLogLevel`). `CloneReposOptions` gains an optional `onLog` that `SandboxGitProvider` forwards on the `"clone"` ExecOp (the docker exec already streams stderr → `onLog`). No control-flow or behavior changes; provider/worker-agnostic.

**Tech Stack:** TypeScript (npm workspaces), vitest. Gate: `npm run check`.

**Spec:** [docs/superpowers/specs/2026-06-02-sandbox-worker-observability-design.md](../specs/2026-06-02-sandbox-worker-observability-design.md)

**Execution constraints:** already on branch `feat/dynamic-coding-provider`; **do NOT commit**; run `npm run check` at the end. (Per-task commit steps omitted.)

---

## Task 1: Lifecycle logs in `ensureWorkspace`

**Files:**
- Modify: `packages/orchestrator/src/sandbox/ensure-workspace.ts`
- Test: `packages/orchestrator/src/sandbox/ensure-workspace.test.ts` (extend existing)

- [ ] **Step 1: Extend the failing test**

Add to the existing test file:

```ts
it("emits lifecycle logs on the docker provision (won) path", async () => {
  const lines: string[] = [];
  const deps = {
    getSandbox: vi.fn().mockResolvedValue(null),
    claim: vi.fn().mockResolvedValue(true),
    markActive: vi.fn().mockResolvedValue(undefined),
    waitActive: vi.fn(),
    resolveWorker: vi.fn().mockResolvedValue({ type: "docker", config: {} }),
    provisionDocker: vi.fn().mockResolvedValue({
      env: {}, provisioned: { runId: "r", type: "docker", handle: "c1", workspaceDir: "/workspace" }, imageRef: "img:dev",
    }),
    provisionLocal: vi.fn(),
  };
  await ensureWorkspace(deps as any, { runId: "r", workerId: "w", userId: "u", orgId: "o", log: (l) => lines.push(l) });
  expect(lines.some((l) => /provisioning docker workspace/i.test(l))).toBe(true);
  expect(lines.some((l) => /workspace ready/i.test(l))).toBe(true);
});

it("emits 'using existing workspace' on the connect path", async () => {
  const lines: string[] = [];
  const deps = {
    getSandbox: vi.fn().mockResolvedValue({ runId: "r", type: "docker", status: "active", handle: "c1", connection: { kind: "local" } }),
    provisionDocker: vi.fn().mockResolvedValue({ env: {}, provisioned: { runId: "r", type: "docker", handle: "c1", workspaceDir: "/workspace" } }),
  };
  await ensureWorkspace(deps as any, { runId: "r", workerId: "w", userId: "u", orgId: "o", log: (l) => lines.push(l) });
  expect(lines.some((l) => /using existing workspace/i.test(l))).toBe(true);
});

it("logs a failure line when provisioning throws", async () => {
  const lines: string[] = [];
  const deps = {
    getSandbox: vi.fn().mockResolvedValue(null),
    claim: vi.fn().mockResolvedValue(true),
    resolveWorker: vi.fn().mockResolvedValue({ type: "docker", config: {} }),
    provisionDocker: vi.fn().mockRejectedValue(new Error("daemon down")),
    provisionLocal: vi.fn(), markActive: vi.fn(), waitActive: vi.fn(),
  };
  await expect(
    ensureWorkspace(deps as any, { runId: "r", workerId: "w", userId: "u", orgId: "o", log: (l) => lines.push(l) }),
  ).rejects.toThrow(/daemon down/);
  expect(lines.some((l) => /provisioning failed/i.test(l))).toBe(true);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd packages/orchestrator && npx vitest run src/sandbox/ensure-workspace.test.ts`
Expected: FAIL (no `log` in args; no lines emitted).

- [ ] **Step 3: Add `log`/`verbose` to the args and emit lines**

In `ensure-workspace.ts`, extend the `args` parameter type with:
```ts
    log?: (line: string) => void;
    verbose?: boolean;
```
Then emit (use a local `const log = args.log ?? (() => {});`):
- In `connect()` reuse path (active sandbox found): before returning, `log("Using existing workspace");` — pass `log` into `connect` or emit at the call site in `ensureWorkspace` right before `return connect(...)`.
- After `resolveWorker`: `if (args.verbose) log(\`Resolved worker: ${worker.type}\`);`
- Claim **lost** path (before `waitActive`): `log("Waiting for workspace…");` and after it resolves: `log("Workspace ready");`
- Claim **won**, local: `log("Provisioning local workspace…");` … after `markActive`: `log("Workspace ready");`
- Claim **won**, docker: `log("Provisioning docker workspace…");` then wrap the provision in try/catch:
  ```ts
  try {
    const { env, provisioned, imageRef, connection } = await deps.provisionDocker(args.runId, worker);
    if (args.verbose && imageRef) log(`Workspace image: ${imageRef}`);
    await deps.markActive(args.runId, { handle: provisioned.handle, volume: provisioned.volume ?? null, imageRef: imageRef ?? null, connection });
    log("Workspace ready");
    return { env, provisioned };
  } catch (err) {
    log(`Workspace provisioning failed: ${(err as Error).message}`);
    throw err;
  }
  ```
  (Apply the same try/catch + failure line to the local provision branch.)

> Keep all log calls behind the local `log` const so missing `log` is a no-op (additive/optional — see spec §6).

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/orchestrator && npx vitest run src/sandbox/ensure-workspace.test.ts`
Expected: PASS (existing 6 + new 3).

---

## Task 2: Wire `log`/`verbose` from the harness

**Files:**
- Modify: `packages/orchestrator/src/workers/worker-harness.ts`

- [ ] **Step 1: Build a step.log emitter and pass it into `ensureWorkspace`**

Where the harness calls `this.deps.ensureWorkspace({ runId, workerId, userId, orgId })` (the `needsWorkspace` block), change to:

```ts
const emitLog = (line: string) =>
  this.deps.events.append({
    workflowInstanceId, nodeId, eventType: "step.log", payload: { line },
  }).catch((err) => rlog.error({ err }, "provision log emit failed"));

const agentLogLevel = typeof (stepInput as { agentLogLevel?: string }).agentLogLevel === "string"
  ? (stepInput as { agentLogLevel: string }).agentLogLevel
  : "light";
const verbose = agentLogLevel === "medium" || agentLogLevel === "all";

const { env, provisioned } = await this.deps.ensureWorkspace({
  runId: workflowInstanceId,
  workerId: (stepInput as { workerId?: string }).workerId,
  userId, orgId,
  log: emitLog,
  verbose,
});
```

- [ ] **Step 2: Confirm the harness compiles + existing tests pass**

Run: `cd packages/orchestrator && npx vitest run src/workers`
Expected: PASS. (Update the harness test's `ensureWorkspace` stub signature only if it type-checks against the new optional args — optional fields shouldn't break it.)

> The cli-worker `ensureWs` closure already forwards its `args` object into `ensureWorkspace(deps, args)`, so `log`/`verbose` flow through with no cli-worker change. Verify by reading `cli-worker.ts`; if the closure destructures specific fields, widen it to forward `log`/`verbose`.

---

## Task 3: `CloneReposOptions.onLog` + `SandboxGitProvider` forwards it

**Files:**
- Modify: `packages/core/src/types/git.types.ts` (`CloneReposOptions`)
- Modify: `packages/orchestrator/src/sandbox/sandbox-git-provider.ts`
- Test: `packages/orchestrator/src/sandbox/sandbox-git-provider.test.ts`

- [ ] **Step 1: Add `onLog?` to `CloneReposOptions`**

In `git.types.ts`, add to `CloneReposOptions`:
```ts
  /** Optional progress sink — forwarded to the sandbox runner's stderr stream. */
  onLog?: (line: string, meta?: Record<string, unknown>) => void;
```

- [ ] **Step 2: Write the failing test**

In `sandbox-git-provider.test.ts` (create if absent):
```ts
import { describe, it, expect, vi } from "vitest";
import { SandboxGitProvider } from "./sandbox-git-provider.ts";

it("forwards onLog on the clone ExecOp", async () => {
  const exec = vi.fn().mockResolvedValue({ ok: true });
  const onLog = vi.fn();
  await new SandboxGitProvider(exec).cloneRepos({ repos: "https://x/HireIQ.git", onLog } as any);
  expect(exec).toHaveBeenCalledWith(expect.objectContaining({ op: "clone", onLog }));
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd packages/orchestrator && npx vitest run src/sandbox/sandbox-git-provider.test.ts`
Expected: FAIL — `onLog` not on the op.

- [ ] **Step 4: Forward `onLog` in `SandboxGitProvider.cloneRepos`**

In the `this.exec({ op: "clone", ... })` call, add:
```ts
        ...(opts.onLog ? { onLog: opts.onLog } : {}),
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd packages/orchestrator && npx vitest run src/sandbox/sandbox-git-provider.test.ts`
Expected: PASS.

---

## Task 4: Clone handler — concise lines + gated stderr

**Files:**
- Modify: `packages/orchestrator/src/workers/steps/clone-repos-step-handler.ts`

- [ ] **Step 1: Emit a concise line and pass `onLog` when verbose**

After computing `repos` and before calling `cloneRepos`, add:
```ts
const agentLogLevel = typeof input.agentLogLevel === "string" ? input.agentLogLevel : "light";
const verbose = agentLogLevel === "medium" || agentLogLevel === "all";
for (const r of repos) ctx.log(`Cloning ${r}…`);
```
Then pass `onLog` only when verbose:
```ts
const result = await git.cloneRepos({
  repos, workspaceDir, branch, signal: ctx.signal,
  ...(verbose ? { onLog: ctx.log } : {}),
});
```
After success, add: `for (const r of result.repos) if (!r.error) ctx.log(\`Cloned ${r.folderName}\`);`

- [ ] **Step 2: Run the handler tests**

Run: `cd packages/orchestrator && npx vitest run src/workers/steps`
Expected: PASS.

---

## Task 5: Skill-delivery line in the custom-ai handler

**Files:**
- Modify: `packages/orchestrator/src/workers/steps/custom-ai-step-handler.ts`

- [ ] **Step 1: Log before placing skills (container path)**

In the block that calls `placeSkills` (when `ctx.exec && ctx.materialize && skills.length`), add before the call:
```ts
ctx.log(`Delivering ${effectiveSkills.length} skill(s) to workspace`);
```
(Use whatever the local variable holding the skills array is named in the current handler — `skills`/`effectiveSkills`.)

- [ ] **Step 2: Run the custom-ai tests**

Run: `cd packages/orchestrator && npx vitest run src/workers/steps/skill-placement.test.ts src/workers/steps`
Expected: PASS.

---

## Task 6: Verify (typecheck + boundaries; do NOT commit)

- [ ] **Step 1: Touched-package tests**

Run:
```bash
( cd packages/core && npx vitest run )
( cd packages/orchestrator && npx vitest run src/sandbox src/workers )
```
Expected: PASS (pre-existing non-vitest "no test suite found" files are not regressions).

- [ ] **Step 2: Full check**

Run: `npm run check`
Expected: PASS (typecheck + `✓ Layer boundaries clean`).

- [ ] **Step 3: Leave uncommitted**

Run: `git status --short` — changes present, nothing committed. Stop.
