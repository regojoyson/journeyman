# Pipeline Phases — Catalog & Authoring Guide

## Overview

Phases are the atomic units of work in a pipeline run. Every phase is an implementation of the `IPhase` interface and declares two static arrays that drive dependency resolution:

- **`static reads`** — artifact keys the phase expects to find in `PipelineContext.artifacts` before it runs.
- **`static writes`** — artifact keys the phase will add (or update) in `PipelineContext.artifacts` on success.

At boot the **flow validator** walks each configured flow and confirms that every `reads` entry is satisfied by a prior step's `writes` (or is explicitly seeded into the context at run start). A typo like `pln` instead of `plan` fails boot with an exact, actionable error rather than a silent runtime miss.

At runtime the **runner** looks up each step's phase by its registry key in `PhaseRegistry`, instantiates it via the registered factory, calls `phase.run(ctx, stepConfig)`, and merges the returned artifact patch into `ctx.artifacts`.

---

## Built-in Phase Catalog

### `getTicket`

| Field | Value |
|---|---|
| **Registry key** | `getTicket` |
| **reads** | _(none)_ |
| **writes** | `ticket`, `ticketMd` |
| **Step config** | _(none)_ |
| **Source** | `packages/pipeline/src/phases/get-ticket-phase.ts` |

Fetches the ticket identified by `ctx.ticketId` from the configured ticket provider and stores the raw ticket object under `ticket` and a markdown rendering under `ticketMd`.

**Failure modes:** ticket not found (provider 404), network error, or missing `ctx.ticketId`.

**Side effects:** one read API call to the ticket provider; no mutations.

---

### `getTicketSchema`

| Field | Value |
|---|---|
| **Registry key** | `getTicketSchema` |
| **reads** | _(none)_ |
| **writes** | `ticketSchema` |
| **Step config** | `projectId?: string` |
| **Source** | `packages/pipeline/src/phases/get-ticket-schema-phase.ts` |

Fetches the field schema for the ticket project from the ticket provider. Useful before `createTicket` when you need to know which custom fields and allowed values exist. If `projectId` is omitted, falls back to the product config's default project.

**Failure modes:** ticket provider API error, project not found.

**Side effects:** one read API call to the ticket provider.

---

### `createTicket`

| Field | Value |
|---|---|
| **Registry key** | `createTicket` |
| **reads** | _(none)_ |
| **writes** | `createdTicket` |
| **Step config** | `title: string`, `description?: string`, `assignee?: string`, `labels?: string[]`, `projectId?: string`, `status?: string`, `customFields?: Record<string, unknown>` |
| **Source** | `packages/pipeline/src/phases/create-ticket-phase.ts` |

Creates a new ticket on the configured ticket provider using the supplied config values. Stores the created ticket object under `createdTicket`.

**Failure modes:** missing required `title`, provider API error, invalid field values.

**Side effects:** creates a ticket on the ticket provider.

---

### `updateTicket`

| Field | Value |
|---|---|
| **Registry key** | `updateTicket` |
| **reads** | _(none)_ |
| **writes** | `updatedTicket` |
| **Step config** | `title?: string`, `description?: string`, `status?: string`, `assignee?: string`, `labels?: string[]`, `priority?: string`, `customFields?: Record<string, unknown>` |
| **Source** | `packages/pipeline/src/phases/update-ticket-phase.ts` |

Updates fields on the current ticket (`ctx.ticketId`). Only supplied fields are changed; omitted fields are left as-is. Stores the updated ticket object under `updatedTicket`.

**Failure modes:** ticket not found, provider API error, invalid field values.

**Side effects:** mutates the ticket on the ticket provider.

---

### `cloneRepos`

| Field | Value |
|---|---|
| **Registry key** | `cloneRepos` |
| **reads** | _(none)_ |
| **writes** | `repoPaths`, `primaryRepoPath`, `repoRefs` |
| **Step config** | _(none)_ |
| **Source** | `packages/pipeline/src/phases/clone-repos-phase.ts` |

Clones every repository listed in `productConfig.repos` to a temporary local workspace via the `git` provider (`GitHubProvider.cloneRepos`). Captures the local path of each cloned repo in `repoPaths`, the designated primary repo in `primaryRepoPath`, and the resolved HEAD ref (SHA + branch) per repo in `repoRefs`.

