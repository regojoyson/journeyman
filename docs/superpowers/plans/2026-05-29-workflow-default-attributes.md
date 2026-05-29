# Workflow Default Attributes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add workflow-level "default attributes" — named, typed, design-time constants defined once on the workflow and selectable in any step's config via the existing `@`-mention picker, exactly like workflow inputs.

**Architecture:** A new `WorkflowAttributeDef` type (name + type + value) lives on `WorkflowGraph.attributeDefs`. The flow-editor exposes them as a second section in the Inputs drawer and as a picker group with refs of the form `workflow.attribute.{name}`. At run-start the orchestrator seeds their values into the engine's `workflow.input` namespace under a nested `attributes` key; `resolveInputs` rewrites a `workflow.attribute.x` binding to the Conductor template `${workflow.input.attributes.x}`. Values are plain literals — no templating.

**Tech Stack:** TypeScript (ESM, `.ts` extension imports), React (flow-editor), `@journeyman/core` shared types, Conductor orchestrator. Tests are assert-based `.test.ts` files run with `npx tsx <file>`.

**User constraints (override skill defaults):**
- **Do NOT commit** at any point during implementation. There are no `git commit` steps in this plan.
- **Run `npm run typecheck` at the very end** as the completion gate (final task).

**Spec:** `docs/superpowers/specs/2026-05-29-workflow-default-attributes-design.md`

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `packages/core/src/types/flow.types.ts` | `WorkflowAttributeDef` type, `attributeDefs` on graph, shape helper | Modify |
| `packages/core/src/index.ts` | Export the new type + helper | Modify |
| `packages/core/src/types/flow-attribute-def.test.ts` | Unit test for `workflowAttributeDefShape` | Create |
| `packages/flow-editor/src/properties-panel/use-upstream-sources.ts` | Add a "workflow-attribute" source group | Modify |
| `packages/flow-editor/src/properties-panel/mention-fields.ts` | Emit `workflow.attribute.{name}` refs | Modify |
| `packages/flow-editor/src/properties-panel/mention-fields.attribute.test.ts` | Test attribute ref emission | Create |
| `packages/flow-editor/src/inputs-tab/AttributeValueField.tsx` | Typed value editor (switch-on-type) | Create |
| `packages/flow-editor/src/inputs-tab/InputsTab.tsx` | Add "Default Attributes" section | Modify |
| `packages/flow-editor/src/FlowEditor.tsx` | Wire `onPatchAttributes` | Modify |
| `packages/orchestrator/src/flow-json/resolve-inputs.ts` | Rewrite attribute refs + parse scope | Modify |
| `packages/orchestrator/src/flow-json/resolve-inputs.attribute.test.ts` | Test ref rewrite + parseRef | Create |
| `packages/orchestrator/src/flow-json/attribute-inputs.ts` | `buildAttributeInputs(defs)` pure helper | Create |
| `packages/orchestrator/src/flow-json/attribute-inputs.test.ts` | Test the seeding helper | Create |
| `packages/orchestrator/src/flow-json/validate-ref-shape.ts` | Resolve attribute ref shapes at save-time | Modify |
| `packages/orchestrator/src/engines/conductor/conductor-orchestrator.ts` | Seed `attributes` into start input | Modify |

---

## Task 1: Core type — `WorkflowAttributeDef`

**Files:**
- Modify: `packages/core/src/types/flow.types.ts:61-77` (add type + shape helper near `WorkflowInputDef`), `:135` (add `attributeDefs` to `WorkflowGraph`)
- Modify: `packages/core/src/index.ts:113,118`
- Test: `packages/core/src/types/flow-attribute-def.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/types/flow-attribute-def.test.ts`:

```ts
import assert from "node:assert/strict";
import type { WorkflowAttributeDef } from "./flow.types.ts";
import { workflowAttributeDefShape } from "./flow.types.ts";

const cases: Array<[WorkflowAttributeDef["type"], unknown]> = [
  ["string", { type: "string" }],
  ["number", { type: "number" }],
  ["boolean", { type: "boolean" }],
  ["json-object", { type: "json", container: "object" }],
  ["json-array", { type: "json", container: "array" }],
];

for (const [type, expected] of cases) {
  const def: WorkflowAttributeDef = { name: "x", type, value: null };
  assert.deepEqual(workflowAttributeDefShape(def), expected, `shape for ${type}`);
}

console.log("flow-attribute-def: ok");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx packages/core/src/types/flow-attribute-def.test.ts`
Expected: FAIL — `workflowAttributeDefShape` / `WorkflowAttributeDef` not exported.

