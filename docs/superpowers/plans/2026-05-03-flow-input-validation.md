# Flow Input Validation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Catch incompatible / missing / dangling input wirings at edit time across all phase nodes — disabling incompatible options in the value picker and surfacing problems via the existing `FlowSaveWarning` channel in the topbar.

**Architecture:** Pure validators live in `@journeyman/core/utils/validate-flow.ts` (one for picker per-binding, one for whole-flow). The flow-editor adapts its existing `usePhaseCatalog` data into a `ValidationCatalog` and consumes the validators from three integration points: `ShapeTree` (picker disable), `Topbar` (warnings panel + per-input red highlight), and `PhaseNode` canvas tile (red dot when any input is flagged).

**Tech Stack:** TypeScript, React, existing `Shape` system (`shapesEqual`, `shapeAtPath`, `resolveShape`), existing `FlowSaveWarning` discriminated union (extended with new variants).

**Constraints from spec/user:**
- No unit tests — smoke checks only.
- Typecheck only at the end (one pass).
- No git commits during implementation.

---

## File Structure

**Created:**
- `packages/core/src/utils/validate-flow.ts` — all validators + types (`BindingCheck`, `ValidationCatalog`, `validateInputBinding`, `validateFlowInputs`, `parseRefForValidation`).

**Modified:**
- `packages/core/src/types/flow.types.ts` — extend `FlowSaveWarning` union with five new variants.
- `packages/core/src/index.ts` — re-export new validators.
- `packages/flow-editor/src/properties-panel/ShapeTree.tsx` — switch from raw `shapesEqual` to `validateInputBinding`, disable bind button when incompatible, show reason in `title`.
- `packages/flow-editor/src/properties-panel/ConfigTab.tsx` — apply red border + inline message to inputs flagged by `validateFlowInputs`.
- `packages/flow-editor/src/topbar/Topbar.tsx` — compute `validateFlowInputs` once and render an `InputWarningsSection` next to the existing `SecretWarningsSection`.
- `packages/flow-editor/src/canvas/nodes/PhaseNode.tsx` — render a small red dot when this node has any input warning.
- `packages/flow-editor/src/styles.css` — new classes for incompatible picker node, red border, and red dot.

**Untouched:** orchestrator (handlers already validate at runtime), phase definitions (`@journeyman/phases`), other coding-cli/git-provider code.

---

## Task 1: Extend `FlowSaveWarning` with validation variants

**Files:**
- Modify: `packages/core/src/types/flow.types.ts:181-196`

- [ ] **Step 1: Replace the existing `FlowSaveWarning` union with the extended one**

Replace the existing `FlowSaveWarning` definition with:

```ts
/**
 * Non-blocking warning returned alongside a successful flow save.
 * The save itself always succeeds when the body is well-formed.
 */
export type FlowSaveWarning =
  | {
      code: "inaccessible_secrets";
      message: string;
      names: string[];
    }
  | {
      code: "cross_scope_pin";
      message: string;
      entries: Array<{
        nodeId: string;
        slot: string;
        pinnedScope: SecretScope;
        flowScope: FlowScope;
      }>;
    }
  | {
      code: "shape-mismatch";
      message: string;
      nodeId: string;
      inputKey: string;
      ref: string;
      expected: string;  // human-readable shape tag, e.g. "Repo[]"
      actual: string;    // human-readable shape tag, e.g. "string"
    }
  | {
      code: "missing-required";
      message: string;
      nodeId: string;
      inputKey: string;
    }
  | {
      code: "dangling-ref-node";
      message: string;
      nodeId: string;
      inputKey: string;
      ref: string;
      missingNodeId: string;
    }
  | {
      code: "dangling-ref-path";
      message: string;
      nodeId: string;
      inputKey: string;
      ref: string;
      missingPath: string;
    }
  | {
      code: "missing-input-shape";
      message: string;
      nodeId: string;
      inputKey: string;
    };
```

Existing consumers (secret warnings) only narrow on `code` and read their own variant's fields, so adding new variants does not break them.

---

## Task 2: Create `validate-flow.ts` skeleton with `validateInputBinding`

**Files:**
- Create: `packages/core/src/utils/validate-flow.ts`

- [ ] **Step 1: Create the new file with types + the per-binding validator**

