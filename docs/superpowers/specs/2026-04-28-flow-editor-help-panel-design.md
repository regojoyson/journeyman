# Flow Editor — Help Panel + Handle Bug Fix + Canvas Refactor

**Date:** 2026-04-28
**Package:** `@journeyman/flow-editor`

## Problem

Two issues, one feature.

1. **Bug — phase node handles render green instead of blue.** The user sees "2 green dots and 1 red" on Phase nodes when they should see "2 blue and 1 red". Cause: `packages/flow-editor/src/styles.css` styles `.react-flow__handle.connectionindicator` as green (`#00b894`). React Flow applies the `connectionindicator` class to every handle by default — it marks handles as connection points, it is not a transient state. Only the `.connectingfrom` class is transient (set on the handle the user is actively dragging from). Result: every blue handle is permanently green at rest.

2. **Feature — UI hint / cheat sheet.** First-time users have no way to learn what the colored dots, edge styles, and node icons mean, or how to add and connect nodes. Other apps (Figma, GitHub) solve this with a `?` button that opens a help panel.

3. **Refactor (in-scope because it serves the feature work).** `Canvas.tsx` is 313 lines and mixes pure FlowGraph ↔ React Flow conversions with React state and event handlers. It also contains ~40 lines of dead code (`findEdgeNearPoint`, `distancePointToSegment`).

## Goals

- Phase node handles render with the correct colors at rest (blue for default, red for error).
- Users have a discoverable, dismissible help panel that explains handles, node types, edge types, mouse interactions, and how to add nodes.
- `Canvas.tsx` becomes smaller and focused on React Flow wiring; pure conversion logic moves to a unit-testable module.

## Non-goals

- Internationalization of help text (English only).
- Per-node contextual tooltips on hover.
- A guided step-by-step tour.
- Customizable keyboard shortcuts.
- Theming or settings for the help panel.

## Design

### 1. Bug fix — handle colors

In `packages/flow-editor/src/styles.css`, change:

```css
.react-flow__handle.connectingfrom,
.react-flow__handle.connectionindicator {
  background: #00b894 !important;
  ...
}
```

to:

```css
.react-flow__handle.connectingfrom {
  background: #00b894 !important;
  ...
}
```

`.connectionindicator` is dropped because React Flow applies it to every handle by default. The green "valid drop target" feedback is preserved by `.connectingfrom`, which is the truly transient class.

### 2. Help panel

#### File layout

```
packages/flow-editor/src/canvas/
├── HelpPanel.tsx      ← floating ? button + slide-in panel + open state
└── help-content.tsx   ← static legend rows (data only)
```

`HelpPanel` is mounted as a sibling to `<ReactFlow>` inside the existing `je-editor__canvas` div in `Canvas.tsx`, so it positions relative to the canvas (not the whole page).

#### Floating `?` button

- 36px circle, `position: absolute; bottom: 16px; right: 16px` inside the canvas container.
- Theme: `background: #2a2a3e`, `color: #ddd`, `border: 1px solid #444` (matches the topbar).
- `aria-label="Help"`, `title="Help (?)"`.
- Sits above-right of React Flow's default `<Controls>` (bottom-left), so they don't collide.

#### Slide-in panel

- 320px wide, full canvas height, anchored to the right edge.
- Slides in via `transform: translateX(0 ↔ 100%)` with a 180ms ease.
- `background: #1a1a26`, `border-left: 1px solid #2a2a3e`, scrolls internally if content overflows.
- Header: "How to use the editor" + close `X`.
- Body: five sections, each a labeled list of compact rows (swatch + label + 1-line description).
- Footer: muted text — "Press `?` to toggle, `Esc` to close".

#### Interaction

- Click `?` button → toggle.
- Press `?` (when no input/textarea is focused) → toggle.
- Press `Esc` → close.
- Click outside the panel → close. Click inside → no-op.
- First-run: panel opens automatically once. After the user closes it (or auto-shown), set `localStorage["journeyman.flow-editor.help-seen"] = "1"`.

#### Persistence

- One key: `journeyman.flow-editor.help-seen`.
- All `localStorage` access wrapped in try/catch — private-mode browsers can throw. On failure, default to closed.

#### Help content

Five sections; the rows are static data exported from `help-content.tsx`.

