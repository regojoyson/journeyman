# Flow Editor Help Panel + Handle Bug Fix + Canvas Refactor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the green-handle bug, add a discoverable Help panel to the flow editor canvas, and extract pure FlowGraph ↔ React Flow conversions out of `Canvas.tsx`.

**Architecture:** The Help panel is a self-contained React component mounted as a sibling of `<ReactFlow>` inside the existing canvas wrapper, with content driven by static data in `help-content.tsx`. Pure conversions move to `flow-rf-adapters.ts` so `Canvas.tsx` is left with React Flow wiring + handlers only. The handle bug is a one-line CSS change.

**Tech Stack:** React 18, TypeScript, `@xyflow/react`, plain CSS in `packages/flow-editor/src/styles.css`.

**Per user instructions:** No unit tests in this plan. No per-task commits. A single `npm run typecheck` runs at the very end.

---

## File Structure

**Create:**
- `packages/flow-editor/src/canvas/flow-rf-adapters.ts` — pure conversion functions (no React, no hooks).
- `packages/flow-editor/src/canvas/HelpPanel.tsx` — the floating `?` button + slide-in panel + open-state logic.
- `packages/flow-editor/src/canvas/help-content.tsx` — static legend rows (data + small renderers for swatches).

**Modify:**
- `packages/flow-editor/src/styles.css` — drop `.connectionindicator` from the green rule; add Help panel styles.
- `packages/flow-editor/src/canvas/Canvas.tsx` — import from `flow-rf-adapters.ts`, delete dead code, mount `<HelpPanel />`.

---

## Task 1: Fix handle color bug

**Files:**
- Modify: `packages/flow-editor/src/styles.css:66-70`

- [ ] **Step 1: Drop `.connectionindicator` from the green selector**

In `packages/flow-editor/src/styles.css`, replace lines 66–70:

```css
.react-flow__handle.connectingfrom,
.react-flow__handle.connectionindicator {
  background: #00b894 !important;
  box-shadow: 0 0 0 5px rgba(0, 184, 148, 0.55);
}
```

with:

```css
.react-flow__handle.connectingfrom {
  background: #00b894 !important;
  box-shadow: 0 0 0 5px rgba(0, 184, 148, 0.55);
}
```

Why: React Flow applies `connectionindicator` to every handle by default — it's not a transient state. Only `.connectingfrom` (the handle being dragged from) is transient, so green feedback during a drag is preserved.

---

## Task 2: Extract pure conversions to `flow-rf-adapters.ts`

**Files:**
- Create: `packages/flow-editor/src/canvas/flow-rf-adapters.ts`
- Modify: `packages/flow-editor/src/canvas/Canvas.tsx`

- [ ] **Step 1: Create `flow-rf-adapters.ts` with the four pure functions**

Create `packages/flow-editor/src/canvas/flow-rf-adapters.ts` with the following exact content:

```ts
import { MarkerType, type Edge, type Node } from "@xyflow/react";
import type { FlowEdge, FlowEdgeType, FlowGraph, FlowNode, FlowNodeType } from "@journeyman/core";
import type { PhaseCatalog } from "../types.ts";

export const KNOWN_NODE_TYPES = new Set([
  "start", "end", "phase",
  "gateway-xor", "gateway-and", "loop", "subflow", "if", "timer",
]);

export function toReactFlowNodes(
  flow: FlowGraph,
  catalog: PhaseCatalog,
  selectedId: string | null,
): Node[] {
  return flow.nodes.map(n => ({
    id: n.id,
    type: KNOWN_NODE_TYPES.has(n.type) ? n.type : "phase",
    position: n.position ?? { x: 0, y: 0 },
    data: n.type === "phase"
      ? {
          displayName: n.displayName ?? n.phaseType ?? "Phase",
          phaseType: n.phaseType ?? "",
          catalogEntry: catalog.find(c => c.phaseType === n.phaseType),
        }
      : {
          displayName: n.displayName ?? n.type,
          ...(n.config ?? {}),
        },
    selected: n.id === selectedId,
    draggable: true,
    selectable: true,
  }));
}

export function toReactFlowEdges(flow: FlowGraph): Edge[] {
  return flow.edges.map(e => {
    const t = e.type ?? "default";
    const arrowColor =
      t === "error"       ? "#ff7675" :
      t === "conditional" ? "#fdcb6e" :
      t === "else"        ? "#888"    :
      /* default */        "#888";
    return {
      id: e.id,
      source: e.source,
      target: e.target,
      type: t,
      data: { branchLabel: e.branchLabel, condition: e.condition },
      markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18, color: arrowColor },
    };
  });
}

export function structuralSig(flow: FlowGraph): string {
  return JSON.stringify({
    nodes: flow.nodes.map(n => ({
      id: n.id, type: n.type, name: n.displayName, phase: n.phaseType,
      cfg: n.config ?? null, retry: n.retry ?? null, outcome: n.outcome ?? null,
    })),
    edges: flow.edges.map(e => ({
      id: e.id, src: e.source, tgt: e.target, type: e.type ?? "default",
      label: e.branchLabel, cond: e.condition ?? null,
    })),
  });
}

/** Build a fresh FlowGraph from current internal RF state + previous flow's metadata. */
export function buildFlowFromInternal(
  prevFlow: FlowGraph,
  rfNodes: Node[],
  rfEdges: Edge[],
): FlowGraph {
  const nextNodes: FlowNode[] = rfNodes.map(rfn => {
    const prev = prevFlow.nodes.find(n => n.id === rfn.id);
    if (prev) return { ...prev, position: rfn.position };
    return {
      id: rfn.id,
      type: (rfn.type ?? "phase") as FlowNodeType,
      displayName: (rfn.data as { displayName?: string } | undefined)?.displayName,
      position: rfn.position,
      config: {},
    };
  });
  const nextEdges: FlowEdge[] = rfEdges.map(rfe => {
    const prev = prevFlow.edges.find(e => e.id === rfe.id);
    if (prev) return prev;
    return {
      id: rfe.id, source: rfe.source, target: rfe.target,
      type: (rfe.type ?? "default") as FlowEdgeType,
    };
  });
  return { ...prevFlow, nodes: nextNodes, edges: nextEdges };
}
```

- [ ] **Step 2: Remove the duplicated functions and dead code from `Canvas.tsx`**

In `packages/flow-editor/src/canvas/Canvas.tsx`:

a) Replace the import block at the top (lines 1–13) with:

```ts
import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  Background, Controls, ReactFlow, ReactFlowProvider,
  ConnectionMode,
  useNodesState, useEdgesState,
  type Connection, type Edge, type Node,
  type NodeChange, type EdgeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { FlowEdge, FlowEdgeType, FlowGraph, FlowNode, FlowNodeType } from "@journeyman/core";
import { nodeTypes, edgeTypes } from "./node-registry.ts";
import { newPhaseNode, newEdge } from "../state/flow-graph.ts";
import {
  toReactFlowNodes,
  toReactFlowEdges,
  structuralSig,
  buildFlowFromInternal,
} from "./flow-rf-adapters.ts";
import type { PhaseCatalog } from "../types.ts";
```

(Note: `MarkerType` is no longer used here — it moved into the adapter module.)

b) Delete lines 24–119 entirely. That removes:
- `KNOWN_NODE_TYPES`
- `toReactFlowNodes`
- `toReactFlowEdges`
- `structuralSig`
- `distancePointToSegment` (dead — only used by `findEdgeNearPoint`)
- `findEdgeNearPoint` (dead — never called)

c) Replace the `buildFlowFromInternal` `useCallback` (current lines 156–177) with a call to the new pure helper:

```ts
const buildFlow = useCallback(
  (rfNodes: Node[], rfEdges: Edge[]): FlowGraph => buildFlowFromInternal(p.flow, rfNodes, rfEdges),
  [p.flow],
);
```

d) Update the two callers inside `handleNodesChange` and `handleEdgesChange` to use `buildFlow` instead of `buildFlowFromInternal`:

```ts
queueMicrotask(() => propagate(buildFlow(curr, edges)));
// ...
queueMicrotask(() => propagate(buildFlow(nodes, curr)));
```

And update the corresponding `useCallback` dependency arrays: replace `buildFlowFromInternal` with `buildFlow` in both.

e) Confirm the unused-import diagnostic is clean: after this task `Canvas.tsx` should no longer reference `FlowEdge`, `FlowEdgeType`, `FlowNode`, or `FlowNodeType` directly *except* inside `handleConnect` (`FlowEdge`, `FlowEdgeType`) and `handleDrop` (`FlowNode`, `FlowNodeType`). All four are still used; keep them in the import. `MarkerType` is no longer referenced — drop it (already done in step a).

---

## Task 3: Add Help panel content module

**Files:**
- Create: `packages/flow-editor/src/canvas/help-content.tsx`

- [ ] **Step 1: Create `help-content.tsx` with static data and swatch renderers**

