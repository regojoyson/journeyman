# Webhook Wait — Correlation editor clarity & suggestions

**Date:** 2026-05-29
**Scope:** `packages/flow-editor` — Correlation section of `WebhookWaitConfigEditor.tsx`

## Problem

The Correlation section of the webhook-wait step is confusing. It shows two plain
text inputs ("Event path" and "Equals") under one paragraph of help text, and users
don't understand what to put in each. Two concrete defects make it worse:

1. The **Event path** input's autocomplete (`list`) is mis-wired — it points at the
   Accept-if datalist (`acceptif-paths-${node.id}`) instead of the webhook
   payload-paths datalist, so it suggests the wrong (or no) values.
2. The **Equals** input is a raw template box (`{{ inputs.ticketId }}`) with no
   field picker, even though the rest of the editor uses the `@`-mention
   `MentionInput` for exactly this kind of value.

## What the two fields mean

Correlation answers: *"when an event arrives, which paused run does it belong to?"*
It compares **one value from the incoming event** to **one value from this run**:

- **Event field** — a JSONPath into the incoming webhook payload, e.g.
  `$.pull_request.number`. Its suggestions come from the selected webhook's payload
  schema.
- **Value from this run** — a template resolved from the paused workflow instance
  (run inputs / upstream node outputs), e.g. the ticket ID. This is exactly what
  `MentionInput` + `useUpstreamSources` already provide elsewhere.

If the two resolved values are equal, the run resumes.

## Design

One component changes: the Correlation `je-field` block (currently lines 116–158 of
`WebhookWaitConfigEditor.tsx`). No core types, no backend, no data-model change.

### 1. Clearer copy

Replace the single paragraph with a one-sentence explanation plus a micro-label on
each input so it reads like a sentence:

> **Correlation**
> When an event arrives, Journeyman matches it to a paused run by comparing one value
> from the **incoming event** to one value from **this run**. If they're equal, the
> run resumes.

- Sub-label above input 1: **Event field** — *path into the incoming webhook payload*
- The connector word **equals** between the two inputs
- Sub-label above input 2: **Value from this run** — *type `@` to insert a field*

### 2. Event path field — fix the datalist

Keep the plain `<input>`, but point its `list` at the webhook payload-paths datalist
that is already populated from `suggestedPaths` (the `webhook-paths-${node.id}`
datalist rendered in the Outputs section). When no webhook is selected, show a hint:
"Pick a webhook above to get path suggestions." No new component.

Note: the payload-paths `<datalist>` currently lives inside the Outputs `je-field`.
Either reference its existing id, or hoist the `<datalist>` so both the Event-path
and Outputs inputs can share it — implementer's choice, as long as both inputs get
the suggestions.

### 3. Equals field — swap to `MentionInput`

Replace the plain `<input>` with `MentionInput`, wired like `ConfigTab`:

- `fields`: `toMentionFields(useUpstreamSources(node))`.
- `value`: `parseTemplate(template)` → `Segment[]`, where `template` is read from
  `correlationKey.value` (template kind → its `template`; literal kind → `String(value)`).
- `onChange(segments)`: `segmentsToTemplate(segments)` → store as
  `{ kind: "template", template }` in `correlationKey.value`.
- `expected`: omitted — the event value's type is unknown, so no incompatibility
  dimming.
- `readOnly`: pass through.
- `placeholder`: e.g. `Value from this run (type @)`.

### 4. Backward compatibility

`CorrelationKey` stays `{ eventPath: string; value: WorkflowInputValue }`. Existing
nodes with `literal` or `template` values still render: literals surface as their
string text in the mention input, edits re-save as `template`. No migration needed.

## Out of scope

- No typeahead/dropdown component for the Event path field (native datalist is enough).
- No type-checking/dimming on the Equals field.
- No changes to `CorrelationKey`, the worker matcher, or any backend.

## Verification

`npm run check` (typecheck + import boundaries). Manual: open a webhook-wait node,
confirm Event-path suggestions reflect the selected webhook's schema and the Equals
field shows the `@` picker with upstream fields.
