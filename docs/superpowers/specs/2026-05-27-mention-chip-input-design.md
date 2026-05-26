# `@`-Mention Chip Input for Step Inputs

**Date:** 2026-05-27
**Status:** Approved (pending implementation plan)
**Related:** [upstream-sources-include-pause-nodes](2026-05-26-upstream-sources-include-pause-nodes-design.md), [join-mode-rename-and-picker](2026-05-26-join-mode-rename-and-picker-design.md)

## Problem

Binding a step input today means clicking a `{x}` button, browsing a two-pane popup (`ValuePicker`), and picking a field. It's slow, requires leaving the field, and doesn't match the inline-autocomplete pattern users expect from modern tools (Notion, Linear, Slack, Retool). For fields that mix literal text with a reference (e.g. `feature/${ref}`), the flow is even clunkier (type text, then click `{x}`, then "insert").

## Goal

Replace the `{x}`-button-and-popup interaction on **step input fields** (the `ConfigTab` panel) with an inline `@`-mention input: type `@` to open a fuzzy dropdown of reachable upstream fields, pick one, and it renders as a removable **chip** inline with any surrounding text.

## Non-Goals

- No change to `IoTab` freeform key→ref rows, `ControlNodeConfigTab` loop/timer expressions, or the if-else condition LHS. `ValuePicker` stays for all of those this round.
- No change to **number / boolean / enum** typed fields — they keep their existing controls; `@` applies only to string and bind-only fields.
- No change to runtime resolution, the `WorkflowInputValue` model, or storage schema.
- No deep-path enumeration into free-form `object` shapes (e.g. `payload.foo.bar`). The object itself is pickable; deeper paths are typed manually.

## Scope

Target surface: **`ConfigTab`** (`packages/flow-editor/src/properties-panel/ConfigTab.tsx`) — the panel shown when a step node is selected, covering:

- **Bind-only required fields** (the "Required bindings" section) — today pure `ValuePicker` → `{kind:"ref"}`.
- **String-typed config fields** — today a text input plus the `{x}` insert-template affordance.

Number / boolean / enum config fields are out of scope and keep their current typed controls.

## Design

### The chip input (`MentionInput`)

A `contenteditable` box that renders a field's current value as a mix of text nodes and chip elements. Behavior:

- **Typing `@`** opens a dropdown anchored at the caret, populated from the flattened upstream field list (see below). Characters typed after `@` fuzzy-filter the list. `Enter` / click inserts the highlighted field; `Esc` closes; clicking outside closes.
- **Insertion** replaces the typed `@query` with a chip carrying the field's full ref string.
- **Chip rendering**: a pill showing the source's friendly label, an `#<last6>` id suffix **only when** another reachable source shares the same display name (the "smart" id rule), the field path, and an `×` to delete. Backspace immediately before a chip deletes it.
- **Plain text** between/around chips is editable normally.

### Dropdown row format

Flat, fuzzy-filtered list. Each row: `<sourceLabel>[ #id] › <field.path> : <type>`. The `#id` segment appears only for duplicated source display names. Source order follows `useUpstreamSources` output (run-inputs first, then upstream nodes).

### Flattened field list (`mention-fields.ts`)

Pure helper: `toMentionFields(sources: UpstreamSource[]): MentionField[]`.

```ts
interface MentionField {
  ref: string;          // e.g. "humanTask_a1b2c3.output.approved" or "workflow.input.x"
  sourceId: string;     // node id, or "" for run-input
  sourceLabel: string;  // friendly display name
  showId: boolean;      // true when another source shares sourceLabel
  fieldPath: string;    // e.g. "output.approved"
  type?: string;        // leaf shape type when known
}
```

Rules:
- Walk each source's groups/fields. For object shapes with declared sub-fields, recurse into leaves (reusing the same flattening logic as `ValuePicker`/`ShapeTree`). For free-form objects (`fields: {}`), emit the object itself as one entry (no deeper recursion).
- `ref` is built the same way `ValuePicker.refForPath` builds it: `workflow.input.<path>` for run-input scope, `<sourceId>.input.<path>` / `<sourceId>.output.<path>` otherwise.
- `showId` is computed by counting `sourceLabel` occurrences across all sources; `true` when count > 1.

