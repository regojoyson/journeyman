# Triggers on Canvas — Design

**Date:** 2026-05-25
**Status:** Draft — pending implementation plan
**Supersedes (UX layer only):** [2026-05-25-workflow-trigger-nodes-design.md](2026-05-25-workflow-trigger-nodes-design.md) (data-model and backend remain unchanged)

## Problem

The current flow-editor UI puts trigger nodes (`trigger-manual`, `trigger-webhook`, `trigger-human`) into a "Triggers strip" above the canvas. The canvas itself filters trigger nodes and their outgoing edges out of the React Flow rendering.

This breaks the user's mental model in two concrete ways:

1. **The entry point is invisible.** When a user drags `Get Issue` onto the canvas, the editor auto-wires an edge from the trigger to that node — but the user cannot see the edge, change it, or know which node "won" the auto-wire. If they add multiple top-level nodes, all but one become orphans.
2. **Multiple triggers compose awkwardly.** A strip with chips is a non-standard container that users have never seen before. Wiring a webhook to one branch and a manual run to another requires a UI we do not have.

The user reported this exact confusion: *"how do I define the entry point? how does the system know `Get Issue` is the starting point?"* The validation error *"Node 'end' is unreachable from start"* fires whenever a node lacks an incoming-from-trigger edge — which is constantly, because users cannot see what is or isn't wired to a trigger.

## Industry standard

Every leading visual workflow tool places the trigger **on the canvas** as a first-class node:

| Tool | Trigger placement |
|---|---|
| n8n | Canvas node with "Trigger" badge |
| Zapier | "Step 1" at the top of the linear list |
| Make.com | Canvas module, clock icon |
| Microsoft Power Automate | Top card of the step list |
| Camunda / BPMN | Canvas — Start Event circles |
| GitHub Actions YAML | `on:` block at top of file |

No major tool uses a strip-above-canvas pattern. We will adopt the n8n / BPMN model: triggers are canvas nodes with distinctive styling.

## Goals

- The trigger is a visible node on the canvas.
- The user wires an edge from the trigger to the first step using the same gesture they use to wire any two nodes.
- Multiple triggers compose naturally (a vertical column of trigger nodes on the left, each connecting into the graph).
- Backend data model, validators, ingest, and Conductor converter are unchanged.

## Non-goals

- Removing the `WorkflowTriggerNodeType` system — triggers remain a node type, they are just rendered on the canvas.
- Changing the trigger configuration UX (properties panel for each trigger type is unchanged).
- Re-locating the workflow inputs drawer (stays in the topbar).

## Design

### Visual treatment

Trigger nodes render with a distinctive look so users can scan them at a glance:

- **Rounded-top tile** (flat bottom edge to suggest "downstream flows from here").
- **Accent border** in purple (`#6c5ce7`) — matches the existing selection color so triggers feel privileged.
- **Icon + type label** inside the tile:
  - `trigger-manual` → `▶ Manual`
  - `trigger-webhook` → `🪝 Webhook · {webhook name}`
  - `trigger-human` → `📝 Human form · {form title}`
- **No inbound connection handle** (triggers have no inbound edges by validation).
- **Outbound connection handle** on the bottom edge.
- **Default position** when added: top-left of the canvas, stacked vertically (`x: 80`, `y: 80 + index * 100`).

### Adding a trigger

Replace the strip with a single "+ Add trigger" button. Two equally good locations — implementation should pick whichever fits the existing UI vocabulary best:

- **Option (i):** Palette section. The left-side palette gains a "Triggers" section above "Workspace" with three drag-able tiles (Manual / Webhook / Human form). User drags onto canvas. Symmetric with how other nodes are added.
- **Option (ii):** Topbar icon button (`+` with a play-symbol mask), opens the existing `AddTriggerModal` which places the chosen trigger on the canvas.

Recommendation: **(i)** — palette section. It matches the existing add-node pattern, removes a special-case UI element, and lets users drag triggers exactly like any other node.

### Removing a trigger

Same as removing any node — select and press Delete. The existing Canvas guard that prevents deleting the only remaining trigger stays in place (validation rule: ≥1 trigger required).

