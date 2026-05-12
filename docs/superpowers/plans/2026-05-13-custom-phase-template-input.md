# Custom AI Phase — Template Input Type Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `"template"` input type to Custom AI Phases. In the workflow editor a template-typed input renders as a textarea with `{{ref}}` interpolation; the orchestrator emits the template as a Conductor `${...}` interpolated string so existing Conductor expression resolution handles run-time substitution.

**Architecture:**

- Storage: extend `CustomPhaseInputType` with `"template"` and `WorkflowInputValue` with a new `{ kind: "template"; template: string }` variant.
- Workflow editor: branch in `CustomAiConfigForm` to render a textarea + "Insert ref" button for template fields.
- Validation: extend `validate-workflow` and `validate-for-publish` to walk template strings and validate each `{{ref}}` the same way `kind: "ref"` is validated today.
- Orchestrator: in `resolve-inputs.ts` map a template value to a Conductor interpolated string (`"hello ${sanitized_ref} world"`) by replacing each `{{<ref>}}` with `${<sanitized-ref>}`. Conductor performs interpolation at run time — no new worker code path.

**Tech Stack:** TypeScript, React, Zod (API server schemas), Conductor expression language.

**User constraints:** No unit tests. No commits between tasks. Type-check at the end of the plan.

---

## File Structure

| Path | Action | Responsibility |
|---|---|---|
| `packages/core/src/types/custom-phases.types.ts` | Modify | Add `"template"` to `CustomPhaseInputType`. |
| `packages/core/src/types/flow.types.ts` | Modify | Add `{ kind: "template"; template: string }` to `WorkflowInputValue`. |
| `packages/api-server/src/schemas/update-flow.ts` | Modify | Add Zod variant for the new value kind. |
| `packages/web/src/components/custom-phases/InputFieldsEditor.tsx` | Modify | Add `"template"` to the type dropdown. |
| `packages/phases/src/custom/CustomAiConfigForm.tsx` | Modify | Render textarea + "Insert ref" for `template` inputs; store as `kind: "template"`. |
| `packages/core/src/utils/validate-workflow.ts` | Modify | Validate template values: required-empty check + each `{{ref}}` resolves. |
| `packages/core/src/validation/validate-for-publish.ts` | Modify | Walk template `{{ref}}` segments for the upstream-dominator check, identical to current `kind: "ref"` logic. |
| `packages/orchestrator/src/flow-json/resolve-inputs.ts` | Modify | Map `kind: "template"` to a Conductor `${...}`-interpolated string. |
| `packages/orchestrator/src/flow-json/conductor-converter.ts` | Modify | Apply the same upstream/dominator check for template `{{ref}}` segments that currently applies to `kind: "ref"`. |

---

## Task 1: Extend Core Types

**Files:**
- Modify: `packages/core/src/types/custom-phases.types.ts:6-9`
- Modify: `packages/core/src/types/flow.types.ts:28-30`

- [ ] **Step 1: Add `"template"` to `CustomPhaseInputType`**

In `packages/core/src/types/custom-phases.types.ts`, replace lines 6–9:

```ts
export type CustomPhaseInputType =
  | "string" | "number" | "boolean" | "string[]"
  | "object" | "array"
  | "workspaceId" | "repoRef" | "issueRef"
  | "template";
```

- [ ] **Step 2: Add `"template"` variant to `WorkflowInputValue`**

In `packages/core/src/types/flow.types.ts`, replace lines 28–30:

```ts
export type WorkflowInputValue =
  | { kind: "literal";  value: unknown }
  | { kind: "ref";      ref: string }
  | { kind: "template"; template: string };
```

---

## Task 2: Extend Zod Schema in API Server

**Files:**
- Modify: `packages/api-server/src/schemas/update-flow.ts:5-8`

- [ ] **Step 1: Add the template variant to `flowInputValueSchema`**

Replace lines 5–8 with:

```ts
const flowInputValueSchema = z.union([
  z.object({ kind: z.literal("literal"), value: z.unknown() }),
  z.object({ kind: z.literal("ref"), ref: z.string() }),
  z.object({ kind: z.literal("template"), template: z.string() }),
]);
```

---

## Task 3: Add `"template"` to the Phase-Definition Editor Dropdown

**Files:**
- Modify: `packages/web/src/components/custom-phases/InputFieldsEditor.tsx:4-8`

