# Flow Data-Flow Contract — Design

**Date:** 2026-04-28
**Status:** Draft, awaiting user review
**Scope:** Sub-project of the visual flow orchestration roadmap. Defines how data produced by one phase reaches another phase (or condition / loop / timer) in a canvas-built flow. Replaces the old `PipelineContext` / `ctx.artifacts` pattern. Sibling specs to follow: canvas→conductor verification (B), human-review-loop node (A).

---

## 1. Goal

In the legacy YAML pipeline, every phase wrote into a single shared `ctx.artifacts` bag and any later phase could read any key. The new canvas-based flow has no equivalent — each phase only sees the static `config` typed into its properties panel. We need a clear, ergonomic contract for "phase B reads phase A's output," usable without manually typing reference paths, and consistent across node configs, edge conditions, loop conditions, and timer expressions.

## 2. Non-goals

- Real-value preview ("E4" / n8n's "run upstream then pick from real output"). Reserved for a later phase once partial-flow execution exists.
- Drag-from-node-handle wiring (E3). Visual-only sugar; not worth its build cost in v1.
- Backward conversion from old YAML `ctx.artifacts` references. Legacy pipeline keeps its own machinery; canvas flows start clean.
- Cross-run data sharing. Bindings only refer to data within a single run.

## 3. Model — M4

Two independent sources of data, both addressable by the same expression syntax:

| Source | Shape | Reference syntax |
|---|---|---|
| **Run inputs** (small shared box, declared per-flow on the `start` node) | flat object set once when the run starts (e.g. `ticketId`, `repoUrl`, `branch`) | `${workflow.input.<key>}` |
| **Upstream node outputs** (the main channel) | each node's `NodeExecution.output` JSONB row | `${<nodeRefName>.output.<field>}` |

These are the only two scopes. There is **no** mutable shared bag. There is **no** edge transformer (M3 rejected).

`<nodeRefName>` is the node's `taskReferenceName` — currently `node.id` ([conductor-converter.ts:119](packages/orchestrator/src/flow-json/conductor-converter.ts:119)). Conductor resolves these references natively at runtime; the converter just emits the strings.

## 4. Saved JSON shape

A new field is added to `FlowNode`:

```ts
interface FlowNode {
  id: string;
  type: FlowNodeType;
  config?: Record<string, unknown>;       // existing — static panel values
  inputs?: Record<string, FlowInputValue>; // NEW — wires from upstream
  // …existing fields unchanged
}

type FlowInputValue =
  | { kind: "literal"; value: unknown }
  | { kind: "ref"; ref: string };          // e.g. "analyze.output.summary"
```

**Why a separate `inputs` field instead of nesting under `config`:**
- `config` stays a flat record of panel values authored by hand; `inputs` is structured data the converter walks to emit Conductor refs.
- Validation becomes trivial — the validator only inspects `inputs`.
- The editor can render the picker on `inputs` entries without parsing through arbitrary `config` shapes.

**Why discriminated union on `FlowInputValue` rather than embedding `${...}` strings in raw values:**
- A `${repoUrl}` string typed by a user as a literal value is unambiguous from a binding.
- The picker always emits `{ kind: "ref", ref: "..." }`. The "custom field…" escape hatch also emits `{ kind: "ref" }` with a hand-typed path.
- Round-trips cleanly through JSONB without quoting hazards.

The existing `NodeInputBinding` type ([flow.types.ts:148](packages/core/src/types/flow.types.ts:148)) is replaced by `FlowInputValue`. It was unused.

## 5. Output schema

Each phase handler declares the shape of its output, co-located with the handler in `packages/phases`:

```ts
// packages/phases/src/ai/analyze.tsx
export const analyzeOutputSchema = {
  summary:        { type: "string",   description: "One-paragraph summary of the change" },
  complexity:     { type: "enum",     values: ["low", "medium", "high"] },
  affectedFiles:  { type: "string[]", description: "Files the change will likely touch" },
} as const;
```

The phase registry exposes `getOutputSchema(phaseType): OutputSchema | null`. The editor fetches schemas via the existing `/phases` catalog endpoint (extended to include `outputSchema` in each entry).

Schemas are **declarative documentation for the picker**. They are not enforced at runtime — a handler may return additional fields. The picker shows declared fields plus a "+ custom field…" entry that lets the user type any path.

## 6. Editor UX — E1 (panel picker)

When the user clicks any input field in a node's properties panel, an `{x}` icon next to the field opens a 2-column picker:

```
┌─ Pick a value ──────────────────────────┐
│ Source              │ Field              │
│ ▸ Run inputs        │ • ticketId         │
│ ▸ analyze (n_a3f1)  │ • summary          │
│ ▸ scan-repos (n_b…) │ • complexity       │
│                     │ • affectedFiles    │
│                     │ + custom field…    │
└─────────────────────────────────────────┘
```

- **Sources column** = `start` node's declared run inputs + every upstream node reachable from the current node along **all** execution paths. Parallel-branch siblings are excluded (see §7).
- **Fields column** = output schema entries for the selected source, plus a `+ custom field…` escape hatch that opens a free-text input.
- Clicking a field stores `{ kind: "ref", ref: "analyze.output.summary" }` in the node's `inputs` map under the field key.
- The picker is also used inside:
  - **Edge condition builder** — for `gateway-xor` / `if` outgoing edges.
  - **Loop condition** — `loop` node's "while" expression.
  - **Timer expression** — `timer` node when waiting on a referenced wall-clock value.

A typeahead variant ("E2 — `{` trigger inline") and real-value picker ("E4") are deferred to later phases. Both are additive to the same data source.

### 6.1 Run inputs declaration

The `start` node gets a new properties panel section: **Run inputs**. The user adds entries with `name`, `type` (`string | number | boolean | json`), `description`, and `required` flag. These appear:

- In the picker under the fixed top entry **Run inputs**.
- In the run-launch UI as a form when triggering a run.
- In the API request schema for `POST /runs` (`inputs: { ticketId: "…", … }`).

Run inputs are stored on the `start` node as `config.runInputs: RunInputDef[]`.

## 7. Validation (flow save)

Three checks run in the converter's existing `validate()` pass before a flow is allowed to save:

1. **Reference target exists.** Every `{ kind: "ref" }` must resolve to either `workflow.input.<key>` (where `<key>` is in `start.config.runInputs`) or `<nodeId>.output.<field>` where `<nodeId>` is a node in the graph. If not → **block save**, error.
2. **Reachability.** The referenced upstream node must execute before the referencing node along **every** path that reaches the referencing node. Implementation: backward graph walk from the referencing node; if any path doesn't pass through the referenced node, the wiring is invalid (the referencing node could run with the upstream output undefined). This rules out cross-branch references after a `gateway-and`. → **block save**, error.
3. **Field declared.** If `<field>` is not in the upstream node's output schema, emit a **non-blocking warning** ("`analyze` does not declare output `xyz` — using as custom field"). Save proceeds. This preserves the escape hatch while nudging schema completeness.

## 8. Runtime resolution

No new runtime machinery. The converter walks each node's `inputs` map and merges resolved values into `inputParameters`:

```ts
inputParameters: {
  ...(node.config ?? {}),
  ...resolveInputs(node.inputs),  // wires win over static config on key collision
  retry: node.retry ?? {},
  credentials: { … },
}
```

If both `config.summary` and `inputs.summary` exist, the bound value wins. The editor surfaces this by greying out the corresponding `config` field once a wire is attached.

Where `resolveInputs` maps each `FlowInputValue`:
- `{ kind: "literal", value }` → `value` verbatim.
- `{ kind: "ref", ref: "analyze.output.summary" }` → `"${analyze.output.summary}"`.
- `{ kind: "ref", ref: "workflow.input.ticketId" }` → `"${workflow.input.ticketId}"`.

Conductor resolves these strings when the task starts. Existing two hardcoded ref usages in the converter ([conductor-converter.ts:172, :222](packages/orchestrator/src/flow-json/conductor-converter.ts:172)) — switch branch and loop iteration — are migrated to use the same resolution path.

### 8.1 PhaseContext additions

`PhaseContext` ([phase-handler.types.ts:16](packages/core/src/types/phase-handler.types.ts:16)) gains one read-only property:

```ts
interface PhaseContext {
  // …existing fields
  runInputs: Record<string, unknown>;  // NEW — frozen copy of workflow.input
}
```

This saves every handler from re-reading `workflow.input` from `inputParameters`. Phase-specific bound inputs continue to arrive flattened on the input object the worker receives — handlers don't need to know whether a value came from `config`, a wire, or a literal.

## 9. Validation of conditions / loops / timers

Edge `condition` JSONLogic expressions and loop `loopCondition` strings reference values via the same logical paths, though the literal syntax differs by surface (JSONLogic uses `{ "var": "<path>" }`; loop/wait Conductor expressions use `${<path>}`). The picker abstracts this — it always emits the right form for the surface being edited. The validator extracts every `{ "var": "<path>" }` (JSONLogic) or `${<path>}` (loop/wait expression) and applies the same three checks from §7. Conditions on edges out of node X may reference X's own output (the just-completed node) and any node upstream of X.

## 10. Migration

Existing flows in the database have no `inputs` field. They keep working: missing → empty map → only `config` flows into `inputParameters`, matching today's behavior. New picker-based bindings are purely additive. No DB migration required beyond a JSONB schema note.

The `outputSchema` rollout happens phase-by-phase. Phases without a declared schema show only the `+ custom field…` entry in the picker — usable but unguided.

## 11. Out of scope (handled in sibling specs)

- **Verification of canvas→conductor end-to-end** with the three example products — *Spec B*.
- **Human-review-loop node** (replacement for legacy `reviewLabels` + webhook resume) — *Spec A*. It will use this data contract: a `human-task` node consumes upstream outputs as the "what to review" payload and produces a structured output (`{ decision, reviewerComment, reviewerUserId }`) consumable by downstream nodes through the same picker.

## 12. Open questions

None at time of writing.
