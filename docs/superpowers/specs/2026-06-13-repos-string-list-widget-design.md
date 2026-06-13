# String-List Rows Editor (Repos field) — Design

**Date:** 2026-06-13
**Status:** Approved (design)
**Area:** flow-editor properties panel input editor; Clone Repos step config

## Problem

The Clone Repos step's `repos` field is a config field with `widget: "textarea"`
(`packages/steps/src/git/clone-repos.tsx`). After the recent change that routes
text/textarea config fields through the shared `InputValueEditor`, its Value mode
renders a single multi-line text block ("one owner/repo per line"). Users find
that block confusing — it's not obvious it's a list, and there's no discrete
add/remove affordance.

The runtime already treats repos as a list: `parseRepoList`
(`packages/core/src/parse-repo-list.ts`) splits on newlines/commas and also
accepts a real `string[]`, and `cloneReposInputFields.repos` is declared as
`{ type: "array", items: { type: "string" } }`. So the value *is* a list — only
the editing UI is a block.

## Goal

Give list-style config fields a **rows editor**: each entry on its own row with a
`+ Add` button to append and a `×` to remove. Apply it to `repos`. Keep the
`@ Reference` tab so the whole list can still be bound to an upstream array.

## Decisions (from brainstorming)

| Question | Decision |
|---|---|
| Per-row capability | Plain typed rows only (`+` / `×`). No per-row `@reference`. |
| Whole-list `@ Reference` | **Kept** — Value mode = rows; @ Reference = bind whole array. |
| How it's triggered | **Explicit** `widget: "string-list"` on the field (not inferred from shape). |
| Storage | Unchanged — newline-joined string in `config.repos`. No schema/runtime change. |

## Non-Goals

- No per-row references and no mixing typed + referenced rows (single `@ Reference`
  binds the entire list).
- No row reordering / drag-and-drop in v1.
- No change to `parseRepoList`, the config schema (`z.string().min(1)`), or the
  step summary (still counts non-empty lines).

## Approach

Add a new field widget `"string-list"`. In the properties panel, a `string-list`
field renders through the existing `InputValueEditor` (so it keeps the
`Value | @ Reference` tabs + help icon), with one addition: when in **Value**
mode, it renders a new `StringListEditor` (rows) instead of the string mention
input. The rows editor reads/writes a **newline-joined string**, stored as a
`{ kind: "literal" }` config value exactly as today — so nothing downstream
changes. `@ Reference` mode is unchanged (binds the whole field to an upstream
array; the picker dims non-list sources via the existing shape-compatibility
check).

## Components & data flow

```
clone-repos.tsx: repos widget "textarea" → "string-list"
        │
ConfigTab.renderMentionField(key, meta)
   widget === "string-list"  →  <InputValueEditor valueListMode expected={array<string>} … />
        │
InputValueEditor
   mode === "value"  &&  valueListMode   →  <StringListEditor value={literalString} onChange=… />
   mode === "reference"                  →  <MentionInput …/>  (unchanged)
        │
StringListEditor  (rows ↔ newline-joined string)
   onChange(string)  →  InputValueEditor emits { kind:"literal", value:string }  (or undefined)
        │
ConfigTab.commitInputValue  →  config.repos = string   (ref → node.inputs, as today)
```

### a) Field widget type

`packages/flow-editor/src/step-definition.ts` — add `"string-list"` to the
`FieldMeta.widget` union. `SchemaForm`'s `FieldInput` needs no new case (the
`renderFieldInput` override handles it; its `default` text fallback is harmless).

### b) `StringListEditor` (new)

`packages/flow-editor/src/properties-panel/StringListEditor.tsx`

- Props: `{ value: string; readOnly?: boolean; placeholder?: string; onChange: (next: string) => void }`.
- Renders one text input per row (rows derived from `value` split on `\n`), each
  with a `×` remove button, then a `+ Add repo` button.
- Empty value → one blank row. Removing the last row clears it (never zero rows).
- Pure helpers (exported for tests):
  - `splitRows(value: string): string[]` — split on `\n`; if empty → `[""]`.
  - `joinRows(rows: string[]): string` — trim, drop empty, join with `\n`.

### c) `InputValueEditor` — `valueListMode`

`packages/flow-editor/src/properties-panel/InputValueEditor.tsx`

- New optional prop `valueListMode?: boolean`.
- When `valueListMode && mode === "value"`: render `StringListEditor` seeded from
  the current literal string (`value?.kind === "literal" ? String(value.value) : ""`),
  and on change emit `{ kind: "literal", value: joined }` (or `undefined` when
  empty). All other modes/widgets unchanged.
- `@ Reference` mode unchanged — `expected` (array<string>) still gates the picker.

### d) ConfigTab routing

`packages/flow-editor/src/properties-panel/ConfigTab.tsx` — in
`renderMentionField`, before the text/textarea branch: if
`meta.widget === "string-list"`, return
`<InputValueEditor value={inputValueForField(key)} expected={expectedForKey(key)} fields={mentionFields} valueListMode readOnly={readOnly} onChange={next => commitInputValue(key, next)} />`.
`expectedForKey(repos)` resolves to `array<string>` (from `inputFields`), which is
what the `@ Reference` picker should match against.

### e) Clone Repos step

`packages/steps/src/git/clone-repos.tsx` — change
`repos: { …, widget: "textarea" }` → `widget: "string-list"`. No other step change;
summary already counts lines.

## Edge cases

- All rows blank → literal `undefined` → `config.repos` removed → existing
  `z.string().min(1)` validation flags "Repos required" (unchanged behavior).
- A row containing commas (`a,b`) still works — `parseRepoList` splits commas too.
- Switching Value → @ Reference clears the typed value and binds a ref (existing
  mode-switch behavior); switching back starts fresh rows.
- Long URLs: row inputs are full-width and wrap within the panel.

## Testing

- **Unit (`StringListEditor.test.ts`):** `splitRows("a\nb") → ["a","b"]`,
  `splitRows("") → [""]`; `joinRows(["a","","b "]) → "a\nb"`,
  `joinRows(["",""]) → ""`.
- **Typecheck/boundaries:** `npm run check`.
- **Preview:** Clone Repos → Value mode shows rows with `+`/`×`; add/remove
  updates `config.repos`; `@ Reference` still binds an upstream `string[]` and
  dims scalars; summary shows "N repos".

## Files touched (summary)

- `packages/flow-editor/src/step-definition.ts` — `"string-list"` widget type.
- `packages/flow-editor/src/properties-panel/StringListEditor.tsx` — new component + `splitRows`/`joinRows`.
- `packages/flow-editor/src/properties-panel/StringListEditor.test.ts` — helper tests.
- `packages/flow-editor/src/properties-panel/InputValueEditor.tsx` — `valueListMode` prop.
- `packages/flow-editor/src/properties-panel/ConfigTab.tsx` — route `string-list` widget.
- `packages/steps/src/git/clone-repos.tsx` — `repos` widget → `string-list`.
