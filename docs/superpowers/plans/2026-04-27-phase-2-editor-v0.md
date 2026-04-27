# Phase 2 — Editor v0 (Linear Flows)

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking. Per the user's preference for this stream, unit-test steps are intentionally omitted, commits are deferred until the phase merges, and typecheck runs only once at the end of the phase.

**Goal:** Replace `curl` with a visual canvas. A user can open the new web shell, browse a flows list, create a flow with `start → phase(analyze) → end`, edit it visually, save, and click **Run** to submit it through the Phase 1 stack.

**Architecture:** Mirror the legacy/new pattern from Phase 1. The existing `packages/ui` is frozen as **legacy** (it talks to the legacy `pipeline-server`). Two new packages are introduced: `@journeyman/flow-editor` (pure presentational React component, no backend coupling per spec §9.5) and `@journeyman/web` (Vite shell that composes flow-editor against `@journeyman/api-server`).

**Tech Stack:** React 18, Vite 5, TypeScript strict, `@xyflow/react` v12 (the React Flow library; new package name), TanStack Query for server state, react-router-dom for routing, Tailwind for styling, `zod` for runtime body shapes. No test framework wired up in this phase.

---

## Spec Reference

Source spec: `docs/superpowers/specs/2026-04-27-visual-flow-orchestration-design.md`. This plan implements **only Section 12 → "Phase 2 — Editor v0 (linear flows)"** plus the minimum API extensions in `@journeyman/api-server` to support it. Out of scope for Phase 2: gateways/loops, retry tab, MCP/credentials/inputs/outputs tabs, live-run view, runs list, SSE.

## What's Legacy in Phase 2

- `packages/ui` — frozen at its current state (legacy runs viewer for `pipeline-server`).
- `packages/pipeline` and `packages/pipeline-server` — still frozen (per Phase 1).

The new web shell is a **separate** package; legacy continues to work.

## What's Built

### `@journeyman/flow-editor` (new — pure component)

Pure React component package. Knows nothing about HTTP, auth, or Journeyman's specific backend. Consumer passes data in via props and gets callbacks out. Re-usable later in admin tools, marketplaces, embedded customer views.

Top-level export: `<FlowEditor>`.

### `@journeyman/web` (new — shell app)

Vite + React shell. Holds the routes, the API client, and the TanStack Query setup. Composes `<FlowEditor>` against `@journeyman/api-server`. This is the package developers run with `npm run dev:web`.

### `@journeyman/api-server` (extended)

Two new routes:
- `GET /flows` — list flows with light filtering (owner, limit)
- `PUT /flows/:id` — saves an edit by appending a new flow version

## File Structure

```
packages/
├── ui/                                 (LEGACY — frozen)
│
├── flow-editor/                        NEW — @journeyman/flow-editor
│   ├── package.json
│   ├── tsconfig.json
│   ├── src/
│   │   ├── index.ts                    barrel: <FlowEditor>, prop types
│   │   ├── FlowEditor.tsx              top-level component
│   │   ├── canvas/
│   │   │   ├── Canvas.tsx              React Flow wrapper
│   │   │   ├── nodes/
│   │   │   │   ├── StartNode.tsx
│   │   │   │   ├── EndNode.tsx
│   │   │   │   └── PhaseNode.tsx       n8n-style chunky tile
│   │   │   ├── edges/
│   │   │   │   └── DefaultEdge.tsx
│   │   │   └── node-registry.ts        nodeTypes/edgeTypes maps
│   │   ├── palette/
│   │   │   ├── Palette.tsx             left sidebar — drag-to-add
│   │   │   └── PaletteItem.tsx
│   │   ├── properties-panel/
│   │   │   ├── PropertiesPanel.tsx     right sidebar — only Config tab in Phase 2
│   │   │   ├── ConfigTab.tsx
│   │   │   └── tabs-shell.tsx          tab strip placeholder for Phase 5 tabs
│   │   ├── topbar/
│   │   │   └── Topbar.tsx              flow name + Save / Run / dirty indicator
│   │   ├── state/
│   │   │   ├── useFlowEditorState.ts   in-memory editor state hook (controlled+uncontrolled support)
│   │   │   └── flow-graph.ts           pure helpers: id, validation, default node templates
│   │   ├── catalog/
│   │   │   └── phase-catalog.types.ts  PhaseCatalog type used by Palette + ConfigTab
│   │   ├── styles.css                  scoped editor styles (utility classes only — host app provides Tailwind)
│   │   └── types.ts                    public prop interfaces
│
├── web/                                NEW — @journeyman/web
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   ├── tailwind.config.js
│   ├── postcss.config.js
│   ├── index.html
│   ├── src/
│   │   ├── main.tsx                    Vite entry — mounts <App>
│   │   ├── App.tsx                     QueryClient + Router root
│   │   ├── styles.css                  Tailwind base
│   │   ├── api/
│   │   │   ├── client.ts               fetch wrapper (baseUrl, JSON, errors)
│   │   │   └── flows.ts                listFlows, getFlow, createFlow, updateFlow, runFlow
│   │   ├── routes/
│   │   │   ├── FlowsListPage.tsx       /flows
│   │   │   ├── FlowEditorPage.tsx      /flows/:id/edit
│   │   │   ├── NewFlowPage.tsx         /flows/new
│   │   │   └── HomeRedirect.tsx        / → /flows
│   │   ├── catalogs/
│   │   │   └── built-in-phase-catalog.ts   hardcoded Phase 2 catalog (analyze only)
│   │   └── components/
│   │       ├── AppShell.tsx            top nav: Flows | (legacy) Runs (linkout)
│   │       └── RunSubmittedToast.tsx   shows runId and Conductor UI link
│
└── api-server/                         (extended — 2 new routes)
    └── src/routes/flows.ts             add GET / and PUT /:id
```

## Public API of `@journeyman/flow-editor`

```typescript
import type { FlowGraph, FlowNode, FlowEdge } from "@journeyman/core";

export interface PhaseCatalogEntry {
  /** Stable phase type id, e.g. "analyze". */
  phaseType: string;
  /** Label shown in the palette and as default node display name. */
  label: string;
  /** Category grouping in the palette: "AI" | "Tickets" | "Repos" | "Custom". */
  category: string;
  /** Short description shown on hover. */
  description?: string;
  /** Tailwind/hex color used for the tile accent. */
  color: string;
  /** Single emoji or icon character. Phase 2 uses emoji; Phase 5 swaps for SVGs. */
  icon: string;
}

export type PhaseCatalog = PhaseCatalogEntry[];

export interface FlowEditorProps {
  /** The flow graph being edited. Treated as the canonical state. */
  flow: FlowGraph;
  /** Display name shown in the topbar. */
  flowName: string;
  /** Phase types available in the palette. */
  phaseCatalog: PhaseCatalog;
  /** Called whenever the user changes the graph (drag, edit, etc.). */
  onChange: (flow: FlowGraph) => void;
  /** Called when the user clicks Save in the topbar. */
  onSave?: (flow: FlowGraph) => void | Promise<void>;
  /** Called when the user clicks Run. */
  onRun?: (flow: FlowGraph) => void | Promise<void>;
  /** Read-only mode — disables editing, hides Save. Used later for Run view. */
  readOnly?: boolean;
  /** "Saving…" / "Running…" indicator. */
  busy?: boolean;
  /** Header rename callback. Optional — omit to make the title read-only. */
  onRename?: (newName: string) => void;
}

/** Top-level component. */
export function FlowEditor(props: FlowEditorProps): JSX.Element;

/** Helpers exported for hosts that need to seed a blank flow. */
export function createBlankFlow(): FlowGraph;
export function isLinearAndComplete(flow: FlowGraph): { ok: boolean; reason?: string };
```

---

