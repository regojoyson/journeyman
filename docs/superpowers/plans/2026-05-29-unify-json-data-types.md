# Unify Structured-Data Types to `json object` / `json array` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the inconsistent `json` (workflow/trigger) vs `object`/`array` (custom-step) type vocabularies with a single standard set — `string`, `number`, `boolean`, `json object`, `json array` — so a `json object` workflow input can be mapped into a `json object` custom-step input.

**Architecture:** Add one opaque `json` variant to the binding `Shape` union, centralize the editor-type→Shape mapping and the binding-compatibility rule into shared `@journeyman/core` helpers, then point every type union, shape adapter, validator, picker, UI dropdown, and runtime coercion site at the new vocabulary. No migration of existing stored data.

**Tech Stack:** TypeScript, npm workspaces monorepo, React (flow-editor/web), Fastify (api-server), vitest (core/custom-steps), `tsc --noEmit` typecheck across all packages.

**Spec:** [docs/superpowers/specs/2026-05-29-unify-json-data-types-design.md](../specs/2026-05-29-unify-json-data-types-design.md)

---

## File Structure

**Core (`@journeyman/core`) — the type + logic source of truth:**
- `packages/core/src/types/shape.types.ts` — add `json` variant to `Shape`.
- `packages/core/src/types/shapes.ts` — `shapesEqual` json arm; new `shapesCompatible()`.
- `packages/core/src/types/flow.types.ts` — `WorkflowInputDef.type` union; new `workflowInputDefShape()`.
- `packages/core/src/types/workflow-trigger.types.ts` — `TriggerInputMappingType` union.
- `packages/core/src/types/custom-steps.types.ts` — `CustomStepInputType` union.
- `packages/core/src/utils/validate-workflow.ts` — `shapeTag`, `validateInputBinding`, `workflowInputShape`.
- `packages/core/src/index.ts` — export `shapesCompatible`, `workflowInputDefShape`.

**Adapters / validators / picker:**
- `packages/custom-steps/src/shape-adapter.ts` — `inputTypeToShape` json cases.
- `packages/flow-editor/src/properties-panel/use-upstream-sources.ts` — drop json→string downgrade.
- `packages/flow-editor/src/properties-panel/mention-fields.ts` — json leaf label.
- `packages/flow-editor/src/state/validate-ref-shape.ts` — use shared helpers.
- `packages/orchestrator/src/flow-json/validate-ref-shape.ts` — use shared helpers; `describeShape` json case.

**UI dropdowns:**
- `packages/flow-editor/src/inputs-tab/InputsTab.tsx`
- `packages/flow-editor/src/properties-panel/trigger-webhook-panel.tsx`
- `packages/web/src/components/custom-steps/InputFieldsEditor.tsx`

**Runtime coercion (api-server):**
- `packages/api-server/src/services/webhook-trigger-fire.ts`
- `packages/api-server/src/services/form-submission.ts`

**Out of scope (do NOT change):** `WebhookWaitOutputField.type` and its consumers (`pause-node-source.ts`, `match-human-tasks.ts`) keep their own `json`/`date` vocabulary — cross-binding still works because `shapesCompatible` treats an empty-fields `object` as compatible with `json object`.

---

## Task 1: Add the `json` Shape variant + equality + compatibility helper

