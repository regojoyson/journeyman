# Retry Failed Runs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Retry button to failed pipeline runs that re-executes from the first failed step, preserving all previously-completed step artifacts.

**Architecture:** Add `pipeline.retry(sessionId)` in the backend that finds the first failed step in `run.steps`, strips failed/subsequent step records, then re-runs from that step forward using the frozen `flowSnapshot` (same pattern as `resume()`). Wire it through a new `POST /api/runs/:sessionId/retry` endpoint and a Retry button in the RunDetail UI.

**Tech Stack:** Node.js / TypeScript (pipeline), Fastify (HTTP server), React + TanStack Query (UI)

---

## File Map

| Action | File | Purpose |
|--------|------|---------|
| Modify | `packages/pipeline/src/pipeline.ts` | Add `retry()` method |
| Create | `packages/pipeline-server/src/api/retry.ts` | `POST /api/runs/:sessionId/retry` endpoint |
| Modify | `packages/pipeline-server/src/http-server.ts` | Register retry API |
| Modify | `packages/ui/src/api/client.ts` | Add `retryRun()` fetch function |
| Modify | `packages/ui/src/api/runs.ts` | Add `useRetryRun()` React Query hook |
| Modify | `packages/ui/src/components/runs/RunDetail.tsx` | Add Retry button for failed runs |

---

### Task 1: `pipeline.retry()` — core method

**Files:**
- Modify: `packages/pipeline/src/pipeline.ts` (after `resume()` at line 387)

- [ ] **Step 1: Write the failing test**

Create `packages/pipeline/src/pipeline.retry.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Pipeline } from "./pipeline.ts";
import type { PipelineRun, FlowDefinition, StepRecord } from "@journeyman/core";

function makeFlow(): FlowDefinition {
  return {
    name: "test-flow",
    providers: {},
    steps: [
      { id: "step-a", phase: "phaseA" },
      { id: "step-b", phase: "phaseB" },
      { id: "step-c", phase: "phaseC" },
    ],
  };
}

function makeRun(overrides: Partial<PipelineRun> = {}): PipelineRun {
  const flow = makeFlow();
  return {
    sessionId: "ses-1",
    productId: "prod-1",
    ticketKey: "T-1",
    ticketShortKey: "1",
    flowName: "test-flow",
    flowSnapshot: flow,
    status: "failed",
    currentStep: null,
    steps: [
      { id: "step-a", phase: "phaseA", attempt: 1, status: "ok",
        startedAt: "2024-01-01T00:00:00Z", endedAt: "2024-01-01T00:00:01Z", durationMs: 1000,
        output: { result: "a-done" } },
      { id: "step-b", phase: "phaseB", attempt: 1, status: "failed",
        startedAt: "2024-01-01T00:00:01Z", endedAt: "2024-01-01T00:00:02Z", durationMs: 1000,
        error: { message: "network error" } },
    ] as StepRecord[],
    artifacts: { result: "a-done" },
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:02Z",
    ...overrides,
  };
}

function makeDeps(run: PipelineRun, phaseResults: Record<string, { status: "ok" | "failed" }> = {}) {
  const saved: PipelineRun[] = [];
  const phaseB = { run: vi.fn().mockResolvedValue({ status: "ok", artifacts: { result: "b-done" } }) };
  const phaseC = { run: vi.fn().mockResolvedValue({ status: "ok", artifacts: { result: "c-done" } }) };
  if (phaseResults["phaseB"]) phaseB.run.mockResolvedValue({ ...phaseResults["phaseB"], artifacts: {} });
  if (phaseResults["phaseC"]) phaseC.run.mockResolvedValue({ ...phaseResults["phaseC"], artifacts: {} });

  return {
    saved,
    deps: {
      phases: { resolve: (name: string) => name === "phaseB" ? phaseB : phaseC },
      state: {
        load: vi.fn().mockResolvedValue(run),
        save: vi.fn().mockImplementation(async (r: PipelineRun) => { saved.push(structuredClone(r)); }),
      },
      trace: { log: vi.fn() },
      artifactStore: {} as any,
      bus: { publish: vi.fn() },
      resolveProviders: vi.fn().mockReturnValue({}),
      getProductConfig: vi.fn().mockReturnValue({
        flow: "test-flow", workspace: "/tmp", repos: [],
      }),
      cleanupOn: [],
    } as any,
  };
}

describe("Pipeline.retry()", () => {
  it("throws if run does not exist", async () => {
    const { deps } = makeDeps(makeRun());
    deps.state.load = vi.fn().mockResolvedValue(null);
    const p = new Pipeline(deps);
    await expect(p.retry("ses-1")).rejects.toThrow("no such run ses-1");
  });

  it("throws if run is not failed", async () => {
    const run = makeRun({ status: "blocked" });
    const { deps } = makeDeps(run);
    const p = new Pipeline(deps);
    await expect(p.retry("ses-1")).rejects.toThrow("cannot retry ses-1: status=blocked");
  });

  it("re-runs from the first failed step, preserving ok-step artifacts", async () => {
    const run = makeRun();
    const { deps, saved } = makeDeps(run);
    const p = new Pipeline(deps);

    const result = await p.retry("ses-1");

    expect(result.status).toBe("completed");
    // step-a record preserved, step-b and step-c added fresh
    const stepIds = result.steps.map(s => s.id);
    expect(stepIds).toEqual(["step-a", "step-b", "step-c"]);
    // artifacts from step-a still present
    expect(result.artifacts).toMatchObject({ result: "a-done" });
  });

  it("removes failed step records before re-running", async () => {
    const run = makeRun();
    const { deps } = makeDeps(run);
    const p = new Pipeline(deps);
    await p.retry("ses-1");
    // The run saved at start of retry should only have ok steps
    const firstSave = deps.state.save.mock.calls[0][0] as PipelineRun;
    expect(firstSave.steps.every((s: StepRecord) => s.status === "ok")).toBe(true);
  });

  it("ends as failed when retry step fails again", async () => {
    const run = makeRun();
    const { deps } = makeDeps(run, { phaseB: { status: "failed" } });
    const p = new Pipeline(deps);
    const result = await p.retry("ses-1");
    expect(result.status).toBe("failed");
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd /Users/admin/data/workspace/claude-skils/journeyman
npx vitest run packages/pipeline/src/pipeline.retry.test.ts 2>&1 | tail -20
```

