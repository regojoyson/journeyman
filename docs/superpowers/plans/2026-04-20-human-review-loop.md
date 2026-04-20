# Human Review Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a generic, phase-composable human review loop that gates and reworks any phase (analyze / plan / code) via ticket status-change webhooks.

**Architecture:** Resume re-runs the blocked step (instead of skipping past it) so a single `reviewLoop` phase can loop internally. The dispatcher routes status-change webhooks to `pipeline.resume(sessionId, { ticketStatus })` by looking up the blocked run via `findActiveForTicket(productId, ticketKey)`. Rework sub-phases are pulled from the same `PhaseRegistry` used by the runner.

**Tech Stack:** TypeScript, npm workspaces monorepo (`@journeyman/core`, `@journeyman/pipeline`, `@journeyman/pipeline-server`, `@journeyman/git-provider`, `@journeyman/coding-cli`), Fastify, Node 20+.

**Spec:** [docs/superpowers/specs/2026-04-20-human-review-loop-design.md](../specs/2026-04-20-human-review-loop-design.md)

---

## Execution strategy

Tasks are grouped into **waves**. Tasks within a wave touch disjoint files and can be dispatched to parallel subagents. Waves must run in order because later waves depend on types/interfaces declared in earlier ones.

- **Wave 0**: foundation — types, interfaces, BasePhase extension (must complete first)
- **Wave 1**: providers — Git listPRComments, coding-cli reviewComments threading (parallel)
- **Wave 2**: new phases — four new phase files (parallel, independent files)
- **Wave 3**: existing-phase updates — ReviewPhase / analyze / plan / implement (parallel, independent files)
- **Wave 4**: runner + dispatcher + webhook triggers (single task, tightly coupled)
- **Wave 5**: wiring — phase registry + config + docs + diagrams links (parallel)
- **Wave 6 (FINAL)**: `npm run typecheck` + run unit tests + **single commit**

**No per-task commits or typechecks.** The final wave validates the entire change set and commits once.

---

## File Structure

### New files

| File | Purpose |
|---|---|
| `packages/pipeline/src/phases/review-loop-phase.ts` | Generic compound review-loop phase |
| `packages/pipeline/src/phases/await-ticket-status-phase.ts` | Simple one-shot gate phase |
| `packages/pipeline/src/phases/fetch-ticket-comments-phase.ts` | Writes `reviewComments` from ticket |
| `packages/pipeline/src/phases/fetch-pr-comments-phase.ts` | Writes `reviewComments` from PR |
| `packages/git-provider/src/providers/github/operations/list-pr-comments.ts` | GitHub impl of `listPRComments` |
| `config/flows/human-loop.yaml` | Ready-to-use human-loop flow |
| `packages/pipeline/src/phases/review-loop-phase.test.ts` | Unit tests for review-loop |
| `packages/pipeline/src/phases/await-ticket-status-phase.test.ts` | Unit tests for await-ticket-status |

### Modified files

| File | What changes |
|---|---|
| `packages/core/src/types/pipeline.types.ts` | `PipelineTrigger.eventType/newStatus`; `PhaseResult.blocked.artifacts?` |
| `packages/core/src/interfaces/pipeline.interface.ts` | `PipelineContext.currentStepId` |
| `packages/core/src/types/coding.types.ts` | `AnalyzeOptions/PlanOptions/ImplementOptions.reviewComments?` |
| `packages/core/src/types/git.types.ts` | `ListPRCommentsOptions`, `ListPRCommentsResult` |
| `packages/core/src/interfaces/git-provider.interface.ts` | `listPRComments()` method |
| `packages/pipeline/src/phases/base-phase.ts` | `blocked(reason, waitFor, artifacts?)` signature |
| `packages/pipeline/src/phases/review-phase.ts` | Honor `__resumed` flag |
| `packages/pipeline/src/phases/analyze-phase.ts` | Thread `reviewComments` |
| `packages/pipeline/src/phases/plan-phase.ts` | Thread `reviewComments` |
| `packages/pipeline/src/phases/implement-phase.ts` | Thread `reviewComments` |
| `packages/pipeline/src/pipeline.ts` | `resume(sessionId, opts?)` re-runs blocked step |
| `packages/pipeline/src/context.ts` | Inject `currentStepId` per step |
| `packages/pipeline/src/index.ts` | Export new phases |
| `packages/pipeline-server/src/main.ts` | Register new phases |
| `packages/pipeline-server/src/dispatch.ts` | Route status-change → resume |
| `packages/pipeline-server/src/api/resume.ts` | Accept optional `{ ticketStatus }` body |
| `packages/pipeline-server/src/triggers/github-webhook-trigger.ts` | Classify events |
| `packages/pipeline-server/src/triggers/jira-webhook-trigger.ts` | Classify events |
| `packages/git-provider/src/providers/github/index.ts` | Wire `listPRComments` |
| `packages/git-provider/src/providers/gitlab/index.ts` | Stub `listPRComments` |
| `packages/coding-cli/src/providers/claude/operations/{analyze,plan,implement}.ts` | Thread `reviewComments` into prompt |
| `docs/phases.md` | Add catalog entries |
| `docs/flows.md` | Add human-loop section |
| `docs/configuration.md` | Status mapping guidance |
| `docs/triggers.md` | Event-type mapping + dispatcher table |
| `docs/pipeline-server.md` | `resume()` new semantics |
| `docs/new-product.md` | Opt-in subsection |

---

## Wave 0 — Foundation

### Task 0.1: Core type and interface changes

**Files:**
- Modify: `packages/core/src/types/pipeline.types.ts`
- Modify: `packages/core/src/types/coding.types.ts`
- Modify: `packages/core/src/types/git.types.ts`
- Modify: `packages/core/src/interfaces/pipeline.interface.ts`
- Modify: `packages/core/src/interfaces/git-provider.interface.ts`
- Modify: `packages/pipeline/src/phases/base-phase.ts`

- [ ] **Step 1: Extend `PhaseResult` to carry blocked-artifacts**

In `packages/core/src/types/pipeline.types.ts`, replace the `PhaseResult` union:

```typescript
export type PhaseResult =
  | { status: "ok"; artifacts: Record<string, unknown> }
  | {
      status: "blocked";
      reason: string;
      waitFor?: "ticket-comment" | "pr-comment" | "manual";
      artifacts?: Record<string, unknown>;   // NEW — merged into run before blocking
    }
  | { status: "failed"; error: { message: string; code?: string; stack?: string } };
```

- [ ] **Step 2: Extend `PipelineTrigger` with event metadata**

In the same file, update `PipelineTrigger`:

```typescript
export type PipelineTrigger = {
  sourceId: string;
  productId: string;
  ticketKey: string;
  ticketShortKey: string;
  flowName?: string;
  rawPayload: unknown;
  receivedAt: string;
  eventType?: "new-ticket" | "status-change" | "comment";   // NEW
  newStatus?: string;                                         // NEW — literal status value
};
```

