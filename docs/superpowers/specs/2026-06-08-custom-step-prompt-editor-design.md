# Markdown Prompt Editor for Custom Steps — Design

**Date:** 2026-06-08
**Status:** Approved (pending spec review)
**Scope:** Prompt tab of the custom-step create/edit modal in `@journeyman/web`.

## Problem

Custom AI steps carry a `promptTemplate` string that references declared inputs
(`{{input}}`) and env-injected secret slots (`$SLOT`). Today this is authored in
[`PromptEditor.tsx`](../../../packages/web/src/components/custom-steps/PromptEditor.tsx) —
a plain `<textarea>` with a click-to-insert sidebar and a footer that lists
unknown tokens. There is no markdown rendering, no token highlighting, no
autocomplete, and minimal writing ergonomics.

Authors want a **good markdown editor**: see the formatted prompt, get
autocomplete for tokens, and write comfortably.

## Goals

- Markdown rendering via a Preview toggle.
- Token autocomplete (type `{{` → inputs, `$` → slots).
- Inline token highlighting, including in-place flagging of unknown tokens.
- Better writing ergonomics (soft-wrap, line numbers, find/replace).
- Keep the existing click-to-insert sidebar as a discoverability aid.

## Non-Goals

- No change to the data model: `promptTemplate` stays a **plain string**.
- No DB/schema/migration changes.
- No change to token syntax (`{{input}}`, `$SLOT`) or to runtime rendering in
  [`prompt-renderer.ts`](../../../packages/custom-steps/src/prompt-renderer.ts).
- Not a WYSIWYG/rich-text editor — the editor edits markdown **source**.
- Out of scope: the flow-editor node config (`CustomAiConfigForm`); this work is
  confined to the create/edit modal's Prompt tab.

## Decisions (from brainstorming)

| Decision | Choice |
|---|---|
| Editing paradigm | Source editor with **Edit / Preview** toggle (not WYSIWYG) |
| Editor library | **CodeMirror 6** via `@uiw/react-codemirror` + `@codemirror/lang-markdown` |
| Tokens in preview | Rendered as **styled chips** showing the name (green = input, indigo = slot, amber = unknown) |
| Sidebar | **Kept** alongside autocomplete; hidden in Preview mode |
| Unknown tokens | Inline squiggle in the editor **and** the existing footer summary |

## Architecture

`PromptEditor.tsx` is decomposed from one monolith into focused, independently
testable units. New files live under
`packages/web/src/components/custom-steps/prompt-editor/`.

| Unit | Responsibility | Depends on |
|---|---|---|
| `PromptEditor.tsx` | Container: Edit/Preview tab state, fullscreen, layout, wires sidebar ↔ editor, renders footer | all below |
| `PromptCodeMirror.tsx` | Thin CodeMirror 6 React wrapper (`value`/`onChange` + extensions). Exposes imperative `insertAtCursor()` via ref | `tokenHighlight`, `tokenAutocomplete`, `prompt-tokens` |
| `PromptPreview.tsx` | Renders markdown with tokens as chips | `prompt-tokens`, `react-markdown`, `remark-gfm` |
| `TokenSidebar.tsx` | Inputs / "Env in $bash" sections with "used" badges + click-to-insert | `prompt-tokens` |
| `prompt-tokens.ts` | **Single source of truth**: token regexes + `analyzeReferences()` | — |
| `tokenHighlight.ts` | CM6 decoration extension built from known input/slot name sets | `prompt-tokens` |
| `tokenAutocomplete.ts` | CM6 completion source built from `inputFields` / `slots` | `prompt-tokens` |