Expected: FAIL — `Pipeline.retry is not a function`

- [ ] **Step 3: Implement `retry()` in pipeline.ts**

Open `packages/pipeline/src/pipeline.ts`. Add this method after `resume()` (after line 387, before the closing `}`):

```typescript
async retry(sessionId: string): Promise<PipelineRun> {
  log.info({ sessionId }, "run retry requested");
  const run = await this.deps.state.load(sessionId);
  if (!run) throw new Error(`no such run ${sessionId}`);
  if (run.status !== "failed") throw new Error(`cannot retry ${sessionId}: status=${run.status}`);

  const productConfig = this.deps.getProductConfig(run.productId);
  const flow = run.flowSnapshot;
  const workspaceDir = join(productConfig.workspace, "runs", sessionId);
  mkdirSync(workspaceDir, { recursive: true });

  // Find first failed step and its index in the flow snapshot.
  const failedRec = run.steps.find(s => s.status === "failed");
  if (!failedRec) throw new Error(`retry: no failed step in run ${sessionId}`);
  const flowIdx = flow.steps.findIndex(s => s.id === failedRec.id);
  if (flowIdx < 0) throw new Error(`retry: failed step "${failedRec.id}" not in flow snapshot`);

  // Strip failed step and any steps that came after it so they re-run fresh.
  run.steps = run.steps.filter(s => s.status === "ok");

  const now = () => new Date().toISOString();
  const from = run.status;
  run.status = "running";
  run.updatedAt = now();
  await this.deps.state.save(run);
  this.emit({ type: "statusChanged", sessionId, from, to: "running", at: now() });

  const ac = new AbortController();
  this.aborters.set(sessionId, ac);
  const providers = this.deps.resolveProviders(flow, productConfig);
  const ctx = buildContext({
    run, signal: ac.signal, workspaceDir, productConfig, providers,
    trace: this.deps.trace, artifactStore: this.deps.artifactStore,
    emit: (e) => this.emit(e),
  });

  try {
    for (const step of flow.steps.slice(flowIdx)) {
      if (ac.signal.aborted) { await this.finish(run, "cancelled"); return run; }
      const result = await this.runStepWithAttempts(run, step, ctx, ac.signal);
      if (ac.signal.aborted) { await this.finish(run, "cancelled"); return run; }
      if (result.status === "blocked") { await this.finish(run, "blocked"); return run; }
      if (result.status === "failed") {
        const onFail = step.onFailure ?? "fail";
        if (onFail === "skip") continue;
        if (onFail === "block") { await this.finish(run, "blocked"); return run; }
        await this.finish(run, "failed");
        return run;
      }
    }
    await this.finish(run, "completed");
    return run;
  } finally {
    this.aborters.delete(sessionId);
    if ((this.deps.cleanupOn ?? []).includes(run.status)) {
      try { rmSync(workspaceDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd /Users/admin/data/workspace/claude-skils/journeyman
npx vitest run packages/pipeline/src/pipeline.retry.test.ts 2>&1 | tail -20
```