Create `packages/flow-editor/src/canvas/help-content.tsx`:

```tsx
import type { CSSProperties, ReactNode } from "react";

export interface LegendRow {
  swatch: ReactNode;
  label: string;
  desc: string;
}

const dot = (color: string, glow?: string): CSSProperties => ({
  display: "inline-block",
  width: 12,
  height: 12,
  borderRadius: "50%",
  background: color,
  boxShadow: glow ? `0 0 0 3px ${glow}` : undefined,
  flex: "0 0 auto",
});

const lineSwatch = (color: string, dashed?: boolean): CSSProperties => ({
  display: "inline-block",
  width: 28,
  height: 0,
  borderTop: `2px ${dashed ? "dashed" : "solid"} ${color}`,
  flex: "0 0 auto",
  marginTop: 6,
});

export const HANDLES: LegendRow[] = [
  { swatch: <span style={dot("#4a9eff")} />, label: "Blue dot",
    desc: "Default flow input/output. Drag from one to another node to connect." },
  { swatch: <span style={dot("#ff7675")} />, label: "Red dot",
    desc: "Error output. Connect to the node that handles failures for this phase." },
  { swatch: <span style={dot("#00b894", "rgba(0,184,148,0.55)")} />, label: "Green glow",
    desc: "Transient — appears while you're dragging a connection. Means \"valid drop target\"." },
  { swatch: <span style={dot("#fdcb6e")} />, label: "Yellow dot",
    desc: "Conditional output (XOR / If branches; shown only on those nodes)." },
];

export interface NodeRow {
  icon: string;
  label: string;
  desc: string;
}

export const NODES: NodeRow[] = [
  { icon: "▶", label: "Start",        desc: "Entry point of the flow." },
  { icon: "■", label: "End",          desc: "Terminal node." },
  { icon: "⚙", label: "Phase",        desc: "A unit of work — runs an action." },
  { icon: "◆", label: "Gateway XOR",  desc: "Pick exactly one of N branches." },
  { icon: "⬡", label: "Gateway AND",  desc: "Run all outgoing branches in parallel." },
  { icon: "↻", label: "Loop",         desc: "Repeat a sub-section of the flow." },
  { icon: "⊞", label: "Subflow",      desc: "Embed another flow as a single step." },
  { icon: "❓", label: "If",           desc: "Two-way conditional branch." },
  { icon: "⏱", label: "Timer",        desc: "Wait for a duration before continuing." },
];

export const EDGES: LegendRow[] = [
  { swatch: <span style={lineSwatch("#888")} />,         label: "Solid grey",   desc: "Default flow." },
  { swatch: <span style={lineSwatch("#fdcb6e")} />,      label: "Yellow",       desc: "Conditional branch." },
  { swatch: <span style={lineSwatch("#888", true)} />,   label: "Grey dashed",  desc: "Else branch." },
  { swatch: <span style={lineSwatch("#ff7675")} />,      label: "Red",          desc: "Error path." },
];

export const INTERACTIONS: string[] = [
  "Drag a node from the left palette onto the canvas to add it.",
  "Drag from a handle to another handle to connect.",
  "Click a node/edge to select it; properties show in the right panel.",
  "Drag a node to move; select + Delete to remove.",
  "Mouse wheel = zoom; click + drag empty canvas = pan.",
];

export const ADDING_PARAGRAPH =
  "Drag any item from the left \"Phases\" or \"Controls\" palette onto the canvas. " +
  "Then drag from its blue handle to another node's handle to connect them. " +
  "Wire up error paths by dragging from the red handle.";
```

---

## Task 4: Add HelpPanel component

**Files:**
- Create: `packages/flow-editor/src/canvas/HelpPanel.tsx`

- [ ] **Step 1: Create `HelpPanel.tsx`**

Create `packages/flow-editor/src/canvas/HelpPanel.tsx`:

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import {
  HANDLES, NODES, EDGES, INTERACTIONS, ADDING_PARAGRAPH,
  type LegendRow, type NodeRow,
} from "./help-content.tsx";

const STORAGE_KEY = "journeyman.flow-editor.help-seen";

function readSeen(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return true; // private mode → don't auto-open
  }
}

function writeSeen(): void {
  try {
    localStorage.setItem(STORAGE_KEY, "1");
  } catch {
    /* ignore */
  }
}

function isTextInputFocused(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return true;
  if (el.getAttribute("contenteditable") === "true") return true;
  return false;
}

