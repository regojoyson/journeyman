# Hang-Fix Trace Logs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire four hang-fix scenarios (pull timeout, clone abort, step timeout, ImageNotReadyError) into the `step.log` event stream so they appear in the workflow instance log panel, and improve `step.failed` to display reason + error message inline.

**Architecture:** Five targeted changes across four packages. No new abstractions. All new log lines flow through the existing `step.log → IEventBus.append → SSE → WorkflowLogsPanel` pipeline. Each task is independently testable. No commits per task — a single typecheck is run at the end.

**Tech Stack:** TypeScript, Vitest, `IEventBus`, `step.log` / `step.failed` event types.

---

## File Map

| File | Role |
|---|---|
| `packages/run-viewer/src/logs/parse-logs.ts` | Formatter — improve `step.failed` display |
| `packages/run-viewer/src/logs/parse-logs.test.ts` | New test file |
| `packages/core/src/types/execution-environment.types.ts` | Interface — add `log?` to `checkRunnable` |
| `packages/sandbox/src/backends/docker/docker-backend.ts` | Thread `log` into `verifyImageFresh` |
| `packages/sandbox/src/backends/docker/docker-backend.test.ts` | Extend existing test |
| `packages/orchestrator/src/sandbox/ensure-workspace.ts` | Pass `args.log` to `checkRunnable` |
| `packages/orchestrator/src/cli-worker.ts` | Destructure + forward `log` in `verifyImageFresh` closure |
| `packages/orchestrator/src/workers/steps/clone-repos-step-handler.ts` | Emit `ctx.log` on clone error |
| `packages/orchestrator/src/workers/steps/clone-repos-step-handler.test.ts` | New test file |
| `packages/orchestrator/src/workers/worker-harness.ts` | `TimeoutError` branch + `step.log` before `ImageNotReadyError` |
| `packages/orchestrator/src/workers/worker-harness.test.ts` | Extend existing tests |

---

## Task 1 — Improve `step.failed` display in parse-logs.ts

**Files:**
- Modify: `packages/run-viewer/src/logs/parse-logs.ts:45-46`
- Create: `packages/run-viewer/src/logs/parse-logs.test.ts`

### Why

`formatWorkflowEvent` currently renders every `step.failed` as `"❌ step failed"` regardless of `reason` or `error.message`. Both fields are in the event payload but never shown.

- [ ] **Step 1: Create the test file**

Create `packages/run-viewer/src/logs/parse-logs.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseLogs } from "./parse-logs.ts";

function ev(eventType: string, payload: Record<string, unknown>): any {
  return { id: 1, ts: "2026-01-01T00:00:00Z", nodeId: "n", eventType, payload };
}

describe("parseLogs — step.failed formatting", () => {
  it("shows reason and error.message when both present", () => {
    const [log] = parseLogs(
      [ev("step.failed", { reason: "timeout", error: { message: "Step timed out" } })],
      [],
    );
    expect(log.line).toBe("❌ step failed: timeout — Step timed out");
  });

  it("shows only reason when error has no message", () => {
    const [log] = parseLogs([ev("step.failed", { reason: "image_not_ready" })], []);
    expect(log.line).toBe("❌ step failed: image_not_ready");
  });

  it("shows only error.message when reason is absent", () => {
    const [log] = parseLogs([ev("step.failed", { error: { message: "disk full" } })], []);
    expect(log.line).toBe("❌ step failed: disk full");
  });

  it("shows string error directly when error is a plain string", () => {
    const [log] = parseLogs([ev("step.failed", { error: "something broke" })], []);
    expect(log.line).toBe("❌ step failed: something broke");
  });

  it("falls back to bare label when no reason or error", () => {
    const [log] = parseLogs([ev("step.failed", {})], []);
    expect(log.line).toBe("❌ step failed");
  });
});
```

- [ ] **Step 2: Run the tests — confirm they fail**

```bash
npm test -w packages/run-viewer -- --reporter=verbose parse-logs
```

Expected: 5 failures — `parseLogs` is not exported or the formatter doesn't match yet.

- [ ] **Step 3: Implement the formatter change**

In `packages/run-viewer/src/logs/parse-logs.ts`, replace lines 45-46:

```ts
case "step.failed":
  return `❌ step failed${typeof p.error === "string" ? `: ${p.error}` : ""}`;
```

With:

