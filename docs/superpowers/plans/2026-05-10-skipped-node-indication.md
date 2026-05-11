# Skipped-Node Indication on Terminal Runs — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a workflow instance is `completed` or `failed`, render unreached nodes as `skipped` (muted) instead of `pending`.

**Architecture:** Single package (`@journeyman/run-viewer`). Add a `"skipped"` value to the `NodeStatus` union; extend the existing terminal-state cleanup in `computeNodeStatuses` to map leftover `pending` → `skipped` for completed/failed instances; add a CSS variant + label entry for the new status.

**Tech Stack:** TypeScript, React, plain CSS. No new dependencies.

**Spec:** [docs/superpowers/specs/2026-05-10-skipped-node-indication-design.md](../specs/2026-05-10-skipped-node-indication-design.md)

**Execution constraints (from user):**
- No per-task commits. Apply all edits, then run typecheck once at the end.
- No unit tests.

---

### Task 1: Extend `NodeStatus` union

**Files:**
- Modify: `packages/run-viewer/src/types.ts:3-10`

- [ ] **Step 1: Add `"skipped"` to `NodeStatus`**

In `packages/run-viewer/src/types.ts`, replace the existing `NodeStatus` type:

```ts
export type NodeStatus =
  | "pending"
  | "running"
  | "retry-backoff"
  | "waiting"
  | "completed"
  | "failed"
  | "cancelled";
```

with:

```ts
export type NodeStatus =
  | "pending"
  | "running"
  | "retry-backoff"
  | "waiting"
  | "completed"
  | "failed"
  | "cancelled"
  | "skipped";
```

---

### Task 2: Map unreached `pending` → `skipped` on terminal runs

**Files:**
- Modify: `packages/run-viewer/src/status/compute-node-status.ts:68-74`

- [ ] **Step 1: Replace the `cancelled`-only terminal pass**

In `packages/run-viewer/src/status/compute-node-status.ts`, find this block (lines 68-74):

```ts
  if (args.workflowInstanceStatus === "cancelled") {
    for (const [id, v] of out) {
      if (v.status === "pending" || v.status === "running" || v.status === "retry-backoff") {
        out.set(id, { ...v, status: "cancelled" });
      }
    }
  }
```

Replace it with:

```ts
  const terminal =
    args.workflowInstanceStatus === "completed" ||
    args.workflowInstanceStatus === "failed" ||
    args.workflowInstanceStatus === "cancelled";

  if (terminal) {
    for (const [id, v] of out) {
      if (v.status === "pending" || v.status === "running" || v.status === "retry-backoff") {
        const next: NodeStatus =
          args.workflowInstanceStatus === "cancelled" ? "cancelled" :
          v.status === "pending" ? "skipped" :
          v.status;
        if (next !== v.status) out.set(id, { ...v, status: next });
      }
    }
  }
```

The `if (next !== v.status)` guard prevents writing back identical entries when, for completed/failed runs, a node is in `running`/`retry-backoff` (which shouldn't normally happen but we don't fabricate a state).

- [ ] **Step 2: Confirm the `NodeStatus` type is in scope**

The file already imports `ResolvedNodeStatus` from `../types.ts` (line 4). Add `NodeStatus` to that same import so the local `next: NodeStatus` annotation resolves:

Find:

```ts
import type { ResolvedNodeStatus } from "../types.ts";
```

Replace with:

```ts
import type { NodeStatus, ResolvedNodeStatus } from "../types.ts";
```

---

### Task 3: Add label + class entries for `skipped`

**Files:**
- Modify: `packages/run-viewer/src/canvas/status-styles.ts`

- [ ] **Step 1: Add `skipped` to `STATUS_CLASS`**

In `packages/run-viewer/src/canvas/status-styles.ts`, replace:

```ts
export const STATUS_CLASS: Record<NodeStatus, string> = {
  "pending":       "je-runnode--pending",
  "running":       "je-runnode--running",
  "retry-backoff": "je-runnode--retry",
  "waiting":       "je-runnode--waiting",
  "completed":     "je-runnode--completed",
  "failed":        "je-runnode--failed",
  "cancelled":     "je-runnode--cancelled",
};
```

with:

```ts
export const STATUS_CLASS: Record<NodeStatus, string> = {
  "pending":       "je-runnode--pending",
  "running":       "je-runnode--running",
  "retry-backoff": "je-runnode--retry",
  "waiting":       "je-runnode--waiting",
  "completed":     "je-runnode--completed",
  "failed":        "je-runnode--failed",
  "cancelled":     "je-runnode--cancelled",
  "skipped":       "je-runnode--skipped",
};
```

- [ ] **Step 2: Add `skipped` to `STATUS_LABEL`**

In the same file, replace:

```ts
export const STATUS_LABEL: Record<NodeStatus, string> = {
  "pending":       "pending",
  "running":       "running",
  "retry-backoff": "retry…",
  "waiting":       "⏳ waiting",
  "completed":     "✓",
  "failed":        "✗",
  "cancelled":     "cancelled",
};
```

with:

```ts
export const STATUS_LABEL: Record<NodeStatus, string> = {
  "pending":       "pending",
  "running":       "running",
  "retry-backoff": "retry…",
  "waiting":       "⏳ waiting",
  "completed":     "✓",
  "failed":        "✗",
  "cancelled":     "cancelled",
  "skipped":       "skipped",
};
```

(`Record<NodeStatus, string>` will fail to typecheck if either map is missing a key — both maps must be updated together.)

---

### Task 4: Add `skipped` CSS variant

**Files:**
- Modify: `packages/run-viewer/src/styles.css:22-28`

- [ ] **Step 1: Add the `--skipped` rules**

In `packages/run-viewer/src/styles.css`, find the existing status block:

```css
.je-runnode--pending   { opacity: 0.55; }
.je-runnode--pending .je-runnode__badge { color: #888; }
.je-runnode--running .je-runnode__badge   { color: #4a9eff; border-color: #4a9eff; box-shadow: 0 0 0 3px rgba(74,158,255,0.15); animation: jePulse 1.4s infinite; }
.je-runnode--retry .je-runnode__badge     { color: #fdcb6e; border-color: #fdcb6e; }
.je-runnode--completed .je-runnode__badge { color: #00b894; border-color: #00b894; }
.je-runnode--failed .je-runnode__badge    { color: #ff7675; border-color: #ff7675; }
.je-runnode--cancelled .je-runnode__badge { color: #aaa; }
```

Add two new lines immediately after the `--cancelled` rule:

```css
.je-runnode--skipped   { opacity: 0.4; filter: grayscale(0.6); }
.je-runnode--skipped .je-runnode__badge { color: #888; border-color: #444; border-style: dashed; }
```

The dashed border + extra opacity reduction + grayscale filter make `skipped` visually distinct from `pending` (solid border, opacity 0.55) and `cancelled` (grey badge, no opacity drop).

---

### Task 5: Final verification

- [ ] **Step 1: Typecheck the run-viewer package**

Run: `npm run typecheck -w @journeyman/run-viewer`
Expected: PASS, no errors.

- [ ] **Step 2: Typecheck the web app (consumes run-viewer)**

Run: `npm run typecheck -w @journeyman/web`
Expected: PASS, no errors.

- [ ] **Step 3: Manual smoke test**

In the running preview, open the run from the screenshot (a completed if/else workflow):
- The untaken branch nodes (the second "Add comment on Ticket" / second "End") should show "skipped" with dim/dashed-border styling.
- The taken-branch nodes still show "✓".
- Open a still-running workflow → unreached nodes still show "pending" (terminal logic must NOT fire mid-run).
- Open a cancelled instance → unchanged from today.

---

## Self-Review Notes

- **Spec coverage:**
  - `NodeStatus` extension → Task 1.
  - Terminal-pass logic → Task 2.
  - `STATUS_CLASS` / `STATUS_LABEL` entries → Task 3.
  - CSS variant → Task 4.
  - Behavior table verification (running/paused mid-state, completed, failed, cancelled) → Task 5 Step 3.
- **Placeholder scan:** No TBDs. CSS file path located up-front (`packages/run-viewer/src/styles.css`). All code shown verbatim.
- **Type consistency:** `NodeStatus` is the same identifier used in `types.ts`, `compute-node-status.ts`, and `status-styles.ts`. The new `"skipped"` literal appears in all three plus the CSS class name.
- **Execution constraints honored:** No `git commit` steps anywhere; only one typecheck block at the end (Task 5).
