# If/Else Gate — Real Condition Evaluation

**Date:** 2026-05-06
**Status:** Approved design
**Scope:** Make `gateway-xor` (a.k.a. `if`) nodes evaluate real conditions at runtime, replacing the current stub that reads `${workflow.input.branch}`.

## 1. Overview

Today the converter at `packages/orchestrator/src/flow-json/conductor-converter.ts:214-248` emits a Conductor `SWITCH` whose `evaluatorType` is `"value-param"` reading `${workflow.input.branch}`. The graph topology and convergence are correct; only the decision is hardcoded.

This design wires the existing `FlowEdge.condition` (JsonLogic) through to Conductor's `javascript` SWITCH evaluator and adds an edge inspector in the flow editor for authoring conditions with autosuggest backed by upstream phase output schemas.

**In scope**
- Type `FlowEdge.condition` as a `JsonLogicExpr` union in `@journeyman/core`.
- Compile JsonLogic to a JS expression for Conductor's `evaluatorType: "javascript"`.
- Replace `emitSwitch` to emit a real SWITCH task and validate edges at convert time.
- Edge inspector UI with row-builder condition editor and autosuggest.

**Out of scope (v1)**
- Loop conditions (`gateway-xor` only; `loop` node has its own path).
- Sharing a compiled expression across multiple gateways.
- Server-side evaluation outside Conductor.
- Schema-type-checking the condition against the upstream output (we surface paths and types in autosuggest but do not block on mismatch).
- Operators beyond the v1 set (regex, arithmetic, string ops).

## 2. Data Model

New file `packages/core/src/types/flow-condition.types.ts`:

```ts
export type JsonLogicVar     = { var: string };
export type JsonLogicLiteral = string | number | boolean | null;
export type JsonLogicExpr =
  | JsonLogicLiteral
  | JsonLogicVar
  | { "==":  [JsonLogicExpr, JsonLogicExpr] }
  | { "!=":  [JsonLogicExpr, JsonLogicExpr] }
  | { "<":   [JsonLogicExpr, JsonLogicExpr] }
  | { "<=":  [JsonLogicExpr, JsonLogicExpr] }
  | { ">":   [JsonLogicExpr, JsonLogicExpr] }
  | { ">=":  [JsonLogicExpr, JsonLogicExpr] }
  | { "and": JsonLogicExpr[] }
  | { "or":  JsonLogicExpr[] }
  | { "!":   JsonLogicExpr }
  | { "in":  [JsonLogicExpr, JsonLogicExpr] };
```

Update `flow.types.ts:79`: `condition?: JsonLogicExpr` (was `unknown`). `branchLabel` and `type: "else" | "conditional"` are unchanged. `else` edges carry no condition.

Operator set rationale: covers true/false, numeric thresholds, string equality, set membership, and boolean composition — the conditions users actually need at this layer. Anything more is purely additive in a later version.

## 3. JsonLogic → JS Compiler

New file `packages/orchestrator/src/flow-json/jsonlogic-to-js.ts`. Pure, no deps.

```ts
export function compileJsonLogic(expr: JsonLogicExpr): {
  js: string;            // a JS expression fragment
  roots: Set<string>;    // top-level identifiers referenced via `var`
};

export function compileSwitchExpression(edges: FlowEdge[]): {
  expression: string;
  inputParameters: Record<string, string>;
};
```

### Operator mapping

| JsonLogic | JS fragment |
|---|---|
| Literal `5`, `"x"`, `true`, `null` | `JSON.stringify(value)` |
| `{ var: "phase1.output.score" }` | `$.phase1.output.score` (root added to `roots`) |
| `{ "==": [a, b] }` | `(<a> === <b>)` |
| `{ "!=": [a, b] }` | `(<a> !== <b>)` |
| `{ "<": [a, b] }` etc. | `(<a> < <b>)` |
| `{ "and": [a, b, c] }` | `(<a> && <b> && <c>)` |
| `{ "or":  [a, b] }` | `(<a> \|\| <b>)` |
| `{ "!": a }` | `(!<a>)` |
| `{ "in": [a, b] }` | `(<b>.includes(<a>))` |

### Variable resolution

