# Connection-Preview Strict Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the connection-drag preview from snapping to a target node's right-side output dot before correcting to the left input dot on drop.

**Architecture:** The React Flow `<ReactFlow>` canvas currently uses `ConnectionMode.Loose`, which lets the in-drag preview snap to any nearby handle regardless of type. Every node handle in this editor is explicitly typed (`source`/`target`) and every `target` handle sits on the left, so switching to `ConnectionMode.Strict` makes the preview snap only to left-side input handles — matching where the dropped edge lands. The mode is extracted into an exported constant so a pure-logic vitest can pin it against silent reverts (the existing test harness has no DOM-rendering tooling).

**Tech Stack:** TypeScript, React, `@xyflow/react` (React Flow v12), Vitest.

**Spec:** [docs/superpowers/specs/2026-06-10-connection-preview-strict-mode-design.md](../specs/2026-06-10-connection-preview-strict-mode-design.md)

---

## File Structure

- `packages/flow-editor/src/canvas/Canvas.tsx` — the canvas component; currently hardcodes `connectionMode={ConnectionMode.Loose}` inline. Will consume an exported constant instead.
- `packages/flow-editor/src/canvas/connection-mode.ts` — **new**, tiny module exporting the canvas connection mode constant with a rationale comment. One responsibility: declare the intended connection mode so it is both reused by the canvas and assertable in a test.
- `packages/flow-editor/src/canvas/connection-mode.test.ts` — **new**, pure-logic test pinning the constant value (fits the repo's existing `.test.ts` pure-logic pattern; no jsdom/testing-library needed).

---

### Task 1: Extract and pin the canvas connection mode, then switch to Strict

**Files:**
- Create: `packages/flow-editor/src/canvas/connection-mode.ts`
- Create: `packages/flow-editor/src/canvas/connection-mode.test.ts`
- Modify: `packages/flow-editor/src/canvas/Canvas.tsx` (import line `2-8`, usage line `514`)

- [ ] **Step 1: Write the failing test**

Create `packages/flow-editor/src/canvas/connection-mode.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { ConnectionMode } from "@xyflow/react";
import { CANVAS_CONNECTION_MODE } from "./connection-mode.ts";

describe("CANVAS_CONNECTION_MODE", () => {
  // Regression guard: must stay Strict so the drag preview only snaps to
  // target (left-side input) handles, matching where the dropped edge lands.
  // Loose mode caused the preview to latch onto right-side source handles.
  it("is Strict, not Loose", () => {
    expect(CANVAS_CONNECTION_MODE).toBe(ConnectionMode.Strict);
    expect(CANVAS_CONNECTION_MODE).not.toBe(ConnectionMode.Loose);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/flow-editor && npx vitest run src/canvas/connection-mode.test.ts`
Expected: FAIL — cannot resolve `./connection-mode.ts` (module does not exist yet).

- [ ] **Step 3: Create the constant module**

Create `packages/flow-editor/src/canvas/connection-mode.ts`:

```ts
import { ConnectionMode } from "@xyflow/react";

/**
 * Connection mode for the workflow canvas.
 *
 * Strict (not Loose): while dragging a wire from an output (source) handle,
 * the preview may only snap to input (target) handles. Every node's target
 * handle is on the left, so the in-drag preview snaps to the left input dot —
 * exactly where the dropped edge is routed. Loose mode let the preview latch
 * onto a node's right-side source handle mid-drag, then jump to the left on
 * drop, which looked broken. Strict mode also rejects invalid same-type
 * connections (output->output, input->input).
 */
export const CANVAS_CONNECTION_MODE = ConnectionMode.Strict;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/flow-editor && npx vitest run src/canvas/connection-mode.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Wire the constant into Canvas.tsx**

In `packages/flow-editor/src/canvas/Canvas.tsx`, remove the now-unused `ConnectionMode` from the `@xyflow/react` import (lines 2-8) and import the new constant.

Change the import block (lines 2-8) from:

```ts
import {
  Background, Controls, ReactFlow, ReactFlowProvider,
  ConnectionMode,
  useNodesState, useEdgesState, useReactFlow,
  type Connection, type Edge, type Node,
  type NodeChange, type EdgeChange,
} from "@xyflow/react";
```

to:

```ts
import {
  Background, Controls, ReactFlow, ReactFlowProvider,
  useNodesState, useEdgesState, useReactFlow,
  type Connection, type Edge, type Node,
  type NodeChange, type EdgeChange,
} from "@xyflow/react";
```

Add this import alongside the other local `./` imports (e.g. directly after line 11, `import { nodeTypes, edgeTypes } from "./node-registry.ts";`):

```ts
import { CANVAS_CONNECTION_MODE } from "./connection-mode.ts";
```

Change the `<ReactFlow>` prop on line 514 from:

```tsx
        connectionMode={ConnectionMode.Loose}
```

to:

```tsx
        connectionMode={CANVAS_CONNECTION_MODE}
```

- [ ] **Step 6: Type-check the package**

Run: `cd packages/flow-editor && npm run typecheck`
Expected: PASS, no errors. (Confirms `ConnectionMode` is no longer referenced unbound in Canvas.tsx and the new import resolves.)

- [ ] **Step 7: Run the full flow-editor test suite**

Run: `cd packages/flow-editor && npm test`
Expected: PASS, including the new `connection-mode.test.ts`. No previously-passing tests regress.

- [ ] **Step 8: Commit**

```bash
git add packages/flow-editor/src/canvas/connection-mode.ts \
        packages/flow-editor/src/canvas/connection-mode.test.ts \
        packages/flow-editor/src/canvas/Canvas.tsx
git commit -m "fix(flow-editor): snap connection preview to input handles (strict mode)"
```

---

### Task 2: Verify the fix in the running editor

**Files:** none (manual/preview verification).

- [ ] **Step 1: Start the web app preview**

Use the preview tooling to start the dev server for `@journeyman/web` (the flow editor page). If a server is already running, reload it.

- [ ] **Step 2: Reproduce the original scenario**

Open a workflow in the flow editor with at least two step nodes. Drag a wire from the right-side output dot of the left node toward the right node.

Expected during drag: the preview line snaps to the **left** (input) dot of the target node — it does NOT latch onto the target's right-side output dot.

Expected on drop: the finished edge connects to the same left input dot, with no visible "jump" between the preview and the final edge.

- [ ] **Step 3: Confirm invalid connections are rejected**

Attempt to drag from one node's output dot to another node's output dot (right-to-right).
Expected: the connection is refused (no edge is created) — strict mode rejects source→source links.

- [ ] **Step 4: Capture proof**

Take a screenshot mid-drag showing the preview snapped to the left input dot, and share it as evidence the glitch is gone.
