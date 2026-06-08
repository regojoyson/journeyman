# Markdown Prompt Editor for Custom Steps — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the plain-textarea prompt editor in the custom-step create/edit modal with a CodeMirror 6 source editor that has token highlighting, token autocomplete, markdown ergonomics, and a Preview tab that renders markdown with tokens shown as styled chips.

**Architecture:** The monolithic `PromptEditor.tsx` is decomposed into a thin container plus focused units under `packages/web/src/components/custom-steps/prompt-editor/`. Pure logic (token parsing, decoration ranges, completion options, preview splitting) lives in CodeMirror-free modules so it is unit-testable under vitest in node; the CodeMirror and React pieces compose those pure modules. `promptTemplate` stays a plain string — no data-model, DB, or runtime-rendering changes.

**Tech Stack:** React 18, Vite, Tailwind, CodeMirror 6 (`@uiw/react-codemirror`, `@codemirror/lang-markdown`, `@codemirror/view`, `@codemirror/state`, `@codemirror/autocomplete`), `react-markdown` + `remark-gfm`, `@tailwindcss/typography`, vitest.

**Spec:** [docs/superpowers/specs/2026-06-08-custom-step-prompt-editor-design.md](../specs/2026-06-08-custom-step-prompt-editor-design.md)

---

## File Structure

New directory: `packages/web/src/components/custom-steps/prompt-editor/`

| File | Responsibility | CodeMirror? |
|---|---|---|
| `prompt-tokens.ts` | Token regexes, `analyzeReferences()`, `namesOf()`, `ReferenceAnalysis` | no (pure) |
| `token-ranges.ts` | `tokenRanges()` + `TOKEN_CLASS` — decoration ranges for highlighting | no (pure) |
| `tokenHighlight.ts` | `tokenHighlighter()` CM6 `ViewPlugin` built on `tokenRanges` | yes |
| `completion-options.ts` | `buildInputCompletions()` / `buildSlotCompletions()` | no (type-only import) |
| `tokenAutocomplete.ts` | `promptCompletionSource()` + `tokenAutocomplete()` CM6 extension | yes |
| `prompt-preview-tokens.ts` | `splitTokens()` + `TokenSegment` | no (pure) |
| `rehype-prompt-tokens.ts` | `rehypePromptTokens()` hast transform → token `<span>`s | no |
| `PromptCodeMirror.tsx` | CodeMirror React wrapper; exposes `insertAtCursor()` via ref | yes |
| `PromptPreview.tsx` | `react-markdown` render with token chips | no |
| `TokenSidebar.tsx` | Inputs / Env sections with "used" badges + click-to-insert | no |
| `PromptEditor.tsx` | Container: Edit/Preview tabs, fullscreen, footer, wiring | no |
| `*.test.ts` | Unit tests for the four pure modules | no |

Deleted: `packages/web/src/components/custom-steps/PromptEditor.tsx` (moved into the subdir). One import line in `EditCustomStepModal.tsx` is updated.

---

## Task 1: Dependencies and test scaffold

**Files:**
- Modify: `packages/web/package.json`
- Modify: `packages/web/tailwind.config.js`

- [ ] **Step 1: Add runtime + dev dependencies to `packages/web/package.json`**

Add these entries (keep existing ones; merge into the existing `dependencies` / `devDependencies` blocks, preserving alphabetical-ish order):

In `dependencies`:
```json
    "@codemirror/autocomplete": "^6.18.0",
    "@codemirror/lang-markdown": "^6.3.0",
    "@codemirror/state": "^6.4.0",
    "@codemirror/view": "^6.34.0",
    "@uiw/react-codemirror": "^4.23.0",
    "react-markdown": "^9.0.0",
    "remark-gfm": "^4.0.0",
```

In `devDependencies`:
```json
    "@tailwindcss/typography": "^0.5.15",
    "vitest": "^2.1.9",
```

Add a `test` script to the `scripts` block:
```json
    "test": "vitest run",
```

- [ ] **Step 2: Register the typography plugin in `packages/web/tailwind.config.js`**

Change the top of the file to import the plugin, and add it to `plugins`:
```js
import themePreset from "@journeyman/theme/tailwind-preset";
import typography from "@tailwindcss/typography";

/** @type {import('tailwindcss').Config} */
export default {
  presets: [themePreset],
  content: [
    "./index.html",
    "./src/**/*.{ts,tsx}",
    "../flow-editor/src/**/*.{ts,tsx}",
    "../run-viewer/src/**/*.{ts,tsx}",
    "../runs-list/src/**/*.{ts,tsx}",
  ],
  theme: { extend: {} },
  plugins: [typography],
};
```

- [ ] **Step 3: Install**

Run: `npm install`
Expected: completes without errors; the new packages appear under the root `node_modules`.

- [ ] **Step 4: Verify vitest runs (no tests yet)**

Run: `npm test -w @journeyman/web`
Expected: vitest reports "No test files found" (exit 0) — confirms the script + binary resolve.

- [ ] **Step 5: Commit**

