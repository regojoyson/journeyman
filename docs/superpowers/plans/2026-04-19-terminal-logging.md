# Terminal Logging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Print step lifecycle events and key phase trace lines to stdout as the pipeline runs so the full flow is traceable in the terminal.

**Architecture:** A `subscribeAll` global listener is added to `EventBus`; `FileTraceLogger` emits `logLine` events after each disk write; a new `console-logger.ts` subscribes globally and prints formatted output for all lifecycle and logLine events. Seven phases get minimal `ctx.trace.log()` calls for key milestones.

**Tech Stack:** TypeScript, Node.js, Vitest (tests), no new runtime dependencies.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `packages/pipeline/src/event-bus.ts` | Modify | Add `subscribeAll(listener)` global subscription |
| `packages/core/src/types/pipeline.types.ts` | Modify | Add `productId` to `runStarted`/`runEnded` events |
| `packages/pipeline/src/pipeline.ts` | Modify | Include `productId` in `runStarted`/`runEnded` publish calls |
| `packages/pipeline/src/state/file-trace-logger.ts` | Modify | Accept optional `EventBus`, emit `logLine` after each disk write |
| `packages/pipeline-server/src/console-logger.ts` | Create | `subscribeConsoleLogger(bus)` — formats and prints events to stdout |
| `packages/pipeline-server/src/main.ts` | Modify | Pass `eventBus` to `FileTraceLogger`; call `subscribeConsoleLogger` |
| `packages/pipeline/src/phases/get-ticket-phase.ts` | Modify | Log ticket title + status after fetch |
| `packages/pipeline/src/phases/update-status-phase.ts` | Modify | Log semantic → actual status mapping |
| `packages/pipeline/src/phases/clone-repos-phase.ts` | Modify | Log repo names being cloned and clone count |
| `packages/pipeline/src/phases/cleanup-repos-phase.ts` | Modify | Log cleanup result |
| `packages/pipeline/src/phases/checkout-repo-phase.ts` | Modify | Log branch name being checked out |
| `packages/pipeline/src/phases/commit-push-phase.ts` | Modify | Log commit message and pushed branch |
| `packages/pipeline/src/phases/create-pr-phase.ts` | Modify | Log PR URL |
| `packages/pipeline/src/event-bus.test.ts` | Create | Tests for `subscribeAll` |
| `packages/pipeline/src/state/file-trace-logger.test.ts` | Create | Tests for logLine event emission |
| `package.json` (root) | Modify | Add vitest devDependency + test script |

---

### Task 1: Set up Vitest

**Files:**
- Modify: `package.json` (root)
- Create: `vitest.config.ts` (root)

- [ ] **Step 1: Install Vitest**

```bash
npm install --save-dev vitest
```

Expected: vitest appears in root `package.json` devDependencies.

- [ ] **Step 2: Add test script to root package.json**

Open `package.json` at the root. Add `"test": "vitest run"` to the `"scripts"` block.

- [ ] **Step 3: Create vitest.config.ts at repo root**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts"],
  },
});
```

- [ ] **Step 4: Verify vitest runs (no tests yet)**

```bash
npm test
```

Expected output: `No test files found` or `0 tests passed`. No errors.

- [ ] **Step 5: Commit**

```bash
git add package.json vitest.config.ts package-lock.json
git commit -m "chore: add vitest for pipeline unit tests"
```

---

### Task 2: Add `subscribeAll` to EventBus

**Files:**
- Modify: `packages/pipeline/src/event-bus.ts`
- Create: `packages/pipeline/src/event-bus.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/pipeline/src/event-bus.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { EventBus } from "./event-bus.ts";
import type { PipelineEvent } from "@journeyman/core";

function makeStepStarted(sessionId: string): PipelineEvent {
  return {
    type: "stepStarted",
    sessionId,
    stepId: "test-step",
    phase: "testPhase",
    attempt: 1,
    at: new Date().toISOString(),
  };
}

