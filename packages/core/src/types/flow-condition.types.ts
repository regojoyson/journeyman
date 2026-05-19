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
 * autosuggest. Mirrors the keys orchestrator's emitStep always injects
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