```ts
import type { FlowGraph, FlowNode, FlowSaveWarning, FlowInputValue, RunInputDef } from "../types/flow.types.ts";
import type { Shape, OutputSchema } from "../types/shape.types.ts";
import { resolveShape, shapeAtPath, shapesEqual } from "./shapes-runtime.ts";

/**
 * Catalog entry the validator needs. The flow-editor and any future server-side
 * caller is responsible for constructing this from whatever source they have.
 */
export interface ValidationCatalogEntry {
  inputFields?: Record<string, { shape: Shape; required?: boolean }>;
  outputSchema?: OutputSchema | null;
}
export type ValidationCatalog = Record<string /* phaseType */, ValidationCatalogEntry>;

/** Per-binding compatibility check used by both the picker and the whole-flow walker. */
export type BindingCheck =
  | { ok: true }
  | { ok: false; reason: "shape-mismatch"; expected: Shape; actual: Shape }
  | { ok: false; reason: "unknown-shape" };

/** Render-friendly tag for a Shape, e.g. "Repo[]" or "Issue". */
export function shapeTag(s: Shape): string {
  switch (s.type) {
    case "string":
    case "number":
    case "boolean": return s.type;
    case "ref":     return s.name;
    case "object":  return s.named ?? "object";
    case "array":   return `${shapeTag(s.items)}[]`;
  }
}

/**
 * Compare a producer's resolved leaf shape against the consumer's declared
 * input shape. `actual === undefined` is treated as the unknown-shape escape
 * hatch so callers can choose to allow it without triggering a warning.
 */
export function validateInputBinding(expected: Shape, actual: Shape | undefined): BindingCheck {
  if (!actual) return { ok: false, reason: "unknown-shape" };
  try {
    if (shapesEqual(actual, expected)) return { ok: true };
  } catch {
    // resolveShape failed somewhere — treat as unknown
    return { ok: false, reason: "unknown-shape" };
  }
  return { ok: false, reason: "shape-mismatch", expected, actual };
}
```

> Note: `shapesEqual`, `shapeAtPath`, and `resolveShape` are exported from `packages/core/src/types/shapes.ts`. The import path above (`./shapes-runtime.ts`) is wrong — fix it in Step 2.

- [ ] **Step 2: Fix the import path**

Replace `from "./shapes-runtime.ts"` with the correct path:

```ts
import { resolveShape, shapeAtPath, shapesEqual } from "../types/shapes.ts";
```

(Both `shape.types.ts` types and `shapes.ts` runtime helpers are siblings — fully resolved imports use `.ts` extension per project convention shown by every other core file.)

---

## Task 3: Add `parseRefForValidation` helper

**Files:**
- Modify: `packages/core/src/utils/validate-flow.ts`

- [ ] **Step 1: Append a local ref parser to the file**

`parseRef` exists in `@journeyman/orchestrator` but core can't depend on orchestrator (would invert the dep direction). Duplicate the small parsing logic locally — it's self-contained:

```ts
type RefScope = "workflow.input" | "input" | "output";
interface ParsedRef {
  source: string;       // node id, or "workflow.input"
  scope: RefScope;
  fieldPath: string[];  // e.g. ["repos", "[item]", "repoDir"]
}

function parseRefForValidation(ref: string): ParsedRef | null {
  const trimmed = ref.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.startsWith("workflow.input.")) {
    const rest = trimmed.slice("workflow.input.".length);
    return { source: "workflow.input", scope: "workflow.input", fieldPath: rest.split(".") };
  }
  const m = /^([^.]+)\.(input|output)\.(.+)$/.exec(trimmed);
  if (!m) return null;
  return { source: m[1], scope: m[2] as RefScope, fieldPath: m[3].split(".") };
}
```

---

## Task 4: Implement `validateFlowInputs` (the whole-flow walker)

**Files:**
- Modify: `packages/core/src/utils/validate-flow.ts`

- [ ] **Step 1: Add the `runInputShape` helper for run-input → Shape mapping**

Append to the file:

```ts
function runInputShape(def: RunInputDef): Shape | undefined {
  switch (def.type) {
    case "string":  return { type: "string" };
    case "number":  return { type: "number" };
    case "boolean": return { type: "boolean" };
    case "json":    return undefined; // explicit escape hatch
    default:        return undefined;
  }
}
```

- [ ] **Step 2: Add `findStartRunInputs` helper**

Append:

```ts
function findStartRunInputs(flow: FlowGraph): RunInputDef[] {
  const start = flow.nodes.find((n) => n.type === "start");
  const cfg = (start?.config ?? {}) as { runInputs?: RunInputDef[] };
  return cfg.runInputs ?? [];
}
```

- [ ] **Step 3: Add the main `validateFlowInputs` walker**

Append (this is the meaty function):

```ts
/**
 * Walk every phase node in `flow`, check each input against its catalog
 * declaration, and collect non-blocking FlowSaveWarning entries describing:
 *   - shape-mismatch: a ref whose upstream shape doesn't match the input
 *   - missing-required: a required input with no Config value and no ref
 *   - dangling-ref-node: a ref pointing to a deleted upstream node
 *   - dangling-ref-path: a ref whose path does not exist on the source's output
 *   - missing-input-shape: catalog declared this input but didn't give a shape
 *
 * Pure function. No I/O. Memoize at the caller if hot.
 */
export function validateFlowInputs(
  flow: FlowGraph,
  catalog: ValidationCatalog,
): FlowSaveWarning[] {
  const warnings: FlowSaveWarning[] = [];
  const nodesById = new Map<string, FlowNode>();
  for (const n of flow.nodes) nodesById.set(n.id, n);
  const runInputs = findStartRunInputs(flow);
  const runInputByName = new Map(runInputs.map((r) => [r.name, r] as const));

  for (const node of flow.nodes) {
    if (node.type !== "phase" || !node.phaseType) continue;
    const entry = catalog[node.phaseType];
    if (!entry?.inputFields) continue;

    const config = (node.config ?? {}) as Record<string, unknown>;
    const inputs = (node.inputs ?? {}) as Record<string, FlowInputValue>;

    for (const [key, fieldDef] of Object.entries(entry.inputFields)) {
      const expected = fieldDef.shape;
      const inputValue = inputs[key];
      const configValue = config[key];

      // R4 — catalog declared the input but forgot to declare a shape
      if (!expected) {
        warnings.push({
          code: "missing-input-shape",
          message: `${node.id}.${key}: input has no declared shape — fix the phase catalog`,
          nodeId: node.id,
          inputKey: key,
        });
        continue;
      }

      const hasConfigValue = configValue !== undefined && configValue !== "" && configValue !== null;
      const hasRef = inputValue?.kind === "ref" && typeof inputValue.ref === "string" && inputValue.ref.trim().length > 0;
      const hasLiteral = inputValue?.kind === "literal" && inputValue.value !== undefined;

      // R2 — required but neither Config nor IO supplies a value
      if (!hasConfigValue && !hasRef && !hasLiteral) {
        if (fieldDef.required) {
          warnings.push({
            code: "missing-required",
            message: `${node.id}: required input '${key}' has no value (type a Config value or bind from upstream)`,
            nodeId: node.id,
            inputKey: key,
          });
        }
        continue;
      }

      // R1 + R3 — only meaningful if a ref is set; literal/Config typed values
      // pass through with no shape check (handler validates at runtime).
      if (!hasRef) continue;
      const ref = inputValue!.kind === "ref" ? inputValue!.ref : "";
      const parsed = parseRefForValidation(ref);
      if (!parsed) {
        warnings.push({
          code: "dangling-ref-path",
          message: `${node.id}.${key}: ref '${ref}' is malformed`,
          nodeId: node.id,
          inputKey: key,
          ref,
          missingPath: ref,
        });
        continue;
      }

      // Resolve the actual upstream shape
      let actual: Shape | undefined;
      if (parsed.scope === "workflow.input") {
        const def = runInputByName.get(parsed.fieldPath[0]);
        if (!def) {
          warnings.push({
            code: "dangling-ref-path",
            message: `${node.id}.${key}: ref '${ref}' points to undeclared run input '${parsed.fieldPath[0]}'`,
            nodeId: node.id,
            inputKey: key,
            ref,
            missingPath: parsed.fieldPath.join("."),
          });
          continue;
        }
        const root = runInputShape(def);
        actual = root ? (parsed.fieldPath.length > 1 ? shapeAtPath(root, parsed.fieldPath.slice(1)) ?? undefined : root) : undefined;
        // `json` typed run inputs intentionally have no shape — escape hatch.
      } else {
        const sourceNode = nodesById.get(parsed.source);
        if (!sourceNode) {
          warnings.push({
            code: "dangling-ref-node",
            message: `${node.id}.${key}: ref '${ref}' points to unknown node '${parsed.source}'`,
            nodeId: node.id,
            inputKey: key,
            ref,
            missingNodeId: parsed.source,
          });
          continue;
        }
        if (parsed.scope === "input") {
          // Self-input lookups (rare) — skip, not worth modeling here
          continue;
        }
        // scope === "output"
        if (sourceNode.type !== "phase" || !sourceNode.phaseType) {
          // Non-phase nodes (start/end/control) — skip output-shape walking
          continue;
        }
        const sourceEntry = catalog[sourceNode.phaseType];
        const outputSchema = sourceEntry?.outputSchema;
        if (!outputSchema) {
          // Source phase didn't declare an output schema — escape hatch (allow)
          continue;
        }
        const root = outputSchema[parsed.fieldPath[0]];
        if (!root) {
          warnings.push({
            code: "dangling-ref-path",
            message: `${node.id}.${key}: ref '${ref}' points to '${parsed.fieldPath[0]}' which is not in the source's output schema`,
            nodeId: node.id,
            inputKey: key,
            ref,
            missingPath: parsed.fieldPath.join("."),
          });
          continue;
        }
        actual = shapeAtPath(root, parsed.fieldPath.slice(1)) ?? undefined;
        if (!actual) {
          warnings.push({
            code: "dangling-ref-path",
            message: `${node.id}.${key}: ref '${ref}' path does not resolve on the source's output`,
            nodeId: node.id,
            inputKey: key,
            ref,
            missingPath: parsed.fieldPath.join("."),
          });
          continue;
        }
      }

      // R1 — shape compatibility
      const check = validateInputBinding(expected, actual);
      if (!check.ok && check.reason === "shape-mismatch") {
        warnings.push({
          code: "shape-mismatch",
          message: `${node.id}.${key}: expected ${shapeTag(expected)}, got ${shapeTag(actual!)} from ${ref}`,
          nodeId: node.id,
          inputKey: key,
          ref,
          expected: shapeTag(expected),
          actual: shapeTag(actual!),
        });
      }
    }
  }

  return warnings;
}
```

---

## Task 5: Export the new validators from `@journeyman/core`

**Files:**
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Add the new export line**

After the existing `export { formatIssueForPrompt, isIssueLike } from "./utils/format-issue.ts";` line, add:

```ts
export {
  validateInputBinding,
  validateFlowInputs,
  shapeTag,
} from "./utils/validate-flow.ts";
export type {
  BindingCheck,
  ValidationCatalog,
  ValidationCatalogEntry,
} from "./utils/validate-flow.ts";
```

---

## Task 6: Wire `validateInputBinding` into `ShapeTree` (picker disable)

**Files:**
- Modify: `packages/flow-editor/src/properties-panel/ShapeTree.tsx`

- [ ] **Step 1: Replace the manual compatibility check with the core helper**

Replace the existing imports + compatibility block. The current file has:

```ts
import { resolveShape, shapesEqual } from "@journeyman/core";
// ...
let compatible = false;
if (expected) {
  try {
    compatible = shapesEqual(resolved, expected);
  } catch {
    compatible = false;
  }
}
```

Replace with:

```ts
import { resolveShape, validateInputBinding, shapeTag } from "@journeyman/core";
// ...
const check = expected ? validateInputBinding(expected, resolved) : undefined;
const compatible = !check || check.ok;
const incompatibleReason = check?.ok === false && check.reason === "shape-mismatch"
  ? `Type mismatch: expected ${shapeTag(check.expected)}, got ${shapeTag(check.actual)}`
  : null;