- [ ] **Step 3: Add the type, shape helper, and graph field**

In `packages/core/src/types/flow.types.ts`, immediately after the `workflowInputDefShape` function (after line 77), add:

```ts
export interface WorkflowAttributeDef {
  name: string;
  type: "string" | "number" | "boolean" | "json-object" | "json-array";
  /** Plain literal constant, typed per `type`. No templating/refs. */
  value: unknown;
  description?: string;
}

/** Editor attribute type → binding Shape. Exhaustive over WorkflowAttributeDef.type. */
export function workflowAttributeDefShape(def: WorkflowAttributeDef): Shape {
  switch (def.type) {
    case "number":      return { type: "number" };
    case "boolean":     return { type: "boolean" };
    case "json-object": return { type: "json", container: "object" };
    case "json-array":  return { type: "json", container: "array" };
    case "string":      return { type: "string" };
  }
}
```

Then in the `WorkflowGraph` interface, directly after the `inputDefs?` line (line 135), add:

```ts
  /** Design-time constant attributes, selectable in any step's config. */
  attributeDefs?: WorkflowAttributeDef[];
```

- [ ] **Step 4: Export from core index**

In `packages/core/src/index.ts`, line 113, add `WorkflowAttributeDef` to the `export type { ... }` list (alongside `WorkflowInputDef`):

```ts
  McpServerConfig, McpTransport, WorkflowInputValue, WorkflowInputDef, WorkflowAttributeDef,
```

And on line 118, add `workflowAttributeDefShape` to the value `export { ... }`:

```ts
export { WORKFLOW_SCHEMA_VERSION, TRIGGER_NODE_TYPES, isTriggerNode, findTriggerNodes, findManualTriggerNode, workflowInputDefShape, workflowAttributeDefShape } from "./types/flow.types.ts";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx tsx packages/core/src/types/flow-attribute-def.test.ts`
Expected: PASS — prints `flow-attribute-def: ok`.

---

## Task 2: Picker plumbing — emit `workflow.attribute.{name}` refs

**Files:**
- Modify: `packages/flow-editor/src/properties-panel/use-upstream-sources.ts:9-24` (scope union), `:64-81` (add attribute source)
- Modify: `packages/flow-editor/src/properties-panel/mention-fields.ts:16-28` (ref/path for new scope)
- Test: `packages/flow-editor/src/properties-panel/mention-fields.attribute.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/flow-editor/src/properties-panel/mention-fields.attribute.test.ts`:

```ts
import assert from "node:assert/strict";
import type { UpstreamSource } from "./use-upstream-sources.ts";
import { toMentionFields } from "./mention-fields.ts";

const sources: UpstreamSource[] = [
  {
    kind: "workflow-attribute",
    id: "",
    label: "Default attributes",
    groups: [{
      title: "Default attributes",
      scope: "workflow-attribute",
      fields: [
        { name: "branchPrefix", scope: "workflow-attribute", shape: { type: "string" } },
        { name: "maxRetries", scope: "workflow-attribute", shape: { type: "number" } },
      ],
    }],
  },
];

const fields = toMentionFields(sources);

const prefix = fields.find(f => f.ref === "workflow.attribute.branchPrefix");
assert.ok(prefix, "branchPrefix attribute should produce a leaf");
assert.equal(prefix!.fieldPath, "branchPrefix");
assert.equal(prefix!.type, "string");

const retries = fields.find(f => f.ref === "workflow.attribute.maxRetries");
assert.ok(retries, "maxRetries attribute should produce a leaf");
assert.equal(retries!.type, "number");

console.log("mention-fields.attribute: ok");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx packages/flow-editor/src/properties-panel/mention-fields.attribute.test.ts`
Expected: FAIL — type error / no field with ref `workflow.attribute.branchPrefix` (currently the `kind`/`scope` literal `"workflow-attribute"` is not assignable, and `refFor` does not handle it).

- [ ] **Step 3: Extend the scope union in use-upstream-sources.ts**

In `packages/flow-editor/src/properties-panel/use-upstream-sources.ts`, change the `UpstreamField.scope` union (line 13) and the comment to include the new scope:

```ts
  /** "input" → ${node.input.x} ; "output" → ${node.output.x} ; "run-input" → ${workflow.input.x} ; "workflow-attribute" → ${workflow.attribute.x} */
  scope: "input" | "output" | "run-input" | "workflow-attribute";
```

Change `UpstreamSource.kind` (line 18) and its `groups[].scope` (line 23):

