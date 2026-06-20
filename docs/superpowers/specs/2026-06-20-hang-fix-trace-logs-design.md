# Hang-Fix Trace Logs Design

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the four hang-fix scenarios (pull timeout, clone abort, step timeout, ImageNotReadyError) visible as log lines in the workflow instance log panel, and improve the `step.failed` display to show reason and error message inline.

**Architecture:** Five targeted changes across four packages. No new abstractions — wired callbacks, explicit `events.append` calls, and a display formatter fix. All new log lines flow through the existing `step.log` event path that already reaches the UI.

**Tech Stack:** TypeScript, Fastify, Vitest, React, existing `IEventBus.append` / `step.log` event pipeline.

---

## Background

The four bugs fixed in `fix(sandbox/agent-runtime/orchestrator): hang fixes` each produce silent failures in the UI:

| Scenario | Root cause of silence |
|---|---|
| Pull timeout | `resolveBuildInputs.log` arg is never passed — falls back to no-op |
| Clone aborted | `clone-repos-step-handler` never calls `ctx.log()` on error |
| Step timeout | `TimeoutError` hits the generic "unhandled" catch; `step.failed` shows no reason |
| ImageNotReadyError | `step.failed` emitted but no `step.log` precedes it; reason buried in metadata |

Additionally, `parse-logs.ts` formats every `step.failed` as `"❌ step failed"` regardless of `reason` or `error.message`, so all structured failure context is invisible in the log panel.

---

## File Map

| File | Change |
|---|---|
| `packages/core/src/types/execution-environment.types.ts` | Add `log?` param to `checkRunnable` interface signature |
| `packages/sandbox/src/backends/docker/docker-backend.ts` | Add `log?` to `verifyImageFresh` args type; add `log?` to `checkRunnable` method; thread log through to `verifyImageFresh` |
| `packages/orchestrator/src/sandbox/ensure-workspace.ts` | Pass `args.log` when calling `backend.checkRunnable` |
| `packages/orchestrator/src/cli-worker.ts` | Destructure `log` in `verifyImageFresh` closure; pass it to `resolveBuildInputs` |
| `packages/orchestrator/src/workers/steps/clone-repos-step-handler.ts` | Call `ctx.log()` when clone returns an error |
| `packages/orchestrator/src/workers/worker-harness.ts` | Add `TimeoutError` catch branch + `step.log`; add `step.log` in `ImageNotReadyError` branch |
| `packages/run-viewer/src/logs/parse-logs.ts` | Show `reason` + `error.message` inline in `step.failed` formatted line |

---

## Design

### Touch-point 1 — Pull timeout warning wired to UI

**Problem:** `verifyImageFresh` (defined in `cli-worker.ts`) calls `resolveBuildInputs` with no `log` arg. The timeout warning (`"warning: could not pull '...' (pull timed out after 60s); using local copy"`) is silently swallowed.

**Fix:** Thread a `log` callback from `ensureWorkspace` down to `resolveBuildInputs` via the `checkRunnable` method.

Four-file chain:

1. **`core/src/types/execution-environment.types.ts`** — `checkRunnable?(worker: ResolvedSandbox): void | Promise<void>` gets an optional second param: `log?: (line: string) => void`.

2. **`ensure-workspace.ts`** — `backend.checkRunnable(resolved)` becomes `backend.checkRunnable(resolved, args.log)`. Optional, so all other callers (tests, other backends) are unaffected.

3. **`docker-backend.ts`** — `DockerBackendDeps.verifyImageFresh` args type gets `log?` added. `checkRunnable` method signature adds `log?` and passes it through to `this.deps.verifyImageFresh({ ..., log })`.

4. **`cli-worker.ts`** — the `verifyImageFresh` closure destructures `log` from its args and passes it to `resolveBuildInputs({ ..., log })`.

The existing warning line in `resolveBuildInputs` (`log(\`warning: could not pull ...\`)`) then travels through the provisioning log callback that `worker-harness.ts` already wires to `step.log` events.

No change to `resolveBuildInputs.ts` itself — the warning already exists.

---

### Touch-point 2 — Clone abort visible in log panel

**Problem:** `clone-repos-step-handler.ts` logs clone errors to pino (`log.error(...)`) but never calls `ctx.log()`, so nothing appears in the UI log stream.

**Fix:** Add a single `ctx.log()` call before returning the failure result:

```ts
if (result?.error) {
  ctx.log(`⚠ clone failed: ${result.error}`);
  return {
    kind: "failure",
    failure: { errorClass: "CloneReposFailed", message: String(result.error), retryable: true },
  };
}
```

When the clone is aborted by the step timeout signal, `result.error` is `"clone aborted"`, producing:
> `⚠ clone failed: clone aborted`

For other clone errors (network, auth) the actual error message is shown verbatim, which also improves debuggability beyond the hang-fix scenarios.

---

### Touch-point 3 — Step timeout catch branch

**Problem:** `DOMException("Step timed out", "TimeoutError")` falls into the generic "unhandled" catch in `worker-harness.ts`, which emits `step.failed` with `reason: "unhandled"` and no human-readable context. The operator cannot tell from the log panel that a timeout occurred.

**Fix:** Add a dedicated `TimeoutError` branch before the generic handler, emitting a `step.log` event and a structured `step.failed`:

```ts
if (err?.name === "TimeoutError") {
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

`timeoutSeconds` is already in scope in `processOnce`, so the message is concrete (e.g. `⏱ step timed out after 1800s`).

---

### Touch-point 4 — ImageNotReadyError log line

**Problem:** The `ImageNotReadyError` catch branch calls `completeTask(FAILED)` but emits no `step.log` event. The `step.failed` event follows, but its reason is buried in metadata — the log panel shows only `❌ step failed`.

**Fix:** Emit a `step.log` event before `appendStepEvent`:

```ts
if (err?.name === "ImageNotReadyError") {
  await this.deps.events.append({
    workflowInstanceId, nodeId, eventType: "step.log",
    payload: { line: `⚠ image not ready: ${err.message}; retrying` },
  }).catch(() => {});
  // existing appendStepEvent + completeTask calls unchanged
}
```

This produces a visible log line immediately before the step-failed event, making the retry sequence legible in the log panel:
> `⚠ image not ready: image fingerprint changed; retrying`
> `❌ step failed: image_not_ready — image fingerprint changed`

---

### Touch-point 5 — parse-logs.ts `step.failed` display

**Problem:** `parse-logs.ts` formats every `step.failed` as `"❌ step failed"` regardless of `reason` or error payload, so all structured failure context is invisible.

**Fix:** Update the `step.failed` case to extract and display `reason` and `error.message`:

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

Result examples:
- `"❌ step failed: timeout — Step timed out"` (step timeout)
- `"❌ step failed: image_not_ready — image fingerprint changed"` (image not ready)
- `"❌ step failed: configuration_error — sandbox not found"` (config error)
- `"❌ step failed: handler_error — <message>"` (step handler returned failure)
- `"❌ step failed"` (legacy events with no structured payload — backward compatible)

This benefits all future error reasons, not just the four from the hang fixes.

---

## Log Lines Summary

After implementation, an operator watching the workflow log panel will see:

| Scenario | Log line(s) |
|---|---|
| Pull timeout | `warning: could not pull 'node:20' (pull timed out after 60s); using local copy` |
| Clone aborted | `⚠ clone failed: clone aborted` |
| Step timeout | `⏱ step timed out after 1800s` → `❌ step failed: timeout — Step timed out` |
| ImageNotReadyError | `⚠ image not ready: <message>; retrying` → `❌ step failed: image_not_ready — <message>` |

---

## Testing

- **Touch-point 1 (pull timeout log):** Unit test in `ensure-workspace.test.ts` or `cli-worker` tests — verify `checkRunnable` forwards the log callback; verify the warning line reaches the event appender when `pullTimeoutMs` is small. (Can use the existing never-resolving pull mock.)
- **Touch-point 2 (clone abort):** Unit test in `clone-repos-step-handler.test.ts` — mock exec returning `{ ok: false, error: "clone aborted" }`, assert `ctx.log` was called with the expected string.
- **Touch-point 3 (timeout branch):** Unit test in `worker-harness.test.ts` — handler throws a `DOMException("Step timed out", "TimeoutError")`, assert `step.log` with `⏱` prefix and `step.failed` with `reason: "timeout"` are emitted.
- **Touch-point 4 (ImageNotReadyError log):** Extend existing `ImageNotReadyError` test — assert a `step.log` event is emitted before `step.failed`.
- **Touch-point 5 (parse-logs):** Unit test in `parse-logs.test.ts` (or inline vitest) — assert the formatter produces the expected string for each reason variant, and that a bare `step.failed` with no payload still produces `"❌ step failed"`.