```

- [ ] **Step 2: Update the bind button to render disabled + reason tooltip**

Replace the current bind button block:

```tsx
<button
  type="button"
  className="vp-shape-bind"
  onClick={() => onBind(path)}
  title={compatible ? "Bind (compatible)" : "Bind"}
>
  {label}
</button>
```

with:

```tsx
<button
  type="button"
  className="vp-shape-bind"
  disabled={!!incompatibleReason}
  aria-disabled={!!incompatibleReason}
  onClick={() => { if (!incompatibleReason) onBind(path); }}
  title={incompatibleReason ?? (compatible ? "Bind (compatible)" : "Bind")}
>
  {label}
</button>
```

- [ ] **Step 3: Update the wrapper className to mark the incompatible state**

Replace:

```tsx
<div className={`vp-shape-node${compatible ? " vp-shape-node--compatible" : ""}`}>
```

with:

```tsx
<div
  className={
    `vp-shape-node` +
    (compatible ? " vp-shape-node--compatible" : "") +
    (incompatibleReason ? " vp-shape-node--incompatible" : "")
  }
>
```

> Children still render — only the bind button on the *current* node is disabled. Drilling into nested fields (`object → fields`, `array → [item]`) is still allowed; some inner field may itself be compatible.

---

## Task 7: Add CSS for incompatible picker node + red highlights + red dot

**Files:**
- Modify: `packages/flow-editor/src/styles.css`

- [ ] **Step 1: Append new style rules at the end of the file**

```css
/* Validation: picker — disabled bind button on shape mismatch */
.vp-shape-node--incompatible > .vp-shape-row > .vp-shape-bind {
  opacity: 0.4;
  cursor: not-allowed;
  text-decoration: line-through;
}
.vp-shape-node--incompatible > .vp-shape-row > .vp-shape-bind:hover {
  background: transparent;
}

