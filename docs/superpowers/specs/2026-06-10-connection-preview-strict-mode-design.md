# Connection-Preview Strict Mode — Design

**Date:** 2026-06-10
**Package:** `@journeyman/flow-editor`
**Status:** Approved for planning

## Problem

In the workflow canvas editor, when a user drags a wire from one step's output
dot to another step, the in-drag preview line snaps to the **wrong** dot —
typically the target node's right-side *output* handle. After the user releases,
the finished edge corrects itself and attaches to the target node's left-side
*input* handle. The result is a visible mid-drag/after-drop "jump" that looks
broken.

## Root cause

The `<ReactFlow>` component in
[Canvas.tsx](../../../packages/flow-editor/src/canvas/Canvas.tsx) is configured
with `connectionMode={ConnectionMode.Loose}` (combined with
`connectionRadius={40}`).

In **loose** mode, the connection preview can snap to *any* nearby handle within
the connection radius, regardless of the handle's `type`. Step nodes expose a
`source` ("default") handle on the **right** and a `source` ("error") handle on
the **bottom**, in addition to the `target` handle on the **left**
([StepNode.tsx:89-98](../../../packages/flow-editor/src/canvas/nodes/StepNode.tsx)).
So while dragging toward a target node, the preview can latch onto its right-side
output dot.

On drop, the edge is finalized and routed by React Flow to the node's `target`
handle. The edge adapter
([flow-rf-adapters.ts](../../../packages/flow-editor/src/canvas/flow-rf-adapters.ts))
never sets a `targetHandle`, so React Flow defaults to the (only) target handle —
which is on the left. Hence the preview (loose, any handle) and the final edge
(target handle, left) disagree.

## Why the data model permits a clean fix

An audit of all 13 custom node components confirms **every** `<Handle>` declares
an explicit `type` (`source` or `target`) — none rely on a default. Every
`target` handle is on the **left**. The connection model is strictly
source → target; loose mode buys flexibility (same-type connections) the app
never wants.

| Node | target (input) | source (output) |
|---|---|---|
| StartNode | — | Right |
| EndNode | Left | — |
| StepNode | Left | Right (`default`), Bottom (`error`) |
| JoinNode | Left | Right (`default`) |
| GatewayXorNode | Left | Right (`default`) |
| GatewayAndNode | Left | Right (`default`) |
| IfNode | Left | Right (`then`), Right (`else`) |
| LoopNode | Left | Bottom (`body`), Right (`exit`) |
| TriggerManual/Human/Webhook | — | Right |
| HumanTaskNode | Left | Right |
| WebhookWaitNode | Left | Right |
| TimerNode | Left | Right |
| SubflowNode | Left | Right |

## Chosen approach

Switch `connectionMode` from `ConnectionMode.Loose` to
`ConnectionMode.Strict`.

In strict mode, a drag that starts at a `source` handle can only snap to
`target` handles. Because every target handle is on the left, the in-drag
preview snaps to the left input dot — exactly where the dropped edge ends up.
The mid-drag jump disappears. As a free bonus, strict mode rejects invalid
same-type connections (output → output, input → input) that loose mode silently
allowed.

This is a one-line change. No node handles, edge styling, or edge-data formats
change.

### Rejected alternatives

- **Keep loose + `isValidConnection`:** Marks the right-dot target as *invalid*
  (red) but the preview still snaps to the right dot, so the visual glitch
  remains — arguably worse UX.
- **Keep loose + shrink `connectionRadius` / set explicit `targetHandle`:**
  Smaller radius reduces accidental snapping but doesn't eliminate it and makes
  aiming harder. Setting `targetHandle` only affects the already-correct final
  edge, not the preview.

## Changes

1. **[Canvas.tsx](../../../packages/flow-editor/src/canvas/Canvas.tsx)** — change
   the `<ReactFlow>` prop `connectionMode={ConnectionMode.Loose}` →
   `connectionMode={ConnectionMode.Strict}`.

## Testing

- Add/extend a vitest case asserting the Canvas renders `<ReactFlow>` with
  `connectionMode="strict"`, as a regression guard against silently reverting to
  loose mode.

## In plain words

Right now, while you drag a wire, the editor lets it "stick" to *any* dot on the
node you're aiming at — including the output dot on the right — so the wire looks
like it will plug into the right side. When you let go, the editor remembers that
wires only really plug into the *input* dot on the left and snaps the wire over
there. The fix tells the editor "while dragging, only let wires stick to input
dots," so what you see during the drag is what you get when you drop.

## Out of scope

- Handle positions, styling, or counts.
- Edge styling or the edge data format (`WorkflowEdge`).
- `connectionRadius` tuning.
