# Typed Input Value Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users supply typed literal values (string/number/boolean/JSON) for step inputs via a per-field `Value | @ Reference` toggle, alongside the existing `@` reference binding.

**Architecture:** A new shared `InputValueEditor` component (in `@journeyman/flow-editor`) owns the mode toggle and picks a literal editor from the input's declared `Shape`. All serialization to `WorkflowInputValue` lives in a separate pure module (`input-value-serialize.ts`) so it is unit-testable. The two typed call sites — `CustomAiConfigForm` and `ConfigTab`'s bind-only section — adopt the component and persist to `node.inputs`. `MentionInput` and the engine are untouched. Publish-time validation in `@journeyman/core` is extended to type-check literal values.

**Tech Stack:** React 18 + TypeScript, `@journeyman/core` shared types, vitest (core tests), `tsx` + `node:assert` scripts (flow-editor tests).

**Constraints (per request):** No git commits in any step. The final task runs `npm run typecheck`.

**Spec:** `docs/superpowers/specs/2026-06-01-typed-input-value-editor-design.md`

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/flow-editor/src/properties-panel/input-value-serialize.ts` | **New.** Pure functions: mode/widget derivation, `Segment[]` ⇄ `WorkflowInputValue`, JSON literal parse/stringify. No React. |
| `packages/flow-editor/src/properties-panel/input-value-serialize.test.ts` | **New.** `tsx`/assert tests for the pure module. |
| `packages/flow-editor/src/properties-panel/InputValueEditor.tsx` | **New.** React component: `Value \| @ Reference` toggle + per-type editor. Uses the pure module + `MentionInput`. |
| `packages/flow-editor/src/index.ts` | Export `InputValueEditor`. |
| `packages/flow-editor/src/styles.css` | Toggle + literal-widget styling. |
| `packages/steps/src/custom/CustomAiConfigForm.tsx` | Replace per-input `MentionInput` with `InputValueEditor`; "has value" check covers all kinds. |
| `packages/flow-editor/src/properties-panel/ConfigTab.tsx` | Replace bind-only `MentionInput` with `InputValueEditor`; persist all kinds to `node.inputs`. |
| `packages/core/src/utils/validate-workflow.ts` | Add `literalMatchesShape` + a literal type-mismatch warning. |
| `packages/core/src/utils/validate-workflow.literal.test.ts` | **New.** vitest tests for literal validation. |
| `packages/core/src/index.ts` | Export `literalMatchesShape`. |

---

## Task 1: Pure serialization module

**Files:**
- Create: `packages/flow-editor/src/properties-panel/input-value-serialize.ts`
- Test: `packages/flow-editor/src/properties-panel/input-value-serialize.test.ts`

This module holds every value-shaping decision so the React component stays thin and the logic is testable under the `tsx` convention already used by `mention-serialize.test.ts`.

- [ ] **Step 1: Write the failing test**

Create `packages/flow-editor/src/properties-panel/input-value-serialize.test.ts`:

```ts
import assert from "node:assert/strict";
import type { Shape, WorkflowInputValue } from "@journeyman/core";
import {
  modeForValue, widgetForShape, jsonContainerForShape,
  refSegmentsToInput, valueSegmentsToInput,
  inputToValueSegments, inputToRefSegments,
  parseJsonLiteral, jsonLiteralToText,
  numberLiteralValue, booleanLiteralValue,
} from "./input-value-serialize.ts";

// modeForValue
assert.equal(modeForValue(undefined), "reference");
assert.equal(modeForValue({ kind: "ref", ref: "a.output.x" }), "reference");
assert.equal(modeForValue({ kind: "literal", value: 1 }), "value");
assert.equal(modeForValue({ kind: "template", template: "x${a.output.y}" }), "value");

// widgetForShape
assert.equal(widgetForShape(undefined), "string");
assert.equal(widgetForShape({ type: "string" }), "string");
assert.equal(widgetForShape({ type: "number" }), "number");
assert.equal(widgetForShape({ type: "boolean" }), "boolean");
assert.equal(widgetForShape({ type: "json", container: "object" }), "json");
assert.equal(widgetForShape({ type: "json", container: "array" }), "json");
assert.equal(widgetForShape({ type: "array", items: { type: "string" } }), "json");
assert.equal(widgetForShape({ type: "object", fields: {} }), "json");

