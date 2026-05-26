# Triggers on Canvas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move trigger nodes (`trigger-manual`, `trigger-webhook`, `trigger-human`) from the "Triggers strip" above the canvas onto the canvas itself, as first-class React Flow nodes. Users wire triggers to their first step using the same gesture as wiring any two nodes.

**Architecture:** UI-only change. Backend, validators, ingest, and Conductor converter are untouched — they already treat triggers as first-class nodes with edges. The work is: (1) add React Flow renderers for the three trigger types and register them, (2) stop filtering triggers out of the canvas render, (3) add a "Triggers" section to the left palette so users can drag triggers onto the canvas, (4) remove the now-redundant TriggersLane + AddTriggerModal components, (5) style the new trigger nodes.

**Tech Stack:** React, `@xyflow/react` (React Flow), TypeScript.

**User constraints:** No commits inside tasks. No unit tests. One `npm run typecheck` at the very end.

**Spec:** [docs/superpowers/specs/2026-05-25-triggers-on-canvas-design.md](docs/superpowers/specs/2026-05-25-triggers-on-canvas-design.md)

---

## File Map

### Create
- `packages/flow-editor/src/canvas/nodes/TriggerManualNode.tsx`
- `packages/flow-editor/src/canvas/nodes/TriggerWebhookNode.tsx`
- `packages/flow-editor/src/canvas/nodes/TriggerHumanNode.tsx`

### Modify
- `packages/flow-editor/src/canvas/node-registry.ts` — register the three new node types in `nodeTypes`.
- `packages/flow-editor/src/canvas/Canvas.tsx` — remove the filter in `toReactWorkflowNodes` that drops trigger nodes; extend `handleDrop` to handle a new `application/journeyman-trigger` drag mime.
- `packages/flow-editor/src/canvas/flow-rf-adapters.ts` — remove the filter in `toReactWorkflowEdges` that drops edges where `source` is a trigger.
- `packages/flow-editor/src/palette/Palette.tsx` — extend the entry union with a `"trigger"` kind, render a "Triggers" section.
- `packages/flow-editor/src/FlowEditor.tsx` — remove `<TriggersLane>` mount and its handlers; `onAddTrigger` / `onDeleteTrigger` go away (palette drag handles add, standard node-delete handles remove).
- `packages/flow-editor/src/styles.css` — add `.je-node--trigger-*` styles; remove the obsolete `.jm-triggers-lane`, `.jm-trigger-*`, `.jm-modal-overlay`, `.jm-modal`, `.jm-triggers-empty`, `.jm-triggers-add`, `.jm-triggers-chips` rules.

### Delete
- `packages/flow-editor/src/triggers-lane/TriggersLane.tsx`
- `packages/flow-editor/src/triggers-lane/AddTriggerModal.tsx`
- The directory `packages/flow-editor/src/triggers-lane/` (after both files are removed).

---

## Task 1: React Flow renderers for trigger nodes

**Files:**
- Create: `packages/flow-editor/src/canvas/nodes/TriggerManualNode.tsx`
- Create: `packages/flow-editor/src/canvas/nodes/TriggerWebhookNode.tsx`
- Create: `packages/flow-editor/src/canvas/nodes/TriggerHumanNode.tsx`

These mirror the shape of existing terminal nodes like `StartNode.tsx`. They have a source handle on the right (so users can wire outward) and **no target handle** (triggers have no inbound edges by validation).

- [ ] **Step 1.1: Create `TriggerManualNode.tsx`**

```tsx
import { Handle, Position } from "@xyflow/react";
import { handleBlue } from "../handle-styles.ts";

interface Data {
  displayName?: string;
}

export function TriggerManualNode({ data }: { data: Data }) {
  return (
    <div className="je-node je-node--terminal je-node--trigger je-node--trigger-manual">
      <div className="je-node__icon">▶</div>
      <div className="je-node__label">{data.displayName ?? "Manual"}</div>
      <Handle type="source" position={Position.Right} style={handleBlue} />
    </div>
  );
}
```

- [ ] **Step 1.2: Create `TriggerWebhookNode.tsx`**

