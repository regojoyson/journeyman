# Input Mapping: JSON Path Drilling, Merge Discoverability & Help — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users drill into opaque `json` and typed-array step inputs by appending a path (`.user.name`, `[0].title`, `[*].title`) to a picked reference, surface the existing attribute-merge capability in Value mode, and add an info-icon help popover — on every step input.

**Architecture:** A path is stored inside the existing `{ kind: "ref"; ref: string }` string (no new data model). Core gains a path tokenizer (`parsePathSegments`) and a segment walker (`shapeAtPathSegs`) that allows descending past opaque `json` (stays `json`) and re-wraps `[*]` projections as arrays. All three ref-shape validators migrate to the new tokenizer (fixing head-field lookup when the base field is itself indexed). Runtime is unchanged — brackets survive `sanitizeRef` and Conductor resolves JSONPath. The flow-editor renders a path-tail input after a drillable ref and an info popover.

**Tech Stack:** TypeScript, React (flow-editor), Vitest (`vitest run`), npm workspaces. Tests run per package: `npm test -w @journeyman/<pkg>`. Type/boundary gate: `npm run check`.

**Branch:** `feature/input-mapping-json-path-drilling` (already created).

**Spec:** [docs/superpowers/specs/2026-06-10-json-path-drilling-and-merge-design.md](../specs/2026-06-10-json-path-drilling-and-merge-design.md)

---

## File Structure

**Create:**
- `packages/core/src/types/path-segments.ts` — `PathSeg`, `parsePathSegments`, `shapeAtPathSegs`. The single source of path-walking truth.
- `packages/core/src/types/path-segments.test.ts` — tokenizer + walker unit tests.
- `packages/flow-editor/src/properties-panel/ref-path.ts` — editor helpers: `splitRefPath`, `joinRefPath`, `validatePathTail`.
- `packages/flow-editor/src/properties-panel/ref-path.test.ts` — unit tests for the above.
- `packages/flow-editor/src/properties-panel/InputHelp.tsx` — info-icon + popover; exports `INPUT_HELP` content constant.

**Modify:**
- `packages/core/src/types/shapes.ts` — re-implement `shapeAtPath` on top of the new API (backward-compat wrapper).
- `packages/core/src/index.ts` — export the new path API.
- `packages/orchestrator/src/flow-json/validate-ref-shape.ts` — migrate 4 lookup sites to `parsePathSegments` + `shapeAtPathSegs`.
- `packages/flow-editor/src/state/validate-ref-shape.ts` — migrate 2 lookup sites.
- `packages/core/src/utils/validate-workflow.ts` — migrate 3 lookup sites.
- `packages/orchestrator/src/flow-json/resolve-inputs.attribute.test.ts` — add bracket-survival assertions (or a new sibling test file).
- `packages/flow-editor/src/properties-panel/mention-fields.ts` — add `drillable` flag to `MentionField`.
- `packages/flow-editor/src/properties-panel/mention-fields.test.ts` — assert `drillable`.
- `packages/flow-editor/src/properties-panel/InputValueEditor.tsx` — path-tail input (reference mode), merge hints (value mode), render `InputHelp`.
- The flow-editor stylesheet defining `.je-input-value` — add CSS for the path tail, help popover, hints.

---

## Task 1: Core path tokenizer & segment walker

**Files:**
- Create: `packages/core/src/types/path-segments.ts`
- Test: `packages/core/src/types/path-segments.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/types/path-segments.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parsePathSegments, shapeAtPathSegs } from "./path-segments.ts";
import type { Shape } from "./shape.types.ts";

describe("parsePathSegments", () => {
  it("parses dotted object paths", () => {
    expect(parsePathSegments("payload.user.name")).toEqual([
      { kind: "key", key: "payload" }, { kind: "key", key: "user" }, { kind: "key", key: "name" },
    ]);
  });
  it("parses index and wildcard", () => {
    expect(parsePathSegments("items[0].title")).toEqual([
      { kind: "key", key: "items" }, { kind: "index", index: 0 }, { kind: "key", key: "title" },
    ]);
    expect(parsePathSegments("items[*].title")).toEqual([
      { kind: "key", key: "items" }, { kind: "wildcard" }, { kind: "key", key: "title" },
    ]);
  });
  it("parses a leading bracket tail", () => {
    expect(parsePathSegments("[0].title")).toEqual([
      { kind: "index", index: 0 }, { kind: "key", key: "title" },
    ]);
  });
  it("empty string is an empty path", () => {
    expect(parsePathSegments("")).toEqual([]);
  });
  it("rejects malformed brackets", () => {
    expect(parsePathSegments("items[abc]")).toBeNull();
    expect(parsePathSegments("items[")).toBeNull();
    expect(parsePathSegments("items[].x")).toBeNull();
    expect(parsePathSegments(".leadingDot")).toBeNull();
    expect(parsePathSegments("a..b")).toBeNull();
  });
});

const arrOfObj: Shape = { type: "array", items: { type: "object", fields: { title: { type: "string" } } } };
const jsonObj: Shape = { type: "json", container: "object" };
const jsonArr: Shape = { type: "json", container: "array" };
const typedObj: Shape = { type: "object", fields: { user: { type: "object", fields: { name: { type: "string" } } } } };

describe("shapeAtPathSegs", () => {
  it("empty path returns the root", () => {
    expect(shapeAtPathSegs(typedObj, [])).toEqual(typedObj);
  });
  it("walks typed object fields", () => {
    expect(shapeAtPathSegs(typedObj, parsePathSegments("user.name")!)).toEqual({ type: "string" });
  });
  it("index unwraps a typed array to its item field", () => {
    expect(shapeAtPathSegs(arrOfObj, parsePathSegments("[0].title")!)).toEqual({ type: "string" });
  });
  it("wildcard projects a typed-array field into an array", () => {
    expect(shapeAtPathSegs(arrOfObj, parsePathSegments("[*].title")!)).toEqual({
      type: "array", items: { type: "string" },
    });
  });
  it("descending past opaque json yields opaque json", () => {
    expect(shapeAtPathSegs(jsonObj, parsePathSegments("anything.deep")!)).toEqual(jsonObj);
    expect(shapeAtPathSegs(jsonArr, parsePathSegments("[0].x")!)).toEqual(jsonArr);
  });
  it("rejects a key applied to an array (no index/wildcard)", () => {
    expect(shapeAtPathSegs(arrOfObj, parsePathSegments("title")!)).toBeNull();
  });
  it("rejects an index applied to an object", () => {
    expect(shapeAtPathSegs(typedObj, parsePathSegments("[0]")!)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @journeyman/core -- path-segments`