Conductor's JS evaluator receives `inputParameters` as a single object bound to `$`. The compiler collects every root identifier referenced via `var` and the converter builds `inputParameters` from that set:

- Root `phase1` (from any `phase1.*` var) → `inputParameters.phase1 = "${phase1.output}"`. The expression accesses `$.phase1.score` (the `output.` segment is folded into the parameter binding).
- Root `workflow` (from any `workflow.input.*` var) → `inputParameters.workflow = "${workflow.input}"`. Accessed as `$.workflow.flowId`.

The compiler treats `var` paths in two normalized forms:
- `<phaseId>.output.<rest>` → fragment `$.<phaseId>.<rest>`, root `<phaseId>`, parameter binding `${<phaseId>.output}`.
- `workflow.input.<rest>` → fragment `$.workflow.<rest>`, root `workflow`, parameter binding `${workflow.input}`.
- Anything else → validation error (see §4).

### Switch expression

`compileSwitchExpression` chains conditional edges in source order into a ternary, ending in `"default"`:

```js
$.phase1 && $.phase1.score > 0.8 ? "high"   :
$.phase1 && $.phase1.score > 0.5 ? "medium" :
"default"
```

The `$.<root> &&` guards prevent runtime errors when a referenced upstream task was skipped. The `else` edge maps to `"default"`. If only an else edge exists, the expression is the literal `'"default"'`.

## 4. Conductor SWITCH Emission

Replace `emitSwitch` in `conductor-converter.ts:214-248`:

```ts
emitSwitch(node: FlowNode) {
  const outs = this.outsOf(node.id);
  if (outs.length === 0) {
    throw new FlowValidationError(`Switch '${node.id}' has no outgoing edges`);
  }
  const conditional = outs.filter(e => e.type === "conditional");
  const elseEdge    = outs.find(e => e.type === "else");

  const branchTargets = outs.map(e => e.target);
  const convergence   = findConvergence(branchTargets, this);
  const stopAt        = convergence ? new Set([convergence]) : undefined;

  const cases: Record<string, ConductorTaskDef[]> = {};
  for (const e of conditional) {
    const label = e.branchLabel!;
    cases[label] = this.buildSequence(e.target, stopAt);
  }
  const defaultCase = elseEdge ? this.buildSequence(elseEdge.target, stopAt) : undefined;

  const { expression, inputParameters } = compileSwitchExpression(conditional);

  const task: SwitchTask = {
    type: "SWITCH",
    name: `switch_${node.id}`,
    taskReferenceName: node.id,
    evaluatorType: "javascript",
    expression,
    inputParameters,
    decisionCases: cases,
    ...(defaultCase ? { defaultCase } : {}),
  };
  return { tasks: [task], nextNodeId: convergence };
}
```

The placeholder helper `jsonLogicToString` (`conductor-converter.ts:372`) is removed.

### Validation (convert time)

All produce `FlowValidationError`:

- Conditional edge missing `condition` → `Edge ${id} is conditional but has no condition`.
- Conditional edge missing `branchLabel` → `Edge ${id} requires a branchLabel`.
- Two conditional edges from the same gateway share a `branchLabel` → `Duplicate branchLabel '${label}' on gateway '${id}'`.
- A `var` path's root does not match any predecessor `nodeId` reachable by backward graph walk and is not `workflow.input.*` → `Unknown variable '${path}' on edge '${id}'`.
- A `var` path is neither in `<phaseId>.output.<rest>` nor `workflow.input.<rest>` form → `Unsupported variable shape '${path}'`.

## 5. Flow Editor — Edge Inspector

A right-side inspector that opens when an edge from a `gateway-xor` is selected. Other edges keep current behavior (no inspector).

### New files

- `packages/flow-editor/src/inspector/EdgeInspector.tsx`
- `packages/flow-editor/src/inspector/ConditionBuilder.tsx`
- `packages/flow-editor/src/inspector/condition-suggestions.ts`

### Modified

- `packages/flow-editor/src/canvas/Canvas.tsx` — wire edge selection to the inspector slot.
- `packages/flow-editor/src/state/validation.ts` — extend with the rules from §4 mirrored client-side.

### Layout

