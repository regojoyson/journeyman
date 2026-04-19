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

### `checkoutRepo`

| Field | Value |
|---|---|
| **Registry key** | `checkoutRepo` |
| **reads** | `repoPaths` |
| **writes** | `checkoutResults` |
| **Step config** | _(none)_ |
| **Source** | `packages/pipeline/src/phases/checkout-repo-phase.ts` |

Hard-resets each cloned repo in `repoPaths` to its configured default branch (from `productConfig.repos[i].defaultBranch`, falling back to `"main"`) and checks out a fresh feature branch via the `coding` provider's `checkoutRepo` operation. Useful as a cleanup step between retries or before re-running implement, ensuring the working tree is in a known-good state. Stores per-repo results under `checkoutResults`.

**Failure modes:** any individual repo reports an `error` (phase fails with that message); coding-cli provider error; cancellation via `ctx.signal`.

**Side effects:** performs `git reset` and `git checkout` on local disk.

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
| **Step config** | `pattern?: string`, `prSummaryStyle?: "conventional" \| "plain"` |
| **Source** | `packages/pipeline/src/phases/commit-push-repos-phase.ts` |

Commits all staged changes in the primary repo using a commit message derived from the ticket and plan (applying `pattern` if provided), then pushes to the remote branch. Stores commit metadata (SHA, branch, remote URL) under `commit`.

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

### `addComment`

| Field | Value |
|---|---|
| **Registry key** | `addComment` |
| **reads** | _(resolved at runtime from template)_ |
| **writes** | `commentIds.<stepId>` |
| **Step config** | `template?: "analysis-summary" \| "pr-opened" \| "default"`, `body?: string` |
| **Source** | `packages/pipeline/src/phases/add-comment-phase.ts` |

Posts a comment on the ticket. Supply either `body` (verbatim text) or `template` to use a built-in rendering. Template `"analysis-summary"` renders from `analysis`, `"pr-opened"` renders from `pr`, and `"default"` posts a generic status update. The created comment ID is stored under `commentIds.<stepId>` so multiple `addComment` steps in the same flow remain independent.

**Failure modes:** ticket provider API error, missing artifact required by the chosen template.

**Side effects:** creates a comment on the ticket.

---

### `updateStatus`

| Field | Value |
|---|---|
| **Registry key** | `updateStatus` |
| **reads** | _(none declared)_ |
| **writes** | `statusHistory` |
| **Step config** | `status: string` (semantic name from `productConfig.ticketWorkflow.statuses`) |
| **Source** | `packages/pipeline/src/phases/update-status-phase.ts` |

Transitions the ticket to the status named by `config.status`, which is resolved through the product's `ticketWorkflow.statuses` map to the provider-specific status ID. Appends a `{ status, timestamp }` entry to `statusHistory`.

**Failure modes:** unknown status name (not in workflow map), provider transition error, invalid transition for current ticket state.

**Side effects:** mutates the ticket's status on the ticket provider.

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

## Artifact Conventions

Each phase that produces data owns a top-level key in `ctx.artifacts`. Keys are camelCase and named after what was produced, not the phase that produced them.

| Key | Produced by | Shape summary |
|---|---|---|
| `ticket` | `getTicket` | Raw ticket object from the ticket provider |
| `ticketMd` | `getTicket` | Markdown string rendering of the ticket |
| `repoPaths` | `cloneRepos` | `Record<string, string>` — repo name → local absolute path |
| `primaryRepoPath` | `cloneRepos` | `string` — absolute path of the primary repo |
| `repoRefs` | `cloneRepos` | `Record<string, { sha: string; branch: string }>` |
| `checkoutResults` | `checkoutRepo` | `CheckoutResult[]` — one entry per repo (`dirPath`, `newBranch`, `success`, optional `error`) |
| `analysis` | `analyze` | `AnalyzeResult` including `reportHandle: ArtifactHandle` |
| `plan` | `plan` | `PlanResult` including `reportHandle: ArtifactHandle` |
| `implementation` | `implement` | `ImplementResult` including `reportHandle: ArtifactHandle` |
| `commit` | `commitPushRepos` | `{ sha: string; branch: string; remoteUrl: string }` |
| `pr` | `createPR` | `{ url: string; number: number; title: string }` |
| `statusHistory` | `updateStatus` | `Array<{ status: string; timestamp: string }>` |
| `commentIds` | `addComment` | `Record<stepId, string>` — one entry per `addComment` step |

Large blobs (analysis reports, plan documents, diffs) are not stored inline. The phase calls `ctx.artifactStore.putPath(...)` and stores the returned `ArtifactHandle` alongside the structured data. Consumers resolve the blob via `ctx.artifactStore.getPath(handle)` when they need the full content.

---

## `BasePhase` Helpers

All built-in phases extend `BasePhase`. The following helper methods cover the common return shapes and context access patterns.

| Method | Signature | Description |
|---|---|---|
| `this.ok` | `(artifacts: Record<string, unknown>) => PhaseResult` | Returns a successful result and merges `artifacts` into `ctx.artifacts`. |
| `this.blocked` | `(reason: string, waitFor?: string) => PhaseResult` | Halts the run; runner preserves state so the flow can be resumed. `waitFor` is a human-readable label for what approval is needed. |
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