Expected: FAIL — `Cannot find module './path-segments.ts'`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/core/src/types/path-segments.ts`:

```ts
import type { Shape } from "./shape.types.ts";
import { resolveShape } from "./shapes.ts";

/** A single step in a value path: an object key, an array index, or an array wildcard. */
export type PathSeg =
  | { kind: "key"; key: string }
  | { kind: "index"; index: number }
  | { kind: "wildcard" };

const IDENT = /[\w$]/;

/**
 * Tokenize a JSONPath-flavored field string into segments.
 *   "payload.user.name" -> [key payload, key user, key name]
 *   "items[0].title"     -> [key items, index 0, key title]
 *   "items[*].title"     -> [key items, wildcard, key title]
 *   "[0].title"          -> [index 0, key title]   (tail-only)
 *   ""                   -> []
 * Returns null on malformed input (bad/empty brackets, leading dot, empty key).
 */
export function parsePathSegments(field: string): PathSeg[] | null {
  const segs: PathSeg[] = [];
  let i = 0;
  const n = field.length;
  while (i < n) {
    const c = field[i];
    if (c === ".") {
      i++;
      const start = i;
      while (i < n && IDENT.test(field[i])) i++;
      if (i === start) return null; // empty key after '.'
      segs.push({ kind: "key", key: field.slice(start, i) });
    } else if (c === "[") {
      const close = field.indexOf("]", i);
      if (close === -1) return null;
      const inner = field.slice(i + 1, close);
      if (inner === "*") segs.push({ kind: "wildcard" });
      else if (/^\d+$/.test(inner)) segs.push({ kind: "index", index: Number(inner) });
      else return null; // empty or non-numeric index
      i = close + 1;
    } else {
      // A bare identifier is only valid as the very first segment.
      if (segs.length !== 0) return null;
      const start = i;
      while (i < n && IDENT.test(field[i])) i++;
      if (i === start) return null;
      segs.push({ kind: "key", key: field.slice(start, i) });
    }
  }
  return segs;
}

/**
 * Walk `segs` against `root`, resolving named refs along the way.
 *  - key on object -> field shape; key on non-object -> null
 *  - index on array -> item shape (unwrap)
 *  - wildcard on array -> item shape, marking projection (re-wrapped at the end)
 *  - any segment on opaque `json` -> the json shape itself (remaining path allowed)
 * Returns null when a segment doesn't resolve. Empty segs returns root.
 */
