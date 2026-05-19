# Human-Task Accept-If Visual Rule Builder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the raw JSONLogic textarea on the Human Task node's "Accept if" field with a visual rule builder, falling back to a JSON escape hatch for advanced cases.

**Architecture:** A new `AcceptIfBuilder` component owns its own draft state (combinator + rule list + mode flag) and emits a JSONLogic value via `onChange`. Two pure functions — `rulesToJsonLogic` and `jsonLogicToRules` — handle serialization and parsing between the visual model and JSONLogic. The component is wired into `ControlNodeConfigTab.tsx`, replacing the existing textarea block. No backend or schema changes.

**Tech Stack:** React 18, TypeScript, plain CSS (existing `.je-humantask__*` classes), `node:assert/strict` + `tsx` for tests (matches the monorepo convention — see `packages/coding-cli/src/providers/claude/utils/session.test.ts`).

**Note on commits:** Per user request, **no commits between tasks**. Implement the whole plan, then run typecheck and tests at the end.

---

## File structure

| File | Responsibility | Status |
|---|---|---|
| `packages/flow-editor/src/properties-panel/AcceptIfBuilder.logic.ts` | Types, operator metadata, `rulesToJsonLogic`, `jsonLogicToRules` | Create |
| `packages/flow-editor/src/properties-panel/AcceptIfBuilder.logic.test.ts` | Unit tests for the logic module | Create |
| `packages/flow-editor/src/properties-panel/AcceptIfBuilder.tsx` | React component | Create |
| `packages/flow-editor/src/properties-panel/ControlNodeConfigTab.tsx` | Swap textarea block for `<AcceptIfBuilder>` | Modify |
| `packages/flow-editor/src/styles.css` | Append `.je-acceptif__*` rules | Modify |

---

### Task 1: Logic module — types and stub exports

**Files:**
- Create: `packages/flow-editor/src/properties-panel/AcceptIfBuilder.logic.ts`

- [ ] **Step 1: Create the logic module with types, operator metadata, and stubbed pure functions**

```ts
// packages/flow-editor/src/properties-panel/AcceptIfBuilder.logic.ts

export type Operator =
  | "eq" | "neq"
  | "in" | "nin"
  | "contains"
  | "empty" | "notEmpty"
  | "gt" | "lt";

export type ValueType = "string" | "number" | "boolean";

export interface Rule {
  field: string;
  op: Operator;
  value?: string;
  valueType?: ValueType;
}

export interface BuilderState {
  combinator: "and" | "or";
  rules: Rule[];
}

export interface OperatorMeta {
  op: Operator;
  label: string;
  hasValue: boolean;
  valueShape: "single" | "csv" | "none";
  valueKind: "text" | "number";
}

export const OPERATORS: OperatorMeta[] = [
  { op: "eq",       label: "equals",          hasValue: true,  valueShape: "single", valueKind: "text"   },
  { op: "neq",      label: "does not equal",  hasValue: true,  valueShape: "single", valueKind: "text"   },
  { op: "in",       label: "is one of",       hasValue: true,  valueShape: "csv",    valueKind: "text"   },
  { op: "nin",      label: "is not one of",   hasValue: true,  valueShape: "csv",    valueKind: "text"   },
  { op: "contains", label: "contains text",   hasValue: true,  valueShape: "single", valueKind: "text"   },
  { op: "empty",    label: "is empty",        hasValue: false, valueShape: "none",   valueKind: "text"   },
  { op: "notEmpty", label: "is not empty",    hasValue: false, valueShape: "none",   valueKind: "text"   },
  { op: "gt",       label: "greater than",    hasValue: true,  valueShape: "single", valueKind: "number" },
  { op: "lt",       label: "less than",       hasValue: true,  valueShape: "single", valueKind: "number" },
];

/** Validate a rule independently of others. Returns null if valid, else a reason string. */
export function ruleError(rule: Rule): string | null {
  if (!rule.field.trim()) return "Pick a field";
  const meta = OPERATORS.find(o => o.op === rule.op);
  if (!meta) return "Unknown operator";
  if (!meta.hasValue) return null;
  const raw = (rule.value ?? "").trim();
  if (!raw) return meta.valueShape === "csv" ? "Enter at least one value" : "Enter a value";
  if (meta.valueKind === "number" && !Number.isFinite(Number(raw))) return "Must be a number";
  if (meta.valueShape === "csv") {
    const items = raw.split(",").map(s => s.trim()).filter(Boolean);
    if (items.length === 0) return "Enter at least one value";
  }
  return null;
}

/** Serialize builder state to JSONLogic. Invalid rules are skipped. Returns undefined if no rules remain. */
export function rulesToJsonLogic(_state: BuilderState): unknown | undefined {
  throw new Error("not implemented");
}

/** Parse JSONLogic back to builder state. Returns null if the expression is outside the builder's grammar. */
export function jsonLogicToRules(_value: unknown): BuilderState | null {
  throw new Error("not implemented");
}
```