`prompt-tokens.ts` centralizes token parsing (regexes + `analyzeReferences`,
moved verbatim out of today's component) so highlighting, autocomplete, preview
chips, and footer validation all derive from one definition.

The public props of `PromptEditor` are unchanged so `EditCustomStepModal` needs
no edits:

```typescript
export interface PromptEditorProps {
  value: string;
  onChange: (next: string) => void;
  inputFields: CustomStepInputField[];
  slots: SecretSlotDef[];
}
```

## Editing pane (CodeMirror 6)

- **Dependencies:** `@uiw/react-codemirror` (handles the editor lifecycle in
  React) + `@codemirror/lang-markdown`. `@codemirror/view`, `@codemirror/state`,
  and `@codemirror/autocomplete` arrive transitively and are used for
  decorations and completion.
- **Markdown highlighting:** the markdown language extension, themed to the
  Tailwind dark palette (mono font, slate background, indigo caret/selection) to
  match the current look.
- **Token highlighting** (`tokenHighlight.ts`): a `ViewPlugin` scans the visible
  doc with the shared `INPUT_TOKEN` / `SLOT_TOKEN` regexes and applies
  `Decoration.mark`:
  - declared input → green class; declared slot → indigo class;
  - **unknown** input/slot → amber/red squiggle class.
  Known-name sets are passed in and rebuilt when `inputFields`/`slots` change
  (via a reconfigurable `StateField`/`Compartment` or by remounting on identity
  change — implementation detail for the plan).
- **Autocomplete** (`tokenAutocomplete.ts`): a `CompletionSource`:
  - trigger `{{` → completes declared input names, inserting `name}}`;
  - trigger `$` → completes slot names (uppercase);
  - completion `detail`/`info` shows the input type/required flag or slot
    description.
- **Ergonomics:** soft line-wrap, line numbers, find/replace (`Ctrl/Cmd-F`),
  bracket matching, comfortable line-height. Fullscreen toggle preserved from
  the current component.

## Preview tab

- A tab bar `[ Edit | Preview ]` sits above the pane; **Edit** is the default.
- Rendering uses `react-markdown` + `remark-gfm`.
- A small **remark plugin** walks mdast text nodes, splits them on the token
  regexes, and replaces each match with a chip node mapped to a styled `<span>`:
  - input chip (green) shows the input name;
  - slot chip (indigo) shows the slot name;
  - unknown token → amber chip.
- The preview is read-only, scrollable, and matches the editor's height. The
  sidebar is hidden in Preview mode so the rendered output gets full width.

## Sidebar (kept)

`TokenSidebar` extracts today's right-hand panel unchanged in behavior:

- "Inputs" and "Env in $bash" sections list declared inputs/slots.
- "used" badges are driven by `analyzeReferences(value)` from `prompt-tokens.ts`.
- Click-to-insert dispatches the token into the CodeMirror instance via the
  `insertAtCursor()` ref exposed by `PromptCodeMirror` (replacing today's
  textarea selection logic).
- Visible only in Edit mode.

## Validation / footer

The footer keeps its current behavior: when `analyzeReferences` reports unknown
inputs/slots, it lists them with the "declare in the Inputs/Secrets tab"
guidance. The same unknowns now also render inline as squiggles in the editor.

## New dependencies (added to `packages/web`)

- `@uiw/react-codemirror`
- `@codemirror/lang-markdown`
- `react-markdown`
- `remark-gfm`

## Testing

- `prompt-tokens.ts`: unit-test `analyzeReferences` against known/unknown
  input and slot mixes (port existing expectations).
- `tokenAutocomplete.ts`: completion source returns the right options for `{{`
  and `$` triggers given input/slot sets.
- Manual/preview verification: markdown renders, token chips show correct
  colors, unknown-token squiggle + footer both fire, sidebar click inserts at
  cursor, Edit/Preview toggle and fullscreen work.

## Risks / Notes

- **Reconfiguring known-name sets** in CodeMirror as the Inputs/Secrets tabs
  change is the main fiddly bit; the plan should pick a concrete mechanism
  (Compartment reconfigure vs. keyed remount).
- **Bundle size:** CodeMirror + react-markdown add ~150–250 KB; acceptable for
  an authoring surface, and the editor can be code-split/lazy-loaded with the
  modal if needed.
- The repo already has a `mention-chip-input` design (2026-05-27) for token
  insertion elsewhere; this design intentionally stays on a source editor rather
  than chip-based input, per the brainstorming decision.
