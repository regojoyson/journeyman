import jsonLogic from "json-logic-js";
import type { IConditionEvaluator } from "@journeyman/core";

export class JsonLogicEvaluator implements IConditionEvaluator {
  evaluate(expression: unknown, data: Record<string, unknown>): boolean {
    if (expression == null) return false;
    return Boolean(jsonLogic.apply(expression as any, data));
  }
}