---

### Task 2: Tests for `rulesToJsonLogic`

**Files:**
- Create: `packages/flow-editor/src/properties-panel/AcceptIfBuilder.logic.test.ts`

- [ ] **Step 1: Write failing tests for serializer**

```ts
// packages/flow-editor/src/properties-panel/AcceptIfBuilder.logic.test.ts

import assert from "node:assert/strict";
import { rulesToJsonLogic, jsonLogicToRules, ruleError, type BuilderState } from "./AcceptIfBuilder.logic.ts";

const state = (combinator: BuilderState["combinator"], rules: BuilderState["rules"]): BuilderState =>
  ({ combinator, rules });

// rulesToJsonLogic: empty → undefined
{
  assert.equal(rulesToJsonLogic(state("and", [])), undefined);
}

// rulesToJsonLogic: all-invalid → undefined
{
  assert.equal(rulesToJsonLogic(state("and", [{ field: "", op: "eq", value: "x" }])), undefined);
}

// rulesToJsonLogic: single rule emits the rule directly (no wrapper)
{
  const out = rulesToJsonLogic(state("and", [{ field: "issue.status", op: "eq", value: "Done" }]));
  assert.deepEqual(out, { "==": [{ var: "issue.status" }, "Done"] });
}

// rulesToJsonLogic: two rules → and wrapper
{
  const out = rulesToJsonLogic(state("and", [
    { field: "a", op: "eq", value: "1" },
    { field: "b", op: "neq", value: "2" },
  ]));
  assert.deepEqual(out, {
    and: [
      { "==": [{ var: "a" }, "1"] },
      { "!=": [{ var: "b" }, "2"] },
    ],
  });
}

// rulesToJsonLogic: two rules → or wrapper
{
  const out = rulesToJsonLogic(state("or", [
    { field: "a", op: "eq", value: "1" },
    { field: "b", op: "eq", value: "2" },
  ]));
  assert.deepEqual(out, {
    or: [
      { "==": [{ var: "a" }, "1"] },
      { "==": [{ var: "b" }, "2"] },
    ],
  });
}

// rulesToJsonLogic: in/nin split CSV → array of strings
{
  const out = rulesToJsonLogic(state("and", [{ field: "state", op: "in", value: "approved, changes_requested" }]));
  assert.deepEqual(out, { in: [{ var: "state" }, ["approved", "changes_requested"]] });
}

// rulesToJsonLogic: in with all-numeric CSV → array of numbers
{
  const out = rulesToJsonLogic(state("and", [{ field: "n", op: "in", value: "1,2,3" }]));
  assert.deepEqual(out, { in: [{ var: "n" }, [1, 2, 3]] });
}

// rulesToJsonLogic: nin wraps with !
{
  const out = rulesToJsonLogic(state("and", [{ field: "state", op: "nin", value: "draft" }]));
  assert.deepEqual(out, { "!": { in: [{ var: "state" }, ["draft"]] } });
}

// rulesToJsonLogic: contains uses substring form
{
  const out = rulesToJsonLogic(state("and", [{ field: "title", op: "contains", value: "WIP" }]));
  assert.deepEqual(out, { in: ["WIP", { var: "title" }] });
}

// rulesToJsonLogic: empty / notEmpty have no value
{
  assert.deepEqual(
    rulesToJsonLogic(state("and", [{ field: "x", op: "empty" }])),
    { "!": { var: "x" } },
  );
  assert.deepEqual(
    rulesToJsonLogic(state("and", [{ field: "x", op: "notEmpty" }])),
    { "!!": { var: "x" } },
  );
}

// rulesToJsonLogic: gt/lt coerce to number
{
  assert.deepEqual(
    rulesToJsonLogic(state("and", [{ field: "n", op: "gt", value: "5" }])),
    { ">": [{ var: "n" }, 5] },
  );
  assert.deepEqual(
    rulesToJsonLogic(state("and", [{ field: "n", op: "lt", value: "10" }])),
    { "<": [{ var: "n" }, 10] },
  );
}

// rulesToJsonLogic: eq with valueType=number → number literal
{
  const out = rulesToJsonLogic(state("and", [{ field: "n", op: "eq", value: "5", valueType: "number" }]));
  assert.deepEqual(out, { "==": [{ var: "n" }, 5] });
}

// rulesToJsonLogic: eq with valueType=boolean → boolean literal
{
  const out = rulesToJsonLogic(state("and", [{ field: "b", op: "eq", value: "true", valueType: "boolean" }]));
  assert.deepEqual(out, { "==": [{ var: "b" }, true] });
}

// rulesToJsonLogic: mix of valid + invalid → only valid emitted
{
  const out = rulesToJsonLogic(state("and", [
    { field: "",  op: "eq", value: "x" },          // invalid: no field
    { field: "a", op: "eq", value: "1" },          // valid
  ]));
  assert.deepEqual(out, { "==": [{ var: "a" }, "1"] });
}

// ruleError sanity
{
  assert.equal(ruleError({ field: "x", op: "empty" }), null);
  assert.equal(ruleError({ field: "",  op: "eq", value: "1" }), "Pick a field");
  assert.equal(ruleError({ field: "x", op: "gt", value: "abc" }), "Must be a number");
  assert.equal(ruleError({ field: "x", op: "in", value: " , , " }), "Enter at least one value");
}

console.log("AcceptIfBuilder.logic serializer: all assertions passed (so far)");
```

