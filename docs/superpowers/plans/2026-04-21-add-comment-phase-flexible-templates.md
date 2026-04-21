# AddCommentPhase Flexible Template Registry — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract all comment rendering from `AddCommentPhase` into a standalone template registry, add 6 new templates, and make the phase auto-detect the best template when none is specified.

**Architecture:** A new `comment-templates.ts` file exports a `commentTemplates` registry map (template key → renderer function) and a `selectTemplate(ctx)` function that scans artifacts in priority order. `AddCommentPhase` delegates entirely to these exports — no template logic lives in the phase class.

**Tech Stack:** TypeScript, Vitest, `@journeyman/core` types (`PipelineContext`, `AnalyzeResult`, `PlanResult`, `ImplementResult`, `Ticket`)

---

## File Map

| File | Action |
|---|---|
| `packages/pipeline/src/phases/comment-templates.ts` | **Create** — registry map, all renderers, `selectTemplate()`, `renderComment()` |
| `packages/pipeline/src/phases/comment-templates.test.ts` | **Create** — unit tests for registry and auto-detect |
| `packages/pipeline/src/phases/add-comment-phase.ts` | **Modify** — delegate to registry; expand `Config` type |
| `packages/pipeline/src/phases/add-comment-phase.test.ts` | **Create** — integration tests for the phase |
| `docs/phases.md` | **Modify** — update `addComment` catalog entry |

---

## Task 1: Create `comment-templates.test.ts` (failing tests)

**Files:**
- Create: `packages/pipeline/src/phases/comment-templates.test.ts`

- [ ] **Step 1.1: Write the test file**