Expected: PASS — 5 tests pass

- [ ] **Step 5: Commit**

```bash
cd /Users/admin/data/workspace/claude-skils/journeyman
git add packages/pipeline/src/pipeline.ts packages/pipeline/src/pipeline.retry.test.ts
git commit -m "feat: add Pipeline.retry() to re-run from first failed step"
```

---

### Task 2: HTTP endpoint `POST /api/runs/:sessionId/retry`

**Files:**
- Create: `packages/pipeline-server/src/api/retry.ts`
- Modify: `packages/pipeline-server/src/http-server.ts`

- [ ] **Step 1: Create `packages/pipeline-server/src/api/retry.ts`**

```typescript
/**
 * @file retry.ts
 * POST /api/runs/:sessionId/retry — retry a failed pipeline run from its first failed step.
 */

import type { FastifyInstance } from "fastify";

export type RetryApiDeps = {
  pipeline: { retry(sessionId: string): Promise<any> };
};

export function registerRetryApi(app: FastifyInstance, deps: RetryApiDeps) {
  app.post<{ Params: { sessionId: string } }>(
    "/api/runs/:sessionId/retry",
    async (req, reply) => {
      try {
        const run = await deps.pipeline.retry(req.params.sessionId);
        return reply.send(run);
      } catch (err: any) {
        return reply.code(409).send({ error: err.message });
      }
    },
  );
}
```

- [ ] **Step 2: Register in `packages/pipeline-server/src/http-server.ts`**

Add import after line 42 (`import { registerResumeApi ...`):

```typescript
import { registerRetryApi } from "./api/retry.ts";
```

Add registration after `registerResumeApi(...)` (line 90):

```typescript
registerRetryApi(app, { pipeline: deps.pipeline as any });
```

- [ ] **Step 3: Type-check**

```bash
cd /Users/admin/data/workspace/claude-skils/journeyman
npm run typecheck 2>&1 | grep -E "error|Error" | head -20
```

Expected: no errors

- [ ] **Step 4: Commit**

```bash
cd /Users/admin/data/workspace/claude-skils/journeyman
git add packages/pipeline-server/src/api/retry.ts packages/pipeline-server/src/http-server.ts
git commit -m "feat: add POST /api/runs/:sessionId/retry endpoint"
```

---

### Task 3: UI — API client + React Query hook

**Files:**
- Modify: `packages/ui/src/api/client.ts`
- Modify: `packages/ui/src/api/runs.ts`

- [ ] **Step 1: Add `retryRun()` to `packages/ui/src/api/client.ts`**

Add after the `resumeRun` function (after line 121):

```typescript
export async function retryRun(sessionId: string): Promise<void> {
  const res = await fetch(`/api/runs/${encodeURIComponent(sessionId)}/retry`, {
    method: 'POST',
    headers: headers(),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`API ${res.status}: ${res.statusText} — ${body.slice(0, 200)}`);
  }
}
```

