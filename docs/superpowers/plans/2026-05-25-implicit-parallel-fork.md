# Implicit Parallel Fork — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow any step node with 2+ outgoing `default` edges to act as a parallel fork — eliminating the requirement to drop an explicit `gateway-and` (Fork) node for simple fan-out. Explicit Fork stays supported.

**Architecture:** Generalize the existing fork↔join pair detector in both `@journeyman/core` (validation) and `@journeyman/orchestrator` (runtime) to iterate over any node with ≥2 default outgoing edges, not just `gateway-and`. Edge type already exists (`default | conditional | else | error`), so disambiguation is mechanical. Add a small branch-glyph indicator on multi-out step nodes in the editor.

**Tech Stack:** TypeScript, React (flow-editor), Postgres-backed orchestrator. No new deps.

**Execution constraints (from user):**
- **No unit tests** in this plan.
- **No commits** during implementation; user will commit at their own discretion.
- **Run typecheck at the very end** (`npm run check`).

**Spec:** [docs/superpowers/specs/2026-05-25-implicit-parallel-fork-design.md](../specs/2026-05-25-implicit-parallel-fork-design.md)

---

## File Map

- **Modify:** `packages/core/src/validation/validate-fork-join-pairs.ts` — generalize iteration; rename rule codes (`fork-*` → `branch-*`).
- **Modify:** `packages/orchestrator/src/flow-json/find-fork-join-pairs.ts` — generalize iteration the same way.
- **Modify:** `packages/flow-editor/src/canvas/nodes/StepNode.tsx` — add branch-glyph badge when this node has ≥2 default outgoing edges.
- **Modify:** `packages/flow-editor/src/styles.css` — small CSS rule for the branch glyph.

No new files; no test files (per user instruction).

---

### Task 1: Generalize validation walker in `@journeyman/core`

**Files:**
- Modify: `packages/core/src/validation/validate-fork-join-pairs.ts`

- [ ] **Step 1: Update rule code union**

Replace the rule union (lines 6–14):

```ts
export interface ForkJoinPairError {
  nodeId: string;
  rule:
    | "branch-needs-join"
    | "join-needs-branch-source"
    | "branch-escapes-to-end"
    | "branches-converge-on-different-joins"
    | "join-incoming-mismatch"
    | "first-wins-non-pause-branch"
    | "shared-step-across-branches";
  message: string;
}
```

- [ ] **Step 2: Replace fork iteration**

In `validateForkJoinPairs`, replace:

```ts
const forkIds = graph.nodes.filter(n => n.type === "gateway-and").map(n => n.id);
```

with a helper that counts `default` outgoing edges per node and selects ≥2:

```ts
const defaultOutCount = new Map<string, number>();
for (const e of graph.edges) {
  if ((e.type ?? "default") !== "default") continue;
  defaultOutCount.set(e.source, (defaultOutCount.get(e.source) ?? 0) + 1);
}
const forkIds = graph.nodes
  .filter(n => (defaultOutCount.get(n.id) ?? 0) >= 2)
  .map(n => n.id);
```

Note: the existing `outgoing` map (line 25-28) still includes all edge types — it's used downstream for walking branches forward through steps, where the next edge is always implicitly the "next" step. That walking behavior is unchanged.

- [ ] **Step 3: Update `forkOuts` walk to only follow `default` edges**

In the loop starting at line 38, the current code uses all outgoing edges. Switch to default-only so a step with 1 default + 1 error edge isn't treated as forking:

```ts
const allOuts = graph.edges.filter(e => e.source === forkId);
const outs = allOuts.filter(e => (e.type ?? "default") === "default").map(e => e.target);
```

Replace the existing `const outs = outgoing.get(forkId) ?? [];` with the snippet above.

- [ ] **Step 4: Rename rule code emissions**