**Failure modes:** git clone error, disk-space exhaustion, missing auth credentials.

**Side effects:** creates directories on disk; triggers one or more `git clone` invocations.

---

### `createWorkspace`

| Field | Value |
|---|---|
| **Registry key** | `createWorkspace` |
| **reads** | _(none)_ |
| **writes** | `workspacePath` |
| **Step config** | _(none)_ |
| **Source** | `packages/pipeline/src/phases/create-workspace-phase.ts` |

Creates a temporary working directory for the pipeline run and stores its absolute path under `workspacePath`. Use before phases that need a scratch directory outside of any cloned repo.

**Failure modes:** file-system permission error, disk-space exhaustion.

**Side effects:** creates a directory on disk.

---

### `checkoutRepo`

| Field | Value |
|---|---|
| **Registry key** | `checkoutRepo` |
| **reads** | `repoPaths`, `ticket` _(optional)_ |
| **writes** | `checkoutResults` |
| **Step config** | _(none)_ |
| **Source** | `packages/pipeline/src/phases/checkout-repo-phase.ts` |

Hard-resets each cloned repo in `repoPaths` to its configured default branch (from `productConfig.repos[i].defaultBranch`, falling back to `"main"`) and checks out a fresh feature branch via the `coding` provider's `checkoutRepo` operation. Useful as a cleanup step between retries or before re-running implement, ensuring the working tree is in a known-good state. Stores per-repo results under `checkoutResults`.

**Branch naming:** when the pipeline has a ticket (written by `getTicket`), the branch name follows the pattern `{ticketShortKey}/{2-4-word-slug}_{unix-seconds}` (e.g. `42/fix-header-alignment_1713542400`). `ticketShortKey` is preferred over `ticketKey`; if neither is present the branch falls back to an animal-themed random name (e.g. `curious-otter-sprint_1713542400`).

**Failure modes:** any individual repo reports an `error` (phase fails with that message); coding-cli provider error; cancellation via `ctx.signal`.

**Side effects:** performs `git reset` and `git checkout` on local disk.

---

### `scanRepos`

| Field | Value |
|---|---|
| **Registry key** | `scanRepos` |
| **reads** | `primaryRepoPath` |
| **writes** | `scannedRepos` |
| **Step config** | _(none)_ |
| **Source** | `packages/pipeline/src/phases/scan-repos-phase.ts` |

Performs a lightweight structural scan of the primary repo (file tree, language detection, key entry points) and stores a summary under `scannedRepos`. Useful as a cheap pre-pass before the heavier `analyze` step.

**Failure modes:** missing `primaryRepoPath` directory, coding-cli provider error.

**Side effects:** reads files under `primaryRepoPath`; no mutations.

---

### `getRepo`

| Field | Value |
|---|---|
| **Registry key** | `getRepo` |
| **reads** | _(none)_ |
| **writes** | `repo` |
| **Step config** | _(none)_ |
| **Source** | `packages/pipeline/src/phases/get-repo-phase.ts` |

Fetches repository metadata (name, default branch, visibility, clone URLs) from the git provider and stores it under `repo`.

**Failure modes:** git provider API error, repo not found.

**Side effects:** one read API call to the git provider.

---

### `analyze`

| Field | Value |
|---|---|
| **Registry key** | `analyze` |
| **reads** | `primaryRepoPath`, `ticketMd` |
| **writes** | `analysis` (includes `reportHandle`) |
| **Step config** | _(none)_ |
| **Source** | `packages/pipeline/src/phases/analyze-phase.ts` |

Runs an AI-powered analysis of the primary repository relative to the ticket description. Stores a structured `AnalyzeResult` under `analysis`; large report blobs are offloaded to the artifact store and referenced via `analysis.reportHandle`.

**Failure modes:** `coding-cli` provider error, missing `primaryRepoPath` directory, context-window overflow on very large repos.

**Side effects:** may read many files under `primaryRepoPath`; writes one artifact blob to the artifact store.

---

### `plan`

| Field | Value |
|---|---|
| **Registry key** | `plan` |
| **reads** | `analysis`, `ticketMd`, `primaryRepoPath` |
| **writes** | `plan` (includes `reportHandle`) |
| **Step config** | _(none)_ |
| **Source** | `packages/pipeline/src/phases/plan-phase.ts` |

