# Webhook Wait — Accept-if field-path suggestions

**Date:** 2026-05-29
**Scope:** `packages/flow-editor` — `AcceptIfBuilder.tsx`

## Problem

In the webhook-wait step's "Accept if (optional)" builder, each rule's **field path**
input offers no autocomplete, even though the editor computes a list of suggestible
paths for it. Two defects combine:

1. `AcceptIfBuilder` receives a `knownPaths` prop (schema paths + paths already
   declared in the node's Outputs) but ignores it — destructured as `_knownPaths`.
2. The rule field inputs use `list={datalistId}` where `datalistId` is
   `acceptif-paths-${node.id}`, but **no `<datalist>` with that id is ever rendered**
   anywhere. The browser silently shows nothing.

By contrast, the Outputs `fromPath` input already works — it points at the rendered
`webhook-paths-${node.id}` datalist (populated from the webhook's payload schema). Out
of scope for this change; left as-is.

These are all **payload-path** fields — dot/JSON paths into the incoming event (e.g.
`$.action`) — the same vocabulary as Outputs. They are not workflow `@`-mentions, so
the native datalist approach (consistent with Outputs) is the right tool, not
`MentionInput`.

## Design

One file changes: `packages/flow-editor/src/properties-panel/AcceptIfBuilder.tsx`. No
type changes, no editor changes, no backend.

1. **Use the prop.** Change the component signature from
   `{ value, knownPaths: _knownPaths, readOnly, onChange, datalistId }` to
   `{ value, knownPaths, readOnly, onChange, datalistId }`.

2. **Render the missing datalist.** Inside the builder's root `<div className="je-acceptif">`,
   render one `<datalist id={datalistId}>` with an `<option value={p}>` for each entry
   in `knownPaths`. `knownPaths` is already de-duplicated by the editor
   (`Array.from(new Set([...]))`), so no extra dedup is needed.

3. **No other changes.** The rule `field` inputs keep `list={datalistId}`; it now
   resolves to a real, populated datalist, so suggestions appear as the user types.
   The comparison-value input, operator select, value-type select, JSON/advanced mode,
   and `deriveInitial` are untouched.

### Suggestion source (unchanged, for reference)

The editor builds `knownPaths` in `WebhookWaitConfigEditor.tsx` as the union of:
- `suggestedPaths` — paths from the selected webhook's payload schema, and
- each Output row's `fromPath` (trimmed, non-empty).

So Accept-if suggests both raw event paths and paths the user has already extracted as
outputs. When no webhook is selected, `knownPaths` is empty and the datalist renders no
options — identical, expected behavior to Outputs today.

## Out of scope

- Outputs `fromPath` field (already works — no change).
- The comparison-value input (stays a free literal).
- Any new typeahead component, `MentionInput` usage, type changes, or backend changes.

## Verification

`npm run check` (typecheck + import boundaries). Manual: open a webhook-wait node with
a webhook selected, add an Accept-if condition, focus the field-path input, and confirm
payload-schema paths (and any declared output paths) are suggested.
