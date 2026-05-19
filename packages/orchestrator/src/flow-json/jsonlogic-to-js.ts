import type { JsonLogicExpr, WorkflowEdge } from "@journeyman/core";

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
    const stepRef = path.match(PHASE_PATH);
    if (stepRef) {
      const [, root, rest] = stepRef;
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

  const keys = Object.keys(expr);
  if (keys.length !== 1) throw new Error(`JsonLogic op object must have exactly one key, got: ${keys.join(",")}`);
  const op = keys[0]!;
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
export function compileSwitchExpression(edges: WorkflowEdge[]): {
  expression: string;
  inputParameters: Record<string, string>;
} {
  if (edges.length === 0) {
    return { expression: `"default"`, inputParameters: {} };
  }

  const allRoots = new Set<string>();
  const fragments: Array<{ js: string; roots: Set<string>; label: string }> = [];

  for (const e of edges) {
    if (e.condition === undefined) {
      throw new Error(`Edge ${e.id} is conditional but has no condition`);
    }
    if (!e.branchLabel) {
      throw new Error(`Edge ${e.id} requires a branchLabel`);
    }
    const { js, roots } = compileJsonLogic(e.condition);
    for (const r of roots) allRoots.add(r);
    fragments.push({ js, roots, label: e.branchLabel });
  }

  // Wrap each fragment with optional-chain guards on every referenced root.
  const guarded = fragments.map(f => {
    const guard = [...f.roots].map(r => `$.${r}`).join(" && ");
    const cond = guard ? `${guard} && ${f.js}` : f.js;
    return `${cond} ? ${JSON.stringify(f.label)}`;
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
