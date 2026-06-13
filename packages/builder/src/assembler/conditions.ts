import type { JsonLogicExpr } from "@journeyman/core";
import type { ConditionIntent } from "./intent.ts";

/**
 * Compile a ConditionIntent into a JSONLogic expression, remapping a
 * step-output's intent handle to its assigned node id. Produces a `var` path
 * the converter accepts: `<nodeId>.output.<field>` or `workflow.input.<name>`.
 */
export function compileCondition(
  c: ConditionIntent,
  nodeIdByRef: Record<string, string>,
): JsonLogicExpr {
  const path =
    c.left.from === "step-output"
      ? `${nodeIdByRef[c.left.stepRef] ?? c.left.stepRef}.output.${c.left.field}`
      : `workflow.input.${c.left.name}`;
  return { [c.op]: [{ var: path }, c.right] } as JsonLogicExpr;
}