- [ ] **Step 3: Add `currentStepId` to `PipelineContext`**

In `packages/core/src/interfaces/pipeline.interface.ts`, add to `PipelineContext`:

```typescript
export interface PipelineContext {
  sessionId: string;
  productId: string;
  ticketKey: string;
  ticketShortKey: string;
  flowName: string;
  workspaceDir: string;
  signal: AbortSignal;
  productConfig: ProductConfig;
  providers: {
    ticket: ITicketProvider;
    git: IGitProvider;
    coding: ICodingCLI;
    notification: INotificationProvider;
  };
  artifacts: Record<string, unknown>;
  state: Readonly<PipelineRun>;
  trace: ITraceLogger;
  artifactStore: IArtifactStore;
  emit: (event: PipelineEvent) => void;
  currentStepId: string;                       // NEW
}
```

- [ ] **Step 4: Add `reviewComments` to coding option types**

In `packages/core/src/types/coding.types.ts`, add the field to all three options types. Replace each type as follows:

```typescript
export type AnalyzeOptions = SessionOptions & {
  dirPath: string;
  ticketContent?: string;
  focus?: string;
  /** Optional — reviewer feedback (markdown) to incorporate into analysis. */
  reviewComments?: string;
  signal?: AbortSignal;
};

export type PlanOptions = SessionOptions & {
  dirPath: string;
  ticketContent?: string;
  analyzeReportPath?: string;
  focus?: string;
  /** Optional — reviewer feedback (markdown) to incorporate into the plan. */
  reviewComments?: string;
  signal?: AbortSignal;
};

export type ImplementOptions = SessionOptions & {
  dirPath: string;
  ticketContent?: string;
  analyzeReportPath?: string;
  planReportPath?: string;
  extraRules?: string[];
  focus?: string;
  /** Optional — reviewer feedback (markdown) to incorporate during implementation. */
  reviewComments?: string;
  signal?: AbortSignal;
};
```

- [ ] **Step 5: Add PR-comment list types**

In `packages/core/src/types/git.types.ts`, append at the end:

```typescript
// ---------------------------------------------------------------------------
// PR review comment listing (used by reviewLoop rework flows)
// ---------------------------------------------------------------------------

export type ListPRCommentsOptions = SessionOptions & {
  prUrl: string;
  /** ISO8601 — if set, only comments created at or after this time are returned. */
  sinceIso?: string;
};

export type PRComment = {
  author: string;
  body: string;
  path?: string;
  line?: number;
  createdAt: string;   // ISO 8601
};

export type ListPRCommentsResult = SessionResult & {
  comments: PRComment[];
  error?: string;
};
```

- [ ] **Step 6: Add `listPRComments` to `IGitProvider`**

In `packages/core/src/interfaces/git-provider.interface.ts`:

```typescript
import type {
  CreatePROptions, CreatePRResult,
  GetRepoOptions, GetRepoResult,
  ListPROptions, ListPRResult,
  CloneReposOptions, CloneReposResult,
  ListPRCommentsOptions, ListPRCommentsResult,
} from "../types/git.types.ts";

export interface IGitProvider {
  getRepo(opts: GetRepoOptions): Promise<GetRepoResult>;
  createPR(opts: CreatePROptions): Promise<CreatePRResult>;
  listPRs(opts: ListPROptions): Promise<ListPRResult>;
  cloneRepos(opts: CloneReposOptions): Promise<CloneReposResult>;
  listPRComments(opts: ListPRCommentsOptions): Promise<ListPRCommentsResult>;
}
```

- [ ] **Step 7: Extend `BasePhase.blocked()` to accept artifacts**

In `packages/pipeline/src/phases/base-phase.ts`, replace the `blocked` method:

```typescript
protected blocked(
  reason: string,
  waitFor?: "ticket-comment" | "pr-comment" | "manual",
  artifacts?: Record<string, unknown>,
): PhaseResult {
  return { status: "blocked", reason, waitFor, artifacts };
}
```

- [ ] **Step 8: Export new types from `@journeyman/core`**

Verify `packages/core/src/index.ts` re-exports from `types/git.types.ts` and `types/coding.types.ts` via a wildcard. If not, add explicit exports for `ListPRCommentsOptions`, `ListPRCommentsResult`, `PRComment`. (Check existing export style before editing.)

---

## Wave 1 — Providers (PARALLEL)

### Task 1.1: GitHub `listPRComments` implementation

**Files:**
- Create: `packages/git-provider/src/providers/github/operations/list-pr-comments.ts`
- Modify: `packages/git-provider/src/providers/github/index.ts`
- Modify: `packages/git-provider/src/providers/gitlab/index.ts`

- [ ] **Step 1: Create `list-pr-comments.ts`**

Follow the pattern used by `packages/git-provider/src/providers/github/operations/create-pr.ts`. The operation combines issue-comments and review-comments on the PR number, normalizing into `PRComment[]`.

```typescript
/**
 * @file list-pr-comments.ts
 * List review + issue comments on a GitHub pull request.
 *
 * Combines `octokit.pulls.listReviewComments` (inline code comments with path/line)
 * and `octokit.issues.listComments` (general PR discussion, no path/line) into a
 * single, chronologically-sorted PRComment[].
 */

import type { GitHubClient } from "@journeyman/github-api";
import type { ListPRCommentsOptions, ListPRCommentsResult, PRComment } from "@journeyman/core";

type Deps = { client: GitHubClient };

export async function listPRComments(
  opts: ListPRCommentsOptions,
  { client }: Deps,
): Promise<ListPRCommentsResult> {
  try {
    const parsed = parsePrUrl(opts.prUrl);
    if (!parsed) {
      return { sessionId: opts.sessionId, success: false, comments: [], error: `invalid prUrl: ${opts.prUrl}` };
    }
    const { owner, repo, number } = parsed;

    const [reviews, issue] = await Promise.all([
      client.rest.paginate(client.rest.pulls.listReviewComments, { owner, repo, pull_number: number, per_page: 100 }),
      client.rest.paginate(client.rest.issues.listComments, { owner, repo, issue_number: number, per_page: 100 }),
    ]);

    const reviewComments: PRComment[] = reviews.map((c: any) => ({
      author: c.user?.login ?? "unknown",
      body: c.body ?? "",
      path: c.path ?? undefined,
      line: c.line ?? c.original_line ?? undefined,
      createdAt: c.created_at,
    }));
    const issueComments: PRComment[] = issue.map((c: any) => ({
      author: c.user?.login ?? "unknown",
      body: c.body ?? "",
      createdAt: c.created_at,
    }));

    let comments = [...reviewComments, ...issueComments]
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    if (opts.sinceIso) {
      const since = opts.sinceIso;
      comments = comments.filter(c => c.createdAt >= since);
    }

    return { sessionId: opts.sessionId, success: true, comments };
  } catch (err: any) {
    return {
      sessionId: opts.sessionId,
      success: false,
      comments: [],
      error: err?.message ?? String(err),
    };
  }
}

/** Parse "https://github.com/owner/repo/pull/42" → { owner, repo, number }. */
function parsePrUrl(url: string): { owner: string; repo: string; number: number } | null {
  const m = url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  if (!m) return null;
  return { owner: m[1], repo: m[2], number: parseInt(m[3], 10) };
}
```