- [ ] **Step 2: Run tests — expect failure (functions throw "not implemented")**

```bash
cd /Users/admin/data/workspace/claude-skils/journeyman
npx tsx packages/flow-editor/src/properties-panel/AcceptIfBuilder.logic.test.ts
```

Expected: throws `Error: not implemented` from the first `rulesToJsonLogic` call.

---

### Task 3: Implement `rulesToJsonLogic`

**Files:**
- Modify: `packages/flow-editor/src/properties-panel/AcceptIfBuilder.logic.ts`

- [ ] **Step 1: Replace the stub with the implementation**

Replace the body of `rulesToJsonLogic` with:

```ts
export function rulesToJsonLogic(state: BuilderState): unknown | undefined {
  const valid = state.rules.filter(r => ruleError(r) === null);
  if (valid.length === 0) return undefined;
  const emitted = valid.map(ruleToJsonLogic);
  if (emitted.length === 1) return emitted[0];
  return { [state.combinator]: emitted };
}

function ruleToJsonLogic(rule: Rule): unknown {
  const v = { var: rule.field };
  switch (rule.op) {
    case "eq":       return { "==": [v, coerceLiteral(rule)] };
    case "neq":      return { "!=": [v, coerceLiteral(rule)] };
    case "in":       return { in: [v, csvToList(rule.value ?? "")] };
    case "nin":      return { "!": { in: [v, csvToList(rule.value ?? "")] } };
    case "contains": return { in: [rule.value ?? "", v] };
    case "empty":    return { "!": v };
    case "notEmpty": return { "!!": v };
    case "gt":       return { ">": [v, Number(rule.value)] };
    case "lt":       return { "<": [v, Number(rule.value)] };
  }
}

function coerceLiteral(rule: Rule): unknown {
  const raw = rule.value ?? "";
  if (rule.valueType === "number") return Number(raw);
  if (rule.valueType === "boolean") return raw === "true";
  return raw;
}

function csvToList(raw: string): unknown[] {
  const items = raw.split(",").map(s => s.trim()).filter(Boolean);
  if (items.length > 0 && items.every(s => Number.isFinite(Number(s)))) {
    return items.map(Number);
  }
  return items;
}
```

- [ ] **Step 2: Run tests — expect serializer tests to pass, parser tests not yet added**

```bash
cd /Users/admin/data/workspace/claude-skils/journeyman
npx tsx packages/flow-editor/src/properties-panel/AcceptIfBuilder.logic.test.ts
```

