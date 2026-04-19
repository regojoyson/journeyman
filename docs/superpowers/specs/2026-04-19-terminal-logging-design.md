# Terminal Logging — Design Spec

**Date:** 2026-04-19
**Status:** Approved

## Problem

Running `npm start` produces no visible output during pipeline execution. There is no way to trace which step is running, what it is doing, or where it failed without polling the REST API.

## Goal

Print step lifecycle events and key phase trace lines to stdout as the pipeline runs, so the full flow is traceable in the terminal.

## Approach

Wire a console subscriber onto the existing `EventBus`. No new abstractions, no third-party logging library.

Two event types drive the output:

- **Lifecycle events** (`runStarted`, `stepStarted`, `stepEnded`, `statusChanged`, `runEnded`) — already emitted by `Pipeline`; just need a subscriber that prints them.
- **`logLine` events** — already defined in the `PipelineEvent` union but never emitted. `FileTraceLogger.log()` will emit them after writing to disk.

## Output Format

```
[run]  sam-portfolio · regojoyson/sam-portfolio#1 · started
[step] → fetch-ticket
  [log]  info  fetching ticket regojoyson/sam-portfolio#1
  [log]  info  title: "Add dark mode" · status: Todo
[step] ✓ fetch-ticket (312ms)
[step] → clone
  [log]  info  cloning regojoyson/sam-portfolio → ./workspaces/sam-portfolio
  [log]  info  clone complete (1 repo, 8.1s)
[step] ✓ clone (8432ms)
[step] → mark-in-progress
[step] ✓ mark-in-progress (skipped)
[step] → checkout
  [log]  info  checking out branch: ticket/1-add-dark-mode
[step] ✓ checkout (2341ms)
[step] → analyze
  [log]  info  analyzing codebase …
[step] ✓ analyze (42100ms)
[step] → commit-push
  [log]  info  commit: "#1 : Add dark mode"
  [log]  info  pushed branch ticket/1-add-dark-mode
[step] ✓ commit-push (3200ms)
[step] → open-pr
  [log]  info  PR opened: https://github.com/regojoyson/sam-portfolio/pull/7
[step] ✓ open-pr (1100ms)
[run]  sam-portfolio · completed in 58.4s
```

On failure:
```
[step] → checkout
  [log]  error  failed to push: remote rejected (no write access)
[step] ✗ checkout — remote rejected (no write access)
[run]  sam-portfolio · failed in 11.2s
```

Rules:
- `logLine` events with `level: "debug"` are **not** printed to terminal (file-only).
- `logLine` events with `level: "info"`, `"warn"`, or `"error"` are printed indented under the current step.
- All output goes to `stdout`; nothing changes about `stderr`.

## Changes

### 1. `FileTraceLogger` — emit `logLine` to EventBus

**File:** `packages/pipeline/src/state/file-trace-logger.ts`

Add an optional `eventBus` parameter to the constructor. After writing a line to disk, publish a `logLine` event:

```typescript
constructor(
  rootDir: string,
  resolveProductId: ProductIdResolver,
  private readonly eventBus?: EventBus,
) {}

async log(sessionId: string, line: TraceLine): Promise<void> {
  // existing disk write …
  this.eventBus?.publish(sessionId, {
    type: "logLine",
    sessionId,
    stepId: line.stepId,
    level: line.level,
    message: line.message,
    ts: line.ts,
  });
}
```

### 2. `main.ts` — pass EventBus + add console subscriber

**File:** `packages/pipeline-server/src/main.ts`

Pass `eventBus` when constructing `FileTraceLogger`:
```typescript
const trace = new FileTraceLogger(workspacesRoot, resolveProductId, eventBus);
```

Add a console subscriber after registries are built:
```typescript
subscribeConsoleLogger(eventBus);
```

### 3. New file: `packages/pipeline-server/src/console-logger.ts`

Contains `subscribeConsoleLogger(eventBus: EventBus): void`.

Subscribes to `"*"` (all sessions) on the EventBus and handles:

| Event | Output |
|---|---|
| `runStarted` | `[run]  <productId> · <ticketKey> · started` |
| `stepStarted` | `[step] → <stepId>` |
| `stepEnded` (completed/skipped) | `[step] ✓ <stepId> (<duration>ms)` |
| `stepEnded` (failed) | `[step] ✗ <stepId> — <error>` |
| `statusChanged` | `[status] <previous> → <new>` |
| `runEnded` | `[run]  <productId> · <status> in <duration>s` |
| `logLine` (level ≠ debug) | `  [log]  <level>  <message>` |

### 4. Phase trace calls

Add minimal `ctx.trace.log()` calls to the following phases. Only key milestones — not exhaustive.

| Phase file | Logs added |
|---|---|
| `get-ticket-phase.ts` | ticket title + current status after fetch |
| `clone-repos-phase.ts` | repo names being cloned; clone complete + count |
| `checkout-repo-phase.ts` | branch name being checked out |
| `commit-push-phase.ts` | commit message; pushed branch name |
| `create-pr-phase.ts` | PR URL after creation |
| `update-status-phase.ts` | semantic status → actual label |
| `cleanup-repos-phase.ts` | cleanup result (success/skipped) |

## EventBus API Compatibility

`EventBus.publish(e: PipelineEvent)` routes by `e.sessionId` and `subscribe(sessionId, listener)` requires a specific session ID. There is no global/wildcard listener.

**Fix:** Add a `subscribeAll(listener)` method to `EventBus` that receives every event regardless of `sessionId`. `publish()` will notify global listeners after per-session ones:

```typescript
private globalListeners = new Set<Listener>();

subscribeAll(listener: Listener): () => void {
  this.globalListeners.add(listener);
  return () => { this.globalListeners.delete(listener); };
}

publish(e: PipelineEvent): void {
  // existing per-session routing …
  for (const l of this.globalListeners) l(e);
  // existing buffer logic …
}
```

`subscribeConsoleLogger` calls `eventBus.subscribeAll(...)` once at startup.

## Out of Scope

- Pino / structured JSON logging for the server itself
- Log level configuration via pipeline.yaml
- `logLine` events in the SSE stream (separate concern)
- Debug-level terminal output