- [ ] **Step 2: Add `useRetryRun()` hook to `packages/ui/src/api/runs.ts`**

Add the import for `retryRun` alongside existing imports at line 2:

```typescript
import { getRuns, getRunDetail, getRunLogs, cancelRun, getFlows, getProviders, getHealth, createRun, deleteRun, resumeRun, retryRun, getProducts } from './client';
```

Add the hook after `useResumeRun()`:

```typescript
export function useRetryRun() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) => retryRun(sessionId),
    onSuccess: (_data, sessionId) => {
      queryClient.invalidateQueries({ queryKey: RUNS_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: DETAIL_KEY(sessionId) });
    },
  });
}
```

- [ ] **Step 3: Type-check**

```bash
cd /Users/admin/data/workspace/claude-skils/journeyman
npm run typecheck 2>&1 | grep -E "error|Error" | head -20
```

Expected: no errors

- [ ] **Step 4: Commit**

```bash
cd /Users/admin/data/workspace/claude-skils/journeyman
git add packages/ui/src/api/client.ts packages/ui/src/api/runs.ts
git commit -m "feat: add retryRun client function and useRetryRun hook"
```

---

### Task 4: UI — Retry button in RunDetail

**Files:**
- Modify: `packages/ui/src/components/runs/RunDetail.tsx`

- [ ] **Step 1: Import `useRetryRun` and `RotateCcw` icon**

In `packages/ui/src/components/runs/RunDetail.tsx`, update line 2:

```typescript
import { useRunDetail, useLogs, useCancelRun, useDeleteRun, useResumeRun, useRetryRun } from '@/api/runs';
```

Update the lucide-react import on line 8 to include `RotateCcw`:

```typescript
import { ArrowLeft, Loader2, Clock, GitBranch, Tag, Calendar, XCircle, Trash2, PlayCircle, RotateCcw } from 'lucide-react';
```

- [ ] **Step 2: Add `useRetryRun` call alongside other mutation hooks**

After line 24 (`const resumeRun = useResumeRun();`), add:

```typescript
const retryRun = useRetryRun();
```

- [ ] **Step 3: Add Retry button in the actions section**

In the actions block (currently starts at line 118 with `{run.status === 'blocked' && ...}`), add the retry button **after** the blocked/resume block and **before** the cancel button:

```tsx
{run.status === 'failed' && (
  <button
    onClick={() => retryRun.mutate(run.sessionId)}
    disabled={retryRun.isPending}
    className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-600 disabled:opacity-60"
  >
    {retryRun.isPending
      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
      : <RotateCcw className="h-3.5 w-3.5" />}
    Retry
  </button>
)}
```

- [ ] **Step 4: Type-check**

```bash
cd /Users/admin/data/workspace/claude-skils/journeyman
npm run typecheck 2>&1 | grep -E "error|Error" | head -20
```

Expected: no errors

- [ ] **Step 5: Commit**

```bash
cd /Users/admin/data/workspace/claude-skils/journeyman
git add packages/ui/src/components/runs/RunDetail.tsx
git commit -m "feat: add Retry button for failed runs in RunDetail"
```

---

## Self-Review

**Spec coverage:**
- ✅ `Pipeline.retry()` finds the first failed step and re-runs from there
- ✅ Completed step records and artifacts are preserved
- ✅ `POST /api/runs/:sessionId/retry` endpoint wired with 409 on error
- ✅ `retryRun()` client function + `useRetryRun()` hook
- ✅ Retry button visible only when `run.status === 'failed'`
- ✅ Button shows spinner while pending, invalidates run queries on success

**Placeholder scan:** No TODOs or TBDs — all code blocks are complete.

**Type consistency:**
- `retry(sessionId: string): Promise<PipelineRun>` — consistent across pipeline.ts, test, and API handler
- `retryRun(sessionId: string): Promise<void>` — consistent in client.ts and hook
- `useRetryRun()` mutation input is `string` (sessionId) — consistent with `useCancelRun()`
