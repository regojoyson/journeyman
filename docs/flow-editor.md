# Using the Flow Editor

The flow editor is the n8n-style canvas where you build a flow by dragging nodes and wiring them together. This guide covers the day-to-day mechanics. The same summary is available in-app via the **?** button (top-right of the canvas).

## Building a flow

1. **Add a node** — drag any item from the left **Steps** palette onto the canvas. The palette is grouped into Triggers, Control nodes, and your step categories.
2. **Connect nodes** — drag from one node's handle to another's. A handle turns **green** while you drag when it's a valid drop target.
3. **Handle failures** — drag from a node's **red** error handle to the node that should run when the step fails.
4. **Edit a node** — click a node or edge to select it; its settings open in the right-hand panel.
5. **Move & delete** — drag a node to reposition it; select it and press **Delete** to remove it. The only trigger and the only End node are protected and can't be deleted.
6. **Save & navigate** — **Cmd/Ctrl+S** saves. The mouse wheel zooms; dragging the empty canvas pans.

## Node types

### Triggers (start a flow)

| Icon | Node | Purpose |
|---|---|---|
| ▶ | Manual | Start by clicking Run or via the API. |
| 🪝 | Webhook | Start when a webhook receives a matching event. |
| 📝 | Human form | Start when a person submits an in-app form. |

### Steps

| Icon | Node | Purpose |
|---|---|---|
| ⚙ | Step | A unit of work from the step catalog. Each step type has its own icon. |

### Control

| Icon | Node | Purpose |
|---|---|---|
| ■ | End | Terminal node — sets an outcome label. A flow may have several. |
| ? | If / Else | Branch on a condition (then / else). |
| × | XOR | Exactly one branch is taken. |
| + | Fork | Split the flow into parallel branches. |
| ⋈ | Join | Wait for parallel branches; choose how to handle errors. |
| ⏳ | Human Task | Pause for a person to fill a form; optionally notify them. |
| 🔔 | Webhook Wait | Pause until a matching provider webhook arrives. |

## Handles & edges

**Handles** (the dots on a node):

- **Blue** — flow input/output. Drag from one to another node to connect.
- **Red** — error output. Connect to the node that handles failures.
- **Green glow** — transient; shown while you drag, meaning "valid drop target".

**Edges** (the lines between nodes):

- **Solid grey** — default flow.
- **Dashed yellow** — conditional branch (labeled "if").
- **Dashed grey** — else branch.
- **Dashed red** — error path.

## Publishing & read-only

A flow is either **Draft** or **Ready**:

- **Draft** — fully editable. Publish it with the **Publish** button in the topbar.
- **Ready** — published and **read-only** on the canvas. To edit again, use **Move to Draft**.

The topbar shows **● unsaved** when you have changes that haven't been saved yet.