- [ ] **Step 2: Wire into `GitHubProvider`**

Add the method in `packages/git-provider/src/providers/github/index.ts`. Follow the existing delegation pattern used by `createPR` / `getRepo`. Add to the class:

```typescript
import { listPRComments } from "./operations/list-pr-comments.ts";

// ... inside GitHubProvider class:
async listPRComments(opts: ListPRCommentsOptions): Promise<ListPRCommentsResult> {
  return listPRComments(opts, { client: this.client });
}
```

Also add the import for `ListPRCommentsOptions` / `ListPRCommentsResult` from `@journeyman/core` at the top of the file, next to other option-type imports.

- [ ] **Step 3: Stub `GitLabProvider.listPRComments`**

In `packages/git-provider/src/providers/gitlab/index.ts`, add per the project's stub convention:

```typescript
async listPRComments(_opts: ListPRCommentsOptions): Promise<ListPRCommentsResult> {
  throw new Error("GitLabProvider.listPRComments not implemented");
}
```

Add the option type imports at the top.

---

### Task 1.2: Thread `reviewComments` through Claude coding operations

**Files:**
- Modify: `packages/coding-cli/src/providers/claude/operations/analyze.ts`
- Modify: `packages/coding-cli/src/providers/claude/operations/plan.ts`
- Modify: `packages/coding-cli/src/providers/claude/operations/implement.ts`

For each file, locate the prompt construction and append a reviewer-feedback section when `opts.reviewComments` is non-empty. The addition is purely string concatenation — do not change the SDK `query()` config.

- [ ] **Step 1: `analyze.ts` — prepend feedback block**

In `analyze.ts`, where the prompt string is assembled, insert this block just above the existing ticket content section:

```typescript
const reviewBlock = opts.reviewComments
  ? `\n\n## Reviewer feedback (incorporate into the revised analysis)\n\n${opts.reviewComments}\n`
  : "";

// Then include `reviewBlock` in the prompt string, e.g.:
const prompt = `...existing intro...${reviewBlock}...existing ticket section...`;
```

The exact insertion point: just before any `ticketContent` interpolation.

- [ ] **Step 2: `plan.ts` — identical pattern**

Same block, inserted before the ticket/plan intro section of the prompt. Use the heading `## Reviewer feedback (address in the revised plan)`.

- [ ] **Step 3: `implement.ts` — identical pattern**

Same block, heading `## Reviewer feedback (address during implementation)`. Insert before the plan/ticket section.

No behavior change when `reviewComments` is undefined — the empty string concatenates cleanly.

- [ ] **Step 4: (No changes required in GeminiProvider / CodexProvider / OpenCodeProvider stubs.)** Their existing signatures take the full options object and ignore unknown fields.

---

## Wave 2 — New Phases (PARALLEL)

### Task 2.1: `FetchTicketCommentsPhase`

**Files:**
- Create: `packages/pipeline/src/phases/fetch-ticket-comments-phase.ts`

- [ ] **Step 1: Create the phase**

```typescript
/**
 * @file fetch-ticket-comments-phase.ts
 * Fetches the latest ticket comments and writes them to `reviewComments` for
 * downstream phases (analyze / plan / implement) to consume as feedback context.
 *
 * Reads:  none (uses ctx.ticketKey).
 * Writes: reviewComments — concatenated markdown string of all comments, oldest first.
 *
 * Failure modes: ticket provider error.
 * Side effects: one read call to the ticket provider.
 */

import { BasePhase } from "./base-phase.ts";
import type { PhaseResult, PipelineContext } from "@journeyman/core";

export class FetchTicketCommentsPhase extends BasePhase {
  readonly name = "fetchTicketComments";
  static reads = [] as const;
  static writes = ["reviewComments"] as const;

  async run(ctx: PipelineContext): Promise<PhaseResult> {
    const ticket = await ctx.providers.ticket.getTicket({
      ticketId: ctx.ticketKey,
      sessionId: ctx.sessionId,
      includeComments: true,
    } as any);

    const comments = (ticket as any).comments ?? [];
    const formatted = comments
      .map((c: any) => `**${c.author ?? "unknown"}** (${c.createdAt ?? ""}):\n\n${c.body ?? ""}`)
      .join("\n\n---\n\n");

    return this.ok({ reviewComments: formatted });
  }
}
```

Note: If `GetTicketOptions` in `@journeyman/core/types/ticket.types.ts` lacks an `includeComments` field, check the existing getTicket signature first; if it returns comments by default, drop the flag. Leave a TODO-free fallback that compiles against the current shape.

---

### Task 2.2: `FetchPRCommentsPhase`

**Files:**
- Create: `packages/pipeline/src/phases/fetch-pr-comments-phase.ts`

- [ ] **Step 1: Create the phase**

```typescript
/**
 * @file fetch-pr-comments-phase.ts
 * Fetches PR review and issue comments and writes them to `reviewComments`.
 *
 * Reads:  prUrl — PR URL from createPR phase.
 * Writes: reviewComments — concatenated markdown string, oldest first.
 *
 * Failure modes: git provider error, missing prUrl (fails the phase).
 * Side effects: two read calls to the git provider (review + issue comments).
 */

import { BasePhase } from "./base-phase.ts";
import { unwrap } from "../adapter-unwrap.ts";
import type { ListPRCommentsResult, PhaseResult, PipelineContext } from "@journeyman/core";

export class FetchPRCommentsPhase extends BasePhase {
  readonly name = "fetchPRComments";
  static reads = ["prUrl"] as const;
  static writes = ["reviewComments"] as const;

  async run(ctx: PipelineContext): Promise<PhaseResult> {
    const prUrl = this.require<string>(ctx, "prUrl");

    const result = unwrap(
      await ctx.providers.git.listPRComments({ prUrl, sessionId: ctx.sessionId }),
      "listPRComments",
    ) as ListPRCommentsResult;

    const formatted = result.comments
      .map(c => {
        const loc = c.path ? `\n*${c.path}${c.line ? `:${c.line}` : ""}*` : "";
        return `**${c.author}** (${c.createdAt}):${loc}\n\n${c.body}`;
      })
      .join("\n\n---\n\n");

    return this.ok({ reviewComments: formatted });
  }
}
```

---

### Task 2.3: `AwaitTicketStatusPhase`

