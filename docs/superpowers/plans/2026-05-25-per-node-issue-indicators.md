# Per-Node Issue Indicators Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show small red (error) and amber (warning) glyphs in the top-left corner of each node when that node has validation issues, with the issue messages as tooltips.

**Architecture:** Extend the existing `ValidationContext` (which today carries only input-level warnings) to also carry graph-level issues. Enrich `isValidPhase4Graph` to return structured issues tagged with `severity` and optional `nodeId`. Add a `useNodeIssues` hook. Each node component reads it and renders two glyphs.

**Tech Stack:** TypeScript, React, Vite, React Flow.

**Execution constraints (from user, applied consistently to this project):**
- **No unit tests.**
- **No commits during implementation** — user commits at their discretion.
- **Run `npm run check` at the very end.**

**Spec:** [docs/superpowers/specs/2026-05-25-per-node-issue-indicators-design.md](../specs/2026-05-25-per-node-issue-indicators-design.md)

---

## File Map

- **Modify:** `packages/flow-editor/src/state/validation.ts` — emit `ValidationIssue[]` with `severity` + `nodeId`; keep `errors: string[]` for backward compatibility.
- **Modify:** `packages/flow-editor/src/state/validation-context.tsx` — accept `graphIssues`; add `useNodeIssues` hook.
- **Modify:** `packages/flow-editor/src/FlowEditor.tsx` — feed `validity.issues` into the provider.
- **Modify:** `packages/flow-editor/src/canvas/nodes/StepNode.tsx` and the other 14 node components — render two glyphs based on `useNodeIssues`.
- **Modify:** `packages/flow-editor/src/styles.css` — restyle `.je-node-warning-dot` to amber glyph, add `.je-node-error-dot` red glyph.

Reuse a small shared component for the glyphs to keep node component changes tiny.

- **Create:** `packages/flow-editor/src/canvas/nodes/NodeIssueBadges.tsx` — single component that reads `useNodeIssues` and renders 0–2 glyphs.

---

### Task 1: Restructure `isValidPhase4Graph` to emit `ValidationIssue[]`

**Files:**
- Modify: `packages/flow-editor/src/state/validation.ts`

- [ ] **Step 1: Add `ValidationIssue` type and extend `ValidationResult`**

At the top of the file, replace the existing `ValidationResult` interface with:

```ts
export interface ValidationIssue {
  severity: "error" | "warning";
  message: string;
  nodeId?: string;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
  /** Flat message list — preserved so the topbar banner keeps working. */
  errors: string[];
}
```

- [ ] **Step 2: Introduce a helper for emitting issues**

At the top of `isValidPhase4Graph`, replace `const errors: string[] = [];` with:

```ts
const issues: ValidationIssue[] = [];
const push = (severity: "error" | "warning", message: string, nodeId?: string) => {
  issues.push({ severity, message, nodeId });
};
```

- [ ] **Step 3: Replace every `errors.push(...)` call**

Walk through the file and replace each `errors.push(...)` with a `push(...)` call. Use the table below; copy each line exactly. For each rule, the severity is "error" unless noted.