Produces a structured implementation plan from the analysis and ticket context. Stores a `PlanResult` under `plan`; the full plan document is referenced via `plan.reportHandle`.

**Failure modes:** provider error, incoherent analysis input, context overflow.

**Side effects:** writes one artifact blob to the artifact store.

---

### `implement`

| Field | Value |
|---|---|
| **Registry key** | `implement` |
| **reads** | `plan`, `primaryRepoPath`, `ticketMd` |
| **writes** | `implementation` (includes `reportHandle`) |
| **Step config** | _(none)_ |
| **Source** | `packages/pipeline/src/phases/implement-phase.ts` |

Applies the plan to the working tree under `primaryRepoPath`, producing code changes. Stores an `ImplementResult` under `implementation`; a diff/summary report is referenced via `implementation.reportHandle`.

**Failure modes:** provider error, merge conflicts, test failures detected during implementation, file-system permission errors.

**Side effects:** mutates files under `primaryRepoPath`; writes one artifact blob.

---

### `commitPushRepos`

| Field | Value |
|---|---|
| **Registry key** | `commitPushRepos` |
| **reads** | `primaryRepoPath` |
| **writes** | `commit` |
| **Step config** | `pattern?: string`, `prSummaryStyle?: "brief" \| "detailed"` |
| **Source** | `packages/pipeline/src/phases/commit-push-phase.ts` |

Commits all staged changes in the primary repo using a commit message derived from the ticket and plan (applying `pattern` if provided), then pushes to the remote branch. Stores commit metadata (SHA, branch, remote URL) under `commit`.

`pattern` supports `#{ticket}` and `{summary}` interpolation tokens. `prSummaryStyle` controls how verbose the auto-generated summary portion is (`"brief"` is the default).

**Failure modes:** nothing to commit, push rejected (force-push blocked, stale ref), auth failure.

**Side effects:** creates a git commit; pushes to the remote git host.

---

### `createPR`

| Field | Value |
|---|---|
| **Registry key** | `createPR` |
| **reads** | `commit` |
| **writes** | `pr` |
| **Step config** | _(none)_ |
| **Source** | `packages/pipeline/src/phases/create-pr-phase.ts` |

Creates a pull request (or merge request) on the git host for the pushed branch. Performs a `listPRs` preflight check so the operation is idempotent — if a PR already exists for the branch it is reused and its URL stored. Stores PR metadata under `pr`.

**Failure modes:** git-host API error, branch not found on remote, duplicate PR creation race (handled via preflight).

**Side effects:** creates or retrieves a PR on the git host.

---

### `listPRs`

| Field | Value |
|---|---|
| **Registry key** | `listPRs` |
| **reads** | _(none)_ |
| **writes** | `listedPRs` |
| **Step config** | `state?: "open" \| "closed" \| "all"`, `head?: string` |
| **Source** | `packages/pipeline/src/phases/list-prs-phase.ts` |

Lists pull requests for the configured repository. Optionally filter by `state` (defaults to `"open"`) and by source `head` branch. Stores the result array under `listedPRs`.

**Failure modes:** git provider API error.

**Side effects:** one read API call to the git provider.

---

### `addComment`

| Field | Value |
|---|---|
| **Registry key** | `addComment` |
| **reads** | _(resolved at runtime from template)_ |
| **writes** | `commentIds` |
| **Step config** | `template?: "work-started" \| "analysis-summary" \| "plan-summary" \| "implementation-summary" \| "pr-opened" \| "review-waiting" \| "review-complete" \| "completed" \| "auto" \| "default"`, `body?: string` |
| **Source** | `packages/pipeline/src/phases/add-comment-phase.ts` |

Posts a comment on the ticket. Supply either `body` (verbatim text) or `template` for a built-in rendering. When both are omitted, the phase **auto-detects** the best template by scanning the artifact bag in priority order: `pr` → `pr-opened`, `implementation` → `implementation-summary`, `plan` → `plan-summary`, `analysis` → `analysis-summary`, `ticket` → `work-started`, fallback → `default`.

