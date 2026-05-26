# Show Node ID in Properties Panel + Clickable Node IDs in Issue Messages — Design

**Date:** 2026-05-26
**Status:** Draft — pending implementation plan

This spec covers two related improvements to how node identity surfaces in the editor UI:

1. **Part 1** — Show the immutable `node.id` in the properties panel header so authors can disambiguate same-type nodes.
2. **Part 2** — Turn every `(nodeId)` bracketed identifier inside validation error and warning messages into a clickable link that **selects the node AND centers the canvas on it**, across the Publish modal and the topbar error/warning banner.

## Problem

When a flow contains multiple nodes of the same type (e.g. two `step` nodes both named "Implement"), there is currently no way to disambiguate them from the canvas or the properties panel. The internal `node.id` is the canonical identifier but is never surfaced in the UI. Authors occasionally need this ID when:

- Diagnosing duplicate steps with identical type/display name
- Cross-referencing a node against backend logs or run output
- Reporting bugs against a specific node

## Goal

Surface `node.id` in the properties panel so authors can read and copy it.

## Non-Goals

- Editing the ID (IDs remain immutable post-creation)
- Surfacing IDs on the canvas itself (overlays, tooltips, etc.)
- Adding a global "find by ID" or duplicate-detection feature

## Design

### Placement

A small, muted, monospace subtitle rendered under the node title in the properties panel header.

Current header ([PropertiesPanel.tsx:170](packages/flow-editor/src/properties-panel/PropertiesPanel.tsx:170)):

```tsx
<div className="je-props__header">
  <div className="je-props__title">{node.displayName ?? node.type}</div>
  {onClose ? <button ... >×</button> : null}
</div>
```

New header:

```tsx
<div className="je-props__header">
  <div className="je-props__title-block">
    <div className="je-props__title">{node.displayName ?? node.type}</div>
    <button
      type="button"
      className="je-props__id"
      title="Click to copy node ID"
      onClick={() => copyId(node.id)}
    >
      {node.id}
    </button>
  </div>
  {onClose ? <button ... >×</button> : null}
</div>
```

The same header is used for steps, control nodes, and end nodes (it sits above the tab/body switch at [PropertiesPanel.tsx:176-196](packages/flow-editor/src/properties-panel/PropertiesPanel.tsx:176)), so the change applies uniformly to every node type with zero per-node branching.

### Interaction

- The ID renders as a `<button>` styled as inline text so it is keyboard-focusable and announces as interactive.
- On click: `navigator.clipboard.writeText(node.id)` and briefly swap the label to "Copied" for ~1.2s using local state.
- Falls back silently to selectable text if `navigator.clipboard` is unavailable (no error toast).

### Styling

Add to [packages/flow-editor/src/styles.css](packages/flow-editor/src/styles.css):

```css
.je-props__title-block { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.je-props__id {
  font-family: var(--je-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 11px;
  color: var(--je-color-muted, #6b7280);
  background: none;
  border: 0;
  padding: 0;
  cursor: pointer;
  text-align: left;
}
.je-props__id:hover { color: var(--je-color-fg, #111827); }
.je-props__id:focus-visible { outline: 1px dashed currentColor; outline-offset: 2px; }
```

Reuses existing CSS variables where present; falls back to literal values otherwise.

### Data Flow

No data-model changes. The component already receives the full `WorkflowNode` and `node.id` is always populated by the canvas.

### Accessibility

- `button` element ensures focusable and screen-reader-announced.
- `title` attribute provides hover hint.
- The "Copied" label change is announced naturally via the button's text content update.

## Testing

- Manual: open a flow with two step nodes of the same type; select each in turn and confirm distinct IDs render.
- Manual: click the ID, paste into another field, confirm the value matches.
- Manual: keyboard-tab into the ID, press Enter, confirm copy.
- No new automated tests — this is a presentational header addition with no logic branches beyond the click handler.

## Risks

- `navigator.clipboard` is unavailable in insecure contexts; the silent fallback (selectable text) is acceptable since the ID is still visible.
- Long IDs (UUIDs) may wrap; the `min-width: 0` on the title block + the existing flex layout in `.je-props__header` should handle this. Verify visually in the dev server.

