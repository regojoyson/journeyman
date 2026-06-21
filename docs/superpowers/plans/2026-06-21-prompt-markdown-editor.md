# Markdown Prompt Editor Wire-Up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the custom-AI-step Prompt `<textarea>` with the already-built `PromptEditor`, and give the editor a read-only mode for published (locked) steps.

**Architecture:** The full editor already exists at `packages/web/src/components/custom-steps/prompt-editor/` but is unwired. We add a `readOnly` prop down two component levels (`PromptEditor` → `PromptCodeMirror`), gate the mutating UI (toolbar, insert sidebar, fullscreen) behind it, then render `PromptEditor` from `PromptSection` with `readOnly={locked}`.

**Tech Stack:** React 19, TypeScript, CodeMirror (`@uiw/react-codemirror`, `@codemirror/state`, `@codemirror/view`), Tailwind, Vitest (`renderToStaticMarkup` SSR-string tests).

**Execution constraints (from the requester):**
- Work directly on `master`. No feature branch, no worktree.
- **No commits.** Do not run `git add` / `git commit` at any point.
- Run the typecheck **once, at the very end** — not per task.
- Per-task test runs (vitest) are still done as part of TDD; only the typecheck is deferred to the end.

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `packages/web/src/components/custom-steps/prompt-editor/PromptCodeMirror.tsx` | CodeMirror wrapper; owns extensions. Gains `readOnly` → adds `EditorState.readOnly` + `EditorView.editable(false)`. | Modify |
| `packages/web/src/components/custom-steps/prompt-editor/PromptEditor.tsx` | Editor shell; owns toolbar/preview/sidebar/fullscreen layout. Gains `readOnly` → hides toolbar + sidebar + fullscreen, shows a read-only badge. | Modify |
| `packages/web/src/components/custom-steps/prompt-editor/PromptEditor.test.tsx` | Asserts read-only gating of toolbar/sidebar/badge. | Create |
| `packages/web/src/components/custom-steps/sections/PromptSection.tsx` | Custom-step Prompt tab. Swaps textarea → `PromptEditor`, passes `readOnly={locked}`. | Modify |

---

## Task 1: Add `readOnly` to `PromptCodeMirror`

Plumbing change — makes the CodeMirror document non-editable when `readOnly`. No standalone test (CodeMirror does not mount under SSR string rendering); its effect is exercised via Task 2's test and the final typecheck.

**Files:**
- Modify: `packages/web/src/components/custom-steps/prompt-editor/PromptCodeMirror.tsx`

- [ ] **Step 1: Make `EditorState` a value import**

The file currently imports `EditorState` as type-only. `EditorState.readOnly` is a runtime facet, so it must be a value import. Replace line 4:

```tsx
import type { EditorState, TransactionSpec } from "@codemirror/state";
```

with:

```tsx
import { EditorState, type TransactionSpec } from "@codemirror/state";
```

`EditorView` is already a value import from `@codemirror/view` (line 3) — leave it.

- [ ] **Step 2: Add `readOnly` to the props type and destructure**

In the `forwardRef` generic props object (currently `value`, `onChange`, `inputFields`, `slots`, `height`), add `readOnly`. The type block becomes:

```tsx
export const PromptCodeMirror = forwardRef<
  PromptCodeMirrorHandle,
  {
    value: string;
    onChange: (next: string) => void;
    inputFields: CustomStepInputField[];
    slots: SecretSlotDef[];
    height: string;
    readOnly?: boolean;
  }
>(function PromptCodeMirror({ value, onChange, inputFields, slots, height, readOnly = false }, ref) {
```

- [ ] **Step 3: Append the read-only extensions and add `readOnly` to deps**

Replace the `extensions` memo (currently lines ~67-77) with:

```tsx
  const extensions = useMemo(
    () => [
      markdown(),
      EditorView.lineWrapping,
      formattingKeymap,
      tokenHighlighter(namesOf(inputFields), namesOf(slots)),
      tokenAutocomplete(inputFields, slots),
      makeEditorTheme(theme === "dark"),
      ...(readOnly ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : []),
    ],
    [inputFields, slots, theme, readOnly],
  );
```

