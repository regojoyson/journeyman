# Provider Routing Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix `clone-repos` being wrongly categorised as `coding-cli` kind, and make unknown-provider factory errors fail terminally instead of retrying forever.

**Architecture:** Three targeted edits — one line in the core kind map, four factory default cases in cli-worker, and one new catch block in the worker harness.

**Tech Stack:** TypeScript, `@journeyman/core`, `@journeyman/orchestrator`.

---

## Files

| File | Change |
|---|---|
| `packages/core/src/registries/provider-catalog.ts` | Move `clone-repos` from `coding-cli` to `git-provider` in `PHASE_KIND_MAP` |
| `packages/orchestrator/src/cli-worker.ts` | 4 factory `default` cases → throw with `name: "ConfigurationError"` |
| `packages/orchestrator/src/workers/worker-harness.ts` | Add `ConfigurationError` catch before generic unhandled-error catch |

---

### Task 1: Fix `clone-repos` kind in PHASE_KIND_MAP

**Files:**
- Modify: `packages/core/src/registries/provider-catalog.ts:76`

- [ ] **Step 1: Move `clone-repos` to the `git-provider` section**

In `packages/core/src/registries/provider-catalog.ts`, the `PHASE_KIND_MAP` object currently has `"clone-repos": "coding-cli"` in the coding-cli section (line 76). Move it to the `git-provider` section.

Replace:
```typescript
export const PHASE_KIND_MAP: Record<string, ExecutorKind> = {
  // coding-cli
  "analyze-repo":         "coding-cli",
  "cleanup-workspace":    "coding-cli",
  "clone-repos":          "coding-cli",
  "commit-and-push":      "coding-cli",
  "create-workspace":     "coding-cli",
  "implement-changes":    "coding-cli",
  "list-workspace-files": "coding-cli",
  "plan-implementation":  "coding-cli",
  "start-feature-branch": "coding-cli",
  // git-provider
  "get-repository":             "git-provider",
  "list-pull-request-comments": "git-provider",
  "list-pull-requests":         "git-provider",
  "open-pull-request":          "git-provider",
```

With:
```typescript
export const PHASE_KIND_MAP: Record<string, ExecutorKind> = {
  // coding-cli
  "analyze-repo":         "coding-cli",
  "cleanup-workspace":    "coding-cli",
  "commit-and-push":      "coding-cli",
  "create-workspace":     "coding-cli",
  "implement-changes":    "coding-cli",
  "list-workspace-files": "coding-cli",
  "plan-implementation":  "coding-cli",
  "start-feature-branch": "coding-cli",
  // git-provider
  "clone-repos":                "git-provider",
  "get-repository":             "git-provider",
  "list-pull-request-comments": "git-provider",
  "list-pull-requests":         "git-provider",
  "open-pull-request":          "git-provider",
```

---

### Task 2: Make factory unknown-provider errors terminal

**Files:**
- Modify: `packages/orchestrator/src/cli-worker.ts:68-69,87-88,108-110,122-124`

All four factory `default` cases currently do `throw new Error(...)`. Change each to throw an error with `name: "ConfigurationError"` so the harness can detect it as terminal.

- [ ] **Step 1: Fix the `coding` factory default**

Replace:
```typescript
const coding: ProviderFactory<ICodingCLI> = (key, env) => {
  switch (key ?? "claude") {
    case "claude":
      return new ClaudeProvider({ apiKey: env.ANTHROPIC_API_KEY });
    default:
      throw new Error(`Unknown coding provider: ${key}`);
  }
};
```

With:
```typescript
const coding: ProviderFactory<ICodingCLI> = (key, env) => {
  switch (key ?? "claude") {
    case "claude":
      return new ClaudeProvider({ apiKey: env.ANTHROPIC_API_KEY });
    default: {
      const err = new Error(`Unknown coding provider: ${key}`) as Error & { name: string };
      err.name = "ConfigurationError";
      throw err;
    }
  }
};
```

- [ ] **Step 2: Fix the `git` factory default**

Replace:
```typescript
const git: ProviderFactory<IGitProvider> = (key, env) => {
  switch (key ?? "github") {
    case "github":
      return new GitHubProvider({ token: env.GITHUB_ACCESS_TOKEN });
    default:
      throw new Error(`Unknown git provider: ${key}`);
  }
};
```

With:
```typescript
const git: ProviderFactory<IGitProvider> = (key, env) => {
  switch (key ?? "github") {
    case "github":
      return new GitHubProvider({ token: env.GITHUB_ACCESS_TOKEN });
    default: {
      const err = new Error(`Unknown git provider: ${key}`) as Error & { name: string };
      err.name = "ConfigurationError";
      throw err;
    }
  }
};
```

- [ ] **Step 3: Fix the `issue` factory default**

Replace:
```typescript
    default:
      throw new Error(`Unknown issue provider: ${key}`);
```

With:
```typescript
    default: {
      const err = new Error(`Unknown issue provider: ${key}`) as Error & { name: string };
      err.name = "ConfigurationError";
      throw err;
    }
```

- [ ] **Step 4: Fix the `notification` factory default**

Replace:
```typescript
    default:
      throw new Error(`Unknown notification provider: ${key}`);
```

With:
```typescript
    default: {
      const err = new Error(`Unknown notification provider: ${key}`) as Error & { name: string };
      err.name = "ConfigurationError";
      throw err;
    }
```

---

### Task 3: Catch `ConfigurationError` as terminal in the harness

**Files:**
- Modify: `packages/orchestrator/src/workers/worker-harness.ts:181-191`

The generic `catch (err: any)` block at the end of `processOnce` currently marks all unhandled errors as `FAILED` (retryable). Add a `ConfigurationError` check before the generic fallthrough.

- [ ] **Step 1: Add `ConfigurationError` handler**

Replace the entire `catch` block (lines 181–191):
```typescript
    } catch (err: any) {
      log.error({ runId, nodeId, err }, "phase threw unhandled error");
      await this.deps.events.append({
        runId, nodeId, eventType: "phase.failed",
        payload: { error: { errorClass: "UnhandledError", message: String(err?.message ?? err) } },
      });
      await this.deps.client.completeTask({
        workflowInstanceId: runId, taskId: task.taskId,
        status: "FAILED",
        reasonForIncompletion: String(err?.message ?? err),
      });
    }
```

With:
```typescript
    } catch (err: any) {
      if (err?.name === "ConfigurationError") {
        log.error({ runId, nodeId, message: err.message }, "phase failed: configuration error");
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
      log.error({ runId, nodeId, err }, "phase threw unhandled error");
      await this.deps.events.append({
        runId, nodeId, eventType: "phase.failed",
        payload: { error: { errorClass: "UnhandledError", message: String(err?.message ?? err) } },
      });
      await this.deps.client.completeTask({
        workflowInstanceId: runId, taskId: task.taskId,
        status: "FAILED",
        reasonForIncompletion: String(err?.message ?? err),
      });
    }
```

---

### Task 4: Typecheck

- [ ] **Step 1: Run typecheck across all workspace packages**

```bash
npm run typecheck
```

Expected: zero errors across all packages.
