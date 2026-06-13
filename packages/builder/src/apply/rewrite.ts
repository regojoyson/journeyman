import type { WorkflowGraph } from "@journeyman/core";

/**
 * Return a copy of `graph` with every `custom-ai` node's `config.customStepId`
 * replaced according to `placeholderToReal`. Ids absent from the map are left
 * as-is. The input graph is not mutated.
 */
export function rewriteCustomStepIds(
  graph: WorkflowGraph,
  placeholderToReal: Record<string, string>,
): WorkflowGraph {
  const nodes = graph.nodes.map((n) => {
    if (n.type !== "step" || n.stepType !== "custom-ai") return n;
    const current = (n.config as { customStepId?: unknown } | undefined)?.customStepId;
    if (typeof current !== "string") return n;
    const real = placeholderToReal[current];
    if (!real) return n;
    return { ...n, config: { ...(n.config ?? {}), customStepId: real } };
  });
  return { ...graph, nodes };
}
