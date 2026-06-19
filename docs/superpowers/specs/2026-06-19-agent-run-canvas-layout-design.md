# Agent run canvas: fix overlapping steps

**Date:** 2026-06-19
**Status:** Approved

## Problem

When viewing an agent run (e.g. a run produced by "Run agent"), the canvas
renders the three workflow nodes — `Start → agent-run → End` — stacked on top of
each other at the same point, instead of laid out left-to-right.

## Root cause

Two facts combine:

1. `compileAgentToGraph` (`packages/agents/src/compile.ts`) builds the ephemeral
   graph with **no `position`** on any of its three nodes.
2. The read-only canvas (`packages/run-viewer/src/canvas/ReadOnlyCanvas.tsx`)
   falls back to `position: n.position ?? { x: 0, y: 0 }`, so every
   position-less node lands at `(0, 0)` and overlaps.

Regular workflows are unaffected because the flow-editor persists x/y when the
user drags nodes.

## Design

Two-part fix:

### 1. Compile-time positions (primary)

Give the agent graph fixed coordinates in `compile.ts`, matching the
flow-editor's left-to-right convention (`y: 200`, ~320px apart, clearing the
240px max node width):

- `trigger-1` (Start)   → `{ x: 80,  y: 200 }`
- `agent-run-1`         → `{ x: 400, y: 200 }`
- `end-1` (Done)        → `{ x: 720, y: 200 }`

Because the layout is baked into the snapshot, this also fixes "Fork & edit"
(forking an agent run into the editor opens it already laid out). Applies to all
runs created from now on.

### 2. Render-time fallback (safety net)

In `ReadOnlyCanvas.tsx`, replace the `?? { x: 0, y: 0 }` fallback: if **any**
node in the incoming graph lacks a position, auto-space the nodes
left-to-right by index (same y, fixed x-step). Nodes that already carry a
position are left untouched.

This makes the screen forgiving of:
- the 2 existing agent runs already persisted without positions, and
- any future position-less graph fed to the viewer.

## Scope / non-goals

- No layout library (dagre/elk). The agent graph is a fixed 3-node line; a
  trivial index-based spacing is sufficient.
- No change to how regular (editor-built) workflows are positioned.
- No DB migration / backfill of existing snapshots — the render-time fallback
  covers those at view time.

## Verification

- `tsc --noEmit` on `packages/agents` and `packages/run-viewer` passes.
- Open the existing agent run in the preview: the three nodes render spaced
  left-to-right, no overlap (screenshot).
