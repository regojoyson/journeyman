# If/Else Gate — Real Condition Evaluation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `gateway-xor` (a.k.a. `if`) nodes evaluate real JsonLogic conditions at runtime by compiling them to a Conductor `SWITCH` task with `evaluatorType: "javascript"`, and let users author those conditions in the flow editor with autosuggest.

**Architecture:** Edges already carry `condition?: unknown` and a `branchLabel`. We tighten the type to a `JsonLogicExpr` union, write a small pure compiler from JsonLogic to a JS expression for Conductor's JS evaluator, replace the placeholder `emitSwitch` so the JS expression and `inputParameters` flow through, and add a right-side edge inspector with a row-builder UI driven by upstream phase output schemas.

**Tech Stack:** TypeScript, npm workspaces, React + @xyflow/react (flow editor), Conductor (orchestrator output format).

**Constraints (per user):**
- **No unit tests** in this plan — verification is end-of-plan typecheck only.
- **No commits** during the plan.
- **Final step is `npm run typecheck` across the workspace.**

**Spec:** `docs/superpowers/specs/2026-05-06-if-else-gate-real-evaluation-design.md`

---

## File Structure

**New**
- `packages/core/src/types/flow-condition.types.ts` — `JsonLogicExpr` union, `WORKFLOW_INPUT_SUGGESTIONS` constant.
- `packages/orchestrator/src/flow-json/jsonlogic-to-js.ts` — `compileJsonLogic`, `compileSwitchExpression`.
- `packages/flow-editor/src/inspector/EdgeInspector.tsx` — right-side inspector for selected edge.
- `packages/flow-editor/src/inspector/ConditionBuilder.tsx` — row-builder + JSON view.
- `packages/flow-editor/src/inspector/condition-suggestions.ts` — backward graph walk → suggestion list.

**Modified**
- `packages/core/src/types/flow.types.ts` — `FlowEdge.condition?: JsonLogicExpr`.
- `packages/core/src/index.ts` — re-export new types and constant.
- `packages/orchestrator/src/flow-json/conductor-converter.ts` — replace `emitSwitch`, remove `jsonLogicToString`.
- `packages/flow-editor/src/state/useFlowEditorState.ts` — add `selectedEdgeId` state.
- `packages/flow-editor/src/FlowEditor.tsx` — wire edge selection to inspector slot.
- `packages/flow-editor/src/canvas/Canvas.tsx` — call `onEdgeSelect` from React Flow's `onEdgeClick`.
- `packages/flow-editor/src/state/validation.ts` — mirror convert-time edge rules client-side.
- `packages/flow-editor/src/api/*` (load path) — strip `condition` if it doesn't parse as `JsonLogicExpr` (migration).

---

### Task 1: Add JsonLogic types and workflow input constant

**Files:**
- Create: `packages/core/src/types/flow-condition.types.ts`

- [ ] **Step 1: Create the new types file**

```ts
// packages/core/src/types/flow-condition.types.ts

/**
 * JsonLogic subset used by gateway-xor edge conditions.
 * Compiled to JS by orchestrator's jsonlogic-to-js for Conductor's
 * SWITCH evaluatorType: "javascript".
 */
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

/**
 * Static workflow.input.* suggestions surfaced in the edge condition
 * autosuggest. Mirrors the keys orchestrator's emitPhase always injects
 * onto every task's input.
 */
export const WORKFLOW_INPUT_SUGGESTIONS: ReadonlyArray<{
  path: string;
  type: "string";
}> = [
  { path: "workflow.input.startedByUserId", type: "string" },
  { path: "workflow.input.startedByOrgId",  type: "string" },
  { path: "workflow.input.flowId",          type: "string" },
];

/**
 * Returns true when `value` matches the JsonLogicExpr shape.
 * Used at flow-load time to drop unparseable legacy conditions.
 */
export function isJsonLogicExpr(value: unknown): value is JsonLogicExpr {
  if (value === null) return true;
  const t = typeof value;
  if (t === "string" || t === "number" || t === "boolean") return true;
  if (t !== "object") return false;

  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj);
  if (keys.length !== 1) return false;
  const op = keys[0]!;

  if (op === "var") return typeof obj.var === "string";

  const arg = obj[op];

  switch (op) {
    case "==": case "!=": case "<": case "<=": case ">": case ">=": case "in":
      return Array.isArray(arg) && arg.length === 2 &&
             isJsonLogicExpr(arg[0]) && isJsonLogicExpr(arg[1]);
    case "and": case "or":
      return Array.isArray(arg) && arg.every(isJsonLogicExpr);
    case "!":
      return isJsonLogicExpr(arg);
    default:
      return false;
  }
}
```