```ts
export interface UpstreamSource {
  kind: "run-input" | "workflow-attribute" | "node";
  /** node id, or "" for run-input / workflow-attribute */
  id: string;
  label: string;
  /** Grouped fields for the picker. */
  groups: { title: string; scope: "input" | "output" | "run-input" | "workflow-attribute"; fields: UpstreamField[] }[];
}
```

- [ ] **Step 4: Add the attribute source in the hook**

In `packages/flow-editor/src/properties-panel/use-upstream-sources.ts`, add `workflowAttributeDefShape` to the existing core import (line 3):

```ts
import { getStartWorkflowInputs, workflowInputDefShape, workflowAttributeDefShape } from "@journeyman/core";
```

Then directly after the `if (runInputs.length) { ... }` block that pushes the run-input source (after line 81), add:

```ts
    const attributeDefs = graph.attributeDefs ?? [];
    if (attributeDefs.length) {
      sources.push({
        kind: "workflow-attribute",
        id: "",
        label: "Default attributes",
        groups: [{
          title: "Default attributes",
          scope: "workflow-attribute",
          fields: attributeDefs.map(a => ({
            name: a.name,
            description: a.description,
            scope: "workflow-attribute" as const,
            shape: workflowAttributeDefShape(a),
          })),
        }],
      });
    }
```

- [ ] **Step 5: Handle the new scope in mention-fields.ts**

In `packages/flow-editor/src/properties-panel/mention-fields.ts`, update `refFor` (lines 16-21) and `fieldPathFor` (lines 23-28):

```ts
function refFor(scope: UpstreamField["scope"], sourceId: string, path: string[]): string {
  const tail = path.join(".");
  if (scope === "run-input") return `workflow.input.${tail}`;
  if (scope === "workflow-attribute") return `workflow.attribute.${tail}`;
  if (scope === "input") return `${sourceId}.input.${tail}`;
  return `${sourceId}.output.${tail}`;
}

function fieldPathFor(scope: UpstreamField["scope"], path: string[]): string {
  const tail = path.join(".");
  if (scope === "run-input") return tail;
  if (scope === "workflow-attribute") return tail;
  if (scope === "input") return `input.${tail}`;
  return `output.${tail}`;
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx tsx packages/flow-editor/src/properties-panel/mention-fields.attribute.test.ts`
Expected: PASS — prints `mention-fields.attribute: ok`.

- [ ] **Step 7: Re-run the existing mention test for no regression**

Run: `npx tsx packages/flow-editor/src/properties-panel/mention-fields.test.ts`
Expected: PASS — prints `mention-fields: ok`.

---

## Task 3: Editor UI — `AttributeValueField` typed value editor

**Files:**
- Create: `packages/flow-editor/src/inputs-tab/AttributeValueField.tsx`
- Test: `packages/flow-editor/src/inputs-tab/AttributeValueField.test.ts`

This component is the typed value editor used by the Default Attributes table. It must surface invalid JSON so the table can block saving a malformed attribute. We split the JSON-parsing logic into a pure exported helper so it is unit-testable without rendering React.

- [ ] **Step 1: Write the failing test**

Create `packages/flow-editor/src/inputs-tab/AttributeValueField.test.ts`:

```ts
import assert from "node:assert/strict";
import { parseAttributeValue } from "./AttributeValueField.tsx";

// string passes through verbatim
assert.deepEqual(parseAttributeValue("string", "feature/"), { ok: true, value: "feature/" });

// number parses; non-numeric fails
assert.deepEqual(parseAttributeValue("number", "42"), { ok: true, value: 42 });
assert.equal(parseAttributeValue("number", "abc").ok, false);

// boolean
assert.deepEqual(parseAttributeValue("boolean", "true"), { ok: true, value: true });

// json-object: valid object ok; array rejected for object container; malformed rejected
assert.deepEqual(parseAttributeValue("json-object", '{"a":1}'), { ok: true, value: { a: 1 } });
assert.equal(parseAttributeValue("json-object", "[1,2]").ok, false);
assert.equal(parseAttributeValue("json-object", "{bad}").ok, false);

// json-array: valid array ok; object rejected
assert.deepEqual(parseAttributeValue("json-array", "[1,2]"), { ok: true, value: [1, 2] });
assert.equal(parseAttributeValue("json-array", '{"a":1}').ok, false);

console.log("AttributeValueField: ok");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx packages/flow-editor/src/inputs-tab/AttributeValueField.test.ts`
Expected: FAIL — module / `parseAttributeValue` not found.

- [ ] **Step 3: Create the component + helper**

Create `packages/flow-editor/src/inputs-tab/AttributeValueField.tsx`:

```tsx
import type { WorkflowAttributeDef } from "@journeyman/core";

type AttrType = WorkflowAttributeDef["type"];

export type ParseResult =
  | { ok: true; value: unknown }
  | { ok: false; error: string };

/** Parse the raw editor string for an attribute of the given type into a typed value. */
export function parseAttributeValue(type: AttrType, raw: string): ParseResult {
  switch (type) {
    case "string":
      return { ok: true, value: raw };
    case "number": {
      if (raw.trim() === "" || Number.isNaN(Number(raw))) {
        return { ok: false, error: "Not a valid number" };
      }
      return { ok: true, value: Number(raw) };
    }
    case "boolean":
      return { ok: true, value: raw === "true" };
    case "json-object":
    case "json-array": {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return { ok: false, error: "Invalid JSON" };
      }
      const isArray = Array.isArray(parsed);
      if (type === "json-object" && (isArray || typeof parsed !== "object" || parsed === null)) {
        return { ok: false, error: "Expected a JSON object" };
      }
      if (type === "json-array" && !isArray) {
        return { ok: false, error: "Expected a JSON array" };
      }
      return { ok: true, value: parsed };
    }
  }
}

/** Stringify a stored attribute value back to the raw editor string. */
export function attributeValueToRaw(type: AttrType, value: unknown): string {
  if (type === "string") return typeof value === "string" ? value : "";
  if (type === "number") return value == null ? "" : String(value);
  if (type === "boolean") return value === true ? "true" : "false";
  // json-object / json-array
  try {
    return value === undefined ? "" : JSON.stringify(value);
  } catch {
    return "";
  }
}

export interface AttributeValueFieldProps {
  type: AttrType;
  value: unknown;
  disabled?: boolean;
  onChange: (value: unknown) => void;
}

export function AttributeValueField({ type, value, disabled, onChange }: AttributeValueFieldProps): JSX.Element {
  if (type === "boolean") {
    return (
      <input
        type="checkbox"
        disabled={disabled}
        checked={value === true}
        onChange={(e) => onChange(e.target.checked)}
      />
    );
  }

  const raw = attributeValueToRaw(type, value);

  function commit(next: string): void {
    const result = parseAttributeValue(type, next);
    if (result.ok) onChange(result.value);
    // Invalid values are not committed to the def; the field shows an error
    // and the table-level validation (Task 4) blocks an invalid save.
  }

  if (type === "json-object" || type === "json-array") {
    const invalid = !parseAttributeValue(type, raw).ok && raw.trim() !== "";
    return (
      <textarea
        className={invalid ? "jm-inputs-tab__value-invalid" : undefined}
        disabled={disabled}
        defaultValue={raw}
        onBlur={(e) => commit(e.target.value)}
        rows={2}
      />
    );
  }

  return (
    <input
      type={type === "number" ? "number" : "text"}
      disabled={disabled}
      defaultValue={raw}
      onBlur={(e) => commit(e.target.value)}
    />
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx packages/flow-editor/src/inputs-tab/AttributeValueField.test.ts`
Expected: PASS — prints `AttributeValueField: ok`.

---

## Task 4: Editor UI — Default Attributes section in `InputsTab`

**Files:**
- Modify: `packages/flow-editor/src/inputs-tab/InputsTab.tsx` (whole file)
- Modify: `packages/flow-editor/src/FlowEditor.tsx:289-295`

- [ ] **Step 1: Rewrite InputsTab with two sections**

Replace the entire contents of `packages/flow-editor/src/inputs-tab/InputsTab.tsx` with:

```tsx
// packages/flow-editor/src/inputs-tab/InputsTab.tsx
import type { WorkflowGraph, WorkflowInputDef, WorkflowAttributeDef } from "@journeyman/core";
import { AttributeValueField } from "./AttributeValueField.tsx";

export interface InputsTabProps {
  graph: WorkflowGraph;
  onPatchInputs: (next: WorkflowInputDef[]) => void;
  onPatchAttributes: (next: WorkflowAttributeDef[]) => void;
}

export function InputsTab({ graph, onPatchInputs, onPatchAttributes }: InputsTabProps): JSX.Element {
  const inputs = graph.inputDefs ?? [];
  const attributes = graph.attributeDefs ?? [];

  function updateInput(idx: number, patch: Partial<WorkflowInputDef>): void {
    onPatchInputs(inputs.map((inp, i) => (i === idx ? { ...inp, ...patch } : inp)));
  }
  function addInput(): void {
    onPatchInputs([...inputs, { name: `input_${inputs.length + 1}`, type: "string", required: false }]);
  }
  function removeInput(idx: number): void {
    onPatchInputs(inputs.filter((_, i) => i !== idx));
  }

  function updateAttr(idx: number, patch: Partial<WorkflowAttributeDef>): void {
    onPatchAttributes(attributes.map((a, i) => (i === idx ? { ...a, ...patch } : a)));
  }
  function addAttr(): void {
    onPatchAttributes([...attributes, { name: `attribute_${attributes.length + 1}`, type: "string", value: "" }]);
  }
  function removeAttr(idx: number): void {
    onPatchAttributes(attributes.filter((_, i) => i !== idx));
  }

  // Name validation: non-empty + unique within attributes.
  function attrNameError(idx: number): string | null {
    const name = attributes[idx].name.trim();
    if (!name) return "Name required";
    const dup = attributes.some((a, i) => i !== idx && a.name.trim() === name);
    return dup ? "Duplicate name" : null;
  }

  return (
    <div className="jm-inputs-tab">
      <h2>Workflow inputs</h2>
      <p>All triggers map their source data onto these inputs.</p>
      <table className="jm-inputs-tab__table">
        <colgroup>
          <col className="jm-inputs-tab__col-name" />
          <col className="jm-inputs-tab__col-type" />
          <col className="jm-inputs-tab__col-required" />
          <col className="jm-inputs-tab__col-description" />
          <col className="jm-inputs-tab__col-actions" />
        </colgroup>
        <thead>
          <tr>
            <th>Name</th>
            <th>Type</th>
            <th>Required</th>
            <th>Description</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {inputs.map((inp, idx) => (
            <tr key={idx}>
              <td>
                <input type="text" value={inp.name} onChange={(e) => updateInput(idx, { name: e.target.value })} />
              </td>
              <td>
                <select value={inp.type} onChange={(e) => updateInput(idx, { type: e.target.value as WorkflowInputDef["type"] })}>
                  <option value="string">string</option>
                  <option value="number">number</option>
                  <option value="boolean">boolean</option>
                  <option value="json-object">json object</option>
                  <option value="json-array">json array</option>
                </select>
              </td>
              <td className="jm-inputs-tab__cell-required">
                <input type="checkbox" checked={inp.required === true} onChange={(e) => updateInput(idx, { required: e.target.checked })} />
              </td>
              <td>
                <input type="text" value={inp.description ?? ""} onChange={(e) => updateInput(idx, { description: e.target.value || undefined })} />
              </td>
              <td>
                <button type="button" className="jm-inputs-tab__remove" onClick={() => removeInput(idx)}>Remove</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" onClick={addInput}>+ Add input</button>

      <h2>Default attributes</h2>
      <p>Constant values you can pick from any step's config, like inputs.</p>
      <table className="jm-inputs-tab__table">
        <colgroup>
          <col className="jm-inputs-tab__col-name" />
          <col className="jm-inputs-tab__col-type" />
          <col className="jm-inputs-tab__col-description" />
          <col className="jm-inputs-tab__col-actions" />
        </colgroup>
        <thead>
          <tr>
            <th>Name</th>
            <th>Type</th>
            <th>Value</th>
            <th>Description</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {attributes.map((attr, idx) => {
            const err = attrNameError(idx);
            return (
              <tr key={idx}>
                <td>
                  <input
                    type="text"
                    value={attr.name}
                    className={err ? "jm-inputs-tab__value-invalid" : undefined}
                    title={err ?? undefined}
                    onChange={(e) => updateAttr(idx, { name: e.target.value })}
                  />
                </td>
                <td>
                  <select
                    value={attr.type}
                    onChange={(e) => updateAttr(idx, { type: e.target.value as WorkflowAttributeDef["type"], value: undefined })}
                  >
                    <option value="string">string</option>
                    <option value="number">number</option>
                    <option value="boolean">boolean</option>
                    <option value="json-object">json object</option>
                    <option value="json-array">json array</option>
                  </select>
                </td>
                <td>
                  <AttributeValueField
                    type={attr.type}
                    value={attr.value}
                    onChange={(value) => updateAttr(idx, { value })}
                  />
                </td>
                <td>
                  <input type="text" value={attr.description ?? ""} onChange={(e) => updateAttr(idx, { description: e.target.value || undefined })} />
                </td>
                <td>
                  <button type="button" className="jm-inputs-tab__remove" onClick={() => removeAttr(idx)}>Remove</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <button type="button" onClick={addAttr}>+ Add attribute</button>
    </div>
  );
}
```

- [ ] **Step 2: Wire `onPatchAttributes` in FlowEditor**

