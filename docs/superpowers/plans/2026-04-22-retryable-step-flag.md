# Per-Step Retryable Flag Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `retryable?: boolean` flag to flow step definitions so the manual retry API only works when the failed step explicitly opts in.

**Architecture:** Add the field to `FlowStepDefinition` (core type + Zod schema), then gate `Pipeline.retry()` on it — if the failed step lacks `retryable: true`, throw a 409-worthy error before any state mutation. Wire a new `POST /api/runs/:sessionId/retry` Fastify endpoint and a Retry button in the React UI. Update YAML flows and docs in parallel with the code work.

**Tech Stack:** TypeScript, Zod (`@journeyman/pipeline`), Fastify (`@journeyman/pipeline-server`), React + TanStack Query (`@journeyman/ui`)

---

## Execution Order

```
Group 1 (parallel) ──┬── Task 1: types + schema
                     └── Task 2: YAML flows + docs
                           ↓
                     Task 3: Pipeline.retry()
                           ↓
Group 2 (parallel) ──┬── Task 4: HTTP endpoint
                     └── Task 5: UI (client + hook + button)
                           ↓
                     Task 6: typecheck
```

---

## File Map

| Action | File | Purpose |
|--------|------|---------|
| Modify | `packages/core/src/types/pipeline.types.ts` | Add `retryable?: boolean` to `FlowStepDefinition` |
| Modify | `packages/pipeline/src/config/flow-schema.ts` | Add `retryable` to Zod step schema |
| Modify | `packages/pipeline/src/pipeline.ts` | Add `retry()` method with retryability gate |
| Create | `packages/pipeline-server/src/api/retry.ts` | `POST /api/runs/:sessionId/retry` Fastify handler |
| Modify | `packages/pipeline-server/src/http-server.ts` | Register retry API + update header comment |
| Modify | `config/flows/full-flow.yaml` | Add `retryable: true` to analyze/plan/implement |
| Modify | `packages/ui/src/api/client.ts` | Add `retryRun()` fetch function |
| Modify | `packages/ui/src/api/runs.ts` | Add `useRetryRun()` hook |
| Modify | `packages/ui/src/components/runs/RunDetail.tsx` | Add Retry button for failed runs |
| Modify | `docs/phases.md` | Add Retryability section |
| Modify | `CLAUDE.md` | Update flow-schema notes + status table |

---

## Task 1: Core type + Zod schema  *(Group 1 — run in parallel with Task 2)*

**Files:**
- Modify: `packages/core/src/types/pipeline.types.ts:74-81`
- Modify: `packages/pipeline/src/config/flow-schema.ts:21-31`

- [ ] **Step 1: Add `retryable` to `FlowStepDefinition` in core**

Open `packages/core/src/types/pipeline.types.ts`. Replace lines 74–81:

```typescript
export type FlowStepDefinition = {
  id: string;                           // unique within flow
  phase: string;
  config?: Record<string, unknown>;
  retry?: { attempts: number; backoffMs: number };
  timeoutMs?: number;
  onFailure?: "fail" | "skip" | "retry" | "block";  // default "fail"
  retryable?: boolean;                  // opt-in gate for POST /retry API
};
```

- [ ] **Step 2: Add `retryable` to Zod step schema**

Open `packages/pipeline/src/config/flow-schema.ts`. Replace the `z.array(z.object({...}))` step schema (lines 21–31):

```typescript
  steps: z.array(z.object({
    id: z.string().min(1).optional(),
    phase: z.string().min(1),
    config: z.record(z.unknown()).optional(),
    retry: z.object({
      attempts: z.number().int().min(1),
      backoffMs: z.number().int().min(0),
    }).optional(),
    timeoutMs: z.number().int().min(0).optional(),
    onFailure: z.enum(["fail", "skip", "retry", "block"]).optional(),
    retryable: z.boolean().optional(),
  })).min(1),
```

---

## Task 2: YAML flows + docs  *(Group 1 — run in parallel with Task 1)*

**Files:**
- Modify: `config/flows/full-flow.yaml`
- Modify: `docs/phases.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Opt in AI steps in `full-flow.yaml`**

Open `config/flows/full-flow.yaml`. Add `retryable: true` to the `analyze`, `plan`, and `implement` steps:

```yaml
  - id: analyze
    phase: analyze
    retryable: true

  - id: plan
    phase: plan
    retryable: true

  - id: implement
    phase: implement
    retryable: true
