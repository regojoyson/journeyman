# Phase Gate Config Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each flow step declare a `gate` config that controls what is allowed to resume it when it blocks — an explicit API call, a webhook event, or automatic resumption after an optional delay.

**Architecture:** Add a `gate` field to `FlowStepDefinition` in core types and the Zod schema. The pipeline runner reads `step.gate` after a step blocks and either schedules an auto-resume or stamps the `StepRecord.waitFor` hint. The webhook dispatcher reads the blocked step's gate config from `flowSnapshot` to decide whether to auto-resume or ignore the event. Phases stop hard-coding `waitFor` — the gate config owns that decision. The UI shows a gate-mode badge on blocked steps.

**Tech Stack:** TypeScript, Zod (`@journeyman/pipeline`), Fastify dispatcher (`@journeyman/pipeline-server`), React + TanStack Query (`@journeyman/ui`)

---

## Current behaviour (important context)

- Phases hard-code `waitFor: "ticket-comment"` inside `this.blocked()` calls.
- `dispatch.ts:44` — any `status-change` webhook for a blocked run calls `pipeline.resume()` unconditionally, regardless of which phase is blocked.
- There is no way to require a human API call for a specific step while allowing webhook resumption for another.

---

## File Map

| Action | File | Purpose |
|--------|------|---------|
| Modify | `packages/core/src/types/pipeline.types.ts` | Add `gate` to `FlowStepDefinition`; add `"api"\|"webhook"\|"auto"` to `StepRecord.waitFor` |
| Modify | `packages/pipeline/src/config/flow-schema.ts` | Add `gate` to Zod step schema |
| Modify | `packages/pipeline/src/pipeline.ts` | Read `step.gate` after block; stamp `rec.waitFor`; schedule auto-resume |
| Modify | `packages/pipeline/src/phases/review-loop-phase.ts` | Remove hard-coded `waitFor` from `blocked()` calls |
| Modify | `packages/pipeline/src/phases/await-ticket-status-phase.ts` | Same |
| Modify | `packages/pipeline-server/src/dispatch.ts` | Check gate mode before auto-resuming from webhook |
| Modify | `config/flows/full-flow.yaml` | Add `gate` to blocking steps as examples |
| Modify | `config/flows/human-loop.yaml` | Same |
| Modify | `packages/ui/src/components/runs/StepTimeline.tsx` | Show gate-mode badge on blocked steps |

---

### Task 1: Extend core types and Zod schema

**Files:**
- Modify: `packages/core/src/types/pipeline.types.ts`
- Modify: `packages/pipeline/src/config/flow-schema.ts`

- [ ] **Step 1: Add `gate` to `FlowStepDefinition` in pipeline.types.ts**

In `packages/core/src/types/pipeline.types.ts`, replace the `FlowStepDefinition` type (lines 74–81):

```typescript
export type GateConfig = {
  /** api: only POST /api/runs/:id/resume can unblock.
   *  webhook: a matching webhook event auto-resumes (default).
   *  auto: resumes automatically after optional delayMs. */
  mode: "api" | "webhook" | "auto";
  delayMs?: number;   // auto mode only — ms to wait before resuming (default 0)
};

export type FlowStepDefinition = {
  id: string;
  phase: string;
  config?: Record<string, unknown>;
  retry?: { attempts: number; backoffMs: number };
  timeoutMs?: number;
  onFailure?: "fail" | "skip" | "retry" | "block";
  gate?: GateConfig;
};
```

Also extend `StepRecord.waitFor` (line 30) to include the new gate modes:

```typescript
  waitFor?: "ticket-comment" | "pr-comment" | "manual" | "api" | "webhook" | "auto";
```

And `PhaseResult` blocked union (lines 11–15):

```typescript
  | {
      status: "blocked";
      reason: string;
      waitFor?: "ticket-comment" | "pr-comment" | "manual" | "api" | "webhook" | "auto";
      artifacts?: Record<string, unknown>;
    }
```

- [ ] **Step 2: Add `gate` to Zod schema in flow-schema.ts**

In `packages/pipeline/src/config/flow-schema.ts`, replace `FlowSchema` (full file):