| Original | Replacement |
|---|---|
| `errors.push("Flow must have at least one trigger node");` | `push("error", "Flow must have at least one trigger node");` |
| `errors.push("Flow may declare at most one manual trigger");` | `push("error", "Flow may declare at most one manual trigger");` |
| `errors.push("Flow must have at least one end node");` | `push("error", "Flow must have at least one end node");` |
| `errors.push(`End ${nodeLabel(n)} has outgoing edges`);` | `push("error", `End ${nodeLabel(n)} has outgoing edges`, n.id);` |
| `errors.push(`Gateway/If ${nodeLabel(n)} needs at least 2 branches`);` | `push("error", `Gateway/If ${nodeLabel(n)} needs at least 2 branches`, n.id);` |
| `errors.push(`Step node ${nodeLabel(n)} is missing a step type`);` | `push("error", `Step node ${nodeLabel(n)} is missing a step type`, n.id);` |
| `errors.push(`Subflow ${nodeLabel(n)} is missing config.workflowName`);` | `push("error", `Subflow ${nodeLabel(n)} is missing config.workflowName`, n.id);` |
| `errors.push(`Edge ${e.id} on gateway ${nodeLabel(node)} requires a branchLabel`);` | `push("error", `Edge ${e.id} on gateway ${nodeLabel(node)} requires a branchLabel`, node.id);` |
| `errors.push(`Duplicate branchLabel '${e.branchLabel}' on gateway ${nodeLabel(node)}`);` | `push("error", `Duplicate branchLabel '${e.branchLabel}' on gateway ${nodeLabel(node)}`, node.id);` |
| `errors.push(`Edge ${e.id} on gateway ${nodeLabel(node)} is conditional but has no condition`);` | `push("error", `Edge ${e.id} on gateway ${nodeLabel(node)} is conditional but has no condition`, node.id);` |
| `errors.push(`Edge ${e.id} on gateway ${nodeLabel(node)} has an invalid condition shape`);` | `push("error", `Edge ${e.id} on gateway ${nodeLabel(node)} has an invalid condition shape`, node.id);` |
| `errors.push(`Node ${nodeLabel(n)} is unreachable from start`);` | `push("warning", `Node ${nodeLabel(n)} is unreachable from start`, n.id);` |

For the fork/join loop, replace:

```ts
for (const e of validateForkJoinPairs(flow)) {
  errors.push(e.message);
}
```

with:

```ts
for (const e of validateForkJoinPairs(flow)) {
  push("error", e.message, e.nodeId);
}
```

- [ ] **Step 4: Update the return statement**

Find the function's return statement (near the bottom). Replace:

```ts
return { ok: errors.length === 0, errors };
```

with:

```ts
const errors = issues.map(i => i.message);
return { ok: issues.every(i => i.severity !== "error"), issues, errors };
```

Note: `ok` is now true only when there are no `severity: "error"` issues — warnings don't block.

---

### Task 2: Extend `ValidationContext` with graph issues + `useNodeIssues` hook

**Files:**
- Modify: `packages/flow-editor/src/state/validation-context.tsx`

- [ ] **Step 1: Add `ValidationIssue` import and extend context value**

At the top of the file, replace the existing imports with:

```tsx
import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { WorkflowSaveWarning } from "@journeyman/core";
import type { ValidationIssue } from "./validation.ts";
```

Replace the `ValidationContextValue` interface with:

```ts
interface ValidationContextValue {
  inputWarnings: WorkflowSaveWarning[];
  graphIssues: ValidationIssue[];
}
```

Update the default context value:

```ts
const ValidationContext = createContext<ValidationContextValue>({
  inputWarnings: [],
  graphIssues: [],
});
```

- [ ] **Step 2: Update the provider props and value**

Replace the existing `ValidationProvider` with:

```tsx
export function ValidationProvider({
  inputWarnings,
  graphIssues,
  children,
}: {
  inputWarnings: WorkflowSaveWarning[];
  graphIssues: ValidationIssue[];
  children: ReactNode;
}) {
  const value = useMemo(() => ({ inputWarnings, graphIssues }), [inputWarnings, graphIssues]);
  return <ValidationContext.Provider value={value}>{children}</ValidationContext.Provider>;
}
```

- [ ] **Step 3: Add `useNodeIssues` hook at the bottom of the file**

Append:

```tsx
export function useNodeIssues(nodeId: string): {
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
} {
  const { inputWarnings, graphIssues } = useContext(ValidationContext);
  return useMemo(() => {
    const errors: ValidationIssue[] = [];
    const warnings: ValidationIssue[] = [];
    for (const issue of graphIssues) {
      if (issue.nodeId !== nodeId) continue;
      if (issue.severity === "error") errors.push(issue);
      else warnings.push(issue);
    }
    for (const w of inputWarnings) {
      if ("nodeId" in w && w.nodeId === nodeId) {
        warnings.push({
          severity: "warning",
          message: "message" in w ? String(w.message) : "Input validation warning",
          nodeId,
        });
      }
    }
    return { errors, warnings };
  }, [graphIssues, inputWarnings, nodeId]);
}
```

