# If-Else Gate Condition Value Picker — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat `<select>` LHS in the if-else gate condition row with the same `{x}` `ValuePicker` popover used in step inputs, sourcing upstream fields via `useUpstreamSources` and adding step-input refs as a free side-benefit.

**Architecture:** `EdgeInspector` switches from `buildConditionSuggestions` (flat list, transparent gateway walk) to `useUpstreamSources` (dominator-based `UpstreamSource[]`). `ConditionBuilder` accepts `sources: UpstreamSource[]` instead of `suggestions: ConditionSuggestion[]`, renders a button + popover for LHS, and resolves the RHS value control type by walking the sources tree. `WorkflowEdge.condition` JsonLogic shape is unchanged on disk.

**Tech Stack:** TypeScript, React 18, existing `@journeyman/core` types (`UpstreamSource`, `Shape`, `CustomAiStep`, `JsonLogicExpr`), existing `useUpstreamSources` / `useStepCatalog` hooks, existing `ValuePicker` component.

**Spec:** [docs/superpowers/specs/2026-05-26-if-else-condition-value-picker-design.md](../specs/2026-05-26-if-else-condition-value-picker-design.md)

---

## File Map

- **Modify** `packages/flow-editor/src/inspector/ConditionBuilder.tsx` — swap props; LHS button + popover; new `shapeForRef` helper.
- **Modify** `packages/flow-editor/src/inspector/EdgeInspector.tsx` — fetch full `CustomAiStep`; use `useStepCatalog` + `useUpstreamSources`; pass `sources` to `ConditionBuilder`.
- **Delete** `packages/flow-editor/src/inspector/condition-suggestions.ts` — no remaining importers after `EdgeInspector` is rewritten.
- **Create** `packages/flow-editor/src/inspector/shape-for-ref.ts` — pure helper to resolve a ref string to its leaf `Shape` using `UpstreamSource[]`. Pure module so it can be unit-tested without React.
- **Create** `packages/flow-editor/src/inspector/shape-for-ref.test.ts` — unit tests for the helper.

---

## Task 1: Pure helper — `shapeForRef`

**Files:**
- Create: `packages/flow-editor/src/inspector/shape-for-ref.ts`
- Create: `packages/flow-editor/src/inspector/shape-for-ref.test.ts`

Resolves a ref like `workflow.input.foo`, `stepId.input.x.y`, or `stepId.output.score` to its leaf `Shape` by traversing `UpstreamSource[]` and into nested object shapes. Returns `undefined` when the ref doesn't match anything declared.

- [ ] **Step 1.1: Write the failing test file**

Create `packages/flow-editor/src/inspector/shape-for-ref.test.ts`:

```ts
import assert from "node:assert/strict";
import type { UpstreamSource } from "../properties-panel/use-upstream-sources.ts";
import { shapeForRef } from "./shape-for-ref.ts";

const sources: UpstreamSource[] = [
  {
    kind: "run-input",
    id: "",
    label: "Run inputs",
    groups: [{
      title: "Run inputs",
      scope: "run-input",
      fields: [
        { name: "ticketId", scope: "run-input", shape: { type: "string" } },
        { name: "retries",  scope: "run-input", shape: { type: "number" } },
      ],
    }],
  },
  {
    kind: "node",
    id: "analyze",
    label: "Analyze",
    groups: [
      {
        title: "Inputs",
        scope: "input",
        fields: [
          { name: "issue", scope: "input", shape: { type: "string" } },
        ],
      },
      {
        title: "Outputs",
        scope: "output",
        fields: [
          { name: "ok",     scope: "output", shape: { type: "boolean" } },
          { name: "report", scope: "output", shape: { type: "object", fields: { score: { type: "number" }, label: { type: "string" } } } },
        ],
      },
    ],
  },
];

// run-input string
assert.deepEqual(shapeForRef("workflow.input.ticketId", sources), { type: "string" });

// run-input number
assert.deepEqual(shapeForRef("workflow.input.retries", sources), { type: "number" });

// step input
assert.deepEqual(shapeForRef("analyze.input.issue", sources), { type: "string" });

// step output boolean
assert.deepEqual(shapeForRef("analyze.output.ok", sources), { type: "boolean" });

// nested object leaf
assert.deepEqual(shapeForRef("analyze.output.report.score", sources), { type: "number" });

// unknown ref
assert.equal(shapeForRef("analyze.output.missing", sources), undefined);
assert.equal(shapeForRef("ghost.output.x", sources), undefined);
assert.equal(shapeForRef("workflow.input.unknown", sources), undefined);
assert.equal(shapeForRef("", sources), undefined);
assert.equal(shapeForRef("garbage", sources), undefined);

console.log("shape-for-ref: ok");
```

