# Show Node ID in Properties Panel — Design

**Date:** 2026-05-26
**Status:** Draft — pending implementation plan

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

## Out of Scope / Follow-ups

- Showing IDs on the canvas (e.g. badges or tooltips)
- A "Find duplicates" linter rule that highlights repeated `type + displayName` combinations