Keep the existing `useInputWarnings`, `useNodeHasWarning`, and `useNodeWarningsByKey` exports untouched — other code may still call them.

---

### Task 3: Wire `graphIssues` through `FlowEditor.tsx`

**Files:**
- Modify: `packages/flow-editor/src/FlowEditor.tsx`

- [ ] **Step 1: Pass `graphIssues` into the provider**

Find the line that opens `<ValidationProvider inputWarnings={inputWarnings}>`. Replace it with:

```tsx
<ValidationProvider inputWarnings={inputWarnings} graphIssues={validity.issues}>
```

`validity` already exists in scope (from `const validity = useMemo(() => isValidPhase4Graph(heal.healed) ...`). After Task 1, `validity.issues` will be a `ValidationIssue[]`.

No other changes here. The existing `validity.errors` consumer in this file (used for the topbar banner) is untouched and keeps working because Task 1's return statement still includes `errors`.

---

### Task 4: Create the shared `NodeIssueBadges` component

**Files:**
- Create: `packages/flow-editor/src/canvas/nodes/NodeIssueBadges.tsx`

- [ ] **Step 1: Write the component**

Create the new file with this complete content:

```tsx
import { useNodeIssues } from "../../state/validation-context.tsx";

/**
 * Renders 0–2 small glyphs in the top-left corner of a node showing
 * validation errors (red) and warnings (amber). Tooltip lists messages.
 */
export function NodeIssueBadges({ nodeId }: { nodeId: string }) {
  const { errors, warnings } = useNodeIssues(nodeId);
  if (errors.length === 0 && warnings.length === 0) return null;
  return (
    <>
      {errors.length > 0 && (
        <span
          className="je-node-error-dot"
          aria-label={`${errors.length} error${errors.length > 1 ? "s" : ""}`}
          title={errors.map(e => e.message).join("\n")}
        >
          ❌
        </span>
      )}
      {warnings.length > 0 && (
        <span
          className="je-node-warning-dot"
          aria-label={`${warnings.length} warning${warnings.length > 1 ? "s" : ""}`}
          title={warnings.map(w => w.message).join("\n")}
        >
          ⚠
        </span>
      )}
    </>
  );
}
```

---

### Task 5: Update CSS — error glyph + restyle warning dot

**Files:**
- Modify: `packages/flow-editor/src/styles.css`

- [ ] **Step 1: Locate the existing `.je-node-warning-dot` rule**

Search for `.je-node-warning-dot {` in the file. It currently reads as a filled red dot:

```css
.je-node-warning-dot {
  position: absolute;
  top: 4px;
  left: 4px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #ff6b6b;
  box-shadow: 0 0 4px #ff6b6b;
  pointer-events: auto;
  cursor: help;
}
```

- [ ] **Step 2: Replace it with the new amber-glyph version and add the error rule**

Replace the entire `.je-node-warning-dot { ... }` block with:

```css
/* Validation: per-node error glyph (red ❌) in top-left corner. */
.je-node-error-dot {
  position: absolute;
  top: 2px;
  left: 4px;
  font-size: 11px;
  line-height: 1;
  color: #ff6b6b;
  pointer-events: auto;
  cursor: help;
  user-select: none;
}

/* Validation: per-node warning glyph (amber ⚠), sits to the right of
   the error glyph so both can render side-by-side when present. */
.je-node-warning-dot {
  position: absolute;
  top: 2px;
  left: 18px;
  font-size: 11px;
  line-height: 1;
  color: #f6b73c;
  pointer-events: auto;
  cursor: help;
  user-select: none;
}
```

---

### Task 6: Render `<NodeIssueBadges>` in every relevant node component

For each file below, make two changes:
1. Add the import at the top: `import { NodeIssueBadges } from "./NodeIssueBadges.tsx";`
2. Inside the outer `<div className="je-node ...">` wrapper, render `<NodeIssueBadges nodeId={props.id} />` near the top — adjacent to any existing badge or warning-dot.