- [ ] **Step 1.2: Run test to verify it fails**

Run: `npx tsx packages/flow-editor/src/inspector/shape-for-ref.test.ts`
Expected: FAIL — `Cannot find module '.../shape-for-ref.ts'`.

- [ ] **Step 1.3: Implement the helper**

Create `packages/flow-editor/src/inspector/shape-for-ref.ts`:

```ts
import type { Shape } from "@journeyman/core";
import { resolveShape } from "@journeyman/core";
import type { UpstreamSource, UpstreamField } from "../properties-panel/use-upstream-sources.ts";

/**
 * Resolve a ref string emitted by ValuePicker (e.g. "workflow.input.x",
 * "stepId.input.x", "stepId.output.x.y") to its leaf Shape by walking
 * `sources`. Returns undefined when the ref does not match anything declared.
 */
export function shapeForRef(ref: string, sources: UpstreamSource[]): Shape | undefined {
  if (!ref) return undefined;
  const parts = ref.split(".");
  if (parts.length < 3) return undefined;

  let source: UpstreamSource | undefined;
  let scope: UpstreamField["scope"];
  let tail: string[];

  if (parts[0] === "workflow" && parts[1] === "input") {
    source = sources.find(s => s.kind === "run-input");
    scope = "run-input";
    tail = parts.slice(2);
  } else if (parts[1] === "input" || parts[1] === "output") {
    source = sources.find(s => s.kind === "node" && s.id === parts[0]);
    scope = parts[1] as "input" | "output";
    tail = parts.slice(2);
  } else {
    return undefined;
  }
  if (!source || tail.length === 0) return undefined;

  const group = source.groups.find(g => g.scope === scope);
  if (!group) return undefined;

  const field = group.fields.find(f => f.name === tail[0]);
  if (!field) return undefined;

  return descend(field.shape, tail.slice(1));
}

function descend(shape: Shape, rest: string[]): Shape | undefined {
  if (rest.length === 0) return shape;
  const resolved = resolveShape(shape);
  if (resolved.type !== "object") return undefined;
  const sub = resolved.fields[rest[0]];
  if (!sub) return undefined;
  return descend(sub, rest.slice(1));
}
```

- [ ] **Step 1.4: Run test to verify it passes**

Run: `npx tsx packages/flow-editor/src/inspector/shape-for-ref.test.ts`
Expected: `shape-for-ref: ok`

- [ ] **Step 1.5: Typecheck**

Run: `npm run typecheck -w @journeyman/flow-editor`
Expected: clean exit.

- [ ] **Step 1.6: Commit**

```bash
git add packages/flow-editor/src/inspector/shape-for-ref.ts packages/flow-editor/src/inspector/shape-for-ref.test.ts
git commit -m "feat(flow-editor): add shapeForRef helper for condition LHS type resolution"
```

---

## Task 2: Rewrite `ConditionBuilder` to use `UpstreamSource[]` + `ValuePicker`

**Files:**
- Modify: `packages/flow-editor/src/inspector/ConditionBuilder.tsx` (whole file replacement)

The LHS `<select>` becomes a button labeled either `{x} pick value…` (when `varPath` is empty) or the current `varPath` text. Clicking toggles a `ValuePicker` popover. Operator `<select>` and RHS value control are unchanged. RHS type is resolved by `shapeForRef`.

- [ ] **Step 2.1: Replace the file**

Replace the entire contents of `packages/flow-editor/src/inspector/ConditionBuilder.tsx` with:

```tsx
import { useMemo, useState } from "react";
import type { JsonLogicExpr } from "@journeyman/core";
import { ValuePicker } from "../properties-panel/ValuePicker.tsx";
import type { UpstreamSource } from "../properties-panel/use-upstream-sources.ts";
import { shapeForRef } from "./shape-for-ref.ts";

type Op = "==" | "!=" | "<" | "<=" | ">" | ">=" | "in";
type Connector = "and" | "or";

interface Row {
  varPath: string;
  op: Op;
  value: string;
}

interface Props {
  value: JsonLogicExpr | undefined;
  sources: UpstreamSource[];
  onChange: (expr: JsonLogicExpr | undefined) => void;
}

export function ConditionBuilder({ value, sources, onChange }: Props) {
  const [showJson, setShowJson] = useState(false);

  const initial = useMemo(() => exprToRows(value), [value]);
  const [connector, setConnector] = useState<Connector>(initial.connector);
  const [rows, setRows] = useState<Row[]>(initial.rows);

  function commit(nextRows: Row[], nextConnector: Connector) {
    setRows(nextRows);
    setConnector(nextConnector);
    onChange(rowsToExpr(nextRows, nextConnector, sources));
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
              sources={sources}
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
  sources: UpstreamSource[];
  onChange: (r: Row) => void;
  onRemove: () => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const leafShape = useMemo(() => shapeForRef(p.row.varPath, p.sources), [p.row.varPath, p.sources]);
  const leafType = leafShape?.type;

  return (
    <div className="je-condition-row">
      <div className="je-condition-row__lhs">
        <button
          type="button"
          className="je-condition-row__pick"
          onClick={() => setPickerOpen(o => !o)}
        >
          {p.row.varPath ? p.row.varPath : "{x} pick value…"}
        </button>
        {pickerOpen && (
          <div className="je-props__picker-popover">
            <ValuePicker
              sources={p.sources}
              onPick={(ref) => { p.onChange({ ...p.row, varPath: ref }); setPickerOpen(false); }}
              onClose={() => setPickerOpen(false)}
            />
          </div>
        )}
      </div>
      <select
        value={p.row.op}
        onChange={(e) => p.onChange({ ...p.row, op: e.target.value as Op })}
      >
        {(["==","!=","<","<=",">",">=","in"] as Op[]).map(op => (
          <option key={op} value={op}>{op}</option>
        ))}
      </select>
      {leafType === "boolean" ? (
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
          type={leafType === "number" ? "number" : "text"}
          value={p.row.value}
          onChange={(e) => p.onChange({ ...p.row, value: e.target.value })}
        />
      )}
      <button type="button" onClick={p.onRemove} aria-label="Remove row">×</button>
    </div>
  );
}

function exprToRows(expr: JsonLogicExpr | undefined): { connector: Connector; rows: Row[] } {
  if (expr === undefined || expr === null || typeof expr !== "object") {
    return { connector: "and", rows: [] };
  }
  if ("and" in expr) return { connector: "and", rows: (expr.and as JsonLogicExpr[]).map(opToRow) };
  if ("or"  in expr) return { connector: "or",  rows: (expr.or  as JsonLogicExpr[]).map(opToRow) };
  return { connector: "and", rows: [opToRow(expr)] };
}

function opToRow(expr: JsonLogicExpr): Row {
  if (typeof expr !== "object" || expr === null) return { varPath: "", op: "==", value: "" };
  const keys = Object.keys(expr);
  const op = keys[0] as Op;
  const arr = (expr as Record<string, unknown>)[op] as [unknown, unknown];
  if (!Array.isArray(arr) || arr.length !== 2) return { varPath: "", op: "==", value: "" };
  const lhs = arr[0];
  const rhs = arr[1];
  const varPath = (lhs && typeof lhs === "object" && "var" in (lhs as object))
    ? String((lhs as { var: string }).var)
    : "";
  return { varPath, op, value: rhs == null ? "" : String(rhs) };
}

function rowsToExpr(rows: Row[], connector: Connector, sources: UpstreamSource[]): JsonLogicExpr | undefined {
  const valid = rows.filter(r => r.varPath);
  if (valid.length === 0) return undefined;
  const exprs = valid.map(r => rowToExpr(r, sources));
  if (exprs.length === 1) return exprs[0];
  return { [connector]: exprs } as JsonLogicExpr;
}

function rowToExpr(r: Row, sources: UpstreamSource[]): JsonLogicExpr {
  const t = shapeForRef(r.varPath, sources)?.type;
  let v: JsonLogicExpr;
  if (t === "number") v = Number(r.value);
  else if (t === "boolean") v = r.value === "true";
  else v = r.value;
  return { [r.op]: [{ var: r.varPath }, v] } as JsonLogicExpr;
}
```

- [ ] **Step 2.2: Typecheck**

Run: `npm run typecheck -w @journeyman/flow-editor`
Expected: typecheck fails because `EdgeInspector.tsx` still passes the old `suggestions` prop. That's expected — Task 3 fixes it. Do **not** commit yet.

---

## Task 3: Rewrite `EdgeInspector` to use `useUpstreamSources`

**Files:**
- Modify: `packages/flow-editor/src/inspector/EdgeInspector.tsx` (whole file replacement)

