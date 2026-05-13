# Custom Phase Upstream Refs — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every downstream node's value picker show a custom AI phase's declared inputs and outputs, and make publish-time shape validation resolve refs to custom-phase fields.

**Architecture:** Both the editor's `useUpstreamSources` and the orchestrator's `resolveRefShape` look up shape info via `catalog[node.phaseType]`. For a custom-phase node, `phaseType === "custom-ai"` is a stub with empty fields; the real shape lives on the saved `CustomAiPhase` keyed by `node.config.customPhaseId`. We add a shared shape-adapter that turns a `CustomAiPhase` into `{ inputFields, outputSchema }`, plumb a per-id definitions map into both layers, and pre-load that map at the server publish path.

**Tech Stack:** TypeScript, React (flow-editor), Fastify (api-server), Postgres (custom-phases db).

**Constraints (per user):** no unit tests, no commits during this plan, run `npm run typecheck` at the very end.

---

## File Structure

**New files**

- `packages/custom-phases/src/shape-adapter.ts` — pure converter from `CustomAiPhase` (declarative input/output) into `{ inputFields: InputFields, outputSchema: OutputSchema | null }` (Shape-typed, the form consumed by the picker and ref-shape validator).
- `packages/flow-editor/src/catalogs/use-custom-phase-defs.ts` — React hook + module-level cache fetching custom phase defs by id.

**Modified files**

- `packages/custom-phases/src/index.ts` — re-export adapter.
- `packages/flow-editor/src/properties-panel/use-upstream-sources.ts` — accept `customPhaseDefs`; synthesize entries for custom-ai nodes.
- `packages/flow-editor/src/properties-panel/IoTab.tsx` — load defs, pass to hook.
- `packages/flow-editor/src/properties-panel/ConfigTab.tsx` — same.
- `packages/flow-editor/src/properties-panel/ControlNodeConfigTab.tsx` — same.
- `packages/orchestrator/src/flow-json/validate-ref-shape.ts` — accept `customPhaseDefs` map; branch on `phaseType === "custom-ai"`.
- `packages/orchestrator/src/flow-json/conductor-converter.ts` — thread `customPhaseDefs` through `validateGraph`, `ConvertCtx`, and the destination-side lookup on line ~112.
- `packages/api-server/src/routes/flows.ts` — pre-load custom phase defs and pass them into `validateGraph` at both save-path validators and the `/workflows/validate` path.

---

## Task 1: Shape adapter

**Files:**
- Create: `packages/custom-phases/src/shape-adapter.ts`
- Modify: `packages/custom-phases/src/index.ts`

The adapter is the single source of truth for "what shape does this custom phase expose to the rest of the system." Both the editor hook and the publish-path pre-loader call it.

- [ ] **Step 1: Create `packages/custom-phases/src/shape-adapter.ts`**