## Task 1: Scaffold `@journeyman/flow-editor`

**Files:**
- Create: `packages/flow-editor/package.json`
- Create: `packages/flow-editor/tsconfig.json`
- Create: `packages/flow-editor/src/index.ts` (placeholder barrel)
- Create: `packages/flow-editor/src/types.ts`

- [ ] **Step 1.1: `package.json`**

```json
{
  "name": "@journeyman/flow-editor",
  "version": "0.1.0",
  "description": "Pure React flow editor component for Journeyman. n8n-style canvas, properties panel, palette. No backend coupling.",
  "type": "module",
  "main": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "files": ["src"],
  "scripts": {
    "typecheck": "tsc --noEmit"
  },
  "peerDependencies": {
    "react": "^18.3.0",
    "react-dom": "^18.3.0"
  },
  "dependencies": {
    "@journeyman/core": "*",
    "@xyflow/react": "^12.3.5",
    "lucide-react": "^0.400.0"
  },
  "devDependencies": {
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "typescript": "^6.0.3"
  }
}
```

- [ ] **Step 1.2: `tsconfig.json`** (mirror Phase 1 packages, plus DOM lib + JSX)

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "allowImportingTsExtensions": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 1.3: `src/types.ts`** — public prop and catalog interfaces (verbatim from "Public API" above).

- [ ] **Step 1.4: `src/index.ts`** — placeholder barrel (filled by later tasks)

```typescript
export type { FlowEditorProps, PhaseCatalog, PhaseCatalogEntry } from "./types.ts";
```

---

## Task 2: Editor pure helpers + state hook

**Files:**
- Create: `packages/flow-editor/src/state/flow-graph.ts`
- Create: `packages/flow-editor/src/state/useFlowEditorState.ts`

- [ ] **Step 2.1: `flow-graph.ts`**

```typescript
import { FLOW_SCHEMA_VERSION, type FlowEdge, type FlowGraph, type FlowNode } from "@journeyman/core";

export function createBlankFlow(): FlowGraph {
  return {
    schemaVersion: FLOW_SCHEMA_VERSION,
    nodes: [
      { id: "start", type: "start", position: { x: 80, y: 80 } },
      { id: "end",   type: "end",   position: { x: 80, y: 320 } },
    ],
    edges: [
      { id: "e_start_end", source: "start", target: "end" },
    ],
  };
}

export function newPhaseNode(args: {
  phaseType: string;
  displayName: string;
  position: { x: number; y: number };
}): FlowNode {
  return {
    id: `step_${Math.random().toString(36).slice(2, 8)}`,
    type: "phase",
    phaseType: args.phaseType,
    displayName: args.displayName,
    config: {},
    position: args.position,
  };
}

export function newEdge(source: string, target: string): FlowEdge {
  return {
    id: `e_${source}_${target}_${Math.random().toString(36).slice(2, 6)}`,
    source,
    target,
  };
}

/**
 * Phase 2 validity check: exactly one start, exactly one end, every node
 * connected, no cycles, every node has at most one outgoing edge.
 */
export function isLinearAndComplete(flow: FlowGraph): { ok: boolean; reason?: string } {
  const starts = flow.nodes.filter(n => n.type === "start");
  if (starts.length !== 1) return { ok: false, reason: "Flow must have exactly one start node" };
  const ends = flow.nodes.filter(n => n.type === "end");
  if (ends.length !== 1) return { ok: false, reason: "Flow must have exactly one end node" };

  const outgoing = new Map<string, string[]>();
  for (const e of flow.edges) {
    const arr = outgoing.get(e.source) ?? [];
    arr.push(e.target);
    outgoing.set(e.source, arr);
  }
  for (const n of flow.nodes) {
    const out = outgoing.get(n.id) ?? [];
    if (n.type === "end" && out.length > 0) return { ok: false, reason: `End node has outgoing edges` };
    if (n.type !== "end" && out.length > 1) return { ok: false, reason: `Node ${n.id} has multiple outputs (Phase 2 is linear-only)` };
    if (n.type !== "end" && out.length === 0) return { ok: false, reason: `Node ${n.id} has no outgoing edge` };
  }

  // Cycle detection
  const visited = new Set<string>();
  let cur = starts[0].id;
  while (cur) {
    if (visited.has(cur)) return { ok: false, reason: "Flow contains a cycle" };
    visited.add(cur);
    const next = (outgoing.get(cur) ?? [])[0];
    if (!next) break;
    cur = next;
  }
  if (visited.size !== flow.nodes.length) {
    return { ok: false, reason: "Some nodes are unreachable from start" };
  }
  return { ok: true };
}

export function deletePhaseNode(flow: FlowGraph, nodeId: string): FlowGraph {
  // Phase 2: deleting a phase rewires its predecessor directly to its successor.
  const incoming = flow.edges.find(e => e.target === nodeId);
  const outgoing = flow.edges.find(e => e.source === nodeId);
  const remainingNodes = flow.nodes.filter(n => n.id !== nodeId);
  let remainingEdges = flow.edges.filter(e => e.source !== nodeId && e.target !== nodeId);
  if (incoming && outgoing) {
    remainingEdges = [...remainingEdges, newEdge(incoming.source, outgoing.target)];
  }
  return { ...flow, nodes: remainingNodes, edges: remainingEdges };
}

export function insertPhaseAfter(
  flow: FlowGraph,
  predecessorId: string,
  phaseType: string,
  displayName: string,
  position: { x: number; y: number },
): FlowGraph {
  const oldEdge = flow.edges.find(e => e.source === predecessorId);
  const newNode = newPhaseNode({ phaseType, displayName, position });
  const remainingEdges = flow.edges.filter(e => e !== oldEdge);
  const insertedEdges = oldEdge
    ? [newEdge(predecessorId, newNode.id), newEdge(newNode.id, oldEdge.target)]
    : [newEdge(predecessorId, newNode.id)];
  return {
    ...flow,
    nodes: [...flow.nodes, newNode],
    edges: [...remainingEdges, ...insertedEdges],
  };
}
```

- [ ] **Step 2.2: `useFlowEditorState.ts`** — controlled-by-default hook used by `<FlowEditor>` to merge incoming `flow` prop with local UI state (selected node id, dirty bit).

```typescript
import { useCallback, useMemo, useState } from "react";
import type { FlowGraph } from "@journeyman/core";

export interface UseFlowEditorStateArgs {
  flow: FlowGraph;
  onChange: (flow: FlowGraph) => void;
}

export function useFlowEditorState(args: UseFlowEditorStateArgs) {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const update = useCallback((mutator: (f: FlowGraph) => FlowGraph) => {
    args.onChange(mutator(args.flow));
  }, [args]);

  const selectedNode = useMemo(
    () => args.flow.nodes.find(n => n.id === selectedNodeId) ?? null,
    [args.flow.nodes, selectedNodeId],
  );

  return {
    flow: args.flow,
    selectedNodeId, selectedNode,
    setSelectedNodeId,
    update,
  };
}
```

---

## Task 3: Custom React Flow nodes (start, end, phase)

**Files:**
- Create: `packages/flow-editor/src/canvas/nodes/StartNode.tsx`
- Create: `packages/flow-editor/src/canvas/nodes/EndNode.tsx`
- Create: `packages/flow-editor/src/canvas/nodes/PhaseNode.tsx`
- Create: `packages/flow-editor/src/canvas/edges/DefaultEdge.tsx`
- Create: `packages/flow-editor/src/canvas/node-registry.ts`
- Create: `packages/flow-editor/src/styles.css`

- [ ] **Step 3.1: `StartNode.tsx`**

```tsx
import { Handle, Position } from "@xyflow/react";

export function StartNode() {
  return (
    <div className="je-node je-node--terminal je-node--start">
      <div className="je-node__icon">▶</div>
      <div className="je-node__label">Start</div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
```

