# Human Review Loop — Design Spec

**Date:** 2026-04-20
**Status:** Draft for review
**Scope:** Introduce a generic, phase-composable human-in-the-loop mechanism that allows a developer to gate and rework any phase (analyze / plan / code) via ticket status changes.

---

## 1. Motivation

Today the default flow runs end-to-end autonomously: `fetchTicket → analyze → plan → implement → commitPush → createPR → markInReview → cleanup`. Once a PR exists, no further automation occurs — a human must manually merge or abandon.

Real development workflows require **human gates** between automated steps:

- After `analyze` — a reviewer may want to correct scope before planning
- After `plan` — a reviewer approves or requests changes to the approach
- After `createPR` — a reviewer approves the code or asks for changes

When changes are requested, the AI should **re-run** the affected phase(s) using the reviewer's comments as additional context, and loop until approved or a configurable cycle limit is reached.

All gates and loops must be **pluggable phases** driven by configuration — no hardcoded post-PR-only behavior.

---

## 2. Design goals

1. **Single generic loop primitive.** One `reviewLoop` phase reusable for analyze, plan, or code review — only config differs.
2. **No new flow YAML primitives.** The loop is implemented entirely inside a compound phase; flow YAML stays a flat step list.
3. **Ticket status as the only human signal.** The developer changes the ticket status (in GitHub Issues / Jira / Linear) to signal approval or rework. No PR review actions are consumed.
4. **Bounded loops.** Configurable `maxCycles` per review gate; exceeding fails the run.
5. **Webhook-driven resume.** Status-change webhooks auto-resume the blocked run; no manual API calls required.
6. **Backward compatible.** Existing `default.yaml` flow continues to work unchanged.

---

## 2.1 Diagrams

Three companion diagrams illustrate the design from different angles:

- **[Overview](../../diagrams/human-loop-overview.svg)** — full pipeline with three `reviewLoop` gates (analyze / plan / code) and the human interaction lane.
- **[Sequence](../../diagrams/human-loop-sequence.svg)** — swim-lane walkthrough of one code-review rework cycle: human → webhook → dispatcher → pipeline → phase → providers → state store.
- **[State machine](../../diagrams/human-loop-states.svg)** — how a single `reviewLoop` step transitions across successive resumes (BLOCKED ↔ REWORKING → DONE | FAILED).

---

## 3. Architecture overview

### 3.1 Mechanism: resume re-runs the blocked step

Today `pipeline.resume(sessionId)` finds the blocked step and continues from the **next** step. We change it so resume **re-runs the blocked step**, passing the current ticket status in `ctx.artifacts.__resumeStatus`. The step decides:

- Return `ok` → pipeline continues forward
- Return `blocked` → run stays blocked, waits for next resume
- Return `failed` → run fails

This lets a single phase implement a loop by repeatedly returning `blocked` across multiple resumes, and `ok` only when the exit condition is met.

`ReviewPhase` (the existing manual gate in [packages/pipeline/src/phases/review-phase.ts](packages/pipeline/src/phases/review-phase.ts)) gets a small update: detect re-entry via a `__resumed` boolean artifact set by the runner, and return `ok()` in that case.

### 3.2 Webhook routing

The dispatcher ([packages/pipeline-server/src/dispatch.ts](packages/pipeline-server/src/dispatch.ts)) is extended:

| incoming event          | existing run state    | action                                                 |
|-------------------------|-----------------------|--------------------------------------------------------|
| `new-ticket`            | none                  | start new run                                          |
| `new-ticket`            | any                   | deduplicate                                            |
| `status-change`         | `blocked`             | `pipeline.resume(sessionId, { ticketStatus })`         |
| `status-change`         | `running` / `queued`  | ignore                                                 |
| `status-change`         | none                  | ignore                                                 |

Session lookup is via the existing `IStateStore.findActiveForTicket(productId, ticketKey)`. The webhook never sees a sessionId.

### 3.3 Generic `reviewLoop` phase

`ReviewLoopPhase` is a **compound phase** that orchestrates configured sub-phases on rework. The sub-phases are pulled from the same phase registry used by the runner — they remain independently testable and reusable outside the loop.

The phase uses three signals from config:

- `approveStatus` — semantic status name that means "proceed" (exit loop with `ok`)
- `reworkStatus` — semantic status name that means "run rework sub-phases, then block again"
- `onRework` — ordered list of phase names to execute on each rework cycle
- `maxCycles` — cycle cap; exceeding → `failed`

Cycles are tracked per-step in `ctx.artifacts[${stepId}_cycles]` so multiple `reviewLoop` steps in the same flow don't collide.

### 3.4 Status semantic mapping

`ProductConfig.ticketWorkflow.statuses` is the existing `semantic → literal` map. The literal value from the webhook is reverse-mapped to its semantic name before comparison with `approveStatus` / `reworkStatus`.

---

## 4. New and modified components

### 4.1 New phases

| Phase name             | Class                         | Purpose                                               |
|------------------------|-------------------------------|-------------------------------------------------------|
| `reviewLoop`           | `ReviewLoopPhase`             | Generic review gate + rework orchestrator             |
| `awaitTicketStatus`    | `AwaitTicketStatusPhase`      | Simple one-shot gate (no rework), for lightweight use |
| `fetchTicketComments`  | `FetchTicketCommentsPhase`    | Writes `reviewComments` from ticket comments          |
| `fetchPRComments`      | `FetchPRCommentsPhase`        | Writes `reviewComments` from PR review/issue comments |

### 4.2 Modified phases

- `ReviewPhase` — returns `ok()` when `ctx.artifacts.__resumed === true`, else blocks (current behavior)
- `AnalyzePhase`, `PlanPhase`, `ImplementPhase` — read optional `ctx.artifacts.reviewComments` and pass to the coding provider as extra context

### 4.3 Interface changes

#### `IGitProvider` — add method

```typescript
listPRComments(opts: ListPRCommentsOptions): Promise<ListPRCommentsResult>;

type ListPRCommentsOptions = {
  prUrl: string;
  sinceIso?: string;  // optional: only comments since this timestamp
};

type ListPRCommentsResult = {
  comments: Array<{
    author: string;
    body: string;
    path?: string;       // file path (review comments only)
    line?: number;       // line number (review comments only)
    createdAt: string;   // ISO 8601
  }>;
};
```

GitHub implementation: combines `octokit.pulls.listReviewComments` + `octokit.issues.listComments` on the PR number.

#### `ICodingCLI` — extend options

`AnalyzeOptions`, `PlanOptions`, `ImplementOptions` each gain an optional field:

```typescript
reviewComments?: string;  // concatenated reviewer feedback, markdown
```

Existing callers unaffected.

#### `PipelineContext` — expose step id

```typescript
interface PipelineContext {
  // existing...
  currentStepId: string;  // id of the step currently executing
}
```

Needed by `reviewLoop` to scope cycle counters per step.

#### `PipelineTrigger` — add event metadata

```typescript
type PipelineTrigger = {
  // existing...
  eventType?: "new-ticket" | "status-change" | "comment";
  newStatus?: string;  // literal status value (from webhook payload)
};
```

#### `Pipeline.resume` — new signature

```typescript
resume(sessionId: string, opts?: { ticketStatus?: string }): Promise<PipelineRun>;
```

### 4.4 `BasePhase.blocked()` extension

Accept optional artifacts to persist before blocking (needed to persist cycle counters):

```typescript
protected blocked(
  reason: string,
  waitFor?: "ticket-comment" | "pr-comment" | "manual",
  artifacts?: Record<string, unknown>,
): PhaseResult;
```

`PhaseResult.blocked` gains an optional `artifacts?: Record<string, unknown>` field. The runner merges these into the run's artifacts before persisting the blocked state.

---

## 5. Artifact contract

| Artifact                    | Writer                 | Reader                  | Lifetime    |
|-----------------------------|------------------------|-------------------------|-------------|
| `__resumeStatus`            | pipeline runner        | gate / loop phases      | single step |
| `__resumed`                 | pipeline runner        | ReviewPhase             | single step |
| `reviewComments`            | fetch*Comments phases  | analyze/plan/implement  | single cycle|
| `${stepId}_cycles`          | reviewLoop             | reviewLoop (same step)  | run         |
| `${stepId}_outcome`         | reviewLoop             | downstream notify       | run         |
| `prUrl`                     | createPR               | fetchPRComments         | run         |