```typescript
// packages/pipeline/src/phases/comment-templates.test.ts
import { describe, it, expect } from "vitest";
import { selectTemplate, renderComment } from "./comment-templates.ts";
import type { PipelineContext } from "@journeyman/core";

function mkCtx(artifacts: Record<string, unknown> = {}): PipelineContext {
  return {
    sessionId: "s1", productId: "p1",
    ticketKey: "owner/repo#42", ticketShortKey: "42",
    flowName: "f", workspaceDir: "/tmp",
    signal: new AbortController().signal,
    productConfig: { flow: "f", workspace: "/tmp", repos: [] },
    providers: {} as any,
    artifacts,
    state: { currentStep: "test-step" } as any,
    trace: {} as any, artifactStore: {} as any, emit: () => {},
    currentStepId: "test-step",
  };
}

describe("selectTemplate", () => {
  it("returns 'pr-opened' when pr artifact present", () => {
    const ctx = mkCtx({ pr: { url: "https://github.com/x/y/pull/1", number: 1 } });
    expect(selectTemplate(ctx)).toBe("pr-opened");
  });

  it("returns 'implementation-summary' when implementation present and no pr", () => {
    const ctx = mkCtx({ implementation: { filesChanged: [], summary: "done", success: true } });
    expect(selectTemplate(ctx)).toBe("implementation-summary");
  });

  it("returns 'plan-summary' when plan present and no implementation or pr", () => {
    const ctx = mkCtx({ plan: { steps: [], estimatedComplexity: "low", summary: "plan" } });
    expect(selectTemplate(ctx)).toBe("plan-summary");
  });

  it("returns 'analysis-summary' when analysis present and nothing higher-priority", () => {
    const ctx = mkCtx({ analysis: { complexity: "low", readinessScore: 80, summary: "ok" } });
    expect(selectTemplate(ctx)).toBe("analysis-summary");
  });

  it("returns 'work-started' when only ticket artifact present", () => {
    const ctx = mkCtx({ ticket: { id: "42", title: "Fix bug" } });
    expect(selectTemplate(ctx)).toBe("work-started");
  });

  it("returns 'default' when no known artifacts present", () => {
    expect(selectTemplate(mkCtx())).toBe("default");
  });

  it("pr beats implementation when both present", () => {
    const ctx = mkCtx({
      pr: { url: "https://github.com/x/y/pull/1", number: 1 },
      implementation: { filesChanged: [], summary: "done", success: true },
    });
    expect(selectTemplate(ctx)).toBe("pr-opened");
  });
});

describe("renderComment", () => {
  it("work-started includes ticket title and emoji", () => {
    const ctx = mkCtx({ ticket: { id: "42", title: "Fix login bug", url: "https://github.com/x/y/issues/42" } });
    const out = renderComment(ctx, "work-started");
    expect(out).toContain("Fix login bug");
    expect(out).toContain("🚀");
  });

  it("work-started degrades gracefully when ticket absent", () => {
    const out = renderComment(mkCtx(), "work-started");
    expect(out).toContain("owner/repo#42");
    expect(out).toContain("🚀");
  });

  it("analysis-summary renders complexity and readiness score", () => {
    const ctx = mkCtx({ analysis: { complexity: "medium", readinessScore: 75, summary: "Looks good" } });
    const out = renderComment(ctx, "analysis-summary");
    expect(out).toContain("medium");
    expect(out).toContain("75/100");
    expect(out).toContain("Looks good");
  });

  it("analysis-summary degrades gracefully when analysis absent", () => {
    const out = renderComment(mkCtx(), "analysis-summary");
    expect(out).toContain("🤖");
    expect(out).not.toThrow;
  });

  it("plan-summary renders step count and complexity", () => {
    const steps = [
      { id: "1", kind: "code-change" as const, title: "s1", description: "d" },
      { id: "2", kind: "test" as const, title: "s2", description: "d" },
    ];
    const ctx = mkCtx({ plan: { steps, estimatedComplexity: "high", summary: "Big plan" } });
    const out = renderComment(ctx, "plan-summary");
    expect(out).toContain("2");
    expect(out).toContain("high");
    expect(out).toContain("Big plan");
  });

  it("plan-summary degrades gracefully when plan absent", () => {
    const out = renderComment(mkCtx(), "plan-summary");
    expect(out).toContain("🗺️");
  });

  it("implementation-summary renders file count and summary", () => {
    const filesChanged = [
      { path: "src/a.ts", kind: "modified" as const, summary: "updated" },
      { path: "src/b.ts", kind: "created" as const, summary: "new" },
    ];
    const ctx = mkCtx({ implementation: { filesChanged, summary: "All done", success: true } });
    const out = renderComment(ctx, "implementation-summary");
    expect(out).toContain("2");
    expect(out).toContain("All done");
    expect(out).toContain("✅");
  });

  it("implementation-summary degrades gracefully when implementation absent", () => {
    const out = renderComment(mkCtx(), "implementation-summary");
    expect(out).toContain("✅");
  });

  it("pr-opened renders pr url", () => {
    const ctx = mkCtx({ pr: { url: "https://github.com/x/y/pull/5", number: 5 } });
    expect(renderComment(ctx, "pr-opened")).toContain("https://github.com/x/y/pull/5");
  });

  it("pr-opened degrades gracefully when pr absent", () => {
    expect(renderComment(mkCtx(), "pr-opened")).toContain("unavailable");
  });

  it("review-waiting returns static message with emoji", () => {
    const out = renderComment(mkCtx(), "review-waiting");
    expect(out).toContain("👀");
    expect(out).toContain("review");
  });

  it("review-complete renders outcome from _outcome artifact", () => {
    const ctx = mkCtx({ "code-review_outcome": "approved" });
    const out = renderComment(ctx, "review-complete");
    expect(out).toContain("approved");
    expect(out).toContain("👀");
  });

  it("review-complete degrades gracefully when no _outcome artifact present", () => {
    const out = renderComment(mkCtx(), "review-complete");
    expect(out).toContain("👀");
  });

  it("completed renders ticket short key and pr url", () => {
    const ctx = mkCtx({
      ticket: { id: "42", title: "Fix bug", url: "https://github.com/x/y/issues/42" },
      pr: { url: "https://github.com/x/y/pull/5", number: 5 },
    });
    const out = renderComment(ctx, "completed");
    expect(out).toContain("42");
    expect(out).toContain("https://github.com/x/y/pull/5");
    expect(out).toContain("✅");
  });

  it("completed degrades gracefully when ticket and pr absent", () => {
    const out = renderComment(mkCtx(), "completed");
    expect(out).toContain("✅");
  });

  it("default returns checkpoint message", () => {
    const out = renderComment(mkCtx(), "default");
    expect(out).toContain("checkpoint");
  });

  it("falls back to default for unknown template key", () => {
    const out = renderComment(mkCtx(), "totally-unknown-key");
    expect(out).toContain("checkpoint");
  });
});
```

- [ ] **Step 1.2: Run tests to confirm they fail (module not found)**

```bash
cd packages/pipeline && npx vitest run src/phases/comment-templates.test.ts
```

Expected: FAIL — `Cannot find module './comment-templates.ts'`

---

## Task 2: Create `comment-templates.ts`

**Files:**
- Create: `packages/pipeline/src/phases/comment-templates.ts`