Unit-tested independently.

### Serialization (how the chip box maps to storage)

On every edit, `MentionInput` serializes its content to a list of segments (text + refs) and reports the canonical string and whether it is a single pure ref. `ConfigTab` then writes:

| Field content | Stored as |
|---|---|
| Exactly one chip, no other text/whitespace | `node.inputs[key] = { kind: "ref", ref }`; delete `node.config[key]` |
| Text mixed with one or more chips, or ≥2 chips | `node.config[key] = "<template with ${ref} placeholders>"`; delete `node.inputs[key]` |
| Plain text, no chips | `node.config[key] = "<text>"`; delete `node.inputs[key]` |
| Empty | delete both `node.inputs[key]` and `node.config[key]` |

This mirrors the existing `handlePick` (ref) and `handleInsert` (template) semantics — refs use `sanitizeRef`, templates embed `${ref}`. The template/`${...}` syntax is unchanged, so runtime resolution needs no changes.

### Initial render (storage → chip box)

When the panel opens, `MentionInput` builds its initial content from the field's stored value:
- `inputs[key].kind === "ref"` → a single chip for that ref.
- `config[key]` string → parse `${ref}` placeholders into chips, everything else into text.
- Neither → empty.

Chip labels are resolved by matching the ref against the `MentionField` list; a ref that no longer matches any reachable source (stale binding) renders as a chip showing the raw ref string (so the user can see and remove it).

## File map

- **New:** `packages/flow-editor/src/properties-panel/MentionInput.tsx` — contenteditable component (render, dropdown, chip insert/delete, serialize).
- **New:** `packages/flow-editor/src/properties-panel/mention-fields.ts` + `.test.ts` — pure flattening helper + `showId` computation.
- **New:** `packages/flow-editor/src/properties-panel/mention-serialize.ts` + `.test.ts` — pure functions: parse a stored value → segments, and segments → `{ template, soleRef }`. Kept separate from the React component so the tricky string logic is unit-testable without a DOM.
- **Modified:** `packages/flow-editor/src/properties-panel/ConfigTab.tsx` — replace the `{x}` button + `ValuePicker` popover for string/bind fields with `MentionInput`. Number/boolean/enum branches untouched.
- **Modified:** `packages/flow-editor/src/styles.css` — chip, dropdown, and contenteditable styles.

`ValuePicker.tsx` is **not** deleted — still used by IoTab, ControlNodeConfigTab, and the if-else inspector.

## Edge cases

- **Stale ref** (bound node deleted): chip shows the raw ref text, still removable.
- **Free-form object field** (`payload`): pickable as a whole; deeper paths typed by hand after insertion (plain text becomes part of the template).
- **Duplicate display names**: `showId` adds `#last6`; non-duplicated names stay clean.
- **Paste**: pasted text is inserted as plain text (no auto-chip-ification in v1).
- **Caret/backspace around chips**: chips are atomic — a single backspace deletes the whole chip, not a character of its label.
- **Read-only mode**: the box renders chips/text but is not editable and shows no dropdown.
- **Number/boolean/enum fields**: never mounted as `MentionInput`.

## Testing

- **Unit (`mention-fields.test.ts`)**: flattening of a source with declared leaves, nested object leaves, a free-form object, run-input scope; `showId` true only on duplicated labels; correct `ref` strings per scope.
- **Unit (`mention-serialize.test.ts`)**: parse `"feature/${a.output.x}"` → `[text, ref]`; serialize back; single-ref detection (`{a.output.x}` alone → `soleRef`); empty → empty; multiple refs → template; `sanitizeRef` applied.
- **Manual**: in `ConfigTab`, bind a field via `@` (single ref → stored as `inputs[key].ref`); build a `feature/${ref}` template (stored as `config[key]`); remove a chip; confirm a duplicated-name source shows `#id` and a unique one doesn't; confirm number/boolean/enum fields are unchanged; confirm the Join/pause-node sources appear in the `@` dropdown.

## Rollout

Single PR. No migration, no schema change, no feature flag. `ValuePicker` retained for non-targeted surfaces; a later round can migrate them.