---

### Task 2: Tighten FlowEdge.condition and re-export

**Files:**
- Modify: `packages/core/src/types/flow.types.ts:79`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Replace `condition?: unknown` with the typed union**

In `packages/core/src/types/flow.types.ts`, add an import at the top of the file (after existing imports):

```ts
import type { JsonLogicExpr } from "./flow-condition.types.ts";
```

Then change the `FlowEdge` interface:

```ts
export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  type?: FlowEdgeType;
  /** JSONLogic expression — applies when type === "conditional". */
  condition?: JsonLogicExpr;
  /** Reserved — labels for "then" / "else" outputs of the `if` node. */
  label?: string;
  /** SWITCH branch label — used when type === "conditional" on a gateway-xor or `if`. */
  branchLabel?: string;
}
```

- [ ] **Step 2: Re-export from `@journeyman/core`**

In `packages/core/src/index.ts`, append after the existing flow.types re-export block (around line 91):

```ts
export type {
  JsonLogicExpr, JsonLogicVar, JsonLogicLiteral,
} from "./types/flow-condition.types.ts";
export {
  WORKFLOW_INPUT_SUGGESTIONS,
  isJsonLogicExpr,
} from "./types/flow-condition.types.ts";
```

---

### Task 3: Implement the JsonLogic → JS compiler

**Files:**
- Create: `packages/orchestrator/src/flow-json/jsonlogic-to-js.ts`

- [ ] **Step 1: Write the compiler**

```ts
// packages/orchestrator/src/flow-json/jsonlogic-to-js.ts

import type { JsonLogicExpr, FlowEdge } from "@journeyman/core";

const PHASE_PATH    = /^([A-Za-z_][\w-]*)\.output(?:\.(.+))?$/;
const WORKFLOW_PATH = /^workflow\.input(?:\.(.+))?$/;

export interface CompileResult {
  js: string;
  /** Top-level identifiers referenced via `var`. */
  roots: Set<string>;
}

export function compileJsonLogic(expr: JsonLogicExpr): CompileResult {
  const roots = new Set<string>();
  const js = walk(expr, roots);
  return { js, roots };
}

function walk(expr: JsonLogicExpr, roots: Set<string>): string {
  if (expr === null || typeof expr !== "object") {
    return JSON.stringify(expr);
  }

  if ("var" in expr) {
    const path = expr.var;
    const phase = path.match(PHASE_PATH);
    if (phase) {
      const [, root, rest] = phase;
      roots.add(root!);
      return rest ? `$.${root}.${rest}` : `$.${root}`;
    }
    const wf = path.match(WORKFLOW_PATH);
    if (wf) {
      const [, rest] = wf;
      roots.add("workflow");
      return rest ? `$.workflow.${rest}` : `$.workflow`;
    }
    throw new Error(`Unsupported variable shape '${path}'`);
  }

  const keys = Object.keys(expr) as Array<keyof typeof expr>;
  if (keys.length !== 1) throw new Error(`JsonLogic op object must have exactly one key, got: ${keys.join(",")}`);
  const op = keys[0] as string;
  const arg = (expr as Record<string, unknown>)[op];

  switch (op) {
    case "==":  return binary(arg, roots, "===");
    case "!=":  return binary(arg, roots, "!==");
    case "<":
    case "<=":
    case ">":
    case ">=": return binary(arg, roots, op);
    case "and":
    case "or": return varargs(arg, roots, op === "and" ? "&&" : "||");
    case "!":  return `(!${walk(arg as JsonLogicExpr, roots)})`;
    case "in": {
      const [a, b] = arg as [JsonLogicExpr, JsonLogicExpr];
      return `(${walk(b, roots)}.includes(${walk(a, roots)}))`;
    }
    default:
      throw new Error(`Unsupported JsonLogic operator '${op}'`);
  }
}

function binary(arg: unknown, roots: Set<string>, jsOp: string): string {
  if (!Array.isArray(arg) || arg.length !== 2) throw new Error(`Operator expects 2 args`);
  return `(${walk(arg[0] as JsonLogicExpr, roots)} ${jsOp} ${walk(arg[1] as JsonLogicExpr, roots)})`;
}

function varargs(arg: unknown, roots: Set<string>, jsOp: string): string {
  if (!Array.isArray(arg) || arg.length === 0) throw new Error(`and/or expects a non-empty array`);
  return `(${arg.map(a => walk(a as JsonLogicExpr, roots)).join(` ${jsOp} `)})`;
}

/**
 * Compile an ordered list of conditional edges into a chained ternary
 * for Conductor's SWITCH `expression`, plus the `inputParameters` map
 * needed to make the referenced roots reachable as `$.<root>`.
 */
export function compileSwitchExpression(edges: FlowEdge[]): {
  expression: string;
  inputParameters: Record<string, string>;
} {
  if (edges.length === 0) {
    return { expression: `"default"`, inputParameters: {} };
  }

  const allRoots = new Set<string>();
  const fragments: Array<{ js: string; label: string }> = [];

  for (const e of edges) {
    if (e.condition === undefined) {
      throw new Error(`Edge ${e.id} is conditional but has no condition`);
    }
    if (!e.branchLabel) {
      throw new Error(`Edge ${e.id} requires a branchLabel`);
    }
    const { js, roots } = compileJsonLogic(e.condition);
    for (const r of roots) allRoots.add(r);
    fragments.push({ js, label: e.branchLabel });
  }

  // Wrap each fragment with optional-chain guards on every referenced root.
  const guarded = edges.map((e, i) => {
    const { roots } = compileJsonLogic(e.condition!);
    const guard = [...roots].map(r => `$.${r}`).join(" && ");
    const cond = guard ? `${guard} && ${fragments[i]!.js}` : fragments[i]!.js;
    return `${cond} ? ${JSON.stringify(fragments[i]!.label)}`;
  });

  const expression = `${guarded.join(" : ")} : "default"`;

  const inputParameters: Record<string, string> = {};
  for (const root of allRoots) {
    inputParameters[root] = root === "workflow"
      ? "${workflow.input}"
      : `\${${root}.output}`;
  }

  return { expression, inputParameters };
}
```