// jsonContainerForShape
assert.equal(jsonContainerForShape({ type: "json", container: "array" }), "array");
assert.equal(jsonContainerForShape({ type: "array", items: { type: "string" } }), "array");
assert.equal(jsonContainerForShape({ type: "json", container: "object" }), "object");
assert.equal(jsonContainerForShape(undefined), "object");

// refSegmentsToInput
assert.deepEqual(refSegmentsToInput([{ kind: "ref", ref: "a.output.x" }]), { kind: "ref", ref: "a.output.x" });
assert.equal(refSegmentsToInput([]), undefined);
assert.equal(refSegmentsToInput([{ kind: "text", text: "hi" }]), undefined);

// valueSegmentsToInput (string Value mode)
assert.deepEqual(valueSegmentsToInput([{ kind: "text", text: "hello" }]), { kind: "literal", value: "hello" });
assert.deepEqual(valueSegmentsToInput([{ kind: "ref", ref: "a.output.x" }]), { kind: "ref", ref: "a.output.x" });
assert.deepEqual(
  valueSegmentsToInput([{ kind: "text", text: "PR-" }, { kind: "ref", ref: "a.output.id" }]),
  { kind: "template", template: "PR-${a.output.id}" },
);
assert.equal(valueSegmentsToInput([]), undefined);
assert.equal(valueSegmentsToInput([{ kind: "text", text: "" }]), undefined);

// inputToValueSegments
assert.deepEqual(inputToValueSegments(undefined), []);
assert.deepEqual(inputToValueSegments({ kind: "ref", ref: "a.output.x" }), [{ kind: "ref", ref: "a.output.x" }]);
assert.deepEqual(inputToValueSegments({ kind: "template", template: "PR-${a.output.id}" }), [
  { kind: "text", text: "PR-" }, { kind: "ref", ref: "a.output.id" },
]);
assert.deepEqual(inputToValueSegments({ kind: "literal", value: "hi" }), [{ kind: "text", text: "hi" }]);
assert.deepEqual(inputToValueSegments({ kind: "literal", value: 5 } as WorkflowInputValue), []);

// inputToRefSegments
assert.deepEqual(inputToRefSegments({ kind: "ref", ref: "a.output.x" }), [{ kind: "ref", ref: "a.output.x" }]);
assert.deepEqual(inputToRefSegments({ kind: "literal", value: "hi" }), []);

// parseJsonLiteral
assert.deepEqual(parseJsonLiteral('{"a":1}', "object"), { ok: true, value: { a: 1 } });
assert.deepEqual(parseJsonLiteral("[1,2]", "array"), { ok: true, value: [1, 2] });
assert.equal(parseJsonLiteral("[1,2]", "object").ok, false);   // array in object slot
assert.equal(parseJsonLiteral('{"a":1}', "array").ok, false);  // object in array slot
assert.equal(parseJsonLiteral("not json", "object").ok, false);
assert.equal(parseJsonLiteral("", "object").ok, false);
assert.equal(parseJsonLiteral("null", "object").ok, false);

// jsonLiteralToText
assert.equal(jsonLiteralToText({ kind: "literal", value: { a: 1 } }), JSON.stringify({ a: 1 }, null, 2));
assert.equal(jsonLiteralToText(undefined), "");
assert.equal(jsonLiteralToText({ kind: "ref", ref: "a.output.x" }), "");

// numberLiteralValue / booleanLiteralValue
assert.equal(numberLiteralValue({ kind: "literal", value: 42 }), 42);
assert.equal(numberLiteralValue({ kind: "literal", value: "x" } as WorkflowInputValue), undefined);
assert.equal(booleanLiteralValue({ kind: "literal", value: true }), true);
assert.equal(booleanLiteralValue({ kind: "literal", value: false }), false);
assert.equal(booleanLiteralValue(undefined), undefined);

// silence unused Shape import lint in case the runner is strict
const _s: Shape = { type: "string" }; void _s;

console.log("input-value-serialize: ok");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx packages/flow-editor/src/properties-panel/input-value-serialize.test.ts`
Expected: FAIL — `Cannot find module './input-value-serialize.ts'` (the module does not exist yet).

- [ ] **Step 3: Write the module**

Create `packages/flow-editor/src/properties-panel/input-value-serialize.ts`:

```ts
import type { Shape, WorkflowInputValue } from "@journeyman/core";
import { parseTemplate, segmentsToTemplate, soleRefOf, type Segment } from "./mention-serialize.ts";

