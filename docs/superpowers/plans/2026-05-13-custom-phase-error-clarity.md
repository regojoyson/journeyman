# Custom AI Phase — Error Clarity & Auto-Bind Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `Node 'step_2kicye' input 'issueRef' has unparseable ref ''` with friendly errors, and auto-bind custom-AI phase inputs the same way built-in phases do.

**Architecture:** Three small changes. (A) Teach `autoBindNewNode` to resolve a custom-AI phase's `inputFields` from `customPhaseToShape(def)` when the catalog stub is empty. (B) Short-circuit empty/whitespace refs in the converter validator with a dedicated "not connected" message. (C) Introduce a `labelNode` helper used by both `conductor-converter.ts` and `validate-ref-shape.ts` so errors lead with the user-visible display name and include the id in parentheses.

**Tech Stack:** TypeScript, React (flow-editor), `@journeyman/core`, `@journeyman/custom-phases`, `@journeyman/orchestrator`.

**Constraints (per user):** no unit tests, no commits during this plan, run `npm run typecheck` at the very end.

**Dependency note:** This plan layers on top of `docs/superpowers/plans/2026-05-13-custom-phase-upstream-refs.md`. Specifically, it assumes the following are already in place from that plan:

- `customPhaseToShape` is exported from `@journeyman/custom-phases`.
- `useCustomPhaseDefs` and `collectCustomPhaseIds` exist in flow-editor.
- `flow-editor`'s `package.json` already depends on `@journeyman/custom-phases`.

If you are executing this plan first, the import lines below will fail typecheck — finish the upstream-refs plan first.

---

## File Structure

**Modified files**

- `packages/flow-editor/src/canvas/Canvas.tsx` — extend `autoBindNewNode` with `customPhaseDefs` resolution; thread the map through the drop handler.
- `packages/orchestrator/src/flow-json/validate-ref-shape.ts` — export `labelNode` helper; use it inside its own error strings.
- `packages/orchestrator/src/flow-json/conductor-converter.ts` — add empty-ref short-circuit; use `labelNode` for every node-mentioning error.

**New files**

None.

---

## Task 1: `labelNode` helper in `validate-ref-shape.ts`

**Files:**
- Modify: `packages/orchestrator/src/flow-json/validate-ref-shape.ts`

The helper is the single source of truth for how a node is named in error strings. Both the converter and the ref-shape validator import it.

- [ ] **Step 1: Add the `labelNode` export at the bottom of `validate-ref-shape.ts`**

Open `packages/orchestrator/src/flow-json/validate-ref-shape.ts`. Below the existing `isPhaseNode` function (around line 125), add:

```ts
/**
 * Human-friendly label for a node in error messages.
 * Returns `"'Display Name' (node_id)"` when the node has a displayName,
 * `"'node_id'"` when it doesn't (or when the node is missing from the flow).
 */
export function labelNode(n: WorkflowNode | undefined, fallbackId: string): string {
  const name = n?.displayName?.trim();
  return name ? `'${name}' (${fallbackId})` : `'${fallbackId}'`;
}
```

- [ ] **Step 2: Replace node-mentioning error strings in `resolveRefShape`**

In the same file, locate `resolveRefShape` (starts ~line 27). Change the following lines:

Find:
```ts
  const node = flow.nodes.find(n => n.id === parsed.source);
  if (!node) return { ok: false, error: `Node '${parsed.source}' not found` };
  if (node.type !== "phase" || !node.phaseType) return { ok: false, error: `Node '${parsed.source}' is not a phase` };
```

Replace with:
```ts
  const node = flow.nodes.find(n => n.id === parsed.source);
  if (!node) return { ok: false, error: `Node ${labelNode(undefined, parsed.source)} not found` };
  if (node.type !== "phase" || !node.phaseType) return { ok: false, error: `Node ${labelNode(node, parsed.source)} is not a phase` };
```

Find:
```ts
  if (node.phaseType === "custom-ai") {
    const customId = (node.config as { customPhaseId?: unknown } | undefined)?.customPhaseId;
    if (typeof customId !== "string" || !customId) {
      return { ok: false, error: `Node '${parsed.source}' has no customPhaseId` };
    }
    const def = customPhaseDefs?.get(customId);
    if (!def) {
      return { ok: false, error: `Custom phase definition not loaded for node '${parsed.source}'` };
    }
```

