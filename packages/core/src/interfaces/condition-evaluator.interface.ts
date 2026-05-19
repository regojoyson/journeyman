export interface IConditionEvaluator {
  /** Returns the boolean result of evaluating `expression` against `data`. */
  evaluate(expression: unknown, data: Record<string, unknown>): boolean;
}