---

### Task 4: Replace `emitSwitch` and remove placeholder

**Files:**
- Modify: `packages/orchestrator/src/flow-json/conductor-converter.ts:214-248` (emitSwitch)
- Modify: `packages/orchestrator/src/flow-json/conductor-converter.ts:372` (remove `jsonLogicToString`)

- [ ] **Step 1: Add the import at the top of conductor-converter.ts**

After the existing imports, add:

```ts
import { compileSwitchExpression } from "./jsonlogic-to-js.ts";
```

- [ ] **Step 2: Replace the body of `emitSwitch`**

Replace the entire `emitSwitch` method (currently lines 214-248) with:

```ts
  emitSwitch(node: FlowNode): { tasks: ConductorTaskDef[]; nextNodeId: string | null } {
    const outs = this.outsOf(node.id);
    if (outs.length === 0) {
      throw new FlowValidationError(`Switch '${node.id}' has no outgoing edges`);
    }

    const conditional = outs.filter(e => e.type === "conditional");
    const elseEdge    = outs.find(e => e.type === "else");

    // Validate edges before compiling so error messages are flow-shaped.
    const seenLabels = new Set<string>();
    for (const e of conditional) {
      if (e.condition === undefined) {
        throw new FlowValidationError(`Edge ${e.id} on gateway '${node.id}' is conditional but has no condition`);
      }
      if (!e.branchLabel) {
        throw new FlowValidationError(`Edge ${e.id} on gateway '${node.id}' requires a branchLabel`);
      }
      if (seenLabels.has(e.branchLabel)) {
        throw new FlowValidationError(`Duplicate branchLabel '${e.branchLabel}' on gateway '${node.id}'`);
      }
      seenLabels.add(e.branchLabel);
    }

    const branchTargets = outs.map(e => e.target);
    const convergence   = findConvergence(branchTargets, this);
    const stopAt        = convergence ? new Set([convergence]) : undefined;

    const cases: Record<string, ConductorTaskDef[]> = {};
    for (const e of conditional) {
      cases[e.branchLabel!] = this.buildSequence(e.target, stopAt);
    }
    const defaultCase = elseEdge ? this.buildSequence(elseEdge.target, stopAt) : undefined;

    let expression: string;
    let inputParameters: Record<string, string>;
    try {
      ({ expression, inputParameters } = compileSwitchExpression(conditional));
    } catch (err) {
      throw new FlowValidationError(
        `Failed to compile conditions on gateway '${node.id}': ${(err as Error).message}`,
      );
    }

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

- [ ] **Step 3: Delete the `jsonLogicToString` helper**

Remove the function defined at `conductor-converter.ts:372`:

```ts
function jsonLogicToString(expr: unknown): string {
  if (expr == null) return "case";
  try { return JSON.stringify(expr).slice(0, 32); } catch { return "case"; }
}
```

It is no longer referenced (the previous user inside `emitSwitch` is gone after Step 2).

---

### Task 5: Predecessor / output-schema suggestion source

**Files:**
- Create: `packages/flow-editor/src/inspector/condition-suggestions.ts`

- [ ] **Step 1: Implement the suggestion builder**

```ts
// packages/flow-editor/src/inspector/condition-suggestions.ts