/* Validation: per-input red border in panel */
.je-props__field--invalid {
  border-left: 2px solid #ff6b6b;
  padding-left: 8px;
  margin-left: -10px;
}
.je-props__field-error-msg {
  color: #ff8a8a;
  font-size: 11px;
  margin-top: 4px;
}

/* Validation: node tile red dot */
.je-node-warning-dot {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #ff6b6b;
  box-shadow: 0 0 4px #ff6b6b;
  pointer-events: none;
}

/* Validation: topbar input warnings */
.je-topbar__warnings--input {
  background: rgba(255, 107, 107, 0.08);
  border: 1px solid rgba(255, 107, 107, 0.3);
}
.je-topbar__warning-row--input {
  cursor: pointer;
}
.je-topbar__warning-row--input:hover {
  background: rgba(255, 107, 107, 0.15);
}
```

---

## Task 8: Build the `useValidationCatalog` adapter hook

**Files:**
- Create: `packages/flow-editor/src/properties-panel/use-validation-catalog.ts`

- [ ] **Step 1: Create the adapter**

The existing `usePhaseCatalog` returns `Record<string, PhaseCatalogEntry>` where each entry already has `inputFields` and `outputSchema`. The shape is structurally compatible with `ValidationCatalog` — we just expose it under that type.

```ts
import { useMemo } from "react";
import type { ValidationCatalog } from "@journeyman/core";
import { usePhaseCatalog } from "../catalogs/use-phase-catalog.ts";

/**
 * Adapter: presents the editor's phase catalog as a ValidationCatalog
 * for the @journeyman/core flow-validator. Pure passthrough today.
 */
export function useValidationCatalog(): ValidationCatalog {
  const catalog = usePhaseCatalog();
  return useMemo(() => {
    const out: ValidationCatalog = {};
    for (const [phaseType, entry] of Object.entries(catalog)) {
      out[phaseType] = {
        inputFields: entry.inputFields,
        outputSchema: entry.outputSchema,
      };
    }
    return out;
  }, [catalog]);
}
```

---

## Task 9: Create `InputWarningsSection` component for the topbar

**Files:**
- Create: `packages/flow-editor/src/topbar/InputWarningsSection.tsx`

- [ ] **Step 1: Create the component**

```tsx
import type { FlowSaveWarning } from "@journeyman/core";

interface Props {
  warnings: FlowSaveWarning[];
  onSelectNode?: (nodeId: string) => void;
}

const INPUT_CODES = new Set([
  "shape-mismatch",
  "missing-required",
  "dangling-ref-node",
  "dangling-ref-path",
  "missing-input-shape",
]);