```bash
git add packages/web/package.json packages/web/tailwind.config.js package-lock.json
git commit -m "build(web): add codemirror, react-markdown, typography, vitest for prompt editor"
```

---

## Task 2: `prompt-tokens.ts` — token parsing (single source of truth)

**Files:**
- Create: `packages/web/src/components/custom-steps/prompt-editor/prompt-tokens.ts`
- Test: `packages/web/src/components/custom-steps/prompt-editor/prompt-tokens.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { analyzeReferences } from "./prompt-tokens.ts";

describe("analyzeReferences", () => {
  it("collects known input and slot references", () => {
    const r = analyzeReferences("Hi {{name}} use $TOKEN", new Set(["name"]), new Set(["TOKEN"]));
    expect([...r.inputs]).toEqual(["name"]);
    expect([...r.slots]).toEqual(["TOKEN"]);
    expect(r.unknownInputs).toEqual([]);
    expect(r.unknownSlots).toEqual([]);
  });

  it("flags each undeclared token once", () => {
    const r = analyzeReferences("{{a}} {{a}} $X $X", new Set(), new Set());
    expect(r.unknownInputs).toEqual(["a"]);
    expect(r.unknownSlots).toEqual(["X"]);
  });

  it("ignores lowercase $names and $ preceded by an identifier char", () => {
    const r = analyzeReferences("price is $cost and A$B", new Set(), new Set());
    expect([...r.slots]).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @journeyman/web -- prompt-tokens`
Expected: FAIL — cannot resolve `./prompt-tokens.ts`.

- [ ] **Step 3: Write the implementation**

```ts
import type { CustomStepInputField, SecretSlotDef } from "@journeyman/core";

/** {{name}} — capture group 1 is the input name. */
export const INPUT_TOKEN = /\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g;
/** $NAME — group 1 is the (possibly empty) preceding char, group 2 is the slot name. */
export const SLOT_TOKEN = /(^|[^A-Z0-9_])\$([A-Z][A-Z0-9_]*)/g;

export interface ReferenceAnalysis {
  inputs: Set<string>;
  slots: Set<string>;
  unknownInputs: string[];
  unknownSlots: string[];
}

export function analyzeReferences(
  text: string,
  inputNames: Set<string>,
  slotNames: Set<string>,
): ReferenceAnalysis {
  const inputs = new Set<string>();
  const slots = new Set<string>();
  const unknownInputs: string[] = [];
  const unknownSlots: string[] = [];

  for (const m of text.matchAll(INPUT_TOKEN)) {
    const name = m[1];
    inputs.add(name);
    if (!inputNames.has(name) && !unknownInputs.includes(name)) unknownInputs.push(name);
  }
  for (const m of text.matchAll(SLOT_TOKEN)) {
    const name = m[2];
    slots.add(name);
    if (!slotNames.has(name) && !unknownSlots.includes(name)) unknownSlots.push(name);
  }
  return { inputs, slots, unknownInputs, unknownSlots };
}

/** Set of `name` fields — used to build the "known names" sets. */
export function namesOf(fields: Array<CustomStepInputField | SecretSlotDef>): Set<string> {
  return new Set(fields.map(f => f.name));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @journeyman/web -- prompt-tokens`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/custom-steps/prompt-editor/prompt-tokens.ts packages/web/src/components/custom-steps/prompt-editor/prompt-tokens.test.ts
git commit -m "feat(web): add prompt-tokens parsing module for custom-step editor"
```

---

## Task 3: `token-ranges.ts` — decoration ranges for highlighting

**Files:**
- Create: `packages/web/src/components/custom-steps/prompt-editor/token-ranges.ts`
- Test: `packages/web/src/components/custom-steps/prompt-editor/token-ranges.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { tokenRanges, TOKEN_CLASS } from "./token-ranges.ts";

