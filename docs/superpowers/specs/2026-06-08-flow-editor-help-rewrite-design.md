# Flow Editor — "How to use the editor" Rewrite (Help Panel + Docs)

**Date:** 2026-06-08
**Package:** `@journeyman/flow-editor` + `docs/`

## Problem

The in-app help panel titled **"How to use the editor"** (`packages/flow-editor/src/canvas/help-content.tsx`, rendered by `HelpPanel.tsx`) describes an earlier version of the editor. The editor's interaction model and node set have changed substantially since the panel was written, so the panel now misinforms first-time users. There is also no standalone written guide for the editor.

### What is stale today

Verified against the current code (`packages/flow-editor/src/canvas/nodes/*`, `palette/*`, `canvas/edges/*`, `canvas/handle-styles.ts`, `styles.css`, `topbar/*`):

- **Nodes — wrong/missing:**
  - Shows a single "▶ Start". The editor now has **three trigger types**: Manual (▶), Webhook (🪝), Human form (📝).
  - Renamed/re-iconed: "Gateway XOR (◆)" → **XOR (×)**; "Gateway AND (⬡)" → **Fork (﹢)**; "If (❓)" → **If / Else (?)**; "Timer (⏱)" → **Wait**.
  - **Missing entirely:** Join (⋈), Human Task (⏳), Webhook Wait (🔔).
  - Loop, Wait, Subflow are now **"Coming soon"** (greyed out in palette).
- **Handles — wrong:** "Yellow dot = conditional output" no longer exists. If-branches use **blue** handles labeled "then"/"else"; yellow is an **edge** color, not a handle color. The transient green "valid drop target" handle (`.connectingfrom`, `#00b894`) still exists and is correct.
- **Edges — drifted detail:** conditional is now **dashed yellow** (labeled "if"), else is **sparse-dashed grey**, error is **short-dashed red**, default is **solid grey**.
- **Interactions — missing:** the **Draft → Publish → read-only** lifecycle, **Cmd/Ctrl+S** save, the "● unsaved" indicator, and delete-protection (the only trigger and the only End node cannot be deleted).
- **"Adding a node" paragraph:** references a "Steps"/"Controls" palette; the palette is titled "Steps" and is grouped into Triggers / Control categories / step categories / a "Coming soon" section.

## Goals

- The in-app `?` panel accurately reflects the editor as it works today, reorganized into a task-oriented (workflow) structure.
- A concise standalone guide exists at `docs/flow-editor.md` mirroring the panel.
- Both omit "Coming soon" nodes (Loop, Wait, Subflow) to avoid documenting unavailable features.

## Non-goals

- No changes to editor **behavior**, styles, node implementations, or the publish workflow itself — this is documentation/help-text only.
- No internationalization (English only).
- No guided step-by-step tour; no per-node hover tooltips.
- No exhaustive per-handle / per-edge reference in the docs page (the "concise" guide, not the "in-depth" variant).

## Decisions (from brainstorming)

| Decision | Choice |
|---|---|
| Scope | In-app panel **and** a standalone docs page |
| Panel structure | **Reorganize by workflow** (4 task-oriented sections) |
| "Coming soon" nodes | **Omit entirely** |
| Docs page | New `docs/flow-editor.md`, **concise** (~1–2 screens) |

## Design

### Part A — In-app help panel

Two files change: `packages/flow-editor/src/canvas/help-content.tsx` (content + data shapes) and `packages/flow-editor/src/canvas/HelpPanel.tsx` (section list in the rendered body). The panel header stays **"How to use the editor"**; the footer keeps the `?` / `Esc` hint. First-run auto-open, `?`-toggle, Esc-close, and click-outside behavior are unchanged.

The current 5 flat sections (Handles, Node types, Edge types, Interactions, Adding a node) are replaced by **4 workflow-oriented sections**.