```typescript
import { z } from "zod";

const GateSchema = z.object({
  mode: z.enum(["api", "webhook", "auto"]),
  delayMs: z.number().int().min(0).optional(),
}).optional();

export const FlowSchema = z.object({
  name: z.string().min(1),
  providers: z.object({
    ticket: z.string().min(1),
    git: z.string().min(1),
    coding: z.string().min(1),
    notification: z.string().min(1),
  }),
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
    gate: GateSchema,
  })).min(1),
});
```

- [ ] **Step 3: Type-check**

```bash
cd /Users/admin/data/workspace/claude-skils/journeyman
npm run typecheck 2>&1 | grep -E "error TS" | head -20
```

Expected: no new errors (there may be pre-existing ones to ignore)

- [ ] **Step 4: Commit**

```bash
cd /Users/admin/data/workspace/claude-skils/journeyman
git add packages/core/src/types/pipeline.types.ts packages/pipeline/src/config/flow-schema.ts
git commit -m "feat: add gate config to FlowStepDefinition and Zod schema"
```

---

### Task 2: Pipeline runner — stamp waitFor and handle auto mode

**Files:**
- Modify: `packages/pipeline/src/pipeline.ts`

The change is in two places in `runStepWithAttempts()`: after the `blocked` branch sets `rec.waitFor` (line 205–207), override it from `step.gate`; and in `run()` + `resume()`, after calling `this.finish(run, "blocked")`, schedule auto-resume if `gate.mode === "auto"`.

- [ ] **Step 1: Write the failing test**

Create `packages/pipeline/src/pipeline.gate.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { Pipeline } from "./pipeline.ts";
import type { PipelineRun, FlowDefinition } from "@journeyman/core";

function makeFlow(gateMode?: "api" | "webhook" | "auto", delayMs?: number): FlowDefinition {
  return {
    name: "gate-test",
    providers: { ticket: "t", git: "g", coding: "c", notification: "n" },
    steps: [{
      id: "step-gate",
      phase: "gatePhase",
      gate: gateMode ? { mode: gateMode, delayMs } : undefined,
    }],
  };
}

function makeRun(flow: FlowDefinition): PipelineRun {
  return {
    sessionId: "ses-gate",
    productId: "prod-1",
    ticketKey: "T-1",
    ticketShortKey: "1",
    flowName: "gate-test",
    flowSnapshot: flow,
    status: "running",
    currentStep: null,
    steps: [],
    artifacts: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function makeDeps(blockResult: { reason: string; waitFor?: string }) {
  const phase = {
    run: vi.fn().mockResolvedValue({ status: "blocked", reason: blockResult.reason, waitFor: blockResult.waitFor }),
  };
  return {
    deps: {
      phases: { resolve: () => phase },
      state: { load: vi.fn(), save: vi.fn().mockResolvedValue(undefined) },
      trace: { log: vi.fn() },
      artifactStore: {} as any,
      bus: { publish: vi.fn() },
      resolveProviders: vi.fn().mockReturnValue({}),
      getProductConfig: vi.fn().mockReturnValue({ flow: "gate-test", workspace: "/tmp", repos: [] }),
      cleanupOn: [],
    } as any,
  };
}

describe("gate config — waitFor stamping", () => {
  it("stamps rec.waitFor from gate.mode=api, overriding phase value", async () => {
    const flow = makeFlow("api");
    const { deps } = makeDeps({ reason: "awaiting review", waitFor: "ticket-comment" });
    const run = makeRun(flow);
    deps.state.load = vi.fn().mockResolvedValue(null);
    const p = new Pipeline(deps);
    await p.run({ trigger: { sourceId: "t", productId: "prod-1", ticketKey: "T-1", ticketShortKey: "1", rawPayload: {}, receivedAt: "" }, flow });
    const saved = deps.state.save.mock.calls.map((c: any) => c[0] as PipelineRun);
    const blocked = saved.find((r: PipelineRun) => r.status === "blocked");
    expect(blocked?.steps[0].waitFor).toBe("api");
  });

  it("stamps rec.waitFor from gate.mode=webhook", async () => {
    const flow = makeFlow("webhook");
    const { deps } = makeDeps({ reason: "awaiting review" });
    const run = makeRun(flow);
    const p = new Pipeline(deps);
    await p.run({ trigger: { sourceId: "t", productId: "prod-1", ticketKey: "T-1", ticketShortKey: "1", rawPayload: {}, receivedAt: "" }, flow });
    const saved = deps.state.save.mock.calls.map((c: any) => c[0] as PipelineRun);
    const blocked = saved.find((r: PipelineRun) => r.status === "blocked");
    expect(blocked?.steps[0].waitFor).toBe("webhook");
  });

  it("falls back to phase-provided waitFor when no gate is configured", async () => {
    const flow = makeFlow(undefined); // no gate
    const { deps } = makeDeps({ reason: "manual gate", waitFor: "manual" });
    const p = new Pipeline(deps);
    await p.run({ trigger: { sourceId: "t", productId: "prod-1", ticketKey: "T-1", ticketShortKey: "1", rawPayload: {}, receivedAt: "" }, flow });
    const saved = deps.state.save.mock.calls.map((c: any) => c[0] as PipelineRun);
    const blocked = saved.find((r: PipelineRun) => r.status === "blocked");
    expect(blocked?.steps[0].waitFor).toBe("manual");
  });
});

describe("gate config — auto mode", () => {
  it("schedules resume after delayMs when gate.mode=auto", async () => {
    vi.useFakeTimers();
    const flow = makeFlow("auto", 100);
    const { deps } = makeDeps({ reason: "auto gate" });
    const p = new Pipeline(deps);
    const resumeSpy = vi.spyOn(p, "resume").mockResolvedValue({} as any);
    await p.run({ trigger: { sourceId: "t", productId: "prod-1", ticketKey: "T-1", ticketShortKey: "1", rawPayload: {}, receivedAt: "" }, flow });
    expect(resumeSpy).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(100);
    expect(resumeSpy).toHaveBeenCalledWith("ses-gate", undefined);
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd /Users/admin/data/workspace/claude-skils/journeyman
npx vitest run packages/pipeline/src/pipeline.gate.test.ts 2>&1 | tail -20
```