Use `template: "auto"` to make the auto-detect intent explicit. Use `template: "review-waiting"` or `template: "review-complete"` for review gate steps — these cannot be auto-detected. The created comment ID is stored under `commentIds.<stepId>` so multiple `addComment` steps in the same flow remain independent.

| Template | Reads | Renders |
|---|---|---|
| `work-started` | `ticket` | Ticket title + start message |
| `analysis-summary` | `analysis` | Complexity, readiness score, summary |
| `plan-summary` | `plan` | Step count, complexity, plan summary |
| `implementation-summary` | `implementation` | Files changed count, implementation summary |
| `pr-opened` | `pr` | PR URL |
| `review-waiting` | _(none)_ | Static "ready for review" message |
| `review-complete` | `${stepId}_outcome` | Review outcome (approved / rework-requested) |
| `completed` | `ticket`, `pr` | Completion message with PR link |
| `default` | _(none)_ | Generic checkpoint message |

**Failure modes:** ticket provider API error, missing artifact required by the chosen template.

**Side effects:** creates a comment on the ticket.

---

### `notify`

| Field | Value |
|---|---|
| **Registry key** | `notify` |
| **reads** | _(none)_ |
| **writes** | `notifications` |
| **Step config** | `channel?: string`, `template?: "analysis-summary" \| "pr-opened" \| "default"`, `message?: string`, `title?: string` |
| **Source** | `packages/pipeline/src/phases/notify-phase.ts` |

Sends a notification via the configured notification provider (e.g., Slack). `channel` is optional — when omitted the provider uses its configured default channel from `providerConfig.notification`. Supply either `message` (plain text, supports `#{ticket}` interpolation) or `template` for a structured built-in rendering. `title` is used as the notification heading when supported by the provider. Stores delivery receipts under `notifications`.

Valid `notification` provider ids: `slack` (external Slack webhook), `console` (logs to application logger — no external calls, suitable for local dev and CI).

**Failure modes:** notification provider API error, invalid `channel`.

**Side effects:** sends a message to the notification channel.

---

### `updateStatus`

| Field | Value |
|---|---|
| **Registry key** | `updateStatus` |
| **reads** | _(none)_ |
| **writes** | `statusHistory` |
| **Step config** | `status: string` (semantic name from `productConfig.ticketWorkflow.statuses`) |
| **Source** | `packages/pipeline/src/phases/update-status-phase.ts` |

Transitions the ticket to the status named by `config.status`, which is resolved through the product's `ticketWorkflow.statuses` map to the provider-specific status ID. Appends a `{ status, timestamp }` entry to `statusHistory`.

**Failure modes:** unknown status name (not in workflow map), provider transition error, invalid transition for current ticket state.

**Side effects:** mutates the ticket's status on the ticket provider.

---

### `cleanupRepos`

| Field | Value |
|---|---|
| **Registry key** | `cleanupRepos` |
| **reads** | `repoPaths` |
| **writes** | _(none)_ |
| **Step config** | _(none)_ |
| **Source** | `packages/pipeline/src/phases/cleanup-repos-phase.ts` |

Removes the locally cloned repository directories listed in `repoPaths` from disk. Intended as a final teardown step.

**Failure modes:** permission error deleting directories; missing path (logged and skipped).

**Side effects:** deletes directories from disk permanently.

---

### `review`

| Field | Value |
|---|---|
| **Registry key** | `review` |
| **reads** | _(none)_ |
| **writes** | _(none)_ |
| **Step config** | _(none)_ |
| **Source** | `packages/pipeline/src/phases/review-phase.ts` |

Stub gate phase that unconditionally returns `PhaseResult.blocked`, halting the pipeline run until a human operator resumes it. Used as a mandatory human-in-the-loop checkpoint between automated steps.

**Failure modes:** never fails; always blocks.

**Side effects:** none.

---

### `reviewLoop`

| Field | Value |
|---|---|
| **Registry key** | `reviewLoop` |
| **reads** | _(none declared; sub-phases declare their own reads)_ |
| **writes** | `${stepId}_cycles`, `${stepId}_outcome` (written at runtime) |
| **Step config** | `approveStatus: string`, `reworkStatus: string`, `onRework: string[]`, `maxCycles?: number` (default 3) |
| **Source** | `packages/pipeline/src/phases/review-loop-phase.ts` |