```tsx
import { Handle, Position } from "@xyflow/react";
import { handleBlue } from "../handle-styles.ts";

interface Data {
  displayName?: string;
  webhookId?: string;
}

export function TriggerWebhookNode({ data }: { data: Data }) {
  return (
    <div className="je-node je-node--terminal je-node--trigger je-node--trigger-webhook">
      <div className="je-node__icon">🪝</div>
      <div className="je-node__label">{data.displayName ?? "Webhook"}</div>
      <Handle type="source" position={Position.Right} style={handleBlue} />
    </div>
  );
}
```

- [ ] **Step 1.3: Create `TriggerHumanNode.tsx`**

```tsx
import { Handle, Position } from "@xyflow/react";
import { handleBlue } from "../handle-styles.ts";

interface Data {
  displayName?: string;
  formTitle?: string;
}

export function TriggerHumanNode({ data }: { data: Data }) {
  return (
    <div className="je-node je-node--terminal je-node--trigger je-node--trigger-human">
      <div className="je-node__icon">📝</div>
      <div className="je-node__label">{data.formTitle ?? data.displayName ?? "Form"}</div>
      <Handle type="source" position={Position.Right} style={handleBlue} />
    </div>
  );
}
```

- [ ] **Step 1.4: Register the three new node types in `node-registry.ts`**

Modify `packages/flow-editor/src/canvas/node-registry.ts`:

```ts
import { StartNode } from "./nodes/StartNode.tsx";
import { EndNode } from "./nodes/EndNode.tsx";
import { StepNode } from "./nodes/StepNode.tsx";
import { GatewayXorNode } from "./nodes/GatewayXorNode.tsx";
import { GatewayAndNode } from "./nodes/GatewayAndNode.tsx";
import { LoopNode } from "./nodes/LoopNode.tsx";
import { SubflowNode } from "./nodes/SubflowNode.tsx";
import { IfNode } from "./nodes/IfNode.tsx";
import { TimerNode } from "./nodes/TimerNode.tsx";
import { HumanTaskNode } from "./nodes/HumanTaskNode.tsx";
import { WebhookWaitNode } from "./nodes/WebhookWaitNode.tsx";
import { JoinNode } from "./nodes/JoinNode.tsx";
import { TriggerManualNode } from "./nodes/TriggerManualNode.tsx";
import { TriggerWebhookNode } from "./nodes/TriggerWebhookNode.tsx";
import { TriggerHumanNode } from "./nodes/TriggerHumanNode.tsx";
import { DefaultEdge } from "./edges/DefaultEdge.tsx";
import { ConditionalEdge } from "./edges/ConditionalEdge.tsx";
import { ErrorEdge } from "./edges/ErrorEdge.tsx";
import { ElseEdge } from "./edges/ElseEdge.tsx";

export const nodeTypes = {
  start: StartNode,
  end: EndNode,
  step: StepNode,
  "gateway-xor": GatewayXorNode,
  "gateway-and": GatewayAndNode,
  loop: LoopNode,
  subflow: SubflowNode,
  if: IfNode,
  timer: TimerNode,
  "human-task": HumanTaskNode,
  "webhook-wait": WebhookWaitNode,
  "join": JoinNode,
  "trigger-manual": TriggerManualNode,
  "trigger-webhook": TriggerWebhookNode,
  "trigger-human": TriggerHumanNode,
};

export const edgeTypes = {
  default: DefaultEdge,
  conditional: ConditionalEdge,
  error: ErrorEdge,
  else: ElseEdge,
};
```

---

## Task 2: Stop hiding triggers from the canvas render

**Files:**
- Modify: `packages/flow-editor/src/canvas/Canvas.tsx` — revert the filter added when triggers were lane-only.
- Modify: `packages/flow-editor/src/canvas/flow-rf-adapters.ts` — revert the matching edges filter.
- Modify: `packages/flow-editor/src/canvas/Canvas.tsx` — pass meaningful `data` to trigger nodes so the renderer can show webhook name / form title.

- [ ] **Step 2.1: Revert the node filter in `Canvas.tsx`**

Find `toReactWorkflowNodes` (around line 93–117). Replace the leading `filter` call and tighten the data shape for triggers:

```ts
function toReactWorkflowNodes(
  flow: WorkflowGraph,
  selectedId: string | null,
  runStates?: Record<string, StepRunState>,
): Node[] {
  return flow.nodes.map(n => ({
    id: n.id,
    type: KNOWN_NODE_TYPES.has(n.type) ? n.type : "step",
    position: n.position ?? { x: 0, y: 0 },
    data: n.type === "step"
      ? {
          displayName: n.displayName ?? n.stepType ?? "Step",
          stepType: n.stepType ?? "",
          config: n.config ?? {},
          inputs: n.inputs ?? {},
          runState: runStates?.[n.id],
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
```

(The `.filter(n => n.type !== "trigger-manual" && ...)` call from the prior commit is removed entirely; the `.map(...)` from `flow.nodes.map` returns to mapping all nodes.)

- [ ] **Step 2.2: Revert the edge filter in `flow-rf-adapters.ts`**

Replace the body of `toReactWorkflowEdges` (top of the file) with the simple all-edges version:

```ts
export function toReactWorkflowEdges(flow: WorkflowGraph): Edge[] {
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
```

The `triggerIds` set and the `.filter(...)` call introduced earlier are removed.

---

## Task 3: Add a "Triggers" section to the palette

**Files:**
- Modify: `packages/flow-editor/src/palette/Palette.tsx` — extend the entry union with a `"trigger"` kind.
- Modify: `packages/flow-editor/src/canvas/Canvas.tsx` — extend `handleDrop` to handle the trigger drag mime.

- [ ] **Step 3.1: Extend the entry types and add the trigger entries in `Palette.tsx`**

Replace the file with the version below. The changes are:
- New entry kind `"trigger"` with `triggerType` discriminator.
- New drag mime `"application/journeyman-trigger"`.
- A hard-coded list of three trigger entries injected at the top of `entries`.

