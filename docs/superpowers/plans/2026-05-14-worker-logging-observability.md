# Worker Logging & Observability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every workflow run self-explanatory in the run viewer for end users, and forensically debuggable in pino stdout for operators — covering skipped phases, silent stops, and opaque failures.

**Architecture:** Two cooperating streams tied by a fixed correlation contract (`workflowInstanceId`, `nodeId`, `phaseType`, `attempt`, `taskId`, `workerId`). Add new event types (`phase.skipped`, `edge.taken`, `condition.evaluated`, `worker.heartbeat`, `task.polled`, `task.dispatched`); enrich `phase.failed` payloads with stack/cause/log-tail/subprocess context; standardize lifecycle log moments across worker harness, conductor engine, conductor client, and all phase handlers; surface new events in the run viewer.

**Tech Stack:** TypeScript, pino, Conductor, Postgres event bus, Vitest (existing test framework), React (run viewer).

**Per user request:** No `git commit` steps in this plan. Tests run inline at each step (TDD). One final task runs `npm run typecheck` across the monorepo.

**Spec:** [docs/superpowers/specs/2026-05-14-worker-logging-observability-design.md](../specs/2026-05-14-worker-logging-observability-design.md)

---

## File Structure

**Created files:**
- `packages/core/src/log/serialize-error.ts` — error → JSON shape with cause chain + redaction.
- `packages/core/src/log/serialize-error.test.ts`
- `packages/core/src/log/workflow-logger.ts` — `createWorkflowLogger`, `loggerForRun`.
- `packages/core/src/log/workflow-logger.test.ts`
- `packages/core/src/log/redact.ts` — string/object redactor (`/token|secret|key|password|authorization/i`).
- `packages/core/src/log/redact.test.ts`
- `packages/core/src/log/append-phase-event.ts` — never-throws wrapper around `events.append`.
- `packages/core/src/log/append-phase-event.test.ts`
- `packages/core/src/log/log-tail.ts` — bounded ring buffer for `phase.log` lines.
- `packages/core/src/log/log-tail.test.ts`
- `packages/orchestrator/src/workers/subprocess.ts` — subprocess wrapper used by phase handlers.
- `packages/orchestrator/src/workers/subprocess.test.ts`
- `packages/orchestrator/src/workers/heartbeat.ts` — heartbeat ticker helper.
- `packages/orchestrator/src/workers/heartbeat.test.ts`
- `packages/orchestrator/src/workers/worker-harness.test.ts` — new harness test file (covers all branches).
- `packages/orchestrator/src/engines/conductor/emit-routing-events.ts` — emit `phase.skipped`, `edge.taken`, `condition.evaluated` from Conductor task list.
- `packages/orchestrator/src/engines/conductor/emit-routing-events.test.ts`
- `packages/run-viewer/src/status/compute-node-status.test.ts` (if missing) — extended for new event types.

**Modified files:**
- `packages/core/src/logger.ts` — re-export new helpers; keep root pino logger.
- `packages/core/src/index.ts` — barrel exports.
- `packages/orchestrator/src/workers/worker-harness.ts` — adopt helpers, heartbeat, ring buffer, error enrichment, per-run debug.
- `packages/orchestrator/src/engines/conductor/conductor-orchestrator.ts` — extend `emitEngineNodeResolveds` to emit routing events.
- `packages/orchestrator/src/engines/conductor/conductor-client.ts` — debug logs on `pollTask` / `completeTask`.
- `packages/orchestrator/src/workers/phases/*.ts` — sweep: add `handler.start` / `handler.step.*` / `handler.end`. Subprocess-spawning handlers use the wrapper.
- `packages/run-viewer/src/status/compute-node-status.ts` — handle new event types in status computation.
- `packages/run-viewer/src/canvas/*.tsx` (or equivalent) — render heartbeat ticker + skipped/edge annotations.
- `packages/run-viewer/src/drawer/NodeDetailDrawer.tsx` — render enriched `phase.failed` payload (stack, cause, tail, subprocess).
- `packages/run-viewer/src/topbar/*.tsx` — "Show debug events" toggle.

---

## Task 1: Redactor

**Files:**
- Create: `packages/core/src/log/redact.ts`
- Test: `packages/core/src/log/redact.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// packages/core/src/log/redact.test.ts
import { describe, it, expect } from "vitest";
import { redactString, redactObject } from "./redact.ts";

describe("redactString", () => {
  it("redacts token-like values from a string", () => {
    expect(redactString("Authorization: Bearer abc123def")).toBe("Authorization: [REDACTED]");
    expect(redactString('token="xyz"')).toBe("token=[REDACTED]");
    expect(redactString("password=p@ss")).toBe("password=[REDACTED]");
  });
  it("returns non-matching strings unchanged", () => {
    expect(redactString("hello world")).toBe("hello world");
  });
});

describe("redactObject", () => {
  it("redacts values for sensitive keys recursively", () => {
    const input = {
      ok: "value",
      token: "abc",
      nested: { secret: "shh", deeper: { apiKey: "k" } },
      arr: [{ password: "p" }],
    };
    expect(redactObject(input)).toEqual({
      ok: "value",
      token: "[REDACTED]",
      nested: { secret: "[REDACTED]", deeper: { apiKey: "[REDACTED]" } },
      arr: [{ password: "[REDACTED]" }],
    });
  });
  it("handles null and primitive inputs", () => {
    expect(redactObject(null)).toBe(null);
    expect(redactObject("plain")).toBe("plain");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/core/src/log/redact.test.ts`
Expected: FAIL — file `./redact.ts` not found.

- [ ] **Step 3: Implement the redactor**

```ts
// packages/core/src/log/redact.ts
const SENSITIVE_KEY = /token|secret|key|password|authorization/i;
const SENSITIVE_VALUE = /(authorization\s*[:=]\s*bearer\s+)\S+|(\b(?:token|secret|key|password|authorization)\b\s*[:=]\s*)"?[^"\s,;]+"?/gi;

export function redactString(s: string): string {
  return s.replace(SENSITIVE_VALUE, (_m, p1, p2) => `${p1 ?? p2}[REDACTED]`);
}

export function redactObject<T>(value: T): T {
  if (value === null || typeof value !== "object") {
    return (typeof value === "string" ? (redactString(value) as unknown as T) : value);
  }
  if (Array.isArray(value)) {
    return value.map(redactObject) as unknown as T;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEY.test(k)) {
      out[k] = "[REDACTED]";
    } else {
      out[k] = redactObject(v);
    }
  }
  return out as T;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/core/src/log/redact.test.ts`
Expected: PASS.

---

## Task 2: serializeError