export function InputWarningsSection({ warnings, onSelectNode }: Props) {
  const filtered = warnings.filter((w) => INPUT_CODES.has(w.code));
  if (filtered.length === 0) return null;
  return (
    <div className="je-topbar__warnings je-topbar__warnings--input">
      <div className="je-topbar__warnings-title">
        Input warnings ({filtered.length})
      </div>
      {filtered.map((w, i) => {
        const nodeId = "nodeId" in w ? w.nodeId : undefined;
        return (
          <div
            key={`${w.code}-${i}`}
            className="je-topbar__warning-row je-topbar__warning-row--input"
            onClick={() => nodeId && onSelectNode?.(nodeId)}
            title={nodeId ? `Click to focus ${nodeId}` : undefined}
          >
            <code>{w.code}</code> — {w.message}
          </div>
        );
      })}
    </div>
  );
}
```

> The component reads `w.code` directly. Since `FlowSaveWarning` is a discriminated union and the new variants all carry `nodeId`, the `"nodeId" in w` narrow is safe. `onSelectNode` is optional so the topbar can pass it later.

---

## Task 10: Wire `validateFlowInputs` + `InputWarningsSection` into the topbar

**Files:**
- Modify: `packages/flow-editor/src/topbar/Topbar.tsx`

- [ ] **Step 1: Add imports**

At the top of `Topbar.tsx`, near the existing `import type { FlowGraph, FlowSaveWarning } from "@journeyman/core";` line:

```ts
import { useMemo } from "react";
import { validateFlowInputs } from "@journeyman/core";
import { useValidationCatalog } from "../properties-panel/use-validation-catalog.ts";
import { InputWarningsSection } from "./InputWarningsSection.tsx";
```

(If `useMemo` is already imported, reuse the existing line.)

- [ ] **Step 2: Compute warnings inside the `Topbar` component body**

Locate the body of the `Topbar` function. After the existing `secretWarnings` prop is read, add:

```ts
const validationCatalog = useValidationCatalog();
const inputWarnings = useMemo(
  () => validateFlowInputs(flow, validationCatalog),
  [flow, validationCatalog],
);
```

- [ ] **Step 3: Render the new section near the existing `SecretWarningsSection`**

In the JSX where `<SecretWarningsSection warnings={secretWarnings} />` (or similar) is rendered, add immediately after it:

```tsx
<InputWarningsSection
  warnings={inputWarnings}
  onSelectNode={onSelectNode}
/>
```

If `Topbar` does not already accept an `onSelectNode` prop, find an existing prop that performs node focusing (search for `selectNode` / `setSelectedNodeId`) and pass it through. If none exists, omit `onSelectNode` for now — the warnings will still render, just non-clickable. (Per the spec, click-to-jump is nice-to-have, not required for the feature to work.)

- [ ] **Step 4: Pass the warnings down so other consumers can read them**

The same `inputWarnings` value is used by `PhaseNode` (Task 11) and `ConfigTab` (Task 12). The simplest plumbing is to store them on the FlowEditor's existing context/store. To keep this plan minimal:

If the editor has an existing store/context that holds derived flow state (search for `useFlowContext` / `FlowContext.Provider`), add `inputWarnings` to it. If not, lift the `validateFlowInputs` computation up to the same component that owns `flow`, memoize it there, and pass it as a prop into both `Topbar` and the canvas + properties panel layer.

(If unsure where it currently lives, mirror how `secretWarnings` is plumbed — `inputWarnings` flows the same way.)

---

## Task 11: Per-node red dot on `PhaseNode`

**Files:**
- Modify: `packages/flow-editor/src/canvas/nodes/PhaseNode.tsx`

- [ ] **Step 1: Read warnings from props/context and render the dot**

Where `PhaseNode` currently destructures its React-Flow `data` prop, add a `hasWarning` boolean. The exact wiring depends on Task 10's plumbing decision; the final node body should look like:

```tsx
// somewhere near where node-level state is read:
const inputWarnings = data.inputWarnings as FlowSaveWarning[] | undefined;
const hasWarning = !!inputWarnings?.some(
  (w) => "nodeId" in w && w.nodeId === id,
);
```

Then in the JSX (somewhere inside the tile root `<div>`):

```tsx
{hasWarning && <span className="je-node-warning-dot" aria-hidden />}
```

The tile root `<div>` must have `position: relative` for the dot's absolute positioning to anchor correctly. If it doesn't already, add `style={{ position: "relative" }}` (or extend its existing className).

---

## Task 12: Per-input red border in `ConfigTab`

**Files:**
- Modify: `packages/flow-editor/src/properties-panel/ConfigTab.tsx`

- [ ] **Step 1: Read warnings for the current node**

Wherever `ConfigTab` currently has access to the validated warnings (passed from the FlowEditor or via context), narrow them to the current node:

```ts
import type { FlowSaveWarning } from "@journeyman/core";

