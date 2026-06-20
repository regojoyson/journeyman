# Agent Sandbox Picker

**Date:** 2026-06-20
**Status:** Approved

## Problem

Agents have a `sandboxId` field in their data model (stored in the definition JSONB) but the
Workspace & Model section of the agent editor exposes no UI to set it. Users cannot choose which
execution environment an agent runs in.

## Scope

Frontend-only change. The backend already persists `sandboxId` through the existing `PATCH
/api/workspaces/:wsId/agents/:id` handler. No new API endpoints or migrations needed.

## Design

### Data flow

`AgentDetailPage` → `AgentDetail` → `WorkspaceSection`

`AgentDetail` already receives `orgId` as a prop (currently aliased `_orgId` and unused). Thread it
through to `WorkspaceSection` as a new required `orgId: string` prop.

### WorkspaceSection changes

**New prop:** `orgId: string` added to `SectionProps`.

**Fetch:** On mount (with `orgId` as dependency), call
`sandboxesApi.listVisible(orgId)` and store the result as `sandboxes: Sandbox[]`. Errors silently
produce an empty list (same pattern as `gitConnections`).

**UI:** Add a `<select>` using the existing `inputCls` style, placed between the Model picker and
the Git connection picker. Label: "Sandbox".

- First option: `"— auto (system default) —"` with value `""`.
- Remaining options: one per sandbox — display text `{sandbox.name} · {sandbox.type}`, value
  `sandbox.id`. Only show enabled sandboxes (`sandbox.enabled === true`).

**On change:** `patch({ sandboxId: value || undefined })` — the empty string maps to `undefined`
(clears the pin, restores auto-selection).

**Locked state:** `disabled={locked}`, matching all other fields in the section.

### Files changed

| File | Change |
|---|---|
| `packages/web/src/components/agents/AgentDetail.tsx` | Pass `orgId` (rename `_orgId` → `orgId`) to `WorkspaceSection` |
| `packages/web/src/components/agents/sections/WorkspaceSection.tsx` | Add `orgId` prop, fetch sandboxes, render sandbox `<select>` |

## Non-goals

- No sandbox type filtering (all enabled sandboxes shown regardless of type).
- No sandbox status indicator in the picker (name + type is sufficient).
- No workspace-scoped sandbox endpoint needed — org-level `listVisible` is the right set.