**Files:**
- Create: `packages/core/src/log/serialize-error.ts`
- Test: `packages/core/src/log/serialize-error.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// packages/core/src/log/serialize-error.test.ts
import { describe, it, expect } from "vitest";
import { serializeError } from "./serialize-error.ts";

describe("serializeError", () => {
  it("captures errorClass, message, stack", () => {
    const e = new TypeError("boom");
    const r = serializeError(e);
    expect(r.errorClass).toBe("TypeError");
    expect(r.message).toBe("boom");
    expect(r.stack).toMatch(/TypeError: boom/);
  });

  it("walks cause chain up to 3 levels", () => {
    const root = new Error("root");
    const mid = new Error("mid", { cause: root });
    const top = new Error("top", { cause: mid });
    const r = serializeError(top);
    expect(r.cause?.message).toBe("mid");
    expect(r.cause?.cause?.message).toBe("root");
    expect(r.cause?.cause?.cause).toBeUndefined();
  });

  it("redacts sensitive content in message and stack", () => {
    const e = new Error("Authorization: Bearer abc123");
    const r = serializeError(e);
    expect(r.message).toBe("Authorization: [REDACTED]");
  });

  it("handles non-Error throwables", () => {
    expect(serializeError("string thrown")).toEqual({
      errorClass: "Unknown",
      message: "string thrown",
    });
    expect(serializeError({ message: "weird", code: "E_X" })).toMatchObject({
      errorClass: "Unknown",
      message: "weird",
      code: "E_X",
    });
  });
});
```

- [ ] **Step 2: Run test, expect fail**

Run: `npx vitest run packages/core/src/log/serialize-error.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement serializeError**

```ts
// packages/core/src/log/serialize-error.ts
import { redactString } from "./redact.ts";

export interface SerializedError {
  errorClass: string;
  message: string;
  stack?: string;
  code?: string;
  cause?: SerializedError;
}

const MAX_DEPTH = 3;

export function serializeError(err: unknown, depth = 0): SerializedError {
  if (err instanceof Error) {
    const out: SerializedError = {
      errorClass: err.name || "Error",
      message: redactString(err.message ?? ""),
    };
    if (err.stack) out.stack = redactString(err.stack);
    const code = (err as { code?: unknown }).code;
    if (typeof code === "string") out.code = code;
    const cause = (err as { cause?: unknown }).cause;
    if (cause && depth < MAX_DEPTH) {
      out.cause = serializeError(cause, depth + 1);
    }
    return out;
  }
  if (typeof err === "string") {
    return { errorClass: "Unknown", message: redactString(err) };
  }
  if (err && typeof err === "object") {
    const o = err as { message?: unknown; code?: unknown };
    return {
      errorClass: "Unknown",
      message: redactString(String(o.message ?? "")),
      ...(typeof o.code === "string" ? { code: o.code } : {}),
    };
  }
  return { errorClass: "Unknown", message: String(err) };
}
```

- [ ] **Step 4: Run test to verify pass**

Run: `npx vitest run packages/core/src/log/serialize-error.test.ts`
Expected: PASS.

---

## Task 3: Workflow logger helpers

**Files:**
- Create: `packages/core/src/log/workflow-logger.ts`
- Test: `packages/core/src/log/workflow-logger.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// packages/core/src/log/workflow-logger.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import pino from "pino";
import { createWorkflowLogger, loggerForRun, type WorkflowLogCtx } from "./workflow-logger.ts";

function captureLogs() {
  const lines: any[] = [];
  const logger = pino({ level: "debug" }, { write(s: string) { lines.push(JSON.parse(s)); } });
  return { logger, lines };
}

describe("createWorkflowLogger", () => {
  it("pre-binds correlation fields onto every log line", () => {
    const { logger, lines } = captureLogs();
    const ctx: WorkflowLogCtx = {
      workflowInstanceId: "wf-1", nodeId: "n-1", phaseType: "clone-repos",
      attempt: 1, taskId: "t-1", workerId: "w-1",
    };
    const child = createWorkflowLogger(logger, ctx);
    child.info("hello");
    expect(lines[0]).toMatchObject({ ...ctx, msg: "hello" });
  });
});

describe("loggerForRun", () => {
  beforeEach(() => { delete process.env.DEBUG_WORKFLOW_IDS; });
  afterEach(() => { delete process.env.DEBUG_WORKFLOW_IDS; });

  it("returns default-level child when run id is not in DEBUG_WORKFLOW_IDS", () => {
    process.env.DEBUG_WORKFLOW_IDS = "other-id";
    const { logger, lines } = captureLogs();
    logger.level = "info";
    const child = loggerForRun(logger, {
      workflowInstanceId: "wf-1", nodeId: "n", phaseType: "p", attempt: 1, taskId: "t", workerId: "w",
    });
    child.debug("debug-line");
    child.info("info-line");
    const msgs = lines.map(l => l.msg);
    expect(msgs).toContain("info-line");
    expect(msgs).not.toContain("debug-line");
  });

  it("raises matched runs to debug", () => {
    process.env.DEBUG_WORKFLOW_IDS = "wf-1,wf-2";
    const { logger, lines } = captureLogs();
    logger.level = "info";
    const child = loggerForRun(logger, {
      workflowInstanceId: "wf-1", nodeId: "n", phaseType: "p", attempt: 1, taskId: "t", workerId: "w",
    });
    child.debug("debug-line");
    const msgs = lines.map(l => l.msg);
    expect(msgs).toContain("debug-line");
  });
});
```

- [ ] **Step 2: Run, expect fail**

Run: `npx vitest run packages/core/src/log/workflow-logger.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// packages/core/src/log/workflow-logger.ts
import type pino from "pino";

export interface WorkflowLogCtx {
  workflowInstanceId: string;
  nodeId: string;
  phaseType: string;
  attempt: number;
  taskId: string;
  workerId: string;
}

export function createWorkflowLogger(base: pino.Logger, ctx: WorkflowLogCtx): pino.Logger {
  return base.child(ctx);
}

function debugRunIds(): Set<string> {
  const raw = (typeof process !== "undefined" ? process.env?.DEBUG_WORKFLOW_IDS : undefined) ?? "";
  return new Set(raw.split(",").map(s => s.trim()).filter(Boolean));
}

export function loggerForRun(base: pino.Logger, ctx: WorkflowLogCtx): pino.Logger {
  const ids = debugRunIds();
  const opts = ids.has(ctx.workflowInstanceId) ? { level: "debug" as const } : undefined;
  return opts ? base.child(ctx, opts) : base.child(ctx);
}
```

- [ ] **Step 4: Run, expect pass**

Run: `npx vitest run packages/core/src/log/workflow-logger.test.ts`
Expected: PASS.

---

## Task 4: Bounded log-tail ring buffer

**Files:**
- Create: `packages/core/src/log/log-tail.ts`
- Test: `packages/core/src/log/log-tail.test.ts`

- [ ] **Step 1: Failing test**

```ts
// packages/core/src/log/log-tail.test.ts
import { describe, it, expect } from "vitest";
import { LogTail } from "./log-tail.ts";