**Files:**
- Create: `packages/pipeline/src/phases/await-ticket-status-phase.ts`
- Create: `packages/pipeline/src/phases/await-ticket-status-phase.test.ts`

- [ ] **Step 1: Create the phase**

```typescript
/**
 * @file await-ticket-status-phase.ts
 * One-shot gate that blocks until the run is resumed with a ticket status
 * listed in `continueOn`. If resumed with a status in `failOn`, fails the
 * run. Unknown statuses re-block (wait for the correct signal).
 *
 * Reads:  none. Writes: none.
 *
 * Config:
 *   continueOn: string[]   — semantic status names that unblock
 *   failOn?:    string[]   — semantic status names that fail the run
 */

import { BasePhase } from "./base-phase.ts";
import type { PhaseResult, PipelineContext } from "@journeyman/core";

export type AwaitTicketStatusConfig = {
  continueOn: string[];
  failOn?: string[];
};

export class AwaitTicketStatusPhase extends BasePhase {
  readonly name = "awaitTicketStatus";
  static reads = [] as const;
  static writes = [] as const;

  async run(ctx: PipelineContext, rawConfig: unknown): Promise<PhaseResult> {
    const config = (rawConfig ?? {}) as AwaitTicketStatusConfig;
    const resumeStatus = ctx.artifacts.__resumeStatus as string | undefined;

    if (!resumeStatus) {
      return this.blocked("awaiting ticket status change", "ticket-comment");
    }

    const semantic = resolveSemantic(ctx, resumeStatus);

    if (config.continueOn.includes(semantic)) return this.ok({});
    if (config.failOn?.includes(semantic)) return this.failed(`ticket moved to "${semantic}"`);

    return this.blocked(
      `ticket at "${semantic}", awaiting ${config.continueOn.join("|")}`,
      "ticket-comment",
    );
  }
}

/** Map literal ticket-status value → semantic name via ticketWorkflow.statuses. */
export function resolveSemantic(ctx: PipelineContext, literal: string): string {
  const map = ctx.productConfig.ticketWorkflow?.statuses ?? {};
  for (const [semantic, value] of Object.entries(map)) {
    if (value === literal) return semantic;
  }
  return literal;  // fallback — treat literal as semantic
}
```

- [ ] **Step 2: Write unit tests**

```typescript
/**
 * @file await-ticket-status-phase.test.ts
 */

import { describe, it, expect } from "vitest";
import { AwaitTicketStatusPhase, resolveSemantic } from "./await-ticket-status-phase.ts";
import type { PipelineContext } from "@journeyman/core";

function mkCtx(overrides: Partial<PipelineContext> = {}): PipelineContext {
  return {
    sessionId: "s1",
    productId: "p1",
    ticketKey: "t1",
    ticketShortKey: "t1",
    flowName: "f",
    workspaceDir: "/tmp",
    signal: new AbortController().signal,
    productConfig: {
      flow: "f", workspace: "/tmp", repos: [],
      ticketWorkflow: {
        statuses: {
          "plan-approved": "Plan Approved",
          "failed": "Failed",
        },
      },
    },
    providers: {} as any,
    artifacts: {},
    state: {} as any,
    trace: {} as any,
    artifactStore: {} as any,
    emit: () => {},
    currentStepId: "await-plan",
    ...overrides,
  };
}

describe("AwaitTicketStatusPhase", () => {
  it("blocks on first entry (no __resumeStatus)", async () => {
    const phase = new AwaitTicketStatusPhase();
    const result = await phase.run(mkCtx(), { continueOn: ["plan-approved"] });
    expect(result.status).toBe("blocked");
  });

  it("returns ok when resumed with a continueOn status", async () => {
    const phase = new AwaitTicketStatusPhase();
    const ctx = mkCtx({ artifacts: { __resumeStatus: "Plan Approved" } });
    const result = await phase.run(ctx, { continueOn: ["plan-approved"] });
    expect(result.status).toBe("ok");
  });

  it("fails when resumed with a failOn status", async () => {
    const phase = new AwaitTicketStatusPhase();
    const ctx = mkCtx({ artifacts: { __resumeStatus: "Failed" } });
    const result = await phase.run(ctx, { continueOn: ["plan-approved"], failOn: ["failed"] });
    expect(result.status).toBe("failed");
  });

  it("re-blocks on unknown status", async () => {
    const phase = new AwaitTicketStatusPhase();
    const ctx = mkCtx({ artifacts: { __resumeStatus: "Random" } });
    const result = await phase.run(ctx, { continueOn: ["plan-approved"] });
    expect(result.status).toBe("blocked");
  });
});

describe("resolveSemantic", () => {
  it("maps literal to semantic name", () => {
    const ctx = mkCtx();
    expect(resolveSemantic(ctx, "Plan Approved")).toBe("plan-approved");
  });

  it("falls back to the literal when no mapping exists", () => {
    const ctx = mkCtx();
    expect(resolveSemantic(ctx, "Nothing")).toBe("Nothing");
  });
});
```

---

### Task 2.4: `ReviewLoopPhase`

**Files:**
- Create: `packages/pipeline/src/phases/review-loop-phase.ts`
- Create: `packages/pipeline/src/phases/review-loop-phase.test.ts`

- [ ] **Step 1: Create the phase**

```typescript
/**
 * @file review-loop-phase.ts
 * Generic compound review-loop phase. Orchestrates configured sub-phases on
 * each rework cycle. Loops by returning `blocked` after every rework cycle.
 *
 * Config:
 *   approveStatus: string       — semantic status that exits the loop with ok
 *   reworkStatus:  string       — semantic status that triggers sub-phases
 *   onRework:      string[]     — ordered list of phase names to run on rework
 *   maxCycles?:    number       — default 3; exceeding fails the run
 *
 * Reads:  none (sub-phases declare their own reads)
 * Writes: `${stepId}_cycles`, `${stepId}_outcome`
 */

import { BasePhase } from "./base-phase.ts";
import type { PhaseResult, PipelineContext } from "@journeyman/core";
import type { PhaseRegistry } from "../registry/phase-registry.ts";
import { resolveSemantic } from "./await-ticket-status-phase.ts";

export type ReviewLoopConfig = {
  approveStatus: string;
  reworkStatus: string;
  onRework: string[];
  maxCycles?: number;
};

export class ReviewLoopPhase extends BasePhase {
  readonly name = "reviewLoop";
  static reads = [] as const;
  static writes = [] as const;

  constructor(private readonly registry: PhaseRegistry) { super(); }

  async run(ctx: PipelineContext, rawConfig: unknown): Promise<PhaseResult> {
    const config = rawConfig as ReviewLoopConfig;
    const maxCycles = config.maxCycles ?? 3;
    const cyclesKey = `${ctx.currentStepId}_cycles`;
    const outcomeKey = `${ctx.currentStepId}_outcome`;
    const cycles = (ctx.artifacts[cyclesKey] as number) ?? 0;
    const resumeStatus = ctx.artifacts.__resumeStatus as string | undefined;

    if (!resumeStatus) {
      return this.blocked("awaiting review", "ticket-comment");
    }

    const semantic = resolveSemantic(ctx, resumeStatus);

    if (semantic === config.approveStatus) {
      return this.ok({ [cyclesKey]: cycles, [outcomeKey]: "approved" });
    }

    if (semantic === config.reworkStatus) {
      if (cycles >= maxCycles) {
        return this.failed(`max rework cycles (${maxCycles}) exceeded`);
      }

      for (const phaseName of config.onRework) {
        const subPhase = this.registry.resolve(phaseName);
        const result = await subPhase.run(ctx, {});
        if (result.status === "failed") return result;
        if (result.status === "blocked") return result;
        Object.assign(ctx.artifacts, result.artifacts);
      }

      return this.blocked(
        `cycle ${cycles + 1} complete, awaiting review`,
        "ticket-comment",
        { [cyclesKey]: cycles + 1 },
      );
    }

    return this.blocked(
      `status "${semantic}" unhandled, awaiting ${config.approveStatus}|${config.reworkStatus}`,
      "ticket-comment",
    );
  }
}
```