```ts
import type {
  CustomAiPhase,
  CustomPhaseInputField,
  CustomPhaseInputType,
  CustomPhaseJsonSchema,
  InputField,
  InputFields,
  OutputSchema,
  Shape,
} from "@journeyman/core";

/** Map a CustomPhaseInputType to a Shape used by the picker / ref validator. */
function inputTypeToShape(t: CustomPhaseInputType): Shape {
  switch (t) {
    case "string":
    case "template":      return { type: "string" };
    case "number":        return { type: "number" };
    case "boolean":       return { type: "boolean" };
    case "string[]":      return { type: "array", items: { type: "string" } };
    case "workspaceDir":  return { type: "string" };
    case "repoRef":       return { type: "ref", name: "RepoRef" };
    case "issueRef":      return { type: "ref", name: "IssueRef" };
    case "object":        return { type: "object", fields: {} };
    case "array":         return { type: "array", items: { type: "string" } };
  }
}

function inputFieldToCatalogField(f: CustomPhaseInputField): InputField {
  return {
    shape: inputTypeToShape(f.type),
    label: f.description ?? f.name,
    required: f.required,
  };
}

/** Convert the JSON-schema-ish output_schema to OutputSchema (Record<name, Shape>). */
function jsonSchemaToOutputSchema(schema: CustomPhaseJsonSchema | undefined): OutputSchema | null {
  if (!schema || typeof schema !== "object") return null;
  const props = (schema as { properties?: Record<string, unknown> }).properties;
  if (!props || typeof props !== "object") return null;
  const out: OutputSchema = {};
  for (const [name, raw] of Object.entries(props)) {
    out[name] = jsonSchemaNodeToShape(raw);
  }
  return out;
}

function jsonSchemaNodeToShape(raw: unknown): Shape {
  if (!raw || typeof raw !== "object") return { type: "string" };
  const node = raw as { type?: unknown; items?: unknown; properties?: unknown; description?: unknown };
  const desc = typeof node.description === "string" ? node.description : undefined;
  switch (node.type) {
    case "string":  return { type: "string", description: desc };
    case "number":
    case "integer": return { type: "number", description: desc };
    case "boolean": return { type: "boolean", description: desc };
    case "array":   return { type: "array", items: jsonSchemaNodeToShape(node.items), description: desc };
    case "object": {
      const fields: Record<string, Shape> = {};
      const props = node.properties && typeof node.properties === "object" ? node.properties as Record<string, unknown> : {};
      for (const [k, v] of Object.entries(props)) fields[k] = jsonSchemaNodeToShape(v);
      return { type: "object", fields, description: desc };
    }
    default: return { type: "string", description: desc };
  }
}

export interface CustomPhaseShape {
  inputFields: InputFields;
  outputSchema: OutputSchema | null;
}

/** Pure converter: a saved CustomAiPhase → the catalog-shaped view of its declared I/O. */
export function customPhaseToShape(phase: CustomAiPhase): CustomPhaseShape {
  const inputFields: InputFields = {};
  for (const f of phase.inputFields) inputFields[f.name] = inputFieldToCatalogField(f);

  const outputSchema =
    phase.outputMode === "structured" ? jsonSchemaToOutputSchema(phase.outputSchema) :
    phase.outputMode === "text"       ? ({ result: { type: "string" } } as OutputSchema) :
    null;

  return { inputFields, outputSchema };
}
```

- [ ] **Step 2: Re-export from `packages/custom-phases/src/index.ts`**

Add after the existing exports:

```ts
export { customPhaseToShape } from "./shape-adapter.ts";
export type { CustomPhaseShape } from "./shape-adapter.ts";
```

---

## Task 2: Editor — fetch & cache custom phase defs

**Files:**
- Create: `packages/flow-editor/src/catalogs/use-custom-phase-defs.ts`

- [ ] **Step 1: Create the hook**

```ts
import { useEffect, useState } from "react";
import type { CustomAiPhase } from "@journeyman/core";
import { useOrgId } from "../runtime/use-org-id.ts";

/** Module-level cache so re-renders and multiple call sites share fetches. */
const cache = new Map<string, Promise<CustomAiPhase | null>>();

function resolveBaseUrl(): string {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
  return env.VITE_API_BASE_URL ?? "";
}

async function fetchOne(orgId: string, id: string): Promise<CustomAiPhase | null> {
  const base = resolveBaseUrl();
  const tryUrl = async (u: string): Promise<CustomAiPhase | null> => {
    const r = await fetch(u, { credentials: "include" });
    if (!r.ok) return null;
    return (await r.json()) as CustomAiPhase;
  };
  const user = await tryUrl(`${base}/api/orgs/${orgId}/users/me/custom-phases/${id}`);
  if (user) return user;
  return tryUrl(`${base}/api/orgs/${orgId}/custom-phases/${id}`);
}

function getOrFetch(orgId: string, id: string): Promise<CustomAiPhase | null> {
  const key = `${orgId}::${id}`;
  let p = cache.get(key);
  if (!p) {
    p = fetchOne(orgId, id).catch(() => null);
    cache.set(key, p);
  }
  return p;
}

/** Returns the currently-resolved subset of `ids`. Re-renders as fetches land. */
export function useCustomPhaseDefs(ids: string[]): Record<string, CustomAiPhase | null> {
  const orgId = useOrgId();
  const [defs, setDefs] = useState<Record<string, CustomAiPhase | null>>({});
  const key = ids.slice().sort().join(",");
  useEffect(() => {
    if (!orgId) return;
    let alive = true;
    const next: Record<string, CustomAiPhase | null> = {};
    Promise.all(
      ids.map(async (id) => {
        const phase = await getOrFetch(orgId, id);
        next[id] = phase;
      }),
    ).then(() => {
      if (alive) setDefs((prev) => ({ ...prev, ...next }));
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, key]);
  return defs;
}
```