Branch label input, type toggle (`conditional` vs `else`), and a row-builder condition editor. Each row is `{ var, op, value }` rendering to `{ "<op>": [{ "var": var }, value] }`. Rows join with the group's connector (`and` / `or`); one outer level only. A "show JSON" toggle reveals the underlying JsonLogic for power users (read-only initially; raw edit deferred unless requested).

### Autosuggest

When the LHS dropdown opens, the suggestion list is built from:

1. **Upstream phases** — backward graph walk from the gateway via incoming edges. XOR/AND nodes are passed through (their predecessors are still considered). For each reachable phase node, read its `outputSchema` from the phases catalog (`packages/phases/src/catalog.ts:113`) and emit one entry per leaf field as `<phaseId>.output.<fieldPath>` along with the field's JSON Schema type.
2. **Workflow input** — constant list exposed from `@journeyman/core`: `workflow.input.startedByUserId`, `workflow.input.startedByOrgId`, `workflow.input.flowId`.
3. **Literal RHS** — value-input widget chosen by the LHS field's type: number → numeric input, string enum → select, boolean → toggle, free string → text input.

Entries are grouped (`From phase1`, `Workflow input`) and filterable by typing.

### Live validation in the panel

- Empty branch label → blocking error.
- LHS not selected on a row → blocking error.
- Duplicate label among sibling edges of the same gateway → warning surfaced on save.
- Validation re-runs on every change and again before the flow JSON is persisted.

## 6. Testing

Vitest, colocated with each module. No new test infrastructure.

| Module | Tests |
|---|---|
| `jsonlogic-to-js.compileJsonLogic` | Each operator compiles to expected JS. Nested `and`/`or`. `var` paths produce `$.<root>.<rest>`. Root collection returns the right set. Literal types preserved. |
| `jsonlogic-to-js.compileSwitchExpression` | Two conditions chain into a ternary in source order. `else` becomes the trailing `"default"`. `inputParameters` match the union of collected roots. Only-else case yields the literal `"default"`. |
| `conductor-converter.emitSwitch` | SWITCH task shape: `evaluatorType: "javascript"`, `decisionCases` keyed by `branchLabel`, `defaultCase` only when an else edge exists. Convergence stop-at honored. |
| `conductor-converter.emitSwitch` validation | Conditional edge without condition / without branchLabel / duplicate label / unknown var root / malformed var path all raise `FlowValidationError` with the message text in §4. |
| `condition-suggestions` | Backward graph walk traverses through XOR/AND. Output-schema flattening produces dot paths with correct types. Workflow input entries always present. |

**Integration test** (orchestrator): fixture flow `start → phaseA → xor → (phaseB | phaseC | else: phaseD) → end`. Convert to Conductor JSON, snapshot the SWITCH task, assert the JS expression and `inputParameters` exactly.

**Manual smoke** (post-implementation, not in CI): build a flow in the editor using a conditional XOR, run it through the orchestrator, confirm Conductor picks the branch matching real `phaseA` output.

## 7. Files Touched (summary)

**New**
- `packages/core/src/types/flow-condition.types.ts`
- `packages/orchestrator/src/flow-json/jsonlogic-to-js.ts`
- `packages/flow-editor/src/inspector/EdgeInspector.tsx`
- `packages/flow-editor/src/inspector/ConditionBuilder.tsx`
- `packages/flow-editor/src/inspector/condition-suggestions.ts`

**Modified**
- `packages/core/src/types/flow.types.ts` — tighten `FlowEdge.condition` to `JsonLogicExpr`.
- `packages/core/src/index.ts` — re-export new types and `WORKFLOW_INPUT_SUGGESTIONS` constant.
- `packages/orchestrator/src/flow-json/conductor-converter.ts` — replace `emitSwitch`, remove `jsonLogicToString`.
- `packages/flow-editor/src/canvas/Canvas.tsx` — edge-selected → inspector slot.
- `packages/flow-editor/src/state/validation.ts` — mirror convert-time rules client-side.

## 8. Migration

`FlowEdge.condition` was typed `unknown`; existing flows store either `undefined` or pre-existing JsonLogic-shaped values. A one-time read-time validation runs when a flow is loaded into the editor: any `condition` that does not parse as `JsonLogicExpr` is dropped and the edge is flagged as needing re-authoring (warning, not blocking — same channel used for the existing legacy `config.mcp` strip).
