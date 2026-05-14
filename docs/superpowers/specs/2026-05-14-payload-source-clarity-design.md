# Human-Task: "Payload source" Clarity Pass

## Problem

In the Human Task properties panel, two different namespaces sit next to each other without explanation:

- **Output name** — the identifier used inside the flow (downstream nodes reference `<nodeId>.<name>`).
- **fromPath** — a dot-path into the incoming webhook payload, used both for auto-fill on outputs *and* implicitly by the Accept-if field input.

Today these look like equal peers: same column width, same input style, no headers, vague placeholder ("webhook path (optional)"). Users (non-developers) can't tell which side of the bridge they're on. The visual rule builder for Accept-if shows payload **paths**, while the output rows show **names**, with no signal that these are different worlds connected by `fromPath`.

## Goals

1. Make the two namespaces visually distinct without renaming the data model.
2. Give every input a clear, plain-English header and tooltip.
3. Adopt a single user-facing term for "dot-path into the payload": **Payload source**.

## Non-goals

- Renaming the TypeScript property `fromPath` (would force flow-definition migrations).
- Renaming the JSONLogic `var` semantics.
- Inline "path → name" hints in the Accept-if field dropdown (option d from the brainstorm).
- A two-column visual divider in the Outputs row (option c).

## Solution

### Outputs section: column-header row

Add a small, non-interactive row above the existing output rows. It mirrors the existing flex layout so headers align with their columns.

Columns:

| Header | Column it labels |
|---|---|
| Name | the name input (`flex: 1`) |
| Type | the type select |
| Req | the required checkbox |
| Payload source | the `fromPath` input (`flex: 2`) |
| (blank) | the delete button |

Each header has a `title` attribute serving as a tooltip:

- **Name** — *"How downstream nodes will reference this output (e.g. `human-task_X.<name>`)."*
- **Type** — *"Value type — controls how the form input renders and how the value is coerced."*
- **Req** — *"If checked, manual resolution must fill this field."*
- **Payload source** — *"Optional dot-path into the incoming webhook payload. When a webhook resolves this task, the value at this path becomes the output's value."*

The header row is small (10px font, muted color) — informational, not interactive.

### Outputs section: hint paragraph

Below the existing introductory hint (`Fields this human-task produces. Each becomes <code>{node.id}.&lt;name&gt;</code> for downstream nodes.`), append one new sentence:

> *"The Payload source column is where webhook auto-fill reads from — it's the same kind of path you'd use in Accept-if below."*

This explicitly bridges the two sections.

### Outputs row: placeholder + title

Change the `fromPath` input:

- placeholder: `e.g. issue.fields.status.name` (today: `webhook path (optional)`)
- title: `Dot-path into the incoming webhook payload. The matcher reads this to fill the output automatically.` (today: `Dot-path into the webhook payload to auto-fill this field`)

The new placeholder is concrete; the new title uses the same vocabulary as the column header.

### Accept-if builder: field input placeholder + title

Change the field input inside `.je-acceptif__rule`:

- placeholder: `field path in payload` (today: `field path`)
- title: `Dot-path into the incoming webhook payload (same vocabulary as "Payload source" on outputs).`

This is the explicit cross-reference back to the Outputs section.

### CSS

One new class: `.je-humantask__output-header`. Same flex layout as `.je-humantask__output-row`, but no background, no padding, smaller muted text, and the children are `<span>`s sized to match each input's flex value.

```css
.je-humantask__output-header {
  display: flex; align-items: center; gap: 6px;
  font-size: 10px; color: #888;
  text-transform: uppercase; letter-spacing: 0.04em;
  padding: 0 4px;
  margin-bottom: 2px;
}
.je-humantask__output-header > span { white-space: nowrap; }
.je-humantask__output-header > span.spacer-name { flex: 1; }
.je-humantask__output-header > span.spacer-payload { flex: 2; }
```

## What we are NOT changing

- The data model. `HumanTaskOutputCfg.fromPath` keeps that name in TypeScript, in the saved flow JSON, in the matcher, in the docs.
- The Accept-if builder's behavior or storage. Only the placeholder/title text on its field input.
- Any existing keyboard or mouse behavior.

## Risks

- **Inconsistency between code term (`fromPath`) and UI term ("Payload source")** is the main risk. Mitigation: this is a UI-clarity change for non-developer users, who never see the code. Developers reading the spec or the code see `fromPath` consistently. The Risks section of this spec is itself a reference point for any future contributor surprised by the mismatch.
- **Translation creep** if "Payload source" ever needs i18n — we accept the same cost as every other UI string.

## Testing

No unit tests — pure presentational. Manual verification:

1. Open a Human Task node in the flow editor.
2. Confirm the Outputs section shows a column-header row above the output rows. Headers align with their inputs.
3. Hover each header — confirm tooltip text.
4. Confirm `fromPath` input shows the new placeholder when empty.
5. Confirm Accept-if's field input shows `field path in payload` placeholder.
6. Confirm the new sentence appears below the introductory hint.

## Files touched

| File | Change |
|---|---|
| `packages/flow-editor/src/properties-panel/ControlNodeConfigTab.tsx` | Add header row JSX above `outputs.map(...)`; update placeholder + title on `fromPath` input; append hint sentence |
| `packages/flow-editor/src/properties-panel/AcceptIfBuilder.tsx` | Update placeholder + title on the field input |
| `packages/flow-editor/src/styles.css` | Append `.je-humantask__output-header` rules |