- [ ] **Step 2: Write unit tests**

```typescript
/**
 * @file review-loop-phase.test.ts
 */

import { describe, it, expect, vi } from "vitest";
import { ReviewLoopPhase } from "./review-loop-phase.ts";
import { PhaseRegistry } from "../registry/phase-registry.ts";
import type { IPhase, PhaseResult, PipelineContext } from "@journeyman/core";

function mkCtx(overrides: Partial<PipelineContext> = {}): PipelineContext {
  return {
    sessionId: "s1", productId: "p1", ticketKey: "t1", ticketShortKey: "t1",
    flowName: "f", workspaceDir: "/tmp",
    signal: new AbortController().signal,
    productConfig: {
      flow: "f", workspace: "/tmp", repos: [],
      ticketWorkflow: {
        statuses: {
          "completed": "Completed",
          "rework-requested": "Rework",
        },
      },
    },
    providers: {} as any, artifacts: {}, state: {} as any,
    trace: {} as any, artifactStore: {} as any, emit: () => {},
    currentStepId: "code-review",
    ...overrides,
  };
}

function mkRegistryWith(name: string, phase: IPhase): PhaseRegistry {
  const reg = new PhaseRegistry();
  reg.register(name, () => phase);
  return reg;
}

const cfg = {
  approveStatus: "completed",
  reworkStatus: "rework-requested",
  onRework: ["fetchPRComments"],
  maxCycles: 2,
};

describe("ReviewLoopPhase", () => {
  it("blocks on first entry", async () => {
    const phase = new ReviewLoopPhase(new PhaseRegistry());
    const result = await phase.run(mkCtx(), cfg);
    expect(result.status).toBe("blocked");
  });

  it("returns ok on approve status", async () => {
    const phase = new ReviewLoopPhase(new PhaseRegistry());
    const ctx = mkCtx({ artifacts: { __resumeStatus: "Completed" } });
    const result = await phase.run(ctx, cfg) as Extract<PhaseResult, { status: "ok" }>;
    expect(result.status).toBe("ok");
    expect(result.artifacts["code-review_outcome"]).toBe("approved");
  });

  it("runs sub-phases and re-blocks on rework", async () => {
    const sub: IPhase = {
      name: "fetchPRComments",
      run: vi.fn().mockResolvedValue({ status: "ok", artifacts: { reviewComments: "c1" } }),
    };
    const phase = new ReviewLoopPhase(mkRegistryWith("fetchPRComments", sub));
    const ctx = mkCtx({ artifacts: { __resumeStatus: "Rework" } });

    const result = await phase.run(ctx, cfg) as Extract<PhaseResult, { status: "blocked" }>;
    expect(result.status).toBe("blocked");
    expect(result.artifacts?.["code-review_cycles"]).toBe(1);
    expect(ctx.artifacts.reviewComments).toBe("c1");
    expect(sub.run).toHaveBeenCalledOnce();
  });

  it("fails when maxCycles exceeded", async () => {
    const phase = new ReviewLoopPhase(new PhaseRegistry());
    const ctx = mkCtx({ artifacts: { __resumeStatus: "Rework", "code-review_cycles": 2 } });
    const result = await phase.run(ctx, cfg);
    expect(result.status).toBe("failed");
  });

  it("propagates sub-phase failure", async () => {
    const sub: IPhase = {
      name: "fetchPRComments",
      run: vi.fn().mockResolvedValue({ status: "failed", error: { message: "boom" } }),
    };
    const phase = new ReviewLoopPhase(mkRegistryWith("fetchPRComments", sub));
    const ctx = mkCtx({ artifacts: { __resumeStatus: "Rework" } });
    const result = await phase.run(ctx, cfg);
    expect(result.status).toBe("failed");
  });

  it("re-blocks on unhandled status", async () => {
    const phase = new ReviewLoopPhase(new PhaseRegistry());
    const ctx = mkCtx({ artifacts: { __resumeStatus: "Other" } });
    const result = await phase.run(ctx, cfg);
    expect(result.status).toBe("blocked");
  });
});
```

---

## Wave 3 — Existing Phase Updates (PARALLEL)

### Task 3.1: `ReviewPhase` — honor `__resumed`

**Files:**
- Modify: `packages/pipeline/src/phases/review-phase.ts`

- [ ] **Step 1: Update the phase**

Replace the contents of the `run()` method:

```typescript
async run(ctx: PipelineContext): Promise<PhaseResult> {
  if (ctx.artifacts.__resumed === true) return this.ok({});
  return this.blocked("awaiting human review", "pr-comment");
}
```

---

### Task 3.2: `AnalyzePhase` — pass `reviewComments`

**Files:**
- Modify: `packages/pipeline/src/phases/analyze-phase.ts`

- [ ] **Step 1: Forward `reviewComments` to the coding provider**

In the `analyze()` call inside `run()`, add one field:

```typescript
const result = unwrap(await ctx.providers.coding.analyze({
  dirPath: primaryRepoPath,
  ticketContent: ticketMd,
  reviewComments: ctx.artifacts.reviewComments as string | undefined,
  sessionId: ctx.sessionId,
  signal: ctx.signal,
}), "analyze") as AnalyzeResult;
```

---

### Task 3.3: `PlanPhase` — pass `reviewComments`

**Files:**
- Modify: `packages/pipeline/src/phases/plan-phase.ts`

- [ ] **Step 1: Forward `reviewComments`**

```typescript
const result = unwrap(await ctx.providers.coding.plan({
  dirPath: primaryRepoPath,
  ticketContent: ticketMd,
  analyzeReportPath: analysis.reportPath,
  reviewComments: ctx.artifacts.reviewComments as string | undefined,
  sessionId: ctx.sessionId,
  signal: ctx.signal,
}), "plan") as PlanResult;
```

