import jsonLogic from "json-logic-js";
import type { IConditionEvaluator } from "@journeyman/core";

/**
 * Normalize a JSONLogic `var` path to json-logic-js's dot-only form, matching
 * the project's `$.`/`[n]` path standard (same convention as `readPath`):
 *   - trim surrounding whitespace
 *   - strip a leading `$.`; a lone `$` becomes "" (whole-document var)
 *   - convert `[n]` array indexes to `.n` (json-logic indexes arrays by the
 *     numeric-string key, e.g. data["0"])
 */
export function normalizeVarPath(path: string): string {
  let p = path.trim();
  if (p === "$") return "";
  if (p.startsWith("$.")) p = p.slice(2);
  // "labels[0]" → "labels.0"; "a[1][2]" → "a.1.2"
  p = p.replace(/\[(\d+)\]/g, ".$1");
  return p;
}

/**
 * Recursively rewrite every `{ var: <string> }` node in a JSONLogic expression
 * via `normalizeVarPath`. Pure — returns a new tree, never mutates the input.
 */
export function normalizeVarsInExpr(expr: unknown): unknown {
  if (Array.isArray(expr)) return expr.map(normalizeVarsInExpr);
  if (expr && typeof expr === "object") {
    const obj = expr as Record<string, unknown>;
    const keys = Object.keys(obj);
    if (keys.length === 1 && keys[0] === "var" && typeof obj.var === "string") {
      return { var: normalizeVarPath(obj.var) };
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) out[k] = normalizeVarsInExpr(v);
    return out;
  }
  return expr;
}

export class JsonLogicEvaluator implements IConditionEvaluator {
  evaluate(expression: unknown, data: Record<string, unknown>): boolean {
    if (expression == null) return false;
    return Boolean(jsonLogic.apply(normalizeVarsInExpr(expression) as any, data));
  }
}