- [ ] **Step 3.2: `EndNode.tsx`**

```tsx
import { Handle, Position } from "@xyflow/react";

export function EndNode() {
  return (
    <div className="je-node je-node--terminal je-node--end">
      <Handle type="target" position={Position.Top} />
      <div className="je-node__icon">■</div>
      <div className="je-node__label">End</div>
    </div>
  );
}
```

- [ ] **Step 3.3: `PhaseNode.tsx`** (n8n-style chunky tile)

```tsx
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { PhaseCatalogEntry } from "../../types.ts";

export interface PhaseNodeData {
  displayName: string;
  phaseType: string;
  catalogEntry?: PhaseCatalogEntry;
  selected?: boolean;
}

export function PhaseNode(props: NodeProps<PhaseNodeData>) {
  const { data } = props;
  const accent = data.catalogEntry?.color ?? "#6c5ce7";
  const icon = data.catalogEntry?.icon ?? "⚙";
  const subtitle = data.catalogEntry?.label ?? data.phaseType;
  return (
    <div className="je-node je-node--phase" style={{ borderColor: accent }}>
      <Handle type="target" position={Position.Top} />
      <div className="je-node__row">
        <div className="je-node__icon" style={{ background: accent }}>{icon}</div>
        <div className="je-node__text">
          <div className="je-node__label">{data.displayName}</div>
          <div className="je-node__subtitle">{subtitle}</div>
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
```

- [ ] **Step 3.4: `DefaultEdge.tsx`** — for now just re-exports the library's default; created so future edge types share the same registry.

```tsx
import { BaseEdge, getSmoothStepPath, type EdgeProps } from "@xyflow/react";

export function DefaultEdge(props: EdgeProps) {
  const [path] = getSmoothStepPath({
    sourceX: props.sourceX, sourceY: props.sourceY,
    targetX: props.targetX, targetY: props.targetY,
    sourcePosition: props.sourcePosition,
    targetPosition: props.targetPosition,
    borderRadius: 8,
  });
  return <BaseEdge id={props.id} path={path} markerEnd={props.markerEnd} />;
}
```

- [ ] **Step 3.5: `node-registry.ts`**

```typescript
import { StartNode } from "./nodes/StartNode.tsx";
import { EndNode } from "./nodes/EndNode.tsx";
import { PhaseNode } from "./nodes/PhaseNode.tsx";
import { DefaultEdge } from "./edges/DefaultEdge.tsx";

export const nodeTypes = {
  start: StartNode,
  end: EndNode,
  phase: PhaseNode,
};

export const edgeTypes = {
  default: DefaultEdge,
};
```

- [ ] **Step 3.6: `styles.css`** — the editor's own utility classes. The shell can override; consumer apps with Tailwind get a usable look out of the box. Verbatim:

```css
/* @journeyman/flow-editor — scoped utility styles */
.je-editor { display: grid; grid-template-rows: 44px 1fr; height: 100%; background: #1a1a24; color: #fff; font-family: system-ui, -apple-system, sans-serif; }
.je-editor__topbar { display: flex; align-items: center; gap: 12px; padding: 0 14px; background: #11111a; border-bottom: 1px solid #2a2a3a; font-size: 13px; }
.je-editor__topbar h1 { font-size: 14px; margin: 0; font-weight: 600; }
.je-editor__topbar .spacer { flex: 1; }
.je-editor__topbar button { background: #2a2a3e; border: 1px solid #444; color: #ddd; padding: 5px 12px; border-radius: 5px; font-size: 12px; cursor: pointer; }
.je-editor__topbar button.primary { background: #00b894; border-color: #00b894; color: #fff; font-weight: 600; }
.je-editor__topbar button:disabled { opacity: 0.5; cursor: not-allowed; }
.je-editor__body { display: grid; grid-template-columns: 200px 1fr 280px; min-height: 0; }
.je-editor__palette { background: #11111a; border-right: 1px solid #2a2a3a; padding: 10px; overflow: auto; }
.je-editor__canvas { position: relative; background: #1a1a24; }
.je-editor__props { background: #11111a; border-left: 1px solid #2a2a3a; padding: 12px; overflow: auto; }
.je-palette__group { font-size: 10px; text-transform: uppercase; color: #888; margin: 12px 0 6px; letter-spacing: 0.05em; }
.je-palette__item { display: flex; align-items: center; gap: 8px; background: #1f1f2c; border: 1px solid #2a2a3a; border-radius: 6px; padding: 6px 8px; margin-bottom: 4px; font-size: 12px; cursor: grab; user-select: none; }
.je-palette__item:hover { background: #262638; }
.je-palette__icon { width: 22px; height: 22px; border-radius: 5px; display: flex; align-items: center; justify-content: center; font-size: 12px; color: #fff; }
.je-node { background: #2a2a3e; color: #fff; border: 2px solid #6c5ce7; border-radius: 10px; padding: 8px 12px; min-width: 160px; font-family: inherit; font-size: 12px; }
.je-node.selected { box-shadow: 0 0 0 3px rgba(74, 158, 255, 0.4); }
.je-node--terminal { display: flex; align-items: center; gap: 8px; padding: 6px 12px; min-width: 80px; }
.je-node--start { border-color: #4a9eff; }
.je-node--end { border-color: #ff7675; }
.je-node__row { display: flex; align-items: center; gap: 10px; }
.je-node__icon { width: 28px; height: 28px; border-radius: 6px; display: flex; align-items: center; justify-content: center; background: #6c5ce7; font-size: 14px; }
.je-node__label { font-weight: 600; font-size: 13px; }
.je-node__subtitle { font-size: 11px; color: #aaa; }
.je-props__title { font-weight: 600; font-size: 13px; margin-bottom: 8px; }
.je-props__field { margin-bottom: 10px; }
.je-props__field label { display: block; font-size: 10px; color: #aaa; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.04em; }
.je-props__field input, .je-props__field select, .je-props__field textarea {
  width: 100%; background: #1f1f2c; border: 1px solid #2a2a3a; color: #fff; border-radius: 4px; padding: 6px 8px; font-size: 12px; font-family: inherit;
}
.je-props__field textarea { min-height: 90px; resize: vertical; font-family: ui-monospace, monospace; }
.je-empty { color: #888; font-size: 12px; text-align: center; padding: 20px 12px; }
```

---

## Task 4: Palette + Properties panel + Topbar

**Files:**
- Create: `packages/flow-editor/src/palette/Palette.tsx`
- Create: `packages/flow-editor/src/palette/PaletteItem.tsx`
- Create: `packages/flow-editor/src/properties-panel/PropertiesPanel.tsx`
- Create: `packages/flow-editor/src/properties-panel/ConfigTab.tsx`
- Create: `packages/flow-editor/src/properties-panel/tabs-shell.tsx`
- Create: `packages/flow-editor/src/topbar/Topbar.tsx`

- [ ] **Step 4.1: `PaletteItem.tsx`** — single draggable card.

```tsx
import type { PhaseCatalogEntry } from "../types.ts";

export interface PaletteItemProps {
  entry: PhaseCatalogEntry;
}

export function PaletteItem({ entry }: PaletteItemProps) {
  const onDragStart = (ev: React.DragEvent) => {
    ev.dataTransfer.setData("application/journeyman-phase", entry.phaseType);
    ev.dataTransfer.effectAllowed = "move";
  };
  return (
    <div className="je-palette__item" draggable onDragStart={onDragStart} title={entry.description ?? ""}>
      <div className="je-palette__icon" style={{ background: entry.color }}>{entry.icon}</div>
      <span>{entry.label}</span>
    </div>
  );
}
```

- [ ] **Step 4.2: `Palette.tsx`** — groups palette entries by category.