export function shapeAtPathSegs(root: Shape, segs: PathSeg[]): Shape | null {
  let cur: Shape = resolveShape(root);
  let projecting = false;
  for (const seg of segs) {
    if (cur.type === "json") return cur; // opaque: stays opaque, rest allowed
    if (seg.kind === "key") {
      if (cur.type !== "object") return null;
      const next = cur.fields[seg.key];
      if (!next) return null;
      cur = resolveShape(next);
    } else if (seg.kind === "index") {
      if (cur.type !== "array") return null;
      cur = resolveShape(cur.items);
    } else {
      if (cur.type !== "array") return null;
      projecting = true;
      cur = resolveShape(cur.items);
    }
  }
  return projecting ? { type: "array", items: cur } : cur;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @journeyman/core -- path-segments`
Expected: PASS (all cases green).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/types/path-segments.ts packages/core/src/types/path-segments.test.ts
git commit -m "feat(core): JSONPath-flavored path tokenizer and segment walker"
```

---

## Task 2: Re-implement `shapeAtPath` on the new API + export it

**Files:**
- Modify: `packages/core/src/types/shapes.ts:115-134`
- Modify: `packages/core/src/index.ts:191-193`
- Test: `packages/core/src/types/path-segments.test.ts` (append)

- [ ] **Step 1: Write the failing test (append to path-segments.test.ts)**

```ts
import { shapeAtPath } from "./shapes.ts";

describe("shapeAtPath (backward-compat wrapper)", () => {
  it("handles bracketed array elements in the path array", () => {
    expect(shapeAtPath(arrOfObj, ["[0]", "title"])).toEqual({ type: "string" });
    expect(shapeAtPath(arrOfObj, ["[*]", "title"])).toEqual({ type: "array", items: { type: "string" } });
  });
  it("descends past json", () => {
    expect(shapeAtPath(jsonObj, ["a", "b"])).toEqual(jsonObj);
  });
  it("empty path returns root", () => {
    expect(shapeAtPath(typedObj, [])).toEqual(typedObj);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @journeyman/core -- path-segments`
Expected: FAIL — the old `shapeAtPath` returns `null` for `["[0]","title"]` (old array branch ignores the segment and can't descend `title` correctly) or for the `json` case.

- [ ] **Step 3: Re-implement `shapeAtPath`**

In `packages/core/src/types/shapes.ts`, replace the `shapeAtPath` function (lines 115-134) with a wrapper. Keep `resolveShape`, `shapesEqual`, `shapesCompatible` unchanged. Add the import at the top of the file (after the existing `import type { Shape }` line):

```ts
import { parsePathSegments, shapeAtPathSegs } from "./path-segments.ts";
```

Replace the function body:

```ts
/**
 * Walk a dotted/bracketed path against a shape. Each array element may itself
 * contain bracket selectors (e.g. "items[0]"). Delegates to the path-segments
 * walker; see {@link shapeAtPathSegs}. Empty path returns the input.
 */
export function shapeAtPath(root: Shape, path: string[]): Shape | null {
  const segs = parsePathSegments(path.join("."));
  if (!segs) return null;
  return shapeAtPathSegs(root, segs);
}
```

> Note: `shapes.ts` and `path-segments.ts` import from each other (`shapes.ts` → `parsePathSegments`; `path-segments.ts` → `resolveShape`). This cycle is fine for ESM function references (no top-level execution depends on the other). If the boundary checker complains, it won't — both are within `@journeyman/core`.

- [ ] **Step 4: Export the new API from core**

In `packages/core/src/index.ts`, update the shapes export block (lines 191-193) to add the new symbols:

```ts
export {
  IssueShape, RepoShape, PullRequestShape, WorkspaceShape,
  NAMED_SHAPES, resolveShape, shapesEqual, shapeAtPath, shapesCompatible,
} from "./types/shapes.ts";
export { parsePathSegments, shapeAtPathSegs } from "./types/path-segments.ts";
export type { PathSeg } from "./types/path-segments.ts";
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npm test -w @journeyman/core -- path-segments && npm run typecheck -w @journeyman/core`
Expected: PASS; no type errors.

- [ ] **Step 6: Run the full core test suite to catch regressions**

Run: `npm test -w @journeyman/core`
Expected: PASS. If `shapes.compat.test.ts` or any existing test breaks, the old `[item]`/dot-number array convention was relied upon — investigate before proceeding (no stored refs use it; see plan notes).

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/types/shapes.ts packages/core/src/index.ts packages/core/src/types/path-segments.test.ts
git commit -m "refactor(core): shapeAtPath delegates to path-segments walker"
```

---

## Task 3: Migrate orchestrator `validate-ref-shape.ts`

**Files:**
- Modify: `packages/orchestrator/src/flow-json/validate-ref-shape.ts`
- Test: `packages/orchestrator/src/flow-json/validate-ref-shape.drill.test.ts` (create)

This validator has 4 lookup sites (workflow.input, workflow.attribute, pause, join, step) each doing `path[0]` lookup + `shapeAtPath(root, path.slice(1))`. Replace the shared parse so the head name is bracket-stripped and the tail preserves index/wildcard.

- [ ] **Step 1: Write the failing test**

Create `packages/orchestrator/src/flow-json/validate-ref-shape.drill.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { WorkflowGraph } from "@journeyman/core";
import { resolveRefShape, type CatalogShapeEntry } from "./validate-ref-shape.ts";

const flow: WorkflowGraph = {
  id: "f", name: "f", nodes: [
    { id: "trigger", type: "trigger-manual", config: {} } as any,
    { id: "list", type: "step", stepType: "listPRs", config: {} } as any,
  ],
  edges: [], inputDefs: [], attributeDefs: [],
} as any;

const catalog = new Map<string, CatalogShapeEntry>([
  ["listPRs", {
    stepType: "listPRs",
    inputFields: {},
    outputSchema: {
      pullRequests: { type: "array", items: { type: "object", fields: { title: { type: "string" } } } },
      blob: { type: "json", container: "object" },
    },
  }],
]);

describe("resolveRefShape — drilling", () => {
  it("indexes a typed array to its item field", () => {
    const r = resolveRefShape(flow, "list.output.pullRequests[0].title", catalog);
    expect(r.ok).toBe(true);
    expect(r.shape).toEqual({ type: "string" });
  });
  it("projects a typed array field with [*]", () => {
    const r = resolveRefShape(flow, "list.output.pullRequests[*].title", catalog);
    expect(r.ok).toBe(true);
    expect(r.shape).toEqual({ type: "array", items: { type: "string" } });
  });
  it("drills past opaque json and stays opaque", () => {
    const r = resolveRefShape(flow, "list.output.blob.a.b.c", catalog);
    expect(r.ok).toBe(true);
    expect(r.shape).toEqual({ type: "json", container: "object" });
  });
  it("rejects a malformed path", () => {
    const r = resolveRefShape(flow, "list.output.pullRequests[abc]", catalog);
    expect(r.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @journeyman/orchestrator -- validate-ref-shape.drill`
Expected: FAIL — `[0]`/`[*]` paths resolve to `null` ("Path not found") and the `blob` drill fails.

- [ ] **Step 3: Implement — add a shared head helper and migrate all sites**

In `packages/orchestrator/src/flow-json/validate-ref-shape.ts`:

Update the import on line 2 to add the new symbols:

```ts
import { resolveShape, shapeAtPathSegs, parsePathSegments, shapesCompatible, getStartWorkflowInputs, workflowInputDefShape, workflowAttributeDefShape, pauseNodeOutputSchema, joinNodeOutputSchema } from "@journeyman/core";
```

Immediately after the `RefShapeResult` interface (before `resolveRefShape`), add:

```ts
/** Split a parsed ref field into its head field name and the tail segments to walk. */
function splitField(field: string): { head: string; tail: import("@journeyman/core").PathSeg[] } | null {
  const segs = parsePathSegments(field);
  if (!segs || segs.length === 0 || segs[0].kind !== "key") return null;
  return { head: segs[0].key, tail: segs.slice(1) };
}
```

Now replace the body of `resolveRefShape` so it computes `split` once and uses `split.head` for every declaration lookup and `shapeAtPathSegs(root, split.tail)` for every leaf resolution. Concretely, after `const parsed = parseRef(ref); if (!parsed) ...`, replace the line `const path = parsed.field.split(".");` with:

```ts
  const split = splitField(parsed.field);
  if (!split) return { ok: false, error: `Invalid path in ref '${ref}'` };
```

Then apply these substitutions throughout the function (each `path[0]` → `split.head`; each `shapeAtPath(<root>, path.slice(1))` → `shapeAtPathSegs(<root>, split.tail)`):

- workflow.input block:
  ```ts
  const decl = workflowInputs.find(r => r.name === split.head);
  if (!decl) return { ok: false, error: `workflow.input.${split.head} not declared` };
  const root: Shape = workflowInputDefShape(decl);
  const leaf = shapeAtPathSegs(root, split.tail);
  return leaf ? { ok: true, shape: leaf } : { ok: false, error: `Path not found: ${ref}` };
  ```
- workflow.attribute block: same pattern with `split.head` and `shapeAtPathSegs(root, split.tail)`.
- pause block: `const pauseRoot = pauseSchema[split.head];` and `const pauseLeaf = shapeAtPathSegs(pauseRoot, split.tail);` (keep the `parsed.scope !== "output"` guard and the not-declared error using `split.head`).
- join block: `const joinRoot = joinSchema[split.head];` and `const joinLeaf = shapeAtPathSegs(joinRoot, split.tail);`.
- step block (lines ~116-123):
  ```ts
  const root: Shape | undefined =
    parsed.scope === "output" ? outputSchema?.[split.head] : inputFields?.[split.head]?.shape;
  if (!root) return { ok: false, error: `Field '${parsed.scope}.${split.head}' not declared on ${labelNode(node, parsed.source)}` };
  const leaf = shapeAtPathSegs(root, split.tail);
  return leaf ? { ok: true, shape: leaf } : { ok: false, error: `Path not found: ${ref}` };
  ```

Remove the now-unused `shapeAtPath` from the import (it was replaced by `shapeAtPathSegs`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w @journeyman/orchestrator -- validate-ref-shape`
Expected: PASS — the new drill test plus existing `validate-ref-shape.pause-node` and `validate-ref-shape.attribute` tests stay green.

- [ ] **Step 5: Typecheck the package**

Run: `npm run typecheck -w @journeyman/orchestrator`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/orchestrator/src/flow-json/validate-ref-shape.ts packages/orchestrator/src/flow-json/validate-ref-shape.drill.test.ts
git commit -m "feat(orchestrator): resolve drilled json/array paths in ref validation"
```

---

## Task 4: Migrate flow-editor `state/validate-ref-shape.ts`

**Files:**
- Modify: `packages/flow-editor/src/state/validate-ref-shape.ts`
- Test: `packages/flow-editor/src/state/validate-ref-shape.drill.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `packages/flow-editor/src/state/validate-ref-shape.drill.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { WorkflowGraph } from "@journeyman/core";
import { validateRefShape } from "./validate-ref-shape.ts";
import type { StepCatalogEntry } from "../catalogs/use-step-catalog.ts";

const flow: WorkflowGraph = {
  id: "f", name: "f",
  nodes: [{ id: "list", type: "step", stepType: "listPRs", config: {} } as any],
  edges: [], inputDefs: [], attributeDefs: [],
} as any;

const catalog: Record<string, StepCatalogEntry> = {
  listPRs: {
    inputFields: {},
    outputSchema: { pullRequests: { type: "array", items: { type: "object", fields: { title: { type: "string" } } } } },
  } as any,
};

describe("validateRefShape — drilling", () => {
  it("accepts [0].title against a string target", () => {
    const r = validateRefShape(flow, "list.output.pullRequests[0].title", { type: "string" }, catalog);
    expect(r.ok).toBe(true);
  });
  it("accepts [*].title against a string[] target", () => {
    const r = validateRefShape(flow, "list.output.pullRequests[*].title", { type: "array", items: { type: "string" } }, catalog);
    expect(r.ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @journeyman/flow-editor -- state/validate-ref-shape.drill`
Expected: FAIL — paths resolve to `null` ("Path not found").

- [ ] **Step 3: Implement**

In `packages/flow-editor/src/state/validate-ref-shape.ts`:

Update the import (line 2):

```ts
import { resolveShape, shapeAtPathSegs, parsePathSegments, shapesCompatible, getStartWorkflowInputs, workflowInputDefShape } from "@journeyman/core";
```

Replace `const path = fieldPath.split(".");` (line 16) with:

```ts
  const segs = parsePathSegments(fieldPath);
  if (!segs || segs.length === 0 || segs[0].kind !== "key") return { ok: false, error: `Invalid path '${ref}'` };
  const head = segs[0].key;
  const tail = segs.slice(1);
```

In the `source === "workflow"` block: `const decl = decls.find(r => r.name === head);`, error message uses `head`, then `const leaf = shapeAtPathSegs(root, tail);`.

In the node block: `root = scope === "output" ? entry?.outputSchema?.[head] : entry?.inputFields?.[head]?.shape;`, error uses `head`, then `const leaf = shapeAtPathSegs(root, tail);`.

- [ ] **Step 4: Run tests + typecheck**

Run: `npm test -w @journeyman/flow-editor -- state/validate-ref-shape && npm run typecheck -w @journeyman/flow-editor`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/flow-editor/src/state/validate-ref-shape.ts packages/flow-editor/src/state/validate-ref-shape.drill.test.ts
git commit -m "feat(flow-editor): resolve drilled paths in editor ref validation"
```

---

## Task 5: Migrate core `validate-workflow.ts`

**Files:**
- Modify: `packages/core/src/utils/validate-workflow.ts:327-389`
- Test: `packages/core/src/utils/validate-workflow.drill.test.ts` (create)

This is the dangling-ref-path validator. It uses `parsed.fieldPath` (a `string[]`). Convert the head + tail using the new tokenizer at the three `shapeAtPath` sites.

- [ ] **Step 1: Read the surrounding parser**

Read `packages/core/src/utils/validate-workflow.ts` lines 1-60 and the `parseRefForValidation` definition to confirm `parsed.fieldPath: string[]` and `parsed.source` / `parsed.scope`. Confirm `extractTemplateRefs` is imported (it is, per line ~309). No code change in this step.

- [ ] **Step 2: Write the failing test**

Create `packages/core/src/utils/validate-workflow.drill.test.ts`. Mirror an existing validate-workflow test's flow scaffold (see `validate-workflow.literal.test.ts` for the `validateWorkflow` import and graph shape). The test asserts that a node input bound to `producer.output.items[*].title` produces **no** `dangling-ref-path` warning when `items` is `array<{title:string}>`:

```ts
import { describe, it, expect } from "vitest";
import { validateWorkflow } from "./validate-workflow.ts";
// NOTE: copy the exact import name + signature from validate-workflow.literal.test.ts;
// adjust the graph/catalog scaffold to match that file's helpers.

describe("validate-workflow — drilled array ref", () => {
  it("does not warn dangling-ref-path for items[*].title on a typed array output", () => {
    // Build a 2-node flow: producer with output { items: array<{title:string}> },
    // consumer with a string[] input bound to { kind:"ref", ref:"<producerId>.output.items[*].title" }.
    // const result = validateWorkflow(graph, catalog);
    // expect(result.warnings.find(w => w.code === "dangling-ref-path")).toBeUndefined();
    expect(true).toBe(true); // replace with the real assertion once scaffold is copied
  });
});
```

> The placeholder assertion above MUST be replaced in this step with a real flow built from the `validate-workflow.literal.test.ts` scaffold before moving on. Do not leave `expect(true).toBe(true)`.

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -w @journeyman/core -- validate-workflow.drill`
Expected: FAIL — a `dangling-ref-path` warning is present (path doesn't resolve today).

- [ ] **Step 4: Implement**

In `packages/core/src/utils/validate-workflow.ts`:

Update the import on line 4:

```ts
import { shapeAtPathSegs, parsePathSegments, shapesCompatible } from "../types/shapes.ts";
```

> `shapeAtPathSegs` and `parsePathSegments` are re-exported by `shapes.ts`? No — they live in `path-segments.ts`. Import from there instead:
> ```ts
> import { shapesCompatible } from "../types/shapes.ts";
> import { shapeAtPathSegs, parsePathSegments } from "../types/path-segments.ts";
> ```

At the top of the per-ref loop body (right after `const parsed = parseRefForValidation(ref);` succeeds, before the scope branches at line ~327), compute the head/tail once:

```ts
        const _segs = parsePathSegments(parsed.fieldPath.join("."));
        if (!_segs || _segs.length === 0 || _segs[0].kind !== "key") {
          warnings.push({
            code: "dangling-ref-path",
            message: `${node.id}.${key}: ref '${ref}' has an invalid path`,
            nodeId: node.id, inputKey: key, ref, missingPath: parsed.fieldPath.join("."),
          });
          continue;
        }
        const _head = _segs[0].key;
        const _tail = _segs.slice(1);
```

Then in each of the three branches:
- workflow.input: `const def = workflowInputByName.get(_head);` (was `parsed.fieldPath[0]`), and `actual = root ? (_tail.length > 0 ? shapeAtPathSegs(root, _tail) ?? undefined : root) : undefined;`
- workflow.attribute: `const def = workflowAttributeByName.get(_head);`, and `actual = root ? (_tail.length > 0 ? shapeAtPathSegs(root, _tail) ?? undefined : root) : undefined;`
- output: `const root = outputSchema[_head];` (was `parsed.fieldPath[0]`), and `actual = shapeAtPathSegs(root, _tail) ?? undefined;`

Leave the `missingPath`/error message strings using `parsed.fieldPath.join(".")` as-is (display only). Replace only the **lookup keys** (`parsed.fieldPath[0]` → `_head`) and the **walk calls** (`shapeAtPath(root, parsed.fieldPath.slice(1))` → `shapeAtPathSegs(root, _tail)`).

- [ ] **Step 5: Run tests + full core suite + typecheck**

Run: `npm test -w @journeyman/core && npm run typecheck -w @journeyman/core`
Expected: PASS — new drill test green, all existing validate-workflow tests green.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/utils/validate-workflow.ts packages/core/src/utils/validate-workflow.drill.test.ts
git commit -m "feat(core): resolve drilled paths in workflow ref validation"
```

---

## Task 6: Prove brackets survive runtime ref conversion

**Files:**
- Test: `packages/orchestrator/src/flow-json/resolve-inputs.drill.test.ts` (create)

No production code changes — this locks in that `sanitizeRef`/`toEngineRef`/`resolveInputs` preserve `[0]`/`[*]` and dotted paths so Conductor receives valid JSONPath.

- [ ] **Step 1: Write the test**

Create `packages/orchestrator/src/flow-json/resolve-inputs.drill.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "vitest";
import { resolveInputs, toEngineRef, sanitizeRef } from "./resolve-inputs.ts";

test("brackets and dots survive sanitizeRef", () => {
  assert.equal(sanitizeRef("list.output.pullRequests[0].title"), "list.output.pullRequests[0].title");
  assert.equal(sanitizeRef("list.output.items[*].title"), "list.output.items[*].title");
  assert.equal(sanitizeRef("wh.output.payload.user.name"), "wh.output.payload.user.name");
});

test("toEngineRef preserves the drilled tail verbatim", () => {
  assert.equal(toEngineRef("list.output.pullRequests[0].title"), "list.output.pullRequests[0].title");
  assert.equal(toEngineRef("workflow.attribute.payload[*].id"), "workflow.input.attributes.payload[*].id");
});

test("resolveInputs wraps drilled refs as ${...}", () => {
  const out = resolveInputs({
    a: { kind: "ref", ref: "list.output.pullRequests[0].title" },
    b: { kind: "template", template: "branch-${list.output.items[*].title}" },
  });
  assert.equal(out.a, "${list.output.pullRequests[0].title}");
  assert.equal(out.b, "branch-${list.output.items[*].title}");
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npm test -w @journeyman/orchestrator -- resolve-inputs.drill`
Expected: PASS immediately (no production change needed). If `sanitizeRef` is not exported, add it to the existing export in `resolve-inputs.ts` (it already is — `export function sanitizeRef`).

- [ ] **Step 3: Commit**

```bash
git add packages/orchestrator/src/flow-json/resolve-inputs.drill.test.ts
git commit -m "test(orchestrator): lock in bracket/dot survival through ref conversion"
```

---

## Task 7: Mark drillable leaves in `mention-fields`

**Files:**
- Modify: `packages/flow-editor/src/properties-panel/mention-fields.ts`
- Test: `packages/flow-editor/src/properties-panel/mention-fields.test.ts` (append)

- [ ] **Step 1: Write the failing test (append to mention-fields.test.ts)**

Inside the existing `test(...)`, after the json-object block, add:

```ts
  // json/array leaves are drillable; scalars and typed objects are not
  {
    const src: UpstreamSource = {
      kind: "node", id: "n1", label: "Lister",
      groups: [{
        title: "Outputs", scope: "output",
        fields: [
          { name: "prs", scope: "output", shape: { type: "array", items: { type: "object", fields: { title: { type: "string" } } } } },
          { name: "blob", scope: "output", shape: { type: "json", container: "object" } },
          { name: "name", scope: "output", shape: { type: "string" } },
        ],
      }],
    };
    const f = toMentionFields([src]);
    assert.equal(f.find(x => x.ref === "n1.output.prs")!.drillable, true);
    assert.equal(f.find(x => x.ref === "n1.output.blob")!.drillable, true);
    assert.equal(f.find(x => x.ref === "n1.output.name")!.drillable, false);
  }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @journeyman/flow-editor -- mention-fields`
Expected: FAIL — `drillable` is `undefined` (property doesn't exist).

- [ ] **Step 3: Implement**

In `packages/flow-editor/src/properties-panel/mention-fields.ts`:

Add `drillable` to the `MentionField` interface:

```ts
export interface MentionField {
  ref: string;
  sourceId: string;
  sourceLabel: string;
  showId: boolean;
  fieldPath: string;
  type?: string;
  /** True when the leaf is an array or opaque json — a path tail can be appended. */
  drillable: boolean;
  shape: Shape;
}
```

In `toMentionFields`, when pushing each field, compute it from the resolved leaf shape. The `leaf.shape` is already available; add:

```ts
        for (const leaf of flatten(field.shape, [field.name])) {
          const lt = leaf.shape.type;
          out.push({
            ref: refFor(group.scope, source.id, leaf.path),
            sourceId: source.id,
            sourceLabel: source.label,
            showId,
            fieldPath: fieldPathFor(group.scope, leaf.path),
            type: leaf.type,
            drillable: lt === "array" || lt === "json",
            shape: leaf.shape,
          });
        }
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npm test -w @journeyman/flow-editor -- mention-fields && npm run typecheck -w @journeyman/flow-editor`
Expected: PASS. (The existing `correlation-value`/`shape-for-ref` tests that build `MentionField`s, if any, may now need `drillable` — search and fix: `grep -rln "MentionField" packages/flow-editor/src` and add `drillable: false` to any literal that constructs one. The mention-fields test constructs via `toMentionFields`, so it's covered.)

- [ ] **Step 5: Commit**

```bash
git add packages/flow-editor/src/properties-panel/mention-fields.ts packages/flow-editor/src/properties-panel/mention-fields.test.ts
git commit -m "feat(flow-editor): flag array/json mention leaves as drillable"
```

---

## Task 8: Editor ref-path helpers

**Files:**
- Create: `packages/flow-editor/src/properties-panel/ref-path.ts`
- Test: `packages/flow-editor/src/properties-panel/ref-path.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/flow-editor/src/properties-panel/ref-path.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { splitRefPath, joinRefPath, validatePathTail } from "./ref-path.ts";
import type { MentionField } from "./mention-fields.ts";

const fields: MentionField[] = [
  { ref: "wh.output.payload", sourceId: "wh", sourceLabel: "Webhook", showId: false, fieldPath: "output.payload", type: "json object", drillable: true, shape: { type: "json", container: "object" } },
  { ref: "list.output.prs", sourceId: "list", sourceLabel: "Lister", showId: false, fieldPath: "output.prs", type: "array", drillable: true, shape: { type: "array", items: { type: "string" } } },
];

describe("splitRefPath", () => {
  it("splits a drilled ref into base + tail", () => {
    expect(splitRefPath("wh.output.payload.user.name", fields)).toEqual({ baseRef: "wh.output.payload", tail: ".user.name" });
    expect(splitRefPath("list.output.prs[0].title", fields)).toEqual({ baseRef: "list.output.prs", tail: "[0].title" });
  });
  it("returns empty tail when the ref is exactly a base field", () => {
    expect(splitRefPath("wh.output.payload", fields)).toEqual({ baseRef: "wh.output.payload", tail: "" });
  });
  it("falls back to the whole ref as base when nothing matches", () => {
    expect(splitRefPath("unknown.output.x", fields)).toEqual({ baseRef: "unknown.output.x", tail: "" });
  });
});

describe("joinRefPath", () => {
  it("concatenates base and tail", () => {
    expect(joinRefPath("wh.output.payload", ".user.name")).toBe("wh.output.payload.user.name");
    expect(joinRefPath("list.output.prs", "[0].title")).toBe("list.output.prs[0].title");
    expect(joinRefPath("wh.output.payload", "")).toBe("wh.output.payload");
  });
});

describe("validatePathTail", () => {
  it("accepts empty, dotted, indexed, wildcard tails", () => {
    expect(validatePathTail("").ok).toBe(true);
    expect(validatePathTail(".user.name").ok).toBe(true);
    expect(validatePathTail("[0].title").ok).toBe(true);
    expect(validatePathTail("[*].title").ok).toBe(true);
    expect(validatePathTail(".items[0].tags[*]").ok).toBe(true);
  });
  it("rejects tails that do not start with . or [", () => {
    expect(validatePathTail("user.name").ok).toBe(false);
  });
  it("rejects malformed brackets", () => {
    expect(validatePathTail("[abc]").ok).toBe(false);
    expect(validatePathTail(".a[").ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @journeyman/flow-editor -- ref-path`
Expected: FAIL — `Cannot find module './ref-path.ts'`.

- [ ] **Step 3: Implement**

Create `packages/flow-editor/src/properties-panel/ref-path.ts`:

```ts
import { parsePathSegments } from "@journeyman/core";
import type { MentionField } from "./mention-fields.ts";

/**
 * Split a (possibly drilled) ref into the picked base ref + the appended path
 * tail. The base is the longest known field ref that prefixes `ref` at a
 * segment boundary (next char is "." or "["). Falls back to the whole ref.
 */
export function splitRefPath(ref: string, fields: MentionField[]): { baseRef: string; tail: string } {
  let best = "";
  for (const f of fields) {
    if (ref === f.ref) return { baseRef: f.ref, tail: "" };
    if (ref.startsWith(f.ref)) {
      const next = ref[f.ref.length];
      if ((next === "." || next === "[") && f.ref.length > best.length) best = f.ref;
    }
  }
  if (!best) return { baseRef: ref, tail: "" };
  return { baseRef: best, tail: ref.slice(best.length) };
}

/** Concatenate a base ref and a path tail (tail already includes its leading "."/"["). */
export function joinRefPath(baseRef: string, tail: string): string {
  return baseRef + tail;
}

/**
 * Validate a path tail typed by the user. Empty is allowed. Non-empty must begin
 * with "." or "[" and tokenize cleanly into key/index/wildcard segments.
 */
export function validatePathTail(tail: string): { ok: boolean; error?: string } {
  if (tail === "") return { ok: true };
  if (tail[0] !== "." && tail[0] !== "[") {
    return { ok: false, error: "Path must start with '.' or '['" };
  }
  const segs = parsePathSegments(tail);
  if (!segs) return { ok: false, error: "Invalid path — use .field, [0], or [*]" };
  return { ok: true };
}
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npm test -w @journeyman/flow-editor -- ref-path && npm run typecheck -w @journeyman/flow-editor`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/flow-editor/src/properties-panel/ref-path.ts packages/flow-editor/src/properties-panel/ref-path.test.ts
git commit -m "feat(flow-editor): ref-path split/join/validate helpers"
```

---

## Task 9: Path-tail input in InputValueEditor (reference mode)

**Files:**
- Modify: `packages/flow-editor/src/properties-panel/InputValueEditor.tsx`

No unit test (the codebase has no React render-test harness for these components). Gate is `npm run check` + the preview verification at the end of the plan. All testable logic already lives in `ref-path.ts` (Task 8).

- [ ] **Step 1: Implement the path-tail input**

In `packages/flow-editor/src/properties-panel/InputValueEditor.tsx`:

Add imports:

```ts
import { splitRefPath, joinRefPath, validatePathTail } from "./ref-path.ts";
```

Inside the component, after the existing `jsonText`/`jsonError` state, derive the base ref + tail from the current value and add local tail state:

```ts
  // Reference-mode drilling: split the stored ref into the picked base + path tail.
  const refSplit =
    value?.kind === "ref" ? splitRefPath(value.ref, fields) : { baseRef: "", tail: "" };
  const baseField = fields.find(f => f.ref === refSplit.baseRef);
  const canDrill = mode === "reference" && !!baseField?.drillable;

  const [pathTail, setPathTail] = useState<string>(refSplit.tail);
  const [pathError, setPathError] = useState<string | null>(null);

  // Re-sync the tail buffer when the committed ref changes externally.
  useEffect(() => {
    if (value?.kind !== "ref") { setPathTail(""); setPathError(null); return; }
    const s = splitRefPath(value.ref, fields);
    setPathTail(prev => (prev === s.tail ? prev : s.tail));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
```

In the `mode === "reference"` block, render the tail input directly after `<MentionInput .../>` (still inside the same fragment/wrapper — change the JSX so the reference branch returns a wrapping `<>...</>` or `<div>`):

```tsx
      {mode === "reference" && (
        <>
          <MentionInput
            value={inputToRefSegments(refSplit.baseRef ? { kind: "ref", ref: refSplit.baseRef } : value)}
            fields={fields}
            readOnly={readOnly}
            expected={expected}
            placeholder={placeholder ?? (required ? "Required — @ to bind from upstream" : "@ to bind from upstream")}
            onChange={segs => {
              const next = refSegmentsToInput(segs);
              // Picking a new base ref resets any existing tail.
              setPathTail("");
              setPathError(null);
              onChange(next);
            }}
          />
          {canDrill && !readOnly && (
            <div className="je-input-value__path">
              <span className="je-input-value__path-prefix">path</span>
              <input
                className={`je-input-value__path-input${pathError ? " je-input-value__path-input--error" : ""}`}
                value={pathTail}
                placeholder="[0].field or .field…"
                onChange={e => {
                  const t = e.target.value;
                  setPathTail(t);
                  const v = validatePathTail(t);
                  if (!v.ok) { setPathError(v.error ?? "Invalid path"); return; }
                  setPathError(null);
                  onChange({ kind: "ref", ref: joinRefPath(refSplit.baseRef, t) });
                }}
              />
              {pathError && <div className="je-input-value__path-error">{pathError}</div>}
            </div>
          )}
        </>
      )}
```

> Rationale: feed `MentionInput` only the **base** ref so the chip label resolves correctly; the tail lives in its own input. `splitRefPath` reconstructs the split on every render from the stored full ref.

- [ ] **Step 2: Typecheck + boundaries**

Run: `npm run check`
Expected: no type errors, no boundary violations.

- [ ] **Step 3: Commit**

```bash
git add packages/flow-editor/src/properties-panel/InputValueEditor.tsx
git commit -m "feat(flow-editor): path-tail input for drilling json/array references"
```

---

## Task 10: CSS for the path tail

**Files:**
- Modify: the stylesheet that defines `.je-input-value` (locate it).

- [ ] **Step 1: Locate the stylesheet**

Run: `grep -rln "je-input-value__modes\|je-input-value__json-area" packages/flow-editor/src`
Use the returned `.css` file (the one with the existing `je-input-value__*` rules).

- [ ] **Step 2: Append CSS rules**

Add to that stylesheet, matching the file's existing variable/token conventions (reuse the same CSS custom properties used by `je-input-value__json-area`):

```css
.je-input-value__path {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
}
.je-input-value__path-prefix {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  opacity: 0.6;
}
.je-input-value__path-input {
  flex: 1;
  font-family: var(--je-mono, ui-monospace, monospace);
  font-size: 12px;
  padding: 5px 8px;
  border: 1px solid var(--je-border, #4a5170);
  border-radius: 6px;
  background: var(--je-input-bg, transparent);
  color: inherit;
}
.je-input-value__path-input--error { border-color: var(--je-danger, #d66); }
.je-input-value__path-error { color: var(--je-danger, #d66); font-size: 11px; margin-top: 4px; }
```

> If the stylesheet uses different variable names for border/danger/mono, substitute them — match the existing `je-input-value__json-error` rule's color token.

- [ ] **Step 3: Verify build**

Run: `npm run check`
Expected: passes (CSS isn't type-checked, but this confirms nothing else broke).

- [ ] **Step 4: Commit**

```bash
git add packages/flow-editor/src
git commit -m "style(flow-editor): path-tail input styling"
```

---

## Task 11: Info-icon help popover

**Files:**
- Create: `packages/flow-editor/src/properties-panel/InputHelp.tsx`
- Modify: `packages/flow-editor/src/properties-panel/InputValueEditor.tsx`
- Modify: the `.je-input-value` stylesheet (help styles).

- [ ] **Step 1: Create the help component**

Create `packages/flow-editor/src/properties-panel/InputHelp.tsx`:

```tsx
import { useState } from "react";

/** Static help copy for mapping a step input. Exported for reuse/testing. */
export const INPUT_HELP_TITLE = "Mapping this input";
export const INPUT_HELP_LINES: { label: string; body: string }[] = [
  { label: "Value", body: "type a fixed value." },
  { label: "@ Reference", body: "pull a value from an earlier step or the workflow input." },
  { label: "Path", body: "after picking a JSON or list reference, type a path: .fieldName (object field), [0] (item by position, first is 0), [*] (that field from every item → a list). e.g. payload.user.name, pullRequests[0].title, pullRequests[*].title" },
  { label: "Combine", body: "in Value mode, mix text and multiple @mentions to join values. e.g. @fullName/@ticketNumber → sam-repo/jrmen/6" },
];

export function InputHelp() {
  const [open, setOpen] = useState(false);
  return (
    <span className="je-input-help">
      <button
        type="button"
        className="je-input-help__icon"
        aria-label="How to map this input"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
      >i</button>
      {open && (
        <div className="je-input-help__popover" role="dialog">
          <h4 className="je-input-help__title">{INPUT_HELP_TITLE}</h4>
          {INPUT_HELP_LINES.map(l => (
            <p key={l.label} className="je-input-help__line">
              <b>{l.label}</b> — {l.body}
            </p>
          ))}
        </div>
      )}
    </span>
  );
}
```

- [ ] **Step 2: Render it in InputValueEditor next to the mode tabs**

In `InputValueEditor.tsx`, import and place the icon inside the `je-input-value__modes` row (only when not read-only):

```tsx
import { InputHelp } from "./InputHelp.tsx";
```

```tsx
        <div className="je-input-value__modes" role="tablist">
          <button ...>Value</button>
          <button ...>@ Reference</button>
          <InputHelp />
        </div>
```

- [ ] **Step 3: Add help CSS**

Append to the `.je-input-value` stylesheet:

```css
.je-input-help { position: relative; display: inline-flex; margin-left: 6px; }
.je-input-help__icon {
  width: 18px; height: 18px; border-radius: 50%;
  border: 1px solid var(--je-border, #4a5170);
  font-style: italic; font-size: 11px; line-height: 1;
  background: transparent; color: inherit; cursor: pointer;
}
.je-input-help__popover {
  position: absolute; top: 22px; right: 0; z-index: 20;
  width: 320px; padding: 12px 14px;
  border: 1px solid var(--je-border, #3a4360); border-radius: 8px;
  background: var(--je-surface, #161a24); color: inherit;
  box-shadow: 0 8px 24px rgba(0,0,0,.35);
}
.je-input-help__title { margin: 0 0 8px; font-size: 13px; }
.je-input-help__line { margin: 6px 0; font-size: 12px; line-height: 1.5; }
```

- [ ] **Step 4: Verify build**

Run: `npm run check`
Expected: passes.

- [ ] **Step 5: Commit**

```bash
git add packages/flow-editor/src/properties-panel/InputHelp.tsx packages/flow-editor/src/properties-panel/InputValueEditor.tsx packages/flow-editor/src
git commit -m "feat(flow-editor): info-icon help popover for input mapping"
```

---

## Task 12: Merge discoverability in Value mode

**Files:**
- Modify: `packages/flow-editor/src/properties-panel/InputValueEditor.tsx`

- [ ] **Step 1: Update the Value-mode string placeholder + hint**

In `InputValueEditor.tsx`, change the `mode === "value" && widget === "string"` MentionInput's placeholder and add a hint line beneath it:

```tsx
      {mode === "value" && widget === "string" && (
        <>
          <MentionInput
            value={inputToValueSegments(value)}
            fields={fields}
            readOnly={readOnly}
            expected={expected}
            placeholder={placeholder ?? "Type text and @mention to combine — e.g. @fullName/@ticketNumber"}
            onChange={segs => onChange(valueSegmentsToInput(segs))}
          />
          {!readOnly && (
            <div className="je-input-value__hint">
              Mix text and multiple @mentions to combine values into one string.
            </div>
          )}
        </>
      )}
```

- [ ] **Step 2: Add hint CSS**

Append to the `.je-input-value` stylesheet:

```css
.je-input-value__hint { font-size: 11px; opacity: 0.7; margin-top: 4px; }
```

- [ ] **Step 3: Verify build**

Run: `npm run check`
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add packages/flow-editor/src/properties-panel/InputValueEditor.tsx packages/flow-editor/src
git commit -m "feat(flow-editor): surface attribute-merge in Value mode (hint + placeholder)"
```

---

## Task 13: Full check + manual preview verification

**Files:** none (verification only).

- [ ] **Step 1: Whole-repo type + boundary + test gate**

Run: `npm run check && npm test -w @journeyman/core && npm test -w @journeyman/orchestrator && npm test -w @journeyman/flow-editor`
Expected: all green. Fix any regressions before continuing.

- [ ] **Step 2: Launch the web app and verify in the browser**

Use the preview workflow (preview_start). Open the flow editor, add a step whose input expects a string, and a producer node that outputs a `json` object and/or an array (e.g. a webhook trigger payload, or `listPullRequests`).
- In `@ Reference` mode, pick the json/array source → confirm the **path box** appears with placeholder `[0].field or .field…`.
- Type `[0].title` → confirm no error; type `[abc]` → confirm inline error and that the value is not committed.
- In `Value` mode, type text + two `@`-mentions → confirm a `template` is produced (chips render inline; hint visible).
- Click the **ⓘ** → confirm the help popover shows Value / @ Reference / Path / Combine.
Capture a screenshot (preview_screenshot) as proof.

- [ ] **Step 3: Commit any fixes**

```bash
git add -A && git commit -m "fix(flow-editor): drilling/merge UI fixes from preview verification"
```

---

## Task 14: Runtime `[*]` verification spike (the one open risk)

**Files:** none (or a short note in the spec under "Open risk").

- [ ] **Step 1: Exercise a drilled ref end-to-end**

With infra up (`npm run infra:up`) and a worker running (`npm run start:worker`), run a flow where a step input is bound to `<producer>.output.<array>[0].<field>` and another to `<producer>.output.<array>[*].<field>`. Inspect the step's received `inputData` (worker logs) to confirm:
- `[0].field` resolves to the single value.
- `[*].field` resolves to a JSON array of the field across items.

- [ ] **Step 2: Record the outcome**

If both resolve: add a line to the spec's "Open risk" section: `Verified <date>: Conductor resolves [N] and [*] inside ${…}.` and remove the risk caveat.
If `[*]` does NOT resolve: add a note that `[*]` is unsupported by the engine; open a follow-up to either (a) post-process `[*]` projections in `worker-harness.ts` using a `getByPath`-style walker, or (b) hide the `[*]` affordance until supported. `[0]` index shipping is unaffected.

- [ ] **Step 3: Commit the spec note**

```bash
git add docs/superpowers/specs/2026-06-10-json-path-drilling-and-merge-design.md
git commit -m "docs: record runtime [*] verification outcome"
```

---

## Notes & Known Limitations

- **Behavioral change in `shapeAtPath`:** the old code descended into `array.items` for *any* segment (the `[item]`/numeric-dot convention) and returned `null` past `json`. The new walker requires `[N]`/`[*]` for arrays, allows descent past `json` (staying `json`), and rejects a bare key on an array. No stored refs use the old conventions (the mention picker only ever emitted arrays/json as terminal leaves), so this is safe; Task 2 Step 6 runs the full core suite to confirm.
- **Drilled refs inside a merge template:** supported at the data, validation, and runtime layers (a template ref segment is validated by the same `shapeAtPathSegs` path, and `resolveInputs` rewrites each ref). Authoring a *drilled* mention from inside the Value-mode template UI is **not** built in v1 — the picker inserts the base ref; a user can hand-type the tail only on standalone references. Follow-up if requested.
- **Opaque-json results are untyped:** drilling past a `json` shape always yields `json`, which `shapesCompatible` treats permissively against any object/array target. No type-checking is possible without a declared schema (out of scope).

## Self-Review (completed against the spec)

- **Spec coverage:** Feature 1 drilling → Tasks 1–10; "applies to all step inputs" → shared `InputValueEditor`/`mention-fields`, no `customStepId` gate (Task 9/11); Feature 2 merge discoverability → Task 12; Feature 3 info help → Task 11; runtime no-change + tests → Task 6; `[*]` spike → Task 14. All spec sections map to a task.
- **Placeholders:** none, except the deliberately-flagged scaffold in Task 5 Step 2 which the step itself requires to be replaced before proceeding.
- **Type consistency:** `PathSeg`, `parsePathSegments`, `shapeAtPathSegs` names are used identically across Tasks 1–8; `splitRefPath`/`joinRefPath`/`validatePathTail` signatures match between Task 8 (definition) and Task 9 (use); `drillable` added in Task 7 is consumed in Tasks 8–9.