```

Leave all other steps unchanged (no `retryable` field = disabled).

- [ ] **Step 2: Add Retryability section to `docs/phases.md`**

Open `docs/phases.md`. Add the following section after the `## Writing a Custom Phase` section (before the closing content):

```markdown
---

## Step Retryability

By default, the manual retry API (`POST /api/runs/:sessionId/retry`) is **disabled** for all steps. To allow a failed run to be retried from a specific step, add `retryable: true` to that step in the flow YAML:

```yaml
- id: implement
  phase: implement
  retryable: true
```

**When retry is called on a failed run:**
1. The pipeline finds the first failed step in `run.steps`.
2. It looks up that step in the run's frozen `flowSnapshot`.
3. If `retryable` is absent or `false`, the API returns HTTP 409: `retry is disabled for step '<id>' — set retryable: true in the flow to enable`.
4. If `retryable: true`, failed and subsequent step records are stripped and the run re-executes from that step forward, preserving all previously-completed artifacts.

**Built-in phases that have `retryable: true` in `full-flow.yaml`:**

| Step id | Phase | Reason |
|---|---|---|
| `analyze` | `analyze` | Read-only AI analysis; safe to re-run |
| `plan` | `plan` | Produces a new plan without external side effects |
| `implement` | `implement` | Rewrites working-tree files; idempotent given a clean repo state |

Side-effectful steps (`notify`, `addComment`, `updateStatus`, `cleanupRepos`, `createPR`) are left off to prevent duplicate notifications, comments, or PRs.

> **Note:** `retryable` is distinct from `step.retry.attempts`, which controls *automatic* retries on transient failures during a run. `retryable` gates the *manual* retry API only.
```

- [ ] **Step 3: Update `CLAUDE.md`**

In `CLAUDE.md`, find the flow-schema / `FlowStepDefinition` description. Add a line noting the new field. Also update the Implementation Status table — find the `ClaudeProvider.implement` row area and add a new row:

```markdown
| `retryable` step flag | Implemented (`retryable?: boolean` on `FlowStepDefinition`; gates `POST /retry`) |
```

---

## Task 3: `Pipeline.retry()` with retryability gate  *(after Group 1)*

**Files:**
- Modify: `packages/pipeline/src/pipeline.ts`

- [ ] **Step 1: Add `retry()` method to `Pipeline`**

Open `packages/pipeline/src/pipeline.ts`. Add the following method after `resume()` (after the closing `}` at line 387, before the closing `}` of the class):

