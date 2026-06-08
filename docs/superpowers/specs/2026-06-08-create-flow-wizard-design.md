# Create-Flow Wizard — Design

**Date:** 2026-06-08
**Status:** Approved (pending spec review)
**Author:** brainstormed with Claude

## Problem

When a user creates a new workflow today, they fill a single short form
([`NewFlowPage.tsx`](../../../packages/web/src/routes/NewFlowPage.tsx) — name,
description, scope, blank/upload) and are dropped directly onto the canvas
editor. The canvas presents a graph plus a six-tab per-node properties panel and
several flow-level panels (Flow Defaults, Inputs). New users don't know **where
to fill what** — which settings matter, where workflow-level config lives, or
where to declare run inputs. The configuration surface is powerful but
unguided.

## Goal

Add a **guided wizard at creation time** that walks the user through the
workflow-level setup that today is scattered across canvas panels:

1. Basic details (name, description, scope)
2. Workflow config / defaults (executor, model, compute target, retry)
3. Run inputs (and design-time attributes)

The wizard **does not** build the pipeline (no predefined steps, no node
assembly). It collects workflow-level configuration and inputs, scaffolds the
flow, and then hands off to the canvas for building the actual step graph.

The wizard is also **re-openable from the editor**, giving users one obvious,
guided home for config + inputs even after creation — so the "don't know where
to fill what" feeling does not return on the next edit.

## Non-goals

- No node/edge assembly, no step templates, no catalog picking in the wizard.
- No changes to publish validation ([`validate-for-publish.ts`](../../../packages/core/src/validation/validate-for-publish.ts)) — that stays on the canvas.
- No API, DB, or `@journeyman/core` schema changes. `createFlow` and the
  `WorkflowGraph` schema are unchanged; no migration.

## Decisions (locked during brainstorming)

- **Wizard first, then canvas.** The wizard runs once at creation, scaffolds the
  flow, and drops the user into the canvas to build the pipeline.
- **Approach A** — a reusable `CreateFlowWizard` component lives in
  `packages/flow-editor`, hosted by `web/NewFlowPage`. This reuses the existing
  config/inputs panels and respects import boundaries (web already depends on
  flow-editor).
- **Re-openable** — the editor gets a "Workflow setup" button that reopens the
  same wizard against the live graph.
- **Single home** — the canvas's standalone "Flow Defaults" panel and "Inputs"
  drawer entry points are **removed**. The re-openable wizard becomes the only
  way to edit config + inputs. The underlying section components are kept (the
  wizard is built from them) — only their standalone mount points and toolbar
  buttons go away.

## Reused building blocks

The wizard introduces **no new config UI**. It reuses two existing,
graph-in / patch-out components:

- **Workflow config** — the four sections that
  [`FlowConfigPanel`](../../../packages/flow-editor/src/flow-config/FlowConfigPanel.tsx)
  already composes: `DefaultsExecutorSection`, `DefaultsModelSection`,
  `DefaultsComputeTargetSection`, `DefaultsRetrySection`. These read/write
  `WorkflowGraph.defaults`.
  > Note: a separate in-flight effort renames "compute target" → "sandbox"
  > (`2026-06-08-rename-compute-target-to-sandbox-design.md`). The wizard reuses
  > whatever the section is called at implementation time; no extra coupling.
- **Inputs** —
  [`InputsTab`](../../../packages/flow-editor/src/inputs-tab/InputsTab.tsx),
  which edits `WorkflowGraph.inputDefs` and `attributeDefs`.

## Architecture

New component tree under `packages/flow-editor/src/create-wizard/`:

```
packages/flow-editor/src/create-wizard/
├── CreateFlowWizard.tsx      ← stepper shell: step nav, Back/Next/Skip, footer
├── steps/
│   ├── BasicDetailsStep.tsx  ← name, description, scope (the only NEW form)
│   ├── ConfigStep.tsx        ← thin wrapper around the Defaults* sections
│   └── InputsStep.tsx        ← thin wrapper around <InputsTab/>
└── wizard-state.ts           ← draft state + step model + completeness checks
```

`CreateFlowWizard` is a controlled stepper over a single in-memory
`WorkflowGraph` draft. It is exported from `@journeyman/flow-editor` and consumed
by two host surfaces:

1. **Creation host** — `web/NewFlowPage` renders `CreateFlowWizard` in
   `mode="create"`, seeded from `createBlankFlow()`. On finish it calls
   `createFlow(...)` once and navigates to `/workflows/:id/edit`.
2. **Re-open host** — `FlowEditor` adds a single "Workflow setup" toolbar button
   that opens `CreateFlowWizard` in `mode="edit"`, seeded from a deep copy of the
   live graph. On finish it patches the editor's graph state via the same
   `onChange` / `s.update` path "Save" already uses; no new flow, no navigation.

The wizard only ever touches `defaults`, `inputDefs`, `attributeDefs`, and (in
create mode) the flow's name/description/scope. It never touches nodes or edges.

### Removing the old canvas entry points

Both standalone entry points live in
[`FlowEditor.tsx`](../../../packages/flow-editor/src/FlowEditor.tsx) and are
removed in favor of the single "Workflow setup" button:

- The **`FlowConfigPanel`** right-aside branch and its `flowConfigOpen` state
  (toggled today by the toolbar's `onFlowConfig`).
- The **`InputsTab` drawer** modal and its `inputsDrawerOpen` state (toggled
  today by the toolbar's `onInputsClick`).
- The toolbar's `onFlowConfig` and `onInputsClick` buttons/props are replaced by
  a single `onWorkflowSetup` button.

`FlowConfigPanel` itself may be deleted (its only consumer was the canvas), or
retained purely as a composition of the `Defaults*Section`s if convenient for
the wizard's `ConfigStep`. `InputsTab` is **kept** — the wizard's `InputsStep`
wraps it directly. The right-panel grid logic (`rightPanelOpen`) drops its
`flowConfigOpen` term and keys only off selected node/edge.

## Wizard steps & data flow

The draft is a single `WorkflowGraph`. In create mode it also carries
`meta = { name, description, scope }` (these live on the `Workflow` row, not in
the graph). Nothing is persisted until finish.

| # | Step | Edits | Required to advance? |
|---|------|-------|----------------------|
| 1 | **Basic details** | `meta.name`, `meta.description`, `meta.scope` | `name` non-empty (create mode only; step hidden in edit mode) |
| 2 | **Workflow config** | `draft.defaults` (executor, model, compute target, retry) | No — pre-filled with sensible defaults, all optional |
| 3 | **Inputs** | `draft.inputDefs`, `draft.attributeDefs` | No — warns on invalid rows |
| 4 | **Review** | read-only summary | — |

**Navigation:** Back / Next between steps. A persistent **"Skip to canvas"**
action (create mode) finishes immediately with whatever is filled so far. Step 4
("Review") shows a compact summary — name/scope, chosen defaults, declared
inputs — with a single **Create** (create mode) or **Save** (edit mode) button.

### Create mode

```
createBlankFlow() ──► draft (WorkflowGraph) ──► [edit across steps] ──► finish
   finish: createFlow({ scope, name, description, definition: draft })
        └─► onSuccess: setQueryData(["flow-graph", id], draft); navigate(edit)
```

This mirrors today's `NewFlowPage.mutate()` exactly — the only change is feeding
a richer `definition` than a bare blank.

### Edit mode

```
liveGraph ──► draft (deep copy) ──► [edit steps] ──► finish
   finish: onChange(draft)   // same setter FlowConfigPanel/InputsTab already call
        └─► close wizard, stay on canvas
```

The deep copy guarantees **Cancel discards cleanly** — nothing mutates the live
graph until the user confirms on Review.

### Sensible defaults (Step 2 pre-fill)

When create mode starts, `defaults` is seeded with executor = Claude and a
default retry policy so Step 2 is a quick confirm rather than blank work.
**Primary:** extend `createBlankFlow()` to seed these. **Fallback** (if
`createBlankFlow()` must stay untouched): the wizard seeds them locally in
`wizard-state.ts`.

## Validation

Kept deliberately light — the wizard never blocks on things the canvas/publish
already check:

- **Step 1:** `name` required (create mode). Scope options filtered by role
  exactly as `NewFlowPage` does today (`user` always; `org` for admins;
  `global` for platform admins).
- **Step 2:** nothing required. Model / compute-target selectors reuse the
  existing sections, which already treat "none selected" as system default.
- **Step 3:** inline per-row warnings for empty or duplicate input names (the
  same check `InputsTab` already applies to attributes via `attrNameError`,
  extended to inputs). Invalid rows warn but do not hard-block — publish catches
  them again. An empty input list is valid.
- The wizard does **not** re-implement publish validation; that stays on the
  canvas.

## Edge cases

- **Skip to canvas with empty config** → flow created with a blank-ish
  definition; identical to today's behavior. No regression.
- **Re-open (edit mode) after the flow has nodes** → wizard only touches
  `defaults` / `inputDefs` / `attributeDefs`; nodes and edges pass through
  untouched on the deep-copy round-trip.
- **Removing an input a node references** → out of scope for the wizard; the
  existing `dangling-ref-node` save warning
  (`WorkflowSaveWarning`) surfaces it on save. The wizard does not silently
  rewrite node inputs.
- **Cancel in edit mode** → draft discarded, live graph unchanged (deep copy).
- **Upload-JSON path** from today's `NewFlowPage` → preserved as a "Start from
  JSON" choice on Step 1; if chosen, the uploaded graph seeds the draft and the
  user can still walk steps 2–3 over it.

## Testing

- `wizard-state.ts` — unit tests: step advancement gating; deep-copy isolation
  (editing draft does not mutate source); skip-finish produces a valid graph;
  edit-mode round-trip preserves nodes/edges.
- `CreateFlowWizard` — component tests (same harness as existing flow-editor
  tests): step navigation; create-mode finish calls `createFlow` once with the
  merged definition; edit-mode finish calls `onChange` with the patched graph;
  Cancel discards.
- No new API or DB work; no migration; no `@journeyman/core` changes.

## Files touched (anticipated)

| File | Change |
|------|--------|
| `packages/flow-editor/src/create-wizard/*` | New wizard component + steps + state |
| `packages/flow-editor/src/index.ts` | Export `CreateFlowWizard` |
| `packages/flow-editor/src/canvas/create-blank-flow.ts` (or equivalent) | Seed default `defaults` (primary option) |
| `packages/flow-editor/src/FlowEditor.tsx` | Remove `FlowConfigPanel` aside + `flowConfigOpen` state, remove `InputsTab` drawer + `inputsDrawerOpen` state; add single "Workflow setup" button opening the wizard in edit mode |
| `packages/flow-editor/src/<toolbar>.tsx` | Replace `onFlowConfig` / `onInputsClick` buttons+props with `onWorkflowSetup` |
| `packages/flow-editor/src/flow-config/FlowConfigPanel.tsx` | Deleted (or repurposed as the wizard `ConfigStep` body) — `Defaults*Section`s kept |
| `packages/web/src/routes/NewFlowPage.tsx` | Render `CreateFlowWizard` in create mode |
