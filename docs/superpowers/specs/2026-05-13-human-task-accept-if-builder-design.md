# Human-Task "Accept if" — Visual Rule Builder

## Problem

The Human Task node's **Accept if** field (in the flow editor's properties panel) is a raw JSONLogic textarea. Non-developer users — the people who actually configure these gates — can't author JSONLogic by hand. Today the placeholder shows `{"==": [{"var": "issue.fields.status.name"}, "Done"]}` and there is no guidance, validation, or escape hatch short of pasting JSON.

The data model (JSONLogic, evaluated server-side) is fine. The editing surface is the gap.

## Goals

1. Let a non-developer build the most common acceptance rules without seeing JSON.
2. Keep the existing JSONLogic data contract — no schema, evaluator, or type changes.
3. Preserve full JSONLogic power for advanced users via an explicit escape hatch.
4. Make use of context already present (the node's declared `fromPath` values) to reduce free-text fishing for field paths.

## Non-goals (v2 candidates)

- Nested groups / arbitrary parenthesization.
- Custom JSONLogic operators (regex, starts-with, ends-with).
- Webhook payload sampling for value/path autocomplete.
- i18n of operator labels.
- Backend changes of any kind.

## Solution overview

Replace the textarea with a new component `AcceptIfBuilder`. It owns its draft state and emits a JSONLogic value via `onChange(value: unknown | undefined)` — the same contract the parent expects today. It has two modes:

- **Visual** — a flat list of conditions, combined with All/Any (AND/OR).
- **JSON** — today's raw textarea, retained as an escape hatch.

The component lives at `packages/flow-editor/src/properties-panel/AcceptIfBuilder.tsx` and replaces the inline textarea block at `ControlNodeConfigTab.tsx:291-315`.

## Component contract

```ts
type AcceptIfBuilderProps = {
  value: unknown | undefined;          // current cfg.acceptIf
  knownPaths: string[];                // non-empty fromPath values from this node's outputs
  readOnly?: boolean;
  onChange: (value: unknown | undefined) => void;
};
```

No other props. No global state. No backend calls.

## Internal state

```ts
type Operator =
  | "eq" | "neq"
  | "in" | "nin"
  | "contains"
  | "empty" | "notEmpty"
  | "gt" | "lt";

type Rule = {
  field: string;                                  // dot-path
  op: Operator;
  value?: string;                                 // raw text from input
  valueType?: "string" | "number" | "boolean";   // override for eq/neq
};

type BuilderState = {
  combinator: "and" | "or";
  rules: Rule[];
};

type Mode = "builder" | "advanced";
```

## Mode behavior

**On mount:** detect mode from `value`.
- `undefined` / empty → `builder` with empty rule list.
- Parses cleanly into `BuilderState` via `jsonLogicToRules` → `builder` with that state.
- Anything else → `advanced` with serialized JSON shown.

**Switching `builder → advanced`:** serialize current rules with `rulesToJsonLogic`, render as pretty-printed JSON in the textarea.

**Switching `advanced → builder`:** parse current textarea via `jsonLogicToRules`. If parse succeeds, switch and load the state. If parse fails, stay in advanced and show an inline note: *"This expression is too complex for the visual builder. Edit as JSON or clear to use the builder."*

## Operator set

Nine operators. Each maps to standard JSONLogic — no custom backend operators required.

| Label              | Internal     | JSONLogic emitted                                     | Has value field |
|--------------------|--------------|-------------------------------------------------------|-----------------|
| equals             | `eq`         | `{"==": [{"var": F}, V]}`                             | yes             |
| does not equal     | `neq`        | `{"!=": [{"var": F}, V]}`                             | yes             |
| is one of          | `in`         | `{"in": [{"var": F}, [V1, V2, ...]]}`                 | yes (CSV)       |
| is not one of      | `nin`        | `{"!": {"in": [{"var": F}, [V1, V2, ...]]}}`          | yes (CSV)       |
| contains text      | `contains`   | `{"in": [V, {"var": F}]}`                             | yes             |
| is empty           | `empty`      | `{"!": {"var": F}}`                                   | no              |
| is not empty       | `notEmpty`   | `{"!!": {"var": F}}`                                  | no              |
| greater than       | `gt`         | `{">": [{"var": F}, V]}`                              | yes (numeric)   |
| less than          | `lt`         | `{"<": [{"var": F}, V]}`                              | yes (numeric)   |

## Value coercion (at serialize time)

- `gt` / `lt`: `Number(value)`. UI validates numeric input before serializing.
- `eq` / `neq`: string by default. A small adjacent toggle exposes "as number" / "as boolean" to override `valueType`.
- `in` / `nin`: split value on `,`, trim, drop empties → array of strings (or numbers if every entry parses).
- `contains`: always string.
- `empty` / `notEmpty`: no value field rendered.

## JSONLogic serialization

`rulesToJsonLogic(state: BuilderState): unknown | undefined`

- 0 valid rules → `undefined` (parent clears `acceptIf`).
- 1 valid rule → emit that rule directly (no `and` / `or` wrapper).
- 2+ valid rules → `{ [state.combinator]: [rule1, rule2, ...] }`.

A rule is "valid" when:
- `field` is non-empty.
- For value-bearing ops, `value` is non-empty.
- For `gt` / `lt`, `Number(value)` is finite.
- For `in` / `nin`, at least one CSV entry remains after trim.

Invalid rules are skipped during serialization. They remain visible in the UI with red-border / inline hint so the user can fix them.

## Parsing

`jsonLogicToRules(value: unknown): BuilderState | null`

Returns a `BuilderState` if `value` matches one of the shapes the builder can emit; `null` otherwise.

Recognized shapes:
- A single rule object matching one of the table rows above → `{ combinator: "and", rules: [parsed] }`.
- `{ "and": [<rule>, ...] }` or `{ "or": [<rule>, ...] }` where every element parses as a rule → use the matching combinator.
- Anything else (nested combinators, unknown operators, mixed shapes) → `null`.

The function never partially parses — either the whole expression round-trips, or it returns `null` and the user stays in JSON mode.

## Field-path autocomplete

The parent (`ControlNodeConfigTab`) passes `knownPaths` — the non-empty `fromPath` values from the node's `outputs` array. The field input is:

```tsx
<input list={`acceptif-paths-${nodeId}`} ... />
<datalist id={`acceptif-paths-${nodeId}`}>
  {knownPaths.map(p => <option key={p} value={p} />)}
</datalist>
```

Free text is still allowed — the datalist is suggestions, not validation.

## UI layout (Visual mode)

```
┌─ Accept if (optional) ──────────────────── [ Visual | JSON ] ─┐
│                                                                │
│  Match  [All ▾]  of the following:                             │
│                                                                │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │ [issue.fields.status.name ▾] [equals ▾] [Done]       [×] │ │
│  └──────────────────────────────────────────────────────────┘ │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │ [review.state ▾]             [is one of ▾] [approved,…] [×] │
│  └──────────────────────────────────────────────────────────┘ │
│                                                                │
│  [ + Add condition ]                                           │
│                                                                │
│  Filter incoming webhooks by payload values.                   │
└────────────────────────────────────────────────────────────────┘
```

In Advanced mode the body is replaced by today's textarea with the existing parse-error inline hint.

## CSS classes

Minimal, scoped to the new file:

- `.je-acceptif` — wrapper.
- `.je-acceptif__header` — top row (label + mode toggle on the right).
- `.je-acceptif__combinator` — "Match [All/Any] of the following" row.
- `.je-acceptif__rule` — flex row: field / op / value / delete.
- `.je-acceptif__rule--invalid` — red-border state.
- `.je-acceptif__addbtn` — "+ Add condition" button (reuses `.je-humantask__btn` styling).
- `.je-acceptif__advanced` — textarea wrapper.

Form-control colors and focus rings come from the existing `.je-humantask input[type="text"]`/`select`/`textarea` rules. The width fix shipped for `.je-humantask__output-row` is scoped to that class, so the new `.je-acceptif__rule` needs the same override:

```css
.je-acceptif__rule > input[type="text"],
.je-acceptif__rule > select {
  width: auto;
  min-width: 0;
}
```

Without this, the field/value inputs would collapse for the same flex-vs-`width:100%` reason that broke the Outputs row.

## Validation in the UI

- Empty field → red border, hint *"Pick a field"*.
- Non-numeric value with `gt`/`lt` → red border, hint *"Must be a number"*.
- Empty CSV with `in`/`nin` → red border, hint *"Enter at least one value"*.
- A rule with errors is skipped from the emitted JSONLogic but is still drawn so the user can fix it. If every rule is invalid, the component emits `undefined`.

## Read-only mode

When `readOnly` is true:
- Inputs/selects rendered as plain text.
- No `+ Add`, no `×`, no mode toggle (locks to whichever mode opened).

## Migration

No data migration. Existing `cfg.acceptIf` values are JSONLogic objects in the flow definition; the new component either parses them into Visual mode or shows them in Advanced mode. Both flows produce identical JSONLogic output, so a flow saved before this change continues to evaluate the same way.

## Testing

Unit tests on the pure functions only — colocated as `AcceptIfBuilder.test.ts`.

`rulesToJsonLogic`:
- Empty → `undefined`.
- Single rule of each operator → expected JSONLogic shape.
- Two rules with AND / OR.
- Numeric coercion for `gt`/`lt`.
- CSV split for `in`/`nin`.
- `valueType: "number"` / `"boolean"` overrides on `eq`/`neq`.

`jsonLogicToRules`:
- Each operator's emitted shape round-trips (serialize → parse → serialize identity).
- Unknown operator → `null`.
- Nested `and`/`or` → `null`.
- Single-rule shape (no wrapper) → parses with combinator `"and"`.

No component-level integration tests in v1. The component is mechanical; the pure functions hold the load-bearing logic.

## Files touched

- **New** `packages/flow-editor/src/properties-panel/AcceptIfBuilder.tsx` — component.
- **New** `packages/flow-editor/src/properties-panel/AcceptIfBuilder.logic.ts` — `rulesToJsonLogic`, `jsonLogicToRules`, operator metadata.
- **New** `packages/flow-editor/src/properties-panel/AcceptIfBuilder.test.ts` — unit tests on the logic module.
- **Modified** `packages/flow-editor/src/properties-panel/ControlNodeConfigTab.tsx` — drop the textarea block (lines 291-315), render `<AcceptIfBuilder>` with `knownPaths` derived from `cfg.outputs`. Remove the now-unused `acceptIfDraft`/`acceptIfError` state.
- **Modified** `packages/flow-editor/src/styles.css` — append `.je-acceptif__*` rules.

## Risks & open questions

- **JSONLogic substring is case-sensitive.** `contains text` will only match exact case. Documented in the inline hint; case-insensitive matching is v2.
- **`is one of` value type ambiguity.** If a user lists `1, 2, 3` and the payload has numbers, the all-strings list won't match. Mitigation: at serialize time, if every CSV entry parses to a finite number, emit numbers. This is a small judgment call inside `rulesToJsonLogic`.
- **JSON-mode round-trip.** A user who builds rules visually, switches to JSON, makes a small JSONLogic change the builder still understands, and switches back, should land in Visual with their edit preserved. Covered by the parser's round-trip guarantee for in-bounds shapes.