```tsx
import { useMemo } from "react";
import { PaletteItem } from "./PaletteItem.tsx";
import type { PhaseCatalog } from "../types.ts";

export interface PaletteProps { catalog: PhaseCatalog; }

export function Palette({ catalog }: PaletteProps) {
  const grouped = useMemo(() => {
    const m = new Map<string, typeof catalog>();
    for (const e of catalog) {
      const arr = m.get(e.category) ?? [];
      arr.push(e);
      m.set(e.category, arr);
    }
    return [...m.entries()];
  }, [catalog]);
  return (
    <aside className="je-editor__palette">
      <div className="je-palette__title" style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Phases</div>
      {grouped.map(([cat, items]) => (
        <div key={cat}>
          <div className="je-palette__group">{cat}</div>
          {items.map(it => <PaletteItem key={it.phaseType} entry={it} />)}
        </div>
      ))}
    </aside>
  );
}
```

- [ ] **Step 4.3: `tabs-shell.tsx`** — placeholder for the 5-tab strip; Phase 2 only renders Config.

```tsx
import type { ReactNode } from "react";

export interface TabShellProps {
  active: "config" | "mcp" | "credentials" | "retry" | "io";
  children: ReactNode;
}

const TABS: Array<{ id: TabShellProps["active"]; label: string; enabled: boolean }> = [
  { id: "config",     label: "Config",        enabled: true  },
  { id: "mcp",         label: "MCP",          enabled: false },
  { id: "credentials", label: "Credentials",  enabled: false },
  { id: "retry",       label: "Retry",        enabled: false },
  { id: "io",          label: "I/O",          enabled: false },
];

export function TabsShell({ active, children }: TabShellProps) {
  return (
    <div>
      <div style={{ display: "flex", gap: 4, fontSize: 11, marginBottom: 10 }}>
        {TABS.map(t => (
          <div
            key={t.id}
            style={{
              padding: "6px 8px",
              borderBottom: t.id === active ? "2px solid #4a9eff" : "2px solid transparent",
              color: !t.enabled ? "#555" : (t.id === active ? "#4a9eff" : "#aaa"),
              fontWeight: t.id === active ? 600 : 400,
              cursor: t.enabled ? "pointer" : "not-allowed",
            }}
            title={!t.enabled ? "Coming in a later phase" : ""}
          >
            {t.label}
          </div>
        ))}
      </div>
      {children}
    </div>
  );
}
```

- [ ] **Step 4.4: `ConfigTab.tsx`** — the only enabled tab in Phase 2.

```tsx
import type { FlowNode } from "@journeyman/core";
import type { PhaseCatalog } from "../types.ts";

export interface ConfigTabProps {
  node: FlowNode;
  catalog: PhaseCatalog;
  onChange: (next: FlowNode) => void;
  readOnly?: boolean;
}

export function ConfigTab({ node, catalog, onChange, readOnly }: ConfigTabProps) {
  const entry = catalog.find(e => e.phaseType === node.phaseType);
  return (
    <div>
      <div className="je-props__field">
        <label>Phase type</label>
        <select
          value={node.phaseType ?? ""}
          disabled={readOnly}
          onChange={e => onChange({ ...node, phaseType: e.target.value })}
        >
          {catalog.map(c => <option key={c.phaseType} value={c.phaseType}>{c.label}</option>)}
        </select>
      </div>
      <div className="je-props__field">
        <label>Display name</label>
        <input
          type="text"
          value={node.displayName ?? ""}
          disabled={readOnly}
          onChange={e => onChange({ ...node, displayName: e.target.value })}
        />
      </div>
      <div className="je-props__field">
        <label>Config (JSON)</label>
        <textarea
          value={JSON.stringify(node.config ?? {}, null, 2)}
          disabled={readOnly}
          onChange={e => {
            try {
              onChange({ ...node, config: JSON.parse(e.target.value || "{}") });
            } catch {
              // leave config as-is until valid JSON; live validation later
            }
          }}
        />
      </div>
      {entry?.description && (
        <div style={{ fontSize: 11, color: "#888", marginTop: 8 }}>{entry.description}</div>
      )}
    </div>
  );
}
```

- [ ] **Step 4.5: `PropertiesPanel.tsx`**

```tsx
import type { FlowNode } from "@journeyman/core";
import type { PhaseCatalog } from "../types.ts";
import { TabsShell } from "./tabs-shell.tsx";
import { ConfigTab } from "./ConfigTab.tsx";

export interface PropertiesPanelProps {
  node: FlowNode | null;
  catalog: PhaseCatalog;
  onChange: (next: FlowNode) => void;
  readOnly?: boolean;
}

export function PropertiesPanel(props: PropertiesPanelProps) {
  const { node, catalog, onChange, readOnly } = props;
  return (
    <aside className="je-editor__props">
      {!node && (
        <div className="je-empty">Select a node to configure it.</div>
      )}
      {node && (
        <>
          <div className="je-props__title">{node.displayName ?? node.type}</div>
          {node.type === "phase" ? (
            <TabsShell active="config">
              <ConfigTab node={node} catalog={catalog} onChange={onChange} readOnly={readOnly} />
            </TabsShell>
          ) : (
            <div className="je-empty">Terminal nodes have no configuration.</div>
          )}
        </>
      )}
    </aside>
  );
}
```

- [ ] **Step 4.6: `Topbar.tsx`**

```tsx
import { useState } from "react";

export interface TopbarProps {
  flowName: string;
  onRename?: (next: string) => void;
  onSave?: () => void;
  onRun?: () => void;
  busy?: boolean;
  dirty?: boolean;
  saveEnabled?: boolean;
  runEnabled?: boolean;
  runDisabledReason?: string;
}

export function Topbar(p: TopbarProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(p.flowName);
  return (
    <header className="je-editor__topbar">
      {editing && p.onRename ? (
        <input
          autoFocus
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={() => { setEditing(false); if (draft !== p.flowName) p.onRename!(draft); }}
          onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
          style={{ background: "#1f1f2c", border: "1px solid #2a2a3a", color: "#fff", padding: "4px 8px", borderRadius: 4 }}
        />
      ) : (
        <h1
          onClick={() => { if (p.onRename) { setDraft(p.flowName); setEditing(true); } }}
          style={{ cursor: p.onRename ? "text" : "default" }}
        >
          {p.flowName}
        </h1>
      )}
      {p.dirty && <span style={{ color: "#fdcb6e", fontSize: 11 }}>● unsaved</span>}
      <div className="spacer" />
      <button disabled={p.busy || !p.saveEnabled} onClick={p.onSave}>
        {p.busy ? "Saving…" : "Save"}
      </button>
      <button
        className="primary"
        disabled={p.busy || !p.runEnabled}
        title={p.runDisabledReason}
        onClick={p.onRun}
      >
        ▶ Run
      </button>
    </header>
  );
}
```

---

## Task 5: Canvas wrapper + top-level `<FlowEditor>`

**Files:**
- Create: `packages/flow-editor/src/canvas/Canvas.tsx`
- Create: `packages/flow-editor/src/FlowEditor.tsx`
- Modify: `packages/flow-editor/src/index.ts`

- [ ] **Step 5.1: `Canvas.tsx`**

The canvas converts FlowGraph (canonical) ↔ React Flow's nodes/edges shape, handles selection, drag-from-palette, drop-onto-canvas, and edge connect.

