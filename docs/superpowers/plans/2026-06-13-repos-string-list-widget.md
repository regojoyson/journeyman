# String-List Rows Editor (Repos field) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render list-style config fields (starting with Clone Repos' `repos`) as a rows editor — one entry per row with `+ Add` / `×` remove — while keeping the `@ Reference` tab for binding the whole list.

**Architecture:** A new `widget: "string-list"` field type routes through the existing `InputValueEditor` (keeping its `Value | @ Reference` tabs + help). A new `valueListMode` prop makes the editor's Value side render a `StringListEditor` (rows) instead of the string/JSON widget. Rows read/write a newline-joined string stored as a `{ kind: "literal" }` config value — no schema or runtime change.

**Tech Stack:** TypeScript, React (flow-editor), Vitest. Tests: `npm test -w @journeyman/flow-editor`. Gate: `npm run check`.

**Branch:** `docs/windows-sandbox-design` (current).

**Spec:** [docs/superpowers/specs/2026-06-13-repos-string-list-widget-design.md](../specs/2026-06-13-repos-string-list-widget-design.md)

---

## File Structure

**Create:**
- `packages/flow-editor/src/properties-panel/StringListEditor.tsx` — `splitRows`/`joinRows` helpers + the rows component.
- `packages/flow-editor/src/properties-panel/StringListEditor.test.ts` — helper unit tests.

**Modify:**
- `packages/flow-editor/src/step-definition.ts` — add `"string-list"` to `FieldMeta.widget`.
- `packages/flow-editor/src/properties-panel/InputValueEditor.tsx` — `valueListMode` prop + Value-mode rows branch + guards.
- `packages/flow-editor/src/properties-panel/ConfigTab.tsx` — route `string-list` widget.
- `packages/flow-editor/src/styles.css` — `.je-string-list*` rules.
- `packages/steps/src/git/clone-repos.tsx` — `repos` widget `textarea` → `string-list`.

---

## Task 1: Add the `string-list` widget type

**Files:**
- Modify: `packages/flow-editor/src/step-definition.ts:19`

- [ ] **Step 1: Add the literal to the union**

In `packages/flow-editor/src/step-definition.ts`, change the `FieldMeta.widget` line:

```ts
  widget?: "text" | "textarea" | "number" | "select" | "checkbox" | "secret" | "code" | "string-list";
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck -w @journeyman/flow-editor`
Expected: passes (no usages yet).

- [ ] **Step 3: Commit**

```bash
git add packages/flow-editor/src/step-definition.ts
git commit -m "feat(flow-editor): add string-list field widget type"
```

---

## Task 2: `splitRows` / `joinRows` helpers (TDD)

**Files:**
- Create: `packages/flow-editor/src/properties-panel/StringListEditor.tsx`
- Test: `packages/flow-editor/src/properties-panel/StringListEditor.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/flow-editor/src/properties-panel/StringListEditor.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { splitRows, joinRows } from "./StringListEditor.tsx";

describe("splitRows", () => {
  it("empty string → one blank row", () => {
    expect(splitRows("")).toEqual([""]);
    expect(splitRows(undefined)).toEqual([""]);
  });
  it("splits on newlines", () => {
    expect(splitRows("a\nb")).toEqual(["a", "b"]);
    expect(splitRows("a")).toEqual(["a"]);
  });
});

describe("joinRows", () => {
  it("trims, drops blank rows, joins with newline", () => {
    expect(joinRows(["a", "", "b "])).toBe("a\nb");
    expect(joinRows(["  ", "x"])).toBe("x");
  });
  it("all-blank → empty string", () => {
    expect(joinRows(["", ""])).toBe("");
    expect(joinRows([])).toBe("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @journeyman/flow-editor -- StringListEditor`
Expected: FAIL — `Cannot find module './StringListEditor.tsx'`.

- [ ] **Step 3: Write the helpers (+ minimal component stub so the file is valid TSX)**

Create `packages/flow-editor/src/properties-panel/StringListEditor.tsx`:

```tsx
import { useEffect, useState } from "react";

/** Split a stored newline-joined string into editable rows. Empty → one blank row. */
export function splitRows(value: string | undefined): string[] {
  if (!value) return [""];
  return value.split("\n");
}

/** Join rows back into the stored string: trim each, drop blanks, newline-separated. */
export function joinRows(rows: string[]): string {
  return rows.map(r => r.trim()).filter(r => r.length > 0).join("\n");
}

interface Props {
  value: string;
  readOnly?: boolean;
  placeholder?: string;
  onChange: (next: string) => void;
}

export function StringListEditor({ value, readOnly, placeholder, onChange }: Props) {
  const [rows, setRows] = useState<string[]>(() => splitRows(value));

  // Re-sync rows when the committed value changes externally (e.g. selecting a
  // different node). No-op while our own rows already encode it, so mid-edit
  // blank rows are preserved.
  useEffect(() => {
    if (joinRows(rows) !== value) setRows(splitRows(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const commit = (next: string[]) => {
    setRows(next.length ? next : [""]);
    onChange(joinRows(next));
  };

  return (
    <div className="je-string-list">
      {rows.map((row, i) => (
        <div className="je-string-list__row" key={i}>
          <input
            className="je-string-list__input"
            value={row}
            disabled={readOnly}
            placeholder={placeholder}
            onChange={e => { const next = rows.slice(); next[i] = e.target.value; commit(next); }}
          />
          {!readOnly && (
            <button
              type="button"
              className="je-string-list__rm"
              title="Remove"
              aria-label="Remove row"
              onClick={() => commit(rows.filter((_, idx) => idx !== i))}
            >×</button>
          )}
        </div>
      ))}
      {!readOnly && (
        <button type="button" className="je-string-list__add" onClick={() => commit([...rows, ""])}>
          + Add
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @journeyman/flow-editor -- StringListEditor`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck -w @journeyman/flow-editor`
Expected: passes.

- [ ] **Step 6: Commit**

```bash
git add packages/flow-editor/src/properties-panel/StringListEditor.tsx packages/flow-editor/src/properties-panel/StringListEditor.test.ts
git commit -m "feat(flow-editor): StringListEditor rows component + split/join helpers"
```

---

## Task 3: Style the rows editor

**Files:**
- Modify: `packages/flow-editor/src/styles.css`

- [ ] **Step 1: Append CSS rules**

Add to `packages/flow-editor/src/styles.css` (after the `.je-input-value__hint` rule, matching the existing dark palette `#0f0f1a` / `#2a2a3a` / `#e2e8f0`):

```css
/* String-list rows editor (Value mode for list fields). */
.je-string-list { display: flex; flex-direction: column; gap: 6px; }
.je-string-list__row { display: flex; align-items: center; gap: 6px; }
.je-string-list__input {
  flex: 1; box-sizing: border-box;
  background: #0f0f1a; color: #e2e8f0;
  border: 1px solid #2a2a3a; border-radius: 4px;
  padding: 6px 8px; font-size: 12px; font-family: monospace;
}
.je-string-list__rm {
  flex: 0 0 auto; width: 26px; height: 30px;
  background: transparent; color: #94a3b8;
  border: 1px solid #2a2a3a; border-radius: 4px; cursor: pointer;
}
.je-string-list__rm:hover { color: #ff7675; border-color: #5a3a3a; }
.je-string-list__add {
  align-self: flex-start;
  background: transparent; color: #8fbeff;
  border: 1px dashed #2a2a3a; border-radius: 4px;
  padding: 6px 12px; font-size: 12px; cursor: pointer;
}
.je-string-list__add:hover { border-color: #3a3a5e; }
```

- [ ] **Step 2: Verify build**

Run: `npm run check`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add packages/flow-editor/src/styles.css
git commit -m "style(flow-editor): string-list rows editor styling"
```

---

## Task 4: `valueListMode` prop on InputValueEditor

**Files:**
- Modify: `packages/flow-editor/src/properties-panel/InputValueEditor.tsx`

No unit test (the codebase has no React render-test harness for these components — same as `MentionInput`/`InputHelp`). Gate is `npm run check` + the preview verification in Task 7. The testable logic (`splitRows`/`joinRows`) is covered in Task 2.

- [ ] **Step 1: Import StringListEditor**

Add after the `InputHelp` import (line ~14):

```ts
import { StringListEditor } from "./StringListEditor.tsx";
```

- [ ] **Step 2: Add the prop**

Change the `Props` interface and the destructure:

```ts
interface Props {
  value: WorkflowInputValue | undefined;
  expected: Shape | undefined;
  fields: MentionField[];
  readOnly?: boolean;
  required?: boolean;
  placeholder?: string;
  /** When true, Value mode renders a rows editor (newline-joined string literal). */
  valueListMode?: boolean;
  onChange: (next: WorkflowInputValue | undefined) => void;
}