Expected output ends with: `AcceptIfBuilder.logic serializer: all assertions passed (so far)`

---

### Task 4: Tests for `jsonLogicToRules`

**Files:**
- Modify: `packages/flow-editor/src/properties-panel/AcceptIfBuilder.logic.test.ts`

- [ ] **Step 1: Append parser tests above the final `console.log`**

Replace the final `console.log` line with the following block:

```ts
// jsonLogicToRules: undefined / null / non-object → null
{
  assert.equal(jsonLogicToRules(undefined), null);
  assert.equal(jsonLogicToRules(null), null);
  assert.equal(jsonLogicToRules("nope"), null);
}

// jsonLogicToRules: single rule (no wrapper) → combinator and, one rule
{
  const parsed = jsonLogicToRules({ "==": [{ var: "a" }, "1"] });
  assert.deepEqual(parsed, { combinator: "and", rules: [{ field: "a", op: "eq", value: "1" }] });
}

// jsonLogicToRules: each operator round-trips
{
  const cases: BuilderState[] = [
    state("and", [{ field: "a", op: "eq",       value: "1" }]),
    state("and", [{ field: "a", op: "neq",      value: "1" }]),
    state("and", [{ field: "a", op: "in",       value: "x, y" }]),
    state("and", [{ field: "a", op: "nin",      value: "x" }]),
    state("and", [{ field: "a", op: "contains", value: "WIP" }]),
    state("and", [{ field: "a", op: "empty" }]),
    state("and", [{ field: "a", op: "notEmpty" }]),
    state("and", [{ field: "a", op: "gt",       value: "5" }]),
    state("and", [{ field: "a", op: "lt",       value: "10" }]),
  ];
  for (const original of cases) {
    const json = rulesToJsonLogic(original);
    const parsed = jsonLogicToRules(json);
    assert.notEqual(parsed, null, `parse failed for op ${original.rules[0].op}`);
    const reSerialized = rulesToJsonLogic(parsed!);
    assert.deepEqual(reSerialized, json, `round-trip mismatch for op ${original.rules[0].op}`);
  }
}

// jsonLogicToRules: numeric CSV in / nin round-trips as numbers
{
  const json = { in: [{ var: "n" }, [1, 2, 3]] };
  const parsed = jsonLogicToRules(json);
  assert.deepEqual(parsed, { combinator: "and", rules: [{ field: "n", op: "in", value: "1, 2, 3" }] });
  assert.deepEqual(rulesToJsonLogic(parsed!), json);
}

// jsonLogicToRules: and / or with two rules → matching combinator
{
  const json = {
    and: [
      { "==": [{ var: "a" }, "1"] },
      { "!=": [{ var: "b" }, "2"] },
    ],
  };
  const parsed = jsonLogicToRules(json);
  assert.deepEqual(parsed, {
    combinator: "and",
    rules: [
      { field: "a", op: "eq",  value: "1" },
      { field: "b", op: "neq", value: "2" },
    ],
  });
}

// jsonLogicToRules: nested combinator → null (out of grammar)
{
  const json = {
    and: [
      { "==": [{ var: "a" }, "1"] },
      { or: [{ "==": [{ var: "b" }, "2"] }] },
    ],
  };
  assert.equal(jsonLogicToRules(json), null);
}

// jsonLogicToRules: unknown operator → null
{
  assert.equal(jsonLogicToRules({ "regex": [{ var: "a" }, "^x"] }), null);
}

console.log("AcceptIfBuilder.logic: all assertions passed");
```

- [ ] **Step 2: Run tests — expect failure on first parser assertion (still stubbed)**

```bash
cd /Users/admin/data/workspace/claude-skils/journeyman
npx tsx packages/flow-editor/src/properties-panel/AcceptIfBuilder.logic.test.ts
```

Expected: throws `Error: not implemented` from the first `jsonLogicToRules` call.

---

### Task 5: Implement `jsonLogicToRules`

**Files:**
- Modify: `packages/flow-editor/src/properties-panel/AcceptIfBuilder.logic.ts`

- [ ] **Step 1: Replace the stub with the implementation**

Replace the body of `jsonLogicToRules` with:

```ts
export function jsonLogicToRules(value: unknown): BuilderState | null {
  if (!isPlainObject(value)) return null;
  const keys = Object.keys(value);
  if (keys.length !== 1) return null;
  const [k] = keys;
  const v = (value as Record<string, unknown>)[k];

  if (k === "and" || k === "or") {
    if (!Array.isArray(v) || v.length === 0) return null;
    const rules: Rule[] = [];
    for (const item of v) {
      const r = parseRule(item);
      if (!r) return null;
      rules.push(r);
    }
    return { combinator: k, rules };
  }

  const single = parseRule(value);
  if (!single) return null;
  return { combinator: "and", rules: [single] };
}

function parseRule(node: unknown): Rule | null {
  if (!isPlainObject(node)) return null;
  const keys = Object.keys(node);
  if (keys.length !== 1) return null;
  const [op] = keys;
  const arg = (node as Record<string, unknown>)[op];

  // Binary ops with [{var: F}, V]
  if (op === "==" || op === "!=" || op === ">" || op === "<") {
    if (!Array.isArray(arg) || arg.length !== 2) return null;
    const field = varName(arg[0]);
    if (field === null) return null;
    const lit = arg[1];
    if (op === ">" || op === "<") {
      if (typeof lit !== "number") return null;
      return { field, op: op === ">" ? "gt" : "lt", value: String(lit) };
    }
    return {
      field,
      op: op === "==" ? "eq" : "neq",
      value: literalToString(lit),
      valueType: literalType(lit),
    };
  }

  // in: either [{var: F}, [list]] (is one of) or [V, {var: F}] (contains text)
  if (op === "in") {
    if (!Array.isArray(arg) || arg.length !== 2) return null;
    const [a, b] = arg;
    const fieldFromA = varName(a);
    const fieldFromB = varName(b);
    if (fieldFromA !== null && Array.isArray(b)) {
      return { field: fieldFromA, op: "in", value: listToCsv(b) };
    }
    if (fieldFromB !== null && typeof a === "string") {
      return { field: fieldFromB, op: "contains", value: a };
    }
    return null;
  }

  // !: either {!: {var: F}} (is empty) or {!: {in: ...}} (is not one of)
  if (op === "!") {
    const inner = arg;
    const innerField = varName(inner);
    if (innerField !== null) {
      return { field: innerField, op: "empty" };
    }
    if (isPlainObject(inner) && "in" in (inner as object)) {
      const innerArg = (inner as Record<string, unknown>).in;
      if (Array.isArray(innerArg) && innerArg.length === 2) {
        const f = varName(innerArg[0]);
        if (f !== null && Array.isArray(innerArg[1])) {
          return { field: f, op: "nin", value: listToCsv(innerArg[1]) };
        }
      }
    }
    return null;
  }

  // !!: is not empty
  if (op === "!!") {
    const f = varName(arg);
    if (f !== null) return { field: f, op: "notEmpty" };
    return null;
  }

  return null;
}

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function varName(x: unknown): string | null {
  if (!isPlainObject(x)) return null;
  const keys = Object.keys(x);
  if (keys.length !== 1 || keys[0] !== "var") return null;
  const v = x.var;
  return typeof v === "string" ? v : null;
}

function literalToString(x: unknown): string {
  if (x === null || x === undefined) return "";
  return typeof x === "string" ? x : String(x);
}

function literalType(x: unknown): ValueType | undefined {
  if (typeof x === "number") return "number";
  if (typeof x === "boolean") return "boolean";
  return undefined;
}

function listToCsv(list: unknown[]): string {
  return list.map(item => (typeof item === "string" ? item : String(item))).join(", ");
}
```

- [ ] **Step 2: Run tests — expect all to pass**

```bash
cd /Users/admin/data/workspace/claude-skils/journeyman
npx tsx packages/flow-editor/src/properties-panel/AcceptIfBuilder.logic.test.ts
```

Expected output ends with: `AcceptIfBuilder.logic: all assertions passed`

---

### Task 6: Build the `AcceptIfBuilder` component

**Files:**
- Create: `packages/flow-editor/src/properties-panel/AcceptIfBuilder.tsx`

- [ ] **Step 1: Write the component**