```tsx
// packages/flow-editor/src/palette/Palette.tsx
import { useEffect, useMemo, useState } from "react";
import { PaletteItem } from "./PaletteItem.tsx";
import type { ControlNodeCatalog } from "../types.ts";
import type { StepDefinition } from "../step-definition.ts";

const COMING_SOON_LS_KEY = "flow-editor.palette.comingSoon";

export interface PaletteProps {
  steps: StepDefinition<any>[];
  controlCatalog?: ControlNodeCatalog;
}

type AnyEntry =
  | {
      kind: "step";
      stepType: string;
      label: string;
      category: string;
      color: string;
      icon: string;
      description?: string;
      comingSoon: boolean;
    }
  | {
      kind: "control";
      nodeType: string;
      label: string;
      category: string;
      color: string;
      icon: string;
      description?: string;
      comingSoon: boolean;
    }
  | {
      kind: "trigger";
      triggerType: "trigger-manual" | "trigger-webhook" | "trigger-human";
      label: string;
      category: string;
      color: string;
      icon: string;
      description?: string;
      comingSoon: boolean;
    };

const TRIGGER_ENTRIES: AnyEntry[] = [
  {
    kind: "trigger",
    triggerType: "trigger-manual",
    label: "Manual",
    category: "Triggers",
    color: "#6c5ce7",
    icon: "▶",
    description: "Start by clicking Run or via API.",
    comingSoon: false,
  },
  {
    kind: "trigger",
    triggerType: "trigger-webhook",
    label: "Webhook",
    category: "Triggers",
    color: "#6c5ce7",
    icon: "🪝",
    description: "Start when a webhook receives a matching event.",
    comingSoon: false,
  },
  {
    kind: "trigger",
    triggerType: "trigger-human",
    label: "Human form",
    category: "Triggers",
    color: "#6c5ce7",
    icon: "📝",
    description: "Start when a person submits an in-app form.",
    comingSoon: false,
  },
];

function entryKey(e: AnyEntry): string {
  if (e.kind === "step")    return `step:${e.stepType}`;
  if (e.kind === "control") return `control:${e.nodeType}`;
  return `trigger:${e.triggerType}`;
}

function entryDragMime(e: AnyEntry): string {
  if (e.kind === "step")    return "application/journeyman-step";
  if (e.kind === "control") return "application/journeyman-control";
  return "application/journeyman-trigger";
}

function entryDragValue(e: AnyEntry): string {
  if (e.kind === "step")    return e.stepType;
  if (e.kind === "control") return e.nodeType;
  return e.triggerType;
}

export function Palette({ steps, controlCatalog }: PaletteProps) {
  const entries = useMemo<AnyEntry[]>(() => [
    ...TRIGGER_ENTRIES,
    ...steps
      .filter((p) => !p.hiddenFromPalette)
      .map((p): AnyEntry => ({
        kind: "step",
        stepType: p.stepType,
        label: p.label,
        category: p.category,
        color: p.color,
        icon: p.icon,
        description: p.description,
        comingSoon: p.comingSoon === true,
      })),
    ...(controlCatalog ?? []).map((c): AnyEntry => ({
      kind: "control",
      nodeType: c.nodeType,
      label: c.label,
      category: c.category,
      color: c.color,
      icon: c.icon,
      description: c.description,
      comingSoon: c.comingSoon === true,
    })),
  ], [steps, controlCatalog]);

  const available = useMemo(
    () => entries.filter(e => !e.comingSoon),
    [entries],
  );
  const comingSoon = useMemo(
    () => entries.filter(e => e.comingSoon),
    [entries],
  );

  const grouped = useMemo(() => {
    const m = new Map<string, AnyEntry[]>();
    for (const e of available) {
      const arr = m.get(e.category) ?? [];
      arr.push(e);
      m.set(e.category, arr);
    }
    return [...m.entries()];
  }, [available]);

  const groupedComingSoon = useMemo(() => {
    const m = new Map<string, AnyEntry[]>();
    for (const e of comingSoon) {
      const arr = m.get(e.category) ?? [];
      arr.push(e);
      m.set(e.category, arr);
    }
    return [...m.entries()];
  }, [comingSoon]);

  const [csOpen, setCsOpen] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(COMING_SOON_LS_KEY) === "true";
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(COMING_SOON_LS_KEY, String(csOpen));
  }, [csOpen]);

  return (
    <aside className="je-editor__palette">
      <div
        className="je-palette__title"
        style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}
      >
        Steps
      </div>

      {grouped.map(([cat, items]) => (
        <div key={cat}>
          <div className="je-palette__group">{cat}</div>
          {items.map(it => (
            <PaletteItem
              key={entryKey(it)}
              entry={{ ...it, dragMime: entryDragMime(it), dragValue: entryDragValue(it) }}
            />
          ))}
        </div>
      ))}

      {comingSoon.length > 0 && (
        <div className="je-palette__coming-soon">
          <button
            type="button"
            className="je-palette__coming-soon-header"
            aria-expanded={csOpen}
            onClick={() => setCsOpen(o => !o)}
          >
            <span className="je-palette__coming-soon-caret">{csOpen ? "▾" : "▸"}</span>
            <span className="je-palette__coming-soon-label">Coming soon</span>
            <span className="je-palette__coming-soon-count">({comingSoon.length})</span>
          </button>
          {csOpen && (
            <div className="je-palette__coming-soon-body">
              {groupedComingSoon.map(([cat, items]) => (
                <div key={cat}>
                  <div className="je-palette__group">{cat}</div>
                  {items.map(it => (
                    <PaletteItem
                      key={entryKey(it)}
                      entry={{ ...it, dragMime: entryDragMime(it), dragValue: entryDragValue(it) }}
                      disabled
                    />
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
```

- [ ] **Step 3.2: Check that `PaletteItem` accepts `dragValue` in the entry prop**

Read `packages/flow-editor/src/palette/PaletteItem.tsx`. The existing item likely already pulls a stepType/nodeType off `entry` and writes it to `dataTransfer`. If it does not yet support a generic `dragValue`, modify it to read `entry.dragValue` (or the existing equivalent) and call `dataTransfer.setData(entry.dragMime, entry.dragValue)`.

The exact code depends on what PaletteItem looks like — read it once, then make the smallest change that lets the trigger entries set their drag payload to the trigger type string (e.g. `"trigger-manual"`).

- [ ] **Step 3.3: Handle the new drag mime in `Canvas.tsx`'s `handleDrop`**

Find `handleDrop` (around line 330). Add a third branch that mirrors the existing `controlType` branch but produces a trigger node with `config: {}` (the properties panel will fill the config later):