Replace with:
```ts
  if (node.phaseType === "custom-ai") {
    const customId = (node.config as { customPhaseId?: unknown } | undefined)?.customPhaseId;
    if (typeof customId !== "string" || !customId) {
      return { ok: false, error: `Node ${labelNode(node, parsed.source)} has no customPhaseId` };
    }
    const def = customPhaseDefs?.get(customId);
    if (!def) {
      return { ok: false, error: `Custom phase definition not loaded for node ${labelNode(node, parsed.source)}` };
    }
```

Find:
```ts
  if (!root) return { ok: false, error: `Field '${parsed.scope}.${path[0]}' not declared on '${parsed.source}'` };
```

Replace with:
```ts
  if (!root) return { ok: false, error: `Field '${parsed.scope}.${path[0]}' not declared on ${labelNode(node, parsed.source)}` };
```

Leave the other error strings (`Unparseable ref`, `workflow.input.* not declared`, `Path not found`, `Unknown phase type`) unchanged — they don't mention a node by id.

---

## Task 2: Empty-ref short-circuit + display-name labels in `conductor-converter.ts`

**Files:**
- Modify: `packages/orchestrator/src/flow-json/conductor-converter.ts`

- [ ] **Step 1: Import `labelNode`**

Open `packages/orchestrator/src/flow-json/conductor-converter.ts`. Find the existing import:

```ts
import { validateRefShapeAgainst, type CatalogShapeEntry, type CustomPhaseShapeEntry } from "./validate-ref-shape.ts";
```

Replace with:

```ts
import { validateRefShapeAgainst, labelNode, type CatalogShapeEntry, type CustomPhaseShapeEntry } from "./validate-ref-shape.ts";
```

- [ ] **Step 2: Add a `label` method on `ConvertCtx`**

In the same file, locate the `ConvertCtx` class (the `constructor` block ends near line 75). Immediately after the constructor's closing `}`, add:

```ts
  /** Format `node` as it should appear in validation error messages. */
  private label(n: WorkflowNode): string {
    return labelNode(n, n.id);
  }

  /** Look up a node by id and format it for error messages. */
  private labelById(id: string): string {
    return labelNode(this.nodes.get(id), id);
  }
```

- [ ] **Step 3: Add the empty-ref short-circuit and replace node-id error strings inside `validate()`**

Locate the loop body inside `validate()` (starts ~line 88). The current block reads:

```ts
    for (const node of this.flow.nodes) {
      for (const [field, val] of Object.entries(node.inputs ?? {})) {
        const refs: Array<{ ref: string; enforceShape: boolean }> = [];
        if (val.kind === "ref") refs.push({ ref: val.ref, enforceShape: true });
        else if (val.kind === "template") {
          for (const seg of extractTemplateRefs(val.template)) {
            refs.push({ ref: seg.ref, enforceShape: false });
          }
        } else continue;

        for (const { ref, enforceShape } of refs) {
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
              `Node '${node.id}' references '${parsed.source}' which does not execute on every path to '${node.id}'`
            );
          }
```

Replace the entire block (down to that closing `)` of the dominator check) with:

```ts
    for (const node of this.flow.nodes) {
      for (const [field, val] of Object.entries(node.inputs ?? {})) {
        // Friendly short-circuit: ref-kind input with empty value means the user
        // never connected it, not that the ref string is malformed.
        if (val.kind === "ref" && val.ref.trim() === "") {
          throw new WorkflowValidationError(
            `Node ${this.label(node)} input '${field}' is not connected`,
          );
        }

        const refs: Array<{ ref: string; enforceShape: boolean }> = [];
        if (val.kind === "ref") refs.push({ ref: val.ref, enforceShape: true });
        else if (val.kind === "template") {
          for (const seg of extractTemplateRefs(val.template)) {
            refs.push({ ref: seg.ref, enforceShape: false });
          }
        } else continue;

        for (const { ref, enforceShape } of refs) {
          const parsed = parseRef(ref);
          if (!parsed) {
            throw new WorkflowValidationError(`Node ${this.label(node)} input '${field}' has unparseable ref '${ref}'`);
          }
          if (parsed.source === "workflow.input") {
            if (!runInputNames.has(parsed.field)) {
              throw new WorkflowValidationError(`Node ${this.label(node)} references undeclared run input '${parsed.field}'`);
            }
            continue;
          }
          if (!nodeIds.has(parsed.source)) {
            throw new WorkflowValidationError(`Node ${this.label(node)} references missing node '${parsed.source}'`);
          }
          const doms = dominators(this.flow, node.id);
          if (!doms.has(parsed.source)) {
            throw new WorkflowValidationError(
              `Node ${this.label(node)} references ${this.labelById(parsed.source)} which does not execute on every path to ${this.label(node)}`,
            );
          }
```