## Out of Scope / Follow-ups (Part 1)

- Showing IDs on the canvas (e.g. badges or tooltips)
- A "Find duplicates" linter rule that highlights repeated `type + displayName` combinations

---

# Part 2 — Clickable Node IDs in Issue Messages

## Problem

Validation messages already embed node IDs in parentheses (e.g. `Step node 'Implement' (step_a1b2) is missing a step type`) via `nodeLabel()` at [validation.ts:18-21](packages/flow-editor/src/state/validation.ts:18-21). Some fork/join errors embed multiple IDs in a single message ([validate-fork-join-pairs.ts:93,116](packages/core/src/validation/validate-fork-join-pairs.ts:93)).

Current state:

- **PublishModal** ([PublishModal.tsx:50](packages/flow-editor/src/topbar/PublishModal.tsx:50)) shows a clickable chip per row, but the bracketed IDs inside the message text are inert. The chip *does* set `selectedNodeId`, but the canvas does not pan/zoom to the selected node, so an offscreen node appears to be ignored.
- **Topbar banner sections** ([Topbar.tsx:547-548](packages/flow-editor/src/topbar/Topbar.tsx:547), [Topbar.tsx:558,580,595,609](packages/flow-editor/src/topbar/Topbar.tsx:558)) render raw message strings with no clickable IDs at all.

## Goal

Every `(nodeId)` substring in an issue message becomes a link that:

1. Selects the node (existing `setSelectedNodeId`).
2. **Centers the canvas on the node and zooms in to ≥1.0** so it's actually visible.
3. Opens the properties panel on that node.

Applies uniformly to PublishModal (errors + warnings) and the topbar banner (errors + all warning categories).

## Design

### Component: `<IssueMessage>`

A new presentational component at `packages/flow-editor/src/issues/IssueMessage.tsx`:

```tsx
interface Props {
  flow: WorkflowGraph;
  message: string;
  onSelectNode: (id: string) => void;
  /** Called after a link click, e.g. to close the parent modal. */
  onAfterClick?: () => void;
}

export function IssueMessage({ flow, message, onSelectNode, onAfterClick }: Props): JSX.Element {
  const ids = useMemo(() => new Set(flow.nodes.map(n => n.id)), [flow]);
  const parts = tokenize(message, ids);
  return (
    <span className="je-issue-message">
      {parts.map((p, i) =>
        p.kind === "id" ? (
          <button
            key={i}
            type="button"
            className="je-issue-link"
            onClick={() => { onSelectNode(p.value); onAfterClick?.(); }}
          >
            {p.value}
          </button>
        ) : (
          <span key={i}>{p.value}</span>
        ),
      )}
    </span>
  );
}
```

Tokenizer (pure function in same file):

- Scan `message` with regex `/\(([^()]+)\)/g`.
- If the captured group matches a known `nodeId`, emit three tokens: `"("`, an `id` token, `")"`.
- Otherwise pass the whole match through as text.
- Whitespace and surrounding text are preserved verbatim. Parens stay as plain text so the sentence still reads naturally.

Limiting to **known node IDs** keeps us from accidentally linkifying edge IDs (`edge_…`) or arbitrary parenthetical text like `(json_logic)`.

### `focusNode` helper + canvas wiring

Today selection is set via `s.setSelectedNodeId(id)` ([FlowEditor.tsx:296](packages/flow-editor/src/FlowEditor.tsx:296)) but the canvas never pans to it. Fix:

1. Add a new prop to `Canvas`: `focusRequest?: { nodeId: string; tick: number }`. The `tick` lets the canvas re-center even when the same `nodeId` is clicked twice in a row.
2. Inside `Canvas.tsx` use the existing `useReactFlow()` hook ([Canvas.tsx:5,127](packages/flow-editor/src/canvas/Canvas.tsx:5)) to call `setCenter(node.position.x + width/2, node.position.y + height/2, { zoom: Math.max(getZoom(), 1), duration: 250 })` inside a `useEffect` keyed on `focusRequest`.
3. Use a sensible default node size (e.g. `{ width: 240, height: 80 }`) — exact size is fine to approximate; centering ±half-a-node is acceptable.
4. In `FlowEditor.tsx`, manage a `focusRequest` state alongside `selectedNodeId`, and expose a single helper:

```ts
const focusNode = useCallback((id: string) => {
  s.setSelectedNodeId(id);
  setFlowConfigOpen(false);
  setFocusRequest({ nodeId: id, tick: t => t + 1 });
}, [s, setFlowConfigOpen]);
```

`focusNode` becomes the single handler passed to PublishModal and topbar instead of bare `setSelectedNodeId`.

### Adoption sites

| Location | Change |
|---|---|
| [PublishModal.tsx:43-44,50](packages/flow-editor/src/topbar/PublishModal.tsx:43) | Chip stays. Replace `{issue.message}` with `<IssueMessage flow={flow} message={issue.message} onSelectNode={onSelectNode} onAfterClick={onCancel} />`. The chip click also calls `onSelectNode(issue.nodeId)` which is now `focusNode`. |
| [Topbar.tsx:547-548](packages/flow-editor/src/topbar/Topbar.tsx:547) — `SectionBody` | Replace `{m}` with `<IssueMessage flow={flow} message={m} onSelectNode={onFocusNode} />`. Requires plumbing `flow` and `onFocusNode` props through to `SectionBody`. |
| [Topbar.tsx:558,580,595,609](packages/flow-editor/src/topbar/Topbar.tsx:558) — `SecretWarningsBody` | Replace each `{w.message}` with `<IssueMessage ... />`. The `<code>{e.nodeId}</code>` chips inside the `<ul>` lists also become buttons calling `onFocusNode(e.nodeId)`. |

### Missing required-input warnings (Part 2 scope-limit)

These come from `useNodeIssues(nodeId)` and currently render only as canvas badges (`NodeIssueBadges`) and inline inside the Config tab. **Out of scope for this spec** — they are not in the top warnings section and don't appear in PublishModal. A small parallel fix: ensure the canvas badge click (if/when one is added) uses `focusNode` rather than bare selection — but no UI change to the badges is required here.

### Styling

Add to [styles.css](packages/flow-editor/src/styles.css):

```css
.je-issue-link {
  font-family: var(--je-font-mono, ui-monospace, monospace);
  font-size: inherit;
  color: var(--je-color-link, #6aa3ff);
  background: none;
  border: 0;
  padding: 0;
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 2px;
}
.je-issue-link:hover { color: var(--je-color-link-hover, #8fbeff); }
.je-issue-link:focus-visible { outline: 1px dashed currentColor; outline-offset: 2px; }
.je-issue-message { word-break: break-word; }
```

### Accessibility

- All ID tokens render as real `<button>` elements — keyboard focusable and screen-reader announced.
- The button label is the bare ID; surrounding parens are plain text so screen readers read "open paren step_a1b2 close paren".

## Testing

- Manual: Publish a flow with multiple validation failures. Click a bracketed ID in an error message → modal closes, canvas pans/zooms to the node, properties panel opens on it.
- Manual: Trigger a fork/join error that references two nodes in one message → both IDs are independently clickable.
- Manual: Save a flow that produces secret warnings (orphan_secret_binding / inaccessible_secrets) → IDs in those messages are clickable in the topbar banner.
- Manual: Click the same link twice → canvas re-centers each time (the `tick` mechanism).
- Manual: Click a link to a node already centered → no visible jump but selection updates.

## Risks

- `setCenter` jumps may feel jarring on very large flows. The 250ms duration helps; fine to revisit if users complain.
- Messages containing parenthetical text that *happens* to match a node ID would also be linkified. Acceptable — node IDs are namespaced (`step_…`, `if_…`, etc.) and collisions with prose are extremely unlikely.
- React Flow's `setCenter` requires the node to exist in the flow at click time. If the user has unsaved deletions, the click is a no-op. Acceptable — issue messages reference existing nodes by construction.

## Out of Scope / Follow-ups (Part 2)

- Linking to a specific tab in the properties panel (e.g. jump straight to "Required Secrets" when the issue is a secret binding).
- Aggregating per-node `useNodeIssues` warnings into the topbar/PublishModal banner pipeline.
- A keyboard shortcut like `Cmd+G` to focus the currently selected node on the canvas.