**Files:**
- Modify: `packages/core/src/types/shape.types.ts`
- Modify: `packages/core/src/types/shapes.ts`
- Test: `packages/core/src/types/shapes.compat.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/types/shapes.compat.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { shapesEqual, shapesCompatible } from "./shapes.ts";
import type { Shape } from "./shape.types.ts";

const jsonObj: Shape = { type: "json", container: "object" };
const jsonArr: Shape = { type: "json", container: "array" };
const emptyObj: Shape = { type: "object", fields: {} };
const typedObj: Shape = { type: "object", fields: { a: { type: "string" } } };
const strArr: Shape = { type: "array", items: { type: "string" } };
const str: Shape = { type: "string" };

describe("shapesEqual — json", () => {
  it("equal json objects match", () => {
    expect(shapesEqual(jsonObj, { type: "json", container: "object" })).toBe(true);
  });
  it("json object != json array", () => {
    expect(shapesEqual(jsonObj, jsonArr)).toBe(false);
  });
  it("json object != typed object", () => {
    expect(shapesEqual(jsonObj, typedObj)).toBe(false);
  });
});

describe("shapesCompatible — json", () => {
  it("json object binds to json object", () => {
    expect(shapesCompatible(jsonObj, jsonObj)).toBe(true);
  });
  it("json object binds to typed object (both directions)", () => {
    expect(shapesCompatible(jsonObj, typedObj)).toBe(true);
    expect(shapesCompatible(typedObj, jsonObj)).toBe(true);
  });
  it("json object binds to empty/wildcard object", () => {
    expect(shapesCompatible(jsonObj, emptyObj)).toBe(true);
    expect(shapesCompatible(emptyObj, jsonObj)).toBe(true);
  });
  it("json array binds to json array and typed array", () => {
    expect(shapesCompatible(jsonArr, jsonArr)).toBe(true);
    expect(shapesCompatible(jsonArr, strArr)).toBe(true);
  });
  it("json object does NOT bind to a scalar", () => {
    expect(shapesCompatible(jsonObj, str)).toBe(false);
  });
  it("json object does NOT bind to json array", () => {
    expect(shapesCompatible(jsonObj, jsonArr)).toBe(false);
  });
  it("typed object still strictly matches identical typed object", () => {
    expect(shapesCompatible(typedObj, { type: "object", fields: { a: { type: "string" } } })).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @journeyman/core -- shapes.compat`
Expected: FAIL — `shapesCompatible` is not exported / `json` is not a valid `Shape` variant (type error or runtime error).

- [ ] **Step 3: Add the `json` variant to the Shape union**

In `packages/core/src/types/shape.types.ts`, add the variant to the `Shape` union (after the `array` line, before `ref`):

```typescript
export type Shape =
  | { type: "string";  description?: string }
  | { type: "number";  description?: string }
  | { type: "boolean"; description?: string }
  | { type: "object";  fields: Record<string, Shape>; named?: string; description?: string }
  | { type: "array";   items: Shape; description?: string }
  | { type: "json";    container: "object" | "array"; description?: string }
  | { type: "ref";     name: string; description?: string };
```

- [ ] **Step 4: Add the `json` arm to `shapesEqual` and the new `shapesCompatible`**

In `packages/core/src/types/shapes.ts`, add a `json` arm to `shapesEqual` immediately before the final `return true;`:

```typescript
  if (ra.type === "array" && rb.type === "array") {
    return shapesEqual(ra.items, rb.items);
  }
  if (ra.type === "json" && rb.type === "json") {
    return ra.container === rb.container;
  }
  return true; // scalars of equal `type`
```

Then append the new helper at the end of the file:

```typescript
function objectish(s: Shape): boolean {
  return s.type === "object" || (s.type === "json" && s.container === "object");
}
function arrayish(s: Shape): boolean {
  return s.type === "array" || (s.type === "json" && s.container === "array");
}
function isEmptyObject(s: Shape): boolean {
  return s.type === "object" && Object.keys(s.fields).length === 0;
}

/**
 * True when a value of shape `actual` can be bound into an input of shape
 * `expected`. Stricter than equality for typed objects/arrays, but permissive
 * for opaque `json`:
 *   - a `json object` binds to ANY object (typed or empty/wildcard), both ways
 *   - a `json array`  binds to ANY array, both ways
 *   - an empty-fields object (legacy wildcard) binds to any object, both ways
 *   - a `json object` never binds to a scalar or to a `json array`
 */
export function shapesCompatible(actual: Shape, expected: Shape): boolean {
  const ra = resolveShape(actual);
  const re = resolveShape(expected);
  if (objectish(ra) && objectish(re)) {
    if (ra.type === "json" || re.type === "json") return true;
    if (isEmptyObject(ra) || isEmptyObject(re)) return true;
    return shapesEqual(ra, re);
  }
  if (arrayish(ra) && arrayish(re)) {
    if (ra.type === "json" || re.type === "json") return true;
    return shapesEqual(ra, re);
  }
  return shapesEqual(ra, re);
}
```