In `StepNode.tsx` specifically, the existing line `{hasWarning && <span className="je-node-warning-dot" .../>}` should be **removed** (replaced by `<NodeIssueBadges />`). The hook `useNodeHasWarning` import can stay (other consumers may still use it) but its return value isn't needed here.

**Files (all under `packages/flow-editor/src/canvas/nodes/`):**

- [ ] **Step 1: `StepNode.tsx`**

Add import and replace the existing warning-dot span:

```tsx
import { NodeIssueBadges } from "./NodeIssueBadges.tsx";
```

Find this line:

```tsx
{hasWarning && <span className="je-node-warning-dot" aria-hidden title="Input validation warnings — see topbar Validate panel" />}
```

Replace with:

```tsx
<NodeIssueBadges nodeId={props.id} />
```

The `hasWarning` and `useNodeHasWarning` local can be removed if no longer referenced — grep the file after editing. If unused, remove `const hasWarning = useNodeHasWarning(props.id);` and the `useNodeHasWarning` import.

- [ ] **Step 2: `JoinNode.tsx`**

Add the import:

```tsx
import { NodeIssueBadges } from "./NodeIssueBadges.tsx";
```

Inside the outer `<div className="je-node je-node--gateway je-node--join">`, add as the first child:

```tsx
<NodeIssueBadges nodeId={props.id} />
```

- [ ] **Step 3: `GatewayAndNode.tsx`** — same pattern as Step 2, inside `<div className="je-node je-node--gateway je-node--and">`.

- [ ] **Step 4: `GatewayXorNode.tsx`** — same pattern, inside `<div className="je-node je-node--gateway je-node--xor">`.

- [ ] **Step 5: `IfNode.tsx`** — same pattern, inside the outer node div (the class likely contains `je-node--if` or `je-node--gateway`).

- [ ] **Step 6: `HumanTaskNode.tsx`** — same pattern.

- [ ] **Step 7: `WebhookWaitNode.tsx`** — same pattern.

- [ ] **Step 8: `TimerNode.tsx`** — same pattern.

- [ ] **Step 9: `SubflowNode.tsx`** — same pattern.

- [ ] **Step 10: `LoopNode.tsx`** — same pattern.

- [ ] **Step 11: `EndNode.tsx`** — same pattern.

- [ ] **Step 12: `TriggerManualNode.tsx`** — same pattern.

- [ ] **Step 13: `TriggerWebhookNode.tsx`** — same pattern.

- [ ] **Step 14: `TriggerHumanNode.tsx`** — same pattern.

- [ ] **Step 15: `StartNode.tsx`** — same pattern (legacy start node; safe to include for parity).

For each: the `props.id` is part of `NodeProps` from `@xyflow/react` — already in scope wherever the component receives `props`.

---

### Task 7: Typecheck

- [ ] **Step 1: Run repo-wide check**

```bash
npm run check
```

Expected: passes with no errors.

- [ ] **Step 2: If errors appear**

Common causes:
- `validity.issues` not found → confirm Task 1's return statement includes `issues`.
- `useNodeIssues` undefined → confirm Task 2's hook is exported.
- A node component missing the `NodeIssueBadges` import after Task 6.
- `WorkflowSaveWarning` missing a `message` property — adapt the cast in Task 2 Step 3 by checking the actual type definition in `@journeyman/core` and using the correct field (e.g. `w.code` if `message` doesn't exist on the type).

Fix and re-run `npm run check` until it passes.

---

## Self-Review

**Spec coverage:**
- §Data layer (tag with nodeId + severity) → Task 1.
- §Context layer (`useNodeIssues` hook) → Task 2.
- §UI layer (two glyphs per node) → Tasks 4 and 6.
- §Wiring (`FlowEditor.tsx`) → Task 3.
- §CSS → Task 5.
- §Node types covered (StepNode, JoinNode, gateways, HumanTask, WebhookWait, Timer, Subflow, Loop, End, Triggers) → Task 6.

**Placeholders:** none. Every code block is complete.

**Type consistency:** `ValidationIssue` shape (`severity`, `message`, `nodeId?`) is identical between Task 1, Task 2, and Task 4. `ValidationResult.issues` field name is consistent.