- [ ] **Step 2: Verify `useOrgId` import path**

Run: `grep -rn "export.*useOrgId" packages/flow-editor/src/ | head`

Expected: hits showing the exact relative path. If the path differs from `../runtime/use-org-id.ts`, correct the import in the file you just created.

---

## Task 3: Editor — enrich `useUpstreamSources` with custom-phase shapes

**Files:**
- Modify: `packages/flow-editor/src/properties-panel/use-upstream-sources.ts`

- [ ] **Step 1: Add the new parameter and synth-entry branch**

Update the imports at the top of the file:

```ts
import { useMemo } from "react";
import type { WorkflowGraph, Shape, CustomAiPhase } from "@journeyman/core";
import { getStartWorkflowInputs } from "@journeyman/core";
import { customPhaseToShape } from "@journeyman/custom-phases";
import type { PhaseCatalogEntry } from "../catalogs/use-phase-catalog.ts";
```

Replace the `useUpstreamSources` signature and the lookup near line 79 so the function reads:

```ts
export function useUpstreamSources(
  graph: WorkflowGraph,
  nodeId: string,
  catalog: Record<string, PhaseCatalogEntry>,
  customPhaseDefs?: Record<string, CustomAiPhase | null>,
): UpstreamSource[] {
  return useMemo(() => {
    // ... unchanged dominator walk above ...

    for (const id of upstream) {
      const n = graph.nodes.find(x => x.id === id);
      if (!n || n.type !== "phase" || !n.phaseType) continue;

      let inputFields: PhaseCatalogEntry["inputFields"] = {};
      let outputSchema: PhaseCatalogEntry["outputSchema"] = {};

      if (n.phaseType === "custom-ai") {
        const customId = (n.config as { customPhaseId?: unknown } | undefined)?.customPhaseId;
        if (typeof customId !== "string" || !customId) continue;
        const def = customPhaseDefs?.[customId];
        if (!def) continue; // loading or missing — contribute nothing
        const shape = customPhaseToShape(def);
        inputFields = shape.inputFields;
        outputSchema = shape.outputSchema ?? {};
      } else {
        const entry = catalog[n.phaseType];
        inputFields = entry?.inputFields ?? {};
        outputSchema = entry?.outputSchema ?? {};
      }

      const groups: UpstreamSource["groups"] = [];
      const inputEntries = Object.entries(inputFields);
      if (inputEntries.length) {
        groups.push({
          title: "Inputs",
          scope: "input",
          fields: inputEntries.map(([name, meta]) => ({
            name,
            description: meta.label,
            scope: "input",
            shape: meta.shape,
          })),
        });
      }
      const outputEntries = Object.entries(outputSchema);
      if (outputEntries.length) {
        groups.push({
          title: "Outputs",
          scope: "output",
          fields: outputEntries.map(([name, s]) => ({
            name,
            description: (s as { description?: string }).description,
            scope: "output",
            shape: s as Shape,
          })),
        });
      }

      sources.push({
        kind: "node",
        id,
        label: n.displayName ?? n.phaseType,
        groups,
      });
    }
    // ... unchanged tail ...
  }, [graph, nodeId, catalog, customPhaseDefs]);
}
```

Keep the rest of the function (dominator walk, run-input source push, timing log) exactly as it was. Add `customPhaseDefs` to the `useMemo` deps as shown.

- [ ] **Step 2: Add a tiny helper next to the hook for callers to extract ids**

Append at the bottom of `use-upstream-sources.ts`:

```ts
/** Collect customPhaseIds referenced by every custom-ai node in the graph. */
export function collectCustomPhaseIds(graph: WorkflowGraph): string[] {
  const set = new Set<string>();
  for (const n of graph.nodes) {
    if (n.type !== "phase" || n.phaseType !== "custom-ai") continue;
    const id = (n.config as { customPhaseId?: unknown } | undefined)?.customPhaseId;
    if (typeof id === "string" && id) set.add(id);
  }
  return [...set];
}
```

---

## Task 4: Wire defs into the three picker call sites

**Files:**
- Modify: `packages/flow-editor/src/properties-panel/IoTab.tsx`
- Modify: `packages/flow-editor/src/properties-panel/ConfigTab.tsx`
- Modify: `packages/flow-editor/src/properties-panel/ControlNodeConfigTab.tsx`

For each of the three files:

- [ ] **Step 1: `IoTab.tsx`** — replace the line `const sources = useUpstreamSources(flow, node.id, catalog);` with:

```tsx
import { useCustomPhaseDefs } from "../catalogs/use-custom-phase-defs.ts";
import { useUpstreamSources, collectCustomPhaseIds } from "./use-upstream-sources.ts";

// ... inside the component, replacing the single-line call:
const customPhaseDefs = useCustomPhaseDefs(collectCustomPhaseIds(flow));
const sources = useUpstreamSources(flow, node.id, catalog, customPhaseDefs);
```

(If the file already imports `useUpstreamSources` from `./use-upstream-sources.ts`, just add `, collectCustomPhaseIds` to the existing import and add the two new lines — keep the other imports alone.)

- [ ] **Step 2: `ConfigTab.tsx`** — same change pattern. The existing call is `const sources = useUpstreamSources(flow, node.id, catalog);`. Replace with the two lines above and add the `useCustomPhaseDefs` + `collectCustomPhaseIds` imports.

- [ ] **Step 3: `ControlNodeConfigTab.tsx`** — same change pattern. The existing call is `const sources = useUpstreamSources(flow, node.id, catalog);`. Replace with the two lines above and add the imports. Leave the `ReturnType<typeof useUpstreamSources>` type alias at the top of the file untouched — it widens automatically.

---

## Task 5: Orchestrator — extend `resolveRefShape`

**Files:**
- Modify: `packages/orchestrator/src/flow-json/validate-ref-shape.ts`

- [ ] **Step 1: Add the `customPhaseDefs` parameter**

Replace the top of the file (imports + types) with:

```ts
import type { WorkflowGraph, WorkflowNode, Shape, OutputSchema, InputFields } from "@journeyman/core";
import { resolveShape, shapeAtPath, shapesEqual, getStartWorkflowInputs } from "@journeyman/core";
import { parseRef } from "./resolve-inputs.ts";

export interface CatalogShapeEntry {
  phaseType: string;
  inputFields: InputFields;
  outputSchema: OutputSchema | null;
}

/** Shape view of a saved custom phase (built via `customPhaseToShape`). */
export interface CustomPhaseShapeEntry {
  inputFields: InputFields;
  outputSchema: OutputSchema | null;
}

interface RefShapeResult {
  ok: boolean;
  shape?: Shape;
  error?: string;
}
```

Replace the entire `resolveRefShape` body with the version below — the only change vs. today is the new `customPhaseDefs` param plus the custom-ai branch:

```ts
export function resolveRefShape(
  flow: WorkflowGraph,
  ref: string,
  catalog: Map<string, CatalogShapeEntry>,
  customPhaseDefs?: Map<string, CustomPhaseShapeEntry>,
): RefShapeResult {
  const parsed = parseRef(ref);
  if (!parsed) return { ok: false, error: `Unparseable ref '${ref}'` };

  const path = parsed.field.split(".");

  if (parsed.scope === "workflow.input") {
    const startNode = flow.nodes.find(n => n.type === "start");
    const workflowInputs = getStartWorkflowInputs(startNode?.config);
    const decl = workflowInputs.find(r => r.name === path[0]);
    if (!decl) return { ok: false, error: `workflow.input.${path[0]} not declared` };
    const root: Shape =
      decl.type === "number" || decl.type === "boolean" || decl.type === "string"
        ? { type: decl.type }
        : { type: "string" };
    const leaf = shapeAtPath(root, path.slice(1));
    return leaf ? { ok: true, shape: leaf } : { ok: false, error: `Path not found: ${ref}` };
  }

  const node = flow.nodes.find(n => n.id === parsed.source);
  if (!node) return { ok: false, error: `Node '${parsed.source}' not found` };
  if (node.type !== "phase" || !node.phaseType) return { ok: false, error: `Node '${parsed.source}' is not a phase` };

  let inputFields: InputFields | undefined;
  let outputSchema: OutputSchema | null | undefined;

  if (node.phaseType === "custom-ai") {
    const customId = (node.config as { customPhaseId?: unknown } | undefined)?.customPhaseId;
    if (typeof customId !== "string" || !customId) {
      return { ok: false, error: `Node '${parsed.source}' has no customPhaseId` };
    }
    const def = customPhaseDefs?.get(customId);
    if (!def) {
      return { ok: false, error: `Custom phase definition not loaded for node '${parsed.source}'` };
    }
    inputFields = def.inputFields;
    outputSchema = def.outputSchema;
  } else {
    const entry = catalog.get(node.phaseType);
    if (!entry) return { ok: false, error: `Unknown phase type '${node.phaseType}'` };
    inputFields = entry.inputFields;
    outputSchema = entry.outputSchema;
  }

  const root: Shape | undefined =
    parsed.scope === "output"
      ? outputSchema?.[path[0]]
      : inputFields?.[path[0]]?.shape;
  if (!root) return { ok: false, error: `Field '${parsed.scope}.${path[0]}' not declared on '${parsed.source}'` };

  const leaf = shapeAtPath(root, path.slice(1));
  return leaf ? { ok: true, shape: leaf } : { ok: false, error: `Path not found: ${ref}` };
}
```