import type { FlowGraph, FlowNode, OutputSchema } from "@journeyman/core";
import { WORKFLOW_INPUT_SUGGESTIONS } from "@journeyman/core";

export interface ConditionSuggestion {
  /** Full var path used in JsonLogic, e.g. "phase1.output.score". */
  path: string;
  /** Display group: phase id, or "Workflow input". */
  group: string;
  /** JSON Schema "type" of the leaf, when known. */
  type?: "string" | "number" | "boolean" | "object" | "array" | "null";
}

export interface CatalogLookup {
  outputSchemaFor(phaseType: string): OutputSchema | null;
}

/**
 * Build the autosuggest list for a condition LHS attached to an edge that
 * leaves the gateway node identified by `gatewayId`.
 *
 * Walks predecessors backward (transparently through gateway-xor / gateway-and
 * nodes) and emits one entry per leaf field of each reachable phase's
 * outputSchema, plus the static workflow.input.* entries.
 */
export function buildConditionSuggestions(
  flow: FlowGraph,
  gatewayId: string,
  catalog: CatalogLookup,
): ConditionSuggestion[] {
  const phaseIds = collectUpstreamPhases(flow, gatewayId);

  const out: ConditionSuggestion[] = [];

  for (const phaseId of phaseIds) {
    const node = flow.nodes.find(n => n.id === phaseId);
    if (!node?.phaseType) continue;
    const schema = catalog.outputSchemaFor(node.phaseType);
    if (!schema) continue;
    for (const leaf of flattenSchema(schema)) {
      out.push({
        path: `${phaseId}.output.${leaf.path}`,
        group: phaseId,
        type: leaf.type,
      });
    }
  }

  for (const w of WORKFLOW_INPUT_SUGGESTIONS) {
    out.push({ path: w.path, group: "Workflow input", type: w.type });
  }

  return out;
}

function collectUpstreamPhases(flow: FlowGraph, gatewayId: string): string[] {
  const incoming = new Map<string, string[]>();
  for (const e of flow.edges) {
    const arr = incoming.get(e.target) ?? [];
    arr.push(e.source);
    incoming.set(e.target, arr);
  }

  const seen = new Set<string>();
  const phases: string[] = [];
  const stack = [...(incoming.get(gatewayId) ?? [])];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const node = flow.nodes.find(n => n.id === id);
    if (!node) continue;
    if (node.type === "phase") phases.push(id);
    // Pass through gateways and other control nodes.
    for (const pred of incoming.get(id) ?? []) stack.push(pred);
  }
  // Reverse so closest predecessors render first.
  return phases.reverse();
}

interface Leaf {
  path: string;
  type?: ConditionSuggestion["type"];
}

function flattenSchema(schema: OutputSchema, prefix = ""): Leaf[] {
  // OutputSchema is a JSON Schema-shaped object: { type, properties?, items?, ... }.
  // Treat object/array containers as branches; everything else as a leaf.
  const leaves: Leaf[] = [];
  const t = (schema as { type?: string }).type;

  if (t === "object" && (schema as { properties?: Record<string, OutputSchema> }).properties) {
    const props = (schema as { properties: Record<string, OutputSchema> }).properties;
    for (const [key, sub] of Object.entries(props)) {
      const next = prefix ? `${prefix}.${key}` : key;
      leaves.push(...flattenSchema(sub, next));
    }
    return leaves;
  }

  if (t === "string" || t === "number" || t === "boolean" || t === "object" || t === "array" || t === "null") {
    leaves.push({ path: prefix || "(root)", type: t });
    return leaves;
  }

  // Unknown / untyped schema — still surface the path as an opaque leaf.
  leaves.push({ path: prefix || "(root)" });
  return leaves;
}
```

---

### Task 6: ConditionBuilder UI

**Files:**
- Create: `packages/flow-editor/src/inspector/ConditionBuilder.tsx`

- [ ] **Step 1: Implement the row-builder + JSON view**

```tsx
// packages/flow-editor/src/inspector/ConditionBuilder.tsx

