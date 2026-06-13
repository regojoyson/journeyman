import type { WorkflowNodeType } from "../types/flow.types.ts";

/**
 * Node types the Conductor converter actually implements (see
 * `conductor-converter.ts` `emitNode`). Authoritative over the stale
 * "reserved/not-yet-supported" comment in `flow.types.ts`.
 * Only `retry-block` and `try-catch` are NOT supported.
 */
export const SUPPORTED_NODE_TYPES: ReadonlySet<WorkflowNodeType> = new Set<WorkflowNodeType>([
  "trigger-manual",
  "trigger-webhook",
  "trigger-human",
  "end",
  "step",
  "human-task",
  "webhook-wait",
  "gateway-xor",
  "gateway-and",
  "join",
  "loop",
  "subflow",
  "if",
  "timer",
]);

export function isNodeTypeSupported(t: WorkflowNodeType): boolean {
  return SUPPORTED_NODE_TYPES.has(t);
}

export function listSupportedNodeTypes(): WorkflowNodeType[] {
  return [...SUPPORTED_NODE_TYPES];
}

/**
 * A specific provider operation that exists in name but throws at runtime,
 * even though the provider's `implemented` flag is `true`. The Builder consults
 * this deny-list in addition to the per-provider flag so it never proposes a
 * step that validates but fails when run.
 */
export interface UnsupportedOperation {
  /** provider-catalog `value`, e.g. "jira". */
  provider: string;
  /** the interface method that throws, e.g. "transitionIssue". */
  method: string;
  /** catalog step types that invoke this operation. */
  stepTypes: string[];
  /** plain-language reason, used in the gap message. */
  reason: string;
}

export const UNSUPPORTED_OPERATIONS: ReadonlyArray<UnsupportedOperation> = [
  {
    provider: "jira",
    method: "transitionIssue",
    stepTypes: ["transition-issue"],
    reason: "JiraProvider.updateStatus is not implemented yet.",
  },
  {
    provider: "jira",
    method: "commentOnIssue",
    stepTypes: ["comment-on-issue"],
    reason: "JiraProvider.addComment is not implemented yet.",
  },
];

/** Returns the unsupported-operation entry for a (provider, stepType) pair, if any. */
export function unsupportedOperationForStep(
  provider: string,
  stepType: string,
): UnsupportedOperation | undefined {
  return UNSUPPORTED_OPERATIONS.find(
    (o) => o.provider === provider && o.stepTypes.includes(stepType),
  );
}
