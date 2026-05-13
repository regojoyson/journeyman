import { kindForPhaseType } from "@journeyman/core";
import type { WorkflowNode, WorkflowDefaults, RetryPolicy } from "@journeyman/core";

export type FieldSources = Record<string, "node" | "workflow-default">;

/**
 * Merge workflow-level defaults into a single phase node.
 * Returns the resolved node and a sources map for traceability.
 * Only called for `phase` nodes — start/end/gateway nodes are unaffected.
 */
export function applyWorkflowDefaults(
  node: WorkflowNode,
  defaults: WorkflowDefaults | undefined,
): { resolved: WorkflowNode; sources: FieldSources } {
  if (!defaults) return { resolved: node, sources: {} };

  const sources: FieldSources = {};

  const phaseKind      = node.phaseType ? kindForPhaseType(node.phaseType) : undefined;
  const kindDefault    = phaseKind ? defaults.executorConfig?.[phaseKind] : undefined;

  const retry          = mergeRetry(node.retry, defaults.retry, sources);
  const executorConfig = mergeExecutorConfig(node.executorConfig, kindDefault, sources);
  const model          = mergeModel(node.model, defaults.defaultModel, sources);

  return {
    resolved: { ...node, retry, executorConfig, model },
    sources,
  };
}

function mergeModel(
  nodeModel: string | null | undefined,
  defaultModel: string | undefined,
  sources: FieldSources,
): string | null | undefined {
  if (nodeModel) { sources["model"] = "node"; return nodeModel; }
  if (defaultModel) { sources["model"] = "workflow-default"; return defaultModel; }
  return undefined;
}

function mergeRetry(
  node: RetryPolicy | null | undefined,
  def: RetryPolicy | undefined,
  sources: FieldSources,
): RetryPolicy | undefined {
  if (node === null) return undefined;
  if (!def) return node ?? undefined;
  if (!node) {
    sources["retry"] = "workflow-default";
    return def;
  }
  sources["retry"] = "node";
  return { ...def, ...node };
}

function mergeExecutorConfig(
  node: { provider?: string } | null | undefined,
  def: { provider?: string } | undefined,
  sources: FieldSources,
): { provider?: string } | undefined {
  if (node === null) return undefined;
  if (!def) return node ?? undefined;
  if (!node) {
    sources["executorConfig"] = "workflow-default";
    return def;
  }
  sources["executorConfig"] = "node";
  return { ...def, ...node };
}