Note: `resolveShape` already returns `json` unchanged (it only rewrites `ref`/`object`/`array`); no edit needed there.

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -w @journeyman/core -- shapes.compat`
Expected: PASS (all cases green).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/types/shape.types.ts packages/core/src/types/shapes.ts packages/core/src/types/shapes.compat.test.ts
git commit -m "feat(core): add opaque json Shape variant + shapesCompatible helper"
```

---

## Task 2: Switch core type unions, validators, and the input-shape helper

**Files:**
- Modify: `packages/core/src/types/flow.types.ts` (`WorkflowInputDef.type`; add `workflowInputDefShape`)
- Modify: `packages/core/src/types/workflow-trigger.types.ts:3` (`TriggerInputMappingType`)
- Modify: `packages/core/src/types/custom-steps.types.ts:7-11` (`CustomStepInputType`)
- Modify: `packages/core/src/utils/validate-workflow.ts` (`shapeTag`, `validateInputBinding`, `workflowInputShape`)
- Modify: `packages/core/src/index.ts` (exports)
- Test: `packages/core/src/types/workflow-input-shape.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/types/workflow-input-shape.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { workflowInputDefShape } from "./flow.types.ts";
import { shapeTag } from "../utils/validate-workflow.ts";

describe("workflowInputDefShape", () => {
  it("maps scalars", () => {
    expect(workflowInputDefShape({ name: "a", type: "string" })).toEqual({ type: "string" });
    expect(workflowInputDefShape({ name: "a", type: "number" })).toEqual({ type: "number" });
    expect(workflowInputDefShape({ name: "a", type: "boolean" })).toEqual({ type: "boolean" });
  });
  it("maps json object/array to json shapes", () => {
    expect(workflowInputDefShape({ name: "a", type: "json-object" }))
      .toEqual({ type: "json", container: "object" });
    expect(workflowInputDefShape({ name: "a", type: "json-array" }))
      .toEqual({ type: "json", container: "array" });
  });
});

describe("shapeTag — json", () => {
  it("renders friendly json tags", () => {
    expect(shapeTag({ type: "json", container: "object" })).toBe("json object");
    expect(shapeTag({ type: "json", container: "array" })).toBe("json array");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @journeyman/core -- workflow-input-shape`
Expected: FAIL — `workflowInputDefShape` not exported; `"json-object"` not assignable to `WorkflowInputDef.type`.

- [ ] **Step 3: Update `WorkflowInputDef.type` and add `workflowInputDefShape`**

In `packages/core/src/types/flow.types.ts`:

Add the `Shape` import at the top of the import block:

```typescript
import type { SecretScope } from "./secrets.types.ts";
import type { ExecutorKind } from "../registries/provider-catalog.ts";
import type { JsonLogicExpr } from "./flow-condition.types.ts";
import type { Shape } from "./shape.types.ts";
```

Change `WorkflowInputDef` (currently lines 60-65):

```typescript
export interface WorkflowInputDef {
  name: string;
  type: "string" | "number" | "boolean" | "json-object" | "json-array";
  description?: string;
  required?: boolean;
}

/** Editor input type → binding Shape. Exhaustive over WorkflowInputDef.type. */
export function workflowInputDefShape(def: WorkflowInputDef): Shape {
  switch (def.type) {
    case "number":      return { type: "number" };
    case "boolean":     return { type: "boolean" };
    case "json-object": return { type: "json", container: "object" };
    case "json-array":  return { type: "json", container: "array" };
    case "string":      return { type: "string" };
  }
}
```

- [ ] **Step 4: Update `TriggerInputMappingType`**

In `packages/core/src/types/workflow-trigger.types.ts:3`:

```typescript
export type TriggerInputMappingType = "string" | "number" | "boolean" | "json-object" | "json-array";
```

- [ ] **Step 5: Update `CustomStepInputType`**

In `packages/core/src/types/custom-steps.types.ts:7-11`, replace `"object"` / `"array"` with the json names (keep all functional types):

```typescript
export type CustomStepInputType =
  | "string" | "number" | "boolean" | "string[]"
  | "json-object" | "json-array"
  | "workspaceDir" | "repoRef"
  | "template";
```

- [ ] **Step 6: Update `shapeTag`, `validateInputBinding`, `workflowInputShape`**

In `packages/core/src/utils/validate-workflow.ts`:

(a) Add a `json` case to `shapeTag` (the `switch (s.type)` near line 40):

```typescript
export function shapeTag(s: Shape): string {
  switch (s.type) {
    case "string":
    case "number":
    case "boolean": return s.type;
    case "ref":     return s.name;
    case "object":  return s.named ?? "object";
    case "array":   return `${shapeTag(s.items)}[]`;
    case "json":    return s.container === "object" ? "json object" : "json array";
  }
}
```

(b) Replace `validateInputBinding` (lines 56-65) and delete the now-unused `isWildcardObjectMatch` (lines 67-75). Import `shapesCompatible`:

At the top of the file, extend the existing `shapes.ts` import:

```typescript
import { resolveShape, shapeAtPath, shapesCompatible } from "../types/shapes.ts";
```
(Keep whatever else is already imported from that module; remove `shapesEqual` only if it is no longer referenced elsewhere in the file — run typecheck to confirm.)

```typescript
export function validateInputBinding(expected: Shape, actual: Shape | undefined): BindingCheck {
  if (!actual) return { ok: false, reason: "unknown-shape" };
  try {
    if (shapesCompatible(actual, expected)) return { ok: true };
  } catch {
    return { ok: false, reason: "unknown-shape" };
  }
  return { ok: false, reason: "shape-mismatch", expected, actual };
}
```

Delete the `isWildcardObjectMatch` function entirely.

(c) Replace `workflowInputShape` (lines 98-106) to delegate to the shared helper. Import it and change the body:

At the top, extend the flow.types import to include `workflowInputDefShape`:

```typescript
import type { WorkflowGraph, WorkflowNode, WorkflowSaveWarning, WorkflowInputValue, WorkflowInputDef } from "../types/flow.types.ts";
import { workflowInputDefShape } from "../types/flow.types.ts";
```

Replace the function:

```typescript
function workflowInputShape(def: WorkflowInputDef): Shape | undefined {
  return workflowInputDefShape(def);
}
```

(The call site at line 288-289 already guards `root ?` — it now always receives a Shape, which is correct: json inputs are validated permissively via `shapesCompatible`.)

- [ ] **Step 7: Export the new symbols**

In `packages/core/src/index.ts`:

Add `shapesCompatible` to the `shapes.ts` export (line 163-166):

```typescript
export {
  IssueShape, RepoShape, PullRequestShape, WorkspaceShape,
  NAMED_SHAPES, resolveShape, shapesEqual, shapeAtPath, shapesCompatible,
} from "./types/shapes.ts";
```

Add `workflowInputDefShape` to the existing flow.types value-export on line 118:

```typescript
export { WORKFLOW_SCHEMA_VERSION, TRIGGER_NODE_TYPES, isTriggerNode, findTriggerNodes, findManualTriggerNode, workflowInputDefShape } from "./types/flow.types.ts";
```

- [ ] **Step 8: Run tests + typecheck**

Run: `npm test -w @journeyman/core -- workflow-input-shape shapes.compat`
Expected: PASS.

Run: `npm run typecheck -w @journeyman/core`
Expected: PASS (no exhaustiveness errors — `shapeTag` and `workflowInputDefShape` cover `json`).

- [ ] **Step 9: Commit**

```bash
git add packages/core/src
git commit -m "feat(core): json-object/json-array type unions + shared input-shape + binding helpers"
```

---

## Task 3: Map custom-step json types to shapes (`shape-adapter`)

**Files:**
- Modify: `packages/custom-steps/src/shape-adapter.ts` (`inputTypeToShape`)
- Test: `packages/custom-steps/src/shape-adapter.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `packages/custom-steps/src/shape-adapter.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { customStepToShape } from "./shape-adapter.ts";
import type { CustomAiStep } from "@journeyman/core";

function stepWith(type: "json-object" | "json-array"): CustomAiStep {
  return {
    id: "cs1", scope: "org", orgId: "o1", name: "x",
    inputFields: [{ name: "payload", type, required: true }],
    outputMode: "none",
  } as unknown as CustomAiStep;
}