import { useMemo, useState } from "react";
import type { JsonLogicExpr } from "@journeyman/core";
import type { ConditionSuggestion } from "./condition-suggestions.ts";

type Op = "==" | "!=" | "<" | "<=" | ">" | ">=" | "in";
type Connector = "and" | "or";

interface Row {
  varPath: string;
  op: Op;
  value: string; // user enters as text; coerced based on suggestion.type
}

interface Props {
  value: JsonLogicExpr | undefined;
  suggestions: ConditionSuggestion[];
  onChange: (expr: JsonLogicExpr | undefined) => void;
}

export function ConditionBuilder({ value, suggestions, onChange }: Props) {
  const [showJson, setShowJson] = useState(false);

  const initial = useMemo(() => exprToRows(value), [value]);
  const [connector, setConnector] = useState<Connector>(initial.connector);
  const [rows, setRows] = useState<Row[]>(initial.rows);

  function commit(nextRows: Row[], nextConnector: Connector) {
    setRows(nextRows);
    setConnector(nextConnector);
    onChange(rowsToExpr(nextRows, nextConnector, suggestions));
  }

  return (
    <div className="je-condition-builder">
      {showJson ? (
        <pre className="je-condition-builder__json">
          {JSON.stringify(value ?? null, null, 2)}
        </pre>
      ) : (
        <>
          <div className="je-condition-builder__connector">
            <label>
              <input
                type="radio"
                name="connector"
                checked={connector === "and"}
                onChange={() => commit(rows, "and")}
              />
              AND
            </label>
            <label>
              <input
                type="radio"
                name="connector"
                checked={connector === "or"}
                onChange={() => commit(rows, "or")}
              />
              OR
            </label>
          </div>
          {rows.map((r, i) => (
            <RowEditor
              key={i}
              row={r}
              suggestions={suggestions}
              onChange={(nr) => {
                const next = rows.slice();
                next[i] = nr;
                commit(next, connector);
              }}
              onRemove={() => commit(rows.filter((_, j) => j !== i), connector)}
            />
          ))}
          <button
            type="button"
            onClick={() => commit([...rows, { varPath: "", op: "==", value: "" }], connector)}
          >
            + Add row
          </button>
        </>
      )}
      <button
        type="button"
        className="je-condition-builder__toggle"
        onClick={() => setShowJson(s => !s)}
      >
        {showJson ? "Hide JSON" : "Show JSON"}
      </button>
    </div>
  );
}

function RowEditor(p: {
  row: Row;
  suggestions: ConditionSuggestion[];
  onChange: (r: Row) => void;
  onRemove: () => void;
}) {
  const grouped = useMemo(() => {
    const g: Record<string, ConditionSuggestion[]> = {};
    for (const s of p.suggestions) (g[s.group] ??= []).push(s);
    return g;
  }, [p.suggestions]);

  const selected = p.suggestions.find(s => s.path === p.row.varPath);

  return (
    <div className="je-condition-row">
      <select
        value={p.row.varPath}
        onChange={(e) => p.onChange({ ...p.row, varPath: e.target.value })}
      >
        <option value="">— pick a value —</option>
        {Object.entries(grouped).map(([group, items]) => (
          <optgroup key={group} label={group}>
            {items.map(s => (
              <option key={s.path} value={s.path}>{s.path}</option>
            ))}
          </optgroup>
        ))}
      </select>
      <select
        value={p.row.op}
        onChange={(e) => p.onChange({ ...p.row, op: e.target.value as Op })}
      >
        {(["==","!=","<","<=",">",">=","in"] as Op[]).map(op => (
          <option key={op} value={op}>{op}</option>
        ))}
      </select>
      {selected?.type === "boolean" ? (
        <select
          value={p.row.value}
          onChange={(e) => p.onChange({ ...p.row, value: e.target.value })}
        >
          <option value="">—</option>
          <option value="true">true</option>
          <option value="false">false</option>
        </select>
      ) : (
        <input
          type={selected?.type === "number" ? "number" : "text"}
          value={p.row.value}
          onChange={(e) => p.onChange({ ...p.row, value: e.target.value })}
        />
      )}
      <button type="button" onClick={p.onRemove} aria-label="Remove row">×</button>
    </div>
  );
}