#### Section 1 — Build a flow
Ordered list (merges the old "Adding a node" + "Interactions"):
1. Drag a node from the left **Steps** palette (grouped Triggers / Control / step categories) onto the canvas.
2. Connect nodes by dragging from one handle to another; a handle turns **green** when it's a valid drop target.
3. Wire failure handling by dragging from a node's **red** (error) handle.
4. Click a node or edge to select it — its settings appear in the right panel.
5. Drag a node to reposition; select it and press **Delete** to remove. The only trigger and the only End node can't be deleted.
6. **Cmd/Ctrl+S** saves. Mouse-wheel zooms; drag the empty canvas to pan.

#### Section 2 — Node types
Grouped; **Coming soon nodes omitted**:
- **Triggers** (start a flow): Manual ▶ · Webhook 🪝 · Human form 📝
- **Steps**: ⚙ — a unit of work pulled from the step catalog (icon varies per step type).
- **Control**: End ■ · If / Else (?) · XOR (×) · Fork (﹢) · Join (⋈) · Human Task (⏳) · Webhook Wait (🔔)

#### Section 3 — Handles & edges (legend)
- **Handles:** Blue = flow input/output · Red = error output · Green glow = transient "valid drop target" shown while dragging a connection. (The old "Yellow dot" row is removed.)
- **Edges:** Solid grey = default flow · Dashed yellow = conditional (labeled "if") · Sparse-dashed grey = else branch · Short-dashed red = error path.

#### Section 4 — Publish & read-only (new)
- A flow is **Draft** (editable) or **Ready** (published); publish via the topbar button.
- A **Ready** flow's canvas is **read-only**; use **Move to Draft** to edit again.
- "● unsaved" in the topbar marks unsaved changes.

#### Data-shape implications in `help-content.tsx`
- `INTERACTIONS` + `ADDING_PARAGRAPH` collapse into one ordered "Build a flow" list (e.g. `BUILD_STEPS: string[]`).
- `NODES` becomes grouped data (Triggers / Steps / Control) rather than one flat list — e.g. `NODE_GROUPS: { title: string; rows: NodeRow[] }[]`. Coming-soon entries excluded.
- `HANDLES` legend: drop the yellow-dot row; keep blue, red, green-glow.
- `EDGES` legend: update labels/descriptions to the four current edge styles.
- `HelpPanel.tsx` renders the four sections, iterating `NODE_GROUPS` with a sub-heading per group.

### Part B — `docs/flow-editor.md`

New concise user guide (~1–2 screens) mirroring the panel, sections in this order:
1. **Building a flow** — drag from palette, connect handles, error paths, select/edit, move/delete (with delete-protection note), save/zoom/pan.
2. **Node types** — Triggers / Steps / Control, presented as a table with icon + name + one-line purpose. Coming-soon nodes omitted.
3. **Handles & edges** — the legend (blue/red/green handles; solid-grey / dashed-yellow / sparse-dashed-grey / short-dashed-red edges).
4. **Publishing & read-only** — Draft vs Ready, Publish / Move to Draft, unsaved indicator.

Match the existing `docs/*.md` voice (concise, present-tense, user-facing — see `docs/quickstart.md`). No screenshots required.

## Acceptance criteria

- The `?` panel shows the four sections above; every node/handle/edge listed matches the current code; no Coming-soon node appears.
- No yellow-handle reference remains anywhere in panel or docs.
- All three trigger types and Join / Human Task / Webhook Wait are present.
- `docs/flow-editor.md` exists, is concise, and mirrors the panel.
- `npm run check` (typecheck + import boundaries) passes for `@journeyman/flow-editor` after the `help-content.tsx` / `HelpPanel.tsx` changes.

## References

- `packages/flow-editor/src/canvas/help-content.tsx` — content to rewrite
- `packages/flow-editor/src/canvas/HelpPanel.tsx` — renders the panel sections
- `packages/flow-editor/src/canvas/nodes/*.tsx` — node types, icons, handles
- `packages/flow-editor/src/palette/Palette.tsx`, `palette/built-in-categories.ts` — palette grouping
- `packages/flow-editor/src/canvas/edges/*.tsx` — edge styles
- `packages/flow-editor/src/canvas/handle-styles.ts`, `styles.css` — handle colors, `.connectingfrom` green
- `packages/flow-editor/src/topbar/*` — Draft/Ready, Publish, unsaved indicator
