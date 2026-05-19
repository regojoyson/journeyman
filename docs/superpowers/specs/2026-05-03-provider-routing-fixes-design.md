# Provider Routing Fixes Design

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix two related bugs in how the orchestrator routes provider values to phase handlers: a wrong kind mapping for `clone-repos`, and factory errors being retried instead of failing terminally.

**Architecture:** Two targeted changes — one in `@journeyman/core` (kind map) and two in `@journeyman/orchestrator` (factory error shape, harness catch).

**Tech Stack:** TypeScript, existing `@journeyman/core` and `@journeyman/orchestrator` packages.

---

## Background

Every phase handler reads `input.provider` (injected by the flow engine) and passes it to a factory function (`coding`, `git`, `issue`, or `notification`). The factory switch-cases on the value and returns the right concrete provider.

Two bugs exist:

### Bug 1 — `clone-repos` in wrong kind bucket

`PHASE_KIND_MAP` in `provider-catalog.ts` maps `clone-repos → "coding-cli"`. This means flow defaults for `coding-cli` (e.g. `provider: "claude"`) are injected into `clone-repos` task inputs. But `CloneReposPhaseHandler` uses the `git` factory, which throws on `"claude"`.

**Rule confirmed by product:** `coding-cli` = phases with LLM calls. `git-provider` = phases calling git hosting APIs. `clone-repos` calls the GitHub REST API — it belongs in `git-provider`.

**Fix:** Move `"clone-repos": "coding-cli"` → `"clone-repos": "git-provider"` in `PHASE_KIND_MAP`.

### Bug 2 — Unknown provider errors are retried forever

When a factory receives an unknown key (e.g. `git("claude", env)` or `coding("bitbucket", env)`), it throws a plain `Error`. The `WorkerHarness` catches unhandled errors in a generic `catch` block and marks the task `FAILED` (retryable). Conductor then retries it — indefinitely — even though no number of retries will fix a configuration error.

**Fix:** Factory `default` cases should throw an error that the harness recognises as terminal. Pattern mirrors `MissingSecretsError`: set `err.name = "ConfigurationError"` on the thrown error. The harness adds a catch block that detects this name and marks `FAILED_WITH_TERMINAL_ERROR`.

---

## Changes

### 1. `packages/core/src/registries/provider-catalog.ts`

Move `clone-repos` from the `coding-cli` section to the `git-provider` section:

```typescript
// Before
"clone-repos": "coding-cli",

// After (under git-provider section)
"clone-repos": "git-provider",
```

### 2. `packages/orchestrator/src/cli-worker.ts`

Change every factory `default` case from a plain `new Error(...)` to a `ConfigurationError`-shaped throw:

```typescript
// coding factory
default: {
  const err = new Error(`Unknown coding provider: ${key}`) as Error & { name: string };
  err.name = "ConfigurationError";
  throw err;
}

// git factory
default: {
  const err = new Error(`Unknown git provider: ${key}`) as Error & { name: string };
  err.name = "ConfigurationError";
  throw err;
}

// issue factory
default: {
  const err = new Error(`Unknown issue provider: ${key}`) as Error & { name: string };
  err.name = "ConfigurationError";
  throw err;
}

// notification factory
default: {
  const err = new Error(`Unknown notification provider: ${key}`) as Error & { name: string };
  err.name = "ConfigurationError";
  throw err;
}
```

### 3. `packages/orchestrator/src/workers/worker-harness.ts`

In `processOnce`, add a `ConfigurationError` check inside the final `catch (err: any)` block, before the generic fallthrough:

```typescript
} catch (err: any) {
  if (err?.name === "ConfigurationError") {
    log.error({ runId, nodeId, err: err.message }, "phase failed: configuration error");
    await this.deps.events.append({
      runId, nodeId, eventType: "phase.failed",
      payload: { reason: "configuration_error", message: String(err?.message ?? "") },
    });
    await this.deps.client.completeTask({
      workflowInstanceId: runId, taskId: task.taskId,
      status: "FAILED_WITH_TERMINAL_ERROR",
      reasonForIncompletion: `configuration_error: ${err.message}`,
    });
    return;
  }
  // existing generic handler below...
  log.error({ runId, nodeId, err }, "phase threw unhandled error");
  ...
}
```

---

## Scope

- No new interfaces, no new packages, no new files.
- No unit tests (per project convention for this work).
- Final step: `npm run typecheck` across workspace.

## Files Modified

| File | Change |
|---|---|
| `packages/core/src/registries/provider-catalog.ts` | Move `clone-repos` to `git-provider` in `PHASE_KIND_MAP` |
| `packages/orchestrator/src/cli-worker.ts` | 4 factory `default` cases → throw `ConfigurationError` |
| `packages/orchestrator/src/workers/worker-harness.ts` | Add `ConfigurationError` catch before generic unhandled-error catch |
