# Server Code-Level Logging — Design Spec

**Date:** 2026-04-19
**Status:** Approved

## Problem

Server-side code across the monorepo has no leveled logger. There are 34 scattered `console.log` / `console.error` / `console.warn` calls spread across 21 files in `pipeline-server`, `pipeline`, `coding-cli`, `ticket-provider`, and `git-provider`. This makes it impossible to:

- Silence verbose output in production
- Turn on verbose output in development without code edits
- Distinguish informational messages from warnings and errors at the shell/log-aggregator level
- Attach structured context (session IDs, repo names, errors) to log lines

This spec is **orthogonal** to the terminal-logging spec (`2026-04-19-terminal-logging-design.md`), which handles pipeline step lifecycle via `EventBus`. That spec logs per-run trace events. This spec covers application/server code logs (HTTP layer, dispatch, SDK internals, CLI commands).

## Goal

Replace ad-hoc `console.*` calls across server/provider code with a leveled, namespaced logger backed by [`pino`](https://github.com/pinojs/pino). Human-readable output in dev, structured JSON in production. No per-file config — level controlled by one env var.

## Approach

A single root pino logger lives in `@journeyman/core`. A `createLogger(namespace)` factory returns a namespaced child logger. Every package imports `createLogger` from core and creates one logger per file.

## Changes

### 1. New file: `packages/core/src/logger.ts`

```typescript
import pino from "pino";

const level = process.env.LOG_LEVEL ?? "info";
const isDev = process.env.NODE_ENV !== "production";

const root = pino({
  level,
  transport: isDev
    ? { target: "pino-pretty", options: { colorize: true, translateTime: "HH:MM:ss.l" } }
    : undefined,
});

export type Logger = pino.Logger;

export function createLogger(namespace: string): Logger {
  return root.child({ ns: namespace });
}
```

### 2. Export from core

**File:** `packages/core/src/index.ts`

Add:
```typescript
export { createLogger, type Logger } from "./logger.js";
```

### 3. Root `package.json` dependencies

Add to root `package.json`:
- `pino` — runtime dependency
- `pino-pretty` — dev dependency

### 4. Replace `console.*` call sites

One `createLogger(...)` per file at the top, then mechanical replacement:

| Old | New |
|---|---|
| `console.log(msg)` | `log.info(msg)` |
| `console.log(msg, obj)` | `log.info(obj, msg)` (pino convention: context first, message second) |
| `console.warn(...)` | `log.warn(...)` |
| `console.error(msg, err)` | `log.error({ err }, msg)` |
| `console.debug(...)` | `log.debug(...)` |

**Namespace convention:** one per file, lowercase, colon-separated for subsystems.

Files to update (34 call sites, 21 files):

| File | Namespace |
|---|---|
| `packages/pipeline-server/src/main.ts` | `server:main` |
| `packages/pipeline-server/src/cli-start.ts` | `server:cli` |
| `packages/pipeline-server/src/dispatch.ts` | `server:dispatch` |
| `packages/pipeline/src/cli.ts` | `pipeline:cli` |
| `packages/pipeline/src/shutdown.ts` | `pipeline:shutdown` |
| `packages/pipeline/src/cli-commands/run-once.ts` | `pipeline:run-once` |
| `packages/pipeline/src/cli-commands/sweep.ts` | `pipeline:sweep` |
| `packages/pipeline/src/cli-commands/validate-config.ts` | `pipeline:validate-config` |
| `packages/coding-cli/src/providers/claude/utils/sdk-logger.ts` | `claude:sdk` |
| `packages/coding-cli/src/providers/claude/operations/scan-repos.ts` | `claude:scan-repos` |
| `packages/coding-cli/src/providers/claude/operations/checkout-repo.ts` | `claude:checkout-repo` |
| `packages/coding-cli/src/providers/claude/operations/commit-push-repos.ts` | `claude:commit-push` |
| `packages/coding-cli/src/providers/claude/operations/cleanup-repos.ts` | `claude:cleanup-repos` |
| `packages/coding-cli/src/providers/claude/operations/create-workspace.ts` | `claude:create-workspace` |
| `packages/coding-cli/src/providers/claude/operations/analyze.ts` | `claude:analyze` |
| `packages/coding-cli/src/providers/claude/operations/plan.ts` | `claude:plan` |
| `packages/coding-cli/src/providers/claude/operations/implement.ts` | `claude:implement` |
| `packages/ticket-provider/src/providers/jira/utils/sdk-logger.ts` | `jira:sdk` |

Test files (`*.test.ts`) and the postman collection JSON are excluded — leave their `console.*` untouched.

## Levels & usage

| Level | Use for |
|---|---|
| `debug` | Verbose trace: request bodies, SDK messages, internal state transitions |
| `info` | Normal lifecycle: server start, request received, job dispatched, operation complete |
| `warn` | Recoverable anomalies: retry, fallback, deprecated config used |
| `error` | Failures bubbling up or caught exceptions |

## Configuration

- **`LOG_LEVEL`** — defaults to `info`. Set to `debug` for verbose output.
- **`NODE_ENV`** — when `!== "production"`, output is routed through `pino-pretty` (colorized, human-readable). In production, pino emits raw newline-delimited JSON to stdout.

No config file. No per-namespace level overrides. No runtime level changes.

## Relationship to Terminal Logging Spec

The existing `2026-04-19-terminal-logging-design.md` covers pipeline **step lifecycle** events via `EventBus`, producing the `[run]` / `[step]` / `[log]` formatted output for a running pipeline.

This spec covers **application code logs** — server startup, HTTP layer, SDK wrappers, CLI commands. These run outside per-run contexts (or alongside them) and need a leveled logger, not a trace stream.

They coexist. No shared code. No overlap.

## Out of Scope

- Shipping logs to external aggregators (Datadog, Loki, CloudWatch)
- Correlation IDs / request IDs binding (can add `log.child({ reqId })` later if needed)
- Changing the pipeline `EventBus` or `FileTraceLogger`
- Log rotation to disk files
- Per-namespace level overrides
- Tests