In `packages/flow-editor/src/FlowEditor.tsx`, the `<InputsTab ... />` block (lines 289-295) currently passes `graph` and `onPatchInputs`. Add the attributes handler so the block reads:

```tsx
                <InputsTab
                  graph={heal.healed}
                  onPatchInputs={(next) => {
                    if (effectiveReadOnly) return;
                    s.update((f) => ({ ...f, inputDefs: next }));
                  }}
                  onPatchAttributes={(next) => {
                    if (effectiveReadOnly) return;
                    s.update((f) => ({ ...f, attributeDefs: next }));
                  }}
                />
```

- [ ] **Step 3: Typecheck the flow-editor package**

Run: `npm run typecheck -w @journeyman/flow-editor`
Expected: PASS — no type errors. (Confirms the new prop, imports, and JSX are consistent.)

---

## Task 5: Orchestrator — rewrite attribute refs in `resolve-inputs`

**Files:**
- Modify: `packages/orchestrator/src/flow-json/resolve-inputs.ts:4-16` (rewrite), `:18-24` (RefScope/ParsedRef), `:47-54` (parseRef)
- Test: `packages/orchestrator/src/flow-json/resolve-inputs.attribute.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/orchestrator/src/flow-json/resolve-inputs.attribute.test.ts`:

```ts
import assert from "node:assert/strict";
import { resolveInputs, parseRef } from "./resolve-inputs.ts";

// A ref binding to an attribute rewrites to the nested workflow.input.attributes namespace.
const out = resolveInputs({
  branch: { kind: "ref", ref: "workflow.attribute.branchPrefix" },
  ticket: { kind: "ref", ref: "workflow.input.ticketId" },
  literal: { kind: "literal", value: 7 },
});
assert.equal(out.branch, "${workflow.input.attributes.branchPrefix}");
assert.equal(out.ticket, "${workflow.input.ticketId}");
assert.equal(out.literal, 7);

// parseRef recognises the attribute scope.
const parsed = parseRef("workflow.attribute.branchPrefix");
assert.ok(parsed, "attribute ref should parse");
assert.equal(parsed!.scope, "workflow.attribute");
assert.equal(parsed!.field, "branchPrefix");

console.log("resolve-inputs.attribute: ok");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx packages/orchestrator/src/flow-json/resolve-inputs.attribute.test.ts`
Expected: FAIL — `out.branch` is `${workflow.attribute.branchPrefix}` (not rewritten) and `parseRef` returns `null` for the attribute ref.

- [ ] **Step 3: Add the engine-ref rewrite + use it**

In `packages/orchestrator/src/flow-json/resolve-inputs.ts`, add a `toEngineRef` helper and use it in both the `ref` and `template` branches. Replace the `resolveInputs` body (lines 4-16) with:

```ts
export function resolveInputs(
  inputs: Record<string, WorkflowInputValue> | null | undefined,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(inputs ?? {})) {
    if (v.kind === "literal") out[k] = v.value;
    else if (v.kind === "ref") out[k] = "${" + toEngineRef(v.ref) + "}";
    else if (v.kind === "template") {
      out[k] = replaceTemplateRefs(v.template, (ref) => "${" + toEngineRef(ref) + "}");
    }
  }
  return out;
}

/**
 * Editor ref → Conductor template path. The engine only resolves the
 * `workflow.input.*` namespace, so attribute refs (`workflow.attribute.x`) are
 * rewritten to the nested `workflow.input.attributes.x` seeded at run-start.
 * All other refs pass through (after markdown-autolink sanitization).
 */
export function toEngineRef(ref: string): string {
  const clean = sanitizeRef(ref);
  if (clean.startsWith("workflow.attribute.")) {
    return "workflow.input.attributes." + clean.slice("workflow.attribute.".length);
  }
  return clean;
}
```

- [ ] **Step 4: Add the attribute scope to RefScope/ParsedRef and parseRef**

In the same file, extend the `RefScope` type (line 18):

```ts
export type RefScope = "workflow.input" | "workflow.attribute" | "input" | "output";
```

Then in `parseRef` (lines 47-54), add the attribute branch before the node-ref regex:

```ts
export function parseRef(ref: string): ParsedRef | null {
  const clean = sanitizeRef(ref);
  if (clean.startsWith("workflow.input.")) {
    return { source: "workflow.input", scope: "workflow.input", field: clean.slice("workflow.input.".length) };
  }
  if (clean.startsWith("workflow.attribute.")) {
    return { source: "workflow.attribute", scope: "workflow.attribute", field: clean.slice("workflow.attribute.".length) };
  }
  const m = /^([^.]+)\.(input|output)\.(.+)$/.exec(clean);
  return m ? { source: m[1], scope: m[2] as RefScope, field: m[3] } : null;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx tsx packages/orchestrator/src/flow-json/resolve-inputs.attribute.test.ts`