Generic compound review-loop phase. On first entry, blocks awaiting a ticket status change. When resumed, maps the literal `ctx.artifacts.__resumeStatus` to a semantic name via `productConfig.ticketWorkflow.statuses`:

- Matches `approveStatus` — returns `ok()` and records `${stepId}_outcome: "approved"`.
- Matches `reworkStatus` — executes each phase in `onRework` in order (pulled from `PhaseRegistry`), increments the per-step cycle counter, and re-blocks. If `maxCycles` would be exceeded, fails the run.
- Any other status — re-blocks awaiting the correct signal.

Cycle counters are scoped by `ctx.currentStepId` so multiple `reviewLoop` steps in the same flow don't collide.

**Failure modes:** `maxCycles` exceeded; sub-phase returns `failed` (propagated); sub-phase returns `blocked` unexpectedly (propagated).

**Side effects:** whatever the configured sub-phases do (e.g., `fetchPRComments` reads from the git provider; `implement` mutates files).

---

### `awaitTicketStatus`

| Field | Value |
|---|---|
| **Registry key** | `awaitTicketStatus` |
| **reads** | _(none)_ |
| **writes** | _(none)_ |
| **Step config** | `continueOn: string[]`, `failOn?: string[]` |
| **Source** | `packages/pipeline/src/phases/await-ticket-status-phase.ts` |

One-shot gate phase. Blocks until the run is resumed with a ticket status that maps (via `productConfig.ticketWorkflow.statuses`) to a semantic name listed in `continueOn`, at which point it returns `ok()`. If the resume status matches `failOn`, the phase fails the run. Unknown statuses cause the phase to re-block and wait for the correct signal.

Lighter-weight alternative to `reviewLoop` when no rework cycle is needed — just a "pause until human approves" checkpoint.

**Failure modes:** resumed with a status in `failOn` (fails with a descriptive message).

**Side effects:** none.

---

### `requireField`

| Field | Value |
|---|---|
| **Registry key** | `requireField` |
| **reads** | _(none declared; inspects ctx at runtime)_ |
| **writes** | _(none)_ |
| **Step config** | `artifact: string`, `field?: string` |
| **Source** | `packages/pipeline/src/phases/require-field-phase.ts` |

Validates that a named artifact (and optionally a specific field within it) is present and non-null in `ctx.artifacts`. If the check fails the phase returns `PhaseResult.blocked` with a descriptive reason, preventing downstream steps from operating on bad state. When `field` is omitted the entire artifact key is checked.

**Failure modes:** never throws; always blocks (never fails) when the condition is not met.

**Side effects:** none.

---

### `fetchTicketComments`

| Field | Value |
|---|---|
| **Registry key** | `fetchTicketComments` |
| **reads** | _(none; uses `ctx.ticketKey`)_ |
| **writes** | `reviewComments` |
| **Step config** | _(none)_ |
| **Source** | `packages/pipeline/src/phases/fetch-ticket-comments-phase.ts` |

Fetches the latest ticket comments via the ticket provider and writes a concatenated markdown string to `reviewComments` (oldest first, each entry prefixed with `**author** (timestamp):`). Downstream `analyze`, `plan`, and `implement` phases read this artifact and forward it to the coding provider as reviewer-feedback context.

**Failure modes:** ticket provider error.

**Side effects:** one read call to the ticket provider.

---

### `fetchPRComments`

| Field | Value |
|---|---|
| **Registry key** | `fetchPRComments` |
| **reads** | `prUrl` |
| **writes** | `reviewComments` |
| **Step config** | _(none)_ |
| **Source** | `packages/pipeline/src/phases/fetch-pr-comments-phase.ts` |

Fetches the PR's review comments (inline code comments with path/line) and issue comments (general PR discussion) via `IGitProvider.listPRComments`, merges and sorts them chronologically, and writes a concatenated markdown string to `reviewComments`.

**Failure modes:** git provider error; missing `prUrl` artifact (phase fails).

**Side effects:** two read calls to the git provider (review + issue comments).

---

### `listTickets`

| Field | Value |
|---|---|
| **Registry key** | `listTickets` |
| **reads** | _(none)_ |
| **writes** | `listedTickets` |
| **Step config** | `projectId?: string`, `status?: string`, `assignee?: string` |
| **Source** | `packages/pipeline/src/phases/list-tickets-phase.ts` |