```tsx
// packages/flow-editor/src/properties-panel/AcceptIfBuilder.tsx

import { useEffect, useMemo, useState } from "react";
import {
  OPERATORS,
  rulesToJsonLogic,
  jsonLogicToRules,
  ruleError,
  type BuilderState,
  type Operator,
  type Rule,
  type ValueType,
} from "./AcceptIfBuilder.logic.ts";

interface Props {
  value: unknown | undefined;
  knownPaths: string[];
  readOnly?: boolean;
  onChange: (value: unknown | undefined) => void;
  datalistId: string;
}

type Mode = "builder" | "advanced";

const EMPTY_STATE: BuilderState = { combinator: "and", rules: [] };

export function AcceptIfBuilder({ value, knownPaths, readOnly, onChange, datalistId }: Props) {
  const initial = useMemo(() => deriveInitial(value), [/* mount-only */]);
  const [mode, setMode] = useState<Mode>(initial.mode);
  const [builder, setBuilder] = useState<BuilderState>(initial.state);
  const [draft, setDraft] = useState<string>(initial.draft);
  const [advancedError, setAdvancedError] = useState<string | null>(null);

  // Push builder changes upstream.
  useEffect(() => {
    if (mode !== "builder") return;
    onChange(rulesToJsonLogic(builder));
  }, [mode, builder]);

  const switchTo = (next: Mode) => {
    if (next === mode) return;
    if (next === "advanced") {
      const json = rulesToJsonLogic(builder);
      setDraft(json === undefined ? "" : JSON.stringify(json, null, 2));
      setAdvancedError(null);
      setMode("advanced");
      return;
    }
    // advanced → builder
    if (draft.trim() === "") {
      setBuilder(EMPTY_STATE);
      onChange(undefined);
      setAdvancedError(null);
      setMode("builder");
      return;
    }
    try {
      const parsedJson = JSON.parse(draft);
      const parsedState = jsonLogicToRules(parsedJson);
      if (!parsedState) {
        setAdvancedError("This expression is too complex for the visual builder. Edit as JSON or clear to use the builder.");
        return;
      }
      setBuilder(parsedState);
      onChange(parsedJson);
      setAdvancedError(null);
      setMode("builder");
    } catch (e) {
      setAdvancedError(e instanceof Error ? e.message : String(e));
    }
  };

  const onDraftChange = (text: string) => {
    setDraft(text);
    if (text.trim() === "") {
      onChange(undefined);
      setAdvancedError(null);
      return;
    }
    try {
      const parsed = JSON.parse(text);
      onChange(parsed);
      setAdvancedError(null);
    } catch (e) {
      setAdvancedError(e instanceof Error ? e.message : String(e));
    }
  };

  const setRule = (idx: number, patch: Partial<Rule>) => {
    setBuilder(prev => ({
      ...prev,
      rules: prev.rules.map((r, i) => (i === idx ? { ...r, ...patch } : r)),
    }));
  };

  const removeRule = (idx: number) => {
    setBuilder(prev => ({ ...prev, rules: prev.rules.filter((_, i) => i !== idx) }));
  };

  const addRule = () => {
    setBuilder(prev => ({
      ...prev,
      rules: [...prev.rules, { field: "", op: "eq", value: "" }],
    }));
  };

  return (
    <div className="je-acceptif">
      <div className="je-acceptif__header">
        <span className="je-acceptif__mode">
          <button
            type="button"
            className={"je-acceptif__modebtn" + (mode === "builder" ? " je-acceptif__modebtn--on" : "")}
            disabled={readOnly}
            onClick={() => switchTo("builder")}
          >Visual</button>
          <button
            type="button"
            className={"je-acceptif__modebtn" + (mode === "advanced" ? " je-acceptif__modebtn--on" : "")}
            disabled={readOnly}
            onClick={() => switchTo("advanced")}
          >JSON</button>
        </span>
      </div>

      {mode === "builder" ? (
        <>
          <div className="je-acceptif__combinator">
            Match&nbsp;
            <select
              value={builder.combinator}
              disabled={readOnly || builder.rules.length < 2}
              onChange={e => setBuilder(prev => ({ ...prev, combinator: e.target.value as "and" | "or" }))}
            >
              <option value="and">All</option>
              <option value="or">Any</option>
            </select>
            &nbsp;of the following:
          </div>

          {builder.rules.length === 0 && (
            <div className="je-humantask__empty">No conditions — webhook payloads are accepted as-is.</div>
          )}

          {builder.rules.map((rule, idx) => {
            const err = ruleError(rule);
            const meta = OPERATORS.find(o => o.op === rule.op)!;
            return (
              <div
                key={idx}
                className={"je-acceptif__rule" + (err ? " je-acceptif__rule--invalid" : "")}
              >
                <input
                  type="text"
                  list={datalistId}
                  value={rule.field}
                  placeholder="field path"
                  disabled={readOnly}
                  onChange={e => setRule(idx, { field: e.target.value })}
                  style={{ flex: 2 }}
                />
                <select
                  value={rule.op}
                  disabled={readOnly}
                  onChange={e => setRule(idx, { op: e.target.value as Operator, value: "" })}
                  style={{ flex: 1 }}
                >
                  {OPERATORS.map(o => (
                    <option key={o.op} value={o.op}>{o.label}</option>
                  ))}
                </select>
                {meta.hasValue && (
                  <input
                    type="text"
                    value={rule.value ?? ""}
                    placeholder={meta.valueShape === "csv" ? "value1, value2, …" : "value"}
                    disabled={readOnly}
                    onChange={e => setRule(idx, { value: e.target.value })}
                    style={{ flex: 2 }}
                  />
                )}
                {meta.op === "eq" || meta.op === "neq" ? (
                  <select
                    value={rule.valueType ?? "string"}
                    disabled={readOnly}
                    onChange={e =>
                      setRule(idx, {
                        valueType: (e.target.value as ValueType) === "string"
                          ? undefined
                          : (e.target.value as ValueType),
                      })
                    }
                    title="Value type"
                  >
                    <option value="string">text</option>
                    <option value="number">number</option>
                    <option value="boolean">bool</option>
                  </select>
                ) : null}
                {!readOnly && (
                  <button
                    type="button"
                    className="je-humantask__chip-x"
                    aria-label="Remove condition"
                    onClick={() => removeRule(idx)}
                  >×</button>
                )}
                {err && <div className="je-acceptif__rule-err">{err}</div>}
              </div>
            );
          })}

          {!readOnly && (
            <button
              type="button"
              className="je-humantask__btn"
              onClick={addRule}
              style={{ marginTop: 6 }}
            >+ Add condition</button>
          )}
        </>
      ) : (
        <div className="je-acceptif__advanced">
          <textarea
            rows={6}
            value={draft}
            disabled={readOnly}
            placeholder='{"==": [{"var": "issue.fields.status.name"}, "Done"]}'
            onChange={e => onDraftChange(e.target.value)}
          />
          {advancedError && <p className="je-hint je-hint--error">{advancedError}</p>}
        </div>
      )}
    </div>
  );
}

function deriveInitial(value: unknown): { mode: Mode; state: BuilderState; draft: string } {
  if (value === undefined || value === null) {
    return { mode: "builder", state: EMPTY_STATE, draft: "" };
  }
  const parsed = jsonLogicToRules(value);
  if (parsed) {
    return { mode: "builder", state: parsed, draft: JSON.stringify(value, null, 2) };
  }
  return { mode: "advanced", state: EMPTY_STATE, draft: JSON.stringify(value, null, 2) };
}
```