Expected: FAIL — `waitFor` stamps not applied, auto-resume not scheduled

- [ ] **Step 3: Apply gate stamping in `runStepWithAttempts()`**

In `packages/pipeline/src/pipeline.ts`, find the blocked branch inside `runStepWithAttempts()` (around lines 203–207):

```typescript
      } else if (last.status === "blocked") {
        rec.status = "blocked";
        rec.blockedReason = last.reason;
        rec.waitFor = last.waitFor;
        if (last.artifacts) Object.assign(run.artifacts, last.artifacts);
```

Replace `rec.waitFor = last.waitFor;` with:

```typescript
        // Gate config overrides the phase's waitFor hint if present.
        rec.waitFor = step.gate?.mode ?? last.waitFor;
```

- [ ] **Step 4: Apply auto-resume scheduling in `run()` and `resume()`**

In `pipeline.ts` `run()`, find the blocked check (around line 121):

```typescript
        if (result.status === "blocked") { await this.finish(run, "blocked"); return run; }
```

Replace with:

```typescript
        if (result.status === "blocked") {
          await this.finish(run, "blocked");
          this.scheduleAutoResume(run.sessionId, step);
          return run;
        }
```

Do the same in `resume()` (around line 373):

```typescript
        if (result.status === "blocked") { await this.finish(run, "blocked"); return run; }
```

Replace with:

```typescript
        if (result.status === "blocked") {
          await this.finish(run, "blocked");
          this.scheduleAutoResume(run.sessionId, step);
          return run;
        }
```

Add the helper method before the closing `}` of the `Pipeline` class (before the `sleep` function at the bottom):

```typescript
  private scheduleAutoResume(sessionId: string, step: FlowStepDefinition): void {
    if (step.gate?.mode !== "auto") return;
    const delay = step.gate.delayMs ?? 0;
    setTimeout(() => {
      void this.resume(sessionId).catch(err =>
        log.error({ err, sessionId }, "auto-resume failed"),
      );
    }, delay);
  }
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
cd /Users/admin/data/workspace/claude-skils/journeyman
npx vitest run packages/pipeline/src/pipeline.gate.test.ts 2>&1 | tail -20
```

Expected: PASS — 4 tests pass

- [ ] **Step 6: Commit**

```bash
cd /Users/admin/data/workspace/claude-skils/journeyman
git add packages/pipeline/src/pipeline.ts packages/pipeline/src/pipeline.gate.test.ts
git commit -m "feat: pipeline reads gate config to stamp waitFor and schedule auto-resume"
```