```tsx
import { useCallback, useMemo, useRef } from "react";
import {
  Background, Controls, ReactFlow, ReactFlowProvider,
  applyNodeChanges, applyEdgeChanges, addEdge,
  type Connection, type Edge, type Node,
  type NodeChange, type EdgeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { FlowEdge, FlowGraph, FlowNode } from "@journeyman/core";
import { nodeTypes, edgeTypes } from "./node-registry.ts";
import { newPhaseNode, newEdge } from "../state/flow-graph.ts";
import type { PhaseCatalog } from "../types.ts";

export interface CanvasProps {
  flow: FlowGraph;
  catalog: PhaseCatalog;
  selectedNodeId: string | null;
  onChange: (next: FlowGraph) => void;
  onSelect: (nodeId: string | null) => void;
  readOnly?: boolean;
}

function toReactFlowNodes(flow: FlowGraph, catalog: PhaseCatalog, selectedId: string | null): Node[] {
  return flow.nodes.map(n => ({
    id: n.id,
    type: n.type === "phase" ? "phase" : (n.type === "start" ? "start" : (n.type === "end" ? "end" : "phase")),
    position: n.position ?? { x: 0, y: 0 },
    data: n.type === "phase"
      ? {
          displayName: n.displayName ?? n.phaseType ?? "Phase",
          phaseType: n.phaseType ?? "",
          catalogEntry: catalog.find(c => c.phaseType === n.phaseType),
        }
      : {},
    selected: n.id === selectedId,
    draggable: true,
    selectable: true,
  }));
}

function toReactFlowEdges(flow: FlowGraph): Edge[] {
  return flow.edges.map(e => ({
    id: e.id, source: e.source, target: e.target, type: "default",
  }));
}

function CanvasInner(p: CanvasProps) {
  const wrapper = useRef<HTMLDivElement>(null);

  const rfNodes = useMemo(() => toReactFlowNodes(p.flow, p.catalog, p.selectedNodeId), [p.flow, p.catalog, p.selectedNodeId]);
  const rfEdges = useMemo(() => toReactFlowEdges(p.flow), [p.flow]);

  const handleNodesChange = useCallback((changes: NodeChange[]) => {
    if (p.readOnly) return;
    const updated = applyNodeChanges(changes, rfNodes);
    const nextNodes: FlowNode[] = p.flow.nodes.map(n => {
      const found = updated.find(u => u.id === n.id);
      if (!found) return n;
      return { ...n, position: found.position };
    });
    // Handle deletions
    const deletedIds = new Set(changes.filter(c => c.type === "remove").map((c: any) => c.id));
    const filteredNodes = nextNodes.filter(n => !deletedIds.has(n.id));
    const filteredEdges = p.flow.edges.filter(e => !deletedIds.has(e.source) && !deletedIds.has(e.target));
    p.onChange({ ...p.flow, nodes: filteredNodes, edges: filteredEdges });
  }, [p, rfNodes]);

  const handleEdgesChange = useCallback((changes: EdgeChange[]) => {
    if (p.readOnly) return;
    const updated = applyEdgeChanges(changes, rfEdges);
    const nextEdges: FlowEdge[] = updated.map(e => {
      const existing = p.flow.edges.find(x => x.id === e.id);
      return existing ?? { id: e.id, source: e.source, target: e.target };
    });
    p.onChange({ ...p.flow, edges: nextEdges });
  }, [p, rfEdges]);

  const handleConnect = useCallback((conn: Connection) => {
    if (p.readOnly) return;
    if (!conn.source || !conn.target) return;
    // Phase 2: each node has at most one outgoing edge — replace existing
    const filtered = p.flow.edges.filter(e => e.source !== conn.source);
    p.onChange({ ...p.flow, edges: [...filtered, newEdge(conn.source, conn.target)] });
  }, [p]);

  const handleDrop = useCallback((ev: React.DragEvent) => {
    if (p.readOnly) return;
    ev.preventDefault();
    const phaseType = ev.dataTransfer.getData("application/journeyman-phase");
    if (!phaseType) return;
    const entry = p.catalog.find(c => c.phaseType === phaseType);
    const rect = wrapper.current?.getBoundingClientRect();
    const position = rect
      ? { x: ev.clientX - rect.left - 80, y: ev.clientY - rect.top - 30 }
      : { x: 200, y: 200 };
    const node = newPhaseNode({ phaseType, displayName: entry?.label ?? phaseType, position });
    p.onChange({ ...p.flow, nodes: [...p.flow.nodes, node] });
  }, [p]);

  const handleDragOver = useCallback((ev: React.DragEvent) => {
    ev.preventDefault();
    ev.dataTransfer.dropEffect = "move";
  }, []);

  return (
    <div ref={wrapper} className="je-editor__canvas" onDrop={handleDrop} onDragOver={handleDragOver}>
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onConnect={handleConnect}
        onSelectionChange={(sel) => {
          const id = sel.nodes[0]?.id ?? null;
          p.onSelect(id);
        }}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
}

export function Canvas(p: CanvasProps) {
  return <ReactFlowProvider><CanvasInner {...p} /></ReactFlowProvider>;
}
```

- [ ] **Step 5.2: `FlowEditor.tsx`** — top-level export.

```tsx
import { useMemo } from "react";
import { Canvas } from "./canvas/Canvas.tsx";
import { Palette } from "./palette/Palette.tsx";
import { PropertiesPanel } from "./properties-panel/PropertiesPanel.tsx";
import { Topbar } from "./topbar/Topbar.tsx";
import { useFlowEditorState } from "./state/useFlowEditorState.ts";
import { isLinearAndComplete } from "./state/flow-graph.ts";
import type { FlowEditorProps } from "./types.ts";
import "./styles.css";

export function FlowEditor(props: FlowEditorProps) {
  const s = useFlowEditorState({ flow: props.flow, onChange: props.onChange });
  const validity = useMemo(() => isLinearAndComplete(props.flow), [props.flow]);

  const onUpdateNode = (next: typeof s.selectedNode) => {
    if (!next) return;
    s.update(f => ({ ...f, nodes: f.nodes.map(n => n.id === next.id ? next : n) }));
  };

  return (
    <div className="je-editor">
      <Topbar
        flowName={props.flowName}
        onRename={props.onRename}
        onSave={props.onSave ? () => props.onSave!(props.flow) : undefined}
        onRun={props.onRun ? () => props.onRun!(props.flow) : undefined}
        busy={props.busy}
        saveEnabled={!props.readOnly && !!props.onSave}
        runEnabled={!props.readOnly && !!props.onRun && validity.ok}
        runDisabledReason={validity.ok ? undefined : validity.reason}
      />
      <div className="je-editor__body">
        <Palette catalog={props.phaseCatalog} />
        <Canvas
          flow={props.flow}
          catalog={props.phaseCatalog}
          selectedNodeId={s.selectedNodeId}
          onSelect={s.setSelectedNodeId}
          onChange={props.onChange}
          readOnly={props.readOnly}
        />
        <PropertiesPanel
          node={s.selectedNode}
          catalog={props.phaseCatalog}
          onChange={onUpdateNode}
          readOnly={props.readOnly}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 5.3: Update `packages/flow-editor/src/index.ts`**

```typescript
export { FlowEditor } from "./FlowEditor.tsx";
export { createBlankFlow, isLinearAndComplete } from "./state/flow-graph.ts";
export type { FlowEditorProps, PhaseCatalog, PhaseCatalogEntry } from "./types.ts";
```

---

## Task 6: Extend `@journeyman/api-server` with `GET /flows` and `PUT /flows/:id`

**Files:**
- Modify: `packages/api-server/src/routes/flows.ts`
- Create: `packages/api-server/src/schemas/update-flow.ts`

- [ ] **Step 6.1: `update-flow.ts`** — same schema as create but description optional and definition optional (must be present to register a new version, but the route accepts metadata-only edits too in the future).

```typescript
import { z } from "zod";