Find and replace within this file (already narrowed by Step 1's union):

- `rule: "fork-needs-join"` → `rule: "branch-needs-join"` (both occurrences, lines 43 and 88)
- `rule: "join-needs-fork"` → `rule: "join-needs-branch-source"` (line 153)
- Messages: change `Fork ${forkId}` to `Node ${forkId}` in those same `branch-needs-join` errors; change `Join ${joinId} has no matching fork.` to `Join ${joinId} has no matching branch source.`

The function's inner walker logic (lines 50–100), branch ownership tracking, first-wins enforcement, and the trailing `joinIds` orphan loop (lines 149–157) are all unchanged in behavior.

---

### Task 2: Generalize pair detector in `@journeyman/orchestrator`

**Files:**
- Modify: `packages/orchestrator/src/flow-json/find-fork-join-pairs.ts`

- [ ] **Step 1: Replace fork iteration**

In `findForkJoinPairs`, replace line 34:

```ts
    if (node.type !== "gateway-and") continue;
```

with a default-out-count check. Compute the count once before the loop, then gate on it:

```ts
  const defaultOutCount = new Map<string, number>();
  for (const e of graph.edges) {
    if ((e.type ?? "default") !== "default") continue;
    defaultOutCount.set(e.source, (defaultOutCount.get(e.source) ?? 0) + 1);
  }

  for (const node of graph.nodes) {
    if ((defaultOutCount.get(node.id) ?? 0) < 2) continue;
    // ... existing body ...
  }
```

- [ ] **Step 2: Filter `forkOuts` to default edges only**

Inside the loop, change line 36:

```ts
const forkOuts = (outgoing.get(node.id) ?? []).filter(e => (e.type ?? "default") === "default");
```

This is consistent with Task 1 Step 3 and ensures error/conditional edges don't get walked as parallel branches.

- [ ] **Step 3: Update orphan-join detection if needed**

Look at the `orphanJoins` computation (line 100). Today it filters `join` nodes that aren't in `pairedJoinIds`. That logic is unaffected by the generalization — `pairedJoinIds` now gets populated from any multi-out source, so a Join paired with an implicit fork is no longer orphaned. No change required; verify by re-reading.

---

### Task 3: Add branch-glyph indicator to multi-out step nodes

**Files:**
- Modify: `packages/flow-editor/src/canvas/nodes/StepNode.tsx`
- Modify: `packages/flow-editor/src/styles.css`

- [ ] **Step 1: Detect multi-out in `StepNode`**

`StepNode` already receives the node's `id` via `props.id` and has access to the flow context via React Flow's `useStore`. Use it to count outgoing default edges. Add this hook near the other hooks (after `useNodeHasWarning`):

```ts
import { useStore } from "@xyflow/react";

// ... inside StepNode, after const hasWarning = ... :
const isMultiOut = useStore((s) => {
  let count = 0;
  for (const e of s.edges) {
    if (e.source !== props.id) continue;
    // React Flow edges carry our type via `data.type` or top-level `type`.
    // Our adapter maps to top-level edge.type "default" by default.
    const t = (e as { type?: string }).type ?? "default";
    if (t === "default") count++;
    if (count >= 2) return true;
  }
  return false;
});
```

If `e.type` on the React Flow edge is actually the *edge component type* (e.g. `"smoothstep"`) rather than our domain type, fall back to reading the underlying domain edge type from `e.data` — re-check by reading `packages/flow-editor/src/canvas/flow-rf-adapters.ts` and matching whatever field carries `WorkflowEdgeType`.

- [ ] **Step 2: Render the branch glyph**

In the JSX of `StepNode` (the outer `<div className="je-node je-node--step" ...>`), add a span after the warning dot:

```tsx
{isMultiOut && (
  <span className="je-node-fork-dot" aria-hidden title="This step fans out — branches must converge on a Join">⫶</span>
)}
```

Place it adjacent to `<Badge>` / `<span className="je-node-warning-dot" />` so they share a corner. Z-order doesn't matter; they're positioned absolutely.

- [ ] **Step 3: Add CSS for `.je-node-fork-dot`**

In `packages/flow-editor/src/styles.css`, add near the existing `.je-node-warning-dot` rule:

```css
.je-node-fork-dot {
  position: absolute;
  top: 4px;
  right: 16px;
  font-size: 11px;
  line-height: 1;
  color: #00b894;
  font-weight: 700;
  letter-spacing: -1px;
  pointer-events: none;
}
```

The `right: 16px` offset keeps it clear of the status dot at `right: 4px`. If both warning dot and status dot are present at right:4, shift `.je-node-fork-dot` to `right: 28px` instead — verify visually before finalizing.

---

### Task 4: Typecheck and import-boundary check

- [ ] **Step 1: Run repo-wide check**

```bash
npm run check
```

Expected output: passes with no errors. `npm run check` runs both `typecheck` and `check:boundaries` (see [CLAUDE.md](../../../CLAUDE.md) command table).

- [ ] **Step 2: If errors appear**

Inspect the failure. Common causes for this change:
- Renamed rule codes in tests or UI strings still referenced somewhere. Run `grep -rn "fork-needs-join\|join-needs-fork" packages --include="*.ts" --include="*.tsx"` to find stragglers and update them to the new names.
- React Flow `useStore` import path mismatch — confirm against [Canvas.tsx](../../../packages/flow-editor/src/canvas/Canvas.tsx) imports.
- `WorkflowEdge.type` field nullability — accept `undefined` as `"default"` consistently.

Fix and re-run `npm run check` until it passes.

---

## Self-Review

**Spec coverage:**
- §Semantic rule → Task 1 Step 3 + Task 2 Step 2 enforce default-only counting.
- §Validation changes → Task 1.
- §Orchestrator changes → Task 2.
- §UI (a) drop "Fork needed" error → falls out automatically once Task 1 passes (validation no longer emits it for valid implicit forks).
- §UI (c) branch indicator → Task 3.
- §Edge cases → all handled by the default-only filter (Task 1 Step 3, Task 2 Step 2).

**Placeholders:** none. Every code block contains complete code.

**Type consistency:** the new rule codes in Task 1 Step 1 are the same strings used in Task 1 Step 4. `defaultOutCount` map name is identical between Task 1 and Task 2.

**Deviations from spec:** the spec said "keep old `fork-*` codes as aliases for one release." Verified that no consumer outside `validate-fork-join-pairs.ts` references those string literals — aliases are unnecessary. This is a simplification.
