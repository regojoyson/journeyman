# Conductor Poll Config — Log Hygiene + Configurable Interval — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the worker's idle Conductor-poll log flood and make the poll interval an env-configurable value (`WORKER_POLL_INTERVAL_MS`, default 2000ms).

**Architecture:** Two tiny, independent code changes in `packages/orchestrator` plus their docs. (1) `ConductorClient.pollTask` drops its per-poll `request.start` line and demotes empty (`hasTask:false`) `request.end` lines from `debug` to `trace`, keeping productive polls at `debug` and failures at `error`. (2) A new pure helper `resolvePollIntervalMs(env)` reads `WORKER_POLL_INTERVAL_MS` (default 2000, guards against non-numeric/zero/negative), wired into `cli-worker.ts` in place of the hardcoded `500`. No change to task polling, dispatch, or completion logic.

**Tech Stack:** TypeScript (ESM, `.ts` import extensions), vitest 4 (zero-config), pino 10 logger from `@journeyman/core`.

**Spec:** [docs/superpowers/specs/2026-06-08-conductor-poll-logging-design.md](../specs/2026-06-08-conductor-poll-logging-design.md)

**Branch:** Work on a dedicated branch off `master` (e.g. `chore/conductor-poll-config`); the approved spec already lives on `master`. The execution skill / worktree setup handles branch creation.

---

## File Structure

| File | Create/Modify | Responsibility |
|---|---|---|
| `packages/orchestrator/package.json` | Modify | Add `"test": "vitest run"` script + `vitest` devDependency so orchestrator tests run under `npm test`. |
| `packages/orchestrator/src/workers/poll-interval.ts` | Create | Pure `resolvePollIntervalMs(env)` + `DEFAULT_POLL_INTERVAL_MS` constant. Single responsibility: parse the interval from env. |
| `packages/orchestrator/src/workers/poll-interval.test.ts` | Create | Unit tests for the helper. |
| `packages/orchestrator/src/cli-worker.ts` | Modify | Use `resolvePollIntervalMs()` instead of literal `500` (line 375); add import. |
| `packages/orchestrator/src/engines/conductor/conductor-client.ts` | Modify | `pollTask` log hygiene (lines ~128–145). |
| `packages/orchestrator/src/engines/conductor/conductor-client.poll-logging.test.ts` | Create | Unit tests asserting the new log levels. |
| `.env.example` | Modify | Document `WORKER_POLL_INTERVAL_MS` (after line 76). |
| `docs/constitution/DEPLOYMENT.md` | Modify | Add var to the Worker/orchestrator env-var row (line 58). |
| `packages/orchestrator/README.md` | Modify | Add env-table row (after line 53) + replace stale "500 ms" note (line 57). |

**Note — `worker-harness.ts` is intentionally NOT modified.** Per the spec, its defensive `?? 500` fallback in `loop()` stays; the live interval always comes from `cli-worker.ts`, so that fallback is unreachable in practice.

---

## Task 1: Wire vitest into the orchestrator package + capture test baseline