`__`-prefixed artifacts are transient: the runner sets them immediately before re-running the blocked step and clears them after the step returns.

---

## 6. Webhook trigger changes

### 6.1 GitHub Issues trigger

Current trigger ([packages/pipeline-server/src/triggers/github-webhook-trigger.ts](packages/pipeline-server/src/triggers/github-webhook-trigger.ts)) fires on any issue/PR event matching configured labels.

Changes:
- Detect `labeled` / `unlabeled` events on issues as **status changes** (GitHub Issues uses labels as the status primitive).
- On such events, set `trigger.eventType = "status-change"` and `trigger.newStatus = <label name>`.
- Other events (issue opened, commented) set `trigger.eventType = "new-ticket"` or `"comment"`.

### 6.2 Jira trigger

Existing Jira trigger already receives `issue_updated` with status transitions. Changes:
- When `changelog.items[].field === "status"`, set `trigger.eventType = "status-change"` and `trigger.newStatus = changelog.items[].toString`.

### 6.3 Dispatcher

See section 3.2.

---

## 7. Example flow YAML (full human-loop flow)

```yaml
name: human-loop

providers:
  ticket:       github-issues
  git:          github
  coding:       claude
  notification: slack

steps:
  - id: fetch-ticket
    phase: getTicket

  - id: clone
    phase: cloneRepos
    timeoutMs: 120000

  - id: mark-in-progress
    phase: updateStatus
    config: { status: development-started }
    onFailure: skip

  - id: checkout
    phase: checkoutRepo

  - id: analyze
    phase: analyze

  - id: notify-analyze-ready
    phase: notify
    config: { message: "Analysis ready for #{ticket}" }
    onFailure: skip

  - id: analyze-review
    phase: reviewLoop
    config:
      approveStatus: analyze-approved
      reworkStatus: analyze-rework
      maxCycles: 2
      onRework: [fetchTicketComments, analyze]

  - id: plan
    phase: plan

  - id: notify-plan-ready
    phase: notify
    config: { message: "Plan ready for #{ticket} — please approve" }
    onFailure: skip

  - id: plan-review
    phase: reviewLoop
    config:
      approveStatus: plan-approved
      reworkStatus: plan-rework
      maxCycles: 3
      onRework: [fetchTicketComments, plan]

  - id: implement
    phase: implement

  - id: commit-push
    phase: commitPushRepos
    config:
      pattern: "#{ticket} : {summary}"

  - id: open-pr
    phase: createPR
    onFailure: skip

  - id: notify-pr-ready
    phase: notify
    config: { message: "PR ready for #{ticket}" }
    onFailure: skip

  - id: mark-in-review
    phase: updateStatus
    config: { status: code-review }
    onFailure: skip

  - id: code-review
    phase: reviewLoop
    config:
      approveStatus: completed
      reworkStatus: rework-requested
      maxCycles: 3
      onRework: [fetchPRComments, plan, implement, commitPushRepos]

  - id: notify-complete
    phase: notify
    config: { message: "#{ticket} completed" }
    onFailure: skip

  - id: cleanup
    phase: cleanupRepos
    onFailure: skip
```

### Product config — status mapping

```yaml
products:
  my-product:
    flow: human-loop
    # ...
    ticketWorkflow:
      statuses:
        development-started:  "in-progress"      # literal label
        analyze-approved:     "analyze-approved"
        analyze-rework:       "analyze-rework"
        plan-approved:        "plan-approved"
        plan-rework:          "plan-rework"
        code-review:          "in-review"
        rework-requested:     "rework-requested"
        completed:            "completed"
```

---

## 8. Sequence — code-review rework cycle

