# Palette: "Available" vs "Coming soon" phases

**Date:** 2026-05-06
**Status:** Approved design — pending implementation plan

## Problem

The flow-editor palette ([packages/flow-editor/src/palette/Palette.tsx](../../../packages/flow-editor/src/palette/Palette.tsx)) currently lists every registered `PhaseDefinition`, grouped by `category`. Some phases are intentionally listed but not yet wired up to working providers, and there is no way to signal that to users dragging from the palette. Users see them as first-class options and only discover they don't work after configuring a node.

We want phases to be split into two buckets in the palette:

- **Available** — usable today; rendered exactly as today.
- **Coming soon** — surfaced for visibility but not draggable, tucked into a collapsible panel below the available list.

## Non-goals

- No runtime gating. A flow that already references a "coming soon" phase still loads and renders.
- No per-user/org/credential-derived availability. The flag is editorial.
- No filtering UI, search, or per-category expanders.
- No changes to control-flow nodes (gateways, timers, etc.) — they remain always available.

## Design

### 1. Data model

Add an optional flag to `PhaseDefinition` in [packages/flow-editor/src/phase-definition.ts](../../../packages/flow-editor/src/phase-definition.ts):

```ts
/** When true, this phase is shown in the palette's collapsible
 *  "Coming soon" panel and is not draggable onto the canvas.
 *  Default: false (available). */
comingSoon?: boolean;
```

- Default `false` → today's behavior is preserved for every existing phase.
- Custom user-defined phases (`customAiPhase` and synthetic catalog entries from [customCatalogEntries.ts](../../../packages/web/src/flow-editor-integration/customCatalogEntries.ts)) never set this flag.
- Whoever defines a phase decides the flag value; it is not derived from provider implementation status.

### 2. Palette rendering

Update [Palette.tsx](../../../packages/flow-editor/src/palette/Palette.tsx) to partition entries:

- **Available entries**: `comingSoon !== true`. Rendered exactly as today — grouped by `category`, draggable, full styling.
- **Coming-soon entries**: `comingSoon === true`. Rendered in a single collapsible panel at the bottom of the palette, as a flat list (no category subgroups inside).

Control-node catalog entries are always treated as available regardless of any future flag.

### 3. Collapsible "Coming soon" panel

Below the existing category groups:

```
▸ Coming soon (N)
```

- `N` = count of coming-soon entries. Hidden entirely if `N === 0`.
- Click the header to toggle expand/collapse.
- Default state: **collapsed**.
- Open/closed state persisted in `localStorage` under the key `flow-editor.palette.comingSoon` (string `"true"`/`"false"`), mirroring the pattern used for `sidebar-pinned` in [Sidebar.tsx](../../../packages/web/src/components/Sidebar.tsx).

### 4. Coming-soon item presentation

Inside the expanded panel, each entry uses the same `PaletteItem` component but with these differences:

- **Visually muted**: reduced opacity (~0.55), no hover lift, no color accent on hover.
- **Non-draggable**: `draggable={false}`, no `dragMime` attached. Drag attempts do nothing.
- **Tooltip / `title` attribute**: `"Coming soon — not yet available"`.
- Click is a no-op (or, optionally, briefly flashes the tooltip — not required for MVP).

### 5. Initial flagging

This spec does not pre-flag any phases. After implementation lands, the owner of each phase definition opts in by setting `comingSoon: true` on the relevant `PhaseDefinition`. Likely candidates include phases backed by stub providers (Gemini/Codex coding CLIs, GitLab git provider, Jira/Linear/Monday issue providers, Slack notification provider per `CLAUDE.md`), but the choice is per-phase editorial.

## Files affected

- [packages/flow-editor/src/phase-definition.ts](../../../packages/flow-editor/src/phase-definition.ts) — add `comingSoon?: boolean`.
- [packages/flow-editor/src/palette/Palette.tsx](../../../packages/flow-editor/src/palette/Palette.tsx) — partition entries, add collapsible panel, persist toggle.
- [packages/flow-editor/src/palette/PaletteItem.tsx](../../../packages/flow-editor/src/palette/PaletteItem.tsx) — accept a `disabled` (or `comingSoon`) prop that applies muted styling and disables drag.
- [packages/flow-editor/src/styles.css](../../../packages/flow-editor/src/styles.css) — styles for the new collapsible header and the muted item state.

No backend, schema, or migration changes.

## Acceptance

- A phase with `comingSoon: true` does not appear in any category group; it appears only inside the "Coming soon" panel.
- The "Coming soon" header shows the correct count and is hidden when there are zero such phases.
- The panel starts collapsed; toggling it persists across reloads via `localStorage`.
- Items inside the panel cannot be dragged onto the canvas and have a "Coming soon — not yet available" tooltip.
- Existing flows that reference any phase (regardless of flag) continue to load, render, and run unchanged.