```ts
case "step.failed": {
  const reason = typeof p.reason === "string" ? p.reason : null;
  const msg =
    typeof (p.error as any)?.message === "string"
      ? (p.error as any).message
      : typeof p.error === "string"
      ? p.error
      : null;
  const detail = [reason, msg].filter(Boolean).join(" — ");
  return `❌ step failed${detail ? `: ${detail}` : ""}`;
}
```

- [ ] **Step 4: Run the tests — confirm all 5 pass**

```bash
npm test -w packages/run-viewer -- --reporter=verbose parse-logs
```

Expected: 5 passed.

---

## Task 2 — Wire `log` callback through `checkRunnable` to `verifyImageFresh`

**Files:**
- Modify: `packages/core/src/types/execution-environment.types.ts:123`
- Modify: `packages/sandbox/src/backends/docker/docker-backend.ts:29-32, 57, 77-82`
- Modify: `packages/orchestrator/src/sandbox/ensure-workspace.ts:108`
- Modify: `packages/orchestrator/src/cli-worker.ts:143-152`
- Test: `packages/sandbox/src/backends/docker/docker-backend.test.ts`

### Why

`resolveBuildInputs` already emits a warning when a pull times out (`"warning: could not pull '...' (pull timed out after 60s); using local copy"`). But both call sites pass no `log` arg, so it falls back to a no-op. The fix threads the provisioning `log` callback (which worker-harness already wires to `step.log` events) down through `checkRunnable → verifyImageFresh → resolveBuildInputs`.

- [ ] **Step 1: Write the failing test**

Add to the `describe("DockerBackend.checkRunnable", ...)` block in `packages/sandbox/src/backends/docker/docker-backend.test.ts`:

```ts
it("forwards log callback to verifyImageFresh", async () => {
  const log = vi.fn();
  const verifyImageFresh = vi.fn().mockResolvedValue({ fresh: true });
  const b = new DockerBackend({ ...deps, verifyImageFresh });
  const ready = {
    ...worker({ image: { kind: "ref", imageRef: "x:1" } }),
    imageState: "ready" as const,
    imageRef: "jm-built:abc",
    imageFingerprint: "fp1",
  };
  await b.checkRunnable!(ready, log);
  expect(verifyImageFresh).toHaveBeenCalledWith(expect.objectContaining({ log }));
});
```

- [ ] **Step 2: Run the test — confirm it fails**

```bash
npm test -w packages/sandbox -- --reporter=verbose docker-backend
```

Expected: FAIL — `checkRunnable` only accepts one argument; `verifyImageFresh` is not called with `log`.

- [ ] **Step 3: Add `log?` to the `checkRunnable` interface**

In `packages/core/src/types/execution-environment.types.ts`, replace line 123:

```ts
checkRunnable?(worker: ResolvedSandbox): void | Promise<void>;
```

With:

```ts
checkRunnable?(worker: ResolvedSandbox, log?: (line: string) => void): void | Promise<void>;
```

- [ ] **Step 4: Add `log?` to `DockerBackendDeps.verifyImageFresh` args**

In `packages/sandbox/src/backends/docker/docker-backend.ts`, replace lines 29-32:

```ts
verifyImageFresh?: (args: {
  sandboxId: string; config: Record<string, unknown>;
  storedFingerprint: string; storedImageRef: string;
}) => Promise<{ fresh: boolean; reason?: string }>;
```

With:

```ts
verifyImageFresh?: (args: {
  sandboxId: string; config: Record<string, unknown>;
  storedFingerprint: string; storedImageRef: string;
  log?: (line: string) => void;
}) => Promise<{ fresh: boolean; reason?: string }>;
```

- [ ] **Step 5: Add `log?` to `checkRunnable` method and thread it through**

In `packages/sandbox/src/backends/docker/docker-backend.ts`, replace line 57:

```ts
async checkRunnable(worker: ResolvedSandbox): Promise<void> {
```

With:

```ts
async checkRunnable(worker: ResolvedSandbox, log?: (line: string) => void): Promise<void> {
```

Then replace lines 77-82 (the `verifyImageFresh` call):

```ts
      const v = await this.deps.verifyImageFresh({
        sandboxId: worker.id,
        config,
        storedFingerprint: worker.imageFingerprint ?? "",
        storedImageRef: worker.imageRef ?? "",
      });
```

With:

```ts
      const v = await this.deps.verifyImageFresh({
        sandboxId: worker.id,
        config,
        storedFingerprint: worker.imageFingerprint ?? "",
        storedImageRef: worker.imageRef ?? "",
        log,
      });
```

