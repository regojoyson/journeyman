# Agent enabled/disabled state machine + Delete tab — Design

Date: 2026-06-20
Status: Approved (pending spec review)

## Goal

Make the agent detail view enforce a clear two-state lifecycle and move agent
deletion behind a confirmed, in-view tab.

1. **Run now** is only available when the agent is enabled.
2. When an agent is enabled, nothing about it can be modified (read-only).
3. Deletion moves off the agent list (where it currently fires with no
   confirmation) into a dedicated, confirmed tab inside the agent view.

## State machine

The agent's `enabled` flag drives one of two mutually-exclusive modes. The
existing `locked = a.enabled` derivation already expresses this.

| Capability        | Disabled (configure) | Enabled (live)        |
|-------------------|----------------------|-----------------------|
| Edit any field    | editable             | read-only (`locked`)  |
| **Save changes**  | enabled when dirty   | disabled              |
| **Run now**       | disabled + tooltip   | enabled               |
| **Enabled toggle**| turn ON (guarded)    | turn OFF (always)     |
| **Delete**        | available (confirmed)| blocked (disable first)|

Mental model: *configure while disabled → enable to lock it and go live → only
then can you run it.* Disabling returns to editing.

## Changes

### 1. Run now gating — `AgentDetail.tsx`

- `disabled={busy || !a.enabled}`.
- Wrap the button in a `<span title="Enable the agent to run it">` so the
  tooltip shows even while the button is disabled (browsers suppress `title`
  on disabled buttons). Set the `title` only when `!a.enabled`; otherwise no
  tooltip.

### 2. Enable-while-dirty guard — `AgentDetail.tsx` (`toggleEnable`)

- Only guard the **enabling** direction (`a.enabled === false`).
- If `dirty`, abort before the API call and surface the message
  *"Save your changes before enabling."* via the existing error line under the
  header (same location existing errors render). Do not call `agentsApi.enable`.
- **Disabling** (`a.enabled === true`) is never guarded — nothing to lose since
  the agent was locked.

### 3. Permissions read-only fix

Currently `PermissionsSection` accepts `locked` but ignores it, so tools stay
editable when the agent is enabled — a hole in rule #2.

- `ToolsPicker.tsx` — add an optional `disabled?: boolean` prop. When true,
  every tool checkbox is disabled (combined with the existing per-tool
  `disabledTools`). Backward-compatible; other call sites unaffected.
- `PermissionsSection.tsx` — consume its `locked` prop and pass
  `<ToolsPicker disabled={locked} … />`.

### 4. Remove delete from the agent list — `AgentsList.tsx`

- Remove the per-row **Delete** button (lines ~93–101) and its inline
  `agentsApi.remove(...)` + `refresh()` handler. Keep the **Open** button.
- The list no longer imports `btnDanger` if it becomes unused.

### 5. New Delete tab — `sections/DeleteSection.tsx` (new) + nav wiring

**Nav** — `SectionNav.tsx`:
- Extend `SectionId` with `"delete"`.
- Append `{ id: "delete", label: "Delete agent", icon: "🗑", danger: true }` to
  `SECTIONS` (add an optional `danger?: boolean` field to the array item type).
- Render `danger` items with destructive-colored text and a top separator
  (same `border-t` / `mt-2 pt-3` separator pattern `runs` already uses). The
  active state for a danger item uses a destructive-tinted background.

**Wiring** — `AgentDetail.tsx`:
- Add `{section === "delete" && <DeleteSection a={a} wsId={wsId} locked={locked} onDeleted={() => navigate(backTo)} />}`.

**DeleteSection** behavior:
- Props: `{ a: Agent; wsId: string; locked: boolean; onDeleted: () => void }`.
- Renders a "Danger zone" card explaining deletion is permanent and removes the
  agent and its run history.
- **Must disable first:** when `locked` (enabled), the confirm field and Delete
  button are disabled, with a hint: *"Disable the agent before deleting it."*
- **Type-to-confirm:** a text input; the **Delete agent** button stays disabled
  until the typed value exactly equals `a.name`. The button uses `btnDanger`
  styling (or a solid destructive button).
- On click: call `agentsApi.remove(wsId, a.id)`, then `onDeleted()` to navigate
  back to the agents list. Show any error inline; keep a `busy` guard during
  the request.

## Edge cases

- Already-enabled agent: Run now works; all fields, Save, and Delete are locked;
  toggle can disable. ✓
- Enable with no changes: enables normally. ✓
- Enable with unsaved changes: blocked + "Save your changes before enabling." ✓
- Navigate to Delete tab with unsaved edits: the existing `guarded()` section
  switch prompts to discard changes first (unchanged behavior). ✓
- Type-to-confirm mismatch: Delete button stays disabled. ✓
- Delete while enabled: button + field disabled with the disable-first hint. ✓
- `busy` (API in flight): Run now, toggle, and Delete stay disabled. ✓

## Testing notes

- Run now is disabled with the tooltip when `enabled === false`, enabled when
  `true`.
- `toggleEnable` does not call the enable API when dirty; shows the save-first
  message; still enables when clean; always disables.
- PermissionsSection `ToolsPicker` is non-interactive when `locked`.
- AgentsList renders no Delete button.
- DeleteSection: Delete disabled until name matches; disabled entirely when
  locked; calls `remove` then navigates on success.

## Out of scope

- Manual repo entry without a connection (separate prior decision).
- Any backend changes — `agentsApi.remove` already exists
  (`DELETE /api/workspaces/{wsId}/agents/{id}`).
- Soft-delete / undo. Deletion remains immediate once confirmed.