```typescript
async retry(sessionId: string): Promise<PipelineRun> {
  log.info({ sessionId }, "run retry requested");
  const run = await this.deps.state.load(sessionId);
  if (!run) throw new Error(`no such run ${sessionId}`);
  if (run.status !== "failed") throw new Error(`cannot retry ${sessionId}: status=${run.status}`);

  const flow = run.flowSnapshot;

  // Find the first failed step record.
  const failedRec = run.steps.find(s => s.status === "failed");
  if (!failedRec) throw new Error(`retry: no failed step in run ${sessionId}`);
  const flowIdx = flow.steps.findIndex(s => s.id === failedRec.id);
  if (flowIdx < 0) throw new Error(`retry: failed step "${failedRec.id}" not in flow snapshot`);

  // Retryability gate — must be opted in per step in the flow YAML.
  const flowStep = flow.steps[flowIdx];
  if (!flowStep?.retryable) {
    throw new Error(
      `retry is disabled for step '${failedRec.id}' — set retryable: true in the flow to enable`,
    );
  }

  // Strip failed step and all subsequent records so they re-run fresh.
  run.steps = run.steps.filter(s => s.status === "ok");

  const productConfig = this.deps.getProductConfig(run.productId);
  const workspaceDir = join(productConfig.workspace, "runs", sessionId);
  mkdirSync(workspaceDir, { recursive: true });

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

---

## Task 4: HTTP endpoint  *(Group 2 — run in parallel with Task 5)*

**Files:**
- Create: `packages/pipeline-server/src/api/retry.ts`
- Modify: `packages/pipeline-server/src/http-server.ts`

- [ ] **Step 1: Create `packages/pipeline-server/src/api/retry.ts`**

```typescript
/**
 * @file retry.ts
 * POST /api/runs/:sessionId/retry — retry a failed pipeline run from its first failed step.
 * Returns 409 if the run is not failed or the failed step does not have retryable: true.
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

Add import after the existing `registerResumeApi` import (line 41):

```typescript
import { registerRetryApi } from "./api/retry.ts";
```

Add registration after `registerResumeApi(...)` (line 91):

```typescript
registerRetryApi(app, { pipeline: deps.pipeline as any });
```

Update the header comment block (lines 17–18) to include the new route:

```typescript
 *   POST /api/runs/:sessionId/resume         — resume blocked run
 *   POST /api/runs/:sessionId/retry          — retry failed run from first failed step
```

---

## Task 5: UI — client function + hook + Retry button  *(Group 2 — run in parallel with Task 4)*

**Files:**
- Modify: `packages/ui/src/api/client.ts`
- Modify: `packages/ui/src/api/runs.ts`
- Modify: `packages/ui/src/components/runs/RunDetail.tsx`

- [ ] **Step 1: Add `retryRun()` to `packages/ui/src/api/client.ts`**

Add after the `resumeRun` function (after line 122):

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

- [ ] **Step 2: Add `useRetryRun()` to `packages/ui/src/api/runs.ts`**

Update the import on line 2 to include `retryRun`:

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

- [ ] **Step 3: Add Retry button in `packages/ui/src/components/runs/RunDetail.tsx`**

Update line 2 to import `useRetryRun`:

```typescript
import { useRunDetail, useLogs, useCancelRun, useDeleteRun, useResumeRun, useRetryRun } from '@/api/runs';
```

Update the lucide-react import on line 8 to include `RotateCcw`:

```typescript
import { ArrowLeft, Loader2, Clock, GitBranch, Tag, Calendar, XCircle, Trash2, PlayCircle, RotateCcw } from 'lucide-react';
```

Add the hook call after `const resumeRun = useResumeRun();` (line 26):

```typescript
const retryRun = useRetryRun();
```

Add the Retry button in the action buttons block after the `{run.status === 'blocked' && ...}` block (after line 196) and before the `{run.status === 'running' && ...}` cancel block:

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

---

## Task 6: Typecheck  *(after all tasks complete)*

- [ ] **Step 1: Run typecheck across all packages**

```bash
cd /Users/admin/data/workspace/claude-skils/journeyman
npm run typecheck 2>&1 | grep -E "error TS|Error" | head -30
```

Expected: no output (zero errors). If errors appear, fix them before proceeding.

---

## Self-Review

**Spec coverage:**
- ✅ `retryable?: boolean` added to `FlowStepDefinition` (Task 1)
- ✅ Zod schema updated to match (Task 1)
- ✅ Gate in `Pipeline.retry()` — throws if `!retryable` (Task 3)
- ✅ Error message matches spec: `retry is disabled for step '<id>' — set retryable: true in the flow to enable` (Task 3)
- ✅ 409 response wired through Fastify handler (Task 4)
- ✅ `analyze`, `plan`, `implement` opted in via YAML (Task 2)
- ✅ `docs/phases.md` updated with Retryability section (Task 2)
- ✅ `CLAUDE.md` updated (Task 2)
- ✅ UI: `retryRun()` client fn + `useRetryRun()` hook + Retry button (Task 5)
- ✅ Typecheck final gate (Task 6)

**Placeholder scan:** No TODOs or TBDs. All code blocks are complete.

**Type consistency:**
- `retryable?: boolean` used consistently across `FlowStepDefinition` (core), Zod schema (pipeline), YAML, and `flowStep?.retryable` guard in `retry()`.
- `retry(sessionId: string): Promise<PipelineRun>` — matches `RetryApiDeps` type in `retry.ts` (uses `Promise<any>` there, which accepts `PipelineRun`).
- `retryRun(sessionId: string): Promise<void>` — consistent in `client.ts` and `useRetryRun()`.
- `retryRun.mutate(run.sessionId)` — `sessionId` is `string`; matches `mutationFn: (sessionId: string)`.