### Multiple triggers

Visually, multiple triggers stack as a column on the left side of the canvas. Each connects independently to whichever downstream node the user wires it to. This is exactly the existing data model — every trigger is just a node with outgoing edges, and the user defines those edges by dragging.

### Files removed

- `packages/flow-editor/src/triggers-lane/TriggersLane.tsx`
- `packages/flow-editor/src/triggers-lane/AddTriggerModal.tsx` (kept only if Option ii is chosen)
- CSS in `styles.css` under the `/* === Triggers lane === */` section
- CSS for `.jm-modal-overlay`, `.jm-trigger-tile`, etc. (kept if Option ii)

### Files modified

- `packages/flow-editor/src/FlowEditor.tsx` — remove `<TriggersLane>` mount, remove `onAddTrigger` / `onDeleteTrigger` wrappers (delegate to existing node-add / node-delete flows), keep the InputsTab drawer in the topbar.
- `packages/flow-editor/src/canvas/Canvas.tsx` — remove the `toReactWorkflowNodes` filter that hides triggers. Re-include trigger nodes in the rendered set.
- `packages/flow-editor/src/canvas/flow-rf-adapters.ts` — remove the `toReactWorkflowEdges` filter that drops edges where `source` is a trigger.
- `packages/flow-editor/src/canvas/node-renderers/` — add three new React Flow node component files (or one parametric component) for the trigger node visuals. Register them in the React Flow `nodeTypes` map.
- `packages/flow-editor/src/palette/Palette.tsx` (Option i) — add a "Triggers" section with three draggable tiles.
- `packages/flow-editor/src/styles.css` — add CSS for the new trigger node tiles.

### Files unchanged

- All backend packages (`@journeyman/core`, `@journeyman/orchestrator`, `@journeyman/api-server`, `@journeyman/migrations`, `@journeyman/webhooks`).
- Trigger properties panels (`trigger-manual-panel.tsx`, `trigger-webhook-panel.tsx`, `trigger-human-panel.tsx`) — still mounted by `PropertiesPanel.tsx` based on node type.
- InputsTab drawer + topbar Inputs icon button.
- Validation rules — already use `findTriggerNodes` / `isTriggerNode`; trigger nodes are still in the graph and validators see them.
- Conductor converter — already begins task emission at `successor(trigger)`. Unchanged.
- Webhook ingest pipeline. Unchanged.

### Migration path

No data migration needed. Existing workflows already store triggers as nodes in the graph and edges in the edges list. Today we hide them on render; tomorrow we show them. The on-disk shape is identical.

A workflow created under the strip-UI may have a trigger node positioned at `{ x: 80, y: 80 }` (the default we picked for the strip). When loaded under the new UI, it will render at that position on the canvas. A one-time autoHeal pass on load can reposition triggers that fall inside the bounds of other nodes — but this is optional and probably not needed (the strip-positioned triggers will be at the top-left, where they belong on canvas).

## Risks

- **CSS conflicts:** the `.jm-*` classes added today will become dead code. Removing them is mechanical but easy to miss. Mitigation: include a CSS cleanup pass in the plan.
- **Node-type registration:** if the React Flow `nodeTypes` map is not updated, trigger nodes will fall back to the default node renderer (square box). Mitigation: explicit step in the plan to register the new types and verify visually.
- **AutoHeal positioning:** existing workflows might have triggers positioned where they overlap a real node. Mitigation: log a console warning during autoHeal if overlap is detected; let user reposition manually.

## Testing

- Unit: none required (UI-only change; logic is unchanged).
- Manual / integration:
  - Open an existing workflow → trigger appears on canvas at its stored position.
  - Drag a new Manual trigger from the palette → appears on canvas, becomes the workflow's manual trigger.
  - Wire an edge from a trigger to a step → edge persists, validation passes.
  - Delete a non-last trigger → succeeds. Delete the only trigger → blocked.
  - Publish workflow with multiple triggers → succeeds; trigger index reflects all of them.

## Open questions

None at design time. Implementation may surface specific React Flow integration details (e.g. custom edge component for the trigger-to-step edge, or styling specifics).
