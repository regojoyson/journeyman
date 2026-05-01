import { kindForPhaseType } from "@journeyman/core";
import type { FlowNode, FlowDefaults, RetryPolicy, SecretBinding, FlowInputValue } from "@journeyman/core";

export type FieldSources = Record<string, "node" | "flow-default">;

/**
 * Merge workflow-level defaults into a single phase node.
 * Returns the resolved node and a sources map for traceability.
 * Only called for `phase` nodes — start/end/gateway nodes are unaffected.
 */
export function applyFlowDefaults(
  node: FlowNode,
  defaults: FlowDefaults | undefined,
): { resolved: FlowNode; sources: FieldSources } {
  if (!defaults) return { resolved: node, sources: {} };

  const sources: FieldSources = {};

  const phaseKind      = node.phaseType ? kindForPhaseType(node.phaseType) : undefined;
  const kindDefault    = phaseKind ? defaults.executorConfig?.[phaseKind] : undefined;

  const retry          = mergeRetry(node.retry, defaults.retry, sources);
  const executorConfig = mergeExecutorConfig(node.executorConfig, kindDefault, sources);
  const secretBindings = mergeMap(node.secretBindings, defaults.secretBindings, "secretBindings", sources);
  const inputs         = mergeInputs(node.inputs, defaults.inputs, sources);

  return {
    resolved: { ...node, retry, executorConfig, secretBindings, inputs },
    sources,
  };
}

function mergeRetry(
  node: RetryPolicy | null | undefined,
  def: RetryPolicy | undefined,
  sources: FieldSources,
): RetryPolicy | undefined {
  if (node === null) return undefined;
  if (!def) return node ?? undefined;
  if (!node) {
    sources["retry"] = "flow-default";
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
    sources["executorConfig"] = "flow-default";
    return def;
  }
  sources["executorConfig"] = "node";
  return { ...def, ...node };
}

function mergeMap<V>(
  node: Record<string, V> | null | undefined,
  def: Record<string, V> | undefined,
  key: string,
  sources: FieldSources,
): Record<string, V> | undefined {
  if (node === null) return undefined;
  if (!def) return node ?? undefined;
  if (!node) {
    sources[key] = "flow-default";
    return def;
  }
  sources[key] = "node";
  return { ...def, ...node };
}

function mergeInputs(
  node: Record<string, FlowInputValue> | null | undefined,
  def: Record<string, FlowInputValue> | undefined,
  sources: FieldSources,
): Record<string, FlowInputValue> | undefined {
  if (node === null) return undefined;
  if (!def) return node ?? undefined;
  const merged: Record<string, FlowInputValue> = { ...def, ...(node ?? {}) };
  for (const [k, v] of Object.entries(merged)) {
    if (v.kind === "suppress") {
      delete merged[k];
    } else {
      sources[`inputs.${k}`] = node && k in node ? "node" : "flow-default";
    }
  }
  return merged;
}