// inside ConfigTab body:
const nodeWarningsByKey = useMemo(() => {
  const out = new Map<string, FlowSaveWarning>();
  for (const w of inputWarnings ?? []) {
    if ("nodeId" in w && w.nodeId === node.id && "inputKey" in w) {
      out.set(w.inputKey, w);
    }
  }
  return out;
}, [inputWarnings, node.id]);
```

(`inputWarnings` should be plumbed in the same way Task 10 distributes them. If not yet plumbed, accept it as an optional prop on `ConfigTab` for now and let it default to `[]`.)

- [ ] **Step 2: Apply red highlight to the typed-widget Config rows**

Inside the `<SchemaForm ... />` rendering block (around line 158-170 of the current file), the per-field rendering happens *inside* `SchemaForm`, not `ConfigTab` itself. Two options:

**Easier (chosen)**: pass `nodeWarningsByKey` to `SchemaForm` as a new optional prop and let it apply `je-props__field--invalid` to rows whose key has a warning. Modify `SchemaForm.tsx` (search the same directory) to accept `warningsByKey?: Map<string, FlowSaveWarning>` and add the class + inline message accordingly.

```tsx
// In SchemaForm, around the per-field row render:
const w = warningsByKey?.get(key);
return (
  <div className={`je-props__field${w ? " je-props__field--invalid" : ""}`}>
    {/* existing field render */}
    {w && <div className="je-props__field-error-msg">{w.message}</div>}
  </div>
);
```

- [ ] **Step 3: Apply red highlight to the bindOnly section rows in `ConfigTab`**

The bindOnly fields are rendered directly in `ConfigTab.tsx` (around line 175-194). Replace the wrapping `<div className="je-props__field">` with:

```tsx
const w = nodeWarningsByKey.get(key);
return (
  <div key={key} className={`je-props__field${w ? " je-props__field--invalid" : ""}`}>
    {/* existing label-row + bindOnly content */}
    {w && <div className="je-props__field-error-msg">{w.message}</div>}
  </div>
);
```

---

## Task 13: Final typecheck

**Files:** none

- [ ] **Step 1: Run typecheck across all workspaces**

Run from the repo root:

```bash
npm run typecheck
```

Expected: every package exits 0 with no error/failed lines. If errors appear:

- Most likely candidates:
  - `Topbar.tsx` may need `useMemo` imported.
  - `ConfigTab.tsx` may need `useMemo` imported.
  - `SchemaForm.tsx` may need a new optional prop typing.
  - The discriminated union narrows in `InputWarningsSection.tsx` (`"nodeId" in w`) need exact field literal access — if TS complains, switch to a switch-on-`code` instead.
- Fix in place; do not introduce `as any` unless the underlying issue is an existing TS quirk in the file. Re-run `npm run typecheck` after each fix until clean.

- [ ] **Step 2: Quick smoke check (optional, manual)**

Open `examples/flows/end-to-end.flow.json` in the editor → topbar should show 0 input warnings (the e2e flow was just fixed in earlier work). Then open one of the in-progress dev flows or manually wire `commit-and-push.repos ← create-workspace.output.workspaceDir` → topbar should immediately show a `shape-mismatch` warning, the affected node tile should show a red dot, and the panel row should show a red border.

If both smoke cases behave as expected, the feature is done.

---

## Self-review notes

- **Spec coverage:**
  - R1 shape mismatch → Task 4 step 3 (last block)
  - R2 missing required → Task 4 step 3 (continue branch)
  - R3a dangling node → Task 4 step 3 (sourceNode lookup)
  - R3b dangling path → Task 4 step 3 (root + shapeAtPath null)
  - R4 missing input shape → Task 4 step 3 (early continue)
  - Picker disable → Task 6
  - Topbar warnings → Tasks 9-10
  - Per-node dot → Task 11
  - Per-input border → Task 12
  - `BindingCheck`, `validateInputBinding`, `validateFlowInputs` → Tasks 2-4
  - Catalog adapter → Task 8
  - Escape hatches (json runInput, missing outputSchema, custom paths) → handled inside Task 4 walker

- **Type consistency:** `nodeId`/`inputKey` field names are used identically across `FlowSaveWarning` variants (Task 1), the `validateFlowInputs` walker (Task 4), and the consumers in Tasks 9, 11, 12. `validateInputBinding` and `BindingCheck` names match between Tasks 2, 6.

- **No placeholders:** every step has either real code or a one-line decision branch. Plumbing decisions in Tasks 10/12 reference existing patterns (mirror `secretWarnings`).

- **Constraints honored:** no test steps, no commit steps, single typecheck at the end (Task 13).