describe("customStepToShape — json inputs", () => {
  it("json-object → json object shape", () => {
    const { inputFields } = customStepToShape(stepWith("json-object"));
    expect(inputFields.payload.shape).toEqual({ type: "json", container: "object" });
  });
  it("json-array → json array shape", () => {
    const { inputFields } = customStepToShape(stepWith("json-array"));
    expect(inputFields.payload.shape).toEqual({ type: "json", container: "array" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @journeyman/custom-steps -- shape-adapter`
Expected: FAIL — `inputTypeToShape` has no `json-object`/`json-array` cases (type error: cases `object`/`array` no longer exist on `CustomStepInputType`).

- [ ] **Step 3: Update `inputTypeToShape`**

In `packages/custom-steps/src/shape-adapter.ts`, replace the `object`/`array` cases:

```typescript
function inputTypeToShape(t: CustomStepInputType): Shape {
  switch (t) {
    case "string":
    case "template":      return { type: "string" };
    case "number":        return { type: "number" };
    case "boolean":       return { type: "boolean" };
    case "string[]":      return { type: "array", items: { type: "string" } };
    case "workspaceDir":  return { type: "string" };
    case "repoRef":       return { type: "ref", name: "RepoRef" };
    case "json-object":   return { type: "json", container: "object" };
    case "json-array":    return { type: "json", container: "array" };
  }
}
```

Note: `jsonSchemaNodeToShape` (output schema) keeps its own `case "object"`/`case "array"` — those switch on JSON-Schema node types, NOT on `Shape`. Do not touch them.

- [ ] **Step 4: Run test + typecheck**

Run: `npm test -w @journeyman/custom-steps -- shape-adapter`
Expected: PASS.
Run: `npm run typecheck -w @journeyman/custom-steps`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/custom-steps/src/shape-adapter.ts packages/custom-steps/src/shape-adapter.test.ts
git commit -m "feat(custom-steps): map json-object/json-array inputs to json shapes"
```

---

## Task 4: Flow-editor picker — drop json→string downgrade, label json leaves, share compat

**Files:**
- Modify: `packages/flow-editor/src/properties-panel/use-upstream-sources.ts:73-82`
- Modify: `packages/flow-editor/src/properties-panel/mention-fields.ts` (`flatten`)
- Modify: `packages/flow-editor/src/state/validate-ref-shape.ts`
- Test (extend existing tsx-run node-assert test): `packages/flow-editor/src/properties-panel/mention-fields.test.ts`

- [ ] **Step 1: Add a failing assertion to the mention-fields test**

In `packages/flow-editor/src/properties-panel/mention-fields.test.ts`, before the final `console.log("mention-fields: ok");`, append a focused block that builds a run-input source with a `json object` field and asserts it flattens to a single leaf tagged `json object`:

```typescript
// json object run-input flattens to one opaque leaf
{
  const src: UpstreamSource = {
    kind: "run-input",
    id: "",
    label: "Run inputs",
    groups: [{
      title: "Run inputs",
      scope: "run-input",
      fields: [{ name: "payload", scope: "run-input", shape: { type: "json", container: "object" } }],
    }],
  };
  const f = toMentionFields([src]);
  const payloadLeaf = f.find(x => x.ref === "workflow.input.payload");
  assert.ok(payloadLeaf, "json object run-input should produce a leaf");
  assert.equal(payloadLeaf!.type, "json object");
  assert.equal(f.some(x => x.ref.startsWith("workflow.input.payload.")), false);
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx packages/flow-editor/src/properties-panel/mention-fields.test.ts`
Expected: FAIL — assertion error: `payloadLeaf.type` is `"json"` (not `"json object"`), because `flatten` falls through to the default leaf branch.

- [ ] **Step 3: Handle `json` in `flatten`**

In `packages/flow-editor/src/properties-panel/mention-fields.ts`, add a `json` branch in `flatten` before the final scalar `return`:

```typescript
  if (resolved.type === "array") return [{ path: prefix, type: "array", shape: resolved }];
  if (resolved.type === "json") {
    return [{ path: prefix, type: resolved.container === "object" ? "json object" : "json array", shape: resolved }];
  }
  return [{ path: prefix, type: resolved.type, shape: resolved }];
```

- [ ] **Step 4: Remove the json→string downgrade in `use-upstream-sources`**

In `packages/flow-editor/src/properties-panel/use-upstream-sources.ts`:

Add the import (top of file, alongside `getStartWorkflowInputs`):

```typescript
import { getStartWorkflowInputs, workflowInputDefShape } from "@journeyman/core";
```

Replace the run-input field mapping (currently lines 73-81) so it uses the shared helper:

```typescript
          fields: runInputs.map(r => ({
            name: r.name,
            description: r.description,
            scope: "run-input" as const,
            shape: workflowInputDefShape(r),
          })),
```

- [ ] **Step 5: Use shared helpers in flow-editor `validate-ref-shape`**

In `packages/flow-editor/src/state/validate-ref-shape.ts`:

Replace the imports line:

```typescript
import { shapeAtPath, shapesCompatible, getStartWorkflowInputs, workflowInputDefShape } from "@journeyman/core";
```

Delete `isWildcardMatch` (lines 9-13) and `shapeMatches` (lines 15-17). Replace all `shapeMatches(...)` calls with `shapesCompatible(...)`.

Replace the workflow-input root construction (lines 40-44) with the shared helper:

```typescript
    const decl = decls.find(r => r.name === path[0]);
    if (!decl) return { ok: false, error: `workflow.input.${path[0]} not declared` };
    root = workflowInputDefShape(decl);
```

(Then the existing `if (!root) ...` guard becomes dead — remove it, since `root` is now always assigned. Keep `const leaf = shapeAtPath(root, path.slice(1));` and the rest.)

The two comparison sites become:

```typescript
      return shapesCompatible(leaf, expected) ? { ok: true } : { ok: false, error: `Shape mismatch on '${ref}'` };
```
and
```typescript
    return shapesCompatible(resolveShape(leaf), expected) ? { ok: true } : { ok: false, error: `Shape mismatch on '${ref}'` };
```

Remove the now-unused `resolveShape` import only if the second site no longer references it. (It still does — `resolveShape(leaf)` — so keep `resolveShape` in the import: `import { resolveShape, shapeAtPath, shapesCompatible, getStartWorkflowInputs, workflowInputDefShape } from "@journeyman/core";`.)

- [ ] **Step 6: Run the picker test + typecheck**

Run: `npx tsx packages/flow-editor/src/properties-panel/mention-fields.test.ts`
Expected: prints `mention-fields: ok` (PASS).

Run: `npm run typecheck -w @journeyman/flow-editor`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/flow-editor/src/properties-panel/use-upstream-sources.ts packages/flow-editor/src/properties-panel/mention-fields.ts packages/flow-editor/src/state/validate-ref-shape.ts packages/flow-editor/src/properties-panel/mention-fields.test.ts
git commit -m "feat(flow-editor): treat json inputs as opaque shapes in picker + validator"
```

---

## Task 5: Orchestrator `validate-ref-shape` — share compat, json workflow inputs, describeShape

**Files:**
- Modify: `packages/orchestrator/src/flow-json/validate-ref-shape.ts`

- [ ] **Step 1: Update imports**

In `packages/orchestrator/src/flow-json/validate-ref-shape.ts`, replace line 2:

```typescript
import { resolveShape, shapeAtPath, shapesCompatible, getStartWorkflowInputs, workflowInputDefShape } from "@journeyman/core";
```

- [ ] **Step 2: Use the shared workflow-input shape**

Replace the workflow-input root construction (lines 44-49):

```typescript
    const decl = workflowInputs.find(r => r.name === path[0]);
    if (!decl) return { ok: false, error: `workflow.input.${path[0]} not declared` };
    const root: Shape = workflowInputDefShape(decl);
    const leaf = shapeAtPath(root, path.slice(1));
    return leaf ? { ok: true, shape: leaf } : { ok: false, error: `Path not found: ${ref}` };
```

- [ ] **Step 3: Replace local wildcard match with `shapesCompatible`**

In `validateRefShapeAgainst` (line 100), replace the compatibility check:

```typescript
    ok = shapesCompatible(r.shape, expected);
```

Delete the `isWildcardMatch` function (lines 113-126). (Leave `shapesEqual` out of the import if it is no longer referenced — verify with typecheck; this file did not import it before, so no change.)

- [ ] **Step 4: Add the `json` case to `describeShape`**

In `describeShape` (the `switch (r.type)` near line 135):

```typescript
  switch (r.type) {
    case "object": return r.named ?? "object";
    case "array":  return `${describeShape(r.items)}[]`;
    case "ref":    return r.name;
    case "json":   return r.container === "object" ? "json object" : "json array";
    default:       return r.type;
  }
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck -w @journeyman/orchestrator`
Expected: PASS (exhaustiveness on `describeShape` satisfied; `shapesCompatible` resolves from core).

- [ ] **Step 6: Commit**

```bash
git add packages/orchestrator/src/flow-json/validate-ref-shape.ts
git commit -m "feat(orchestrator): json workflow inputs + shared shapesCompatible in ref validation"
```

---

## Task 6: Update the three UI type dropdowns

**Files:**
- Modify: `packages/flow-editor/src/inputs-tab/InputsTab.tsx:62-66`
- Modify: `packages/flow-editor/src/properties-panel/trigger-webhook-panel.tsx:140-143`
- Modify: `packages/web/src/components/custom-steps/InputFieldsEditor.tsx:4-9` and `:40`

- [ ] **Step 1: Workflow inputs dropdown (`InputsTab.tsx`)**

Replace the `<option value="json">json</option>` line (line 65) with the two json options:

```tsx
                  <option value="string">string</option>
                  <option value="number">number</option>
                  <option value="boolean">boolean</option>
                  <option value="json-object">json object</option>
                  <option value="json-array">json array</option>
```

- [ ] **Step 2: Trigger mapping dropdown (`trigger-webhook-panel.tsx`)**

Replace the `<option value="json">json</option>` line (line 143) with:

```tsx
                      <option value="string">string</option>
                      <option value="number">number</option>
                      <option value="boolean">boolean</option>
                      <option value="json-object">json object</option>
                      <option value="json-array">json array</option>
```

(The default `m?.type ?? inp.type` and the `inp.type as TriggerInputMappingType` cast at line 121 remain valid — both unions are now identical.)

- [ ] **Step 3: Custom-step inputs dropdown (`InputFieldsEditor.tsx`)**

Replace the `TYPES` array (lines 4-9) and render friendly labels. Update the `TYPES` constant:

```tsx
const TYPES: { value: CustomStepInputType; label: string }[] = [
  { value: "string", label: "string" },
  { value: "number", label: "number" },
  { value: "boolean", label: "boolean" },
  { value: "string[]", label: "string[]" },
  { value: "json-object", label: "json object" },
  { value: "json-array", label: "json array" },
  { value: "workspaceDir", label: "workspaceDir" },
  { value: "repoRef", label: "repoRef" },
  { value: "template", label: "template" },
];
```

Update the `<option>` render (line 40):

```tsx
            {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
```

- [ ] **Step 4: Typecheck both packages**

Run: `npm run typecheck -w @journeyman/flow-editor && npm run typecheck -w @journeyman/web`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/flow-editor/src/inputs-tab/InputsTab.tsx packages/flow-editor/src/properties-panel/trigger-webhook-panel.tsx packages/web/src/components/custom-steps/InputFieldsEditor.tsx
git commit -m "feat(ui): standardize input type dropdowns on json object/json array"
```

---

## Task 7: Update api-server runtime coercion

**Files:**
- Modify: `packages/api-server/src/services/webhook-trigger-fire.ts:21-29`
- Modify: `packages/api-server/src/services/form-submission.ts:34-42` and `:75-84`

- [ ] **Step 1: Update webhook trigger coercion**

In `packages/api-server/src/services/webhook-trigger-fire.ts`, replace the `coerce` function (lines 21-29):

```typescript
function coerce(
  value: unknown,
  type: "string" | "number" | "boolean" | "json-object" | "json-array",
): unknown {
  if (value == null) return value;
  switch (type) {
    case "string":      return String(value);
    case "number":      return Number(value);
    case "boolean":     return Boolean(value);
    case "json-object": return value;
    case "json-array":  return value;
  }
}
```

- [ ] **Step 2: Update form-submission widget + coercion**

In `packages/api-server/src/services/form-submission.ts`:

`defaultWidgetFor` (lines 34-42) — replace the `case "json":` arm:

```typescript
function defaultWidgetFor(type: WorkflowInputDef["type"]): TriggerHumanFieldWidget {
  switch (type) {
    case "number":      return "number";
    case "boolean":     return "checkbox";
    case "json-object": return "textarea";
    case "json-array":  return "textarea";
    case "string":
    default:            return "text";
  }
}
```

`coerceInput` (lines 75-84) — replace the `case "json":` arm:

```typescript
function coerceInput(value: unknown, type: WorkflowInputDef["type"]): unknown {
  if (value == null) return value;
  switch (type) {
    case "number":      return typeof value === "number" ? value : Number(value);
    case "boolean":     return Boolean(value);
    case "json-object": return typeof value === "string" ? JSON.parse(value) : value;
    case "json-array":  return typeof value === "string" ? JSON.parse(value) : value;
    case "string":
    default:            return String(value);
  }
}
```

- [ ] **Step 3: Typecheck api-server**

Run: `npm run typecheck -w @journeyman/api-server`
Expected: PASS. (If `match-human-tasks.ts` errors, it should NOT — it switches on `WebhookWaitOutputField["type"]`, which is unchanged. Do not edit it.)

- [ ] **Step 4: Commit**

```bash
git add packages/api-server/src/services/webhook-trigger-fire.ts packages/api-server/src/services/form-submission.ts
git commit -m "feat(api-server): coerce json-object/json-array workflow inputs"
```

---

## Task 8: Full verification + regression

**Files:** none (verification only)

- [ ] **Step 1: Workspace-wide typecheck + import boundaries**

Run: `npm run check`
Expected: PASS — no type errors, no import-boundary violations. This is the completeness gate: any `switch (shape.type)` site missed in earlier tasks surfaces here as a non-exhaustive-switch error.

- [ ] **Step 2: Run all workspace tests**

Run: `npm test`
Expected: PASS. Pay attention to `@journeyman/core` and `@journeyman/custom-steps` suites (new + existing). If any existing test asserted the old `json → { type: "string" }` behavior, update it to expect `{ type: "json", container: ... }`.

- [ ] **Step 3: Run the flow-editor node-assert tests via tsx**

Run: `npx tsx packages/flow-editor/src/properties-panel/mention-fields.test.ts && npx tsx packages/flow-editor/src/properties-panel/pause-node-source.test.ts`
Expected: both print `... ok`. `pause-node-source` is unchanged (webhook-wait `json` still maps to `{ type: "object", fields: {} }`) and must still pass.

- [ ] **Step 4: Manual regression — the reported bug**

Build/run the web app per the project commands (`npm run dev:web`, with infra + api-server as needed). In the flow editor:
1. Add a workflow input `payload` of type **json object**.
2. Add a custom step whose input `payload` is type **json object**.
3. On the custom step's `payload` field, type `@` — confirm `Run inputs → payload` appears with a **json object** tag and is **selectable** (not dimmed), and that selecting it clears the "missing required input" issue.

Expected: the binding is accepted; no "Type mismatch" message. This is the exact scenario from the spec's problem statement.

- [ ] **Step 5: Final commit (if any test fixtures were updated in Step 2)**

```bash
git add -A
git commit -m "test: align fixtures with json object/array shapes"
```

---

## Self-Review Notes (for the implementer)

- **Spec coverage:** Task 1 (json Shape + compat), Task 2 (unions + shapeTag + validator + helper export), Task 3 (custom-step adapter), Task 4 (picker downgrade + leaf label + flow-editor validator), Task 5 (orchestrator validator), Task 6 (3 UI dropdowns), Task 7 (runtime coercion), Task 8 (verification + regression) — all spec sections §1–§6, testing, and out-of-scope boundaries are covered.
- **Type consistency:** the editor literals are `"json-object"` / `"json-array"` everywhere (unions, dropdowns, adapters, coercion); the binding Shape is `{ type: "json", container: "object" | "array" }`; display strings are `"json object"` / `"json array"` (in `shapeTag`, `describeShape`, dropdown labels, mention leaf `type`). The single mapping point editor-type→Shape is `workflowInputDefShape` (workflow inputs) and `inputTypeToShape` (custom steps); the single compat point is `shapesCompatible`.
- **No migration:** existing stored flows/steps with `"json"`/`"object"`/`"array"` strings are intentionally not handled — per spec.