describe("tokenRanges", () => {
  it("marks known inputs and flags unknown ones", () => {
    const r = tokenRanges("{{a}} {{b}}", new Set(["a"]), new Set());
    expect(r).toEqual([
      { from: 0, to: 5, cls: TOKEN_CLASS.input },
      { from: 6, to: 11, cls: TOKEN_CLASS.unknown },
    ]);
  });

  it("excludes the leading char from a $slot range", () => {
    const r = tokenRanges("x $TOK", new Set(), new Set(["TOK"]));
    expect(r).toEqual([{ from: 2, to: 6, cls: TOKEN_CLASS.slot }]);
  });

  it("returns ranges sorted by start offset", () => {
    const r = tokenRanges("$A {{b}}", new Set(["b"]), new Set(["A"]));
    expect(r.map(x => x.from)).toEqual([0, 3]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @journeyman/web -- token-ranges`
Expected: FAIL — cannot resolve `./token-ranges.ts`.

- [ ] **Step 3: Write the implementation**

```ts
import { INPUT_TOKEN, SLOT_TOKEN } from "./prompt-tokens.ts";

export const TOKEN_CLASS = {
  input: "cm-token-input",
  slot: "cm-token-slot",
  unknown: "cm-token-unknown",
} as const;

export interface TokenRange {
  from: number;
  to: number;
  cls: string;
}

/** All token match ranges in `text`, sorted by start. Offsets are relative to `text`. */
export function tokenRanges(
  text: string,
  inputNames: Set<string>,
  slotNames: Set<string>,
): TokenRange[] {
  const ranges: TokenRange[] = [];

  for (const m of text.matchAll(INPUT_TOKEN)) {
    const from = m.index!;
    ranges.push({
      from,
      to: from + m[0].length,
      cls: inputNames.has(m[1]) ? TOKEN_CLASS.input : TOKEN_CLASS.unknown,
    });
  }
  for (const m of text.matchAll(SLOT_TOKEN)) {
    const lead = m[1] ?? "";
    const from = m.index! + lead.length;
    ranges.push({
      from,
      to: from + (m[0].length - lead.length),
      cls: slotNames.has(m[2]) ? TOKEN_CLASS.slot : TOKEN_CLASS.unknown,
    });
  }

  ranges.sort((a, b) => a.from - b.from || a.to - b.to);
  return ranges;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @journeyman/web -- token-ranges`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/custom-steps/prompt-editor/token-ranges.ts packages/web/src/components/custom-steps/prompt-editor/token-ranges.test.ts
git commit -m "feat(web): add token-ranges helper for prompt editor highlighting"
```

---

## Task 4: `tokenHighlight.ts` — CodeMirror decoration plugin

No unit test (requires a live `EditorView`); the pure core is covered by Task 3 and behavior is verified in Task 11.

**Files:**
- Create: `packages/web/src/components/custom-steps/prompt-editor/tokenHighlight.ts`

- [ ] **Step 1: Write the implementation**

```ts
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";
import { tokenRanges, TOKEN_CLASS } from "./token-ranges.ts";

/**
 * Highlight {{input}} / $SLOT tokens in the document. Known names get the
 * input/slot class; undeclared names get the `unknown` class. Rebuilt on every
 * doc or viewport change, scanning only the visible ranges.
 */
export function tokenHighlighter(inputNames: Set<string>, slotNames: Set<string>) {
  const marks: Record<string, Decoration> = {
    [TOKEN_CLASS.input]: Decoration.mark({ class: TOKEN_CLASS.input }),
    [TOKEN_CLASS.slot]: Decoration.mark({ class: TOKEN_CLASS.slot }),
    [TOKEN_CLASS.unknown]: Decoration.mark({ class: TOKEN_CLASS.unknown }),
  };

  function build(view: EditorView): DecorationSet {
    const builder = new RangeSetBuilder<Decoration>();
    for (const { from, to } of view.visibleRanges) {
      const text = view.state.doc.sliceString(from, to);
      for (const r of tokenRanges(text, inputNames, slotNames)) {
        builder.add(from + r.from, from + r.to, marks[r.cls]);
      }
    }
    return builder.finish();
  }

  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = build(view);
      }
      update(u: ViewUpdate) {
        if (u.docChanged || u.viewportChanged) this.decorations = build(u.view);
      }
    },
    { decorations: v => v.decorations },
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck -w @journeyman/web`
Expected: PASS (no errors from this file).

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/custom-steps/prompt-editor/tokenHighlight.ts
git commit -m "feat(web): add CodeMirror token highlighter for prompt editor"
```

---

## Task 5: `completion-options.ts` — autocomplete option builders

**Files:**
- Create: `packages/web/src/components/custom-steps/prompt-editor/completion-options.ts`
- Test: `packages/web/src/components/custom-steps/prompt-editor/completion-options.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { buildInputCompletions, buildSlotCompletions } from "./completion-options.ts";

describe("buildInputCompletions", () => {
  it("closes the braces in the inserted label and shows type detail", () => {
    const c = buildInputCompletions([{ name: "pr", type: "string", required: true }]);
    expect(c[0].label).toBe("pr}}");
    expect(c[0].displayLabel).toBe("pr");
    expect(c[0].detail).toBe("string · required");
  });
});

describe("buildSlotCompletions", () => {
  it("uses the slot name as the label and marks optional", () => {
    const c = buildSlotCompletions([{ name: "GH_TOKEN", description: "GitHub token", optional: true }]);
    expect(c[0].label).toBe("GH_TOKEN");
    expect(c[0].detail).toBe("env · optional");
    expect(c[0].info).toBe("GitHub token");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @journeyman/web -- completion-options`
Expected: FAIL — cannot resolve `./completion-options.ts`.

- [ ] **Step 3: Write the implementation**

```ts
import type { Completion } from "@codemirror/autocomplete";
import type { CustomStepInputField, SecretSlotDef } from "@journeyman/core";

/** Completions offered after the user types `{{`. The label closes the braces. */
export function buildInputCompletions(fields: CustomStepInputField[]): Completion[] {
  return fields.map(f => ({
    label: `${f.name}}}`,
    displayLabel: f.name,
    type: "variable",
    detail: f.required ? `${f.type} · required` : f.type,
    info: f.description,
  }));
}

/** Completions offered after the user types `$`. */
export function buildSlotCompletions(slots: SecretSlotDef[]): Completion[] {
  return slots.map(s => ({
    label: s.name,
    type: "constant",
    detail: s.optional ? "env · optional" : "env",
    info: s.description,
  }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @journeyman/web -- completion-options`
Expected: PASS (2 tests). (`import type` is erased at runtime, so no CodeMirror module is loaded in node.)

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/custom-steps/prompt-editor/completion-options.ts packages/web/src/components/custom-steps/prompt-editor/completion-options.test.ts
git commit -m "feat(web): add autocomplete option builders for prompt editor"
```

---

## Task 6: `tokenAutocomplete.ts` — CodeMirror completion extension

No unit test (the source needs a live `CompletionContext`); the option builders are covered by Task 5 and behavior is verified in Task 11.

**Files:**
- Create: `packages/web/src/components/custom-steps/prompt-editor/tokenAutocomplete.ts`

- [ ] **Step 1: Write the implementation**

```ts
import {
  autocompletion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import type { CustomStepInputField, SecretSlotDef } from "@journeyman/core";
import { buildInputCompletions, buildSlotCompletions } from "./completion-options.ts";

/** Completion source: `{{` → input names; `$` → slot names. */
export function promptCompletionSource(fields: CustomStepInputField[], slots: SecretSlotDef[]) {
  const inputOpts = buildInputCompletions(fields);
  const slotOpts = buildSlotCompletions(slots);

  return (ctx: CompletionContext): CompletionResult | null => {
    const brace = ctx.matchBefore(/\{\{[A-Za-z0-9_]*$/);
    if (brace) {
      return { from: brace.from + 2, options: inputOpts, validFor: /^[A-Za-z0-9_]*$/ };
    }
    const dollar = ctx.matchBefore(/\$[A-Z0-9_]*$/);
    if (dollar) {
      return { from: dollar.from + 1, options: slotOpts, validFor: /^[A-Z0-9_]*$/ };
    }
    return null;
  };
}

export function tokenAutocomplete(fields: CustomStepInputField[], slots: SecretSlotDef[]) {
  return autocompletion({ override: [promptCompletionSource(fields, slots)] });
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck -w @journeyman/web`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/custom-steps/prompt-editor/tokenAutocomplete.ts
git commit -m "feat(web): add CodeMirror token autocomplete for prompt editor"
```

---

## Task 7: `prompt-preview-tokens.ts` — split text into token segments

**Files:**
- Create: `packages/web/src/components/custom-steps/prompt-editor/prompt-preview-tokens.ts`
- Test: `packages/web/src/components/custom-steps/prompt-editor/prompt-preview-tokens.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { splitTokens } from "./prompt-preview-tokens.ts";

describe("splitTokens", () => {
  it("splits inputs and slots out of surrounding text", () => {
    expect(splitTokens("Review {{pr}} with $GH_TOKEN now")).toEqual([
      { kind: "text", value: "Review " },
      { kind: "input", name: "pr" },
      { kind: "text", value: " with " },
      { kind: "slot", name: "GH_TOKEN" },
      { kind: "text", value: " now" },
    ]);
  });

  it("returns a single text segment when there are no tokens", () => {
    expect(splitTokens("plain text")).toEqual([{ kind: "text", value: "plain text" }]);
  });

  it("does not match $ following an identifier char", () => {
    expect(splitTokens("A$B")).toEqual([{ kind: "text", value: "A$B" }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @journeyman/web -- prompt-preview-tokens`
Expected: FAIL — cannot resolve `./prompt-preview-tokens.ts`.

- [ ] **Step 3: Write the implementation**

```ts
export type TokenSegment =
  | { kind: "text"; value: string }
  | { kind: "input"; name: string }
  | { kind: "slot"; name: string };

/** {{name}} OR $NAME (with a negative lookbehind so a preceding identifier char excludes it). */
const COMBINED = /\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}|(?<![A-Z0-9_])\$([A-Z][A-Z0-9_]*)/g;

/** Split a plain string into ordered text/input/slot segments. */
export function splitTokens(text: string): TokenSegment[] {
  const out: TokenSegment[] = [];
  let last = 0;
  for (const m of text.matchAll(COMBINED)) {
    const idx = m.index!;
    if (idx > last) out.push({ kind: "text", value: text.slice(last, idx) });
    if (m[1] !== undefined) out.push({ kind: "input", name: m[1] });
    else out.push({ kind: "slot", name: m[2] });
    last = idx + m[0].length;
  }
  if (last < text.length) out.push({ kind: "text", value: text.slice(last) });
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @journeyman/web -- prompt-preview-tokens`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/custom-steps/prompt-editor/prompt-preview-tokens.ts packages/web/src/components/custom-steps/prompt-editor/prompt-preview-tokens.test.ts
git commit -m "feat(web): add token splitter for prompt preview rendering"
```

---

## Task 8: `rehype-prompt-tokens.ts` — hast transform to chip spans

No unit test (operates on hast trees); covered by visual verification in Task 11. The `splitTokens` core it relies on is tested in Task 7.

**Files:**
- Create: `packages/web/src/components/custom-steps/prompt-editor/rehype-prompt-tokens.ts`

- [ ] **Step 1: Write the implementation**

```ts
import { splitTokens, type TokenSegment } from "./prompt-preview-tokens.ts";

/** Minimal hast shapes we touch — avoids a dependency on @types/hast. */
interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  children?: HastNode[];
  properties?: Record<string, unknown>;
}

export interface KnownNames {
  inputs: Set<string>;
  slots: Set<string>;
}

function nodeFor(seg: TokenSegment, known: KnownNames): HastNode {
  if (seg.kind === "text") return { type: "text", value: seg.value };
  const isInput = seg.kind === "input";
  const ok = isInput ? known.inputs.has(seg.name) : known.slots.has(seg.name);
  return {
    type: "element",
    tagName: "span",
    properties: {
      className: [
        "jm-token",
        isInput ? "jm-token-input" : "jm-token-slot",
        ok ? "jm-token-known" : "jm-token-unknown",
      ],
    },
    children: [{ type: "text", value: isInput ? seg.name : `$${seg.name}` }],
  };
}

/**
 * rehype plugin: replace token text in the rendered tree with styled <span>
 * chips. Skips the contents of <code>/<pre> so literal tokens in code fences
 * render as-is.
 */
export function rehypePromptTokens(known: KnownNames) {
  return (tree: HastNode) => {
    walk(tree, false);

    function walk(node: HastNode, inCode: boolean) {
      if (!node.children) return;
      const next: HastNode[] = [];
      for (const child of node.children) {
        const childInCode = inCode || child.tagName === "code" || child.tagName === "pre";
        if (child.type === "text" && !childInCode && child.value) {
          const segs = splitTokens(child.value);
          if (segs.length === 1 && segs[0].kind === "text") {
            next.push(child);
          } else {
            for (const s of segs) next.push(nodeFor(s, known));
          }
        } else {
          walk(child, childInCode);
          next.push(child);
        }
      }
      node.children = next;
    }
  };
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck -w @journeyman/web`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/custom-steps/prompt-editor/rehype-prompt-tokens.ts
git commit -m "feat(web): add rehype plugin rendering prompt tokens as chips"
```

---

## Task 9: `PromptCodeMirror.tsx`, `PromptPreview.tsx`, `TokenSidebar.tsx`

UI composition of the modules above. No unit tests; verified in Task 11.

**Files:**
- Create: `packages/web/src/components/custom-steps/prompt-editor/PromptCodeMirror.tsx`
- Create: `packages/web/src/components/custom-steps/prompt-editor/PromptPreview.tsx`
- Create: `packages/web/src/components/custom-steps/prompt-editor/TokenSidebar.tsx`

- [ ] **Step 1: Create `PromptCodeMirror.tsx`**

```tsx
import { forwardRef, useImperativeHandle, useMemo, useRef } from "react";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import type { CustomStepInputField, SecretSlotDef } from "@journeyman/core";
import { namesOf } from "./prompt-tokens.ts";
import { tokenHighlighter } from "./tokenHighlight.ts";
import { tokenAutocomplete } from "./tokenAutocomplete.ts";

export interface PromptCodeMirrorHandle {
  insertAtCursor: (snippet: string) => void;
}

// Token class names must match TOKEN_CLASS in token-ranges.ts.
const editorTheme = EditorView.theme(
  {
    "&": { backgroundColor: "transparent", color: "#e2e8f0", fontSize: "13px" },
    ".cm-content": {
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      caretColor: "#a5b4fc",
      lineHeight: "1.55",
    },
    ".cm-gutters": { backgroundColor: "transparent", color: "#475569", border: "none" },
    ".cm-token-input": { color: "#6ee7b7" },
    ".cm-token-slot": { color: "#a5b4fc" },
    ".cm-token-unknown": { color: "#fcd34d", textDecoration: "underline wavy #f59e0b" },
    "&.cm-focused": { outline: "none" },
    ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
      backgroundColor: "rgba(99,102,241,0.4)",
    },
  },
  { dark: true },
);

export const PromptCodeMirror = forwardRef<
  PromptCodeMirrorHandle,
  {
    value: string;
    onChange: (next: string) => void;
    inputFields: CustomStepInputField[];
    slots: SecretSlotDef[];
    height: string;
  }
>(function PromptCodeMirror({ value, onChange, inputFields, slots, height }, ref) {
  const cmRef = useRef<ReactCodeMirrorRef | null>(null);

  const extensions = useMemo(
    () => [
      markdown(),
      EditorView.lineWrapping,
      tokenHighlighter(namesOf(inputFields), namesOf(slots)),
      tokenAutocomplete(inputFields, slots),
      editorTheme,
    ],
    [inputFields, slots],
  );

  useImperativeHandle(
    ref,
    () => ({
      insertAtCursor(snippet: string) {
        const view = cmRef.current?.view;
        if (!view) {
          onChange(value + snippet);
          return;
        }
        const { from, to } = view.state.selection.main;
        view.dispatch({
          changes: { from, to, insert: snippet },
          selection: { anchor: from + snippet.length },
        });
        view.focus();
      },
    }),
    [value, onChange],
  );

  return (
    <CodeMirror
      ref={cmRef}
      value={value}
      height={height}
      theme="none"
      extensions={extensions}
      onChange={onChange}
      basicSetup={{ lineNumbers: true, foldGutter: false, highlightActiveLine: false }}
      placeholder="Write your prompt. Reference inputs with {{name}} and env secrets with $SLOT_NAME."
    />
  );
});
```

- [ ] **Step 2: Create `PromptPreview.tsx`**

```tsx
import { useMemo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { CustomStepInputField, SecretSlotDef } from "@journeyman/core";
import { namesOf } from "./prompt-tokens.ts";
import { rehypePromptTokens } from "./rehype-prompt-tokens.ts";

const chipBase =
  "inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-mono font-medium align-baseline";

const components: Components = {
  span: ({ node, className, children, ...props }) => {
    const cls = Array.isArray(node?.properties?.className)
      ? (node!.properties!.className as string[])
      : [];
    if (!cls.includes("jm-token")) {
      return (
        <span className={className} {...props}>
          {children}
        </span>
      );
    }
    const tone = cls.includes("jm-token-unknown")
      ? "bg-amber-950/40 text-amber-300 border border-amber-900/50"
      : cls.includes("jm-token-input")
        ? "bg-emerald-950/40 text-emerald-300 border border-emerald-900/50"
        : "bg-indigo-950/40 text-indigo-300 border border-indigo-900/50";
    return <span className={`${chipBase} ${tone}`}>{children}</span>;
  },
};

export function PromptPreview({
  value,
  inputFields,
  slots,
}: {
  value: string;
  inputFields: CustomStepInputField[];
  slots: SecretSlotDef[];
}) {
  const rehypePlugins = useMemo(
    () => [rehypePromptTokens({ inputs: namesOf(inputFields), slots: namesOf(slots) })],
    [inputFields, slots],
  );

  if (!value.trim()) {
    return <div className="text-slate-500 italic text-sm p-3">Nothing to preview yet.</div>;
  }

  return (
    <div className="prose prose-invert prose-sm max-w-none p-3 overflow-auto">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={rehypePlugins} components={components}>
        {value}
      </ReactMarkdown>
    </div>
  );
}
```

- [ ] **Step 3: Create `TokenSidebar.tsx`**

```tsx
import type { CustomStepInputField, SecretSlotDef } from "@journeyman/core";
import { Variable, KeyRound } from "lucide-react";
import type { ReferenceAnalysis } from "./prompt-tokens.ts";

export function TokenSidebar({
  inputFields,
  slots,
  used,
  onInsert,
}: {
  inputFields: CustomStepInputField[];
  slots: SecretSlotDef[];
  used: ReferenceAnalysis;
  onInsert: (snippet: string) => void;
}) {
  return (
    <aside className="border-t lg:border-t-0 lg:border-l border-slate-800 bg-slate-900/40 overflow-y-auto p-3 text-xs space-y-4">
      <section>
        <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-slate-400 mb-2">
          <Variable className="w-3.5 h-3.5 text-emerald-400" />
          <span>Inputs</span>
          {inputFields.length > 0 && (
            <span className="ml-auto text-[10px] text-slate-500">click to insert</span>
          )}
        </div>
        {inputFields.length === 0 ? (
          <div className="text-slate-500 italic">No inputs declared</div>
        ) : (
          <ul className="space-y-1">
            {inputFields.map(f => {
              const isUsed = used.inputs.has(f.name);
              return (
                <li key={f.name}>
                  <button
                    type="button"
                    onClick={() => onInsert(`{{${f.name}}}`)}
                    className={
                      "w-full text-left font-mono rounded px-2 py-1 transition flex items-center gap-2 " +
                      (isUsed
                        ? "text-emerald-300 bg-emerald-950/30 hover:bg-emerald-950/50"
                        : "text-slate-400 hover:text-emerald-300 hover:bg-slate-800/60")
                    }
                    title={f.description || `${f.type}${f.required ? " · required" : ""}`}
                  >
                    <span className="truncate">{`{{${f.name}}}`}</span>
                    {isUsed && <span className="ml-auto text-[10px] text-emerald-400">used</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section>
        <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-slate-400 mb-2">
          <KeyRound className="w-3.5 h-3.5 text-indigo-400" />
          <span>Env in $bash</span>
          {slots.length > 0 && (
            <span className="ml-auto text-[10px] text-slate-500">click to insert</span>
          )}
        </div>
        {slots.length === 0 ? (
          <div className="text-slate-500 italic">No slots declared</div>
        ) : (
          <ul className="space-y-1">
            {slots.map(s => {
              const isUsed = used.slots.has(s.name);
              return (
                <li key={s.name}>
                  <button
                    type="button"
                    onClick={() => onInsert(`$${s.name}`)}
                    className={
                      "w-full text-left font-mono rounded px-2 py-1 transition flex items-center gap-2 " +
                      (isUsed
                        ? "text-indigo-300 bg-indigo-950/30 hover:bg-indigo-950/50"
                        : "text-slate-400 hover:text-indigo-300 hover:bg-slate-800/60")
                    }
                    title={s.description}
                  >
                    <span className="truncate">${s.name}</span>
                    {isUsed && <span className="ml-auto text-[10px] text-indigo-400">used</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </aside>
  );
}
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck -w @journeyman/web`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/custom-steps/prompt-editor/PromptCodeMirror.tsx packages/web/src/components/custom-steps/prompt-editor/PromptPreview.tsx packages/web/src/components/custom-steps/prompt-editor/TokenSidebar.tsx
git commit -m "feat(web): add CodeMirror editor, markdown preview, and token sidebar"
```

---

## Task 10: `PromptEditor.tsx` container + wire into the modal

**Files:**
- Create: `packages/web/src/components/custom-steps/prompt-editor/PromptEditor.tsx`
- Delete: `packages/web/src/components/custom-steps/PromptEditor.tsx`
- Modify: `packages/web/src/components/custom-steps/EditCustomStepModal.tsx:14`

- [ ] **Step 1: Create the new container `prompt-editor/PromptEditor.tsx`**

```tsx
import { useMemo, useRef, useState } from "react";
import type { CustomStepInputField, SecretSlotDef } from "@journeyman/core";
import { Maximize2, Minimize2, AlertTriangle, Pencil, Eye } from "lucide-react";
import { analyzeReferences, namesOf } from "./prompt-tokens.ts";
import { PromptCodeMirror, type PromptCodeMirrorHandle } from "./PromptCodeMirror.tsx";
import { PromptPreview } from "./PromptPreview.tsx";
import { TokenSidebar } from "./TokenSidebar.tsx";

export interface PromptEditorProps {
  value: string;
  onChange: (next: string) => void;
  inputFields: CustomStepInputField[];
  slots: SecretSlotDef[];
}

type Mode = "edit" | "preview";

export function PromptEditor({ value, onChange, inputFields, slots }: PromptEditorProps) {
  const cmRef = useRef<PromptCodeMirrorHandle | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [mode, setMode] = useState<Mode>("edit");

  const refs = useMemo(
    () => analyzeReferences(value, namesOf(inputFields), namesOf(slots)),
    [value, inputFields, slots],
  );

  const wrapperCls = fullscreen
    ? "fixed inset-4 z-[70] bg-slate-950 border border-slate-700 rounded-xl shadow-2xl flex flex-col"
    : "flex flex-col rounded-md border border-slate-700 bg-slate-900/50 overflow-hidden";

  const tabBtn = (active: boolean) =>
    "inline-flex items-center gap-1 px-2.5 py-1 transition " +
    (active ? "bg-slate-800 text-slate-100" : "text-slate-400 hover:text-slate-200");

  return (
    <>
      {fullscreen && <div className="fixed inset-0 z-[65] bg-black/70" />}
      <div className={wrapperCls}>
        {/* Header: Edit/Preview toggle + fullscreen */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-slate-800 bg-slate-900/70">
          <div className="inline-flex rounded-md border border-slate-700 overflow-hidden text-xs">
            <button type="button" onClick={() => setMode("edit")} className={tabBtn(mode === "edit")}>
              <Pencil className="w-3.5 h-3.5" /> Edit
            </button>
            <button
              type="button"
              onClick={() => setMode("preview")}
              className={"border-l border-slate-700 " + tabBtn(mode === "preview")}
            >
              <Eye className="w-3.5 h-3.5" /> Preview
            </button>
          </div>
          <button
            type="button"
            onClick={() => setFullscreen(f => !f)}
            className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200 px-2 py-1 rounded hover:bg-slate-800/60 transition"
            title={fullscreen ? "Exit fullscreen" : "Expand to fullscreen"}
          >
            {fullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            {fullscreen ? "Exit" : "Expand"}
          </button>
        </div>

        {/* Body */}
        <div
          className={
            `grid ${fullscreen ? "flex-1 min-h-0" : "h-[460px]"} ` +
            (mode === "edit" ? "grid-cols-1 lg:grid-cols-[1fr_220px]" : "grid-cols-1")
          }
        >
          <div className="min-w-0 overflow-auto bg-slate-950">
            {mode === "edit" ? (
              <PromptCodeMirror
                ref={cmRef}
                value={value}
                onChange={onChange}
                inputFields={inputFields}
                slots={slots}
                height={fullscreen ? "100%" : "460px"}
              />
            ) : (
              <PromptPreview value={value} inputFields={inputFields} slots={slots} />
            )}
          </div>

          {mode === "edit" && (
            <TokenSidebar
              inputFields={inputFields}
              slots={slots}
              used={refs}
              onInsert={snippet => cmRef.current?.insertAtCursor(snippet)}
            />
          )}
        </div>

        {/* Footer: unknown-token summary */}
        {(refs.unknownInputs.length > 0 || refs.unknownSlots.length > 0) && (
          <div className="flex items-start gap-2 border-t border-slate-800 bg-amber-950/20 text-amber-200 text-xs px-3 py-2">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <div className="space-y-0.5">
              {refs.unknownInputs.length > 0 && (
                <div>
                  Unknown input token(s):{" "}
                  {refs.unknownInputs.map((n, i) => (
                    <span key={n}>
                      {i > 0 && ", "}
                      <code className="text-amber-300">{`{{${n}}}`}</code>
                    </span>
                  ))}{" "}
                  — declare them in the Inputs tab or fix the spelling.
                </div>
              )}
              {refs.unknownSlots.length > 0 && (
                <div>
                  Unknown env token(s):{" "}
                  {refs.unknownSlots.map((n, i) => (
                    <span key={n}>
                      {i > 0 && ", "}
                      <code className="text-amber-300">${n}</code>
                    </span>
                  ))}{" "}
                  — declare them in the Secrets tab if you want them injected.
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
```

- [ ] **Step 2: Delete the old editor**

Run: `git rm packages/web/src/components/custom-steps/PromptEditor.tsx`
Expected: file removed.

- [ ] **Step 3: Update the modal import**

In `packages/web/src/components/custom-steps/EditCustomStepModal.tsx`, change line 14:
```tsx
import { PromptEditor } from "./PromptEditor.tsx";
```
to:
```tsx
import { PromptEditor } from "./prompt-editor/PromptEditor.tsx";
```
(The `<PromptEditor ... />` usage at the `prompt` tab is unchanged — props are identical.)

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck -w @journeyman/web`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/custom-steps/prompt-editor/PromptEditor.tsx packages/web/src/components/custom-steps/EditCustomStepModal.tsx
git commit -m "feat(web): wire new prompt editor container into custom-step modal"
```

---

## Task 11: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full pure-logic test suite**

Run: `npm test -w @journeyman/web`
Expected: PASS — 4 test files (prompt-tokens, token-ranges, completion-options, prompt-preview-tokens), 11 tests total.

- [ ] **Step 2: Typecheck the whole web package**

Run: `npm run typecheck -w @journeyman/web`
Expected: PASS, no errors.

- [ ] **Step 3: Import-boundary check**

Run: `npm run check:boundaries`
Expected: PASS (no new `@journeyman/*` cross-layer imports were introduced).

- [ ] **Step 4: Production build**

Run: `npm run build -w @journeyman/web`
Expected: Vite build succeeds.

- [ ] **Step 5: Manual verification in the browser preview**

Start the dev server (`preview_start` / `npm run dev:web`), open a custom step's editor (`/me/custom-steps` → New custom step → Inputs tab: add an input named `pr`; Secrets tab: add a slot `GH_TOKEN`; Prompt tab). Confirm:
  1. **Editing:** typing markdown shows line numbers, soft-wrap, mono font.
  2. **Highlighting:** `{{pr}}` renders green, `$GH_TOKEN` indigo; `{{nope}}` / `$BAD` get an amber squiggle.
  3. **Autocomplete:** typing `{{` lists `pr` (inserts `pr}}`); typing `$` lists `GH_TOKEN`.
  4. **Sidebar:** clicking an input/slot inserts it at the cursor; "used" badges appear.
  5. **Footer:** undeclared tokens are listed with the "declare in the Inputs/Secrets tab" guidance.
  6. **Preview tab:** markdown renders formatted (headings/lists/bold); `{{pr}}` shows as a green chip, `$GH_TOKEN` an indigo chip, unknowns amber; tokens inside a code fence stay literal; the sidebar is hidden.
  7. **Fullscreen:** Expand/Exit toggles the overlay; editor fills the space.
  8. **Round-trip:** Save the step, reopen it — `promptTemplate` is unchanged.

Capture a screenshot of the Edit and Preview states as proof.

- [ ] **Step 6: Final commit (if any verification fixes were needed)**

```bash
git add -A
git commit -m "test(web): verify prompt editor end-to-end"
```

---

## Self-Review Notes

- **Spec coverage:** markdown preview (Tasks 7–9, 10), token autocomplete (Tasks 5–6, 9), token highlighting incl. unknown squiggle (Tasks 3–4, 9), ergonomics (Task 9 basicSetup/lineWrapping), kept sidebar (Task 9, wired Task 10), tokens-as-chips in preview (Tasks 7–9), plain-string data model preserved (props unchanged, Task 10), inline + footer validation (Tasks 4 & 10). All covered.
- **Reconfiguration risk (from spec):** resolved by `useMemo([inputFields, slots])` on the CodeMirror `extensions` prop in `PromptCodeMirror.tsx` — `@uiw/react-codemirror` reconfigures when the extensions identity changes, so adding/renaming inputs/slots updates highlighting and autocomplete without remounting.
- **Test isolation:** all CodeMirror-importing modules (`tokenHighlight`, `tokenAutocomplete`) are separated from their pure cores (`token-ranges`, `completion-options`) so unit tests run in node without jsdom.
- **Type consistency:** `PromptCodeMirrorHandle.insertAtCursor`, `ReferenceAnalysis`, `TokenSegment`, `TOKEN_CLASS`, and `KnownNames` are defined once and reused; the editor theme's `.cm-token-*` selectors match `TOKEN_CLASS` string values (noted with a comment in `PromptCodeMirror.tsx`).