export type InputMode = "value" | "reference";

/** Which literal-mode widget a field's expected shape calls for. */
export type LiteralWidget = "string" | "number" | "boolean" | "json";

/** Initial editor mode derived from the stored value. Empty → reference. */
export function modeForValue(value: WorkflowInputValue | undefined): InputMode {
  if (value?.kind === "ref") return "reference";
  if (value?.kind === "literal" || value?.kind === "template") return "value";
  return "reference";
}

/** Map an expected Shape to the literal-mode widget. Defaults to string. */
export function widgetForShape(expected: Shape | undefined): LiteralWidget {
  switch (expected?.type) {
    case "number": return "number";
    case "boolean": return "boolean";
    case "json":
    case "object":
    case "array": return "json";
    default: return "string";
  }
}

/** JSON container expected by a shape, defaulting to "object". */
export function jsonContainerForShape(expected: Shape | undefined): "object" | "array" {
  if (expected?.type === "json") return expected.container;
  if (expected?.type === "array") return "array";
  return "object";
}

/** Reference mode → a single ref, or nothing. */
export function refSegmentsToInput(segs: Segment[]): WorkflowInputValue | undefined {
  const ref = soleRefOf(segs);
  return ref ? { kind: "ref", ref } : undefined;
}

/**
 * String Value mode → literal text, template (text + refs), a normalized sole
 * ref, or undefined when empty.
 */
export function valueSegmentsToInput(segs: Segment[]): WorkflowInputValue | undefined {
  const sole = soleRefOf(segs);
  if (sole) return { kind: "ref", ref: sole };
  const hasRef = segs.some(s => s.kind === "ref");
  const template = segmentsToTemplate(segs);
  if (template === "") return undefined;
  return hasRef ? { kind: "template", template } : { kind: "literal", value: template };
}

/** Initial segments for the string Value-mode editor from a stored value. */
export function inputToValueSegments(value: WorkflowInputValue | undefined): Segment[] {
  if (!value) return [];
  if (value.kind === "ref") return [{ kind: "ref", ref: value.ref }];
  if (value.kind === "template") return parseTemplate(value.template);
  if (value.kind === "literal" && typeof value.value === "string") return [{ kind: "text", text: value.value }];
  return [];
}

/** Initial segments for the reference-mode editor. */
export function inputToRefSegments(value: WorkflowInputValue | undefined): Segment[] {
  return value?.kind === "ref" ? [{ kind: "ref", ref: value.ref }] : [];
}

export type JsonParseResult =
  | { ok: true; value: unknown }
  | { ok: false; error: string };