// === Conversion helpers ===

function exprToRows(expr: JsonLogicExpr | undefined): { connector: Connector; rows: Row[] } {
  if (!expr || typeof expr !== "object") return { connector: "and", rows: [] };
  if ("and" in expr) return { connector: "and", rows: (expr.and as JsonLogicExpr[]).map(opToRow) };
  if ("or"  in expr) return { connector: "or",  rows: (expr.or  as JsonLogicExpr[]).map(opToRow) };
  return { connector: "and", rows: [opToRow(expr)] };
}

function opToRow(expr: JsonLogicExpr): Row {
  if (typeof expr !== "object" || expr === null) return { varPath: "", op: "==", value: "" };
  const op = Object.keys(expr)[0] as Op;
  const arr = (expr as Record<string, unknown>)[op] as [unknown, unknown];
  if (!Array.isArray(arr) || arr.length !== 2) return { varPath: "", op: "==", value: "" };
  const lhs = arr[0];
  const rhs = arr[1];
  const varPath = (lhs && typeof lhs === "object" && "var" in (lhs as object))
    ? String((lhs as { var: string }).var)
    : "";
  return { varPath, op, value: rhs == null ? "" : String(rhs) };
}

function rowsToExpr(rows: Row[], connector: Connector, suggestions: ConditionSuggestion[]): JsonLogicExpr | undefined {
  const valid = rows.filter(r => r.varPath);
  if (valid.length === 0) return undefined;
  const exprs = valid.map(r => rowToExpr(r, suggestions));
  if (exprs.length === 1) return exprs[0];
  return { [connector]: exprs } as JsonLogicExpr;
}

function rowToExpr(r: Row, suggestions: ConditionSuggestion[]): JsonLogicExpr {
  const meta = suggestions.find(s => s.path === r.varPath);
  let v: JsonLogicExpr;
  if (meta?.type === "number") v = Number(r.value);
  else if (meta?.type === "boolean") v = r.value === "true";
  else v = r.value;
  return { [r.op]: [{ var: r.varPath }, v] } as JsonLogicExpr;
}
```

---

### Task 7: EdgeInspector

**Files:**
- Create: `packages/flow-editor/src/inspector/EdgeInspector.tsx`

- [ ] **Step 1: Implement the right-side inspector**

```tsx
// packages/flow-editor/src/inspector/EdgeInspector.tsx

import { useMemo } from "react";
import type { FlowEdge, FlowGraph, JsonLogicExpr, OutputSchema } from "@journeyman/core";
import { ConditionBuilder } from "./ConditionBuilder.tsx";
import { buildConditionSuggestions, type CatalogLookup } from "./condition-suggestions.ts";

interface Props {
  flow: FlowGraph;
  edge: FlowEdge;
  /** Lookup by phase type → output schema; usually the phases catalog. */
  catalog: CatalogLookup;
  onChange: (next: FlowEdge) => void;
}

export function EdgeInspector({ flow, edge, catalog, onChange }: Props) {
  const sourceNode = flow.nodes.find(n => n.id === edge.source);
  const isXor = sourceNode?.type === "gateway-xor" || sourceNode?.type === "if";

  const suggestions = useMemo(
    () => isXor ? buildConditionSuggestions(flow, edge.source, catalog) : [],
    [flow, edge.source, catalog, isXor],
  );

  if (!isXor) {
    return (
      <div className="je-edge-inspector">
        <div className="je-edge-inspector__hint">
          This edge type has no editable properties.
        </div>
      </div>
    );
  }

  const type = edge.type ?? "default";
  const isConditional = type === "conditional";
  const isElse        = type === "else";

  return (
    <div className="je-edge-inspector">
      <div className="je-edge-inspector__header">
        Edge: {edge.source} → {edge.target}
      </div>

      <label className="je-edge-inspector__field">
        <span>Branch label</span>
        <input
          type="text"
          value={edge.branchLabel ?? ""}
          onChange={(e) => onChange({ ...edge, branchLabel: e.target.value })}
          disabled={isElse}
        />
      </label>

      <fieldset className="je-edge-inspector__type">
        <legend>Type</legend>
        <label>
          <input
            type="radio"
            name="edgeType"
            checked={isConditional}
            onChange={() => onChange({ ...edge, type: "conditional" })}
          />
          conditional
        </label>
        <label>
          <input
            type="radio"
            name="edgeType"
            checked={isElse}
            onChange={() => onChange({ ...edge, type: "else", condition: undefined, branchLabel: undefined })}
          />
          else
        </label>
      </fieldset>

      {isConditional && (
        <div className="je-edge-inspector__condition">
          <div className="je-edge-inspector__condition-header">Condition</div>
          <ConditionBuilder
            value={edge.condition}
            suggestions={suggestions}
            onChange={(expr: JsonLogicExpr | undefined) => onChange({ ...edge, condition: expr })}
          />
        </div>
      )}

      {!edge.branchLabel && isConditional && (
        <div className="je-edge-inspector__error">Branch label required.</div>
      )}
    </div>
  );
}
```

---

### Task 8: Add edge-selection state

**Files:**
- Modify: `packages/flow-editor/src/state/useFlowEditorState.ts`

- [ ] **Step 1: Add `selectedEdgeId` alongside `selectedNodeId`**

In `packages/flow-editor/src/state/useFlowEditorState.ts`, add the new state inside the hook (next to `const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);`):

```ts
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);

  const selectedEdge = useMemo(
    () => args.flow.edges.find(e => e.id === selectedEdgeId) ?? null,
    [args.flow.edges, selectedEdgeId],
  );