- [ ] **Step 6: Pass `args.log` in `ensure-workspace.ts`**

In `packages/orchestrator/src/sandbox/ensure-workspace.ts`, replace line 108:

```ts
  if (backend.checkRunnable) await backend.checkRunnable(resolved);
```

With:

```ts
  if (backend.checkRunnable) await backend.checkRunnable(resolved, log);
```

- [ ] **Step 7: Destructure and forward `log` in the `verifyImageFresh` closure in `cli-worker.ts`**

In `packages/orchestrator/src/cli-worker.ts`, the `verifyImageFresh` closure starts at line 143. Replace:

```ts
    verifyImageFresh: async ({ config, storedFingerprint, storedImageRef }) => {
```

With:

```ts
    verifyImageFresh: async ({ config, storedFingerprint, storedImageRef, log }) => {
```

Then replace the `resolveBuildInputs` call inside that closure (lines 148-152):

```ts
      const inputs = await resolveBuildInputs({
        image: (config as Record<string, unknown>)["image"] as never,
        client,
        bundleRef: bundle,
      });
```

With:

```ts
      const inputs = await resolveBuildInputs({
        image: (config as Record<string, unknown>)["image"] as never,
        client,
        bundleRef: bundle,
        log,
      });
```

- [ ] **Step 8: Run docker-backend tests — confirm all pass**

```bash
npm test -w packages/sandbox -- --reporter=verbose docker-backend
```

Expected: all existing tests + new test pass.

---

## Task 3 — Emit `ctx.log` in `clone-repos-step-handler` on error

**Files:**
- Modify: `packages/orchestrator/src/workers/steps/clone-repos-step-handler.ts:60-65`
- Create: `packages/orchestrator/src/workers/steps/clone-repos-step-handler.test.ts`

### Why

When `cloneRepos` returns an error (e.g. `"clone aborted"` from the abort-signal fix), the handler silently returns a failure result. The operator sees only `❌ step failed` with no indication that the clone was the problem. Adding `ctx.log()` makes the exact error visible in the log panel.

- [ ] **Step 1: Write the failing test**

Create `packages/orchestrator/src/workers/steps/clone-repos-step-handler.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { CloneReposStepHandler } from "./clone-repos-step-handler.ts";
import type { StepContext } from "@journeyman/core";

function makeCtx(): StepContext {
  return {
    workflowInstanceId: "wf", nodeId: "clone", attempt: 1,
    workspaceDir: "/workspace", signal: new AbortController().signal,
    env: {}, workflowInputs: {},
    log: vi.fn(),
  } as unknown as StepContext;
}

function makeHandler(cloneResult: Awaited<ReturnType<import("@journeyman/core").IGitProvider["cloneRepos"]>>) {
  return new CloneReposStepHandler({
    git: () => ({ cloneRepos: async () => cloneResult }) as any,
  });
}

describe("CloneReposStepHandler", () => {
  it("calls ctx.log with ⚠ prefix when clone returns an error", async () => {
    const ctx = makeCtx();
    const handler = makeHandler({
      repos: [{ folderName: "repo", repoDir: "/workspace/repo", url: "https://github.com/owner/repo", branch: "", error: "clone aborted" }],
      error: "clone aborted",
    });
    const result = await handler.run({ repos: ["https://github.com/owner/repo"] }, ctx);
    expect(result.kind).toBe("failure");
    expect(ctx.log).toHaveBeenCalledWith("⚠ clone failed: clone aborted");
  });

  it("does not emit an error log on success", async () => {
    const ctx = makeCtx();
    const handler = makeHandler({
      repos: [{ folderName: "repo", repoDir: "/workspace/repo", url: "https://github.com/owner/repo", branch: "" }],
    });
    await handler.run({ repos: ["https://github.com/owner/repo"] }, ctx);
    const warnCalls = (ctx.log as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c) => typeof c[0] === "string" && c[0].startsWith("⚠"),
    );
    expect(warnCalls).toHaveLength(0);
  });

  it("returns failure with CloneReposFailed errorClass", async () => {
    const ctx = makeCtx();
    const handler = makeHandler({
      repos: [],
      error: "authentication failed",
    });
    const result = await handler.run({ repos: ["https://github.com/owner/repo"] }, ctx);
    if (result.kind !== "failure") throw new Error("expected failure");
    expect(result.failure.errorClass).toBe("CloneReposFailed");
    expect(result.failure.retryable).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests — confirm they fail**

```bash
npm test -w packages/orchestrator -- --reporter=verbose clone-repos-step-handler
```

Expected: FAIL — `ctx.log` is not called with the `⚠` prefix.

- [ ] **Step 3: Add `ctx.log()` call in the failure branch**

In `packages/orchestrator/src/workers/steps/clone-repos-step-handler.ts`, replace lines 60-65:

```ts
    if (result?.error) {
      log.error({ result }, "clone-repos failed");
      return {
        kind: "failure",
        failure: { errorClass: "CloneReposFailed", message: String(result.error), retryable: true },
      };
    }