---

### Task 3.4: `ImplementPhase` — pass `reviewComments`

**Files:**
- Modify: `packages/pipeline/src/phases/implement-phase.ts`

- [ ] **Step 1: Forward `reviewComments`**

```typescript
const result = unwrap(await ctx.providers.coding.implement({
  dirPath: primaryRepoPath,
  ticketContent: ticketMd,
  analyzeReportPath: analysis?.reportPath,
  planReportPath: plan.reportPath,
  reviewComments: ctx.artifacts.reviewComments as string | undefined,
  sessionId: ctx.sessionId,
  signal: ctx.signal,
}), "implement") as ImplementResult;
```

---

## Wave 4 — Runner, Dispatcher, Webhook Triggers

### Task 4.1: Pipeline runner — re-run blocked step on resume + currentStepId

**Files:**
- Modify: `packages/pipeline/src/context.ts`
- Modify: `packages/pipeline/src/pipeline.ts`
- Modify: `packages/pipeline-server/src/api/resume.ts`
- Modify: `packages/pipeline-server/src/dispatch.ts`

- [ ] **Step 1: Inject `currentStepId` per-step in `runStepWithAttempts`**

In `packages/pipeline/src/context.ts`, replace `buildContext` to accept an optional `currentStepId` (default empty string):

```typescript
export function buildContext(args: {
  run: PipelineRun;
  signal: AbortSignal;
  workspaceDir: string;
  productConfig: ProductConfig;
  providers: ResolvedProviders;
  trace: ITraceLogger;
  artifactStore: IArtifactStore;
  emit: (e: PipelineEvent) => void;
}): PipelineContext {
  const { run, signal, workspaceDir, productConfig, providers, trace, artifactStore, emit } = args;
  return {
    sessionId: run.sessionId,
    productId: run.productId,
    ticketKey: run.ticketKey,
    ticketShortKey: run.ticketShortKey,
    flowName: run.flowName,
    workspaceDir,
    signal,
    productConfig,
    providers,
    artifacts: run.artifacts,
    state: run,
    trace,
    artifactStore,
    emit,
    currentStepId: "",
  };
}
```

In `packages/pipeline/src/pipeline.ts`, inside `runStepWithAttempts`, where `stepCtx` is built, set `currentStepId`:

```typescript
const stepCtx = { ...ctx, signal: stepSignal, currentStepId: step.id };
```

- [ ] **Step 2: Update `Pipeline.resume()` signature and behavior**

Replace the `resume` method in `packages/pipeline/src/pipeline.ts`:

```typescript
/**
 * Resume a blocked run by RE-RUNNING the blocked step. The blocked step is
 * responsible for detecting resume state via ctx.artifacts.__resumeStatus and
 * deciding to ok / block again / fail. Transient artifacts (__resumeStatus,
 * __resumed) are cleared after the step returns.
 */
async resume(sessionId: string, opts?: { ticketStatus?: string }): Promise<PipelineRun> {
  log.info({ sessionId, ticketStatus: opts?.ticketStatus }, "run resume requested");
  const run = await this.deps.state.load(sessionId);
  if (!run) throw new Error(`no such run ${sessionId}`);
  if (run.status !== "blocked") throw new Error(`cannot resume ${sessionId}: status=${run.status}`);

  const productConfig = this.deps.getProductConfig(run.productId);
  const flow = run.flowSnapshot;
  const workspaceDir = join(productConfig.workspace, "runs", sessionId);
  mkdirSync(workspaceDir, { recursive: true });

  const ac = new AbortController();
  this.aborters.set(sessionId, ac);
  const providers = this.deps.resolveProviders(flow, productConfig);
  const ctx = buildContext({
    run, signal: ac.signal, workspaceDir, productConfig, providers,
    trace: this.deps.trace, artifactStore: this.deps.artifactStore,
    emit: (e) => this.emit(e),
  });

  const blockedRec = [...run.steps].reverse().find(s => s.status === "blocked");
  if (!blockedRec) throw new Error(`resume: no blocked step in run ${sessionId}`);
  const flowIdx = flow.steps.findIndex(s => s.id === blockedRec.id);
  if (flowIdx < 0) throw new Error(`resume: blocked step id "${blockedRec.id}" not in flow snapshot`);

  // Inject transient resume artifacts so the blocked step can react.
  if (opts?.ticketStatus !== undefined) run.artifacts.__resumeStatus = opts.ticketStatus;
  run.artifacts.__resumed = true;

  const now = () => new Date().toISOString();
  const from = run.status;
  run.status = "running";
  run.updatedAt = now();
  await this.deps.state.save(run);
  this.emit({ type: "statusChanged", sessionId, from, to: "running", at: now() });

  try {
    // Re-run blocked step, then continue forward through remaining steps.
    const stepsToRun = flow.steps.slice(flowIdx);
    for (const step of stepsToRun) {
      if (ac.signal.aborted) { await this.finish(run, "cancelled"); return run; }
      const result = await this.runStepWithAttempts(run, step, ctx, ac.signal);

      // After the first step (the re-run blocked step), clear transient flags.
      if (step.id === blockedRec.id) {
        delete run.artifacts.__resumeStatus;
        delete run.artifacts.__resumed;
        await this.deps.state.save(run);
      }

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
  }
}
```

- [ ] **Step 3: Ensure `runStepWithAttempts` persists blocked-artifacts**

In the same file, locate the block:

```typescript
} else if (last.status === "blocked") {
  rec.status = "blocked";
  rec.blockedReason = last.reason;
  rec.waitFor = last.waitFor;
}
```

Replace with:

```typescript
} else if (last.status === "blocked") {
  rec.status = "blocked";
  rec.blockedReason = last.reason;
  rec.waitFor = last.waitFor;
  if (last.artifacts) Object.assign(run.artifacts, last.artifacts);
}
```

- [ ] **Step 4: Extend `resume.ts` API to accept ticket status**

Replace the body of `packages/pipeline-server/src/api/resume.ts`:

```typescript
/**
 * @file resume.ts
 * POST /api/runs/:sessionId/resume — resume a blocked pipeline run.
 *
 * Optional JSON body: { ticketStatus?: string }
 * When provided, the ticket status is stored in ctx.artifacts.__resumeStatus so
 * the blocked phase can react (used by reviewLoop and awaitTicketStatus).
 */

import type { FastifyInstance } from "fastify";

export type PipelineLike = {
  resume(sessionId: string, opts?: { ticketStatus?: string }): Promise<any>;
};

export type ResumeApiDeps = { pipeline: PipelineLike };

export function registerResumeApi(app: FastifyInstance, deps: ResumeApiDeps) {
  app.post<{ Params: { sessionId: string }; Body?: { ticketStatus?: string } }>(
    "/api/runs/:sessionId/resume",
    async (req, reply) => {
      try {
        const opts = req.body && typeof req.body === "object" ? { ticketStatus: req.body.ticketStatus } : undefined;
        const run = await deps.pipeline.resume(req.params.sessionId, opts);
        return reply.send(run);
      } catch (err: any) {
        return reply.code(409).send({ error: err.message });
      }
    },
  );
}
```