```

Then add to the returned object (next to `selectedNodeId, selectedNode, setSelectedNodeId`):

```ts
    selectedEdgeId, selectedEdge,
    setSelectedEdgeId,
```

Selecting a node should clear edge selection and vice-versa. Wrap `setSelectedNodeId` and `setSelectedEdgeId` so each clears the other:

```ts
  const selectNode = (id: string | null) => {
    setSelectedNodeId(id);
    if (id) setSelectedEdgeId(null);
  };
  const selectEdge = (id: string | null) => {
    setSelectedEdgeId(id);
    if (id) setSelectedNodeId(null);
  };
```

Replace the returned `setSelectedNodeId` with `selectNode` and add `selectEdge` alongside `setSelectedEdgeId`. Keep the raw setters exported too if they're already used elsewhere — read the file to confirm.

---

### Task 9: Wire edge clicks in Canvas

**Files:**
- Modify: `packages/flow-editor/src/canvas/Canvas.tsx`

- [ ] **Step 1: Add `onEdgeSelect` prop and wire to React Flow's `onEdgeClick`**

Add `onEdgeSelect?: (id: string | null) => void` to the Canvas props interface (alongside `onSelect`).

In the `<ReactFlow>` element inside `Canvas.tsx`, add:

```tsx
        onEdgeClick={(_, edge) => p.onEdgeSelect?.(edge.id)}
        onPaneClick={() => { p.onSelect(null); p.onEdgeSelect?.(null); }}
```

If `onPaneClick` is already wired, extend it rather than replacing — read the file before editing.

---

### Task 10: Render the inspector slot

**Files:**
- Modify: `packages/flow-editor/src/FlowEditor.tsx`

- [ ] **Step 1: Pass edge selection into Canvas and render `EdgeInspector` when an edge is selected**

In `FlowEditor.tsx`, where `<Canvas>` is rendered (the existing `selectedNodeId={s.selectedNodeId}` site, around line 188), add:

```tsx
            onEdgeSelect={(id) => s.selectEdge(id)}
```

Where the existing `PropertiesPanel` is rendered, add a sibling render for `EdgeInspector`:

```tsx
{s.selectedEdge ? (
  <EdgeInspector
    flow={s.flow}
    edge={s.selectedEdge}
    catalog={{ outputSchemaFor: (phaseType) => s.phaseRegistry.outputSchemaFor(phaseType) }}
    onChange={(next) => s.updateEdge(next)}
  />
) : null}
```

Add the import at the top:

```tsx
import { EdgeInspector } from "./inspector/EdgeInspector.tsx";
```

If `s.updateEdge` does not yet exist, add it to `useFlowEditorState`:

```ts
  const updateEdge = (next: FlowEdge) => {
    args.onChange({
      ...args.flow,
      edges: args.flow.edges.map(e => e.id === next.id ? next : e),
    });
  };
```

and return it. If `s.phaseRegistry.outputSchemaFor` doesn't exist on the existing registry, expose a thin wrapper there or look up via the catalog directly — read `packages/flow-editor/src/state/phase-registry.ts` to confirm and pick whichever has the lookup.

---

### Task 11: Mirror convert-time edge rules in client validation

**Files:**
- Modify: `packages/flow-editor/src/state/validation.ts`

- [ ] **Step 1: Add gateway-xor edge validation**

After the existing validation rules in `validation.ts`, append a pass that walks edges and produces warnings/errors for each gateway-xor:

```ts
import { isJsonLogicExpr } from "@journeyman/core";