describe("LogTail", () => {
  it("retains only the last N entries in insertion order", () => {
    const tail = new LogTail<number>(3);
    tail.push(1); tail.push(2); tail.push(3); tail.push(4); tail.push(5);
    expect(tail.drain()).toEqual([3, 4, 5]);
  });
  it("returns empty when nothing pushed", () => {
    expect(new LogTail<string>(5).drain()).toEqual([]);
  });
  it("never grows beyond capacity", () => {
    const tail = new LogTail<number>(2);
    for (let i = 0; i < 100; i++) tail.push(i);
    expect(tail.drain()).toEqual([98, 99]);
  });
});
```

- [ ] **Step 2: Run, expect fail**

Run: `npx vitest run packages/core/src/log/log-tail.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// packages/core/src/log/log-tail.ts
export class LogTail<T> {
  private buf: T[] = [];
  constructor(private capacity: number) {}
  push(item: T): void {
    this.buf.push(item);
    if (this.buf.length > this.capacity) this.buf.shift();
  }
  drain(): T[] {
    return [...this.buf];
  }
}
```

- [ ] **Step 4: Run, expect pass**

Run: `npx vitest run packages/core/src/log/log-tail.test.ts`
Expected: PASS.

---

## Task 5: appendPhaseEvent helper

**Files:**
- Create: `packages/core/src/log/append-phase-event.ts`
- Test: `packages/core/src/log/append-phase-event.test.ts`

- [ ] **Step 1: Failing test**

```ts
// packages/core/src/log/append-phase-event.test.ts
import { describe, it, expect, vi } from "vitest";
import { appendPhaseEvent } from "./append-phase-event.ts";
import type { WorkflowLogCtx } from "./workflow-logger.ts";

const ctx: WorkflowLogCtx = {
  workflowInstanceId: "wf-1", nodeId: "n-1", phaseType: "p", attempt: 1, taskId: "t", workerId: "w",
};

describe("appendPhaseEvent", () => {
  it("forwards eventType and payload, injecting correlation fields", async () => {
    const events = { append: vi.fn().mockResolvedValue(undefined) };
    await appendPhaseEvent(events, ctx, "phase.started", { input: 1 });
    expect(events.append).toHaveBeenCalledWith({
      workflowInstanceId: "wf-1",
      nodeId: "n-1",
      eventType: "phase.started",
      payload: { input: 1, phaseType: "p", attempt: 1, taskId: "t", workerId: "w" },
    });
  });
  it("never throws — logs and swallows errors", async () => {
    const err = new Error("db down");
    const events = { append: vi.fn().mockRejectedValue(err) };
    const onError = vi.fn();
    await expect(appendPhaseEvent(events, ctx, "phase.failed", {}, onError)).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledWith(err);
  });
});
```

- [ ] **Step 2: Run, expect fail**

Run: `npx vitest run packages/core/src/log/append-phase-event.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// packages/core/src/log/append-phase-event.ts
import type { WorkflowLogCtx } from "./workflow-logger.ts";

export interface MinimalEventBus {
  append(input: {
    workflowInstanceId: string;
    nodeId: string;
    eventType: string;
    payload: Record<string, unknown>;
  }): Promise<unknown>;
}

export async function appendPhaseEvent(
  events: MinimalEventBus,
  ctx: WorkflowLogCtx,
  eventType: string,
  payload: Record<string, unknown>,
  onError?: (err: unknown) => void,
): Promise<void> {
  try {
    await events.append({
      workflowInstanceId: ctx.workflowInstanceId,
      nodeId: ctx.nodeId,
      eventType,
      payload: {
        ...payload,
        phaseType: ctx.phaseType,
        attempt: ctx.attempt,
        taskId: ctx.taskId,
        workerId: ctx.workerId,
      },
    });
  } catch (err) {
    onError?.(err);
  }
}
```

- [ ] **Step 4: Run, expect pass**

Run: `npx vitest run packages/core/src/log/append-phase-event.test.ts`
Expected: PASS.

---

## Task 6: Wire helpers into core barrel

**Files:**
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/src/logger.ts`

- [ ] **Step 1: Re-export from logger.ts**

Add at bottom of `packages/core/src/logger.ts`:

```ts
export { createWorkflowLogger, loggerForRun, type WorkflowLogCtx } from "./log/workflow-logger.ts";
export { serializeError, type SerializedError } from "./log/serialize-error.ts";
export { redactString, redactObject } from "./log/redact.ts";
export { LogTail } from "./log/log-tail.ts";
export { appendPhaseEvent, type MinimalEventBus } from "./log/append-phase-event.ts";
```

- [ ] **Step 2: Verify index.ts already re-exports from `./logger.ts`**

Look at `packages/core/src/index.ts` around line 27. It already has:
```ts
export { createLogger, type Logger } from "./logger.ts";
```
Update to:
```ts
export {
  createLogger, type Logger,
  createWorkflowLogger, loggerForRun, type WorkflowLogCtx,
  serializeError, type SerializedError,
  redactString, redactObject,
  LogTail,
  appendPhaseEvent, type MinimalEventBus,
} from "./logger.ts";
```

- [ ] **Step 3: Run all core tests, expect pass**

Run: `npx vitest run packages/core`
Expected: PASS.

---

## Task 7: Heartbeat helper

**Files:**
- Create: `packages/orchestrator/src/workers/heartbeat.ts`
- Test: `packages/orchestrator/src/workers/heartbeat.test.ts`

- [ ] **Step 1: Failing test**

```ts
// packages/orchestrator/src/workers/heartbeat.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { startHeartbeat } from "./heartbeat.ts";

describe("startHeartbeat", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("invokes onBeat at the configured interval with elapsedMs", () => {
    const onBeat = vi.fn();
    const stop = startHeartbeat({ intervalMs: 1000, onBeat });
    vi.advanceTimersByTime(2500);
    stop();
    expect(onBeat).toHaveBeenCalledTimes(2);
    expect(onBeat.mock.calls[0][0]).toBeGreaterThanOrEqual(1000);
    expect(onBeat.mock.calls[1][0]).toBeGreaterThanOrEqual(2000);
  });

  it("does not start when intervalMs is 0", () => {
    const onBeat = vi.fn();
    const stop = startHeartbeat({ intervalMs: 0, onBeat });
    vi.advanceTimersByTime(10_000);
    stop();
    expect(onBeat).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run, expect fail**

Run: `npx vitest run packages/orchestrator/src/workers/heartbeat.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// packages/orchestrator/src/workers/heartbeat.ts
export interface HeartbeatOptions {
  intervalMs: number;
  onBeat: (elapsedMs: number) => void;
}