---

### Task 3: Remove hard-coded waitFor from phases

**Files:**
- Modify: `packages/pipeline/src/phases/review-loop-phase.ts`
- Modify: `packages/pipeline/src/phases/await-ticket-status-phase.ts`

Phases should not need to know the resumption mode — that is now the flow config's job. Remove the `waitFor` argument from every `this.blocked()` call in these two files so they rely on the gate config instead.

- [ ] **Step 1: Update `review-loop-phase.ts`**

In `packages/pipeline/src/phases/review-loop-phase.ts`, replace every `this.blocked(...)` call:

Line 44:
```typescript
      return this.blocked("awaiting review");
```

Lines 66–70:
```typescript
      return this.blocked(
        `cycle ${cycles + 1} complete, awaiting review`,
        undefined,
        { [cyclesKey]: cycles + 1 },
      );
```

Lines 73–76:
```typescript
      return this.blocked(
        `status "${semantic}" unhandled, awaiting ${config.approveStatus}|${config.reworkStatus}`,
      );
```

- [ ] **Step 2: Update `await-ticket-status-phase.ts`**

In `packages/pipeline/src/phases/await-ticket-status-phase.ts`:

Line 32:
```typescript
      return this.blocked("awaiting ticket status change");
```

Lines 40–43:
```typescript
    return this.blocked(
      `ticket at "${semantic}", awaiting ${config.continueOn.join("|")}`,
    );
```

- [ ] **Step 3: Run existing phase tests to confirm nothing broke**

```bash
cd /Users/admin/data/workspace/claude-skils/journeyman
npx vitest run packages/pipeline/src 2>&1 | tail -20
```

Expected: all existing tests still pass

- [ ] **Step 4: Commit**

```bash
cd /Users/admin/data/workspace/claude-skils/journeyman
git add packages/pipeline/src/phases/review-loop-phase.ts packages/pipeline/src/phases/await-ticket-status-phase.ts
git commit -m "refactor: remove hard-coded waitFor from phases — gate config owns this"
```

---

### Task 4: Dispatcher — respect gate mode before auto-resuming

**Files:**
- Modify: `packages/pipeline-server/src/dispatch.ts`

Currently `dispatch.ts:44` resumes ANY blocked run on a `status-change` webhook. After this task, it will check the blocked step's `gate.mode` first — if `api`, the webhook is ignored.

- [ ] **Step 1: Write the failing test**

Create `packages/pipeline-server/src/dispatch.gate.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { buildDispatcher } from "./dispatch.ts";
import type { PipelineRun, FlowDefinition } from "@journeyman/core";

function makeBlockedRun(gateMode?: "api" | "webhook" | "auto"): PipelineRun {
  const flow: FlowDefinition = {
    name: "f",
    providers: { ticket: "t", git: "g", coding: "c", notification: "n" },
    steps: [{
      id: "review",
      phase: "reviewLoop",
      gate: gateMode ? { mode: gateMode } : undefined,
    }],
  };
  return {
    sessionId: "ses-1",
    productId: "prod-1",
    ticketKey: "T-1",
    ticketShortKey: "1",
    flowName: "f",
    flowSnapshot: flow,
    status: "blocked",
    currentStep: "review",
    steps: [{ id: "review", phase: "reviewLoop", attempt: 1, status: "blocked",
      startedAt: null, endedAt: null, durationMs: null }],
    artifacts: {},
    createdAt: "",
    updatedAt: "",
  };
}

function makeDeps(run: PipelineRun | null) {
  const resume = vi.fn().mockResolvedValue({});
  return {
    resume,
    deps: {
      flows: { getFlow: vi.fn() },
      resolver: { resolve: vi.fn().mockResolvedValue({ productId: "prod-1", flowName: "f" }) },
      pipeline: { resume, run: vi.fn() } as any,
      state: { findActiveForTicket: vi.fn().mockResolvedValue(run) } as any,
      mutex: { acquire: vi.fn().mockReturnValue(true), release: vi.fn() } as any,
      semaphores: { acquire: vi.fn().mockResolvedValue(() => {}) } as any,
    },
  };
}

const statusChangeTrigger = {
  sourceId: "github",
  productId: "prod-1",
  ticketKey: "T-1",
  ticketShortKey: "1",
  rawPayload: {},
  receivedAt: "",
  eventType: "status-change" as const,
  newStatus: "analyze-approved",
};

describe("dispatch gate check", () => {
  it("auto-resumes when gate.mode=webhook (current default behaviour)", async () => {
    const { deps, resume } = makeDeps(makeBlockedRun("webhook"));
    const dispatch = buildDispatcher(deps);
    await dispatch(statusChangeTrigger);
    await new Promise(r => setTimeout(r, 10));
    expect(resume).toHaveBeenCalledWith("ses-1", { ticketStatus: "analyze-approved" });
  });

  it("does NOT resume when gate.mode=api — webhook is ignored", async () => {
    const { deps, resume } = makeDeps(makeBlockedRun("api"));
    const dispatch = buildDispatcher(deps);
    const result = await dispatch(statusChangeTrigger);
    await new Promise(r => setTimeout(r, 10));
    expect(resume).not.toHaveBeenCalled();
    expect(result).toMatchObject({ deduplicated: true });
  });

  it("falls back to webhook behaviour when no gate is configured", async () => {
    const { deps, resume } = makeDeps(makeBlockedRun(undefined));
    const dispatch = buildDispatcher(deps);
    await dispatch(statusChangeTrigger);
    await new Promise(r => setTimeout(r, 10));
    expect(resume).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd /Users/admin/data/workspace/claude-skils/journeyman
npx vitest run packages/pipeline-server/src/dispatch.gate.test.ts 2>&1 | tail -20
```