Leave the shape-compatibility block (starts `if (enforceShape && this.catalog ...`) untouched at this step — its error string is handled in the next step.

- [ ] **Step 4: Update the shape-mismatch error string**

Still in `validate()`, find:

```ts
            if (!result.ok) {
              throw new WorkflowValidationError(
                `Node '${node.id}' input '${field}': ${result.error}`,
              );
            }
```

Replace with:

```ts
            if (!result.ok) {
              throw new WorkflowValidationError(
                `Node ${this.label(node)} input '${field}': ${result.error}`,
              );
            }
```

- [ ] **Step 5: Update the `emitPhase` missing-phaseType error**

Locate (~line 190):

```ts
    if (!node.phaseType) throw new WorkflowValidationError(`Phase node '${node.id}' missing phaseType`);
```

Replace with:

```ts
    if (!node.phaseType) throw new WorkflowValidationError(`Phase node ${this.label(node)} missing phaseType`);
```

- [ ] **Step 6: Sweep for any remaining `'${node.id}'` patterns inside the class**

Run:
```bash
grep -n "'\${node.id}'" packages/orchestrator/src/flow-json/conductor-converter.ts
```

Expected: no hits. If any remain inside `ConvertCtx` methods that have a `node` in scope, replace each occurrence with `${this.label(node)}` (no surrounding quotes — `label` already includes them). If a hit is in a function without a `node` variable, just use `${this.labelById(someId)}` instead. Do not modify error strings inside `emitForkJoin` / `emitDoWhile` etc. that don't currently mention `node.id` — only fix actual hits.

---

## Task 3: Auto-bind custom-AI inputs in `Canvas.tsx`

**Files:**
- Modify: `packages/flow-editor/src/canvas/Canvas.tsx`

- [ ] **Step 1: Add the new imports**

At the top of `packages/flow-editor/src/canvas/Canvas.tsx`, locate the existing `usePhaseCatalog` import:

```ts
import { usePhaseCatalog } from "../catalogs/use-phase-catalog.ts";
```

Add two new imports right below it:

```ts
import { useCustomPhaseDefs } from "../catalogs/use-custom-phase-defs.ts";
import { collectCustomPhaseIds } from "../properties-panel/use-upstream-sources.ts";
import { customPhaseToShape } from "@journeyman/custom-phases";
import type { CustomAiPhase, InputFields } from "@journeyman/core";
```

(Both `useCustomPhaseDefs` and `collectCustomPhaseIds` are introduced by the existing upstream-refs plan — see the Dependency note at the top of this document.)

- [ ] **Step 2: Extend `autoBindNewNode` to resolve custom-AI inputFields**

Replace the entire current `autoBindNewNode` function (lines 30–56) with:

```ts
/**
 * Best-effort: for each required input field on `newNode`, scan existing phase
 * nodes for one whose outputSchema declares a field of the same name. If
 * exactly one match exists, bind. If 0 or >1, skip — user picks manually.
 *
 * For `custom-ai` nodes, the phase catalog stub has empty inputFields, so the
 * required-fields list is resolved from the saved CustomAiPhase definition
 * (passed in via `customPhaseDefs`). When the def hasn't loaded yet, no
 * binding happens for that node — same effective behavior as today.
 */
function autoBindNewNode(
  newNode: WorkflowNode,
  existingNodes: WorkflowNode[],
  catalog: ReturnType<typeof usePhaseCatalog>,
  customPhaseDefs?: Record<string, CustomAiPhase | null>,
): WorkflowNode {
  if (newNode.type !== "phase" || !newNode.phaseType) return newNode;

  let required: InputFields = {};
  let outputSchemaForCandidate: (n: WorkflowNode) => Record<string, unknown> = (n) => {
    if (n.type !== "phase" || !n.phaseType) return {};
    if (n.phaseType === "custom-ai") {
      const id = (n.config as { customPhaseId?: unknown } | undefined)?.customPhaseId;
      const def = typeof id === "string" && id ? customPhaseDefs?.[id] : undefined;
      return def ? (customPhaseToShape(def).outputSchema ?? {}) : {};
    }
    return catalog[n.phaseType]?.outputSchema ?? {};
  };

  if (newNode.phaseType === "custom-ai") {
    const customId = (newNode.config as { customPhaseId?: unknown } | undefined)?.customPhaseId;
    const def = typeof customId === "string" && customId ? customPhaseDefs?.[customId] : undefined;
    if (!def) return newNode; // def not loaded yet — skip auto-bind, user can connect manually
    required = customPhaseToShape(def).inputFields;
  } else {
    required = catalog[newNode.phaseType]?.inputFields ?? {};
  }

  const inputs: Record<string, { kind: "ref"; ref: string }> = {
    ...((newNode.inputs ?? {}) as Record<string, { kind: "ref"; ref: string }>),
  };
  let changed = false;
  for (const [fieldName, meta] of Object.entries(required)) {
    if (!(meta as { required?: boolean }).required) continue;
    if (inputs[fieldName]) continue; // already bound
    const candidates = existingNodes.filter((n) => {
      const out = outputSchemaForCandidate(n);
      return out && fieldName in out;
    });
    if (candidates.length === 1) {
      inputs[fieldName] = { kind: "ref", ref: `${candidates[0].id}.output.${fieldName}` };
      changed = true;
    }
  }
  return changed ? { ...newNode, inputs: inputs as WorkflowNode["inputs"] } : newNode;
}
```