Expected: PASS — prints `resolve-inputs.attribute: ok`.

---

## Task 6: Orchestrator — seed attribute values into the start input

**Files:**
- Create: `packages/orchestrator/src/flow-json/attribute-inputs.ts`
- Test: `packages/orchestrator/src/flow-json/attribute-inputs.test.ts`
- Modify: `packages/orchestrator/src/engines/conductor/conductor-orchestrator.ts:86-92`

- [ ] **Step 1: Write the failing test**

Create `packages/orchestrator/src/flow-json/attribute-inputs.test.ts`:

```ts
import assert from "node:assert/strict";
import type { WorkflowAttributeDef } from "@journeyman/core";
import { buildAttributeInputs } from "./attribute-inputs.ts";

const defs: WorkflowAttributeDef[] = [
  { name: "branchPrefix", type: "string", value: "feature/" },
  { name: "maxRetries", type: "number", value: 3 },
  { name: "flags", type: "json-object", value: { a: 1 } },
];

assert.deepEqual(buildAttributeInputs(defs), {
  branchPrefix: "feature/",
  maxRetries: 3,
  flags: { a: 1 },
});

// undefined / empty → empty object (never undefined)
assert.deepEqual(buildAttributeInputs(undefined), {});
assert.deepEqual(buildAttributeInputs([]), {});

// later def with duplicate name wins (defensive; editor blocks dupes)
assert.deepEqual(
  buildAttributeInputs([
    { name: "x", type: "string", value: "a" },
    { name: "x", type: "string", value: "b" },
  ]),
  { x: "b" },
);

console.log("attribute-inputs: ok");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx packages/orchestrator/src/flow-json/attribute-inputs.test.ts`
Expected: FAIL — module / `buildAttributeInputs` not found.

- [ ] **Step 3: Create the helper**

Create `packages/orchestrator/src/flow-json/attribute-inputs.ts`:

```ts
import type { WorkflowAttributeDef } from "@journeyman/core";

/**
 * Build the `attributes` sub-map seeded into the run's `workflow.input`
 * namespace from the workflow graph's design-time attribute defs. Bindings of
 * the form `workflow.attribute.x` resolve against `workflow.input.attributes.x`.
 */
export function buildAttributeInputs(
  defs: WorkflowAttributeDef[] | null | undefined,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const def of defs ?? []) {
    out[def.name] = def.value;
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx packages/orchestrator/src/flow-json/attribute-inputs.test.ts`
Expected: PASS — prints `attribute-inputs: ok`.

- [ ] **Step 5: Seed attributes into the conductor start input**

In `packages/orchestrator/src/engines/conductor/conductor-orchestrator.ts`, add the import near the top (with the other `flow-json` / core imports):

```ts
import { buildAttributeInputs } from "../../flow-json/attribute-inputs.ts";
```

Then change the `startWorkflow` input object (lines 86-92) to seed the nested `attributes` map from the definition snapshot:

```ts
      input: {
        ...args.inputs,
        attributes: buildAttributeInputs(args.definitionSnapshot.attributeDefs),
        workflowInstanceId: instance.id,
        startedByUserId: args.startedByUserId ?? null,
        startedByOrgId: args.startedByOrgId ?? null,
        workflowId: args.workflowId,
      },
```

> Note: confirm the relative import path (`../../flow-json/attribute-inputs.ts`) matches the directory depth of `engines/conductor/`. The file is at `packages/orchestrator/src/engines/conductor/conductor-orchestrator.ts`; the target is at `packages/orchestrator/src/flow-json/attribute-inputs.ts`, so two `../` levels is correct.

- [ ] **Step 6: Typecheck the orchestrator package**

Run: `npm run typecheck -w @journeyman/orchestrator`
Expected: PASS — no type errors.

---

## Task 7: Orchestrator — resolve attribute ref shapes at save-time validation

**Files:**
- Modify: `packages/orchestrator/src/flow-json/validate-ref-shape.ts:1-2` (imports), `:40-49` (add attribute branch)
- Test: `packages/orchestrator/src/flow-json/validate-ref-shape.attribute.test.ts`

`resolveRefShape` powers save-time shape validation. Without an `workflow.attribute` branch, every attribute binding would fail validation as an unparseable/unknown ref.

- [ ] **Step 1: Write the failing test**

Create `packages/orchestrator/src/flow-json/validate-ref-shape.attribute.test.ts`:

```ts
import assert from "node:assert/strict";
import type { WorkflowGraph } from "@journeyman/core";
import { resolveRefShape, type CatalogShapeEntry } from "./validate-ref-shape.ts";

const flow = {
  schemaVersion: 2,
  nodes: [],
  edges: [],
  attributeDefs: [
    { name: "branchPrefix", type: "string", value: "feature/" },
    { name: "flags", type: "json-object", value: {} },
  ],
} as unknown as WorkflowGraph;

const catalog = new Map<string, CatalogShapeEntry>();

const ok = resolveRefShape(flow, "workflow.attribute.branchPrefix", catalog);
assert.equal(ok.ok, true, "declared attribute should resolve");
assert.deepEqual(ok.shape, { type: "string" });

const missing = resolveRefShape(flow, "workflow.attribute.nope", catalog);
assert.equal(missing.ok, false, "undeclared attribute should not resolve");

console.log("validate-ref-shape.attribute: ok");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx packages/orchestrator/src/flow-json/validate-ref-shape.attribute.test.ts`
Expected: FAIL — `resolveRefShape` returns `{ ok: false }` for the declared attribute (scope not handled).

- [ ] **Step 3: Add the attribute branch to resolveRefShape**

In `packages/orchestrator/src/flow-json/validate-ref-shape.ts`, add `workflowAttributeDefShape` to the core value import (line 2):

```ts
import { resolveShape, shapeAtPath, shapesCompatible, getStartWorkflowInputs, workflowInputDefShape, workflowAttributeDefShape } from "@journeyman/core";
```

Then, directly after the `if (parsed.scope === "workflow.input") { ... }` block (after line 49, before `const node = ...`), add:

```ts
  if (parsed.scope === "workflow.attribute") {
    const decl = (flow.attributeDefs ?? []).find(a => a.name === path[0]);
    if (!decl) return { ok: false, error: `workflow.attribute.${path[0]} not declared` };
    const root: Shape = workflowAttributeDefShape(decl);
    const leaf = shapeAtPath(root, path.slice(1));
    return leaf ? { ok: true, shape: leaf } : { ok: false, error: `Path not found: ${ref}` };
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx packages/orchestrator/src/flow-json/validate-ref-shape.attribute.test.ts`
Expected: PASS — prints `validate-ref-shape.attribute: ok`.

---

## Task 8: Final verification gate

**Files:** none (verification only)

- [ ] **Step 1: Run the full typecheck across all workspaces**

Run: `npm run typecheck`
Expected: PASS — no type errors in any workspace.

- [ ] **Step 2: Run the import-boundary check**

Run: `npm run check:boundaries`
Expected: PASS — no boundary violations. (New code only adds intra-package imports and `@journeyman/core` imports, all already-allowed edges.)

- [ ] **Step 3: Re-run all new + touched assert tests as a final smoke pass**

Run:
```bash
npx tsx packages/core/src/types/flow-attribute-def.test.ts
npx tsx packages/flow-editor/src/properties-panel/mention-fields.test.ts
npx tsx packages/flow-editor/src/properties-panel/mention-fields.attribute.test.ts
npx tsx packages/flow-editor/src/inputs-tab/AttributeValueField.test.ts
npx tsx packages/orchestrator/src/flow-json/resolve-inputs.attribute.test.ts
npx tsx packages/orchestrator/src/flow-json/attribute-inputs.test.ts
npx tsx packages/orchestrator/src/flow-json/validate-ref-shape.attribute.test.ts
```
Expected: each prints its `ok` line; no assertion failures.

> Per user constraint: do **not** commit. Stop here and report results.

---

## Self-Review Notes

- **Spec coverage:** Data model (Task 1), picker + ref scope (Task 2), editor two-section UI + typed value editor + name validation + JSON validation (Tasks 3-4), runtime ref rewrite + parseRef scope (Task 5), run-start seeding into `workflow.input.attributes` (Task 6), save-time shape validation (Task 7). All spec sections map to a task.
- **Type consistency:** `WorkflowAttributeDef` (name/type/value/description) is used identically across Tasks 1, 3, 4, 6, 7. `workflowAttributeDefShape` defined in Task 1, consumed in Tasks 2 and 7. `toEngineRef`/`parseRef` scope `"workflow.attribute"` defined in Task 5 and relied on by Task 7's `resolveRefShape` branch. The rewrite target `workflow.input.attributes.*` (Task 5) matches the seeded `attributes` key (Task 6).
- **Constraints honored:** no `git commit` steps anywhere; `npm run typecheck` is the final gate (Task 8).