Lists tickets from the configured ticket provider, optionally filtered by project, status, or assignee. Stores the result array under `listedTickets`.

**Failure modes:** ticket provider API error.

**Side effects:** one read API call to the ticket provider.

---

## Artifact Conventions

Each phase that produces data owns a top-level key in `ctx.artifacts`. Keys are camelCase and named after what was produced, not the phase that produced them.

| Key | Produced by | Shape summary |
|---|---|---|
| `ticket` | `getTicket` | Raw ticket object from the ticket provider |
| `ticketMd` | `getTicket` | Markdown string rendering of the ticket |
| `ticketSchema` | `getTicketSchema` | Field schema for the ticket project |
| `createdTicket` | `createTicket` | Newly created ticket object |
| `updatedTicket` | `updateTicket` | Updated ticket object |
| `listedTickets` | `listTickets` | Array of ticket objects matching the filter |
| `repoPaths` | `cloneRepos` | `Record<string, string>` — repo name → local absolute path |
| `primaryRepoPath` | `cloneRepos` | `string` — absolute path of the primary repo |
| `repoRefs` | `cloneRepos` | `Record<string, { sha: string; branch: string }>` |
| `workspacePath` | `createWorkspace` | `string` — absolute path of the scratch workspace directory |
| `repo` | `getRepo` | Repository metadata from the git provider |
| `listedPRs` | `listPRs` | Array of PR objects matching the filter |
| `checkoutResults` | `checkoutRepo` | `CheckoutResult[]` — one entry per repo (`dirPath`, `newBranch`, `success`, optional `error`). `newBranch` is ticket-keyed when a `ticket` artifact is present, otherwise animal-themed random. |
| `scannedRepos` | `scanRepos` | Structural scan summary of the primary repo |
| `analysis` | `analyze` | `AnalyzeResult` including `reportHandle: ArtifactHandle` |
| `plan` | `plan` | `PlanResult` including `reportHandle: ArtifactHandle` |
| `implementation` | `implement` | `ImplementResult` including `reportHandle: ArtifactHandle` |
| `commit` | `commitPushRepos` | `{ sha: string; branch: string; remoteUrl: string }` |
| `pr` | `createPR` | `{ url: string; number: number; title: string }` |
| `statusHistory` | `updateStatus` | `Array<{ status: string; timestamp: string }>` |
| `commentIds` | `addComment` | `Record<stepId, string>` — one entry per `addComment` step |
| `notifications` | `notify` | Delivery receipts from the notification provider |
| `reviewComments` | `fetchTicketComments`, `fetchPRComments` | Concatenated markdown string of comments |

Large blobs (analysis reports, plan documents, diffs) are not stored inline. The phase calls `ctx.artifactStore.putPath(...)` and stores the returned `ArtifactHandle` alongside the structured data. Consumers resolve the blob via `ctx.artifactStore.getPath(handle)` when they need the full content.

---

## `BasePhase` Helpers

All built-in phases extend `BasePhase`. The following helper methods cover the common return shapes and context access patterns.

| Method | Signature | Description |
|---|---|---|
| `this.ok` | `(artifacts: Record<string, unknown>) => PhaseResult` | Returns a successful result and merges `artifacts` into `ctx.artifacts`. |
| `this.blocked` | `(reason: string, waitFor?: "ticket-comment" \| "pr-comment" \| "manual", artifacts?: Record<string, unknown>) => PhaseResult` | Halts the run; runner preserves state so the flow can be resumed. `waitFor` signals what external action unblocks the step. `artifacts` are merged into `ctx.artifacts` immediately, before the block. |
| `this.failed` | `(message: string, code?: string) => PhaseResult` | Marks the run as errored; runner does not retry unless the step is configured as retriable. |
| `this.require<T>` | `(ctx: PipelineContext, key: string) => T` | Reads `ctx.artifacts[key]`, throws `PhaseError` if absent. Use for declared `reads` entries. |
| `this.optional<T>` | `(ctx: PipelineContext, key: string) => T \| undefined` | Returns `ctx.artifacts[key]` or `undefined` without throwing. Use for conditional reads. |

---

## Error Handling in Phases

