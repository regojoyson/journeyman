# Per-Node Issue Indicators — Design

**Date:** 2026-05-25
**Status:** Draft

## Goal

Surface validation errors and warnings as small icons on the individual step nodes that own them, so users can spot which step has issues without parsing the topbar banner. Two severities: blocking errors (red) and non-blocking warnings (amber).

## Motivation

Today the topbar shows a single-line banner with the first validation message — e.g. `"3 validation issues — Join 'Join' has 3 incoming edges..."`. To find the offending node, users must read the message, locate the named node on the canvas, and click it. With multiple issues across multiple nodes this is slow and easy to miss.

Step nodes already render a small red dot in the top-left when *input-level* warnings exist (`useNodeHasWarning` + `.je-node-warning-dot`). That mechanism only covers `WorkflowSaveWarning[]` — it doesn't surface graph-level errors from `validateForkJoinPairs`, `validateForPublish`, or `ConductorJsonConverter.validateGraph`. Those errors are exactly what users hit during flow design and don't see on the node itself.

## Design

### Data layer — tag issues with `nodeId` and `severity`

File: [packages/flow-editor/src/state/validation.ts](../../../packages/flow-editor/src/state/validation.ts)

Replace the flat `errors: string[]` shape with structured issues:

```ts
export interface ValidationIssue {
  severity: "error" | "warning";
  message: string;
  nodeId?: string;   // undefined for flow-level issues (e.g. "no trigger")
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
  /** Convenience: messages only. Topbar banner reads this. */
  errors: string[];
}
```

Each rule in `isValidPhase4Graph` that knows the failing node sets `nodeId`. Examples already in the file:

- `Step node ${nodeLabel(n)} is missing a step type` → `nodeId: n.id`, severity "error"
- `Gateway/If ${nodeLabel(n)} needs at least 2 branches` → `nodeId: n.id`, severity "error"
- `Subflow ${nodeLabel(n)} is missing config.workflowName` → `nodeId: n.id`, severity "error"
- `End ${nodeLabel(n)} has outgoing edges` → `nodeId: n.id`, severity "error"
- `Node ${nodeLabel(n)} is unreachable from start` → `nodeId: n.id`, severity "warning"
- Fork/join errors from `validateForkJoinPairs` — pass through `e.nodeId`, severity "error"

Severity is fixed per-rule (no UI override). Defaults to "error" unless the rule is advisory.

### Context layer — `useNodeIssues(nodeId)` hook

File: [packages/flow-editor/src/state/validation-context.tsx](../../../packages/flow-editor/src/state/validation-context.tsx)

Extend `ValidationContext` to also carry graph-level issues alongside the existing `inputWarnings`:

```ts
interface ValidationContextValue {
  inputWarnings: WorkflowSaveWarning[];
  graphIssues: ValidationIssue[];
}
```

Add a hook:

```ts
export function useNodeIssues(nodeId: string): {
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}
```

Combines two sources:
1. `graphIssues` filtered by `nodeId`, split by `severity`
2. `inputWarnings` filtered by `nodeId` — treated as `severity: "warning"`

Returns `{ errors: [...], warnings: [...] }`.

### UI layer — two glyphs per node

File: [packages/flow-editor/src/canvas/nodes/StepNode.tsx](../../../packages/flow-editor/src/canvas/nodes/StepNode.tsx) and other node components.

Each node that should display issues calls `useNodeIssues(props.id)` and renders, in the top-left corner:

```tsx
{errors.length > 0 && (
  <span
    className="je-node-error-dot"
    title={errors.map(e => e.message).join("\n")}
    aria-label={`${errors.length} error${errors.length > 1 ? "s" : ""}`}
  >❌</span>
)}
{warnings.length > 0 && (
  <span
    className="je-node-warning-dot"
    title={warnings.map(w => w.message).join("\n")}
    aria-label={`${warnings.length} warning${warnings.length > 1 ? "s" : ""}`}
  >⚠</span>
)}
```

Both glyphs are small (~12px), stacked horizontally in the top-left corner. Error sits leftmost, warning to its right. If only one severity exists, only that glyph renders.

The existing `.je-node-warning-dot` rule loses its `background: #ff6b6b` fill and becomes an amber glyph (`color: #f6b73c`). A new `.je-node-error-dot` rule is added for the red glyph (`color: #ff6b6b`).

Node types that get the indicators:

- `StepNode` (most issues land here)
- `JoinNode`
- `IfNode`, `GatewayXorNode`, `GatewayAndNode`
- `HumanTaskNode`, `WebhookWaitNode`, `TimerNode`, `SubflowNode`, `LoopNode`
- `EndNode` (e.g. "end has outgoing edges")
- Trigger nodes (`TriggerManualNode`, `TriggerWebhookNode`, `TriggerHumanNode`)

### Wiring — `FlowEditor.tsx`

File: [packages/flow-editor/src/FlowEditor.tsx](../../../packages/flow-editor/src/FlowEditor.tsx)

Pass `validity.issues` into `<ValidationProvider>` alongside `inputWarnings`. The topbar banner continues to use `validity.errors` (the flat message list) — unchanged.

### CSS

File: [packages/flow-editor/src/styles.css](../../../packages/flow-editor/src/styles.css)

Replace the existing `.je-node-warning-dot` (currently a filled red dot) with a glyph-style rule:

```css
.je-node-warning-dot {
  position: absolute;
  top: 2px;
  left: 18px;          /* right of the error glyph if both present */
  font-size: 12px;
  line-height: 1;
  color: #f6b73c;
  pointer-events: auto;
  cursor: help;
}

.je-node-error-dot {
  position: absolute;
  top: 2px;
  left: 4px;
  font-size: 12px;
  line-height: 1;
  color: #ff6b6b;
  pointer-events: auto;
  cursor: help;
}
```

Both `top` values match so they line up. If only the warning is present, it sits in the same `left: 18px` slot — that's intentional; the leftmost spot is reserved for errors so visual scanning is consistent.

## Out of Scope

- Click-to-jump-to-issue (clicking the glyph could open the properties panel — deferred)
- Multi-line tooltip styling (browser default `title` is fine)
- Grouping/deduplication of issues in the topbar
- Issue indicators on edges (only nodes for v1)
- Per-input field highlighting inside the properties panel (already partially done via `useNodeWarningsByKey`)

## Verification

- Build a flow that triggers each rule (multi-incoming, fork-needs-join, missing step type, unreachable, etc.) and confirm the correct glyph appears on the correct node with a readable tooltip.
- Confirm the topbar banner still shows the first message.
- Confirm that fixing the issue (e.g. adding the missing config) makes the glyph disappear without a page refresh.
- Confirm a node with both an error and a warning shows both glyphs side by side.