```ts
const handleDrop = useCallback((ev: React.DragEvent) => {
  if (readOnlyRef.current) return;
  ev.preventDefault();
  const stepType = ev.dataTransfer.getData("application/journeyman-step");
  const controlType = ev.dataTransfer.getData("application/journeyman-control");
  const triggerType = ev.dataTransfer.getData("application/journeyman-trigger");
  const position = screenToFlowPosition({ x: ev.clientX, y: ev.clientY });

  let newNode: WorkflowNode | null = null;
  if (stepType) {
    // ... existing step branch unchanged ...
  } else if (controlType) {
    // ... existing control branch unchanged ...
  } else if (triggerType) {
    // Block adding a second trigger-manual — only one is allowed.
    if (triggerType === "trigger-manual") {
      const flow = flowRef.current;
      const existing = flow.nodes.some(n => n.type === "trigger-manual");
      if (existing) {
        // eslint-disable-next-line no-console
        console.warn("[flow-editor] only one manual trigger is allowed per workflow");
        return;
      }
    }
    newNode = {
      id: `${triggerType}_${Math.random().toString(36).slice(2, 8)}`,
      type: triggerType as WorkflowNodeType,
      displayName: triggerType === "trigger-manual" ? "Manual"
                 : triggerType === "trigger-webhook" ? "Webhook"
                 : "Human form",
      config: {},
      position,
    };
  }
  if (!newNode) return;

  // ... rest of handleDrop unchanged (autoBindNewNode, etc.) ...
}, [/* existing deps */]);
```

Keep the rest of `handleDrop` (autoBindNewNode, custom-ai handling, the actual `applyExternalChange`) exactly as it is. Trigger nodes do not need `autoBindNewNode` — they have no inputs to bind — but running the function on them is a no-op for non-step nodes, so leaving the call in place is fine.

---

## Task 4: Remove the TriggersLane + AddTriggerModal

**Files:**
- Modify: `packages/flow-editor/src/FlowEditor.tsx` — unmount the lane and drop its handlers.
- Delete: `packages/flow-editor/src/triggers-lane/TriggersLane.tsx`
- Delete: `packages/flow-editor/src/triggers-lane/AddTriggerModal.tsx`
- Delete: directory `packages/flow-editor/src/triggers-lane/` (after the two files are removed).

- [ ] **Step 4.1: Remove the `<TriggersLane>` mount and its imports from `FlowEditor.tsx`**

In `packages/flow-editor/src/FlowEditor.tsx`:

(a) Remove these imports near the top of the file:

```ts
// DELETE these lines:
import { TriggersLane } from "./triggers-lane/TriggersLane.tsx";
import type { AddTriggerKind } from "./triggers-lane/AddTriggerModal.tsx";
import { isTriggerNode } from "@journeyman/core";
```

> Keep the `@journeyman/core` type imports already present (`WorkflowGraph`, `WorkflowNode`). Only the named imports above go.

(b) Remove the `onAddTrigger` and `onDeleteTrigger` handler definitions (`const onAddTrigger = (kind: AddTriggerKind): void => { ... }` and the matching `onDeleteTrigger`). They are no longer wired anywhere.

(c) Remove the `<TriggersLane ... />` JSX element. Find this block:

```tsx
<TriggersLane
  graph={heal.healed}
  selectedNodeId={s.selectedNodeId}
  onSelectNode={(id) => { s.setSelectedNodeId(id); setFlowConfigOpen(false); }}
  onAddTrigger={onAddTrigger}
  onDeleteTrigger={onDeleteTrigger}
/>
```

…and delete it entirely.

(d) Update the `autoHeal` block. The current `autoHeal` injects a `trigger-manual` node with id `"start"` at position `{ x: 80, y: 200 }` when no trigger exists. Keep this behaviour — it ensures every workflow has at least one trigger. No change needed to `autoHeal` itself.

- [ ] **Step 4.2: Delete the lane files**

Run from the repo root:

```bash
rm packages/flow-editor/src/triggers-lane/TriggersLane.tsx
rm packages/flow-editor/src/triggers-lane/AddTriggerModal.tsx
rmdir packages/flow-editor/src/triggers-lane
```