Adapter calls (ticket provider, git provider, coding-cli) return result envelopes rather than throwing directly. Use the helpers from `adapter-unwrap.ts` to convert them to throws that the runner will catch and record as `PhaseResult.failed`:

```ts
import { unwrap, unwrapField } from "../../adapters/adapter-unwrap.ts";

// Throws if result.ok === false, otherwise returns result.value
const ticket = unwrap(await ticketProvider.getTicket(ctx.ticketId, { signal: ctx.signal }));

// Throws if result.value[field] is absent/null
const url = unwrapField(prResult, "url");
```

The runner wraps each `phase.run()` call in a try/catch. Any uncaught error is converted to `PhaseResult.failed` with the error message. Do not catch errors that represent genuine failures — let the runner handle them consistently.

---

## Cancellation

Pass `ctx.signal` into every adapter call that accepts an `AbortSignal`. The runner cancels the signal when the pipeline run is externally aborted (timeout, user cancel, process shutdown).

```ts
const result = await gitProvider.cloneRepos({ ...options, signal: ctx.signal });
```

Phases that perform multi-step loops should check `ctx.signal.aborted` between iterations and call `this.failed("cancelled")` (or allow the next adapter call to throw an `AbortError`).

---

## Using the Artifact Store

For large blobs, write to the artifact store and keep only a handle in `ctx.artifacts`:

```ts
// Write a local file into the store
const handle = await ctx.artifactStore.putPath(ctx.sessionId, "analysis-report", localReportPath);

// Store the handle alongside structured data
return this.ok({
  analysis: {
    summary: structured.summary,
    findings: structured.findings,
    reportHandle: handle,       // consumers resolve this when they need the full blob
  },
});
```

To read a blob back (e.g., in a downstream phase):

```ts
const analysis = this.require<AnalyzeResult>(ctx, "analysis");
const reportPath = await ctx.artifactStore.getPath(analysis.reportHandle);
```

Do not store large strings or binary data directly in `ctx.artifacts`; the artifact store is designed for that purpose and keeps the in-memory context lean.

---

## Writing a Custom Phase

Use this template as a starting point:

```ts
import { BasePhase } from "./base-phase.ts";
import type { PhaseResult, PipelineContext } from "@journeyman/core";

export class MyPhase extends BasePhase {
  readonly name = "myPhase";
  static reads = ["analysis"] as const;
  static writes = ["myOutput"] as const;

  async run(ctx: PipelineContext, config: { threshold?: number }): Promise<PhaseResult> {
    const analysis = this.require<AnalyzeResult>(ctx, "analysis");

    if (ctx.signal.aborted) {
      return this.failed("cancelled");
    }

    const threshold = config.threshold ?? 80;
    if (analysis.score < threshold) {
      return this.blocked(`analysis score ${analysis.score} below threshold ${threshold}`, "manual review");
    }

    // ... do work ...

    return this.ok({
      myOutput: {
        result: "...",
      },
    });
  }
}
```

Then register the phase in the server boot sequence so `PhaseRegistry` can resolve it:

```ts
phases.register("myPhase", () => new MyPhase());
```

Checklist before shipping a custom phase:

- [ ] `static reads` lists every artifact key the phase accesses via `this.require` or `this.optional`.
- [ ] `static writes` lists every key passed to `this.ok(...)`.
- [ ] All adapter calls receive `{ signal: ctx.signal }`.
- [ ] Adapter results pass through `unwrap()` / `unwrapField()` rather than being checked inline.
- [ ] The phase is registered before any flow that references it starts.
- [ ] The flow validator passes at boot (run `npm run typecheck` to catch key typos early).

---

## Flow Validator

At server boot, before any run is accepted, the flow validator performs a static analysis of every registered flow:

1. It begins with the set of artifact keys that are seeded into the context at run start (e.g., `ticketId`, `productConfig`).
2. For each step in declaration order it checks that every key in the phase's `static reads` is already present in the accumulated set.
3. It then adds the phase's `static writes` to the accumulated set.
4. If any `reads` entry is not satisfied, boot fails immediately with a message identifying the flow name, the step name, and the missing key.

Example boot error:

```
FlowValidationError: flow "default" step "plan" reads "analaysis" which is never written by a prior step.
  Did you mean "analysis"?
```

This means typos in artifact key names surface at deploy time, not during a live customer run.

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
