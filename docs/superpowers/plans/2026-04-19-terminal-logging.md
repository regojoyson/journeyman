# Terminal Logging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Print step lifecycle events and key phase trace lines to stdout as the pipeline runs so the full flow is traceable in the terminal.

**Architecture:** A `subscribeAll` global listener is added to `EventBus`; `FileTraceLogger` emits `logLine` events after each disk write; a new `console-logger.ts` subscribes globally and prints formatted output for all lifecycle and logLine events. Seven phases get minimal `ctx.trace.log()` calls for key milestones.

**Tech Stack:** TypeScript, Node.js — no new dependencies.

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

---

### Task 1: Add `subscribeAll` to EventBus

**Files:**
- Modify: `packages/pipeline/src/event-bus.ts`

- [ ] **Step 1: Replace event-bus.ts**

Open `packages/pipeline/src/event-bus.ts`. Replace the entire file:

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

- [ ] **Step 2: Type-check**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/pipeline/src/event-bus.ts
git commit -m "feat(pipeline): add EventBus.subscribeAll for global event listening"
```

---

### Task 2: Add `productId` to `runStarted` / `runEnded` events

**Files:**
- Modify: `packages/core/src/types/pipeline.types.ts`
- Modify: `packages/pipeline/src/pipeline.ts`

- [ ] **Step 1: Update PipelineEvent union in core**

Open `packages/core/src/types/pipeline.types.ts`. Find the `PipelineEvent` type and replace it:

```typescript
export type PipelineEvent =
  | { type: "runStarted";    sessionId: string; productId: string; ticketKey: string; flowName: string; at: string }
  | { type: "stepStarted";   sessionId: string; stepId: string; phase: string; attempt: number; at: string }
  | { type: "stepEnded";     sessionId: string; stepId: string; phase: string; attempt: number; status: StepRecord["status"]; durationMs: number; at: string }
  | { type: "logLine";       sessionId: string; stepId: string; level: "info"|"warn"|"error"; line: string; at: string }
  | { type: "statusChanged"; sessionId: string; from: PipelineRun["status"]; to: PipelineRun["status"]; at: string }
  | { type: "runEnded";      sessionId: string; productId: string; status: PipelineRun["status"]; at: string };
```

- [ ] **Step 2: Fix `runStarted` publish in pipeline.ts**

Open `packages/pipeline/src/pipeline.ts`. Find this line (around line 90):

```typescript
this.emit({ type: "runStarted", sessionId, ticketKey: run.ticketKey, flowName: run.flowName, at: now() });
```

Change to:

```typescript
this.emit({ type: "runStarted", sessionId, productId: run.productId, ticketKey: run.ticketKey, flowName: run.flowName, at: now() });
```

- [ ] **Step 3: Fix `runEnded` publish in pipeline.ts**

In the same file, find the `runEnded` publish call (near the `finish` method):

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

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/types/pipeline.types.ts packages/pipeline/src/pipeline.ts
git commit -m "feat(core): add productId to runStarted and runEnded pipeline events"
```

---

### Task 3: Update `FileTraceLogger` to emit `logLine` events

**Files:**
- Modify: `packages/pipeline/src/state/file-trace-logger.ts`

- [ ] **Step 1: Replace file-trace-logger.ts**

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

