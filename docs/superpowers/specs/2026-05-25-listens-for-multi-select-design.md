# "Listens for" Multi-Select — Design

**Date:** 2026-05-25
**Status:** Draft (approved direction; ready for implementation plan)
**Related:** [2026-05-25 Webhook Management](2026-05-25-webhook-management-design.md)

## Problem

The webhook-wait node's `Listens for` field is currently a plain text input where the author types comma-separated event type strings. Two issues:

1. **No discovery.** Authors have to know the provider's event-type vocabulary (e.g. `pull_request`, `pull_request_review`, `workflow_run`) and type each one with the exact spelling. Typos silently produce a filter that never matches.
2. **Mixed display + input mode.** The same control shows the comma-joined string and accepts edits, so backspacing into a chip means deleting characters mid-token. Adding/removing is fiddly.

The picked webhook already exposes `knownEventTypes` from its preset — this should drive a proper multi-select.

## Decision

Replace the comma-separated text input with a **chip multi-select**:

- Selected event types render as removable chips above the control.
- A small **+ Add event type** dropdown lists remaining preset event types plus a `Custom…` entry.
- Empty chip set keeps the current semantics — accept any event type.
- Custom-added entries (not in the preset) persist as chips, so providers' newer event types stay editable.

## Out of scope

- **Searching/filtering the dropdown.** Preset event-type lists are short (≤30); a flat list is fine.
- **Reordering chips.** Order is presentation only — matching is set-based.
- **Per-event-type metadata** (descriptions, deprecation flags). The preset doesn't carry these; YAGNI.
- **Replacing the input on other config fields** (`correlationKey`, `outputs.fromPath`, etc.). Out of scope; this design only touches `listensFor`.

## UI behavior

| User action | Result |
|---|---|
| Click chip's × | Remove that event type from `cfg.listensFor` |
| Pick from the dropdown | Append to `cfg.listensFor`; dropdown resets to its placeholder; selected item disappears from the dropdown's remaining list |
| Pick "Custom event type…" | Inline text input replaces the dropdown; pressing Enter or clicking ✓ adds the typed value as a chip; Esc cancels |
| No webhook picked yet | Dropdown is disabled; hint reads "Pick a webhook above to see available event types." |
| `listensFor` is `[]` or undefined | Render placeholder text "(no filters — accepts any event type)" inside the chip row |

Selections persist into `node.config.listensFor: string[]` exactly as today — no shape change.

## Component layout

```
Listens for
┌───────────────────────────────────────────────────────┐
│ [pull_request ×] [push ×] [issues ×]                  │   ← chip row (or placeholder)
└───────────────────────────────────────────────────────┘
[ ▼ + Add event type ]                                       ← select dropdown
```

When "Custom event type…" is chosen, the dropdown swaps to:

```
[ pull_request_comment           ] [ ✓ ] [ × ]
```

## Where it lives

Lives inline in `packages/flow-editor/src/properties-panel/WebhookWaitConfigEditor.tsx` as a small sub-component `ListensForPicker`. No new package file — it's tightly coupled to the parent's state shape and the parent is already this file's whole job.

Approx 70 lines of new JSX/state. No CSS additions beyond existing `je-*` classes plus a few inline styles for the chips (consistent with how `je-row` is rendered elsewhere).

## Inputs / outputs

```ts
interface ListensForPickerProps {
  /** Event types the author has selected so far. */
  value: string[];
  /** Event types known by the picked preset. May be empty. */
  knownEventTypes: string[];
  /** Whether a webhook has been picked. When false, the picker is disabled. */
  webhookPicked: boolean;
  /** Read-only mode propagated from the parent properties panel. */
  readOnly?: boolean;
  onChange: (next: string[]) => void;
}
```

No props for "custom event types from the preset author" — preset event types are static at load time.

## Empty preset event-types handling

For the `generic` preset (or any preset whose `knownEventTypes` is empty), the dropdown's preset section is empty — only the **Custom event type…** option appears. Authors can still add freeform values; the picker doesn't insist on a non-empty preset list.

## Behavior preservation

- `node.config.listensFor` schema: still `string[]`, optional, empty/undefined means "any".
- The conductor converter's input shape: unchanged.
- The match service's filter logic: unchanged (it already reads `listensFor` as a string array).

## Acceptance criteria

- Selected event types render as chips in `WebhookWaitConfigEditor`.
- Picking from the dropdown appends to `cfg.listensFor`; clicking a chip's × removes it.
- "Custom event type…" lets the author add a value not in the preset's `knownEventTypes`.
- When no webhook is picked, the picker is disabled with a helpful hint.
- When the preset has no `knownEventTypes`, the picker still works (only Custom is offered).
- The current emptiness-means-any semantics are preserved.
- `npm run check` passes.

## Verification

`npm run check` is the gate. Manual smoke: drop a webhook-wait node into a flow, pick a GitHub webhook, verify chip add/remove and Custom flow work, save the flow, reopen, confirm chips reload from the persisted `listensFor` array.
