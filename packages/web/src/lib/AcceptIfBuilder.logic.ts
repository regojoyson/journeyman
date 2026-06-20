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

  if (op === "==" || op === "!=" || op === ">" || op === "<") {
    if (!Array.isArray(arg) || arg.length !== 2) return null;
    const field = varName(arg[0]);
    if (field === null) return null;
    const lit = arg[1];
    if (op === ">" || op === "<") {
      if (typeof lit !== "number") return null;
      return { field, op: op === ">" ? "gt" : "lt", value: String(lit) };
    }
    const r: Rule = {
      field,
      op: op === "==" ? "eq" : "neq",
      value: literalToString(lit),
    };
    const t = literalType(lit);
    if (t) r.valueType = t;
    return r;
  }

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