- [ ] **Step 2: Update `validateRefShapeAgainst` to thread the same param**

Replace the `validateRefShapeAgainst` function with:

```ts
export function validateRefShapeAgainst(
  flow: WorkflowGraph,
  ref: string,
  expected: Shape,
  catalog: Map<string, CatalogShapeEntry>,
  customPhaseDefs?: Map<string, CustomPhaseShapeEntry>,
): { ok: boolean; error?: string } {
  const r = resolveRefShape(flow, ref, catalog, customPhaseDefs);
  if (!r.ok || !r.shape) return { ok: false, error: r.error };
  let ok = false;
  try {
    ok = shapesEqual(r.shape, expected);
  } catch (e) {
    return { ok: false, error: `Shape comparison failed: ${(e as Error).message}` };
  }
  if (!ok) {
    return {
      ok: false,
      error: `Ref '${ref}' resolves to shape ${describeShape(r.shape)} but expected ${describeShape(expected)}`,
    };
  }
  return { ok: true };
}
```

Leave `describeShape` and `isPhaseNode` untouched.

---

## Task 6: Orchestrator — thread defs through `ConductorJsonConverter`

**Files:**
- Modify: `packages/orchestrator/src/flow-json/conductor-converter.ts`

- [ ] **Step 1: Update imports and `validateGraph` signature**

Change the existing import line:

```ts
import { validateRefShapeAgainst, type CatalogShapeEntry } from "./validate-ref-shape.ts";
```

to:

```ts
import { validateRefShapeAgainst, type CatalogShapeEntry, type CustomPhaseShapeEntry } from "./validate-ref-shape.ts";
```

Replace `validateGraph`:

```ts
static validateGraph(
  graph: WorkflowGraph,
  catalog?: Map<string, CatalogShapeEntry>,
  customPhaseDefs?: Map<string, CustomPhaseShapeEntry>,
): void {
  new ConvertCtx(graph, catalog, customPhaseDefs).validate();
}
```

- [ ] **Step 2: Update `ConvertCtx` constructor and the validation lookup**

Replace the `ConvertCtx` constructor signature:

```ts
constructor(
  public flow: WorkflowGraph,
  private catalog?: Map<string, CatalogShapeEntry>,
  private customPhaseDefs?: Map<string, CustomPhaseShapeEntry>,
) {
  // body unchanged
  this.nodes = new Map(flow.nodes.map(n => [n.id, n]));
  this.outgoing = new Map();
  for (const e of flow.edges) {
    const arr = this.outgoing.get(e.source) ?? [];
    arr.push(e);
    this.outgoing.set(e.source, arr);
  }
}
```

Inside `validate()` near line ~112, the existing shape-compatibility block reads:

```ts
if (enforceShape && this.catalog && node.type === "phase" && node.phaseType) {
  const entry = this.catalog.get(node.phaseType);
  const expected = entry?.inputFields?.[field]?.shape;
  if (expected) {
    const result = validateRefShapeAgainst(this.flow, ref, expected, this.catalog);
    ...
```

Replace it with a version that resolves the destination node's expected shape from custom-phase defs when applicable, and threads `this.customPhaseDefs` into the call:

```ts
if (enforceShape && this.catalog && node.type === "phase" && node.phaseType) {
  let expected: Shape | undefined;
  if (node.phaseType === "custom-ai") {
    const customId = (node.config as { customPhaseId?: unknown } | undefined)?.customPhaseId;
    const def = typeof customId === "string" && customId ? this.customPhaseDefs?.get(customId) : undefined;
    expected = def?.inputFields?.[field]?.shape;
  } else {
    expected = this.catalog.get(node.phaseType)?.inputFields?.[field]?.shape;
  }
  if (expected) {
    const result = validateRefShapeAgainst(this.flow, ref, expected, this.catalog, this.customPhaseDefs);
    if (!result.ok) {
      throw new WorkflowValidationError(
        `Node '${node.id}' input '${field}': ${result.error}`,
      );
    }
  }
}
```

Add `Shape` to the imports at the top of the file:

```ts
import type { WorkflowEdge, WorkflowGraph, WorkflowNode, IWorkflowJsonConverter, Shape } from "@journeyman/core";
```

`toEngineJson` still calls `new ConvertCtx(def)` — leave it. It runs after `validateGraph` (called from the caller with defs) and skips shape validation when `catalog` is undefined.

---

## Task 7: API server — pre-load custom phase defs at the publish/save paths

**Files:**
- Modify: `packages/api-server/src/routes/flows.ts`

- [ ] **Step 1: Add a helper that builds a `customPhaseDefs` map for a graph**

Near the top of the file (just below the existing imports — keep the existing `loadCustomPhaseInputs` and `getCustomAiPhase` imports intact), add:

```ts
import { customPhaseToShape, type CustomPhaseShape } from "@journeyman/custom-phases";
// `getCustomAiPhase` is already imported elsewhere in this file; reuse it.

async function loadCustomPhaseShapes(
  c: Composition,
  graph: WorkflowGraph,
): Promise<Map<string, CustomPhaseShape>> {
  const map = new Map<string, CustomPhaseShape>();
  if (!c.pool) return map;
  const ids = new Set<string>();
  for (const n of graph.nodes) {
    if (n.type === "phase" && n.phaseType === "custom-ai") {
      const id = (n.config as { customPhaseId?: unknown } | undefined)?.customPhaseId;
      if (typeof id === "string" && id) ids.add(id);
    }
  }
  for (const id of ids) {
    const phase = await getCustomAiPhase(c.pool, id);
    if (phase) map.set(id, customPhaseToShape(phase));
  }
  return map;
}
```

Verify with `grep -n "getCustomAiPhase\|customPhaseToShape" packages/api-server/src/routes/flows.ts` that there is exactly one import line for `getCustomAiPhase` and one for `customPhaseToShape` after this edit. If `getCustomAiPhase` is currently a named import from `@journeyman/custom-phases`, merge `customPhaseToShape` and `CustomPhaseShape` into the same import.

- [ ] **Step 2: Pass the map into `validateGraphStructure`**

Replace the existing `validateGraphStructure` function with an async variant that accepts the pre-built map:

```ts
async function validateGraphStructure(
  c: Composition,
  definition: WorkflowGraph,
  reply: import("fastify").FastifyReply,
): Promise<{ ok: true } | { ok: false }> {
  try {
    const customPhaseDefs = await loadCustomPhaseShapes(c, definition);
    ConductorJsonConverter.validateGraph(definition, undefined, customPhaseDefs);
    return { ok: true };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    reply.code(400).send({
      error: "WorkflowValidationError",
      message,
      errors: [message],
    });
    return { ok: false };
  }
}
```

Note: `validateGraph` currently runs *without* a catalog, so shape validation is skipped on save. To actually surface shape errors at publish, see Step 4 below. This step alone is a structural-only change that keeps existing save-path behavior identical.

- [ ] **Step 3: Update both callers to `await` the new signature**

Locate every call site of `validateGraphStructure(...)` in the file (today: line ~405 and line ~480). Each currently looks like:

```ts
const _v = validateGraphStructure(body.definition as WorkflowGraph, reply);
if (!_v.ok) return;
```

Replace each with:

```ts
const _v = await validateGraphStructure(c, body.definition as WorkflowGraph, reply);
if (!_v.ok) return;
```

Also locate the standalone call at line ~146:

```ts
ConductorJsonConverter.validateGraph(definition);
```

Replace with:

```ts
const customPhaseDefs = await loadCustomPhaseShapes(c, definition);
ConductorJsonConverter.validateGraph(definition, undefined, customPhaseDefs);
```

If that line is inside a non-async function, mark the enclosing function `async` (search nearby for `function` / `async`).