describe("EventBus.subscribeAll", () => {
  it("receives events from any session", () => {
    const bus = new EventBus();
    const received: PipelineEvent[] = [];
    bus.subscribeAll(e => received.push(e));

    bus.publish(makeStepStarted("s1"));
    bus.publish(makeStepStarted("s2"));

    expect(received).toHaveLength(2);
    expect(received[0].sessionId).toBe("s1");
    expect(received[1].sessionId).toBe("s2");
  });

  it("returns an unsubscribe function that stops delivery", () => {
    const bus = new EventBus();
    const received: PipelineEvent[] = [];
    const unsub = bus.subscribeAll(e => received.push(e));

    bus.publish(makeStepStarted("s1"));
    unsub();
    bus.publish(makeStepStarted("s2"));

    expect(received).toHaveLength(1);
    expect(received[0].sessionId).toBe("s1");
  });

  it("does not affect per-session subscribers", () => {
    const bus = new EventBus();
    const global: PipelineEvent[] = [];
    const perSession: PipelineEvent[] = [];
    bus.subscribeAll(e => global.push(e));
    bus.subscribe("s1", e => perSession.push(e));

    bus.publish(makeStepStarted("s1"));
    bus.publish(makeStepStarted("s2"));

    expect(global).toHaveLength(2);
    expect(perSession).toHaveLength(1);
    expect(perSession[0].sessionId).toBe("s1");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npm test
```

Expected: FAIL — `bus.subscribeAll is not a function`.

- [ ] **Step 3: Add `subscribeAll` to EventBus**

Open `packages/pipeline/src/event-bus.ts`. Replace the entire file content:

```typescript
import type { PipelineEvent } from "@journeyman/core";

type Listener = (e: PipelineEvent) => void;

export class EventBus {
  private listeners = new Map<string, Set<Listener>>();
  private globalListeners = new Set<Listener>();
  private buffers = new Map<string, PipelineEvent[]>();

  constructor(private readonly bufferSize: number = 500) {}

  publish(e: PipelineEvent): void {
    const ls = this.listeners.get(e.sessionId);
    if (ls) for (const l of ls) l(e);
    for (const l of this.globalListeners) l(e);

    let buf = this.buffers.get(e.sessionId);
    if (!buf) { buf = []; this.buffers.set(e.sessionId, buf); }
    buf.push(e);
    if (buf.length > this.bufferSize) buf.splice(0, buf.length - this.bufferSize);
  }

  subscribe(sessionId: string, listener: Listener): () => void {
    let set = this.listeners.get(sessionId);
    if (!set) { set = new Set(); this.listeners.set(sessionId, set); }
    set.add(listener);
    return () => { set!.delete(listener); };
  }

  subscribeAll(listener: Listener): () => void {
    this.globalListeners.add(listener);
    return () => { this.globalListeners.delete(listener); };
  }

  replay(sessionId: string): PipelineEvent[] {
    return [...(this.buffers.get(sessionId) ?? [])];
  }
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
npm test
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/pipeline/src/event-bus.ts packages/pipeline/src/event-bus.test.ts
git commit -m "feat(pipeline): add EventBus.subscribeAll for global event listening"
```

---

### Task 3: Add `productId` to `runStarted` / `runEnded` events

**Files:**
- Modify: `packages/core/src/types/pipeline.types.ts` (the `PipelineEvent` union)
- Modify: `packages/pipeline/src/pipeline.ts` (the publish calls)

The console logger needs `productId` to label terminal output. Neither `runStarted` nor `runEnded` currently carry it.

- [ ] **Step 1: Update PipelineEvent union in core**

Open `packages/core/src/types/pipeline.types.ts`. Find the `PipelineEvent` type. Change the `runStarted` and `runEnded` members to include `productId`:

```typescript
export type PipelineEvent =
  | { type: "runStarted";    sessionId: string; productId: string; ticketKey: string; flowName: string; at: string }
  | { type: "stepStarted";   sessionId: string; stepId: string; phase: string; attempt: number; at: string }
  | { type: "stepEnded";     sessionId: string; stepId: string; phase: string; attempt: number; status: StepRecord["status"]; durationMs: number; at: string }
  | { type: "logLine";       sessionId: string; stepId: string; level: "info"|"warn"|"error"; line: string; at: string }
  | { type: "statusChanged"; sessionId: string; from: PipelineRun["status"]; to: PipelineRun["status"]; at: string }
  | { type: "runEnded";      sessionId: string; productId: string; status: PipelineRun["status"]; at: string };
```

- [ ] **Step 2: Fix the publish call for `runStarted` in pipeline.ts**

Open `packages/pipeline/src/pipeline.ts`. Find line 90:

```typescript
this.emit({ type: "runStarted", sessionId, ticketKey: run.ticketKey, flowName: run.flowName, at: now() });
```

Change to:

```typescript
this.emit({ type: "runStarted", sessionId, productId: run.productId, ticketKey: run.ticketKey, flowName: run.flowName, at: now() });
```

- [ ] **Step 3: Fix the publish call for `runEnded` in pipeline.ts**

In the same file, find the `runEnded` publish call (near the `finish` method). It looks like:

```typescript
this.emit({ type: "runEnded", sessionId: run.sessionId, status: run.status, at: now() });
```

Change to:

```typescript
this.emit({ type: "runEnded", sessionId: run.sessionId, productId: run.productId, status: run.status, at: now() });
```

- [ ] **Step 4: Type-check**

```bash
npm run typecheck
```

Expected: no errors. Fix any TypeScript complaints about missing `productId`.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/types/pipeline.types.ts packages/pipeline/src/pipeline.ts
git commit -m "feat(core): add productId to runStarted and runEnded pipeline events"
```

---

### Task 4: Update `FileTraceLogger` to emit `logLine` events

**Files:**
- Modify: `packages/pipeline/src/state/file-trace-logger.ts`
- Create: `packages/pipeline/src/state/file-trace-logger.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/pipeline/src/state/file-trace-logger.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileTraceLogger } from "./file-trace-logger.ts";
import { EventBus } from "../event-bus.ts";
import type { PipelineEvent } from "@journeyman/core";

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "journeyman-test-"));
}

describe("FileTraceLogger logLine emission", () => {
  it("emits a logLine event to the EventBus when logging", async () => {
    const dir = makeTempDir();
    const bus = new EventBus();
    const received: PipelineEvent[] = [];
    bus.subscribeAll(e => received.push(e));

    const logger = new FileTraceLogger(dir, () => "test-product", bus);
    await logger.log("session-1", "clone", "cloning repos", "info");

    expect(received).toHaveLength(1);
    const event = received[0];
    expect(event.type).toBe("logLine");
    if (event.type !== "logLine") throw new Error("wrong type");
    expect(event.sessionId).toBe("session-1");
    expect(event.stepId).toBe("clone");
    expect(event.line).toBe("cloning repos");
    expect(event.level).toBe("info");
  });

  it("does not emit to EventBus when no bus provided", async () => {
    const dir = makeTempDir();
    const logger = new FileTraceLogger(dir, () => "test-product");
    // Should not throw
    await logger.log("session-1", "clone", "cloning repos", "info");
  });

  it("emits warn and error levels", async () => {
    const dir = makeTempDir();
    const bus = new EventBus();
    const levels: string[] = [];
    bus.subscribeAll(e => { if (e.type === "logLine") levels.push(e.level); });

    const logger = new FileTraceLogger(dir, () => "test-product", bus);
    await logger.log("s", "step", "warn msg", "warn");
    await logger.log("s", "step", "error msg", "error");

    expect(levels).toEqual(["warn", "error"]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npm test
```

Expected: FAIL — `FileTraceLogger` constructor does not accept a third argument.

- [ ] **Step 3: Update FileTraceLogger to accept EventBus and emit logLine**

Open `packages/pipeline/src/state/file-trace-logger.ts`. Replace the entire file:

```typescript
import { mkdirSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { appendFile } from "node:fs/promises";
import { join } from "node:path";
import type { ITraceLogger, TraceLine } from "@journeyman/core";
import type { EventBus } from "../event-bus.ts";

export type ProductIdResolver = (sessionId: string) => string | null;

export class FileTraceLogger implements ITraceLogger {
  constructor(
    private readonly rootDir: string,
    private readonly resolveProductId: ProductIdResolver,
    private readonly eventBus?: EventBus,
  ) {
    mkdirSync(rootDir, { recursive: true });
  }

  async log(
    sessionId: string,
    stepId: string,
    line: string,
    level: TraceLine["level"] = "info",
    meta?: Record<string, unknown>,
  ): Promise<void> {
    const productId = this.resolveProductId(sessionId);
    if (!productId) throw new Error(`FileTraceLogger: no product for session ${sessionId}`);
    const dir = join(this.rootDir, productId, "logs", sessionId);
    mkdirSync(dir, { recursive: true });
    const traceLine: TraceLine = { ts: new Date().toISOString(), level, stepId, message: line, meta };
    await appendFile(join(dir, `${stepId}.log`), JSON.stringify(traceLine) + "\n", "utf8");

    this.eventBus?.publish({
      type: "logLine",
      sessionId,
      stepId,
      level,
      line,
      at: traceLine.ts,
    });
  }

  async *read(
    sessionId: string,
    opts: { stepId?: string; tail?: number } = {},
  ): AsyncIterable<TraceLine> {
    const productId = this.resolveProductId(sessionId);
    if (!productId) return;
    const dir = join(this.rootDir, productId, "logs", sessionId);
    if (!existsSync(dir)) return;
    const files = readdirSync(dir)
      .filter(f => f.endsWith(".log"))
      .filter(f => !opts.stepId || f === `${opts.stepId}.log`);
    const all: TraceLine[] = [];
    for (const f of files) {
      const raw = readFileSync(join(dir, f), "utf8");
      for (const l of raw.split("\n")) if (l.trim()) all.push(JSON.parse(l) as TraceLine);
    }
    all.sort((a, b) => a.ts.localeCompare(b.ts));
    const sliced = opts.tail ? all.slice(-opts.tail) : all;
    for (const traceLine of sliced) yield traceLine;
  }
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
npm test
```

Expected: all tests pass (EventBus tests + FileTraceLogger tests).

- [ ] **Step 5: Type-check**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/pipeline/src/state/file-trace-logger.ts packages/pipeline/src/state/file-trace-logger.test.ts
git commit -m "feat(pipeline): FileTraceLogger emits logLine events to EventBus"
```

---

### Task 5: Create `console-logger.ts`

**Files:**
- Create: `packages/pipeline-server/src/console-logger.ts`

- [ ] **Step 1: Create the file**

Create `packages/pipeline-server/src/console-logger.ts`:

```typescript
import type { EventBus } from "@journeyman/pipeline";
import type { PipelineEvent } from "@journeyman/core";

function fmt(durationMs: number): string {
  return durationMs >= 1000
    ? `${(durationMs / 1000).toFixed(1)}s`
    : `${durationMs}ms`;
}

function handle(e: PipelineEvent): void {
  switch (e.type) {
    case "runStarted":
      console.log(`[run]    ${e.productId} · ${e.ticketKey} · started`);
      break;
    case "stepStarted":
      console.log(`[step]   → ${e.stepId}`);
      break;
    case "stepEnded":
      if (e.status === "ok") {
        console.log(`[step]   ✓ ${e.stepId} (${fmt(e.durationMs)})`);
      } else if (e.status === "cancelled") {
        console.log(`[step]   ~ ${e.stepId} cancelled`);
      } else {
        const run = (e as any);
        console.log(`[step]   ✗ ${e.stepId} — ${run.error ?? e.status}`);
      }
      break;
    case "statusChanged":
      console.log(`[status] ${e.from} → ${e.to}`);
      break;
    case "runEnded":
      console.log(`[run]    ${e.productId} · ${e.status}`);
      break;
    case "logLine":
      console.log(`  [${e.level}] ${e.line}`);
      break;
  }
}

export function subscribeConsoleLogger(bus: EventBus): () => void {
  return bus.subscribeAll(handle);
}
```

- [ ] **Step 2: Type-check**

```bash
npm run typecheck
```

Expected: no errors. If `EventBus` is not exported from `@journeyman/pipeline`, open `packages/pipeline/src/index.ts` and add `export { EventBus } from "./event-bus.ts";` — it should already be there but verify.

- [ ] **Step 3: Commit**

```bash
git add packages/pipeline-server/src/console-logger.ts
git commit -m "feat(pipeline-server): add console-logger for terminal output"
```

---

### Task 6: Wire `main.ts`

**Files:**
- Modify: `packages/pipeline-server/src/main.ts`

- [ ] **Step 1: Import `subscribeConsoleLogger`**

Open `packages/pipeline-server/src/main.ts`. Add this import after the existing imports:

```typescript
import { subscribeConsoleLogger } from "./console-logger.ts";
```

- [ ] **Step 2: Pass `eventBus` to `FileTraceLogger`**

In `main.ts`, find this line (around line 72):

```typescript
const trace = new FileTraceLogger(workspacesRoot, productIdResolver);
```

Change it to:

```typescript
const trace = new FileTraceLogger(workspacesRoot, productIdResolver, bus);
```

Note: `bus` is the `EventBus` instance defined just before this line as `const bus = new EventBus();`.

- [ ] **Step 3: Call `subscribeConsoleLogger`**

Immediately after `const bus = new EventBus();`, add:

```typescript
subscribeConsoleLogger(bus);
```

- [ ] **Step 4: Type-check**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 5: Smoke test — start the server**

```bash
npm start
```

Expected: server starts and prints `journeyman pipeline-server listening on 3000`. Trigger a run via curl and watch step lifecycle appear in the terminal.

- [ ] **Step 6: Commit**

```bash
git add packages/pipeline-server/src/main.ts
git commit -m "feat(pipeline-server): wire console logger and EventBus into FileTraceLogger"
```

---

### Task 7: Add trace calls to `getTicket` and `updateStatus` phases

**Files:**
- Modify: `packages/pipeline/src/phases/get-ticket-phase.ts`
- Modify: `packages/pipeline/src/phases/update-status-phase.ts`

- [ ] **Step 1: Update `get-ticket-phase.ts`**

Open `packages/pipeline/src/phases/get-ticket-phase.ts`. Replace the `run` method body:

```typescript
async run(ctx: PipelineContext): Promise<PhaseResult> {
  const res = await ctx.providers.ticket.getTicket({
    id: ctx.ticketKey,
    sessionId: ctx.sessionId,
  });
  const ticket = unwrapField(res, "ticket", "getTicket");
  await ctx.trace.log(ctx.sessionId, this.name, `fetched: "${ticket.title}" · status: ${ticket.status}`);
  return this.ok({ ticket, ticketMd: formatTicketMd(ticket) });
}
```

- [ ] **Step 2: Update `update-status-phase.ts`**

Open `packages/pipeline/src/phases/update-status-phase.ts`. Replace the `run` method body:

```typescript
async run(ctx: PipelineContext, config: Config): Promise<PhaseResult> {
  const semantic = config.status;
  const map = ctx.productConfig.ticketWorkflow?.statuses ?? {};
  const actual = map[semantic];
  if (!actual) {
    throw new AdapterError(
      "updateStatus",
      `no mapping for semantic status "${semantic}" in product "${ctx.productId}"`,
    );
  }

  unwrap(await ctx.providers.ticket.updateStatus({
    id: ctx.ticketKey,
    status: actual,
    sessionId: ctx.sessionId,
  }), "updateStatus");

  await ctx.trace.log(ctx.sessionId, this.name, `${semantic} → "${actual}"`);

  const prior = this.optional<StatusEntry[]>(ctx, "statusHistory") ?? [];
  return this.ok({
    statusHistory: [
      ...prior,
      { at: new Date().toISOString(), semantic, actual, ok: true },
    ],
  });
}
```

- [ ] **Step 3: Type-check**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/pipeline/src/phases/get-ticket-phase.ts packages/pipeline/src/phases/update-status-phase.ts
git commit -m "feat(pipeline): add trace logs to getTicket and updateStatus phases"
```

---

### Task 8: Add trace calls to `cloneRepos` and `cleanupRepos` phases

**Files:**
- Modify: `packages/pipeline/src/phases/clone-repos-phase.ts`
- Modify: `packages/pipeline/src/phases/cleanup-repos-phase.ts`

- [ ] **Step 1: Update `clone-repos-phase.ts`**

Open `packages/pipeline/src/phases/clone-repos-phase.ts`. Replace the `run` method body:

```typescript
async run(ctx: PipelineContext): Promise<PhaseResult> {
  const repos = ctx.productConfig.repos;
  if (!repos.length) return this.blocked("product has no repos configured", "manual");

  const repoNames = repos.map(r => `${r.owner}/${r.repo}`).join(", ");
  await ctx.trace.log(ctx.sessionId, this.name, `cloning: ${repoNames}`);

  const entries = repos.map(r => ({ url: r.url, branch: r.defaultBranch }));
  const res = unwrap(await ctx.providers.git.cloneRepos({
    repos: entries,
    targetDir: join(ctx.workspaceDir, "repos"),
    signal: ctx.signal,
  }), "cloneRepos");

  for (const c of res.repos) {
    if (c.error) return this.failed(`cloneRepos: ${c.error}`);
  }

  const repoPaths = res.repos.map(r => r.dirPath);
  await ctx.trace.log(ctx.sessionId, this.name, `cloned ${repoPaths.length} repo(s)`);

  return this.ok({
    repoPaths,
    primaryRepoPath: repoPaths[0],
    repoRefs: repos,
  });
}
```

- [ ] **Step 2: Update `cleanup-repos-phase.ts`**

Open `packages/pipeline/src/phases/cleanup-repos-phase.ts`. Replace the `run` method body:

```typescript
async run(ctx: PipelineContext): Promise<PhaseResult> {
  const repoPaths = this.require<string[]>(ctx, "repoPaths");
  unwrap(await ctx.providers.coding.cleanupRepos({
    repos: repoPaths,
    sessionId: ctx.sessionId,
    signal: ctx.signal,
  }), "cleanupRepos");
  await ctx.trace.log(ctx.sessionId, this.name, `cleaned up ${repoPaths.length} repo(s)`);
  return this.ok({});
}
```

- [ ] **Step 3: Type-check**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/pipeline/src/phases/clone-repos-phase.ts packages/pipeline/src/phases/cleanup-repos-phase.ts
git commit -m "feat(pipeline): add trace logs to cloneRepos and cleanupRepos phases"
```

---

### Task 9: Add trace calls to `checkoutRepo`, `commitPush`, and `createPR` phases

**Files:**
- Modify: `packages/pipeline/src/phases/checkout-repo-phase.ts`
- Modify: `packages/pipeline/src/phases/commit-push-phase.ts`
- Modify: `packages/pipeline/src/phases/create-pr-phase.ts`

- [ ] **Step 1: Update `checkout-repo-phase.ts`**

Open `packages/pipeline/src/phases/checkout-repo-phase.ts`. Replace the `run` method body:

```typescript
async run(ctx: PipelineContext): Promise<PhaseResult> {
  const repoPaths = this.require<string[]>(ctx, "repoPaths");
  const repos = ctx.productConfig.repos;

  const entries = repoPaths.map((dirPath, i) => ({
    dirPath,
    branch: repos[i]?.defaultBranch ?? "main",
  }));

  const branchNames = entries.map(e => e.branch).join(", ");
  await ctx.trace.log(ctx.sessionId, this.name, `checking out branch(es): ${branchNames}`);

  const res = unwrap(await ctx.providers.coding.checkoutRepo({
    repos: entries,
    sessionId: ctx.sessionId,
    signal: ctx.signal,
  }), "checkoutRepo");

  for (const r of res.repos) {
    if (r.error) return this.failed(`checkoutRepo: ${r.error}`);
  }

  return this.ok({ checkoutResults: res.repos });
}
```

- [ ] **Step 2: Update `commit-push-phase.ts`**

Open `packages/pipeline/src/phases/commit-push-phase.ts`. Replace the `run` method body:

```typescript
async run(ctx: PipelineContext, config: Config = {}): Promise<PhaseResult> {
  const primaryRepoPath = this.require<string>(ctx, "primaryRepoPath");

  const res = unwrap(await ctx.providers.coding.commitPushRepos({
    repos: primaryRepoPath,
    ticket: ctx.ticketShortKey,
    pattern: config.pattern,
    prSummaryStyle: config.prSummaryStyle,
    sessionId: ctx.sessionId,
    signal: ctx.signal,
  }), "commitPushRepos");

  const primary = res.repos[0] as CommitPushResult | undefined;
  if (!primary) throw new AdapterError("commitPushRepos", "no repo result returned");
  if (primary.error) throw new AdapterError("commitPushRepos", primary.error);
  if (!primary.pushed) throw new AdapterError("commitPushRepos", "push did not succeed");

  await ctx.trace.log(ctx.sessionId, this.name, `commit: "${primary.commitMessage}"`);
  await ctx.trace.log(ctx.sessionId, this.name, `pushed branch: ${primary.branch}`);

  return this.ok({ commit: primary });
}
```

- [ ] **Step 3: Update `create-pr-phase.ts`**

Open `packages/pipeline/src/phases/create-pr-phase.ts`. In the `run` method, after the `return this.ok({ pr: { id: existing.id ... } })` for the existing-PR case, add a log line. And after the final `createPR` call, add another. Replace the full `run` method:

```typescript
async run(ctx: PipelineContext): Promise<PhaseResult> {
  const commit = this.require<CommitPushResult>(ctx, "commit");
  const primary = ctx.productConfig.repos[0];
  if (!primary) return this.failed("product has no repos configured");

  const listRes = await ctx.providers.git.listPRs({
    owner: primary.owner,
    repo: primary.repo,
    head: `${primary.owner}:${commit.branch}`,
    state: "open",
    sessionId: ctx.sessionId,
  });
  if (listRes.error) {
    return this.failed(`listPRs preflight failed: ${listRes.error}`, "listPRs_error");
  }
  if (listRes.prs && listRes.prs.length > 0) {
    const existing = listRes.prs[0];
    await ctx.trace.log(ctx.sessionId, this.name, `PR already open: ${existing.url}`);
    return this.ok({
      pr: { id: existing.id, url: existing.url, number: existing.number },
    });
  }

  const res = unwrap(await ctx.providers.git.createPR({
    owner: primary.owner,
    repo: primary.repo,
    title: commit.title,
    body: commit.description,
    sourceBranch: commit.branch,
    targetBranch: primary.defaultBranch,
    sessionId: ctx.sessionId,
  }), "createPR");

  await ctx.trace.log(ctx.sessionId, this.name, `PR opened: ${res.url}`);

  return this.ok({
    pr: { id: res.id, url: res.url, number: res.number },
  });
}
```

- [ ] **Step 4: Type-check**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 5: Run all tests**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/pipeline/src/phases/checkout-repo-phase.ts packages/pipeline/src/phases/commit-push-phase.ts packages/pipeline/src/phases/create-pr-phase.ts
git commit -m "feat(pipeline): add trace logs to checkoutRepo, commitPush, and createPR phases"
```

---

## Manual Verification

Start the server and trigger a run:

```bash
# Terminal 1
npm start

# Terminal 2
curl -X POST http://localhost:3000/api/trigger/sam-portfolio \
  -H "Authorization: Bearer $JOURNEYMAN_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"ticketKey": "regojoyson/sam-portfolio#1"}'
```

Expected terminal output (Terminal 1):

```
journeyman pipeline-server listening on 3000
[run]    sam-portfolio · regojoyson/sam-portfolio#1 · started
[step]   → fetch-ticket
  [info] fetched: "Add dark mode" · status: Todo
[step]   ✓ fetch-ticket (312ms)
[step]   → clone
  [info] cloning: regojoyson/sam-portfolio
  [info] cloned 1 repo(s)
[step]   ✓ clone (8432ms)
...
```