- [ ] **Step 2.1: Write the registry file**

```typescript
// packages/pipeline/src/phases/comment-templates.ts
import type { AnalyzeResult, ImplementResult, PlanResult, Ticket, PipelineContext } from "@journeyman/core";

type TemplateRenderer = (ctx: PipelineContext) => string;

function renderWorkStarted(ctx: PipelineContext): string {
  const ticket = ctx.artifacts.ticket as Ticket | undefined;
  if (!ticket) return `🚀 Work started on ${ctx.ticketKey}`;
  const link = ticket.url ? ` ([${ctx.ticketShortKey}](${ticket.url}))` : ` (${ctx.ticketShortKey})`;
  return `🚀 **Work started**${link}\n\n${ticket.title}`;
}

function renderAnalysisSummary(ctx: PipelineContext): string {
  const a = ctx.artifacts.analysis as AnalyzeResult | undefined;
  if (!a) return "🤖 Analysis complete (no details available)";
  return `🤖 **Analysis complete**\n\n- **Complexity:** ${a.complexity}\n- **Readiness:** ${a.readinessScore}/100\n\n${a.summary}`;
}

function renderPlanSummary(ctx: PipelineContext): string {
  const p = ctx.artifacts.plan as PlanResult | undefined;
  if (!p) return "🗺️ Plan complete (no details available)";
  return `🗺️ **Plan ready**\n\n- **Steps:** ${p.steps.length}\n- **Complexity:** ${p.estimatedComplexity}\n\n${p.summary}`;
}

function renderImplementationSummary(ctx: PipelineContext): string {
  const impl = ctx.artifacts.implementation as ImplementResult | undefined;
  if (!impl) return "✅ Implementation complete (no details available)";
  return `✅ **Implementation complete**\n\n- **Files changed:** ${impl.filesChanged.length}\n\n${impl.summary}`;
}

function renderPrOpened(ctx: PipelineContext): string {
  const pr = ctx.artifacts.pr as { url: string; number: number } | undefined;
  return pr ? `🚀 PR opened: ${pr.url}` : `🚀 PR opened (url unavailable)`;
}

function renderReviewWaiting(_ctx: PipelineContext): string {
  return `👀 **Ready for review** — please approve or request rework on this ticket.`;
}

function renderReviewComplete(ctx: PipelineContext): string {
  const outcomeKey = Object.keys(ctx.artifacts).find(k => k.endsWith("_outcome"));
  const outcome = outcomeKey ? (ctx.artifacts[outcomeKey] as string) : undefined;
  if (!outcome) return `👀 **Review complete**`;
  return `👀 **Review complete** — ${outcome}`;
}

function renderCompleted(ctx: PipelineContext): string {
  const ticket = ctx.artifacts.ticket as Ticket | undefined;
  const pr = ctx.artifacts.pr as { url: string; number: number } | undefined;
  const prRef = pr ? ` — PR: ${pr.url}` : "";
  const title = ticket?.title ? `\n\n${ticket.title}` : "";
  return `✅ **${ctx.ticketShortKey} complete**${prRef}${title}`.trim();
}

function renderDefault(ctx: PipelineContext): string {
  return `Auto-pilot checkpoint: ${ctx.state.currentStep ?? ctx.currentStepId}`;
}

export const commentTemplates: Record<string, TemplateRenderer> = {
  "work-started":           renderWorkStarted,
  "analysis-summary":       renderAnalysisSummary,
  "plan-summary":           renderPlanSummary,
  "implementation-summary": renderImplementationSummary,
  "pr-opened":              renderPrOpened,
  "review-waiting":         renderReviewWaiting,
  "review-complete":        renderReviewComplete,
  "completed":              renderCompleted,
  "default":                renderDefault,
};

export function selectTemplate(ctx: PipelineContext): string {
  if (ctx.artifacts.pr)             return "pr-opened";
  if (ctx.artifacts.implementation) return "implementation-summary";
  if (ctx.artifacts.plan)           return "plan-summary";
  if (ctx.artifacts.analysis)       return "analysis-summary";
  if (ctx.artifacts.ticket)         return "work-started";
  return "default";
}

export function renderComment(ctx: PipelineContext, template: string): string {
  const renderer = commentTemplates[template] ?? commentTemplates["default"];
  return renderer(ctx);
}
```

- [ ] **Step 2.2: Run tests — all should pass**

```bash
cd packages/pipeline && npx vitest run src/phases/comment-templates.test.ts
```