export function HelpPanel() {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // First-run auto-open.
  useEffect(() => {
    if (!readSeen()) {
      setOpen(true);
      writeSeen();
    }
  }, []);

  // Keyboard: `?` toggles, Esc closes. Skip when a text field is focused.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && open) {
        setOpen(false);
        return;
      }
      if (e.key === "?" && !isTextInputFocused()) {
        setOpen(o => !o);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Click outside the panel closes it. The toggle button is excluded.
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      const t = e.target as Node;
      if (panelRef.current?.contains(t)) return;
      if (buttonRef.current?.contains(t)) return;
      setOpen(false);
    }
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [open]);

  const toggle = useCallback(() => {
    setOpen(o => {
      if (!o) writeSeen();
      return !o;
    });
  }, []);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="je-help-btn"
        aria-label="Help"
        title="Help (?)"
        onClick={toggle}
      >
        ?
      </button>
      <aside
        ref={panelRef}
        className={`je-help-panel ${open ? "je-help-panel--open" : ""}`}
        aria-hidden={!open}
      >
        <header className="je-help-panel__header">
          <span>How to use the editor</span>
          <button
            type="button"
            className="je-help-panel__close"
            aria-label="Close help"
            onClick={() => setOpen(false)}
          >
            ×
          </button>
        </header>
        <div className="je-help-panel__body">
          <Section title="Handles">
            {HANDLES.map(r => <LegendItem key={r.label} row={r} />)}
          </Section>
          <Section title="Node types">
            {NODES.map(n => <NodeItem key={n.label} row={n} />)}
          </Section>
          <Section title="Edge types">
            {EDGES.map(r => <LegendItem key={r.label} row={r} />)}
          </Section>
          <Section title="Interactions">
            <ul className="je-help-panel__list">
              {INTERACTIONS.map(s => <li key={s}>{s}</li>)}
            </ul>
          </Section>
          <Section title="Adding a node">
            <p className="je-help-panel__para">{ADDING_PARAGRAPH}</p>
          </Section>
        </div>
        <footer className="je-help-panel__footer">
          Press <kbd>?</kbd> to toggle, <kbd>Esc</kbd> to close.
        </footer>
      </aside>
    </>
  );
}

function Section(props: { title: string; children: React.ReactNode }) {
  return (
    <section className="je-help-panel__section">
      <h3>{props.title}</h3>
      {props.children}
    </section>
  );
}

function LegendItem(props: { row: LegendRow }) {
  return (
    <div className="je-help-panel__row">
      {props.row.swatch}
      <div>
        <div className="je-help-panel__row-label">{props.row.label}</div>
        <div className="je-help-panel__row-desc">{props.row.desc}</div>
      </div>
    </div>
  );
}

function NodeItem(props: { row: NodeRow }) {
  return (
    <div className="je-help-panel__row">
      <span className="je-help-panel__icon">{props.row.icon}</span>
      <div>
        <div className="je-help-panel__row-label">{props.row.label}</div>
        <div className="je-help-panel__row-desc">{props.row.desc}</div>
      </div>
    </div>
  );
}
```

---

## Task 5: Add Help panel CSS

**Files:**
- Modify: `packages/flow-editor/src/styles.css` (append at end)

- [ ] **Step 1: Append the Help panel styles**

Append the following CSS to the end of `packages/flow-editor/src/styles.css`:

```css
/* ---------- Help panel ---------- */
.je-help-btn {
  position: absolute;
  bottom: 16px;
  right: 16px;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: #2a2a3e;
  color: #ddd;
  border: 1px solid #444;
  font-size: 18px;
  font-weight: 600;
  cursor: pointer;
  z-index: 5;
  display: flex;
  align-items: center;
  justify-content: center;
}
.je-help-btn:hover {
  background: #34344a;
}