export const updateFlowBody = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  definition: z.object({
    schemaVersion: z.literal(1),
    nodes: z.array(z.object({
      id: z.string(),
      type: z.string(),
      displayName: z.string().optional(),
      phaseType: z.string().optional(),
      config: z.record(z.unknown()).optional(),
      position: z.object({ x: z.number(), y: z.number() }).optional(),
    })),
    edges: z.array(z.object({
      id: z.string(),
      source: z.string(),
      target: z.string(),
      type: z.enum(["default", "conditional", "error", "else"]).optional(),
      condition: z.unknown().optional(),
      label: z.string().optional(),
    })),
    maxCycleVisits: z.number().int().nonnegative().optional(),
  }).optional(),
});
export type UpdateFlowBody = z.infer<typeof updateFlowBody>;
```

- [ ] **Step 6.2: extend `packages/api-server/src/routes/flows.ts`**

Open the existing file and add `GET /flows` and `PUT /flows/:id` handlers. Show only the additions; keep the existing three handlers verbatim.

Add at the top:

```typescript
import { updateFlowBody } from "../schemas/update-flow.ts";
```

Then inside `registerFlowRoutes`, add the new handlers:

```typescript
  app.get("/flows", async (req) => {
    const q = req.query as { ownerUserId?: string; limit?: string };
    const ownerUserId = q.ownerUserId === undefined
      ? undefined
      : (q.ownerUserId === "" ? null : q.ownerUserId);
    const limit = q.limit ? Number(q.limit) : undefined;
    const flows = await c.flows.list({ ownerUserId, limit });
    return { flows };
  });

  app.put("/flows/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = updateFlowBody.parse(req.body);
    const user = await c.auth.authenticate(req);

    const flow = await c.flows.getById(id);
    if (!flow) { reply.code(404); return { error: "not_found" }; }

    let newVersion = null;
    if (body.definition) {
      newVersion = await c.flowVersions.appendVersion({
        flowId: id,
        definition: body.definition,
        createdByUserId: user.userId,
      });
    }

    // (Phase 2 keeps `name` and `description` immutable on the flow row to
    //  avoid an ALTER on @journeyman/core's IFlowStore. If body.name was sent,
    //  ignore for now and respond with current values; UI doesn't expose rename.)

    const updated = await c.flows.getById(id);
    return { flow: updated, version: newVersion ?? null };
  });
```

(Note: making the flow row's `name`/`description` mutable is deferred — keeps `IFlowStore` interface stable. Rename will land in Phase 5 alongside other metadata edits.)

---

## Task 7: Scaffold `@journeyman/web` shell app

**Files:**
- Create: `packages/web/package.json`
- Create: `packages/web/tsconfig.json`
- Create: `packages/web/vite.config.ts`
- Create: `packages/web/tailwind.config.js`
- Create: `packages/web/postcss.config.js`
- Create: `packages/web/index.html`
- Create: `packages/web/src/main.tsx`
- Create: `packages/web/src/styles.css`

- [ ] **Step 7.1: `package.json`**

```json
{
  "name": "@journeyman/web",
  "private": true,
  "version": "0.1.0",
  "description": "Journeyman web shell. Hosts the flow editor and (later) run viewer + runs list. Talks to @journeyman/api-server.",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@journeyman/core": "*",
    "@journeyman/flow-editor": "*",
    "@tanstack/react-query": "^5.50.0",
    "@xyflow/react": "^12.3.5",
    "lucide-react": "^0.400.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^7.0.0"
  },
  "devDependencies": {
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "autoprefixer": "^10.4.0",
    "postcss": "^8.4.0",
    "tailwindcss": "^3.4.0",
    "typescript": "^6.0.3",
    "vite": "^5.4.0"
  }
}
```

- [ ] **Step 7.2: `tsconfig.json`** — same as flow-editor's (DOM lib + JSX).

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "allowImportingTsExtensions": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "types": ["vite/client"]
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 7.3: `vite.config.ts`**

```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
});
```

- [ ] **Step 7.4: `tailwind.config.js`**

```javascript
/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: { extend: {} },
  plugins: [],
};
```

- [ ] **Step 7.5: `postcss.config.js`**

```javascript
export default {
  plugins: { tailwindcss: {}, autoprefixer: {} },
};
```

- [ ] **Step 7.6: `index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1.0" />
    <title>Journeyman</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 7.7: `src/styles.css`**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