- [ ] **Step 1: Add `"template"` to the `TYPES` array**

Replace lines 4–8 with:

```ts
const TYPES: CustomPhaseInputType[] = [
  "string", "number", "boolean", "string[]",
  "object", "array",
  "workspaceId", "repoRef", "issueRef",
  "template",
];
```

No other changes in this file. `detectCustomPhaseBreaks`'s `typesCompatible` is strict equality (line 49) — `template` is automatically distinct from every existing type and will flag a `type-changed` break when an existing field is converted to/from it.

---

## Task 4: Add a Shared Template-Ref Extractor in Core

A regex-based helper for finding `{{ref}}` placeholders in a template string is reused by orchestrator, validate-workflow, and validate-for-publish. Put it next to the existing ref helpers.

**Files:**
- Create: `packages/core/src/utils/template-refs.ts`
- Modify: `packages/core/src/index.ts` (export the helper)

- [ ] **Step 1: Create the helper**

`packages/core/src/utils/template-refs.ts`:

```ts
const TEMPLATE_REF_RE = /\{\{(.+?)\}\}/g;

export interface TemplateSegment {
  raw: string;
  ref: string;
}

export function extractTemplateRefs(template: string): TemplateSegment[] {
  const out: TemplateSegment[] = [];
  for (const m of template.matchAll(TEMPLATE_REF_RE)) {
    out.push({ raw: m[0], ref: m[1].trim() });
  }
  return out;
}

export function replaceTemplateRefs(
  template: string,
  replacer: (ref: string) => string,
): string {
  return template.replace(TEMPLATE_REF_RE, (_, inner: string) => replacer(inner.trim()));
}
```

- [ ] **Step 2: Re-export from `packages/core/src/index.ts`**

Find the existing utils re-exports and add:

```ts
export { extractTemplateRefs, replaceTemplateRefs } from "./utils/template-refs.ts";
export type { TemplateSegment } from "./utils/template-refs.ts";
```