Expected: no errors. (If `rmdir` complains the directory isn't empty, run `ls packages/flow-editor/src/triggers-lane` to find leftover files and remove them.)

---

## Task 5: CSS — add trigger node styles, remove lane styles

**Files:**
- Modify: `packages/flow-editor/src/styles.css`

- [ ] **Step 5.1: Remove the obsolete lane CSS**

In `packages/flow-editor/src/styles.css`, delete the entire block under the comment `/* === Triggers lane — compact single-row chip strip (Task 8) === */`. The block ends just before `/* === Workflow inputs drawer ... === */`. Approximately:

```css
/* === Triggers lane — compact single-row chip strip (Task 8) ============== */
.jm-triggers-lane { ... }
... (everything down to and including .jm-triggers-empty)
```

Delete from `.jm-triggers-lane {` through the closing brace of `.jm-triggers-empty`.

- [ ] **Step 5.2: Add trigger node styles**

Append to `packages/flow-editor/src/styles.css` (under the existing `.je-node--start { ... }` rule, ideally near it for cohesion):

```css
/* Trigger nodes — rendered on the canvas like terminal nodes (Task 8 / triggers-on-canvas). */
.je-node--trigger {
  border-color: #6c5ce7;
  background: rgb(108 92 231 / 0.08);
  border-top-left-radius: 14px;
  border-top-right-radius: 14px;
}
.je-node--trigger .je-node__icon { color: #6c5ce7; }
.je-node--trigger-manual  { /* manual trigger inherits the base trigger style */ }
.je-node--trigger-webhook { /* webhook trigger inherits the base trigger style */ }
.je-node--trigger-human   { /* human form trigger inherits the base trigger style */ }
```

---

## Task 6: Final typecheck

- [ ] **Step 6.1: Run typecheck across the workspace**

From the repo root:

```
npm run typecheck
```

Expected: zero errors across all workspaces. If anything fails:
- `Cannot find module "./triggers-lane/..."` → search for stray imports and remove them.
- `Property 'dragValue' does not exist` → `PaletteItem` props need updating per Step 3.2.
- `Type '"trigger-manual"' is not assignable to ...` → check that `node-registry.ts` registers all three trigger types.

- [ ] **Step 6.2: Sweep for stray references to the lane**

```
grep -rn "TriggersLane\|AddTriggerModal\|triggers-lane\|jm-triggers-lane\|jm-trigger-chip\|jm-trigger-tile" packages --include="*.ts" --include="*.tsx" --include="*.css" | grep -v node_modules
```

Expected output: no results. If any match shows up, it's a missed import or an orphan CSS rule — delete it.

---

## Self-Review Notes

**Spec coverage:**

| Spec section | Implementing task |
|---|---|
| Visual treatment — rounded-top tile, accent border, icon + label, source-only handle | Task 1 (renderers) + Task 5 (CSS) |
| Adding a trigger via palette | Task 3 |
| Removing a trigger via standard delete | No work needed — existing `Canvas.tsx` delete path already handles trigger node types; the "last trigger" guard added previously remains in place |
| Multiple triggers stacking | Emergent — each trigger is just a node; positioning is up to the user |
| Files removed (TriggersLane, AddTriggerModal, lane CSS) | Task 4 + Task 5.1 |
| Files modified (FlowEditor, Canvas, flow-rf-adapters, palette, styles.css) | Task 2 (canvas + adapters), Task 3 (palette + drop handler), Task 4 (FlowEditor), Task 5 (CSS) |
| Files unchanged (backend, properties panels, InputsTab, validators, converter) | No work needed |
| Migration path (no data migration) | Confirmed — existing trigger nodes render at their stored position |
| Risks (CSS conflicts, node-type registration, autoHeal positioning) | Task 5.1 cleans CSS, Task 1.4 registers node types, Step 4.1.d preserves autoHeal |

**Placeholder scan:** No TBD/TODO. All steps contain complete code or exact commands. Task 3.2 ("read PaletteItem, make smallest change") is the closest to a placeholder — kept this way intentionally because the file may have changed since this plan was written and the necessary edit depends on its current shape. The implementer must read and adapt.

**Type consistency:** `triggerType`, `dragMime`, `dragValue` are used consistently across Task 3 entries and Step 3.2 PaletteItem changes. Node type strings (`"trigger-manual"` etc.) match between Task 1 renderers, Task 1.4 registry, Task 3.3 drop handler, and the existing `WorkflowNodeType` in `@journeyman/core`.