Expected: All tests PASS

- [ ] **Step 2.3: Run typecheck**

```bash
cd packages/pipeline && npx tsc --noEmit
```

Expected: No errors

- [ ] **Step 2.4: Commit**

```bash
git add packages/pipeline/src/phases/comment-templates.ts packages/pipeline/src/phases/comment-templates.test.ts
git commit -m "feat: add comment template registry with auto-detect and 9 templates"
```

---

## Task 3: Create `add-comment-phase.test.ts` (failing tests)

**Files:**
- Create: `packages/pipeline/src/phases/add-comment-phase.test.ts`

- [ ] **Step 3.1: Write the test file**

```typescript
// packages/pipeline/src/phases/add-comment-phase.test.ts
import { describe, it, expect, vi } from "vitest";
import { AddCommentPhase } from "./add-comment-phase.ts";
import type { PhaseResult, PipelineContext } from "@journeyman/core";

function mkCtx(artifacts: Record<string, unknown> = {}): PipelineContext {
  return {
    sessionId: "s1", productId: "p1",
    ticketKey: "owner/repo#42", ticketShortKey: "42",
    flowName: "f", workspaceDir: "/tmp",
    signal: new AbortController().signal,
    productConfig: { flow: "f", workspace: "/tmp", repos: [] },
    providers: {
      ticket: {
        addComment: vi.fn().mockResolvedValue({ ok: true, comment: { id: "c1", body: "" } }),
      },
    } as any,
    artifacts,
    state: { currentStep: "comment-step" } as any,
    trace: {} as any, artifactStore: {} as any, emit: () => {},
    currentStepId: "comment-step",
  };
}

describe("AddCommentPhase", () => {
  it("posts verbatim body when config.body provided", async () => {
    const phase = new AddCommentPhase();
    const ctx = mkCtx();
    await phase.run(ctx, { body: "hello world" });
    expect(ctx.providers.ticket.addComment).toHaveBeenCalledWith(
      expect.objectContaining({ body: "hello world" })
    );
  });

  it("auto-detects analysis-summary when analysis artifact present", async () => {
    const phase = new AddCommentPhase();
    const ctx = mkCtx({ analysis: { complexity: "low", readinessScore: 90, summary: "Clean codebase" } });
    await phase.run(ctx, {});
    const call = (ctx.providers.ticket.addComment as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.body).toContain("🤖");
    expect(call.body).toContain("Clean codebase");
  });

  it("uses named template when template specified", async () => {
    const phase = new AddCommentPhase();
    const ctx = mkCtx();
    await phase.run(ctx, { template: "review-waiting" });
    const call = (ctx.providers.ticket.addComment as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.body).toContain("👀");
  });

  it("treats template: 'auto' same as omitted template", async () => {
    const phase = new AddCommentPhase();
    const ctx = mkCtx({ pr: { url: "https://github.com/x/y/pull/1", number: 1 } });
    await phase.run(ctx, { template: "auto" });
    const call = (ctx.providers.ticket.addComment as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.body).toContain("🚀 PR opened");
  });

  it("accumulates commentIds across multiple addComment steps", async () => {
    const phase = new AddCommentPhase();
    const ctx = mkCtx({ commentIds: { "prior-step": "c0" } });
    const result = await phase.run(ctx, { body: "new comment" }) as Extract<PhaseResult, { status: "ok" }>;
    expect(result.status).toBe("ok");
    expect(result.artifacts["commentIds"]).toMatchObject({
      "prior-step": "c0",
      "comment-step": "c1",
    });
  });

  it("stores 'unknown' when provider returns no comment id", async () => {
    const phase = new AddCommentPhase();
    const ctx = mkCtx();
    (ctx.providers.ticket.addComment as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true, comment: undefined });
    const result = await phase.run(ctx, { body: "test" }) as Extract<PhaseResult, { status: "ok" }>;
    const ids = result.artifacts["commentIds"] as Record<string, string>;
    expect(ids["comment-step"]).toBe("unknown");
  });
});
```

- [ ] **Step 3.2: Run tests to confirm failures**

```bash
cd packages/pipeline && npx vitest run src/phases/add-comment-phase.test.ts
```