Note this also extends *candidate* discovery: a normal phase being added can now auto-bind to a custom-AI upstream's outputs, and vice versa. That's the consistent behavior — same rules either side.

- [ ] **Step 3: Resolve `customPhaseDefs` inside `CanvasInner` and thread it into the call**

Locate `CanvasInner` (starts ~line 95). Just after:

```ts
function CanvasInner(p: CanvasProps) {
  const catalog = usePhaseCatalog();
```

add:

```ts
  const customPhaseDefs = useCustomPhaseDefs(collectCustomPhaseIds(p.flow));
```

Then locate the call site at line 340:

```ts
    newNode = autoBindNewNode(newNode, flow.nodes, catalog);
```

Replace with:

```ts
    newNode = autoBindNewNode(newNode, flow.nodes, catalog, customPhaseDefs);
```

- [ ] **Step 4: Verify nothing else in the file references `autoBindNewNode`**

Run:
```bash
grep -n "autoBindNewNode" packages/flow-editor/src/canvas/Canvas.tsx
```

Expected: exactly two hits — the function definition and the single call site you just updated. If a third hit appears, update its signature the same way.

---

## Task 4: Typecheck

- [ ] **Step 1: Run the workspace typecheck**

Run:
```bash
npm run typecheck
```

Expected: exit code 0.

If errors appear, work through them in this order:

1. **"Cannot find name 'labelNode'"** — re-check the import line in `conductor-converter.ts` (Task 2 Step 1). Confirm `labelNode` is exported from `validate-ref-shape.ts` (Task 1 Step 1).
2. **"Property 'label' does not exist on type 'ConvertCtx'"** — confirm Task 2 Step 2 added both `label` and `labelById` methods inside the class body, not above it.
3. **"Cannot find module '../catalogs/use-custom-phase-defs.ts'" or "'collectCustomPhaseIds'"** — the upstream-refs plan hasn't been applied yet. Complete it first, then re-run.
4. **"Module '@journeyman/custom-phases' has no exported member 'customPhaseToShape'"** — same root cause: upstream-refs plan dependency. Complete it first.
5. **"Type 'CustomAiPhase | null' is not assignable to..."** in the candidate output-schema lookup — re-check that `def` is narrowed with the `def ? ... : {}` guard exactly as written in Task 3 Step 2.
6. **Any other error** — fix in place, re-run.

Do not commit. Stop after typecheck reports zero errors.

---

## Self-Review

**Spec coverage:**
- Part A (auto-bind custom-AI inputs) → Task 3. ✓
- Part B (friendly empty-ref message) → Task 2 Step 3 (short-circuit block). ✓
- Part C (display-name-first labels) → Task 1 + Task 2 Steps 1–6. ✓

**Placeholder scan:** No TBDs, no "handle edge cases" stubs; every code block is complete. The only "search and verify" step is the sweep grep in Task 2 Step 6, which is a guard against missed renames, not a stub.

**Type consistency:**
- `labelNode(n: WorkflowNode | undefined, fallbackId: string)` signature defined in Task 1, called the same way from Task 2 (via `this.label` / `this.labelById`). ✓
- `autoBindNewNode`'s new fourth parameter `customPhaseDefs?: Record<string, CustomAiPhase | null>` matches `useCustomPhaseDefs`'s return type (per the upstream-refs plan, Task 2). ✓
- `customPhaseToShape` returns `{ inputFields: InputFields; outputSchema: OutputSchema | null }` — Task 3 Step 2 handles the `null` case with `?? {}`. ✓

**No tests, no commits:** plan contains neither, per user request. Typecheck is the only verification step.