Expected: FAIL — `api` gate does not block the auto-resume yet

- [ ] **Step 3: Update `dispatch.ts` to check gate mode**

In `packages/pipeline-server/src/dispatch.ts`, replace the `existing.status === "blocked"` branch (lines 43–53):

```typescript
    if (existing.status === "blocked" && trigger.eventType === "status-change") {
      // Check the blocked step's gate config.  Default: webhook (resume on status-change).
      const blockedStep = [...existing.steps].reverse().find(s => s.status === "blocked");
      const blockedStepDef = blockedStep
        ? existing.flowSnapshot.steps.find(s => s.id === blockedStep.id)
        : undefined;
      const gateMode = blockedStepDef?.gate?.mode ?? "webhook";

      if (gateMode === "api") {
        // This step requires an explicit API call — webhook events are ignored.
        log.info({ sessionId: existing.sessionId, stepId: blockedStep?.id }, "gate=api: webhook ignored");
        return { sessionId: existing.sessionId, deduplicated: true };
      }

      void (async () => {
        try {
          await deps.pipeline.resume(existing.sessionId, { ticketStatus: trigger.newStatus });
        } catch (err) {
          log.error({ err, sessionId: existing.sessionId }, "resume failure");
        }
      })();
      return { sessionId: existing.sessionId, resumed: true } as DispatchResult;
    }
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd /Users/admin/data/workspace/claude-skils/journeyman
npx vitest run packages/pipeline-server/src/dispatch.gate.test.ts 2>&1 | tail -20
```

Expected: PASS — 3 tests pass

- [ ] **Step 5: Commit**

```bash
cd /Users/admin/data/workspace/claude-skils/journeyman
git add packages/pipeline-server/src/dispatch.ts packages/pipeline-server/src/dispatch.gate.test.ts
git commit -m "feat: dispatcher respects gate.mode=api — webhook cannot resume API-gated steps"
```

---

### Task 5: Wire gate config into example flow YAMLs

**Files:**
- Modify: `config/flows/full-flow.yaml`
- Modify: `config/flows/human-loop.yaml`

- [ ] **Step 1: Update `config/flows/full-flow.yaml`**

Add `gate: { mode: api }` to the `code-review` step (line 79) — a human must explicitly approve via API, a stray label event won't auto-advance:

```yaml
  - id: code-review
    phase: reviewLoop
    config:
      approveStatus: completed
      reworkStatus: rework-requested
      maxCycles: 3
      onRework: [fetchPRComments, plan, implement, commitPushRepos]
    gate:
      mode: api
```

- [ ] **Step 2: Update `config/flows/human-loop.yaml`**

Add `gate: { mode: api }` to each `reviewLoop` step in that file (search for `phase: reviewLoop` or `phase: awaitTicketStatus` lines and add `gate: { mode: api }` under each).