```

With:

```ts
    if (result?.error) {
      ctx.log(`⚠ clone failed: ${result.error}`);
      return {
        kind: "failure",
        failure: { errorClass: "CloneReposFailed", message: String(result.error), retryable: true },
      };
    }
```

Note: The `log` variable (pino logger) is still available in the file but no longer used at this call site. Leave it in place — it is used by other tooling/imports at the top of the file.

- [ ] **Step 4: Run tests — confirm all 3 pass**

```bash
npm test -w packages/orchestrator -- --reporter=verbose clone-repos-step-handler
```

Expected: 3 passed.

---

## Task 4 — Worker harness: `step.log` for TimeoutError and ImageNotReadyError

**Files:**
- Modify: `packages/orchestrator/src/workers/worker-harness.ts:462-478`
- Modify: `packages/orchestrator/src/workers/worker-harness.test.ts`

### Why

Two catch branches in `processOnce` never emit a `step.log` event:
1. `ImageNotReadyError` — calls `completeTask(FAILED)` but no visible log line precedes it.
2. `TimeoutError` — falls into the generic "unhandled" catch with no indication of why the step was killed.

- [ ] **Step 1: Write the failing tests**

Add to `packages/orchestrator/src/workers/worker-harness.test.ts`:

```ts
describe("WorkerHarness.processOnce — ImageNotReadyError step.log", () => {
  it("emits step.log before step.failed when ImageNotReadyError is thrown", async () => {
    const deps: any = makeDeps();
    deps.client.pollTask.mockResolvedValue(fakeTask());
    deps.registry.get.mockReturnValue({ run: vi.fn(), requiresWorkspace: true });
    const err = Object.assign(new Error("fingerprint changed"), { name: "ImageNotReadyError" });
    deps.ensureWorkspace.mockRejectedValue(err);

    const harness = new WorkerHarness(deps);
    await harness.processOnce("test-step");

    const calls = deps.events.append.mock.calls.map((c: any) => c[0].eventType);
    const logIdx = calls.indexOf("step.log");
    const failedIdx = calls.indexOf("step.failed");
    expect(logIdx).toBeGreaterThanOrEqual(0);
    expect(logIdx).toBeLessThan(failedIdx);
    const logLine = deps.events.append.mock.calls[logIdx][0].payload.line as string;
    expect(logLine).toContain("image not ready");
    expect(logLine).toContain("retrying");
  });
});

