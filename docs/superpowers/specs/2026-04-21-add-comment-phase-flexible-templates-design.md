# AddCommentPhase — Flexible Template Registry Design

**Date:** 2026-04-21
**Status:** Approved

## Problem

`AddCommentPhase` currently has three hardcoded templates (`analysis-summary`, `pr-opened`, `default`) baked into a private `renderTemplate()` method. Adding a new template requires editing the phase class. There is no way to drop `addComment` into an arbitrary flow position without knowing which template name matches the current artifact state.

The goal is to make `addComment` genuinely drop-in anywhere — rendering the most relevant content automatically — while remaining explicit when needed.

---

## Approach: Template Registry + Auto-detect

**Option chosen:** Registry pattern (Approach B) with auto-detect as default.

All template rendering logic moves to a separate `comment-templates.ts` file. `AddCommentPhase` delegates to the registry and an artifact-scanning `selectTemplate()` function. Adding a future template requires only one new entry in the registry map — no changes to the phase class.

---

## Files

| File | Change |
|---|---|
| `packages/pipeline/src/phases/comment-templates.ts` | **New** — registry map + `selectTemplate()` |
| `packages/pipeline/src/phases/add-comment-phase.ts` | **Modified** — delegates to registry, expands `Config` type |
| `docs/phases.md` | **Updated** — addComment catalog entry |

---

## Template Registry

### `comment-templates.ts`

```typescript
type TemplateRenderer = (ctx: PipelineContext) => string;

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
```

### Template Definitions

| Key | Reads | Renders |
|---|---|---|
| `work-started` | `ticket` | "🚀 Work started on #{ticket}" — ticket title + link |
| `analysis-summary` | `analysis` | Complexity, readiness score, summary (existing behavior) |
| `plan-summary` | `plan` | Step count, complexity estimate, plan summary |
| `implementation-summary` | `implementation` | Files changed, implementation summary |
| `pr-opened` | `pr` | PR URL (existing behavior) |
| `review-waiting` | _(none)_ | "👀 Ready for review — please approve or request rework" |
| `review-complete` | `${stepId}_outcome` | Outcome: approved / rework-requested. Scans `ctx.artifacts` for the first key ending in `_outcome`; falls back to "review complete" if none found. |
| `completed` | `ticket`, `commit`, `pr` | "✅ #{ticket} complete — PR: {url}" |
| `default` | _(none)_ | "Auto-pilot checkpoint: {currentStep}" (existing behavior) |

Each template degrades gracefully: if its primary artifact is absent it returns a minimal fallback string rather than throwing.

### Auto-detect Priority

When `template` is omitted or set to `"auto"`, `selectTemplate(ctx)` picks the template:

```
pr present             → "pr-opened"
implementation present → "implementation-summary"
plan present           → "plan-summary"
analysis present       → "analysis-summary"
ticket present only    → "work-started"
fallback               → "default"
```

`review-waiting` and `review-complete` are always set explicitly in the flow YAML — auto-detect cannot distinguish "about to block for review" from "just resumed after review."

---

## Phase Config Change

```typescript
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
```

**Resolution order in `run()`:**
1. `config.body` — verbatim, no template
2. `config.template` (explicit key) — look up in registry
3. `config.template === "auto"` or template omitted — call `selectTemplate(ctx)`, then look up
4. Registry miss — fall back to `"default"`

---

## Example YAML Usage

```yaml
# Drop-in anywhere — auto picks the right template
- id: comment-work-started
  phase: addComment
  onFailure: skip

# Explicit when auto would pick wrong thing
- id: comment-review-waiting
  phase: addComment
  config: { template: "review-waiting" }
  onFailure: skip

- id: comment-review-complete
  phase: addComment
  config: { template: "review-complete" }
  onFailure: skip

- id: comment-done
  phase: addComment
  config: { template: "completed" }
  onFailure: skip
```

---

## Error Handling

- Missing artifact for a named template → render graceful fallback string, do not fail the phase
- Unknown template key → fall back to `"default"`, log a warning via runner
- `ctx.providers.ticket.addComment` failure → runner applies `onFailure` policy (typically `skip`)

---

## Extensibility

Adding a future template:
1. Write a `renderMyTemplate(ctx: PipelineContext): string` function in `comment-templates.ts`
2. Add the key to the `commentTemplates` map
3. Add the key to the `Config` template union type
4. Optionally update `selectTemplate()` if it should be auto-detectable

No changes to `AddCommentPhase` itself.

---

## Out of Scope

- Markdown-to-HTML rendering (ticket providers receive markdown as-is)
- Template parameterization / per-step template overrides beyond `body`
- Notification provider mirroring (handled by `NotifyPhase` separately)