Switch from `useStepRegistry` + `buildConditionSuggestions` + per-step output-only fetch, to `useStepCatalog` + `useUpstreamSources` + full-step custom-step fetch. Keep `isXor` gating, branch label, fallback-else checkbox, duplicate-else warning, and error/loading UX (rendered above the picker now).

- [ ] **Step 3.1: Replace the file**

Replace the entire contents of `packages/flow-editor/src/inspector/EdgeInspector.tsx` with:

```tsx
import { useEffect, useMemo, useState } from "react";
import type { WorkflowEdge, WorkflowGraph, JsonLogicExpr, CustomAiStep } from "@journeyman/core";
import { ConditionBuilder } from "./ConditionBuilder.tsx";
import { useStepCatalog } from "../catalogs/use-step-catalog.ts";
import { useUpstreamSources } from "../properties-panel/use-upstream-sources.ts";
import { useOrgId } from "../state/org-context.tsx";

interface Props {
  flow: WorkflowGraph;
  edge: WorkflowEdge;
  onChange: (next: WorkflowEdge) => void;
  onClose?: () => void;
}

export function EdgeInspector({ flow, edge, onChange, onClose }: Props) {
  const catalog = useStepCatalog();
  const orgId = useOrgId();

  const sourceNode = flow.nodes.find(n => n.id === edge.source);
  const isXor = sourceNode?.type === "gateway-xor" || sourceNode?.type === "if";

  // Collect distinct customStepIds referenced anywhere in the graph by
  // custom-ai nodes — useUpstreamSources only consumes the ones it needs
  // (dominators of edge.source), so over-fetching is cheap and avoids
  // re-running the fetch whenever edge.source changes.
  const customStepIds = useMemo(() => {
    if (!isXor) return [] as string[];
    const set = new Set<string>();
    for (const n of flow.nodes) {
      if (n.type !== "step") continue;
      if (n.stepType !== "custom-ai" && !n.stepType?.startsWith("custom-ai:")) continue;
      const cfg = (n.config ?? {}) as { customStepId?: unknown };
      if (typeof cfg.customStepId === "string" && cfg.customStepId) set.add(cfg.customStepId);
    }
    return [...set];
  }, [flow.nodes, isXor]);

  const customStepKey = customStepIds.slice().sort().join(",");

  const [customStepDefs, setCustomStepDefs] = useState<Record<string, CustomAiStep | null>>({});
  const [loadingCustom, setLoadingCustom] = useState(false);
  const [customErrored, setCustomErrored] = useState(false);

  useEffect(() => {
    if (!isXor || !orgId || customStepIds.length === 0) {
      setCustomStepDefs({});
      setLoadingCustom(false);
      setCustomErrored(false);
      return;
    }
    let alive = true;
    setLoadingCustom(true);
    setCustomErrored(false);

    const fetches = customStepIds.map(async (id): Promise<[string, CustomAiStep | null]> => {
      try {
        let res = await fetch(
          `/api/orgs/${orgId}/users/me/custom-steps/${id}`,
          { credentials: "include" },
        );
        if (!res.ok) {
          res = await fetch(
            `/api/orgs/${orgId}/custom-steps/${id}`,
            { credentials: "include" },
          );
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const step = (await res.json()) as CustomAiStep;
        return [id, step];
      } catch (err) {
        console.warn(`[EdgeInspector] failed to load custom step ${id}:`, err);
        return [id, null];
      }
    });

    Promise.all(fetches).then(results => {
      if (!alive) return;
      const next: Record<string, CustomAiStep | null> = {};
      let anyError = false;
      for (const [id, step] of results) {
        next[id] = step;
        if (!step) anyError = true;
      }
      setCustomStepDefs(next);
      setCustomErrored(anyError);
      setLoadingCustom(false);
    });

    return () => { alive = false; };
  }, [customStepKey, orgId, isXor]);

  const sources = useUpstreamSources(flow, edge.source, catalog, customStepDefs);

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
  const isElse = type === "else";
  const isConditional = !isElse;

  const otherElseCount = flow.edges.filter(
    e => e.source === edge.source && e.id !== edge.id && e.type === "else",
  ).length;
  const showDuplicateElseWarning = isElse && otherElseCount > 0;

  const toggleElse = (next: boolean) => {
    if (next) {
      onChange({ ...edge, type: "else", condition: undefined, branchLabel: undefined });
    } else {
      onChange({ ...edge, type: "conditional" });
    }
  };

  return (
    <div className="je-edge-inspector">
      <div className="je-edge-inspector__header">
        <span>Edge: {edge.source} → {edge.target}</span>
        {onClose ? (
          <button type="button" className="je-props__close" onClick={onClose} aria-label="Close">×</button>
        ) : null}
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

      <label className="je-edge-inspector__fallback">
        <input
          type="checkbox"
          checked={isElse}
          onChange={(e) => toggleElse(e.target.checked)}
        />
        <span>
          <strong>Mark as fallback (else)</strong>
          <br />
          <small>Taken when no other conditional branch from this gateway matches.</small>
        </span>
      </label>

      {showDuplicateElseWarning && (
        <div className="je-edge-inspector__warning">
          This gateway already has an else branch — only one is allowed at runtime.
        </div>
      )}

      {isConditional && (
        <div className="je-edge-inspector__condition">
          <div className="je-edge-inspector__condition-header">Condition</div>
          {loadingCustom && (
            <div className="je-edge-inspector__status">Loading custom step outputs…</div>
          )}
          {!loadingCustom && customErrored && (
            <div className="je-edge-inspector__status">(failed to load some custom-step outputs)</div>
          )}
          <ConditionBuilder
            value={edge.condition}
            sources={sources}
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

- [ ] **Step 3.2: Typecheck**

Run: `npm run typecheck -w @journeyman/flow-editor`
Expected: clean exit (condition-suggestions.ts still exists but is no longer imported — that's fine until Task 4).

- [ ] **Step 3.3: Boundary check**

Run: `npm run check:boundaries`
Expected: clean exit.

- [ ] **Step 3.4: Commit**

```bash
git add packages/flow-editor/src/inspector/ConditionBuilder.tsx packages/flow-editor/src/inspector/EdgeInspector.tsx
git commit -m "feat(flow-editor): if-else condition LHS uses shared {x} ValuePicker"
```

---

## Task 4: Remove dead `condition-suggestions.ts`

**Files:**
- Delete: `packages/flow-editor/src/inspector/condition-suggestions.ts`

Verify no remaining importers before deletion (it exports `buildConditionSuggestions`, `collectUpstreamSteps`, `customAiOutputSchemaFromJsonSchema`, `ConditionSuggestion`, `CatalogLookup`).

- [ ] **Step 4.1: Verify no remaining importers**

Run:
```bash
grep -rn "condition-suggestions\|buildConditionSuggestions\|collectUpstreamSteps\|customAiOutputSchemaFromJsonSchema\|ConditionSuggestion" packages/ --include="*.ts" --include="*.tsx" | grep -v node_modules
```
Expected: only matches inside `packages/flow-editor/src/inspector/condition-suggestions.ts` itself.

- [ ] **Step 4.2: Delete the file**

Run: `rm packages/flow-editor/src/inspector/condition-suggestions.ts`

- [ ] **Step 4.3: Typecheck + boundary check**

Run: `npm run check -w @journeyman/flow-editor 2>/dev/null || npm run typecheck && npm run check:boundaries`
Expected: clean exit. If typecheck fails because something elsewhere imported the deleted file, restore it and revisit Task 3 — the spec says nothing else imports these symbols, but grep is the source of truth.

- [ ] **Step 4.4: Commit**

```bash
git add -A packages/flow-editor/src/inspector/condition-suggestions.ts
git commit -m "chore(flow-editor): remove unused condition-suggestions module"
```

---

## Task 5: Add CSS for new LHS layout

**Files:**
- Modify: `packages/flow-editor/src/styles.css`

The new `RowEditor` introduces two new class names that don't exist yet: `je-condition-row__lhs` (positioning wrapper for the picker button + popover) and `je-condition-row__pick` (the button itself). The existing `je-condition-row` flex row, `je-props__picker-popover` popover positioning, and `value-picker` styles are already in place — only the LHS slot needs styling.

- [ ] **Step 5.1: Find the existing `.je-condition-row` rule**

Run: `grep -n "je-condition-row" packages/flow-editor/src/styles.css`
Note the line ranges of the existing rules.

- [ ] **Step 5.2: Append new rules**

Append to `packages/flow-editor/src/styles.css`:

```css
/* If-else gate condition: LHS picker button (replaces the old <select>). */
.je-condition-row__lhs {
  position: relative;
  flex: 0 0 auto;
  min-width: 180px;
}
.je-condition-row__pick {
  width: 100%;
  background: #2a2a3e;
  border: 1px solid #444;
  color: #ddd;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 11px;
  cursor: pointer;
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.je-condition-row__pick:hover {
  background: #34344a;
}
```

- [ ] **Step 5.3: Commit**

```bash
git add packages/flow-editor/src/styles.css
git commit -m "style(flow-editor): add styles for if-else condition LHS picker button"
```

---

## Task 6: Manual verification in the running app

The package has no React test runner, so manual browser verification is the acceptance gate for the UI behavior.

- [ ] **Step 6.1: Start infra + services**

```bash
npm run infra:up
npm run migrate
npm run start:api-server      # in one terminal
npm run start:worker          # in another
npm run dev:web               # in another
```

- [ ] **Step 6.2: Build a small workflow to exercise the picker**

In the browser:
1. Create a new workflow with a Manual Trigger (declare run inputs: `ticketId` string, `retries` number).
2. Add a step (e.g. `getTicket`) downstream of the trigger.
3. Add an if-else gate (`gateway-xor` / `if`) downstream of that step.
4. Add two downstream branches from the gate.
5. Click the conditional edge to open the EdgeInspector.

- [ ] **Step 6.3: Verify the picker**

Inside the Condition section:
- The LHS button reads `{x} pick value…` initially.
- Click it; the `ValuePicker` popover opens.
- Confirm `Run inputs` shows `ticketId` and `retries`.
- Confirm the upstream step appears as a source with both `Inputs` and `Outputs` groups.
- Pick a value; the button label updates to the chosen ref.
- The operator dropdown still shows `==, !=, <, <=, >, >=, in`.
- For a boolean leaf, the RHS becomes a `true/false` dropdown.
- For a number leaf, the RHS becomes a numeric input.
- For a string leaf, the RHS is a text input.
- Click `Show JSON`; confirm the stored JsonLogic is `{ "==": [{ "var": "<ref>" }, <typed value>] }`.

- [ ] **Step 6.4: Verify backward compatibility**

Open an existing workflow that already has an if-else condition saved.
- Confirm the row displays the previously stored ref on the button.
- Confirm the operator and RHS value round-trip unchanged.
- Confirm `Show JSON` matches what was saved.

- [ ] **Step 6.5: Verify custom-AI upstream step**

Place a custom-AI step upstream of the gate, configured with a `customStepId` whose definition declares an input named `foo` and a structured output with `score: number`.
- Open the conditional edge inspector.
- Brief `Loading custom step outputs…` note may appear, then disappear.
- Confirm the source appears in the picker with both `Inputs` (`foo`) and `Outputs` (`score`) groups.
- Pick `score`; confirm RHS becomes a numeric input.

- [ ] **Step 6.6: Verify error-state fallback**

Temporarily break the custom-step fetch (e.g. rename the custom step's id in the trigger but leave the upstream node referencing it, or stop the API server briefly while opening the inspector).
- Confirm the `(failed to load some custom-step outputs)` note renders above the ConditionBuilder.
- Confirm the picker still works for everything else (run inputs, built-in upstream steps).

- [ ] **Step 6.7: Verify reachability change**

Build a graph where a step exists in the graph but does NOT dominate the gate (e.g. two parallel branches feeding a join, one branch's step shouldn't appear in the picker for an edge leaving a gate fed by the other branch).
- Confirm the non-dominating step's outputs are absent from the picker. This is intentional per the spec.

- [ ] **Step 6.8: Final commit (if any tweaks needed)**

If Steps 6.1–6.7 surfaced CSS or copy tweaks, apply them and commit:
```bash
git add -A
git commit -m "fix(flow-editor): if-else condition picker — <what you fixed>"
```

If nothing needed fixing, skip this step.

---

## Self-Review Notes

- **Spec coverage:** Every section of the spec maps to a task. Spec "Files touched" → Tasks 2/3/4. Spec "Reachability change" + "Step inputs as condition LHS" → fall out of Task 3 automatically. Spec "Edge cases" → covered by Task 1 tests + Task 6 manual checks. Spec "Testing" → Task 1 (unit) + Task 6 (manual / round-trip). Spec "Rollout" notes no migration — confirmed by leaving `WorkflowEdge.condition` shape untouched.
- **Placeholder scan:** No TBDs, no "add appropriate error handling" hand-waving — every code step contains the full code.
- **Type consistency:** `UpstreamSource`, `UpstreamField`, `Shape`, `CustomAiStep` are all imported by their existing names. `shapeForRef` signature is consistent between Task 1 (definition) and Task 2 (usage).