(If the file uses a barrel import pattern, follow the file's existing convention.)

---

## Task 5: Workflow-Editor Form — Render Textarea for Template Inputs

**Files:**
- Modify: `packages/phases/src/custom/CustomAiConfigForm.tsx`

The current form (lines 42–141) handles every input with `getRef`/`setRef` + a `ValuePicker` popover. Add a sibling code path for `f.type === "template"`.

- [ ] **Step 1: Add template helpers next to `getRef` / `setRef`**

After the existing `getRef` helper (around line 46), add:

```ts
const setTemplate = (name: string, template: string) => {
  setInputs({ ...inputs, [name]: { kind: "template", template } as WorkflowInputValue });
};
const getTemplate = (name: string): string => {
  const v = inputs[name];
  return v && v.kind === "template" ? v.template : "";
};
```

- [ ] **Step 2: Track cursor position per template field**

Just below the `pickerFor` state (line 17), add:

```ts
const [templateInsertFor, setTemplateInsertFor] = useState<string | null>(null);
const cursorByField = useRef<Record<string, number>>({});
```

Add at the top of the file:

```ts
import { useEffect, useMemo, useRef, useState } from "react";
```

- [ ] **Step 3: Branch on `f.type === "template"` inside the input map**

Replace the body of the `phase.inputFields.map((f) => { ... })` block (lines 78–130) with a branch. Keep the existing non-template rendering intact; add a `template` branch alongside it.

```tsx
{phase.inputFields.map((f) => {
  const showRequiredError = (empty: boolean) => f.required && empty;

  if (f.type === "template") {
    const tpl = getTemplate(f.name);
    const empty = tpl.trim().length === 0;
    const showError = showRequiredError(empty);
    return (
      <div key={f.name} style={{ display: "flex", flexDirection: "column", gap: 4, position: "relative" }}>
        <span style={{ fontSize: 12, fontFamily: "ui-monospace, monospace" }}>
          {f.name}
          {f.required && <span style={{ color: "#ff7675", marginLeft: 3 }}>*</span>}
          <span style={{ color: "#888", marginLeft: 6, fontSize: 10 }}>template</span>
        </span>
        {f.description && <span style={{ fontSize: 10, color: "#666" }}>{f.description}</span>}
        <textarea
          value={tpl}
          disabled={readOnly}
          rows={4}
          onChange={(e) => {
            cursorByField.current[f.name] = e.target.selectionStart;
            setTemplate(f.name, e.target.value);
          }}
          onSelect={(e) => {
            cursorByField.current[f.name] = (e.target as HTMLTextAreaElement).selectionStart;
          }}
          style={{
            background: "#1a1a2a",
            border: showError ? "1px solid #ff7675" : "1px solid #444",
            color: "#ddd",
            padding: "6px 8px",
            borderRadius: 4,
            fontFamily: "ui-monospace, monospace",
            fontSize: 12,
            resize: "vertical",
          }}
        />
        <div>
          <button
            type="button"
            disabled={readOnly}
            onClick={() => setTemplateInsertFor(templateInsertFor === f.name ? null : f.name)}
            style={{
              background: "#2a2a3e",
              border: "1px solid #444",
              color: "#ddd",
              padding: "2px 8px",
              borderRadius: 4,
              fontSize: 11,
              cursor: "pointer",
            }}
          >
            {`{x} Insert ref`}
          </button>
        </div>
        {templateInsertFor === f.name && (
          <div className="je-props__picker-popover">
            <ValuePicker
              sources={sources ?? []}
              onPick={(ref) => {
                const pos = cursorByField.current[f.name] ?? tpl.length;
                const next = tpl.slice(0, pos) + `{{${ref}}}` + tpl.slice(pos);
                setTemplate(f.name, next);
                setTemplateInsertFor(null);
              }}
              onClose={() => setTemplateInsertFor(null)}
            />
          </div>
        )}
      </div>
    );
  }

  // existing non-template rendering (unchanged from current file)
  const ref = getRef(f.name);
  const isPicking = pickerFor === f.name;
  const empty = !ref;
  const showError = showRequiredError(empty);
  return (
    <div key={f.name} style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <span style={{ fontSize: 12, fontFamily: "ui-monospace, monospace" }}>
          {f.name}
          {f.required && <span style={{ color: "#ff7675", marginLeft: 3 }}>*</span>}
          <span style={{ color: "#888", marginLeft: 6, fontSize: 10 }}>{f.type}</span>
        </span>
        {f.description && (
          <span style={{ fontSize: 10, color: "#666" }}>{f.description}</span>
        )}
      </div>
      {ref ? (
        <div className="je-props__bound-pill" style={{ flex: 2 }}>
          <span className="je-props__bound-pill-icon" aria-hidden>↳</span>
          <code className="je-props__bound-pill-ref">{ref}</code>
          {!readOnly && (
            <button
              type="button"
              className="je-props__bound-pill-unbind"
              onClick={() => setRef(f.name, "")}
              title="unbind"
            >×</button>
          )}
        </div>
      ) : (
        <button
          type="button"
          disabled={readOnly}
          onClick={() => setPickerFor(isPicking ? null : f.name)}
          style={{
            flex: 2,
            background: "#2a2a3e",
            border: showError ? "1px solid #ff7675" : "1px solid #444",
            color: "#ddd",
            padding: "4px 8px",
            borderRadius: 4,
            fontSize: 11,
            cursor: "pointer",
            textAlign: "left",
          }}
        >
          {`{x} Pick value…`}
        </button>
      )}
    </div>
  );
})}
```

The existing `pickerFor` popover block (lines 132–140) stays where it is — it handles non-template fields only. The template-insert popover is rendered inline inside the template branch above.

---

## Task 6: Save-Time Validation — `validate-workflow.ts`

**Files:**
- Modify: `packages/core/src/utils/validate-workflow.ts`

Lines 130–146 evaluate `hasRef` / `hasLiteral` and validate refs against upstream shapes. Extend with a `hasTemplate` path that:

1. Counts a non-whitespace template as "has value" for the required check.
2. Runs each extracted `{{ref}}` through the same `parseRefForValidation` + shape lookup the `ref` path already uses.

- [ ] **Step 1: Import the helper**

Near the top of the file, add to existing imports:

```ts
import { extractTemplateRefs } from "./template-refs.ts";
```

- [ ] **Step 2: Recognize `hasTemplate`**

Replace the block defining `hasRef` / `hasLiteral` (around line 130–131) with:

```ts
const hasConfigValue = configValue !== undefined && configValue !== "" && configValue !== null;
const hasRef = inputValue?.kind === "ref" && typeof inputValue.ref === "string" && inputValue.ref.trim().length > 0;
const hasLiteral = inputValue?.kind === "literal" && inputValue.value !== undefined;
const hasTemplate =
  inputValue?.kind === "template" &&
  typeof inputValue.template === "string" &&
  inputValue.template.trim().length > 0;
```

Update the required-input check on line 133 to include `hasTemplate`:

```ts
if (!hasConfigValue && !hasRef && !hasLiteral && !hasTemplate) {
```

- [ ] **Step 3: Validate each ref inside a template**

After the existing `if (!hasRef) continue;` early-out (line 145), replace it with a block that handles both kinds. The original code from line 145 onward (the ref → parseRefForValidation → shape-lookup section) should be lifted into a local helper `validateRef(ref: string)` returning the appropriate `warnings.push(...)` calls, then called once for `hasRef` and once per extracted `{{ref}}` for `hasTemplate`.

Concretely, replace `if (!hasRef) continue;` plus the rest of the per-input loop body with:

```ts
const refsToCheck: string[] = [];
if (hasRef) refsToCheck.push(inputValue!.kind === "ref" ? inputValue!.ref : "");
if (hasTemplate) {
  const tpl = inputValue!.kind === "template" ? inputValue!.template : "";
  for (const seg of extractTemplateRefs(tpl)) refsToCheck.push(seg.ref);
}
if (refsToCheck.length === 0) continue;

for (const ref of refsToCheck) {
  // ── original ref-validation body, with `ref` already in scope ──
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
  // ... rest of the original block from current line 160 onward,
  // unchanged, replacing every `inputValue!.ref` reference with `ref`.
}
```

Carry the existing logic from the current `parseRefForValidation` call through to the end of the loop iteration verbatim, substituting `ref` for the previously-captured `inputValue!.ref`. The `expected` (shape from `fieldDef.shape`) check applies to *every* extracted ref — if any extracted ref resolves to an incompatible shape, push the warning and continue to the next ref (do not `break` the per-input loop, but do `continue` the per-ref loop).

---

## Task 7: Publish Validation — Upstream/Dominator Check for Template Refs

**Files:**
- Modify: `packages/core/src/validation/validate-for-publish.ts:120-136`

The block at lines 120–136 checks that every `kind: "ref"` points to an upstream node. Extend with the same check for each `{{ref}}` extracted from a `kind: "template"` value.

- [ ] **Step 1: Import the helper**

Add to existing imports near the top:

```ts
import { extractTemplateRefs } from "../utils/template-refs.ts";
```

- [ ] **Step 2: Replace the inputs-loop body**

Replace lines 120–136 with:

```ts
for (const [slot, val] of Object.entries(node.inputs ?? {}) as [string, import("../types/flow.types.ts").WorkflowInputValue][]) {
  const refs: string[] = [];
  if (val && val.kind === "ref" && val.ref) refs.push(val.ref);
  if (val && val.kind === "template" && val.template) {
    for (const seg of extractTemplateRefs(val.template)) refs.push(seg.ref);
  }
  for (const ref of refs) {
    if (ref.startsWith("workflow.input.")) continue;
    const referencedNodeId = parseRefNodeId(ref);
    if (referencedNodeId && !upstream.has(referencedNodeId)) {
      errors.push({
        code: "unresolved_binding",
        message: `Input '${slot}' references node '${referencedNodeId}' which is not upstream of '${node.id}'`,
        nodeId: node.id,
        fieldPath: `inputs.${slot}`,
      });
    }
  }
}
```

- [ ] **Step 3: Update the `boundInputKeys` filter for `kind: "template"`**

Lines 186–196 build a `boundInputKeys` set. Add a template case so a template input counts as "bound" when it has non-whitespace content:

```ts
const boundInputKeys = new Set(
  Object.entries(node.inputs ?? {})
    .filter(([, v]) => {
      const val = v as import("../types/flow.types.ts").WorkflowInputValue | undefined;
      if (!val) return false;
      if (val.kind === "ref") return typeof val.ref === "string" && val.ref.trim().length > 0;
      if (val.kind === "literal") return val.value !== undefined;
      if (val.kind === "template") return typeof val.template === "string" && val.template.trim().length > 0;
      return false;
    })
    .map(([k]) => k),
);
```

---

## Task 8: Orchestrator — Compile Template Inputs into Conductor Expressions

**Files:**
- Modify: `packages/orchestrator/src/flow-json/resolve-inputs.ts`
- Modify: `packages/orchestrator/src/flow-json/conductor-converter.ts`

Today `resolveInputs` produces a Conductor expression string for refs: `"${" + sanitizeRef(v.ref) + "}"`. For templates, do the same per-segment so the final value is one Conductor interpolated string. Example:

```
"Compare {{node_a.output.summary}} to {{workflow.input.repo}}"
   → "Compare ${node_a.output.summary} to ${workflow.input.repo}"
```

Conductor handles the run-time interpolation; no new worker code.

- [ ] **Step 1: Import the helper**

In `resolve-inputs.ts`, top of file:

```ts
import { replaceTemplateRefs } from "@journeyman/core";
```

- [ ] **Step 2: Add the `template` branch**

Replace the body of `resolveInputs` (lines 6–12) with:

```ts
const out: Record<string, unknown> = {};
for (const [k, v] of Object.entries(inputs ?? {})) {
  if (v.kind === "literal") out[k] = v.value;
  else if (v.kind === "ref") out[k] = "${" + sanitizeRef(v.ref) + "}";
  else if (v.kind === "template") {
    out[k] = replaceTemplateRefs(v.template, (ref) => "${" + sanitizeRef(ref) + "}");
  }
}
return out;
```

- [ ] **Step 3: Extend the converter's upstream-dominator check to template refs**

In `conductor-converter.ts`, the loop starting at line 78 currently iterates `node.inputs` and runs the `parseRef` + dominator check only on `val.kind === "ref"`. Replace lines 79–100 with:

```ts
for (const [field, val] of Object.entries(node.inputs ?? {})) {
  const refs: string[] = [];
  if (val.kind === "ref") refs.push(val.ref);
  else if (val.kind === "template") {
    for (const seg of extractTemplateRefs(val.template)) refs.push(seg.ref);
  } else continue;

  for (const ref of refs) {
    const parsed = parseRef(ref);
    if (!parsed) {
      throw new WorkflowValidationError(`Node '${node.id}' input '${field}' has unparseable ref '${ref}'`);
    }
    if (parsed.source === "workflow.input") {
      if (!runInputNames.has(parsed.field)) {
        throw new WorkflowValidationError(`Node '${node.id}' references undeclared run input '${parsed.field}'`);
      }
      continue;
    }
    if (!nodeIds.has(parsed.source)) {
      throw new WorkflowValidationError(`Node '${node.id}' references missing node '${parsed.source}'`);
    }
    const doms = dominators(this.flow, node.id);
    if (!doms.has(parsed.source)) {
      throw new WorkflowValidationError(
        `Node '${node.id}' references '${parsed.source}' which does not execute on every path to '${node.id}'`,
      );
    }
  }
}
```

Add to the imports at the top of `conductor-converter.ts`:

```ts
import { extractTemplateRefs } from "@journeyman/core";
```

---

## Task 9: Type-Check the Whole Monorepo

- [ ] **Step 1: Run typecheck**

Run: `npm run typecheck`
Expected: PASS with no errors.

If any errors surface, fix them in the offending file (most likely candidates are stale `kind: "ref" | "literal"`-only exhaustiveness checks elsewhere in `packages/core`, `packages/orchestrator`, or `packages/web` that need a `kind: "template"` case). Re-run until clean.

---

## Self-Review

- **Spec section 1 (types + storage):** covered by Tasks 1, 2.
- **Spec section 2 (phase-definition editor):** covered by Task 3. `detectCustomPhaseBreaks` requires no change (strict equality already handles a new enum value).
- **Spec section 3 (workflow form):** covered by Task 5.
- **Spec section 3 — save-time empty-required and ref validation:** covered by Task 6.
- **Spec section 4 — worker resolution + save-time `{{ref}}` validation against `sources`:** covered by Tasks 7 and 8. Note: coercion of non-string ref values (number → `String`, object → `JSON.stringify`) is delegated to Conductor's interpolation behavior, which already stringifies non-string values when expanding `${...}` inside a larger string. No bespoke coercion code is needed.
- **No placeholders:** every code step shows the actual code to write.
- **Type consistency:** `extractTemplateRefs` / `replaceTemplateRefs` signatures are defined in Task 4 and used by name in Tasks 6, 7, 8.
- **User constraints:** no tests written, no commits, single typecheck at end (Task 9). Respected.