```
human        webhook        dispatcher      pipeline          reviewLoop phase      providers
  │             │                │              │                     │                   │
  │ label      │                │              │                     │                   │
  │ "rework-   │                │              │                     │                   │
  │ requested" │                │              │                     │                   │
  ├───────────►│                │              │                     │                   │
  │            │ POST webhook   │              │                     │                   │
  │            ├───────────────►│              │                     │                   │
  │            │                │ findActive   │                     │                   │
  │            │                │ (blocked)    │                     │                   │
  │            │                ├─────────────►│                     │                   │
  │            │                │              │ resume(             │                   │
  │            │                │              │  ticketStatus)      │                   │
  │            │                ├─────────────►│                     │                   │
  │            │                │              │ set __resumeStatus  │                   │
  │            │                │              ├────────────────────►│                   │
  │            │                │              │                     │ status == rework  │
  │            │                │              │                     │ run fetchPR       │
  │            │                │              │                     ├──────────────────►│
  │            │                │              │                     │◄──────────────────┤
  │            │                │              │                     │ run plan          │
  │            │                │              │                     ├──────────────────►│
  │            │                │              │                     │◄──────────────────┤
  │            │                │              │                     │ run implement     │
  │            │                │              │                     ├──────────────────►│
  │            │                │              │                     │ commitPush        │
  │            │                │              │                     ├──────────────────►│
  │            │                │              │                     │                   │
  │            │                │              │ blocked(cycle+1)    │                   │
  │            │                │              │◄────────────────────┤                   │
  │            │                │              │ persist run         │                   │
  │            │                │              │ (blocked again)     │                   │
  │            │                │ 202          │                     │                   │
  │            │                │◄─────────────┤                     │                   │
  │ next       │                │              │                     │                   │
  │ label      │                │              │                     │                   │
  │ "completed"│                │              │                     │                   │
  ├───────────►│  ...repeats... │              │                     │                   │
  │            │                │              │ resume →            │                   │
  │            │                │              │ status == approve   │                   │
  │            │                │              │ → ok()              │                   │
  │            │                │              │ → continue to       │                   │
  │            │                │              │   notify-complete   │                   │
```

---

## 9. Failure modes

| Scenario                                      | Behavior                                              |
|-----------------------------------------------|-------------------------------------------------------|
| Status change to unrecognized value           | `reviewLoop` blocks again, logs warning               |
| `maxCycles` exceeded                          | `reviewLoop` returns `failed`, run fails              |
| Rework sub-phase fails mid-cycle              | `reviewLoop` propagates failure; run fails            |
| Webhook arrives while run is `running`        | Deduplicated; developer must re-trigger after block   |
| Provider outage during rework                 | Phase's existing retry/onFailure policy applies       |
| Sub-phase returns `blocked` (unexpected)      | Propagated; run blocks (edge case, flagged in logs)   |

---

## 10. Out of scope

- PR review-action triggers (e.g., GitHub "Request changes") — only ticket status drives the loop
- Conditional branches within a flow (`if status == X then Y`)
- Parallel rework (multiple reviewers)
- Automerging the PR on approval — "completed" status only marks the run complete; merge remains manual or is a separate phase (not introduced here)

---

## 10.1 Documentation updates (as part of implementation)

These existing docs will be updated when the feature lands so users can discover and configure the new behavior:

| File | Update |
|---|---|
| [docs/phases.md](../../phases.md) | Add catalog entries for `reviewLoop`, `awaitTicketStatus`, `fetchTicketComments`, `fetchPRComments` — same format as existing phase catalog entries, with registry key / reads / writes / step config / source file. |
| [docs/flows.md](../../flows.md) | New section **"Human review loops"** with a complete `human-loop.yaml` example and explanation of the `approveStatus` / `reworkStatus` / `onRework` / `maxCycles` config keys. |
| [docs/configuration.md](../../configuration.md) | Extend the `ticketWorkflow.statuses` reference section with recommended semantic names for review gates (`analyze-approved`, `analyze-rework`, `plan-approved`, `plan-rework`, `rework-requested`, `completed`). |
| [docs/triggers.md](../../triggers.md) | Add the webhook event-type mapping (GitHub `labeled` / `unlabeled` → `status-change`; Jira `issue_updated` + status changelog → `status-change`) and the dispatcher routing table from §3.2. |
| [docs/pipeline-server.md](../../pipeline-server.md) | Document the new `pipeline.resume(sessionId, { ticketStatus })` signature and the semantic change ("resume re-runs the blocked step"). |
| [docs/new-product.md](../../new-product.md) | Append a "Using the human-loop flow" subsection showing how a product opts in (`flow: human-loop` + the status mapping). |
| [config/flows/](../../../config/flows/) | Add `human-loop.yaml` as a ready-to-use flow file (content identical to §7 of this spec). |
| [config/pipeline.yaml](../../../config/pipeline.yaml) | Add a commented example block under `ticketWorkflow.statuses` showing the full semantic name set for human-loop products. Existing products left untouched. |