---

### Task 7: Wire `AcceptIfBuilder` into `ControlNodeConfigTab.tsx`

**Files:**
- Modify: `packages/flow-editor/src/properties-panel/ControlNodeConfigTab.tsx`

- [ ] **Step 1: Add the import**

Add to the existing import block at the top of the file:

```ts
import { AcceptIfBuilder } from "./AcceptIfBuilder.tsx";
```

- [ ] **Step 2: Remove the now-unused `acceptIfDraft` / `acceptIfError` state**

Delete these lines (currently at `ControlNodeConfigTab.tsx:165-168`):

```ts
  const [acceptIfDraft, setAcceptIfDraft] = useState<string>(
    cfg.acceptIf ? JSON.stringify(cfg.acceptIf, null, 2) : "",
  );
  const [acceptIfError, setAcceptIfError] = useState<string | null>(null);
```

If `useState` is no longer used elsewhere in the file, also remove it from the `react` import. (Verify by searching for other `useState` calls in this file before removing the import symbol.)

- [ ] **Step 3: Replace the Accept-if textarea block**

Find the block starting `<label className="je-field__label">Accept if (JSONLogic, optional)</label>` (around line 291) and ending at the closing `</div>` of its enclosing `<div className="je-field">` (around line 316 — the block also contains the `Filter incoming webhooks by payload values...` hint).