- [ ] **Step 2: Type-check**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/pipeline/src/state/file-trace-logger.ts
git commit -m "feat(pipeline): FileTraceLogger emits logLine events to EventBus"
```

---

### Task 4: Create `console-logger.ts`

**Files:**
- Create: `packages/pipeline-server/src/console-logger.ts`

- [ ] **Step 1: Create the file**

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
        console.log(`[step]   ✗ ${e.stepId} — ${e.status}`);
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

Expected: no errors. If `EventBus` is not exported from `@journeyman/pipeline`, open `packages/pipeline/src/index.ts` and verify `export { EventBus } from "./event-bus.ts";` is present.

- [ ] **Step 3: Commit**

```bash
git add packages/pipeline-server/src/console-logger.ts
git commit -m "feat(pipeline-server): add console-logger for terminal output"
```

---

### Task 5: Wire `main.ts`

**Files:**
- Modify: `packages/pipeline-server/src/main.ts`

- [ ] **Step 1: Add import**

Open `packages/pipeline-server/src/main.ts`. Add after existing imports:

```typescript
import { subscribeConsoleLogger } from "./console-logger.ts";
```

- [ ] **Step 2: Pass `bus` to `FileTraceLogger`**

Find:

```typescript
const trace = new FileTraceLogger(workspacesRoot, productIdResolver);
```

Change to:

```typescript
const trace = new FileTraceLogger(workspacesRoot, productIdResolver, bus);
```

- [ ] **Step 3: Call `subscribeConsoleLogger`**

Immediately after `const bus = new EventBus();` add:

```typescript
subscribeConsoleLogger(bus);
```

- [ ] **Step 4: Type-check**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/pipeline-server/src/main.ts
git commit -m "feat(pipeline-server): wire console logger and EventBus into FileTraceLogger"
```

---

### Task 6: Add trace calls to `getTicket` and `updateStatus` phases

**Files:**
- Modify: `packages/pipeline/src/phases/get-ticket-phase.ts`
- Modify: `packages/pipeline/src/phases/update-status-phase.ts`

- [ ] **Step 1: Update `get-ticket-phase.ts` run method**

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

- [ ] **Step 2: Update `update-status-phase.ts` run method**

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

- [ ] **Step 4: Commit**

```bash
git add packages/pipeline/src/phases/get-ticket-phase.ts packages/pipeline/src/phases/update-status-phase.ts
git commit -m "feat(pipeline): add trace logs to getTicket and updateStatus phases"
```

---

### Task 7: Add trace calls to `cloneRepos` and `cleanupRepos` phases

**Files:**
- Modify: `packages/pipeline/src/phases/clone-repos-phase.ts`
- Modify: `packages/pipeline/src/phases/cleanup-repos-phase.ts`

- [ ] **Step 1: Update `clone-repos-phase.ts` run method**

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

- [ ] **Step 2: Update `cleanup-repos-phase.ts` run method**

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

- [ ] **Step 4: Commit**

```bash
git add packages/pipeline/src/phases/clone-repos-phase.ts packages/pipeline/src/phases/cleanup-repos-phase.ts
git commit -m "feat(pipeline): add trace logs to cloneRepos and cleanupRepos phases"
```

---

### Task 8: Add trace calls to `checkoutRepo`, `commitPush`, and `createPR` phases

**Files:**
- Modify: `packages/pipeline/src/phases/checkout-repo-phase.ts`
- Modify: `packages/pipeline/src/phases/commit-push-phase.ts`
- Modify: `packages/pipeline/src/phases/create-pr-phase.ts`

- [ ] **Step 1: Update `checkout-repo-phase.ts` run method**

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

- [ ] **Step 2: Update `commit-push-phase.ts` run method**

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

- [ ] **Step 3: Update `create-pr-phase.ts` run method**

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

- [ ] **Step 5: Commit**

```bash
git add packages/pipeline/src/phases/checkout-repo-phase.ts packages/pipeline/src/phases/commit-push-phase.ts packages/pipeline/src/phases/create-pr-phase.ts
git commit -m "feat(pipeline): add trace logs to checkoutRepo, commitPush, and createPR phases"
```

---

## Manual Verification

```bash
# Terminal 1
npm start

# Terminal 2
curl -X POST http://localhost:3000/api/trigger/sam-portfolio \
  -H "Authorization: Bearer $JOURNEYMAN_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"ticketKey": "regojoyson/sam-portfolio#1"}'
```

Expected terminal output:

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
[run]    sam-portfolio · completed
```