The implementation plan tracks these as the final documentation task.

---

## 10.2 Example configurations

### 10.2.1 Full `human-loop.yaml` flow

(See §7 above — this YAML is the canonical example, shipped verbatim to `config/flows/human-loop.yaml`.)

### 10.2.2 Product config opting into human-loop

```yaml
products:
  my-product:
    flow: human-loop
    workspace: /workspaces/my-product
    concurrency: 1

    repos:
      - providerId: github
        owner: my-org
        repo: my-repo
        url: https://github.com/my-org/my-repo
        defaultBranch: main

    providerConfig:
      ticket:
        projectId: "my-org/my-repo"
        tokenEnv: MY_PRODUCT_GITHUB_TOKEN
      git:
        tokenEnv: MY_PRODUCT_GITHUB_TOKEN
      notification:
        channel: "#my-product-reviews"

    ticketWorkflow:
      trigger:
        matchLabels: [Todo]
      statuses:
        development-started: "in-progress"
        analyze-approved:    "analyze-approved"
        analyze-rework:      "analyze-rework"
        plan-approved:       "plan-approved"
        plan-rework:         "plan-rework"
        code-review:         "in-review"
        rework-requested:    "rework-requested"
        completed:           "completed"
        failed:              "failed"

    webhookSecrets:
      github: GITHUB_WEBHOOK_SECRET
```

### 10.2.3 Minimal variant — only a post-plan gate

For products that only want a plan-approval gate (no analyze or code rework), use a lightweight flow with a single `awaitTicketStatus` step:

```yaml
name: plan-gate-only

providers:
  ticket: github-issues
  git: github
  coding: claude
  notification: slack

steps:
  - id: fetch-ticket
    phase: getTicket
  - id: clone
    phase: cloneRepos
  - id: checkout
    phase: checkoutRepo
  - id: analyze
    phase: analyze
  - id: plan
    phase: plan
  - id: notify-plan-ready
    phase: notify
    config: { message: "Plan ready for #{ticket}" }
    onFailure: skip
  - id: await-plan-approval
    phase: awaitTicketStatus
    config:
      continueOn: [plan-approved]
      failOn:     [failed]
  - id: implement
    phase: implement
  - id: commit-push
    phase: commitPushRepos
  - id: open-pr
    phase: createPR
    onFailure: skip
  - id: cleanup
    phase: cleanupRepos
    onFailure: skip
```

### 10.2.4 Aggressive variant — unlimited plan rework, bounded code rework

```yaml
- id: plan-review
  phase: reviewLoop
  config:
    approveStatus: plan-approved
    reworkStatus:  plan-rework
    maxCycles:     99          # effectively unlimited
    onRework:      [fetchTicketComments, plan]

# ... implement, commit, PR ...

- id: code-review
  phase: reviewLoop
  config:
    approveStatus: completed
    reworkStatus:  rework-requested
    maxCycles:     2           # strict bound on code rework
    onRework:      [fetchPRComments, plan, implement, commitPushRepos]
```

---

## 11. Migration & compatibility

- Existing [config/flows/default.yaml](config/flows/default.yaml) flow is unchanged and continues to work.
- `ReviewPhase` behavior for existing flows is preserved: manual POST to `/resume` sets `__resumed=true`, phase returns `ok()`.
- New `human-loop.yaml` flow is added as a sibling; products opt in by setting `flow: human-loop`.
- `ICodingCLI` option extensions are additive; existing implementations compile unchanged.

---

## 12. Open questions (to resolve during implementation)

1. Should `reviewComments` be cleared after each rework cycle, or accumulate across cycles? (Leaning: clear per-cycle — each cycle's comments are already the "delta since last push".)
2. Should the runner persist trace lines labeled per sub-phase within `reviewLoop`? (Leaning: yes — each sub-phase logs under a synthetic step id like `${stepId}/fetchPRComments`.)
3. Should `ReviewLoopPhase` expose a "dry-run rework" mode for testing? (Defer.)
