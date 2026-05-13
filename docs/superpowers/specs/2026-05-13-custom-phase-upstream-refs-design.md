# Custom AI Phase — Upstream Refs in Picker & Publish Validation

## Problem

A custom AI phase declares typed `inputFields` and an `outputSchema` on its
saved definition. When a downstream node tries to bind a value via the
`ValuePicker`, the upstream custom-phase node contributes **no** input or
output fields to the picker. The same gap exists at publish time: shape
validation rejects any ref to `<customNode>.output.X` or
`<customNode>.input.X` with `"Field not declared"`.

Root cause: both code paths look up the shape catalog by `node.phaseType`.
Every custom-phase node shares one type id (`CUSTOM_AI_PHASE_TYPE`) whose
catalog entry is intentionally stubbed with `inputFields: {}` and
`outputSchema: {}` (`packages/phases/src/catalog.ts:157`). The real shape
lives on the custom phase definition, keyed by `node.config.customPhaseId`.

The runtime worker path is unaffected — Conductor substitutes
`${nodeId.output.X}` against the task's output map produced by
`custom-ai-phase-handler`, which is shape-agnostic.

## Scope

In scope:

- Editor: `ValuePicker` shows a custom-phase upstream node's `Inputs` and
  `Outputs` groups, sourced from the saved definition.
- Publish validation: `resolveRefShape` resolves
  `<customNode>.input.X` and `<customNode>.output.X` against the saved
  definition.
- Wiring: thread a `customPhaseDefs` map through the validator and through
  the editor hook.

Out of scope:

- Snapshotting `inputFields` / `outputSchema` onto node config.
- Reshaping `/api/phases` to emit one row per custom phase.
- Any runtime worker change — already works.
- Surfacing "definition deleted" in the picker — `detectCustomPhaseBreaks`
  already covers it.

## Design

### Editor side

**New hook — `packages/flow-editor/src/catalogs/use-custom-phase-defs.ts`:**

```ts
export function useCustomPhaseDefs(ids: string[]): Record<string, CustomAiPhase>
```

- Module-level `Map<id, Promise<CustomAiPhase | null>>` cache so duplicate
  ids fetch once per editor session.
- Per id: try `/api/orgs/:orgId/users/me/custom-phases/:id` first, fall back
  to `/api/orgs/:orgId/custom-phases/:id` — same pattern as
  `CustomAiConfigForm`.
- Returns the currently-resolved subset; re-renders as fetches land.
- A 404 caches `null` to prevent retry storms; the caller treats `null` as
  "contribute no fields."

**Updated — `packages/flow-editor/src/properties-panel/use-upstream-sources.ts`:**

- New arg: `customPhaseDefs: Record<string, CustomAiPhase | null>`.
- For each upstream node where `phaseType === CUSTOM_AI_PHASE_TYPE`:
  - Read `node.config.customPhaseId`; skip if empty.
  - Look up `customPhaseDefs[id]`; if `undefined` (still loading) or `null`
    (missing), contribute no groups.
  - Otherwise synthesize a `PhaseCatalogEntry`-shaped object with
    `inputFields` and `outputSchema` from the definition and feed the
    existing group-builder.

**Call sites:** the single call site of `useUpstreamSources` extracts every
`customPhaseId` referenced by upstream phase nodes in the graph, passes the
deduped list into `useCustomPhaseDefs`, then passes the resulting map into
`useUpstreamSources`.

### Publish-validation side

**Updated — `packages/orchestrator/src/flow-json/validate-ref-shape.ts`:**

```ts
export interface CustomPhaseDefShape {
  inputFields: InputFields;
  outputSchema: OutputSchema | null;
}

export function resolveRefShape(
  flow: WorkflowGraph,
  ref: string,
  catalog: Map<string, CatalogShapeEntry>,
  customPhaseDefs?: Map<string, CustomPhaseDefShape>,
): RefShapeResult
```

- For a node with `phaseType === CUSTOM_AI_PHASE_TYPE`:
  - Read `node.config.customPhaseId`.
  - Look up `customPhaseDefs?.get(id)`; if missing, return
    `"Custom phase definition not loaded for node '<id>'"` — a callable
    error that points at the server caller, not at the user.
  - Use the def's `inputFields` / `outputSchema` for shape lookup.

**Updated — `packages/orchestrator/src/flow-json/conductor-converter.ts`:**

- `ConductorConverter.validateGraph(graph, catalog?, customPhaseDefs?)` and
  the constructor both gain the new optional param.
- The param is plumbed into the `validateRefShapeAgainst` call.

**Updated — publish route (server-side caller of `validateGraph`).**

- Before calling `validateGraph`, walk `flow.nodes`, collect every
  `customPhaseId` for `CUSTOM_AI_PHASE_TYPE` nodes, load those definitions
  from the DB (user-scope falling back to org-scope, mirroring the editor
  hook), build the `Map<id, CustomPhaseDefShape>`, and pass it in.
- The exact file is cited during the implementation plan.

### Runtime worker

No change. `custom-ai-phase-handler` already emits the structured output as
the task's output map; Conductor substitutes by name.

## Edge cases

- **Definition still loading in editor** → upstream node contributes no
  group; picker re-renders when the fetch lands. Mirrors existing
  `CustomAiConfigForm` loading behavior.
- **Definition 404 in editor** → cached as `null`; no group; one-shot
  `console.warn`. Break-detection handles the user-facing surface.
- **`customPhaseId` empty on a node** → skipped on both sides; no fetch, no
  group, no validation lookup.
- **Same custom phase reused on multiple upstream nodes** → cache dedupes
  the fetch; each node still appears as its own source with its own ref
  prefix.
- **Publish-time def missing** (deleted phase between save and publish) →
  validation fails with a clear `"Custom phase definition not loaded for
  node '<id>'"` error from the server caller's pre-load step.
- **Org vs user scope** → editor hook and server pre-loader both try
  user-scope first then org-scope, matching `CustomAiConfigForm`.

## Test cases

- Picker on a node downstream of a custom-phase node lists declared
  `inputFields` under "Inputs" and `outputSchema` keys under "Outputs" with
  the upstream node's `displayName` as the source label.
- Two upstream custom-phase nodes sharing one definition produce two
  distinct sources with one fetch.
- Custom-phase node with no `customPhaseId` contributes nothing; no fetch
  fires.
- Editor: 404 on the definition contributes nothing; picker stays
  functional.
- Publish validation: a ref `<customNode>.output.someField` validates clean
  when that field is on the definition; fails with a clear error when it
  isn't.
- Publish validation: same for `<customNode>.input.x`.
- Publish validation: deleted custom phase → clear error from the
  pre-loader, not a generic `"Unknown phase type"` from the catalog.

## Files touched

- `packages/flow-editor/src/catalogs/use-custom-phase-defs.ts` (new)
- `packages/flow-editor/src/properties-panel/use-upstream-sources.ts`
- `packages/flow-editor/src/index.ts` (export if needed)
- The single call site of `useUpstreamSources` (cited during plan)
- `packages/orchestrator/src/flow-json/validate-ref-shape.ts`
- `packages/orchestrator/src/flow-json/conductor-converter.ts`
- Publish-path server route that runs `validateGraph` (cited during plan)