**Handles legend** (4 rows):
- Blue dot — default flow input/output. Drag from one to another node to connect.
- Red dot — error output. Connect to the node that handles failures for this phase.
- Green glow (transient) — appears while you're dragging a connection; means "valid drop target".
- Yellow dot — conditional output (XOR / If branches; shown only on those nodes).

**Node types** (8 rows, icon + colored dot + name + 1-liner):
- ▶ Start  ■ End  ⚙ Phase  ◆ Gateway XOR (one of N)  ⬡ Gateway AND (parallel)  ↻ Loop  ⊞ Subflow  ❓ If  ⏱ Timer.

**Edge types** (4 rows, mini line swatch + label):
- Solid grey — default flow.
- Yellow — conditional branch.
- Grey dashed — else branch.
- Red — error path.

**Interactions** (5 rows):
- Drag a node from the left palette onto the canvas to add it.
- Drag from a handle to another handle to connect.
- Click a node/edge to select it; properties show in the right panel.
- Drag a node to move; select + `Delete` to remove.
- Mouse wheel = zoom; click + drag empty canvas = pan.

**Adding a node** (1 short paragraph):
> Drag any item from the left "Phases" or "Controls" palette onto the canvas. Then drag from its blue handle to another node's handle to connect them. Wire up error paths by dragging from the red handle.

### 3. Canvas.tsx refactor

#### Extract pure conversions

Move to a new file `packages/flow-editor/src/canvas/flow-rf-adapters.ts`:

- `KNOWN_NODE_TYPES`
- `toReactFlowNodes(flow, catalog, selectedId): Node[]`
- `toReactFlowEdges(flow): Edge[]`
- `structuralSig(flow): string`
- `buildFlowFromInternal(prevFlow, rfNodes, rfEdges): FlowGraph`
  - Currently a closure over `p.flow`; the extracted version takes `prevFlow` as an argument so it stays pure.

These are pure (no React, no hooks) and become independently unit-testable.

#### Delete dead code

- `distancePointToSegment` — only used by `findEdgeNearPoint`.
- `findEdgeNearPoint` — defined but never called anywhere in the codebase (verified by grep).

Net: ~40 lines removed.

#### What stays in Canvas.tsx

- `CanvasInner` component, `Canvas` wrapper.
- All hooks (`useNodesState`, `useEdgesState`, the resync `useEffect`, the `propagatedSigRef` machinery).
- All handlers (`handleNodesChange`, `handleEdgesChange`, `handleConnect`, `handleDrop`, `handleDragOver`).
- The `<ReactFlow>` JSX, now with `<HelpPanel />` rendered as a sibling inside the wrapper div.

Estimated post-refactor size: ~180 lines. Splitting handlers into a custom hook would just shuffle complexity without reducing it, so they stay.

## Error handling

- `localStorage` access wrapped in try/catch (private-mode safety). On failure, default to closed; don't crash.
- The panel has no async work, no network, no SDK calls — nothing else to fail.

## Testing

- **Unit tests** for `flow-rf-adapters.ts` (the extracted module): round-trip a small `FlowGraph` through `toReactFlowNodes` / `toReactFlowEdges` / `buildFlowFromInternal` and assert structure; assert `structuralSig` is stable across irrelevant field changes.
- **Manual verification** via the web dev server (`packages/web`): the `?` button appears bottom-right; click toggles the panel; `?` key toggles; `Esc` closes; click-outside closes; first-run auto-opens (clear `localStorage` to retest); Phase node handles render blue + red (the bug fix).
- No automated tests for `HelpPanel` itself — it's static content + a toggle. Cost outweighs value.

## Risks

- **`?` keybinding collision.** If a future input field is focused and the user types `?`, we should not toggle the panel. Guard: check `document.activeElement` is not an `<input>`, `<textarea>`, or `[contenteditable="true"]`.
- **Click-outside vs canvas interaction.** A click on the canvas to deselect could also close the panel. Acceptable — the user's mental model is "click anywhere outside the panel = close it", which matches.
- **`buildFlowFromInternal` extraction.** Currently closes over `p.flow`; the extracted version becomes `(prevFlow, rfNodes, rfEdges)`. The call sites must pass `p.flow` explicitly. Low risk, mechanical change, covered by the new unit tests.