Replace the entire block with:

```tsx
      <div className="je-field">
        <label className="je-field__label">Accept if (optional)</label>
        <AcceptIfBuilder
          value={cfg.acceptIf}
          knownPaths={Array.from(new Set(
            outputs.map(o => o.fromPath?.trim()).filter((p): p is string => !!p)
          ))}
          readOnly={readOnly}
          datalistId={`acceptif-paths-${node.id}`}
          onChange={next => update({ acceptIf: next })}
        />
        <datalist id={`acceptif-paths-${node.id}`}>
          {Array.from(new Set(
            outputs.map(o => o.fromPath?.trim()).filter((p): p is string => !!p)
          )).map(p => <option key={p} value={p} />)}
        </datalist>
        <p className="je-hint">
          Filter incoming webhooks by payload values. Use the visual builder or switch to JSON for advanced expressions.
        </p>
      </div>
```

---

### Task 8: Append CSS

**Files:**
- Modify: `packages/flow-editor/src/styles.css`

- [ ] **Step 1: Append the new rules at the end of the file**

```css
/* Accept-If builder */
.je-acceptif { display: flex; flex-direction: column; gap: 8px; }
.je-acceptif__header { display: flex; justify-content: flex-end; }
.je-acceptif__mode { display: inline-flex; border: 1px solid #2a2a3e; border-radius: 4px; overflow: hidden; }
.je-acceptif__modebtn {
  padding: 4px 10px;
  font-size: 11px;
  background: transparent;
  border: none;
  color: #c8c8d4;
  cursor: pointer;
  font-family: inherit;
}
.je-acceptif__modebtn--on { background: #2a2a3e; color: #fff; }
.je-acceptif__modebtn[disabled] { opacity: 0.5; cursor: not-allowed; }
.je-acceptif__combinator { color: #c8c8d4; font-size: 12px; display: flex; align-items: center; }
.je-acceptif__combinator select { width: auto; padding: 2px 6px; }
.je-acceptif__rule {
  display: flex; flex-wrap: wrap; align-items: center; gap: 6px;
  padding: 6px; border: 1px solid #2a2a3e; border-radius: 4px; background: #0f0f1e;
}
.je-acceptif__rule--invalid { border-color: #ff7675; }
.je-acceptif__rule > input[type="text"],
.je-acceptif__rule > select {
  width: auto;
  min-width: 0;
}
.je-acceptif__rule-err { color: #ff7675; font-size: 11px; flex-basis: 100%; }
.je-acceptif__advanced textarea { width: 100%; min-height: 100px; font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 11px; }
```

---

### Task 9: Verify — typecheck and run tests

- [ ] **Step 1: Run unit tests**

```bash
cd /Users/admin/data/workspace/claude-skils/journeyman
npx tsx packages/flow-editor/src/properties-panel/AcceptIfBuilder.logic.test.ts
```

Expected output ends with: `AcceptIfBuilder.logic: all assertions passed`

- [ ] **Step 2: Run typecheck across the workspace**

```bash
cd /Users/admin/data/workspace/claude-skils/journeyman
npm run typecheck
```

Expected: completes with no errors. (If `flow-editor` reports issues only inside the new files, fix them in place; if other packages report errors that existed before, note them but do not chase them in this plan.)

- [ ] **Step 3: Report status to the user**

Summarize:
- Tests: pass / fail (paste tail of output)
- Typecheck: pass / fail (paste any error lines)
- Files created/modified (the list at the top of this plan)

Do not commit. The user will review and commit separately.

---

## Self-review notes

- **Spec coverage:** every section of the spec maps to a task — types (Task 1), serializer (Tasks 2–3), parser (Tasks 4–5), component including mode switching, field autocomplete, value coercion UI (Task 6), wiring + read-only handling via prop pass-through (Task 7), CSS including the width-collapse fix for `.je-acceptif__rule` (Task 8).
- **Excluded from v1 (per spec non-goals):** nested groups, custom operators, payload sampling. Not in any task.
- **Test framework:** `node:assert/strict` + `tsx` matches the existing convention in this monorepo (see `packages/coding-cli/src/providers/claude/utils/session.test.ts`). No new dev dependencies.
- **No commits:** per user request, no `git commit` steps anywhere in the plan.