- [ ] **Step 5: Update dispatcher routing**

Replace the body of `buildDispatcher` in `packages/pipeline-server/src/dispatch.ts`:

```typescript
export function buildDispatcher(deps: DispatchDeps): (trigger: PipelineTrigger) => Promise<DispatchResult> {
  return async (trigger) => {
    const { productId, flowName } = await deps.resolver.resolve(trigger);

    const existing = await deps.state.findActiveForTicket(productId, trigger.ticketKey);

    if (existing) {
      // Route status-change events for blocked runs → resume.
      if (existing.status === "blocked" && trigger.eventType === "status-change") {
        void (async () => {
          try {
            await deps.pipeline.resume(existing.sessionId, { ticketStatus: trigger.newStatus });
          } catch (err) {
            log.error({ err, sessionId: existing.sessionId }, "resume failure");
          }
        })();
        return { sessionId: existing.sessionId, resumed: true } as DispatchResult;
      }
      return { sessionId: existing.sessionId, deduplicated: true };
    }

    if (trigger.eventType === "status-change") {
      // No run to resume and this is not a fresh-start event — drop.
      return { deduplicated: true };
    }

    if (!deps.mutex.acquire(productId, trigger.ticketKey)) {
      return { deduplicated: true };
    }

    void (async () => {
      const release = await deps.semaphores.acquire(productId);
      try {
        const flow = await deps.flows.getFlow(flowName);
        await deps.pipeline.run({ trigger: { ...trigger, productId }, flow });
      } catch (err) {
        log.error({ err, ticketKey: trigger.ticketKey }, "dispatch failure");
      } finally {
        release();
        deps.mutex.release(productId, trigger.ticketKey);
      }
    })();

    return {};
  };
}
```

Also extend `DispatchResult`:

```typescript
export type DispatchResult = { sessionId?: string; deduplicated?: boolean; resumed?: boolean };
```

And update the `Pipeline`-like type that `DispatchDeps` expects if it's declared locally — confirm `Pipeline.resume` now has the `opts?` parameter. If `DispatchDeps.pipeline` is typed as the `Pipeline` class from `@journeyman/pipeline`, no change is needed.

---

### Task 4.2: Webhook triggers — classify events

**Files:**
- Modify: `packages/pipeline-server/src/triggers/github-webhook-trigger.ts`
- Modify: `packages/pipeline-server/src/triggers/jira-webhook-trigger.ts`

- [ ] **Step 1: GitHub — detect `labeled`/`unlabeled` as status-change**

In `github-webhook-trigger.ts`, inside the POST handler, after parsing `event` and `body`, determine `eventType` and `newStatus`:

```typescript
const action: string | undefined = body?.action;
let eventType: "new-ticket" | "status-change" | "comment" | undefined;
let newStatus: string | undefined;

if (event === "issues") {
  if (action === "labeled" || action === "unlabeled") {
    eventType = "status-change";
    newStatus = body?.label?.name;
  } else if (action === "opened" || action === "reopened") {
    eventType = "new-ticket";
  } else if (action === "created" && body?.comment) {
    eventType = "comment";
  }
} else if (event === "issue_comment") {
  eventType = "comment";
} else if (event === "pull_request") {
  if (action === "labeled" || action === "unlabeled") {
    eventType = "status-change";
    newStatus = body?.label?.name;
  }
}
```

Then include `eventType` and `newStatus` on the dispatched trigger:

```typescript
ctx.onTrigger({
  sourceId: this.id,
  productId,
  ticketKey,
  ticketShortKey,
  rawPayload: this.redact(body, event),
  receivedAt: new Date().toISOString(),
  eventType,
  newStatus,
});
```

- [ ] **Step 2: Jira — detect status transitions**

In `jira-webhook-trigger.ts`, parse the `changelog` from the `issue_updated` webhook:

```typescript
let eventType: "new-ticket" | "status-change" | "comment" | undefined;
let newStatus: string | undefined;

const webhookEvent: string = body?.webhookEvent ?? "";
if (webhookEvent === "jira:issue_created") {
  eventType = "new-ticket";
} else if (webhookEvent === "jira:issue_updated") {
  const items: any[] = body?.changelog?.items ?? [];
  const statusItem = items.find(i => i.field === "status");
  if (statusItem) {
    eventType = "status-change";
    newStatus = statusItem.toString;
  }
} else if (webhookEvent === "comment_created") {
  eventType = "comment";
}
```

Attach `eventType` / `newStatus` to the dispatched trigger. If the existing jira trigger file has a different structure, adapt the fields to fit — the principle is the same.

---

## Wave 5 — Wiring (PARALLEL)

### Task 5.1: Export + register new phases

**Files:**
- Modify: `packages/pipeline/src/index.ts`
- Modify: `packages/pipeline-server/src/main.ts`

- [ ] **Step 1: Export new phases**

In `packages/pipeline/src/index.ts`, add:

```typescript
export { ReviewLoopPhase } from "./phases/review-loop-phase.ts";
export { AwaitTicketStatusPhase } from "./phases/await-ticket-status-phase.ts";
export { FetchTicketCommentsPhase } from "./phases/fetch-ticket-comments-phase.ts";
export { FetchPRCommentsPhase } from "./phases/fetch-pr-comments-phase.ts";
```

- [ ] **Step 2: Register new phases in the server**

In `packages/pipeline-server/src/main.ts`, after the existing `phases.register(...)` block:

```typescript
phases.register("awaitTicketStatus",     () => new AwaitTicketStatusPhase());
phases.register("fetchTicketComments",   () => new FetchTicketCommentsPhase());
phases.register("fetchPRComments",       () => new FetchPRCommentsPhase());
phases.register("reviewLoop",            () => new ReviewLoopPhase(phases));
```

Note: `ReviewLoopPhase` receives the registry itself — registering it last is safe because phases are instantiated lazily via `() => ...`.

Add the corresponding imports at the top of `main.ts`:

```typescript
import {
  // ...existing imports
  ReviewLoopPhase,
  AwaitTicketStatusPhase,
  FetchTicketCommentsPhase,
  FetchPRCommentsPhase,
} from "@journeyman/pipeline";
```

---

### Task 5.2: Add `human-loop.yaml` flow

**Files:**
- Create: `config/flows/human-loop.yaml`

- [ ] **Step 1: Create the flow file**

Copy the YAML body from §7 of the design spec into `config/flows/human-loop.yaml` verbatim.

---