/** Parse raw textarea text into a JSON literal of the expected container. */
export function parseJsonLiteral(raw: string, container: "object" | "array"): JsonParseResult {
  if (raw.trim() === "") return { ok: false, error: "Enter JSON" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  const isArray = Array.isArray(parsed);
  if (container === "array" && !isArray) return { ok: false, error: "Expected a JSON array" };
  if (container === "object" && (isArray || parsed === null || typeof parsed !== "object")) {
    return { ok: false, error: "Expected a JSON object" };
  }
  return { ok: true, value: parsed };
}

/** Stringify an existing literal value for the JSON textarea buffer. */
export function jsonLiteralToText(value: WorkflowInputValue | undefined): string {
  if (value?.kind === "literal" && value.value !== undefined) {
    try { return JSON.stringify(value.value, null, 2); } catch { return ""; }
  }
  return "";
}

export function numberLiteralValue(value: WorkflowInputValue | undefined): number | undefined {
  return value?.kind === "literal" && typeof value.value === "number" ? value.value : undefined;
}

export function booleanLiteralValue(value: WorkflowInputValue | undefined): boolean | undefined {
  return value?.kind === "literal" && typeof value.value === "boolean" ? value.value : undefined;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx packages/flow-editor/src/properties-panel/input-value-serialize.test.ts`
Expected: PASS — prints `input-value-serialize: ok`, exits 0.

- [ ] **Step 5: Verify (no commit — per request)**

Do **not** commit. Leave changes in the working tree.

---

## Task 2: Literal shape validation in `@journeyman/core`

**Files:**
- Modify: `packages/core/src/utils/validate-workflow.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/src/utils/validate-workflow.literal.test.ts`

A literal value can now reach a typed input slot, so publish-time validation must type-check it. We reuse the existing `shape-mismatch` warning code (its `ref` field is set to `""` for literals) to avoid extending the `WorkflowSaveWarning` union and every consumer.

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/utils/validate-workflow.literal.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { literalMatchesShape, validateWorkflowInputs, type ValidationCatalog } from "./validate-workflow.ts";
import type { WorkflowGraph, WorkflowInputValue } from "../types/flow.types.ts";

describe("literalMatchesShape", () => {
  it("matches primitives", () => {
    expect(literalMatchesShape("x", { type: "string" })).toBe(true);
    expect(literalMatchesShape(1, { type: "string" })).toBe(false);
    expect(literalMatchesShape(1, { type: "number" })).toBe(true);
    expect(literalMatchesShape("1", { type: "number" })).toBe(false);
    expect(literalMatchesShape(true, { type: "boolean" })).toBe(true);
    expect(literalMatchesShape("true", { type: "boolean" })).toBe(false);
  });
  it("matches json containers", () => {
    expect(literalMatchesShape({ a: 1 }, { type: "json", container: "object" })).toBe(true);
    expect(literalMatchesShape([1], { type: "json", container: "object" })).toBe(false);
    expect(literalMatchesShape([1], { type: "json", container: "array" })).toBe(true);
    expect(literalMatchesShape({ a: 1 }, { type: "json", container: "array" })).toBe(false);
    expect(literalMatchesShape(null, { type: "json", container: "object" })).toBe(false);
  });
  it("is permissive for unresolved ref shapes", () => {
    expect(literalMatchesShape(123, { type: "ref", name: "Whatever" })).toBe(true);
  });
});

function flowWithLiteral(value: WorkflowInputValue): WorkflowGraph {
  return {
    schemaVersion: "v1",
    nodes: [
      { id: "start", type: "start", displayName: "Start", config: {}, position: { x: 0, y: 0 } },
      {
        id: "n1", type: "step", stepType: "demo", displayName: "Demo",
        config: {}, inputs: { count: value }, position: { x: 100, y: 0 },
      },
      { id: "end", type: "end", displayName: "End", config: {}, position: { x: 200, y: 0 } },
    ],
    edges: [
      { id: "e1", source: "start", target: "n1", type: "default" },
      { id: "e2", source: "n1", target: "end", type: "default" },
    ],
  } as unknown as WorkflowGraph;
}

const catalog: ValidationCatalog = {
  demo: { inputFields: { count: { shape: { type: "number" }, required: true } }, outputSchema: null },
};

describe("validateWorkflowInputs literal type-checking", () => {
  it("accepts a literal of the right type", () => {
    const w = validateWorkflowInputs(flowWithLiteral({ kind: "literal", value: 5 }), catalog);
    expect(w.filter(x => x.code === "shape-mismatch")).toHaveLength(0);
  });
  it("flags a literal of the wrong type", () => {
    const w = validateWorkflowInputs(flowWithLiteral({ kind: "literal", value: "five" }), catalog);
    const mismatch = w.find(x => x.code === "shape-mismatch" && x.inputKey === "count");
    expect(mismatch).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/src/utils/validate-workflow.literal.test.ts`
Expected: FAIL — `literalMatchesShape` is not exported (import error), and the wrong-type case finds no mismatch.

- [ ] **Step 3: Add the helper and the validation check**

In `packages/core/src/utils/validate-workflow.ts`, add this exported helper just below `validateInputBinding` (after line 66):

```ts
/** Short JS-type tag for an arbitrary literal value, for warning messages. */
function jsTypeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

/**
 * Does a literal value satisfy the declared input Shape? Used to type-check
 * literal (typed-in) input values at publish time. Permissive for unresolved
 * "ref" shapes.
 */
export function literalMatchesShape(value: unknown, expected: Shape): boolean {
  switch (expected.type) {
    case "string":  return typeof value === "string";
    case "number":  return typeof value === "number";
    case "boolean": return typeof value === "boolean";
    case "json":
      return expected.container === "array"
        ? Array.isArray(value)
        : value !== null && typeof value === "object" && !Array.isArray(value);
    case "object":
      return value !== null && typeof value === "object" && !Array.isArray(value);
    case "array":
      return Array.isArray(value);
    case "ref":
      return true;
  }
}
```

Then, inside `validateWorkflowInputs`, locate the block that computes `hasLiteral` (around line 224) and add a type-check immediately after the missing-value `continue` block — i.e. right before `const refsToCheck: ...` (line 242). Insert:

```ts
      if (hasLiteral && inputValue!.kind === "literal" && !literalMatchesShape(inputValue!.value, expected)) {
        warnings.push({
          code: "shape-mismatch",
          message: `${node.id}.${key}: literal value (${jsTypeOf(inputValue!.value)}) does not match expected ${shapeTag(expected)}`,
          nodeId: node.id,
          inputKey: key,
          ref: "",
          expected: shapeTag(expected),
          actual: jsTypeOf(inputValue!.value),
        });
      }
```

- [ ] **Step 4: Export the helper from core's barrel**

In `packages/core/src/index.ts`, find the line that exports `validateInputBinding` (line 176) and add `literalMatchesShape` to the same export. For example, change:

```ts
  validateInputBinding,
```

to:

```ts
  validateInputBinding,
  literalMatchesShape,
```

(Confirm the surrounding `export { ... } from "./utils/validate-workflow.ts";` block — add `literalMatchesShape` to that block's named exports.)

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run packages/core/src/utils/validate-workflow.literal.test.ts`
Expected: PASS — all `describe` blocks green.

- [ ] **Step 6: Run the existing core validation tests (no regressions)**

Run: `npx vitest run packages/core/src/utils/validate-workflow.skills-required.test.ts packages/core/src/utils/validate-workflow.attribute.test.ts packages/core/src/utils/validate-workflow.mcp-required.test.ts`
Expected: PASS.

- [ ] **Step 7: Verify (no commit — per request)**

Do **not** commit.

---

## Task 3: `InputValueEditor` component

**Files:**
- Create: `packages/flow-editor/src/properties-panel/InputValueEditor.tsx`
- Modify: `packages/flow-editor/src/index.ts`

The component is presentational glue over Task 1's pure module + `MentionInput`. There is no React test runner in this repo (flow-editor tests are `tsx`/assert scripts on pure logic), so this component is verified by `tsx`-compile and the final typecheck. All branching logic it relies on is already unit-tested in Task 1.

> **Note on the JSON buffer:** the textarea keeps a local `jsonText` state so invalid in-progress JSON is not lost. A guarded `useEffect` re-syncs the buffer only when the committed `value` changes to something the buffer doesn't already represent. This is safe **only if call sites pass a referentially-stable `value`** (i.e. `node.inputs[key]` does not get a new object identity on every render). Both call sites (Tasks 4 and 5) satisfy this — `CustomAiConfigForm` memoizes `inputs`, and `ConfigTab` reads from the stable `node.inputs` object.

- [ ] **Step 1: Write the component**

Create `packages/flow-editor/src/properties-panel/InputValueEditor.tsx`:

```tsx
import { useEffect, useState } from "react";
import type { Shape, WorkflowInputValue } from "@journeyman/core";
import { MentionInput } from "./MentionInput.tsx";
import type { MentionField } from "./mention-fields.ts";
import {
  modeForValue, widgetForShape, jsonContainerForShape,
  refSegmentsToInput, valueSegmentsToInput,
  inputToValueSegments, inputToRefSegments,
  parseJsonLiteral, jsonLiteralToText,
  numberLiteralValue, booleanLiteralValue,
  type InputMode,
} from "./input-value-serialize.ts";

interface Props {
  value: WorkflowInputValue | undefined;
  expected: Shape | undefined;
  fields: MentionField[];
  readOnly?: boolean;
  required?: boolean;
  placeholder?: string;
  onChange: (next: WorkflowInputValue | undefined) => void;
}

export function InputValueEditor({ value, expected, fields, readOnly, required, placeholder, onChange }: Props) {
  const [mode, setMode] = useState<InputMode>(() => modeForValue(value));
  const widget = widgetForShape(expected);
  const container = jsonContainerForShape(expected);

  const [jsonText, setJsonText] = useState<string>(() => jsonLiteralToText(value));
  const [jsonError, setJsonError] = useState<string | null>(null);

  // Re-sync the JSON buffer when the committed value changes externally
  // (e.g. selecting a different node). No-op while the buffer already encodes
  // the current value, so the user's own typing is never clobbered.
  useEffect(() => {
    if (widget !== "json") return;
    const parsed = parseJsonLiteral(jsonText, container);
    const bufMatches =
      parsed.ok && value?.kind === "literal" &&
      JSON.stringify(parsed.value) === JSON.stringify(value.value);
    if (!bufMatches) setJsonText(jsonLiteralToText(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const switchMode = (next: InputMode) => {
    if (next === mode) return;
    setMode(next);
    onChange(undefined); // clear to avoid kind/widget mismatch across modes
    if (next === "value" && widget === "json") { setJsonText(""); setJsonError(null); }
  };

  return (
    <div className="je-input-value">
      {!readOnly && (
        <div className="je-input-value__modes" role="tablist">
          <button
            type="button" role="tab" aria-selected={mode === "value"}
            className={`je-input-value__mode${mode === "value" ? " je-input-value__mode--active" : ""}`}
            onClick={() => switchMode("value")}
          >Value</button>
          <button
            type="button" role="tab" aria-selected={mode === "reference"}
            className={`je-input-value__mode${mode === "reference" ? " je-input-value__mode--active" : ""}`}
            onClick={() => switchMode("reference")}
          >@ Reference</button>
        </div>
      )}

      {mode === "reference" && (
        <MentionInput
          value={inputToRefSegments(value)}
          fields={fields}
          readOnly={readOnly}
          expected={expected}
          placeholder={placeholder ?? (required ? "Required — @ to bind from upstream" : "@ to bind from upstream")}
          onChange={segs => onChange(refSegmentsToInput(segs))}
        />
      )}

      {mode === "value" && widget === "string" && (
        <MentionInput
          value={inputToValueSegments(value)}
          fields={fields}
          readOnly={readOnly}
          expected={expected}
          placeholder={placeholder ?? "Type a value, or @ to insert a reference"}
          onChange={segs => onChange(valueSegmentsToInput(segs))}
        />
      )}

      {mode === "value" && widget === "number" && (
        <input
          type="number"
          className="je-input-value__number"
          disabled={readOnly}
          value={numberLiteralValue(value) ?? ""}
          placeholder={placeholder ?? "Number"}
          onChange={e => {
            const raw = e.target.value;
            if (raw === "") { onChange(undefined); return; }
            const n = Number(raw);
            if (Number.isNaN(n)) return;
            onChange({ kind: "literal", value: n });
          }}
        />
      )}

      {mode === "value" && widget === "boolean" && (
        <select
          className="je-input-value__boolean"
          disabled={readOnly}
          value={booleanLiteralValue(value) === undefined ? "" : String(booleanLiteralValue(value))}
          onChange={e => {
            const v = e.target.value;
            if (v === "") { onChange(undefined); return; }
            onChange({ kind: "literal", value: v === "true" });
          }}
        >
          <option value="">— unset —</option>
          <option value="true">true</option>
          <option value="false">false</option>
        </select>
      )}

      {mode === "value" && widget === "json" && (
        <div className="je-input-value__json">
          <textarea
            className="je-input-value__json-area"
            disabled={readOnly}
            value={jsonText}
            placeholder={container === "array" ? "[ ... ]" : "{ ... }"}
            onChange={e => {
              const raw = e.target.value;
              setJsonText(raw);
              if (raw.trim() === "") { setJsonError(null); onChange(undefined); return; }
              const res = parseJsonLiteral(raw, container);
              if (res.ok) { setJsonError(null); onChange({ kind: "literal", value: res.value }); }
              else { setJsonError(res.error); } // keep last committed value; do not emit
            }}
          />
          {jsonError && <div className="je-input-value__json-error">{jsonError}</div>}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Export from the package barrel**

In `packages/flow-editor/src/index.ts`, just after the `MentionInput` export (line 27), add:

```ts
export { InputValueEditor } from "./properties-panel/InputValueEditor.tsx";
```

- [ ] **Step 3: Typecheck the package**

Run: `npm run typecheck -w @journeyman/flow-editor`
Expected: PASS (no type errors).

- [ ] **Step 4: Verify (no commit — per request)**

Do **not** commit.

---

## Task 4: Wire `CustomAiConfigForm` to `InputValueEditor`

**Files:**
- Modify: `packages/steps/src/custom/CustomAiConfigForm.tsx`

This is the screen from the original request (the INPUTS section: PAYLOAD, WORKSPACEDIR). Today each input renders a bare `MentionInput` that discards typed text; switch it to `InputValueEditor` and persist all kinds to `node.inputs`.

- [ ] **Step 1: Update imports**

In `packages/steps/src/custom/CustomAiConfigForm.tsx`, replace the existing flow-editor import block (lines 2-9):

```tsx
import type { StepFormProps } from "@journeyman/flow-editor";
import {
  useOrgId,
  MentionInput,
  toMentionFields,
  soleRefOf,
  type Segment,
} from "@journeyman/flow-editor";
```

with:

```tsx
import type { StepFormProps } from "@journeyman/flow-editor";
import {
  useOrgId,
  InputValueEditor,
  toMentionFields,
} from "@journeyman/flow-editor";
```

- [ ] **Step 2: Remove the ref-only helpers and replace the input row**

Delete the now-unused `setRef` and `getRef` helpers (lines 65-72), keeping `removeInput`. Then replace the input-fields render block (lines 100-123) with:

```tsx
        {step.inputFields.map((f) => {
          const v = inputs[f.name];
          const hasValue =
            v !== undefined && (
              (v.kind === "ref" && v.ref.trim() !== "") ||
              (v.kind === "literal" && v.value !== undefined) ||
              (v.kind === "template" && v.template.trim() !== "")
            );
          const showError = f.required && !hasValue;
          return (
            <div key={f.name} className={`je-props__field${showError ? " je-props__field--invalid" : ""}`}>
              <div className="je-props__field-label-row">
                <label>
                  {f.name}
                  {f.required && <span className="je-props__required-mark">*</span>}
                </label>
              </div>
              <InputValueEditor
                value={v}
                expected={expectedShapeForType(f.type)}
                fields={mentionFields}
                readOnly={readOnly}
                required={f.required}
                onChange={(next) => (next ? setInputs({ ...inputs, [f.name]: next }) : removeInput(f.name))}
              />
              {f.description && <div className="je-props__field-help">{f.description}</div>}
            </div>
          );
        })}
```

- [ ] **Step 3: Typecheck the package**

Run: `npm run typecheck -w @journeyman/steps`
Expected: PASS. (If a "declared but never read" error appears for `soleRefOf`, `Segment`, or `MentionInput`, confirm Step 1 removed them.)

- [ ] **Step 4: Verify (no commit — per request)**

Do **not** commit.

---

## Task 5: Wire `ConfigTab` bind-only fields to `InputValueEditor`

**Files:**
- Modify: `packages/flow-editor/src/properties-panel/ConfigTab.tsx`

The "Required bindings" section (bind-only inputs like `workspaceDir`) currently uses `MentionInput` via `commitSegments`, which routes templates into `node.config` — where bind-only input slots are never read. Route all kinds to `node.inputs` via `InputValueEditor`.

- [ ] **Step 1: Add imports**

In `packages/flow-editor/src/properties-panel/ConfigTab.tsx`, after the `MentionInput` import (line 11), add:

```tsx
import { InputValueEditor } from "./InputValueEditor.tsx";
```

And ensure `WorkflowInputValue` is imported from core — change the type import on line 3:

```tsx
import type { WorkflowDefaults, WorkflowGraph, WorkflowNode, WorkflowInputValue } from "@journeyman/core";
```

- [ ] **Step 2: Add a setter that persists any kind to `node.inputs`**

In `ConfigTab.tsx`, just after `handleUnbind` (after line 93), add:

```tsx
  const setInputValue = (fieldKey: string, next: WorkflowInputValue | undefined) => {
    const inputs = { ...((node.inputs ?? {}) as Record<string, WorkflowInputValue>) };
    const cfg = { ...config };
    if (next === undefined) delete inputs[fieldKey];
    else inputs[fieldKey] = next;
    // Bind-only input values live in node.inputs, never node.config.
    delete cfg[fieldKey];
    onChange({ ...node, inputs: inputs as WorkflowNode["inputs"], config: cfg });
  };
```

- [ ] **Step 3: Replace the `MentionInput` in the bind-only section**

In the bind-only mapping (lines 324-331), replace the `<MentionInput .../>` element with:

```tsx
                    <InputValueEditor
                      value={(node.inputs as Record<string, WorkflowInputValue> | undefined)?.[key]}
                      expected={expectedForKey(key)}
                      fields={mentionFields}
                      readOnly={readOnly}
                      required={isRequired}
                      onChange={next => setInputValue(key, next)}
                    />
```

(Leave the surrounding `je-props__field`, label, and `warning` rendering unchanged.)

- [ ] **Step 4: Typecheck the package**

Run: `npm run typecheck -w @journeyman/flow-editor`
Expected: PASS.

> Note: `segmentsForField` / `commitSegments` are still used by `renderMentionField` for config fields, so do **not** delete them.

- [ ] **Step 5: Verify (no commit — per request)**

Do **not** commit.

---

## Task 6: Styling

**Files:**
- Modify: `packages/flow-editor/src/styles.css`

- [ ] **Step 1: Append the component styles**

At the end of `packages/flow-editor/src/styles.css`, add:

```css
/* Typed input value editor — Value | @ Reference toggle + per-type widgets. */
.je-input-value { display: flex; flex-direction: column; gap: 6px; }
.je-input-value__modes {
  display: inline-flex; align-self: flex-start;
  border: 1px solid #2a2a3a; border-radius: 6px; overflow: hidden;
}
.je-input-value__mode {
  background: transparent; color: #94a3b8; border: none;
  padding: 2px 10px; font-size: 11px; cursor: pointer;
}
.je-input-value__mode--active { background: #2a2a3a; color: #e2e8f0; }
.je-input-value__number,
.je-input-value__boolean,
.je-input-value__json-area {
  width: 100%; box-sizing: border-box;
  background: #0f0f1a; color: #e2e8f0;
  border: 1px solid #2a2a3a; border-radius: 4px;
  padding: 6px 8px; font-size: 12px;
}
.je-input-value__json-area { font-family: monospace; min-height: 72px; resize: vertical; }
.je-input-value__json-error { color: #ff7675; font-size: 11px; }
```

- [ ] **Step 2: Verify (no commit — per request)**

Do **not** commit. (CSS is not type-checked; visual verification happens when the app runs.)

---

## Task 7: Final typecheck (whole monorepo)

**Files:** none

- [ ] **Step 1: Run the full typecheck**

Run: `npm run typecheck`
Expected: PASS across all workspaces (`@journeyman/core`, `@journeyman/flow-editor`, `@journeyman/steps`, and the rest). Resolve any reported type errors in the files touched above before finishing.

- [ ] **Step 2: Re-run the new unit tests together (sanity)**

Run:
```bash
npx tsx packages/flow-editor/src/properties-panel/input-value-serialize.test.ts
npx vitest run packages/core/src/utils/validate-workflow.literal.test.ts
```
Expected: both PASS.

- [ ] **Step 3: Done — leave all changes uncommitted (per request).**

---

## Self-Review Notes

- **Spec coverage:** new component (Task 3) ✓; type→widget mapping (Tasks 1, 3) ✓; Value/Reference toggle (Task 3) ✓; string templates preserved (Task 1 `valueSegmentsToInput`/`inputToValueSegments`, Task 3 string branch) ✓; CustomAiConfigForm adoption (Task 4) ✓; ConfigTab bind-only adoption + persist-to-`node.inputs` correctness fix (Task 5) ✓; empty-field default mode = Reference (Task 1 `modeForValue`) ✓; literal publish validation (Task 2) ✓; styling (Task 6) ✓; final typecheck, no commits (Task 7, all tasks) ✓.
- **Out of scope (unchanged):** `SchemaForm` config fields; `ConditionBuilder` varPath; `IoTab` mapping; the orchestrator/engine (`resolve-inputs.ts` already handles all three kinds).
- **Type consistency:** `InputValueEditor` prop names (`value`, `expected`, `fields`, `readOnly`, `required`, `onChange`) are used identically in Tasks 3, 4, 5. Serializer function names match between Task 1 (definitions), its test, and Task 3 (imports). `literalMatchesShape` signature matches between Task 2's definition, its test, and the core barrel export.