export function InputValueEditor({ value, expected, fields, readOnly, required, placeholder, valueListMode, onChange }: Props) {
```

- [ ] **Step 3: Add the rows branch and guard the other Value-mode branches**

Immediately BEFORE the `{mode === "value" && widget === "string" && (` block (line ~108), insert:

```tsx
      {mode === "value" && valueListMode && (
        <StringListEditor
          value={value?.kind === "literal" && typeof value.value === "string" ? value.value : ""}
          readOnly={readOnly}
          placeholder={placeholder ?? "owner/repo or URL"}
          onChange={s => onChange(s ? { kind: "literal", value: s } : undefined)}
        />
      )}
```

Then add `!valueListMode &&` to each of the four existing Value-mode conditions so they don't double-render (repos resolves to the `json` widget, which would otherwise show alongside the rows):

- `{mode === "value" && widget === "string" && (` → `{mode === "value" && !valueListMode && widget === "string" && (`
- `{mode === "value" && widget === "number" && (` → `{mode === "value" && !valueListMode && widget === "number" && (`
- `{mode === "value" && widget === "boolean" && (` → `{mode === "value" && !valueListMode && widget === "boolean" && (`
- `{mode === "value" && widget === "json" && (` → `{mode === "value" && !valueListMode && widget === "json" && (`

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck -w @journeyman/flow-editor`
Expected: passes.

- [ ] **Step 5: Commit**

```bash
git add packages/flow-editor/src/properties-panel/InputValueEditor.tsx
git commit -m "feat(flow-editor): InputValueEditor valueListMode renders rows in Value mode"
```

---

## Task 5: Route the `string-list` widget in ConfigTab

**Files:**
- Modify: `packages/flow-editor/src/properties-panel/ConfigTab.tsx` (the `renderMentionField` function)

- [ ] **Step 1: Add the routing branch**

In `renderMentionField`, add this branch immediately after `const widget = meta.widget ?? "text";` and BEFORE the `if (widget === "text" || widget === "textarea")` branch:

```tsx
    if (widget === "string-list") {
      return (
        <InputValueEditor
          value={inputValueForField(key)}
          expected={expectedForKey(key)}
          fields={mentionFields}
          valueListMode
          readOnly={readOnly}
          onChange={next => commitInputValue(key, next)}
        />
      );
    }
```

(`inputValueForField`, `commitInputValue`, `expectedForKey`, and `mentionFields` already exist in this component from the config-field routing work. `expectedForKey("repos")` resolves to `array<string>` from `cloneReposInputFields`, which correctly gates the `@ Reference` picker.)

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck -w @journeyman/flow-editor`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add packages/flow-editor/src/properties-panel/ConfigTab.tsx
git commit -m "feat(flow-editor): route string-list config fields to the rows editor"
```

---

## Task 6: Switch Clone Repos `repos` to `string-list`

**Files:**
- Modify: `packages/steps/src/git/clone-repos.tsx`

- [ ] **Step 1: Change the widget**

In `packages/steps/src/git/clone-repos.tsx`, change the `repos` config field:

```ts
  configFields: {
    repos:  { label: "Repos",  widget: "string-list", help: "One owner/repo or URL per row" },
    branch: { label: "Branch", widget: "text",        help: "Optional — defaults to main" },
  },
```

(Leave `defaultConfig`, `configSchema` (`z.string().min(1)`), `summary`, and the `executor` unchanged — storage is still a newline-joined string.)

- [ ] **Step 2: Typecheck both packages**

Run: `npm run typecheck -w @journeyman/steps && npm run typecheck -w @journeyman/flow-editor`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add packages/steps/src/git/clone-repos.tsx
git commit -m "feat(steps): Clone Repos repos field uses the string-list rows editor"
```

---

## Task 7: Full check + preview verification

**Files:** none (verification only).

- [ ] **Step 1: Whole-repo gate**

Run: `npm run check && npm test -w @journeyman/flow-editor`
Expected: all green.

- [ ] **Step 2: Verify in the browser**

Start the web app (preview_start), log in, open a flow with a Clone Repos step (or add one), select it:
- **Value** mode shows one row + `+ Add`. Press `+ Add` → a new empty row appears. Type repos; press `×` → row removed. The node summary updates to "N repos".
- Confirm `config.repos` becomes the newline-joined string (the value persists on reselecting the node).
- **@ Reference** mode still shows the chip picker; an upstream `string[]` is selectable and scalar sources are dimmed.
Capture a screenshot (preview_screenshot) as proof.

- [ ] **Step 3: Commit any fixes**

```bash
git add -A && git commit -m "fix(flow-editor): string-list rows editor fixes from preview verification"
```

---

## Notes & Known Limitations

- **Row identity uses array index as React key.** Fine for this simple list; removing a middle row re-renders the inputs below it. Drag-reorder and stable row IDs are out of scope (v1).
- **Storage is unchanged** — a newline-joined string in `config.repos`. `parseRepoList` already splits newlines/commas and accepts arrays, so the runtime and the `z.string().min(1)` schema are untouched. All-blank rows → `undefined` → existing "Repos required" validation applies.
- **Reusable:** any config field can opt in by setting `widget: "string-list"`; `expectedForKey` should resolve to an `array<…>` shape (via the step's `inputFields`) so the `@ Reference` picker matches list sources.

## Self-Review (against the spec)

- **Spec coverage:** `string-list` widget type → Task 1; `StringListEditor` + `splitRows`/`joinRows` → Task 2; styling → Task 3; `valueListMode` Value-mode rows + guards → Task 4; ConfigTab routing → Task 5; Clone Repos opt-in → Task 6; @ Reference preserved + newline storage → Tasks 4–6 (unchanged paths) + Task 7 verification. All spec sections mapped.
- **Placeholders:** none — every code step has complete code.
- **Type consistency:** `splitRows(string|undefined): string[]`, `joinRows(string[]): string`, `StringListEditor` props `{ value:string; readOnly?; placeholder?; onChange:(s:string)=>void }`, and `valueListMode?: boolean` are used identically across Tasks 2, 4, and 5.