Expected: Tests for auto-detect and `template: 'auto'` FAIL (old `renderTemplate` doesn't handle them)

---

## Task 4: Update `add-comment-phase.ts`

**Files:**
- Modify: `packages/pipeline/src/phases/add-comment-phase.ts`

- [ ] **Step 4.1: Replace the file content**

```typescript
// packages/pipeline/src/phases/add-comment-phase.ts
import { BasePhase } from "./base-phase.ts";
import { unwrap } from "../adapter-unwrap.ts";
import type { PhaseResult, PipelineContext } from "@journeyman/core";
import { renderComment, selectTemplate } from "./comment-templates.ts";

type Config = {
  body?: string;
  template?:
    | "work-started"
    | "analysis-summary"
    | "plan-summary"
    | "implementation-summary"
    | "pr-opened"
    | "review-waiting"
    | "review-complete"
    | "completed"
    | "auto"
    | "default";
};

export class AddCommentPhase extends BasePhase {
  readonly name = "addComment";
  static reads = [] as const;
  static writes = ["commentIds"] as const;

  async run(ctx: PipelineContext, config: Config = {}): Promise<PhaseResult> {
    const body = config.body ?? this.resolveBody(ctx, config.template);
    const res = unwrap(await ctx.providers.ticket.addComment({
      id: ctx.ticketKey,
      body,
      sessionId: ctx.sessionId,
    }), "addComment");

    const prior = this.optional<Record<string, string>>(ctx, "commentIds") ?? {};
    const stepId = ctx.state.currentStep ?? "addComment";
    return this.ok({
      commentIds: { ...prior, [stepId]: res.comment?.id ?? "unknown" },
    });
  }

  private resolveBody(ctx: PipelineContext, template?: string): string {
    const key = (!template || template === "auto") ? selectTemplate(ctx) : template;
    return renderComment(ctx, key);
  }
}
```

- [ ] **Step 4.2: Run add-comment-phase tests — all should pass**

```bash
cd packages/pipeline && npx vitest run src/phases/add-comment-phase.test.ts
```

Expected: All 5 tests PASS

- [ ] **Step 4.3: Run full pipeline test suite**

```bash
cd packages/pipeline && npm test
```

Expected: All tests PASS (comment-templates + add-comment-phase + review-loop + await-ticket-status)

- [ ] **Step 4.4: Run typecheck**

```bash
cd packages/pipeline && npx tsc --noEmit
```

Expected: No errors

- [ ] **Step 4.5: Commit**

```bash
git add packages/pipeline/src/phases/add-comment-phase.ts packages/pipeline/src/phases/add-comment-phase.test.ts
git commit -m "feat: refactor AddCommentPhase to delegate to comment template registry"
```

---

## Task 5: Update `docs/phases.md`

**Files:**
- Modify: `docs/phases.md` — addComment catalog entry (around line 291–305)

- [ ] **Step 5.1: Replace the addComment step config row and description**

Find the `### \`addComment\`` section and replace the Step config row and description paragraph:

**Before:**
```markdown
| **Step config** | `template?: "analysis-summary" \| "pr-opened" \| "default"`, `body?: string` |
```

**After:**
```markdown
| **Step config** | `template?: "work-started" \| "analysis-summary" \| "plan-summary" \| "implementation-summary" \| "pr-opened" \| "review-waiting" \| "review-complete" \| "completed" \| "auto" \| "default"`, `body?: string` |
```

**Before (description paragraph):**
```markdown
Posts a comment on the ticket. Supply either `body` (verbatim text, supports `#{...}` artifact interpolation) or `template` to use a built-in rendering. Template `"analysis-summary"` renders from `analysis`, `"pr-opened"` renders from `pr`, and `"default"` posts a generic status update. The created comment ID is stored under `commentIds.<stepId>` so multiple `addComment` steps in the same flow remain independent.
```

**After:**
```markdown
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
```

- [ ] **Step 5.2: Commit**

```bash
git add docs/phases.md
git commit -m "docs: update addComment phase catalog with flexible template registry"
```

---

## Self-Review Checklist

- [x] **Spec coverage:** All 9 templates defined. Auto-detect priority documented and implemented. `config.body` takes precedence. `"auto"` and omitted template both trigger auto-detect. Graceful fallback for unknown keys. All 7 placement scenarios from user requirements covered (`work-started`, `analysis-summary`, `plan-summary`, `implementation-summary`, `review-waiting`, `review-complete`, `completed`).
- [x] **No placeholders:** All code blocks are complete and runnable.
- [x] **Type consistency:** `renderComment(ctx, template)` exported from `comment-templates.ts` and called in `add-comment-phase.ts`. `selectTemplate(ctx)` same signature throughout. `TemplateRenderer` type is local to `comment-templates.ts` (not exported, not needed elsewhere).