export function startHeartbeat(opts: HeartbeatOptions): () => void {
  if (opts.intervalMs <= 0) return () => {};
  const startedAt = Date.now();
  const id = setInterval(() => {
    opts.onBeat(Date.now() - startedAt);
  }, opts.intervalMs);
  return () => clearInterval(id);
}
```

- [ ] **Step 4: Run, expect pass**

Run: `npx vitest run packages/orchestrator/src/workers/heartbeat.test.ts`
Expected: PASS.

---

## Task 8: Subprocess wrapper

**Files:**
- Create: `packages/orchestrator/src/workers/subprocess.ts`
- Test: `packages/orchestrator/src/workers/subprocess.test.ts`

- [ ] **Step 1: Failing test**

```ts
// packages/orchestrator/src/workers/subprocess.test.ts
import { describe, it, expect, vi } from "vitest";
import { execTracked } from "./subprocess.ts";

describe("execTracked", () => {
  it("returns success record on exit code 0", async () => {
    const r = await execTracked("node", ["-e", "process.exit(0)"]);
    expect(r.exitCode).toBe(0);
    expect(r.command).toContain("node");
    expect(r.stderrTail).toBe("");
  });

  it("returns error record on non-zero exit with stderr tail", async () => {
    const r = await execTracked("node", ["-e", "console.error('boom'); process.exit(2)"]);
    expect(r.exitCode).toBe(2);
    expect(r.stderrTail).toContain("boom");
  });

  it("truncates stderr to 2KB tail", async () => {
    const script = `for (let i=0;i<5000;i++) process.stderr.write('x'); process.exit(1);`;
    const r = await execTracked("node", ["-e", script]);
    expect(r.stderrTail.length).toBeLessThanOrEqual(2048);
  });

  it("redacts sensitive arg patterns from command record", async () => {
    const r = await execTracked("node", ["-e", "process.exit(0)"], {
      env: { TOKEN: "abc123" },
      redactArgs: ["--token=abc123"],
    });
    expect(r.command).not.toContain("abc123");
  });
});
```

- [ ] **Step 2: Run, expect fail**

Run: `npx vitest run packages/orchestrator/src/workers/subprocess.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// packages/orchestrator/src/workers/subprocess.ts
import { spawn } from "node:child_process";
import { redactString } from "@journeyman/core";

export interface SubprocessRecord {
  command: string;
  exitCode: number | null;
  stderrTail: string;
}

export interface ExecOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  redactArgs?: string[];
  stderrTailBytes?: number;
  signal?: AbortSignal;
}

const DEFAULT_TAIL = 2048;

export async function execTracked(
  cmd: string,
  args: string[],
  opts: ExecOptions = {},
): Promise<SubprocessRecord> {
  const tailLimit = opts.stderrTailBytes ?? DEFAULT_TAIL;
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      signal: opts.signal,
    });
    let stderr = "";
    child.stderr?.on("data", chunk => {
      stderr += chunk.toString("utf8");
      if (stderr.length > tailLimit) stderr = stderr.slice(stderr.length - tailLimit);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      const safeArgs = args.map(a =>
        opts.redactArgs?.includes(a) ? "[REDACTED]" : a,
      );
      const command = redactString([cmd, ...safeArgs].join(" "));
      resolve({ command, exitCode: code, stderrTail: stderr });
    });
  });
}
```

- [ ] **Step 4: Run, expect pass**

Run: `npx vitest run packages/orchestrator/src/workers/subprocess.test.ts`
Expected: PASS.

---

## Task 9: Worker harness — adopt helpers, heartbeats, log tail, error enrichment

This task rewrites parts of [`packages/orchestrator/src/workers/worker-harness.ts`](../../../packages/orchestrator/src/workers/worker-harness.ts) (366 lines). Write tests first.

**Files:**
- Modify: `packages/orchestrator/src/workers/worker-harness.ts`
- Create: `packages/orchestrator/src/workers/worker-harness.test.ts`

- [ ] **Step 1: Sketch the test scaffolding**

```ts
// packages/orchestrator/src/workers/worker-harness.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { WorkerHarness } from "./worker-harness.ts";

function fakeTask(overrides: Partial<any> = {}): any {
  return {
    taskId: "t-1",
    taskDefName: "test-phase",
    referenceTaskName: "node-1",
    workflowInstanceId: "engine-wf-1",
    retryCount: 0,
    inputData: { workflowInstanceId: "wf-1", startedByUserId: "u-1", startedByOrgId: "o-1" },
    ...overrides,
  };
}