.je-help-panel {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: 320px;
  background: #1a1a26;
  border-left: 1px solid #2a2a3e;
  color: #ddd;
  transform: translateX(100%);
  transition: transform 180ms ease;
  display: flex;
  flex-direction: column;
  z-index: 6;
  overflow: hidden;
}
.je-help-panel--open {
  transform: translateX(0);
}
.je-help-panel__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  border-bottom: 1px solid #2a2a3e;
  font-weight: 600;
}
.je-help-panel__close {
  background: transparent;
  color: #aaa;
  border: 0;
  font-size: 18px;
  cursor: pointer;
}
.je-help-panel__close:hover { color: #fff; }
.je-help-panel__body {
  flex: 1;
  overflow-y: auto;
  padding: 12px 14px;
}
.je-help-panel__section { margin-bottom: 18px; }
.je-help-panel__section h3 {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #888;
  margin: 0 0 8px;
}
.je-help-panel__row {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  margin-bottom: 8px;
}
.je-help-panel__row-label {
  font-size: 13px;
  color: #eee;
}
.je-help-panel__row-desc {
  font-size: 12px;
  color: #999;
  line-height: 1.4;
}
.je-help-panel__icon {
  display: inline-block;
  width: 16px;
  text-align: center;
  color: #ccc;
}
.je-help-panel__list {
  margin: 0;
  padding-left: 18px;
  font-size: 12px;
  color: #bbb;
  line-height: 1.5;
}
.je-help-panel__para {
  margin: 0;
  font-size: 12px;
  color: #bbb;
  line-height: 1.5;
}
.je-help-panel__footer {
  padding: 10px 14px;
  border-top: 1px solid #2a2a3e;
  font-size: 11px;
  color: #777;
}
.je-help-panel__footer kbd {
  background: #2a2a3e;
  border: 1px solid #444;
  border-radius: 3px;
  padding: 1px 5px;
  font-size: 10px;
  color: #ddd;
}
```

Note: `.je-editor__canvas` must be a positioning context for `position: absolute` children to anchor inside it. Verify: open `styles.css` and confirm `.je-editor__canvas` already has `position: relative` (or is a flex/grid item that establishes one). If it does not, add `position: relative;` to its existing rule. Do this in the same edit.

---

## Task 6: Mount HelpPanel in Canvas

**Files:**
- Modify: `packages/flow-editor/src/canvas/Canvas.tsx`

- [ ] **Step 1: Import and render `<HelpPanel />`**

In `packages/flow-editor/src/canvas/Canvas.tsx`:

a) Add the import alongside the other local imports near the top:

```ts
import { HelpPanel } from "./HelpPanel.tsx";
```

b) Inside the returned JSX of `CanvasInner`, add `<HelpPanel />` as a sibling of `<ReactFlow>` inside the wrapper div. The block becomes:

```tsx
return (
  <div ref={wrapper} className="je-editor__canvas" onDrop={handleDrop} onDragOver={handleDragOver}>
    <ReactFlow
      /* ...all existing props unchanged... */
    >
      <Background />
      <Controls />
    </ReactFlow>
    <HelpPanel />
  </div>
);
```

Do not change any `<ReactFlow>` props.

---

## Task 7: Manual verification

**Files:** none (manual)

- [ ] **Step 1: Start the dev server**

Run from repo root:

```bash
npm --workspace @journeyman/web run dev
```

(If the package script differs, fall back to whichever script the user normally runs for the `packages/web` Vite app.)

- [ ] **Step 2: Verify the handle bug fix**

Open the editor and inspect a Phase node. Expected:
- Two **blue** handles (input + default output).
- One **red** handle (error output).
- No green handles at rest.
- While dragging a connection from a handle, **that one** handle glows green (`.connectingfrom`). All other handles remain blue/red.

- [ ] **Step 3: Verify the Help panel**

In DevTools application tab, clear `localStorage` key `journeyman.flow-editor.help-seen`, then reload. Expected on first load: panel auto-opens.

Then check:
- A `?` button is visible at the bottom-right of the canvas, not overlapping React Flow's `<Controls>` (bottom-left).
- Click `?` → panel toggles open/closed with a slide animation.
- Press `?` (focus on canvas, no input) → toggles.
- Press `Esc` while open → closes.
- Click anywhere outside the panel while it's open → closes.
- Click inside the panel → stays open.
- Reload after closing once → panel does NOT auto-open.
- Focus a text input (e.g. node display-name field in the right panel) and press `?` → panel does NOT toggle.

- [ ] **Step 4: Verify the Canvas refactor didn't regress**

- Drag a phase from the palette onto the canvas → node appears at the drop point.
- Drag from a node's handle to another node's handle → edge appears.
- Select an edge and press Delete → edge is removed (this was the previous feedback-loop bug area).
- Move a node by dragging → the parent flow updates after drag-end (right panel reflects new position if applicable).

---

## Task 8: Final typecheck

**Files:** none (verification only)

- [ ] **Step 1: Run typecheck**

```bash
npm run typecheck
```

Expected: exits 0 with no errors. If errors appear, fix them in place — they are most likely missed unused-import cleanups in `Canvas.tsx` from Task 2 (`MarkerType`, possibly `FlowEdge`/`FlowNode` if a handler shape changed).

Per user instruction: **do not commit**. Stop here.
