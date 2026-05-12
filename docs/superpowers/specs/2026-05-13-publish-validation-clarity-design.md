# Publish validation clarity

**Date:** 2026-05-13
**Status:** Design approved, pending implementation plan

## Problem

`validateForPublish` produces messages like:

```
Secret 'ANTHROPIC_API_KEY' (slot 'ANTHROPIC_API_KEY') is not visible from this flow (node step_en34ak)
Secret 'ANTHROPIC_API_KEY' (slot 'ANTHROPIC_API_KEY') is not visible from this flow (node step_6dnxoo)
Secret 'ANTHROPIC_API_KEY' (slot 'ANTHROPIC_API_KEY') is not visible from this flow (node step_0z3kju)
```

Two pain points for the user reviewing the publish modal:

1. **Opaque locator** — `step_en34ak` is a generated node id. The reader can't tell which canvas tile / phase the issue is on without using the "Show node" button per row.
2. **Errors and warnings blur together** — both render as adjacent list items in the same list. The severity is conveyed only by a ✗ / ⚠ icon and colour, which is easy to skim past when the messages are otherwise identical in shape.

## Goals

- Make the offending phase/step identifiable at a glance, by name.
- Make the error vs. warning distinction structural (sectioned), not just chromatic.
- No changes to API shape on the wire beyond an additive optional field; no schema migration.

## Non-goals

- Reworking validation rules themselves (which checks run, what severity).
- Internationalisation of message strings.
- Inline canvas decoration of bad nodes (a separate concern from the publish modal).

## Design

### 1. Validation message text loses the `(node …)` suffix

`PublishError` already carries a structured `nodeId` field. The `(node step_xxx)` suffix in message strings is redundant and is the source of the unreadable id leak.

Touched call sites in `packages/core/src/validation/validate-for-publish.ts`:

- secret visibility (`Secret '…' (slot '…') is not visible from this flow`)
- MCP instance visibility
- skill visibility
- unresolved bindings, missing config, dangling references, invalid gates, etc. — anywhere the current message embeds the node id

After:

```
Secret 'ANTHROPIC_API_KEY' (slot 'ANTHROPIC_API_KEY') is not visible from this flow.
```

The "where" comes from the chip (see §3); the message stays focused on the "what".

### 2. `PublishError` gains an optional `nodeLabel`

```ts
export type PublishError = {
  severity?: "error" | "warning";
  code: …;
  message: string;
  nodeId?: string;
  nodeLabel?: string;   // NEW — human-readable for UI chips
  fieldPath?: string;
};
```

`validateForPublish` resolves it once per node when pushing an error:

```
nodeLabel = node.displayName
         ?? prettifyPhaseType(node.phaseType)   // "analyze-repo" → "Analyze Repo"
         ?? capitalize(node.type)               // "start" → "Start", "if" → "If"
```

Pure derivation from data already on the `WorkflowNode`. No new context plumbing.

Errors with no associated node (graph-level invariants, no-trigger) leave both `nodeId` and `nodeLabel` undefined; the UI renders a `[Flow]` chip for them so every row has a consistent shape.

### 3. Modal renders the label as a chip prefix

In `packages/flow-editor/src/topbar/PublishModal.tsx`, each list item changes from:

```
✗ Secret 'ANTHROPIC_API_KEY' … (node step_en34ak)    [Show node]
```

to:

```
✗ [Analyze Repo]  Secret 'ANTHROPIC_API_KEY' is not visible from this flow.   [Show node]
```

The chip is a small inline pill — `nodeLabel` if present, otherwise `Flow`. Clicking it does the same thing as the existing "Show node" button (which can be removed for issues that have a chip, or kept for explicitness — see Open Questions).

### 4. Errors and warnings split into sections with counts

Today both lists are one `<ul>`. New layout:

```
Errors (3) — must fix before publish
  ✗ [Analyze Repo]  Secret 'ANTHROPIC_API_KEY' …    [Show node]
  ✗ [Clone Repos]   …                                [Show node]
  ✗ [Implement]     …                                [Show node]

Warnings (2) — publish allowed; review before running
  ⚠ [Plan]   …                                       [Show node]
  ⚠ [Flow]   …
```

Each section header carries the count and a one-line subline explaining what the severity means for the publish button. The existing red/amber colours stay; the section split makes severity scannable even with colour stripped (e.g. for users with reduced contrast).

If only warnings exist, the Errors section is omitted (and vice versa). The "All checks passed" state is unchanged.

The same layout is reused for the post-publish "may affect runtime behaviour" warnings list at the top of `PublishModal.tsx` (which currently renders only warnings).

## Architecture

```
┌─────────────────────────────┐
│ validateForPublish (core)   │  Adds nodeLabel to each PublishError
│   - strips "(node …)" from  │  via lookup against the WorkflowNode
│     message strings         │  being validated.
└──────────────┬──────────────┘
               │ PublishError[]
               ▼
┌─────────────────────────────┐
│ PublishModal (flow-editor)  │  Splits into Errors / Warnings sections.
│   - section headers + counts│  Renders [nodeLabel] chip per row.
│   - chip prefix per row     │  "Show node" button uses nodeId as before.
└─────────────────────────────┘
```

No new packages, no new API endpoints. `api-server` routes (`flows.ts` lines 360, 532) re-emit `PublishError[]` unchanged — the new optional field rides along.

## Data flow

1. User clicks Publish.
2. Modal calls `validateForPublish(flow, ctx)` synchronously.
3. For each rule violation, the validator pushes a `PublishError` and (when a `WorkflowNode` is in scope) resolves `nodeLabel` from `node.displayName / phaseType / type`.
4. Modal partitions the returned errors into `errors` and `warnings` arrays, renders each as a section.
5. "Show node" click → existing `onSelectNode(nodeId)` path. Unchanged.

## Error handling

`prettifyPhaseType` and `capitalize` are pure string transforms; they handle empty/undefined by falling through to the next option in the `displayName ?? phaseType ?? type` chain. If all three are missing (defensive — shouldn't happen for a parsed `WorkflowNode`), `nodeLabel` stays `undefined` and the UI shows `[Flow]`.

## Testing

Unit tests in `packages/core` (mirrors existing validate-for-publish test layout):

- Message strings no longer contain `(node …)` for each affected rule (secret / mcp / skill visibility, missing config, etc.).
- `nodeLabel` resolves to `displayName` when present.
- `nodeLabel` falls back to prettified `phaseType` when `displayName` is absent.
- `nodeLabel` falls back to capitalized node `type` for non-phase nodes (start, end, if).
- Graph-level errors (no-trigger, multiple starts) emit `nodeLabel === undefined`.

UI: light component test or visual check on `PublishModal` that the section split renders and counts match. (`flow-editor` is small enough that a manual check is reasonable; follow whatever the existing convention is in that package.)

## Migration / compatibility

- `nodeLabel` is additive and optional. Existing callers that ignore it keep working.
- Server `api-server/src/routes/flows.ts` serialises `PublishError[]` as-is, so the field appears on the wire for any client that wants it.
- No persisted data changes.

## Open questions

- **Chip click vs. "Show node" button** — should the chip itself be clickable (replacing the button), or do we keep both? Bias: chip-only, less visual noise. Finalise during implementation.
- **Chip styling for `[Flow]`** — neutral grey vs. a distinct colour. Cosmetic; decide in CSS.