describe("WorkerHarness.processOnce — TimeoutError step.log", () => {
  beforeEach(() => { process.env.WORKER_DEFAULT_STEP_TIMEOUT_S = "1"; });
  afterEach(() => { delete process.env.WORKER_DEFAULT_STEP_TIMEOUT_S; });

  it("emits step.log with ⏱ prefix and step.failed with reason timeout", async () => {
    const deps: any = makeDeps();
    deps.client.pollTask.mockResolvedValue(fakeTask());
    deps.registry.get.mockReturnValue({
      run: (_input: any, ctx: any) => new Promise<never>((_, reject) => {
        ctx.signal.addEventListener("abort", () => reject(ctx.signal.reason), { once: true });
      }),
    });

    const harness = new WorkerHarness(deps);
    await harness.processOnce("test-step");

    const logCall = deps.events.append.mock.calls.find(
      (c: any) => c[0].eventType === "step.log" && String(c[0].payload?.line).includes("timed out"),
    );
    expect(logCall).toBeDefined();
    expect(logCall[0].payload.line).toContain("⏱");
    expect(logCall[0].payload.line).toContain("1s");

    expect(deps.client.completeTask).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "FAILED",
        reasonForIncompletion: expect.stringContaining("timeout"),
      }),
    );
  });
});
```

- [ ] **Step 2: Run tests — confirm they fail**

```bash
npm test -w packages/orchestrator -- --reporter=verbose worker-harness
```

Expected: 2 new failures — no `step.log` with "image not ready" or "⏱" is emitted yet.

- [ ] **Step 3: Add `step.log` before `ImageNotReadyError` completeTask**

In `packages/orchestrator/src/workers/worker-harness.ts`, inside the `catch` block, find the `ImageNotReadyError` branch. It currently starts with:

```ts
      if (err?.name === "ImageNotReadyError") {
        rlog.info({ message: err.message, durationMs }, "image not ready; failing fast for Conductor retry");
        await appendStepEvent(this.deps.events, ctx, "step.failed", {
```

Add a `step.log` emission after the `rlog.info` call and before `appendStepEvent`:

```ts
      if (err?.name === "ImageNotReadyError") {
        rlog.info({ message: err.message, durationMs }, "image not ready; failing fast for Conductor retry");
        await this.deps.events.append({
          workflowInstanceId, nodeId, eventType: "step.log",
          payload: { line: `⚠ image not ready: ${err.message}; retrying` },
        }).catch(() => {});
        await appendStepEvent(this.deps.events, ctx, "step.failed", {
          reason: "image_not_ready",
          error: serializeError(err),
          tail: tail.drain(),
          durationMs,
        });
        await this.deps.client.completeTask({
          workflowInstanceId: conductorWorkflowId, taskId: task.taskId,
          status: "FAILED",
          reasonForIncompletion: `image_not_ready: ${err.message}`,
        });
        return;
      }
```

- [ ] **Step 4: Add the `TimeoutError` catch branch**

In `packages/orchestrator/src/workers/worker-harness.ts`, inside the `catch` block, add a `TimeoutError` branch **immediately before** the `ConfigurationError` branch. The `ConfigurationError` branch currently begins:

```ts
      if (err?.name === "ConfigurationError" || err?.name === "SandboxNotFoundError") {
```

Insert the following block before it:

```ts
      if (err?.name === "TimeoutError") {
        rlog.warn({ durationMs, timeoutSeconds }, "step timed out");
        await this.deps.events.append({
          workflowInstanceId, nodeId, eventType: "step.log",
          payload: { line: `⏱ step timed out after ${timeoutSeconds}s` },
        }).catch(() => {});
        await appendStepEvent(this.deps.events, ctx, "step.failed", {
          reason: "timeout",
          error: serializeError(err),
          tail: tail.drain(),
          durationMs,
        });
        await this.deps.client.completeTask({
          workflowInstanceId: conductorWorkflowId, taskId: task.taskId,
          status: "FAILED",
          reasonForIncompletion: `timeout: step timed out after ${timeoutSeconds}s`,
        });
        return;
      }
```

`timeoutSeconds` and `workflowInstanceId`/`nodeId` are both in scope throughout `processOnce`.

- [ ] **Step 5: Run all orchestrator tests — confirm all pass**

```bash
npm test -w packages/orchestrator -- --reporter=verbose worker-harness
```

Expected: all existing tests + 2 new tests pass.

---

## Task 5 — Final typecheck

- [ ] **Step 1: Run the full type + boundary check**

```bash
npm run check
```

Expected: no new type errors. Pre-existing errors in `notification-provider/src/providers/email/` are unrelated and were present before this work — do not fix them here.

- [ ] **Step 2: Run all affected test suites**

```bash
npm test -w packages/run-viewer && npm test -w packages/sandbox -- --reporter=verbose docker-backend && npm test -w packages/orchestrator
```

Expected: all tests pass.

---

## Self-review

**Spec coverage:**
- Pull timeout log wired → Task 2 ✓
- Clone abort visible → Task 3 ✓
- Step timeout branch + log → Task 4 ✓
- ImageNotReadyError step.log → Task 4 ✓
- `step.failed` display fix → Task 1 ✓

**Placeholder scan:** No TBDs. All code blocks are complete and match the actual file content verified during planning.

**Type consistency:**
- `log?` param is `(line: string) => void` throughout Tasks 2–4 — consistent with `ensure-workspace.ts`'s existing `log` type and `worker-harness.ts`'s provisioning log callback.
- `reason: "timeout"` in Task 4 matches the string format used for `"image_not_ready"` and `"configuration_error"` in existing branches.
- `verifyImageFresh` args in `docker-backend.ts` and `cli-worker.ts` — Task 2 adds `log?` to both the type definition and the closure destructuring — consistent.