- [ ] **Step 3: Validate flows load without errors**

```bash
cd /Users/admin/data/workspace/claude-skils/journeyman
npx tsx packages/pipeline/src/cli.ts validate-config config/pipeline.yaml 2>&1
```

Expected: no validation errors

- [ ] **Step 4: Commit**

```bash
cd /Users/admin/data/workspace/claude-skils/journeyman
git add config/flows/full-flow.yaml config/flows/human-loop.yaml
git commit -m "config: set gate=api on review steps so only explicit API calls can advance them"
```

---

### Task 6: UI — gate mode badge on blocked steps

**Files:**
- Modify: `packages/ui/src/components/runs/StepTimeline.tsx`

Show a small pill on blocked steps that tells the user how the step can be resumed: `API only`, `Webhook`, or `Auto`.

- [ ] **Step 1: Add gate badge inside `StepRow`**

In `packages/ui/src/components/runs/StepTimeline.tsx`, inside `StepRow`, after the status pill (around line 278), add:

```tsx
{step.status === 'blocked' && step.waitFor && (
  <span className={`hidden sm:inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${
    step.waitFor === 'api'
      ? 'bg-violet-50 text-violet-700 border-violet-200'
      : step.waitFor === 'auto'
      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
      : 'bg-sky-50 text-sky-700 border-sky-200'
  }`}>
    {step.waitFor === 'api' ? 'API only'
      : step.waitFor === 'auto' ? 'Auto'
      : step.waitFor === 'webhook' ? 'Webhook'
      : step.waitFor}
  </span>
)}
```

This goes on the same row as the existing status pill (inside the flex row at line 276):

```tsx
<div className="flex items-center gap-2 min-w-0">
  <span className="font-medium text-slate-800 truncate">{formatStepName(step.id)}</span>
  <span className={`hidden sm:inline-flex ... ${cfg.pill}`}>{cfg.label}</span>
  {/* gate badge */}
  {step.status === 'blocked' && step.waitFor && (
    <span className={`hidden sm:inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${
      step.waitFor === 'api'
        ? 'bg-violet-50 text-violet-700 border-violet-200'
        : step.waitFor === 'auto'
        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
        : 'bg-sky-50 text-sky-700 border-sky-200'
    }`}>
      {step.waitFor === 'api' ? 'API only'
        : step.waitFor === 'auto' ? 'Auto'
        : step.waitFor === 'webhook' ? 'Webhook'
        : step.waitFor}
    </span>
  )}
  <span className="hidden md:inline text-xs text-slate-400 font-mono">{step.phase}</span>
</div>
```

- [ ] **Step 2: Type-check**

```bash
cd /Users/admin/data/workspace/claude-skils/journeyman
npm run typecheck 2>&1 | grep -E "error TS" | head -20
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
cd /Users/admin/data/workspace/claude-skils/journeyman
git add packages/ui/src/components/runs/StepTimeline.tsx
git commit -m "feat: show gate mode badge on blocked steps in StepTimeline"
```

---

## Self-Review

**Spec coverage:**
- ✅ `gate.mode: "api"` — only `POST /api/runs/:id/resume` can unblock
- ✅ `gate.mode: "webhook"` — webhook `status-change` auto-resumes (existing behaviour preserved)
- ✅ `gate.mode: "auto"` — pipeline schedules a `setTimeout` resume automatically
- ✅ `gate.delayMs` — configures the auto-resume delay
- ✅ No gate = default webhook behaviour (fully backward-compatible)
- ✅ Phases no longer hard-code `waitFor` — removed from `reviewLoop` and `awaitTicketStatus`
- ✅ Dispatcher checks gate before auto-resuming from webhook
- ✅ Flow YAMLs updated with examples
- ✅ UI badge shows gate mode on blocked steps
- ✅ Tests cover all three gate modes in pipeline and dispatcher

**Placeholder scan:** No TODOs or TBDs present.

**Type consistency:**
- `GateConfig` defined in `pipeline.types.ts` and referenced in `FlowStepDefinition` — consistent
- `gate.mode` values `"api" | "webhook" | "auto"` match the Zod enum, the pipeline logic, the dispatcher check, and the UI badge labels
- `StepRecord.waitFor` extended to include `"api" | "webhook" | "auto"` — consistent with what the pipeline stamps
