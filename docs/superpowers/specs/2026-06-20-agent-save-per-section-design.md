# Agent Detail — Per-Section Save & Enable Validation Errors

**Date:** 2026-06-20
**Status:** Approved

## Summary

Two UX improvements to the Agent Detail view:

1. **Per-section save** — the single top-right "Save changes" button is removed. Each editable tab gets its own save footer that saves only that section's fields. The sidebar nav shows an amber dot on tabs with unsaved changes.
2. **Enable validation error banner** — when the server rejects an enable attempt with readiness errors, a red banner appears between the header and the card. Each error is a clickable link that jumps to the relevant tab.

---

## Feature 1: Per-Section Save

### Motivation

The current global "Save changes" button in the top-right header is confusing — it's not obvious that it saves all tabs at once, and users expect edits in one tab to be independent of edits in another.

### Behaviour

- Each editable section (Instructions, Workspace, Triggers, Behavior, Permissions, Notifications) gets a sticky footer bar at the bottom of the right panel.
- The footer shows `● Unsaved changes` and a `Save [Section]` button when that section has changes relative to the last saved state.
- The button is disabled when: the section has no changes, the agent is locked (enabled), or a save is in progress.
- Saving a section calls `PATCH /api/workspaces/:wsId/agents/:id` with **only that section's fields**. On success, `original` and `a` are merged for those fields only — preserving any in-flight edits in other sections.
- The sidebar nav shows an amber dot (●) on each section that has unsaved changes, so the user can see at a glance which tabs need saving.
- **Navigation guard** (`guarded()`) now checks only the **current section** for dirtiness (instead of the global dirty state). Switching tabs while the current section has unsaved changes shows: `"You have unsaved changes in this section. Discard them?"`
- Sections without a save action (Runs, Delete) show no footer.

### Field → Section Mapping

| Section | Agent fields owned |
|---|---|
| Instructions | `instructions`, `inputs` |
| Workspace & Model | `provider`, `model`, `sandboxId`, `repoSelections` |
| Triggers | `triggers` |
| Behavior | `behavior`, `limits`, `outputMode` |
| Permissions | `permissions` |
| Notifications | `notifications` |

### Layout Change

The right panel (`flex-1 p-6`) becomes a flex column:

```
┌─ sidebar ─┬─────────── right panel (flex col) ──────────────┐
│           │  scrollable section content (flex-1, overflow-y) │
│           ├─────────────────────────────────────────────────┤
│           │  save footer (shrink-0, border-t)               │
│           │  ● Unsaved changes    [Save Instructions]        │
└───────────┴─────────────────────────────────────────────────┘
```

The top header loses the Save button entirely; only Enable toggle and Run now remain.

---

## Feature 2: Enable Validation Error Banner

### Motivation

When the server rejects an enable attempt (HTTP 422), the current UI surfaces only the generic string `"not_ready"`. The API actually returns a structured `errors[]` array with field-specific messages. These need to be shown clearly so the user knows exactly what to fix.

### Behaviour

- Attempting to enable calls `POST /api/workspaces/:wsId/agents/:id/enable`.
- On 422 `{ error: "not_ready", errors: [{field, message}, ...] }`, the error banner is shown.
- The banner is positioned between the page header and the card (in the scrollable content area, above the locked banner if present).
- Each error item is rendered as: `[Section link] — message`. Clicking the link calls `selectSection(sectionId)`.
- The banner is cleared when: the enable succeeds, the disable toggle is toggled, or a new enable attempt begins.
- Other errors (network, 409, 5xx) continue to use the existing plain error text display.

### Field → Section Link Mapping

| Error field | Jumps to section |
|---|---|
| `name` | Instructions (name is not in a separate section) |
| `instructions` | Instructions |
| `inputs` | Instructions |
| `provider` | Workspace & Model |
| `model` | Workspace & Model |
| `sandbox` | Workspace & Model |
| `triggers` | Triggers |

### Banner Design

```
┌──────────────────────────────────────────────────────┐
│ ⚠ Can't enable — fix these issues first:             │
│   · Instructions & Inputs — Instructions are required │
│   · Workspace & Model — Choose a model               │
└──────────────────────────────────────────────────────┘
```

Red background (`bg-destructive/10`), red border, red text. Section names are underlined buttons.

---

## Code Changes

### `packages/web/src/components/agents/agent-form.ts`

Add:
- `SECTION_FIELDS: Partial<Record<SectionId, (keyof Agent)[]>>` — internal map of section → fields
- `isSectionDirty(original, current, section): boolean` — compares only that section's fields via `JSON.stringify`
- `buildSectionUpdateInput(a: Agent, section: SectionId): AgentUpdateInput` — extracts only that section's fields for the PATCH body

### `packages/web/src/api/agents.ts`

Add:
- `export interface ReadinessError { field: string; message: string }`

Change `enable()` from `fetch(...).then(jsonOrThrow<Agent>)` to a custom async function that:
- Returns the `Agent` on 2xx
- On 422 with `body.errors`, throws `Error` with `.readinessErrors: ReadinessError[]` attached
- On other errors, throws the same `Error(body.error ?? HTTP N)` as before

### `packages/web/src/components/agents/AgentDetail.tsx`

State changes:
- Add `saving: boolean` (section save in progress; separate from `busy` which covers enable/run)
- Add `readinessErrors: ReadinessError[] | null`
- Remove: `const dirty = isAgentDirty(original, a)`; replace with `const sectionDirty = isSectionDirty(original, a, section)`

Remove: global `save()` function; Save button from header JSX.

Add:
- `saveSection(sectionId: SectionId)` — calls `agentsApi.update()` with `buildSectionUpdateInput(a, sectionId)`; on success merges response into `original` and `a` for that section's fields only
- `FIELD_TO_SECTION: Record<string, SectionId>` — maps readiness error fields to section IDs
- Readiness error banner JSX (between header and card)
- `SectionSaveBar` — small inline component (not exported); renders the sticky footer for saveable sections
- Right panel refactored to flex column to accommodate the sticky footer

Update:
- `guarded()` — uses `sectionDirty` instead of global `dirty`
- `toggleEnable()` — clears `readinessErrors` at start; on catch, sets `readinessErrors` if `e.readinessErrors` exists, otherwise sets `error`

### `packages/web/src/components/agents/sections/SectionShell.tsx`

No changes required. The save footer lives outside the section components in `AgentDetail`'s panel wrapper.

### Individual section components

No changes required (InstructionsSection, WorkspaceSection, etc.).

---

## Out of Scope

- Autosave / save-on-navigate
- Undo/redo per section
- Any backend validation changes (readiness logic is already correct)
- Run History and Delete sections (no save action, no changes)