### Task 5.3: Docs updates

**Files:**
- Modify: `docs/phases.md`
- Modify: `docs/flows.md`
- Modify: `docs/configuration.md`
- Modify: `docs/triggers.md`
- Modify: `docs/pipeline-server.md`
- Modify: `docs/new-product.md`

- [ ] **Step 1: `docs/phases.md` — add four catalog entries**

Append four new subsections following the existing phase catalog format (registry key / reads / writes / step config / source / failure modes / side effects) for: `reviewLoop`, `awaitTicketStatus`, `fetchTicketComments`, `fetchPRComments`. Use the JSDoc at the top of each phase file as the authoritative description.

- [ ] **Step 2: `docs/flows.md` — add human-loop section**

Add a new top-level section "Human review loops" with:
- Pointer to the three diagrams in `docs/diagrams/human-loop-*.svg`
- The complete `human-loop.yaml` body (from §7 of the spec)
- Explanation of `approveStatus` / `reworkStatus` / `onRework` / `maxCycles`

- [ ] **Step 3: `docs/configuration.md` — status mapping guidance**

In the `ticketWorkflow.statuses` reference section, add a note listing the recommended semantic names when using `reviewLoop`: `analyze-approved`, `analyze-rework`, `plan-approved`, `plan-rework`, `rework-requested`, `completed`, `failed`.

- [ ] **Step 4: `docs/triggers.md` — event-type + dispatcher table**

Add a subsection "Status-change routing" with the dispatcher routing table from §3.2 of the spec and the GitHub/Jira event-type classification rules from §6.

- [ ] **Step 5: `docs/pipeline-server.md` — resume semantics**

Update any description of `POST /api/runs/:sessionId/resume` to reflect the new body (`{ ticketStatus?: string }`) and the semantic ("re-runs the blocked step").

- [ ] **Step 6: `docs/new-product.md` — opt-in subsection**

Append a "Using the human-loop flow" subsection pointing readers at `config/flows/human-loop.yaml` and the example product config from §10.2.2 of the spec.

---

### Task 5.4: Phase-validator sanity check

**Files:**
- Modify (if needed): `packages/pipeline/src/config/flow-validator.ts`

- [ ] **Step 1: Verify `reviewLoop` validates**

The validator walks `reads`/`writes` for each step. `reviewLoop` declares empty reads/writes because the sub-phases it calls handle their own artifact flow. Confirm that a flow containing `reviewLoop` with `onRework: [fetchPRComments, plan, implement, commitPushRepos]` passes validation — specifically that the `prUrl` reads of `fetchPRComments` are satisfied by the earlier `createPR` step in the flow.

If the validator today inspects only top-level step ids (not `config.onRework`), no change is needed — the sub-phases are invoked at runtime and not surfaced as their own steps. Document this as a known gap in section "Failure modes" of `docs/flows.md`: misconfiguration of `onRework` is only caught at run time.

No code change expected — this task is a verification pass.

---

## Wave 6 — Final Validation + Single Commit

### Task 6.1: Typecheck, unit test, commit

**Files:** (touches all modified/created files from previous waves)

- [ ] **Step 1: Typecheck**

Run:
```bash
cd /Users/admin/data/workspace/claude-skils/journeyman/.claude/worktrees/elated-goldstine-2760e3 && npm run typecheck
```
Expected: zero errors. If errors appear, fix them inline and re-run. Common issues: missing type imports at the top of modified files (add them), or stale `as any` casts that need concrete types.

- [ ] **Step 2: Run unit tests**

Run:
```bash
cd /Users/admin/data/workspace/claude-skils/journeyman/.claude/worktrees/elated-goldstine-2760e3 && npm test
```
Expected: all tests pass, including the two new test files (`await-ticket-status-phase.test.ts`, `review-loop-phase.test.ts`). If the project uses a different test command (check `package.json#scripts.test`), use that. Fix any regressions inline.

- [ ] **Step 3: Stage all changes**

```bash
git add packages/ config/flows/human-loop.yaml docs/phases.md docs/flows.md docs/configuration.md docs/triggers.md docs/pipeline-server.md docs/new-product.md docs/diagrams/human-loop-overview.svg docs/diagrams/human-loop-sequence.svg docs/diagrams/human-loop-states.svg docs/superpowers/specs/2026-04-20-human-review-loop-design.md docs/superpowers/plans/2026-04-20-human-review-loop.md
```

- [ ] **Step 4: Create single commit**

```bash
git commit -m "$(cat <<'EOF'
feat: human review loop — generic phase-composable gates for analyze/plan/code

Introduces a reusable reviewLoop phase that gates any pipeline step on a
ticket status change and loops through configured rework sub-phases until
the reviewer approves (or maxCycles is hit).

- Resume re-runs the blocked step (pipeline.resume semantics change).
- Status-change webhooks auto-resume blocked runs via findActiveForTicket.
- New phases: reviewLoop, awaitTicketStatus, fetchTicketComments, fetchPRComments.
- analyze/plan/implement now forward a reviewComments option.
- IGitProvider.listPRComments added (GitHub impl; GitLab stub).
- PipelineTrigger gains eventType + newStatus; dispatcher routes accordingly.
- config/flows/human-loop.yaml added as a ready-to-use flow.
- Docs + three SVG diagrams added.

Spec:  docs/superpowers/specs/2026-04-20-human-review-loop-design.md
Plan:  docs/superpowers/plans/2026-04-20-human-review-loop.md

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 5: Verify commit**

```bash
git status && git log --oneline -1
```
Expected: clean working tree, most recent commit is the feature commit above.

---

## Parallel execution notes

When dispatching subagents:

- **Wave 0 must be a single agent** (types and interfaces are interdependent).
- **Waves 1, 2, 3, 5** can each be dispatched as N parallel agents (one per task). Each agent gets only its task's file list to avoid cross-contamination.
- **Wave 4 is a single agent** (runner + dispatcher + webhooks form a tight coupling; splitting invites merge issues).
- **Wave 6 is a single agent** and must run after all prior waves complete.

To minimize token usage in subagents: give each agent only the task description + the spec path (`docs/superpowers/specs/2026-04-20-human-review-loop-design.md`) for context. Do not paste the full plan.

---

## Self-review summary

- **Spec coverage:** every section of the spec (§3–§10.2) has a corresponding task.
- **Type consistency:** `reviewComments` field name consistent across Analyze/Plan/Implement options and phases; `__resumeStatus` / `__resumed` flag names consistent across runner, phases, tests; `${stepId}_cycles` / `${stepId}_outcome` artifact keys consistent between `ReviewLoopPhase` and its tests.
- **No placeholders:** every code step contains complete code; every command has expected output.
- **Dependency order:** Wave 0 (types) blocks everything; runner change (4.1) depends on 0 and 3 (BasePhase); phase registration (5.1) depends on phases existing (wave 2); final validation runs last.