`EditorState.readOnly.of(true)` blocks document mutation (paste, autocomplete insert, formatting keymap); `EditorView.editable.of(false)` removes the editing affordance while keeping text selectable/copyable.

---

## Task 2: Add `readOnly` to `PromptEditor` (TDD)

**Files:**
- Test: `packages/web/src/components/custom-steps/prompt-editor/PromptEditor.test.tsx` (create)
- Modify: `packages/web/src/components/custom-steps/prompt-editor/PromptEditor.tsx`

- [ ] **Step 1: Write the failing test**

Create `packages/web/src/components/custom-steps/prompt-editor/PromptEditor.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PromptEditor } from "./PromptEditor.tsx";
import type { CustomStepInputField, SecretSlotDef } from "@journeyman/core";

const inputs: CustomStepInputField[] = [
  { name: "ticketKey", type: "string", required: true, description: "" },
];
const slots: SecretSlotDef[] = [
  { name: "GITHUB_TOKEN", description: "" },
];

describe("PromptEditor readOnly", () => {
  it("renders the toolbar and insert sidebar when editable", () => {
    const html = renderToStaticMarkup(
      <PromptEditor value="{{ticketKey}}" onChange={() => {}} inputFields={inputs} slots={slots} />,
    );
    expect(html).toContain('title="Bold (⌘B)"');
    expect(html).toContain("click to insert");
    expect(html).not.toContain("Read-only");
  });

  it("hides the toolbar + sidebar and shows a read-only badge when readOnly", () => {
    const html = renderToStaticMarkup(
      <PromptEditor value="{{ticketKey}}" onChange={() => {}} inputFields={inputs} slots={slots} readOnly />,
    );
    expect(html).not.toContain('title="Bold (⌘B)"');
    expect(html).not.toContain("click to insert");
    expect(html).toContain("Read-only");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test --workspace @journeyman/web -- PromptEditor.test`
Expected: FAIL — `PromptEditor` has no `readOnly` prop yet, so the readOnly case still renders the toolbar (`title="Bold (⌘B)"` present) and never renders "Read-only".

- [ ] **Step 3: Add the `Lock` icon import**

In `PromptEditor.tsx`, the lucide import (currently `Maximize2, Minimize2, AlertTriangle, Pencil, Eye`) gains `Lock`:

```tsx
import { Maximize2, Minimize2, AlertTriangle, Pencil, Eye, Lock } from "lucide-react";
```

- [ ] **Step 4: Add `readOnly` to the props interface and destructure**

```tsx
export interface PromptEditorProps {
  value: string;
  onChange: (next: string) => void;
  inputFields: CustomStepInputField[];
  slots: SecretSlotDef[];
  readOnly?: boolean;
}

type Mode = "edit" | "preview";

export function PromptEditor({ value, onChange, inputFields, slots, readOnly = false }: PromptEditorProps) {
```

- [ ] **Step 5: Replace the Expand button with a read-only badge when locked**

In the header, the right-hand control is currently the fullscreen `<button>`. Wrap it so `readOnly` renders a badge instead:

```tsx
          {readOnly ? (
            <span className="inline-flex items-center gap-1.5 text-xs text-slate-400 border border-slate-700 px-2 py-1 rounded">
              <Lock className="w-3.5 h-3.5" /> Read-only
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setFullscreen(f => !f)}
              className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200 px-2 py-1 rounded hover:bg-surface-hover transition"
              title={fullscreen ? "Exit fullscreen" : "Expand to fullscreen"}
            >
              {fullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
              {fullscreen ? "Exit" : "Expand"}
            </button>
          )}
```

- [ ] **Step 6: Gate the toolbar on `!readOnly`**

Change the toolbar line from `{mode === "edit" && (` to also require not-read-only:

```tsx
        {mode === "edit" && !readOnly && (
          <PromptToolbar onCommand={build => cmRef.current?.applyCommand(build)} />
        )}
```

- [ ] **Step 7: Collapse the body grid to one column when read-only**

The body `<div>` grid currently switches columns on `mode === "edit"`. Make the two-column layout require an editable edit mode:

```tsx
        <div
          className={
            `grid ${fullscreen ? "flex-1 min-h-0" : "h-[460px]"} ` +
            (mode === "edit" && !readOnly ? "grid-cols-1 lg:grid-cols-[1fr_220px]" : "grid-cols-1")
          }
        >
```

- [ ] **Step 8: Pass `readOnly` to `PromptCodeMirror`**

In the edit-mode branch of the body, add the prop:

```tsx
            {mode === "edit" ? (
              <PromptCodeMirror
                ref={cmRef}
                value={value}
                onChange={onChange}
                inputFields={inputFields}
                slots={slots}
                height={fullscreen ? "100%" : "460px"}
                readOnly={readOnly}
              />
            ) : (
              <PromptPreview value={value} inputFields={inputFields} slots={slots} />
            )}
```

- [ ] **Step 9: Gate the insert sidebar on `!readOnly`**

Change the sidebar render condition from `{mode === "edit" && (` to:

```tsx
          {mode === "edit" && !readOnly && (
            <TokenSidebar
              inputFields={inputFields}
              slots={slots}
              used={refs}
              onInsert={snippet => cmRef.current?.insertAtCursor(snippet)}
            />
          )}
```

- [ ] **Step 10: Run the test to verify it passes**

Run: `npm test --workspace @journeyman/web -- PromptEditor.test`
Expected: PASS — both cases green.

---

## Task 3: Wire `PromptEditor` into `PromptSection`

**Files:**
- Modify: `packages/web/src/components/custom-steps/sections/PromptSection.tsx`

- [ ] **Step 1: Replace the file contents**

`PromptSection.tsx` becomes:

```tsx
import { SectionShell, FieldLabel } from "../../agents/sections/SectionShell.tsx";
import { PromptEditor } from "../prompt-editor/PromptEditor.tsx";
import type { SectionProps } from "./types.ts";

export function PromptSection({ step, patch, locked }: SectionProps) {
  return (
    <SectionShell
      title="Prompt"
      description="The instructions sent to the AI model on each run. Reference inputs with {{name}}."
    >
      <div>
        <FieldLabel>Prompt template</FieldLabel>
        <PromptEditor
          value={step.promptTemplate}
          onChange={(next) => patch({ promptTemplate: next })}
          inputFields={step.inputFields}
          slots={step.slots}
          readOnly={locked}
        />
      </div>
    </SectionShell>
  );
}
```

Note: the previous `inputCls` import is dropped because the textarea is gone.

- [ ] **Step 2: Re-run the editor test (sanity)**

Run: `npm test --workspace @journeyman/web -- PromptEditor.test`
Expected: PASS (unchanged — confirms nothing regressed).

---

## Task 4: Final verification (typecheck + full editor test suite)

**Files:** none (verification only)

- [ ] **Step 1: Run the full prompt-editor test suite**

Run: `npm test --workspace @journeyman/web -- prompt-editor`
Expected: PASS — all existing editor tests (`PromptToolbar`, `PromptPreview`, `completion-options`, `prompt-preview-tokens`, `prompt-tokens`, `token-ranges`, `editor-commands`) plus the new `PromptEditor.test` are green.

- [ ] **Step 2: Typecheck the whole repo (once, at the end)**

Run: `npm run typecheck`
Expected: PASS — no type errors. Pay attention to the `EditorState` value-import change in Task 1 and the new `readOnly` props.

- [ ] **Step 3: Report results**

Summarize: tests passing, typecheck clean. Do **not** commit — leave changes in the working tree on `master` for the requester to review.

---

## Notes for the implementer

- The dev frontend hot-reloads (Vite), so a running `npm run dev:web` will reflect changes live — but verification here is test + typecheck only, per constraints.
- Manual smoke check (optional, if a dev server is up): open a **draft** custom step → Prompt tab shows the full editor (toolbar + sidebar + Expand); **enable** the step → Prompt tab shows the read-only editor (no toolbar, no sidebar, "Read-only" badge, text not editable but selectable).
- Token colors, autocomplete, preview rendering, and the unknown-token footer are pre-existing and untouched.