- [ ] **Step 4: Wire defs into the `/workflows/validate` ref-shape path**

`validateGraph` only enforces shapes when a catalog is supplied. The `/workflows/validate` route currently passes shape-validation responsibility to `validateForPublish`. The fix here is narrow: at the same handler, also call `ConductorJsonConverter.validateGraph` *with* the phase catalog plus the new `customPhaseDefs` map, so any custom-phase ref shape errors land in the validation report.

Inside the existing `/workflows/validate` handler (look for `app.post("/workflows/validate"`), right after the existing `loadCustomPhaseInputs` call, add:

```ts
const customPhaseDefs = await loadCustomPhaseShapes(c, body.definition);
const catalogMap = new Map(phaseCatalog.map(p => [
  p.phaseType,
  { phaseType: p.phaseType, inputFields: p.inputFields, outputSchema: p.outputSchema },
]));
try {
  ConductorJsonConverter.validateGraph(body.definition, catalogMap, customPhaseDefs);
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  if (!seenErrors.has(msg)) {
    report.errors.push(msg);
    seenErrors.add(msg);
  }
}
```

Place that block *after* the existing `for (const e of publishResult.errors)` loop so its errors merge into the same `report.errors` array. If `seenErrors` is declared later than the insertion point, move the insertion below its declaration — the variable already exists in this handler.

- [ ] **Step 5: Wire defs into the publish handler**

Locate `app.post("/workflows/:id/publish"` (around line ~520). It currently runs `validateForPublish(version.definition, ...)`. Immediately before that call, add:

```ts
const customPhaseDefs = await loadCustomPhaseShapes(c, version.definition);
const catalogMap = new Map(phaseCatalog.map(p => [
  p.phaseType,
  { phaseType: p.phaseType, inputFields: p.inputFields, outputSchema: p.outputSchema },
]));
ConductorJsonConverter.validateGraph(version.definition, catalogMap, customPhaseDefs);
```

If the line throws, let the surrounding try/catch handle it; if there is no try/catch in that handler, wrap just this call:

```ts
try {
  const customPhaseDefs = await loadCustomPhaseShapes(c, version.definition);
  const catalogMap = new Map(phaseCatalog.map(p => [
    p.phaseType,
    { phaseType: p.phaseType, inputFields: p.inputFields, outputSchema: p.outputSchema },
  ]));
  ConductorJsonConverter.validateGraph(version.definition, catalogMap, customPhaseDefs);
} catch (e) {
  reply.code(400);
  return { error: "WorkflowValidationError", message: e instanceof Error ? e.message : String(e) };
}
```

---

## Task 8: Typecheck

- [ ] **Step 1: Run the workspace typecheck**

Run: `npm run typecheck`

Expected: exit code 0. If any error appears:

- "Cannot find module `@journeyman/custom-phases`" from `flow-editor` — add `"@journeyman/custom-phases": "*"` to `packages/flow-editor/package.json` `dependencies`, then `npm install` from repo root, then re-run.
- "Property 'customPhaseDefs' does not exist on type ..." in any test or call site you missed — search with `grep -rn "validateGraph(\|useUpstreamSources(" packages/` and add the missing argument (`undefined` is fine for callers that don't have defs).
- Any other error — fix in place, re-run.

Do not commit. Stop after typecheck reports zero errors.

---

## Self-Review

- **Spec coverage:**
  - Editor picker enrichment → Tasks 1–4. ✓
  - Publish-time shape validator → Tasks 5–7 step 5. ✓
  - Pre-loading defs at the server caller → Task 7. ✓
  - Runtime worker (unchanged) → noted explicitly in spec; no task needed. ✓
- **Placeholder scan:** none — every code block is complete; the only "search and verify" step is the import-path check in Task 2 Step 2 (deliberate, since `useOrgId` location wasn't pinned).
- **Type consistency:**
  - `CustomPhaseShape` defined in Task 1, re-imported in Task 7. ✓
  - `CustomPhaseShapeEntry` defined in Task 5, imported in Task 6. The two are structurally identical; that is intentional (orchestrator avoids depending on `@journeyman/custom-phases`).
  - `collectCustomPhaseIds` defined in Task 3 Step 2, used in Task 4. ✓
  - `loadCustomPhaseShapes` defined in Task 7 Step 1, used in Steps 2/3/4/5. ✓
- **No tests, no commits:** plan contains neither (per user request).