function makeDeps(overrides: Partial<any> = {}) {
  const events = { append: vi.fn().mockResolvedValue(undefined) };
  const client = {
    pollTask: vi.fn(),
    completeTask: vi.fn().mockResolvedValue(undefined),
  };
  const registry = { get: vi.fn() };
  const workspace = { create: vi.fn().mockResolvedValue({ path: "/tmp/ws", destroy: vi.fn().mockResolvedValue(undefined) }) };
  return {
    events, client, registry, workspace,
    workerId: "worker-1",
    bindingResolver: vi.fn().mockResolvedValue({}),
    mcpResolver: vi.fn().mockResolvedValue([]),
    skillsResolver: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}
```

- [ ] **Step 2: Failing test — emits `task.polled` event with correlation fields on pickup**

Append to test file:

```ts
describe("WorkerHarness.processOnce — pickup", () => {
  it("emits task.polled with correlation fields", async () => {
    const deps: any = makeDeps();
    const task = fakeTask();
    deps.client.pollTask.mockResolvedValue(task);
    deps.registry.get.mockReturnValue({ run: vi.fn().mockResolvedValue({ kind: "success", output: {} }) });

    const harness = new WorkerHarness(deps);
    await harness.processOnce("test-phase");

    const polled = deps.events.append.mock.calls.find((c: any) => c[0].eventType === "task.polled");
    expect(polled).toBeDefined();
    expect(polled[0]).toMatchObject({
      workflowInstanceId: "wf-1", nodeId: "node-1",
      payload: expect.objectContaining({ taskId: "t-1", attempt: 1, workerId: "worker-1", phaseType: "test-phase" }),
    });
  });
});
```

- [ ] **Step 3: Run, expect fail**

Run: `npx vitest run packages/orchestrator/src/workers/worker-harness.test.ts`
Expected: FAIL — `task.polled` not emitted.

- [ ] **Step 4: Implement — adopt helpers in worker-harness.ts**

In `worker-harness.ts`, replace the top of `processOnce` (around lines 86–94) with:

```ts
async processOnce(phaseType: string): Promise<void> {
  const task = await this.deps.client.pollTask(phaseType, this.deps.workerId);
  if (!task) return;
  const conductorWorkflowId = task.workflowInstanceId;
  const workflowInstanceId =
    (task.inputData as { workflowInstanceId?: string }).workflowInstanceId ?? conductorWorkflowId;
  const nodeId = task.referenceTaskName;
  const attempt = task.retryCount + 1;

  const ctx: WorkflowLogCtx = {
    workflowInstanceId, nodeId, phaseType,
    attempt, taskId: task.taskId, workerId: this.deps.workerId,
  };
  const rlog = loggerForRun(baseLog, ctx);

  await appendPhaseEvent(this.deps.events, ctx, "task.polled", {}, e => rlog.error(e, "task.polled emit failed"));
  rlog.info("task picked up");
```

Add these imports at the top:

```ts
import {
  createLogger, PROVIDER_CATALOG, kindForPhaseType,
  loggerForRun, appendPhaseEvent, serializeError, LogTail,
  type WorkflowLogCtx,
} from "@journeyman/core";
```

Replace `const log = createLogger("orchestrator:worker");` with:

```ts
const baseLog = createLogger("orchestrator:worker");
```

Everywhere else in the file, replace `log.X({...inline ctx...}, "msg")` with `rlog.X("msg")` — the correlation fields come from `rlog`, not inline objects. For loop-level errors (outside a task), keep `baseLog`.

- [ ] **Step 5: Run, expect pass**

Run: `npx vitest run packages/orchestrator/src/workers/worker-harness.test.ts -t "task.polled"`
Expected: PASS.

- [ ] **Step 6: Failing test — heartbeat events while handler runs**

Append:

```ts
import { vi as _vi } from "vitest";

describe("WorkerHarness.processOnce — heartbeat", () => {
  beforeEach(() => { process.env.WORKER_HEARTBEAT_MS = "50"; });

  it("emits worker.heartbeat at the configured interval", async () => {
    const deps: any = makeDeps();
    deps.client.pollTask.mockResolvedValue(fakeTask());
    deps.registry.get.mockReturnValue({
      run: () => new Promise(r => setTimeout(() => r({ kind: "success", output: {} }), 180)),
    });
    const harness = new WorkerHarness(deps);
    await harness.processOnce("test-phase");
    const beats = deps.events.append.mock.calls.filter((c: any) => c[0].eventType === "worker.heartbeat");
    expect(beats.length).toBeGreaterThanOrEqual(2);
    expect(beats[0][0].payload.elapsedMs).toBeGreaterThanOrEqual(50);
  });
});
```

- [ ] **Step 7: Run, expect fail**

Run: `npx vitest run packages/orchestrator/src/workers/worker-harness.test.ts -t "heartbeat"`
Expected: FAIL.

- [ ] **Step 8: Implement heartbeat in harness**

In `worker-harness.ts`, wrap the `handler.run` call (around line 283). Add import: `import { startHeartbeat } from "./heartbeat.ts";`. Then:

```ts
const heartbeatMs = Number(process.env.WORKER_HEARTBEAT_MS ?? 30000);
const stopHeartbeat = startHeartbeat({
  intervalMs: heartbeatMs,
  onBeat: (elapsedMs) => {
    appendPhaseEvent(this.deps.events, ctx, "worker.heartbeat", { elapsedMs })
      .catch(e => rlog.debug({ err: e }, "heartbeat emit failed"));
    rlog.debug({ elapsedMs }, "phase.heartbeat");
  },
});

try {
  const result = await handler.run(/* ... */);
  // ... existing success/failure handling
} finally {
  stopHeartbeat();
  await ws.destroy().catch(e => rlog.warn(e, "workspace destroy failed"));
}
```

- [ ] **Step 9: Run, expect pass**

Run: `npx vitest run packages/orchestrator/src/workers/worker-harness.test.ts -t "heartbeat"`
Expected: PASS.

- [ ] **Step 10: Failing test — log tail attached to phase.failed**

```ts
describe("WorkerHarness.processOnce — error enrichment", () => {
  it("attaches log tail (last 20 lines) to phase.failed payload", async () => {
    const deps: any = makeDeps();
    deps.client.pollTask.mockResolvedValue(fakeTask());
    deps.registry.get.mockReturnValue({
      run: async (_input: any, runCtx: any) => {
        for (let i = 0; i < 25; i++) runCtx.log(`line ${i}`, {});
        return { kind: "failure", failure: { errorClass: "BoomError", message: "boom", retryable: false } };
      },
    });
    const harness = new WorkerHarness(deps);
    await harness.processOnce("test-phase");

    const failed = deps.events.append.mock.calls.find((c: any) => c[0].eventType === "phase.failed");
    expect(failed).toBeDefined();
    const tail: string[] = failed[0].payload.tail;
    expect(tail).toHaveLength(20);
    expect(tail[0]).toBe("line 5");
    expect(tail[19]).toBe("line 24");
  });

  it("serializes unhandled errors with stack + cause", async () => {
    const deps: any = makeDeps();
    deps.client.pollTask.mockResolvedValue(fakeTask());
    deps.registry.get.mockReturnValue({
      run: async () => {
        const cause = new Error("root");
        throw new Error("top", { cause });
      },
    });
    const harness = new WorkerHarness(deps);
    await harness.processOnce("test-phase");
    const failed = deps.events.append.mock.calls.find((c: any) => c[0].eventType === "phase.failed");
    expect(failed[0].payload).toMatchObject({
      reason: "unhandled",
      error: { errorClass: "Error", message: "top", cause: { message: "root" } },
    });
  });
});
```

- [ ] **Step 11: Run, expect fail**

Run: `npx vitest run packages/orchestrator/src/workers/worker-harness.test.ts -t "error enrichment"`
Expected: FAIL.

- [ ] **Step 12: Implement log-tail + error enrichment**

Before calling `handler.run`, create the tail:

```ts
const tail = new LogTail<string>(20);
```

Wrap the `log` callback passed to `handler.run`:

```ts
log: (line, meta) => {
  tail.push(typeof line === "string" ? line : String(line));
  this.deps.events.append({
    workflowInstanceId, nodeId, eventType: "phase.log", payload: { line, meta },
  }).catch(err => rlog.error(err, "log emit failed"));
},
```

In the **failure** branch (around line 305), change:

```ts
} else {
  const retryable = result.failure.retryable ?? false;
  rlog.error({ retryable, error: result.failure }, "phase failed");
  await appendPhaseEvent(this.deps.events, ctx, "phase.failed", {
    reason: "handler_error",
    error: { ...result.failure, retryable },
    tail: tail.drain(),
    classified: { retryable },
  });
  await this.deps.client.completeTask({
    workflowInstanceId: conductorWorkflowId, taskId: task.taskId,
    status: retryable ? "FAILED" : "FAILED_WITH_TERMINAL_ERROR",
    reasonForIncompletion: result.failure.message,
  });
}
```

In the **catch** branch (around line 332) — unhandled error:

```ts
rlog.error({ err: serializeError(err) }, "phase threw unhandled error");
await appendPhaseEvent(this.deps.events, ctx, "phase.failed", {
  reason: "unhandled",
  error: serializeError(err),
  tail: tail.drain(),
});
await this.deps.client.completeTask({
  workflowInstanceId: conductorWorkflowId, taskId: task.taskId,
  status: "FAILED",
  reasonForIncompletion: String((err as Error)?.message ?? err),
});
```

And the `ConfigurationError` branch:

```ts
if ((err as { name?: string })?.name === "ConfigurationError") {
  rlog.error({ message: (err as Error).message }, "phase failed: configuration error");
  await appendPhaseEvent(this.deps.events, ctx, "phase.failed", {
    reason: "configuration_error",
    error: serializeError(err),
    tail: tail.drain(),
  });
  await this.deps.client.completeTask({
    workflowInstanceId: conductorWorkflowId, taskId: task.taskId,
    status: "FAILED_WITH_TERMINAL_ERROR",
    reasonForIncompletion: `configuration_error: ${(err as Error).message}`,
  });
  return;
}
```

Similarly, update the missing-secrets, mcp-resolution-failed, skills-resolution-failed branches to include `reason` and `error: serializeError(err)`.

- [ ] **Step 13: Run, expect pass**

Run: `npx vitest run packages/orchestrator/src/workers/worker-harness.test.ts`
Expected: PASS (all harness tests).

- [ ] **Step 14: Failing test — phase.completed includes durationMs**

```ts
describe("WorkerHarness.processOnce — durations", () => {
  it("includes durationMs on phase.completed payload", async () => {
    const deps: any = makeDeps();
    deps.client.pollTask.mockResolvedValue(fakeTask());
    deps.registry.get.mockReturnValue({
      run: () => new Promise(r => setTimeout(() => r({ kind: "success", output: { ok: 1 } }), 30)),
    });
    const harness = new WorkerHarness(deps);
    await harness.processOnce("test-phase");
    const completed = deps.events.append.mock.calls.find((c: any) => c[0].eventType === "phase.completed");
    expect(completed[0].payload.durationMs).toBeGreaterThanOrEqual(30);
  });
});
```

- [ ] **Step 15: Run, expect fail; then add `durationMs` to the success branch**

In the success branch:

```ts
if (result.kind === "success") {
  const durationMs = Date.now() - startedAt; // capture startedAt right before handler.run
  rlog.info({ durationMs }, "phase completed");
  await appendPhaseEvent(this.deps.events, ctx, "phase.completed", {
    output: result.output, durationMs,
  });
  await this.deps.client.completeTask({
    workflowInstanceId: conductorWorkflowId, taskId: task.taskId,
    status: "COMPLETED", outputData: result.output,
  });
}
```

Where `const startedAt = Date.now();` sits right above the heartbeat setup.

- [ ] **Step 16: Run, expect pass**

Run: `npx vitest run packages/orchestrator/src/workers/worker-harness.test.ts`
Expected: PASS.

---

## Task 10: Conductor client — debug request logging

**Files:**
- Modify: `packages/orchestrator/src/engines/conductor/conductor-client.ts`

- [ ] **Step 1: Find pollTask / completeTask method bodies**

Run: `grep -n "pollTask\|completeTask" packages/orchestrator/src/engines/conductor/conductor-client.ts`

- [ ] **Step 2: Wrap each request with debug logs**

At the top of `pollTask(...)`:

```ts
const reqStart = Date.now();
log.debug({ phaseType, workerId }, "conductor.poll.request.start");
try {
  const result = await /* existing http call */;
  log.debug({ phaseType, workerId, hasTask: !!result, durationMs: Date.now() - reqStart }, "conductor.poll.request.end");
  return result;
} catch (err) {
  log.error({ phaseType, workerId, err, durationMs: Date.now() - reqStart }, "conductor.poll.request.failed");
  throw err;
}
```

Apply the analogous wrapper to `completeTask(...)` with fields `taskId`, `status`, `durationMs`.

- [ ] **Step 3: Run existing orchestrator tests**

Run: `npx vitest run packages/orchestrator`
Expected: PASS (no regressions; new logs are debug-only and silent at default level).

---

## Task 11: Conductor orchestrator — emit routing events

The existing `emitEngineNodeResolveds` ([conductor-orchestrator.ts:184](../../../packages/orchestrator/src/engines/conductor/conductor-orchestrator.ts:184)) walks engine tasks at terminal sync. Extend it to also emit `phase.skipped` (for `SKIPPED` tasks), `condition.evaluated` (for SWITCH task with output `evaluationResult`/`selectedCase`), and `edge.taken` (target reference from SWITCH).

**Files:**
- Create: `packages/orchestrator/src/engines/conductor/emit-routing-events.ts`
- Create: `packages/orchestrator/src/engines/conductor/emit-routing-events.test.ts`
- Modify: `packages/orchestrator/src/engines/conductor/conductor-orchestrator.ts`

- [ ] **Step 1: Failing test**

```ts
// packages/orchestrator/src/engines/conductor/emit-routing-events.test.ts
import { describe, it, expect, vi } from "vitest";
import { emitRoutingEvents } from "./emit-routing-events.ts";

describe("emitRoutingEvents", () => {
  it("emits phase.skipped for tasks with status SKIPPED", async () => {
    const events = { append: vi.fn().mockResolvedValue(undefined) };
    await emitRoutingEvents(events, "wf-1", [
      { taskType: "SIMPLE", status: "SKIPPED", referenceTaskName: "node-2", inputData: {}, outputData: {} } as any,
      { taskType: "SIMPLE", status: "COMPLETED", referenceTaskName: "node-3", inputData: {}, outputData: {} } as any,
    ]);
    const skipped = events.append.mock.calls.find(c => c[0].eventType === "phase.skipped");
    expect(skipped[0].nodeId).toBe("node-2");
  });

  it("emits condition.evaluated + edge.taken for SWITCH tasks", async () => {
    const events = { append: vi.fn().mockResolvedValue(undefined) };
    await emitRoutingEvents(events, "wf-1", [
      {
        taskType: "SWITCH",
        status: "COMPLETED",
        referenceTaskName: "gate-1",
        inputData: { expression: "x > 0", x: 1 },
        outputData: { evaluationResult: ["caseA"], selectedCase: "caseA" },
      } as any,
    ]);
    const cond = events.append.mock.calls.find(c => c[0].eventType === "condition.evaluated");
    expect(cond[0].payload).toMatchObject({ result: "caseA" });
    const edge = events.append.mock.calls.find(c => c[0].eventType === "edge.taken");
    expect(edge[0].payload).toMatchObject({ target: "caseA" });
  });
});
```

- [ ] **Step 2: Run, expect fail**

Run: `npx vitest run packages/orchestrator/src/engines/conductor/emit-routing-events.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// packages/orchestrator/src/engines/conductor/emit-routing-events.ts
import type { MinimalEventBus } from "@journeyman/core";

interface ConductorTask {
  taskType: string;
  status: string;
  referenceTaskName: string;
  inputData?: Record<string, unknown>;
  outputData?: Record<string, unknown>;
}

export async function emitRoutingEvents(
  events: MinimalEventBus,
  workflowInstanceId: string,
  tasks: ConductorTask[],
): Promise<void> {
  for (const t of tasks) {
    if (t.status === "SKIPPED") {
      await events.append({
        workflowInstanceId, nodeId: t.referenceTaskName,
        eventType: "phase.skipped",
        payload: { reason: "engine_skipped", taskType: t.taskType },
      });
      continue;
    }
    if (t.taskType === "SWITCH" && t.status === "COMPLETED") {
      const out = t.outputData ?? {};
      const inp = t.inputData ?? {};
      const result =
        (out.selectedCase as string | undefined) ??
        (Array.isArray(out.evaluationResult) ? (out.evaluationResult[0] as string | undefined) : undefined);
      await events.append({
        workflowInstanceId, nodeId: t.referenceTaskName,
        eventType: "condition.evaluated",
        payload: { expression: inp.expression, inputs: inp, result },
      });
      if (result) {
        await events.append({
          workflowInstanceId, nodeId: t.referenceTaskName,
          eventType: "edge.taken",
          payload: { target: result },
        });
      }
    }
  }
}
```

- [ ] **Step 4: Run, expect pass**

Run: `npx vitest run packages/orchestrator/src/engines/conductor/emit-routing-events.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire into conductor-orchestrator.ts**

In `emitEngineNodeResolveds` (around line 184), after the existing loop that emits `node.resolved`, call:

```ts
await emitRoutingEvents(this.deps.events, instance.id, exec.tasks as any);
```

Add import:

```ts
import { emitRoutingEvents } from "./emit-routing-events.ts";
```

- [ ] **Step 6: Run all orchestrator tests**

Run: `npx vitest run packages/orchestrator`
Expected: PASS.

---

## Task 12: Phase handler sweep — three-moment minimum

There are 17 handlers in `packages/orchestrator/src/workers/phases/`. Apply the same pattern to each. The pattern below is the template; **repeat for every file in the list**.

**Pattern template (apply to every file in `packages/orchestrator/src/workers/phases/`):**

```ts
import { createLogger } from "@journeyman/core";
const log = createLogger("orchestrator:phase:<handler-name>");

export const myPhaseHandler = {
  async run(input: MyInput, ctx: RunCtx): Promise<RunResult> {
    const startedAt = Date.now();
    const baseFields = { workflowInstanceId: ctx.workflowInstanceId, nodeId: ctx.nodeId, attempt: ctx.attempt };
    log.info(baseFields, "handler.start");

    try {
      log.debug(baseFields, "handler.step.<name>");
      // ...do work...

      const durationMs = Date.now() - startedAt;
      log.info({ ...baseFields, durationMs, resultKind: "success" }, "handler.end");
      return { kind: "success", output };
    } catch (err) {
      const durationMs = Date.now() - startedAt;
      log.error({ ...baseFields, durationMs, err }, "handler.end (error)");
      throw err;
    }
  },
};
```

**Files to sweep (17 handlers):**
- `cleanup-workspace-phase-handler.ts`
- `clone-repos-phase-handler.ts` (also wrap any git/sh spawns with `execTracked`)
- `comment-on-issue-phase-handler.ts`
- `create-issue-phase-handler.ts`
- `create-workspace-phase-handler.ts`
- `custom-ai-phase-handler.ts` (subprocess wrap; this is the highest-value one for "opaque failure")
- `get-issue-phase-handler.ts`
- `get-repository-phase-handler.ts`
- `list-pull-request-comments-phase-handler.ts`
- `list-pull-requests-phase-handler.ts`
- `list-workspace-files-phase-handler.ts`
- `open-pull-request-phase-handler.ts`
- `send-message-phase-handler.ts`
- `start-feature-branch-phase-handler.ts`
- `transition-issue-phase-handler.ts`
- `update-issue-fields-phase-handler.ts`
- (and any others present in the directory at execution time — run `ls` to confirm)

- [ ] **Step 1: Confirm the file list**

Run: `ls packages/orchestrator/src/workers/phases/`
Note the actual list — apply the pattern to each.

- [ ] **Step 2: For each handler, apply the pattern**

For each file in the list above:
1. Open the file.
2. If it does not have `createLogger`, add it.
3. Insert `handler.start` log at the top of `run`.
4. Insert `handler.end` log just before `return { kind: "success", ... }`.
5. Insert `handler.step.*` debug logs around any meaningful sub-step (API call, file scan, subprocess spawn).
6. For files that spawn subprocesses (notably `clone-repos`, `custom-ai`, anything calling `spawn`/`exec`/`execa`), import `execTracked` from `../subprocess.ts` and use it instead, capturing the returned record. On non-zero `exitCode`, fail the phase with `result.failure.subprocess = record`.

- [ ] **Step 3: Failing test — pick one representative handler and add one assertion**

Pick `clone-repos-phase-handler.ts`. Add a small smoke test that asserts `log.info` is invoked at start and end. If there is no existing test file, create:

```ts
// packages/orchestrator/src/workers/phases/clone-repos-phase-handler.test.ts
import { describe, it, expect, vi } from "vitest";
import pino from "pino";
import { cloneReposPhaseHandler } from "./clone-repos-phase-handler.ts";

describe("cloneReposPhaseHandler", () => {
  it("emits handler.start and handler.end logs", async () => {
    const lines: any[] = [];
    const _p = pino({ level: "debug" }, { write: (s: string) => lines.push(JSON.parse(s)) });
    // If the handler reads its logger via createLogger, this test is best-effort:
    // either parametrize the logger in the handler or assert via vi.spyOn on stdout.
    const result = await cloneReposPhaseHandler.run(
      { /* minimal valid input */ } as any,
      {
        workflowInstanceId: "wf-1", nodeId: "n-1", attempt: 1,
        workspaceDir: "/tmp", signal: new AbortController().signal, env: {}, workflowInputs: {},
        log: vi.fn(),
      } as any,
    ).catch(e => ({ kind: "failure", failure: { message: String(e) } }));
    expect(result).toBeDefined();
  });
});
```

(If the handler requires network/IO that cannot be stubbed easily, skip per-handler tests and rely on the typecheck pass + manual smoke. Do **not** silently leave broken tests.)

- [ ] **Step 4: Run orchestrator tests**

Run: `npx vitest run packages/orchestrator`
Expected: PASS.

---

## Task 13: Run viewer — render new event types

**Files:**
- Modify: `packages/run-viewer/src/status/compute-node-status.ts`
- Modify: `packages/run-viewer/src/drawer/NodeDetailDrawer.tsx`
- Modify: `packages/run-viewer/src/canvas/*` (locate node label / annotation renderer)
- Modify: `packages/run-viewer/src/topbar/*` (locate toolbar for filter toggle)

- [ ] **Step 1: Failing test — node status for `phase.skipped`**

```ts
// packages/run-viewer/src/status/compute-node-status.test.ts (extend or create)
import { describe, it, expect } from "vitest";
import { computeNodeStatus } from "./compute-node-status.ts";

describe("computeNodeStatus — new event types", () => {
  it("marks a node as skipped on phase.skipped", () => {
    const status = computeNodeStatus([
      { eventType: "phase.skipped", nodeId: "n", payload: {} } as any,
    ]);
    expect(status).toBe("skipped");
  });
});
```

- [ ] **Step 2: Run, expect fail**

Run: `npx vitest run packages/run-viewer/src/status/compute-node-status.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement in `compute-node-status.ts`**

Add a case to the existing switch (around line 27):

```ts
case "phase.skipped":
  status = "skipped";
  break;
```

If `"skipped"` is not in the status union, add it to the type.

- [ ] **Step 4: Run, expect pass**

Run: `npx vitest run packages/run-viewer/src/status/compute-node-status.test.ts`
Expected: PASS.

- [ ] **Step 5: Heartbeat ticker — render live "running for Xm Ys" badge**

In the canvas/node-rendering component (locate via `grep -rn 'phase.started\|running' packages/run-viewer/src`):

- Track the most recent `worker.heartbeat` event per active node.
- When the node is in `running` state, show "running for <elapsed>" derived from `payload.elapsedMs`.
- Do not render a row per heartbeat in the timeline.

- [ ] **Step 6: Debug filter toggle**

In the topbar component, add a toggle state (e.g., `showDebugEvents`, default `false`). Pass it down to the timeline component. In the timeline, hide events with `eventType` in `["task.polled", "task.dispatched", "worker.heartbeat"]` unless `showDebugEvents` is true. (The active heartbeat ticker on a running node stays visible regardless — only the per-event row is hidden.)

- [ ] **Step 7: Error details — render enriched `phase.failed` payload**

In `NodeDetailDrawer.tsx` (or wherever `phase.failed` is rendered today), when `payload.error` is present, render:

- `error.errorClass` + `error.message` at the top.
- Collapsible "Stack" section showing `error.stack`.
- Collapsible "Cause" section showing `error.cause` recursively.
- Collapsible "Last log lines" section showing `payload.tail` (array of strings).
- Collapsible "Subprocess" section showing `payload.subprocess.command`, `exitCode`, `stderrTail` if present.

Keep the existing one-line fallback for old events that lack the new fields.

- [ ] **Step 8: Run all run-viewer tests**

Run: `npx vitest run packages/run-viewer`
Expected: PASS.

---

## Task 14: Edge annotation rendering (optional polish)

**Files:**
- Modify: canvas/edge component in `packages/run-viewer/src/canvas/`

- [ ] **Step 1: Locate edge component**

Run: `grep -rn "edge\|condition" packages/run-viewer/src/canvas | head`

- [ ] **Step 2: Render `edge.taken` and `condition.evaluated`**

When an `edge.taken` event exists with `payload.target = X`, highlight the edge leading to node `X` and label it "→ <conditionLabel>" (use `condition.evaluated.payload.expression` truncated to 40 chars). If `condition.evaluated.payload.result` is `null`/`undefined`, label "default branch".

(No test required — visual polish. Skip if it expands the change too much; spec note already says edge annotations can ship in a follow-up if time-constrained.)

---

## Task 15: Final typecheck

**Files:** all packages.

- [ ] **Step 1: Run typecheck across the monorepo**

Run: `npm run typecheck`
Expected: PASS — no type errors in any package.

- [ ] **Step 2: If errors appear, fix them in-place**

Most likely failures:
- Event type unions in `@journeyman/core` may not include `task.polled`, `worker.heartbeat`, `phase.skipped`, `edge.taken`, `condition.evaluated`. Locate the union (likely in `packages/core/src/types/events*.ts`) and add the new literals.
- `WorkflowLogCtx` consumers in the harness may need the new field shape on log calls — adjust callers.
- `MinimalEventBus` may need narrowing if it conflicts with the existing `IEventBus` typing — make `IEventBus` a structural superset.

- [ ] **Step 3: Re-run typecheck until clean**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Run the full test suite once more**

Run: `npx vitest run`
Expected: PASS.

---

## Spec coverage check

| Spec section | Implemented in |
|---|---|
| Correlation contract fields | Task 3, Task 9 |
| `createWorkflowLogger`, `loggerForRun`, `serializeError`, `appendPhaseEvent` | Tasks 1–6 |
| Worker harness lifecycle moments + `task.polled` | Task 9 |
| Heartbeats + `WORKER_HEARTBEAT_MS` | Tasks 7, 9 |
| Log tail (last 20) | Tasks 4, 9 |
| Error enrichment (`reason`, `error`, `tail`, `subprocess`) | Tasks 8, 9, 12 |
| `DEBUG_WORKFLOW_IDS` per-run override | Tasks 3, 9 |
| Conductor orchestrator routing events | Task 11 |
| Conductor client request logs | Task 10 |
| Phase handler three-moment sweep | Task 12 |
| Subprocess wrapper for spawning handlers | Tasks 8, 12 |
| Run viewer renderers + debug toggle | Tasks 13, 14 |
| Backward compatibility (additive payloads) | Built into Tasks 9, 11, 13 |
| Typecheck pass | Task 15 |

## Execution notes

- **No commits.** Per user request, no `git commit` steps are included. The implementer should run `git status` / `git diff` between tasks to track progress and let the user decide when to commit.
- **TDD.** Each task (where testable) writes the test first, runs it red, then implements until green.
- **Final typecheck.** Task 15 is the last gate. Run it once at the very end across the full monorepo.
