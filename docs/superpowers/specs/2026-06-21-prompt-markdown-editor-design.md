# Wire up the markdown prompt editor — design

**Date:** 2026-06-21
**Status:** Approved (design), pending implementation plan
**Scope:** `@journeyman/web` only

## Problem

The custom-AI-step **Prompt** field is a plain `<textarea>`
([`PromptSection.tsx`](../../../packages/web/src/components/custom-steps/sections/PromptSection.tsx)).
Authors writing prompts get no markdown affordances, no token awareness, and no
syntax highlighting.

A complete, CodeMirror-based markdown editor already exists in the repo at
`packages/web/src/components/custom-steps/prompt-editor/` (committed, tested),
but it is **never imported anywhere** — `grep -rn "PromptEditor"` finds zero
usages outside its own directory. It was built and left unwired.

This project wires that existing `PromptEditor` into `PromptSection`, and adds
the one capability it lacks: a read-only mode for published (locked) steps.

## Goal

Replace the textarea with `PromptEditor`, preserving the existing `locked`
behavior. No new editor features beyond read-only. Other prompt/instruction
textareas in the app (agent instructions, MCP system prompts, human-task
instructions) are explicitly **out of scope**.

## What already exists (no changes needed)

`PromptEditor` ([`PromptEditor.tsx`](../../../packages/web/src/components/custom-steps/prompt-editor/PromptEditor.tsx))
already provides:

- CodeMirror editor with `@codemirror/lang-markdown` syntax highlighting
- Formatting toolbar (bold, italic, code, heading, list, quote, link) via `PromptToolbar`
- Edit / Preview toggle, with live markdown rendering via `PromptPreview`
- Fullscreen ("Expand") mode
- Token highlighting: `{{input}}` → green, `$SECRET` → accent, unknown → wavy warning underline
- Token autocomplete on `{{` and `$`
- Token insert sidebar (`TokenSidebar`) listing declared inputs/slots
- Footer warning summarizing unknown tokens

Its props today:

```ts
interface PromptEditorProps {
  value: string;
  onChange: (next: string) => void;
  inputFields: CustomStepInputField[];
  slots: SecretSlotDef[];
}
```

The data maps cleanly to `CustomAiStep`: `promptTemplate` → `value`,
`inputFields` → `inputFields`, `slots` → `slots`.

## Changes

### 1. `PromptSection.tsx` — swap the textarea

Render `PromptEditor` instead of the `<textarea>`, keeping the `SectionShell` +
`FieldLabel` wrapper and the existing description copy.

```tsx
<PromptEditor
  value={step.promptTemplate}
  onChange={(next) => patch({ promptTemplate: next })}
  inputFields={step.inputFields}
  slots={step.slots}
  readOnly={locked}
/>
```

The unused `inputCls` import is removed if no longer referenced.

### 2. `PromptEditor.tsx` — add `readOnly`

Add `readOnly?: boolean` (default `false`) to `PromptEditorProps`. When `true`:

- **Hide the formatting toolbar** — it only mutates the document.
- **Hide the `TokenSidebar`** — its only purpose is click-to-insert. The body
  grid collapses to a single column (same layout it already uses in preview mode).
- Replace the "Expand" control's affordance with a small **"Read-only" badge**
  (lock icon + label). Fullscreen is dropped in read-only mode to keep the change
  minimal; the editor is short when locked.
- Keep the **Edit / Preview toggle** — both are read-safe.
- Keep the **unknown-token footer warning** — informational only.
- Pass `readOnly` down to `PromptCodeMirror`.

### 3. `PromptCodeMirror.tsx` — make CodeMirror non-editable

Add `readOnly?: boolean` to the component's props. When `true`, append to the
`extensions` memo:

```ts
EditorState.readOnly.of(true),
EditorView.editable.of(false),
```

`EditorState.readOnly` blocks document mutation (paste, autocomplete-insert,
keymap commands); `EditorView.editable.of(false)` removes the editing affordance
(caret, contentEditable) while keeping text selectable and copyable. `readOnly`
joins the `useMemo` dependency array so toggling re-derives extensions.

### 4. `TokenSidebar.tsx` — no change required

The sidebar is simply not rendered by `PromptEditor` when `readOnly` is true, so
its insert buttons are never reachable. No prop change needed.

## Out of scope (YAGNI)

- Agent instructions textarea (`InstructionsSection.tsx`)
- MCP system-prompt textareas (`AddCustomModal.tsx`, `EditMcpModal.tsx`)
- Human-task instruction / notification textareas (`ControlNodeConfigTab.tsx`)
- Generic `SchemaForm` textareas
- Any change to token syntax, toolbar commands, preview rendering, or autocomplete

These can be follow-up tickets that reuse the same `PromptEditor`.

## Testing

- Existing unit tests for the editor internals (`prompt-tokens`,
  `editor-commands`, `PromptToolbar`, `PromptPreview`, `completion-options`,
  `prompt-preview-tokens`, `token-ranges`) continue to pass unchanged.
- Add a focused test asserting that, with `readOnly`, `PromptEditor` does not
  render the formatting toolbar or the token sidebar (and renders the read-only
  badge).
- `npm run check` (typecheck + import boundaries) passes.
- Manual: open a draft custom step → Prompt tab shows the full editor; enable the
  step → Prompt tab shows the locked, read-only editor.

## Files touched

| File | Change |
|---|---|
| `packages/web/src/components/custom-steps/sections/PromptSection.tsx` | Swap textarea → `PromptEditor`, pass `readOnly={locked}` |
| `packages/web/src/components/custom-steps/prompt-editor/PromptEditor.tsx` | Add `readOnly` prop; gate toolbar/sidebar/fullscreen; read-only badge |
| `packages/web/src/components/custom-steps/prompt-editor/PromptCodeMirror.tsx` | Add `readOnly` prop → CodeMirror `readOnly`/`editable` extensions |
| `packages/web/src/components/custom-steps/prompt-editor/PromptEditor.test.tsx` *(new)* | Read-only rendering test |