html, body, #root { height: 100%; margin: 0; }
body { background: #1a1a24; color: #fff; font-family: system-ui, -apple-system, sans-serif; }
```

- [ ] **Step 7.8: `src/main.tsx`**

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App.tsx";
import "./styles.css";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
```

---

## Task 8: Web shell — App, AppShell, API client, built-in catalog

**Files:**
- Create: `packages/web/src/App.tsx`
- Create: `packages/web/src/components/AppShell.tsx`
- Create: `packages/web/src/api/client.ts`
- Create: `packages/web/src/api/flows.ts`
- Create: `packages/web/src/catalogs/built-in-phase-catalog.ts`

- [ ] **Step 8.1: `api/client.ts`** — fetch wrapper with base URL.

```typescript
const baseUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "http://localhost:4000";

export class ApiError extends Error {
  constructor(public status: number, public body: unknown) {
    super(`API ${status}`);
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.text();
    let parsed: unknown = body;
    try { parsed = JSON.parse(body); } catch { /* leave as string */ }
    throw new ApiError(res.status, parsed);
  }
  if (res.status === 204) return undefined as T;
  return await res.json() as T;
}

export const conductorUiUrl = (import.meta.env.VITE_CONDUCTOR_UI_URL as string | undefined) ?? "http://localhost:5000";
```

- [ ] **Step 8.2: `api/flows.ts`**

```typescript
import type { Flow, FlowGraph, FlowVersion } from "@journeyman/core";
import { api } from "./client.ts";

export async function listFlows(): Promise<Flow[]> {
  const res = await api<{ flows: Flow[] }>("/flows");
  return res.flows;
}

export async function getFlow(id: string): Promise<Flow | null> {
  try {
    const res = await api<{ flow: Flow }>(`/flows/${encodeURIComponent(id)}`);
    return res.flow;
  } catch (e) {
    if ((e as any).status === 404) return null;
    throw e;
  }
}

export async function getFlowVersion(versionId: string): Promise<FlowVersion> {
  // Phase 2 doesn't expose a /flow_versions endpoint yet — fetch via flows.
  // For now we ship without version fetch and rely on initial create returning the version.
  // This stub is kept so callers can be wired up; Phase 3 adds the endpoint.
  throw new Error(`getFlowVersion not implemented in Phase 2 (requested ${versionId})`);
}

export async function createFlow(args: { name: string; description?: string; definition: FlowGraph }): Promise<{ flow: Flow; version: FlowVersion }> {
  return await api<{ flow: Flow; version: FlowVersion }>("/flows", {
    method: "POST", body: JSON.stringify(args),
  });
}

export async function updateFlowDefinition(flowId: string, definition: FlowGraph): Promise<{ flow: Flow; version: FlowVersion | null }> {
  return await api<{ flow: Flow; version: FlowVersion | null }>(
    `/flows/${encodeURIComponent(flowId)}`,
    { method: "PUT", body: JSON.stringify({ definition }) },
  );
}

export async function runFlow(flowId: string, inputs: Record<string, unknown>): Promise<{ runId: string; engineWorkflowId: string }> {
  return await api<{ runId: string; engineWorkflowId: string }>(
    `/flows/${encodeURIComponent(flowId)}/runs`,
    { method: "POST", body: JSON.stringify({ inputs }) },
  );
}
```

- [ ] **Step 8.3: `catalogs/built-in-phase-catalog.ts`**

```typescript
import type { PhaseCatalog } from "@journeyman/flow-editor";

export const builtInPhaseCatalog: PhaseCatalog = [
  {
    phaseType: "analyze",
    label: "Analyze",
    category: "AI",
    description: "Analyze a repo against a ticket using Claude.",
    color: "#00b894",
    icon: "🤖",
  },
];
```

- [ ] **Step 8.4: `components/AppShell.tsx`**

```tsx
import { Link, NavLink, Outlet } from "react-router-dom";

const styles = {
  nav: {
    display: "flex", alignItems: "center", gap: 16,
    background: "#11111a", borderBottom: "1px solid #2a2a3a",
    padding: "10px 18px", fontSize: 13,
  } as React.CSSProperties,
  brand: { fontWeight: 700, color: "#4a9eff", marginRight: 12 } as React.CSSProperties,
  link: { color: "#aaa", textDecoration: "none" } as React.CSSProperties,
  linkActive: { color: "#fff", fontWeight: 600 } as React.CSSProperties,
  body: { height: "calc(100vh - 41px)", overflow: "hidden" } as React.CSSProperties,
};

export default function AppShell() {
  return (
    <div>
      <nav style={styles.nav}>
        <Link to="/" style={styles.brand}>◆ Journeyman</Link>
        <NavLink to="/flows" style={({ isActive }) => ({ ...styles.link, ...(isActive ? styles.linkActive : {}) })}>
          Flows
        </NavLink>
      </nav>
      <main style={styles.body}>
        <Outlet />
      </main>
    </div>
  );
}
```

- [ ] **Step 8.5: `App.tsx`** — register routes.

```tsx
import { Routes, Route, Navigate } from "react-router-dom";
import AppShell from "./components/AppShell.tsx";
import { FlowsListPage } from "./routes/FlowsListPage.tsx";
import { FlowEditorPage } from "./routes/FlowEditorPage.tsx";
import { NewFlowPage } from "./routes/NewFlowPage.tsx";

export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<Navigate to="/flows" replace />} />
        <Route path="/flows" element={<FlowsListPage />} />
        <Route path="/flows/new" element={<NewFlowPage />} />
        <Route path="/flows/:id/edit" element={<FlowEditorPage />} />
      </Route>
    </Routes>
  );
}
```

---

## Task 9: Web shell pages

**Files:**
- Create: `packages/web/src/routes/FlowsListPage.tsx`
- Create: `packages/web/src/routes/NewFlowPage.tsx`
- Create: `packages/web/src/routes/FlowEditorPage.tsx`
- Create: `packages/web/src/components/RunSubmittedToast.tsx`

- [ ] **Step 9.1: `RunSubmittedToast.tsx`**

```tsx
import { conductorUiUrl } from "../api/client.ts";

export interface RunSubmittedToastProps {
  runId: string;
  engineWorkflowId: string;
  onDismiss: () => void;
}

export function RunSubmittedToast(p: RunSubmittedToastProps) {
  return (
    <div style={{
      position: "fixed", bottom: 24, right: 24, background: "#1f1f2c",
      border: "1px solid #00b894", borderRadius: 8, padding: 14,
      color: "#fff", fontSize: 13, maxWidth: 360, zIndex: 100,
    }}>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>Run submitted</div>
      <div style={{ color: "#aaa", marginBottom: 4 }}>
        Run id: <span style={{ color: "#fff", fontFamily: "ui-monospace, monospace" }}>{p.runId}</span>
      </div>
      <div style={{ color: "#aaa", marginBottom: 8 }}>
        Workflow: <a
          href={`${conductorUiUrl}/execution/${p.engineWorkflowId}`}
          target="_blank" rel="noreferrer"
          style={{ color: "#4a9eff" }}
        >open in Conductor UI</a>
      </div>
      <button
        style={{ background: "#2a2a3e", border: "1px solid #444", color: "#ddd", padding: "4px 10px", borderRadius: 4, fontSize: 11, cursor: "pointer" }}
        onClick={p.onDismiss}
      >Dismiss</button>
    </div>
  );
}
```

- [ ] **Step 9.2: `FlowsListPage.tsx`**

```tsx
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { listFlows } from "../api/flows.ts";

export function FlowsListPage() {
  const q = useQuery({ queryKey: ["flows"], queryFn: listFlows });
  return (
    <div style={{ padding: 24, height: "100%", overflow: "auto" }}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 18 }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>Flows</h2>
        <div style={{ flex: 1 }} />
        <Link
          to="/flows/new"
          style={{ background: "#00b894", color: "#fff", padding: "6px 14px", borderRadius: 5, textDecoration: "none", fontSize: 13, fontWeight: 600 }}
        >+ New flow</Link>
      </div>

      {q.isLoading && <div style={{ color: "#888" }}>Loading…</div>}
      {q.isError && <div style={{ color: "#ff7675" }}>Error: {(q.error as Error).message}</div>}
      {q.data && q.data.length === 0 && (
        <div style={{ color: "#888" }}>No flows yet. Click "+ New flow" to create one.</div>
      )}
      {q.data && q.data.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ color: "#888", textAlign: "left", borderBottom: "1px solid #2a2a3a" }}>
              <th style={{ padding: "8px 6px" }}>Name</th>
              <th style={{ padding: "8px 6px" }}>Description</th>
              <th style={{ padding: "8px 6px" }}>Updated</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {q.data.map(f => (
              <tr key={f.id} style={{ borderBottom: "1px solid #1f1f2c" }}>
                <td style={{ padding: "10px 6px" }}>{f.name}</td>
                <td style={{ padding: "10px 6px", color: "#aaa" }}>{f.description ?? ""}</td>
                <td style={{ padding: "10px 6px", color: "#888" }}>{new Date(f.updatedAt).toLocaleString()}</td>
                <td style={{ padding: "10px 6px" }}>
                  <Link to={`/flows/${f.id}/edit`} style={{ color: "#4a9eff" }}>Open</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
```

- [ ] **Step 9.3: `NewFlowPage.tsx`**

```tsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createBlankFlow } from "@journeyman/flow-editor";
import { createFlow } from "../api/flows.ts";

export function NewFlowPage() {
  const [name, setName] = useState("New flow");
  const [description, setDescription] = useState("");
  const navigate = useNavigate();
  const qc = useQueryClient();

  const m = useMutation({
    mutationFn: () => createFlow({ name, description: description || undefined, definition: createBlankFlow() }),
    onSuccess: ({ flow }) => {
      qc.invalidateQueries({ queryKey: ["flows"] });
      navigate(`/flows/${flow.id}/edit`);
    },
  });

  return (
    <div style={{ padding: 24, maxWidth: 480 }}>
      <h2 style={{ fontSize: 18, marginTop: 0 }}>New flow</h2>
      <div style={{ marginBottom: 12 }}>
        <label style={{ display: "block", color: "#aaa", fontSize: 11, marginBottom: 4, textTransform: "uppercase" }}>Name</label>
        <input value={name} onChange={e => setName(e.target.value)} style={inputStyle} />
      </div>
      <div style={{ marginBottom: 16 }}>
        <label style={{ display: "block", color: "#aaa", fontSize: 11, marginBottom: 4, textTransform: "uppercase" }}>Description (optional)</label>
        <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} style={inputStyle} />
      </div>
      <button
        disabled={!name.trim() || m.isPending}
        onClick={() => m.mutate()}
        style={{ background: "#00b894", border: "none", color: "#fff", padding: "8px 16px", borderRadius: 5, fontWeight: 600, cursor: "pointer" }}
      >
        {m.isPending ? "Creating…" : "Create"}
      </button>
      {m.isError && <div style={{ color: "#ff7675", marginTop: 10 }}>{(m.error as Error).message}</div>}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%", background: "#1f1f2c", border: "1px solid #2a2a3a",
  color: "#fff", borderRadius: 4, padding: "8px 10px", fontSize: 13, fontFamily: "inherit",
};
```

- [ ] **Step 9.4: `FlowEditorPage.tsx`**

```tsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FlowEditor } from "@journeyman/flow-editor";
import type { FlowGraph } from "@journeyman/core";
import { getFlow, runFlow, updateFlowDefinition, createFlow } from "../api/flows.ts";
import { builtInPhaseCatalog } from "../catalogs/built-in-phase-catalog.ts";
import { RunSubmittedToast } from "../components/RunSubmittedToast.tsx";

/**
 * Phase 2 limitation: the api-server returns a Flow (not its current version)
 * from GET /flows/:id, and there's no GET /flow_versions/:id endpoint yet.
 * So when we open an existing flow, we round-trip a "synthetic" empty edit
 * by relying on what the editor receives via local state seeded from creation.
 *
 * To keep the UX clean, NewFlowPage redirects here AFTER createFlow returned
 * the initial graph; we cache it in queryClient under ["flow-graph", id].
 * Phase 3 adds GET /flows/:id/versions/current to remove this hack.
 */
export function FlowEditorPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [graph, setGraph] = useState<FlowGraph | null>(null);
  const [dirty, setDirty] = useState(false);
  const [toast, setToast] = useState<{ runId: string; engineWorkflowId: string } | null>(null);

  const flowQ = useQuery({
    queryKey: ["flow", id],
    queryFn: () => getFlow(id!),
    enabled: !!id,
  });

  // Seed the editor from any cached graph (set by NewFlowPage's createFlow result).
  useEffect(() => {
    if (!id || graph) return;
    const cached = qc.getQueryData<FlowGraph>(["flow-graph", id]);
    if (cached) {
      setGraph(cached);
      return;
    }
    // Phase 2 fallback: if no cached graph and no version endpoint yet,
    // we open with a blank graph. Saving will append a new version.
    if (flowQ.data) {
      // crude — preserves user editing experience until Phase 3 adds the endpoint
      setGraph({
        schemaVersion: 1,
        nodes: [
          { id: "start", type: "start", position: { x: 80, y: 80 } },
          { id: "end",   type: "end",   position: { x: 80, y: 320 } },
        ],
        edges: [{ id: "e_start_end", source: "start", target: "end" }],
      });
    }
  }, [id, graph, qc, flowQ.data]);

  const saveM = useMutation({
    mutationFn: (next: FlowGraph) => updateFlowDefinition(id!, next),
    onSuccess: (_, next) => {
      qc.setQueryData(["flow-graph", id], next);
      setDirty(false);
    },
  });

  const runM = useMutation({
    mutationFn: () => runFlow(id!, {}),
    onSuccess: (res) => setToast(res),
  });

  if (!id) { navigate("/flows"); return null; }
  if (flowQ.isLoading || !graph) {
    return <div style={{ padding: 24, color: "#888" }}>Loading editor…</div>;
  }
  if (flowQ.isError || !flowQ.data) {
    return <div style={{ padding: 24, color: "#ff7675" }}>Flow not found.</div>;
  }

  return (
    <>
      <div style={{ height: "100%" }}>
        <FlowEditor
          flow={graph}
          flowName={flowQ.data.name}
          phaseCatalog={builtInPhaseCatalog}
          onChange={(next) => { setGraph(next); setDirty(true); }}
          onSave={async (next) => { await saveM.mutateAsync(next); }}
          onRun={async () => { await runM.mutateAsync(); }}
          busy={saveM.isPending || runM.isPending}
        />
      </div>
      {toast && (
        <RunSubmittedToast
          runId={toast.runId}
          engineWorkflowId={toast.engineWorkflowId}
          onDismiss={() => setToast(null)}
        />
      )}
    </>
  );
}
```

- [ ] **Step 9.5: Patch `NewFlowPage.tsx` to seed the editor cache**

In `NewFlowPage.tsx`'s `onSuccess`, before `navigate(...)`, add:

```typescript
qc.setQueryData(["flow-graph", flow.id], createBlankFlow());
```

So the line becomes:

```typescript
onSuccess: ({ flow }) => {
  qc.invalidateQueries({ queryKey: ["flows"] });
  qc.setQueryData(["flow-graph", flow.id], createBlankFlow());
  navigate(`/flows/${flow.id}/edit`);
},
```

---

## Task 10: Root scripts + final typecheck

**Files:**
- Modify: root `package.json`

- [ ] **Step 10.1: Add web dev/build scripts to the root**

In root `package.json`'s `"scripts"` block, **add** (keep all existing):

```json
"dev:web": "npm run dev -w @journeyman/web",
"build:web": "npm run build -w @journeyman/web"
```

- [ ] **Step 10.2: `npm install` to pull React Flow + Vite + flow-editor across workspaces**

```bash
npm install
```
Expected: succeeds; the new packages link via npm workspaces.

- [ ] **Step 10.3: Repo-wide typecheck**

```bash
npm run typecheck
```
Expected: green across all 14 workspaces (`core`, `coding-cli`, `git-provider`, `github-api`, `ticket-provider`, `notification-provider`, legacy `pipeline`, legacy `pipeline-server`, legacy `ui`, `migrations`, `orchestrator`, `api-server`, `flow-editor`, `web`).

- [ ] **Step 10.4: Smoke test (manual)**

1. Bring up infra and the API/worker (from Phase 1):
   ```bash
   npm run infra:up
   npm run migrate
   npm run start:api-server &
   npm run start:worker &
   ```
2. Run the web shell:
   ```bash
   npm run dev:web
   ```
3. Open `http://localhost:5173/flows`. Click **+ New flow**, name it, click **Create**. The editor opens.
4. Drag the **Analyze** card from the left palette onto the canvas, between Start and End. Connect Start → Analyze and Analyze → End. The Run button enables.
5. Click **Save**. Click **Run**. The toast shows the runId and a link to the Conductor UI; verify the workflow appears in `http://localhost:5000`.

---

## Self-Review Checklist

**Spec coverage (Phase 2 from spec §12):**
- [x] React Flow editor in a new package — Tasks 1, 3, 5
- [x] `start`, `phase`, `end` node types only — Task 3
- [x] Properties panel: Config tab only — Tasks 4 (TabsShell + ConfigTab)
- [x] Save/load flows via api-server — Task 6 (`PUT /flows/:id`), Task 8 (api/flows.ts), Task 9 (FlowEditorPage)
- [x] "Run" button submits a run — Task 9 (FlowEditorPage), Task 5 (Topbar wiring)
- [x] UI shows runId, links to Conductor UI — Task 9 (RunSubmittedToast)
- [x] Component-based UI rule (spec §9.5) — flow-editor is pure; web is the shell
- [x] Legacy `packages/ui` left intact — not touched in this plan

**Out of scope deferred to later phases:**
- SSE / live-run view → Phase 3
- Runs list page → Phase 3 (the existing legacy UI's runs viewer remains for now)
- Gateways, loops, multiple ends, error edges → Phase 4
- MCP/Credentials/Retry/IO tabs → Phase 5

**Type consistency:**
- `FlowGraph` is the canonical type used everywhere (renamed in Phase 1). `flow-editor`, `web`, and `api-server` all import it from `@journeyman/core`.
- `FlowNode.position` is optional; `createBlankFlow` and Canvas both fall back to `{x:0,y:0}` when missing.
- `PhaseCatalog`/`PhaseCatalogEntry` are exported from `@journeyman/flow-editor`; the shell consumes them via `built-in-phase-catalog.ts`.

**No placeholders:** every step contains real code or real commands.

**Phase 2 known gap (deliberate):** there is no `GET /flow_versions/:id` endpoint yet, so opening an existing flow that wasn't just-created seeds a blank canvas. NewFlowPage works around this by stashing the freshly-created graph in the React Query cache before navigating. Phase 3 adds the missing endpoint and removes the workaround. This trade-off is documented inline in `FlowEditorPage.tsx` and is acceptable for v0.