`packages/orchestrator/package.json` has only a `typecheck` script today — its 31 existing test files have never run under `npm test`. We capture their current state first (so any pre-existing breakage isn't blamed on this change), then add the `test` script.

**Files:**
- Modify: `packages/orchestrator/package.json`

- [ ] **Step 1: Capture the orchestrator test baseline (before any change)**

Run from repo root:
```bash
npx vitest run packages/orchestrator 2>&1 | tail -20
```
Expected: a summary line like `Test Files  N passed (M)` / `Tests  X passed | Y failed`. **Record the pass/fail counts** — this is the orchestrator baseline. (Repo-wide, the deps campaign already tracks 5 pre-existing failures; this captures the orchestrator slice specifically since these tests were previously unwired.)

- [ ] **Step 2: Add the `test` script**

In `packages/orchestrator/package.json`, change:
```json
  "scripts": {
    "typecheck": "tsc --noEmit"
  },
```
to:
```json
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
```

- [ ] **Step 3: Add the `vitest` devDependency**

In the same file's `devDependencies`, change:
```json
    "tsx": "^4.21.0",
    "typescript": "^6.0.3"
```
to:
```json
    "tsx": "^4.21.0",
    "typescript": "^6.0.3",
    "vitest": "^4.1.8"
```

- [ ] **Step 4: Install so the workspace picks up the dep**

Run from repo root:
```bash
npm install
```
Expected: completes without errors; `npm test -w @journeyman/orchestrator` is now a valid command (vitest was already hoisted, this just records the dependency).

- [ ] **Step 5: Verify the script runs and matches the baseline**

Run from repo root:
```bash
npm test -w @journeyman/orchestrator 2>&1 | tail -20
```
Expected: same pass/fail counts as Step 1's baseline (no new failures introduced by wiring alone).

- [ ] **Step 6: Commit**

```bash
git add packages/orchestrator/package.json package-lock.json
git commit -m "test(orchestrator): wire vitest run script + dep"
```

---

## Task 2: `resolvePollIntervalMs` helper (TDD)

A pure function so the interval-parsing logic is unit-testable without importing `cli-worker.ts` (which has top-level side effects).

**Files:**
- Create: `packages/orchestrator/src/workers/poll-interval.test.ts`
- Create: `packages/orchestrator/src/workers/poll-interval.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/orchestrator/src/workers/poll-interval.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { resolvePollIntervalMs, DEFAULT_POLL_INTERVAL_MS } from "./poll-interval.ts";

describe("resolvePollIntervalMs", () => {
  it("defaults to 2000 when the env var is unset", () => {
    expect(DEFAULT_POLL_INTERVAL_MS).toBe(2000);
    expect(resolvePollIntervalMs({})).toBe(2000);
  });

  it("parses a valid numeric string", () => {
    expect(resolvePollIntervalMs({ WORKER_POLL_INTERVAL_MS: "5000" })).toBe(5000);
  });

  it("falls back to the default for a non-numeric value", () => {
    expect(resolvePollIntervalMs({ WORKER_POLL_INTERVAL_MS: "abc" })).toBe(2000);
  });

  it("falls back to the default for zero or negative values", () => {
    expect(resolvePollIntervalMs({ WORKER_POLL_INTERVAL_MS: "0" })).toBe(2000);
    expect(resolvePollIntervalMs({ WORKER_POLL_INTERVAL_MS: "-100" })).toBe(2000);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run from repo root:
```bash
npx vitest run packages/orchestrator/src/workers/poll-interval.test.ts
```
Expected: FAIL — cannot resolve module `./poll-interval.ts` (file does not exist yet).

- [ ] **Step 3: Write the minimal implementation**

Create `packages/orchestrator/src/workers/poll-interval.ts`:
```ts
/**
 * Worker poll-interval resolution.
 *
 * Each registered step type runs its own poll loop; this value is how long
 * each loop sleeps between Conductor polls. Lower = faster step pickup but
 * more requests/log lines; higher = quieter and lighter but slower hops.
 */

/** Default poll interval (ms) when WORKER_POLL_INTERVAL_MS is unset or invalid. */
export const DEFAULT_POLL_INTERVAL_MS = 2000;

/**
 * Resolve the worker poll interval (ms) from the environment.
 *
 * Reads `WORKER_POLL_INTERVAL_MS`. Falls back to {@link DEFAULT_POLL_INTERVAL_MS}
 * when the value is unset, non-numeric, or non-positive (a non-positive value
 * would otherwise turn the poll loop into a busy-loop).
 */
export function resolvePollIntervalMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const n = Number(env.WORKER_POLL_INTERVAL_MS);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_POLL_INTERVAL_MS;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run from repo root:
```bash
npx vitest run packages/orchestrator/src/workers/poll-interval.test.ts
```
Expected: PASS — 4 tests passing.

- [ ] **Step 5: Commit**

```bash
git add packages/orchestrator/src/workers/poll-interval.ts packages/orchestrator/src/workers/poll-interval.test.ts
git commit -m "feat(orchestrator): configurable worker poll interval helper"
```

---

## Task 3: Wire the helper into `cli-worker.ts`

No unit test — importing `cli-worker.ts` executes the whole worker (top-level await, starts poll loops). The parsing logic is already covered by Task 2; this task is verified by typecheck.

**Files:**
- Modify: `packages/orchestrator/src/cli-worker.ts` (import block ~line 35; `pollIntervalMs` at line 375)

- [ ] **Step 1: Add the import**

In `packages/orchestrator/src/cli-worker.ts`, immediately after the line:
```ts
import { WorkerHarness } from "./workers/worker-harness.ts";
```
add:
```ts
import { resolvePollIntervalMs } from "./workers/poll-interval.ts";
```

- [ ] **Step 2: Replace the hardcoded interval**

In the same file, change line 375:
```ts
  pollIntervalMs: 500,
```
to:
```ts
  pollIntervalMs: resolvePollIntervalMs(),
```

- [ ] **Step 3: Typecheck**

Run from repo root:
```bash
npm run typecheck -w @journeyman/orchestrator
```
Expected: PASS (no type errors).

- [ ] **Step 4: Commit**

```bash
git add packages/orchestrator/src/cli-worker.ts
git commit -m "feat(orchestrator): read WORKER_POLL_INTERVAL_MS (default 2000ms)"
```

---

## Task 4: `pollTask` log hygiene (TDD)

**Files:**
- Create: `packages/orchestrator/src/engines/conductor/conductor-client.poll-logging.test.ts`
- Modify: `packages/orchestrator/src/engines/conductor/conductor-client.ts` (`pollTask`, lines ~128–145)

- [ ] **Step 1: Write the failing test**

Create `packages/orchestrator/src/engines/conductor/conductor-client.poll-logging.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockDebug = vi.fn();
const mockTrace = vi.fn();
const mockError = vi.fn();

// Mock the logger before importing the module under test so the module-level
// `createLogger("conductor:client")` call returns our spy.
vi.mock("@journeyman/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@journeyman/core")>();
  return {
    ...actual,
    createLogger: () => ({
      debug: mockDebug,
      trace: mockTrace,
      error: mockError,
      info: vi.fn(),
      warn: vi.fn(),
    }),
  };
});

const { ConductorClient } = await import("./conductor-client.ts");

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

const TASK = {
  taskId: "t-1",
  workflowInstanceId: "wf-1",
  taskDefName: "clone-repos",
  referenceTaskName: "node-1",
  inputData: {},
  retryCount: 0,
};

beforeEach(() => {
  mockDebug.mockClear();
  mockTrace.mockClear();
  mockError.mockClear();
});

describe("ConductorClient.pollTask logging", () => {
  it("logs an empty poll at trace, never debug", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    const client = new ConductorClient({ baseUrl: "http://c/api", fetchImpl });

    const r = await client.pollTask("clone-repos", "worker-1");

    expect(r).toBeNull();
    expect(mockTrace).toHaveBeenCalledTimes(1);
    expect(mockTrace).toHaveBeenCalledWith(
      expect.objectContaining({ stepType: "clone-repos", workerId: "worker-1", hasTask: false }),
      "conductor.poll.request.end",
    );
    expect(mockDebug).not.toHaveBeenCalled();
  });

  it("logs a productive poll at debug, never trace", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(TASK));
    const client = new ConductorClient({ baseUrl: "http://c/api", fetchImpl });

    const r = await client.pollTask("clone-repos", "worker-1");

    expect(r).toMatchObject({ taskId: "t-1" });
    expect(mockDebug).toHaveBeenCalledTimes(1);
    expect(mockDebug).toHaveBeenCalledWith(
      expect.objectContaining({ stepType: "clone-repos", workerId: "worker-1", hasTask: true }),
      "conductor.poll.request.end",
    );
    expect(mockTrace).not.toHaveBeenCalled();
  });

  it("never emits a request.start line", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(TASK));
    const client = new ConductorClient({ baseUrl: "http://c/api", fetchImpl });

    await client.pollTask("clone-repos", "worker-1");

    const startCalls = [...mockDebug.mock.calls, ...mockTrace.mock.calls]
      .filter((call) => call[1] === "conductor.poll.request.start");
    expect(startCalls).toHaveLength(0);
  });

  it("logs failures at error and rethrows", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("boom"));
    const client = new ConductorClient({ baseUrl: "http://c/api", fetchImpl });

    await expect(client.pollTask("clone-repos", "worker-1")).rejects.toThrow("boom");
    expect(mockError).toHaveBeenCalledWith(
      expect.objectContaining({ stepType: "clone-repos", workerId: "worker-1" }),
      "conductor.poll.request.failed",
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run from repo root:
```bash
npx vitest run packages/orchestrator/src/engines/conductor/conductor-client.poll-logging.test.ts
```
Expected: FAIL — current code emits `request.start` at debug and logs the empty `request.end` at `debug` (not `trace`), so the "empty → trace, never debug" and "never emits request.start" tests fail.

- [ ] **Step 3: Rewrite `pollTask`**

In `packages/orchestrator/src/engines/conductor/conductor-client.ts`, replace the existing `pollTask` method (currently lines ~128–145):
```ts
  async pollTask(taskType: string, workerId: string): Promise<PolledTask | null> {
    const reqStart = Date.now();
    log.debug({ stepType: taskType, workerId }, "conductor.poll.request.start");
    try {
      const r = await this.request<PolledTask | null>(
        `/tasks/poll/${encodeURIComponent(taskType)}?workerid=${encodeURIComponent(workerId)}`,
      );
      log.debug({
        stepType: taskType, workerId, hasTask: !!r, durationMs: Date.now() - reqStart,
      }, "conductor.poll.request.end");
      return r ?? null;
    } catch (err) {
      log.error({
        stepType: taskType, workerId, err, durationMs: Date.now() - reqStart,
      }, "conductor.poll.request.failed");
      throw err;
    }
  }
```
with:
```ts
  async pollTask(taskType: string, workerId: string): Promise<PolledTask | null> {
    const reqStart = Date.now();
    try {
      const r = await this.request<PolledTask | null>(
        `/tasks/poll/${encodeURIComponent(taskType)}?workerid=${encodeURIComponent(workerId)}`,
      );
      const fields = {
        stepType: taskType, workerId, hasTask: !!r, durationMs: Date.now() - reqStart,
      };
      // Empty polls are pure idle noise (one per step type, every interval) —
      // keep them at `trace` so `debug` stays useful. A real pickup is worth
      // a `debug` line. The old per-poll `request.start` line is dropped: it
      // carried nothing the `request.end` line lacks.
      if (r) log.debug(fields, "conductor.poll.request.end");
      else log.trace(fields, "conductor.poll.request.end");
      return r ?? null;
    } catch (err) {
      log.error({
        stepType: taskType, workerId, err, durationMs: Date.now() - reqStart,
      }, "conductor.poll.request.failed");
      throw err;
    }
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run from repo root:
```bash
npx vitest run packages/orchestrator/src/engines/conductor/conductor-client.poll-logging.test.ts
```
Expected: PASS — 4 tests passing.

- [ ] **Step 5: Commit**

```bash
git add packages/orchestrator/src/engines/conductor/conductor-client.ts packages/orchestrator/src/engines/conductor/conductor-client.poll-logging.test.ts
git commit -m "fix(orchestrator): quiet idle Conductor poll logs (trace empty, drop start)"
```

---

## Task 5: Document `WORKER_POLL_INTERVAL_MS`

**Files:**
- Modify: `.env.example`
- Modify: `docs/constitution/DEPLOYMENT.md`
- Modify: `packages/orchestrator/README.md`

- [ ] **Step 1: Add to `.env.example`**

In `.env.example`, after the line:
```
# CONDUCTOR_BASE_URL=http://localhost:8080/api
```
add:
```
# Interval (ms) each step-type loop waits between Conductor polls.
# Lower = faster step pickup but more requests/logs. Default 2000.
# WORKER_POLL_INTERVAL_MS=2000
```

- [ ] **Step 2: Add to `docs/constitution/DEPLOYMENT.md`**

Change the line (line 58):
```
| `WORKER_ID`, `RUN_SYNC_INTERVAL_MS`, `CYCLE_VISIT_LIMIT`, `CONDUCTOR_BASE_URL` | Worker / orchestrator. |
```
to:
```
| `WORKER_ID`, `RUN_SYNC_INTERVAL_MS`, `CYCLE_VISIT_LIMIT`, `WORKER_POLL_INTERVAL_MS`, `CONDUCTOR_BASE_URL` | Worker / orchestrator. |
```

- [ ] **Step 3: Add the env-table row in `packages/orchestrator/README.md`**

Change the line (line 53):
```
| `WORKER_ID` | Worker identifier sent to Conductor (visible in its UI) | `worker-<pid>` |
```
to:
```
| `WORKER_ID` | Worker identifier sent to Conductor (visible in its UI) | `worker-<pid>` |
| `WORKER_POLL_INTERVAL_MS` | Interval (ms) each step-type loop waits between Conductor polls | `2000` |
```

- [ ] **Step 4: Replace the stale poll-interval note in `packages/orchestrator/README.md`**

Change the line (line 57):
```
The worker poll interval is 500 ms; tune in [cli-worker.ts](src/cli-worker.ts) if needed.
```
to:
```
The worker poll interval defaults to 2000 ms; override per environment with `WORKER_POLL_INTERVAL_MS` (lower = faster step pickup but more requests/logs).
```

- [ ] **Step 5: Commit**

```bash
git add .env.example docs/constitution/DEPLOYMENT.md packages/orchestrator/README.md
git commit -m "docs: document WORKER_POLL_INTERVAL_MS env var"
```

---

## Task 6: Full verification (no-regression gate)

**Files:** none (verification only)

- [ ] **Step 1: Typecheck + import boundaries**

Run from repo root:
```bash
npm run check
```
Expected: PASS for both typecheck and `check:boundaries`. (If `npm run check` doesn't chain both, run `npm run typecheck` and `npm run check:boundaries` separately — both must pass.)

- [ ] **Step 2: Run the orchestrator suite**

Run from repo root:
```bash
npm test -w @journeyman/orchestrator 2>&1 | tail -25
```
Expected: the new tests in `poll-interval.test.ts` (4) and `conductor-client.poll-logging.test.ts` (4) PASS, and the pass/fail counts otherwise match the Task 1 Step 1 baseline (no new regressions). If a previously-unwired orchestrator test now fails, confirm via `git stash` that it also fails on the baseline before this branch — pre-existing failures are out of scope for this change; note them but do not fix here.

- [ ] **Step 3: Manual smoke (optional, if a worker can be run)**

If the dev stack is available, start a worker at debug and confirm idle polls no longer flood:
```bash
LOG_LEVEL=debug npm run start:worker
```
Expected: no `conductor.poll.request.start` lines, and no `conductor.poll.request.end` lines with `hasTask:false` at debug (they only appear at `LOG_LEVEL=trace`). Productive pickups and errors still log. Stop with Ctrl-C. Skip this step if infra isn't running.

- [ ] **Step 4: Final confirmation**

Confirm the branch is clean and all commits are present:
```bash
git status
git log --oneline -6
```
Expected: clean working tree; commits for Tasks 1–5 present.

---

## Self-Review Notes (author)

- **Spec coverage:** Change 1 (log hygiene) → Task 4. Change 2 (configurable interval) → Tasks 2+3. Change 3 (docs) → Task 5. Spec "Testing" items 1–3 → Task 4 tests; item 4 → Task 2 tests. All covered.
- **Out-of-scope respected:** `worker-harness.ts` untouched (keeps `?? 500` defensive fallback per spec); no Conductor-server/`conductor.properties` edits; no long-polling.
- **Type consistency:** `resolvePollIntervalMs` / `DEFAULT_POLL_INTERVAL_MS` names match between Task 2 (definition + test) and Task 3 (import). `pollTask` signature unchanged.
- **Baseline caveat surfaced:** orchestrator tests were previously unwired; Task 1 captures their baseline so this change isn't blamed for pre-existing failures (Task 6 Step 2).