// ... inside the existing validation function, after current rules:

  for (const node of flow.nodes) {
    if (node.type !== "gateway-xor" && node.type !== "if") continue;
    const outs = flow.edges.filter(e => e.source === node.id);
    const labels = new Set<string>();

    for (const e of outs) {
      if (e.type === "conditional") {
        if (!e.branchLabel) {
          errors.push({ kind: "edge", id: e.id, message: `Edge ${e.id} requires a branchLabel` });
        } else if (labels.has(e.branchLabel)) {
          errors.push({ kind: "edge", id: e.id, message: `Duplicate branchLabel '${e.branchLabel}' on gateway '${node.id}'` });
        } else {
          labels.add(e.branchLabel);
        }
        if (e.condition === undefined) {
          errors.push({ kind: "edge", id: e.id, message: `Edge ${e.id} is conditional but has no condition` });
        } else if (!isJsonLogicExpr(e.condition)) {
          errors.push({ kind: "edge", id: e.id, message: `Edge ${e.id} has an invalid condition shape` });
        }
      }
    }
  }
```

Read the existing `validation.ts` to confirm the error/warning shape (`kind`, `id`, `message` may be different in this codebase) and adapt the literals to match. Do not invent a new error structure.

---

### Task 12: Migration — drop unparseable conditions on flow load

**Files:**
- Modify: the flow-editor's flow-loading entry (`packages/flow-editor/src/api/*` or wherever the existing `config.mcp` strip lives — search for that strip and add this alongside it).

- [ ] **Step 1: Locate the existing legacy strip**

Run:

```bash
grep -rn "config.mcp\|config\\.mcp\|legacy.*mcp" packages/flow-editor/src/
```

Open the file containing the load-time strip. The pattern lives in the load path so legacy flows open without error.

- [ ] **Step 2: Add a sibling strip for `condition`**

Inside the same load-time normalization, after the mcp strip, walk edges:

```ts
import { isJsonLogicExpr } from "@journeyman/core";

// inside the normalization function:
for (const e of flow.edges) {
  if (e.condition !== undefined && !isJsonLogicExpr(e.condition)) {
    e.condition = undefined;
    // Optional: push a load-time warning if the existing strip already has a warning channel.
  }
}
```

Match the surrounding code's style (mutation vs. immutable rebuild) — follow whatever the mcp strip does in that file.

---

### Task 13: Final verification — typecheck

**Files:** none

- [ ] **Step 1: Run workspace typecheck**

Run:

```bash
npm run typecheck
```

Expected: zero errors across all packages.

If errors appear, fix them at their source — never widen types or `any` to silence them.

---

## Self-Review

**Spec coverage check:**

| Spec § | Task |
|---|---|
| §2 Data Model — `JsonLogicExpr`, tighten `FlowEdge.condition`, re-exports | Tasks 1, 2 |
| §3 JsonLogic → JS compiler (`compileJsonLogic`, `compileSwitchExpression`) | Task 3 |
| §4 SWITCH emission + validation, remove placeholder | Task 4 |
| §5 Inspector UI: `EdgeInspector`, `ConditionBuilder`, `condition-suggestions` | Tasks 5, 6, 7 |
| §5 Edge selection wiring + Canvas + FlowEditor | Tasks 8, 9, 10 |
| §5 Live validation mirror | Task 11 |
| §8 Migration — drop unparseable legacy conditions | Task 12 |

§6 Testing is intentionally **omitted** per user constraint (no unit tests). Verification is the typecheck in Task 13.

**Type consistency:** `JsonLogicExpr` shape stays identical from Task 1 through 11. `isJsonLogicExpr` defined in Task 1, reused in Tasks 11 and 12. `compileSwitchExpression` signature in Task 3 matches its caller in Task 4. `ConditionSuggestion` defined in Task 5, consumed unchanged in Tasks 6 and 7. `selectedEdge` / `selectEdge` / `updateEdge` introduced in Task 8, referenced in Task 10.

**Placeholder scan:** No `TBD`/`TODO`/"add validation"/"similar to". Tasks 9, 10, 11, 12 contain "read the file before editing" instructions because the surrounding code in those files is large and may diverge from what the plan assumes — those instructions are about confirming patterns, not deferring work, and each task still spells out the new code in full.
