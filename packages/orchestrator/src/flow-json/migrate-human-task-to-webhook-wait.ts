import type { WorkflowGraph, WorkflowNode } from "@journeyman/core";

/**
 * Read-time migration: any node with type "human-task" that carries the
 * legacy webhook-matching fields (listensFor, acceptIf, or outputs with
 * fromPath) is converted in-memory to a "webhook-wait" node.
 *
 * Pure: returns a new graph; does not mutate input. Stored definitions on
 * disk are unchanged — callers do this on every read.
 */
export function migrateHumanTaskToWebhookWait(graph: WorkflowGraph): WorkflowGraph {
  let changed = false;
  const nodes: WorkflowNode[] = graph.nodes.map((node) => {
    if (node.type !== "human-task") return node;

    const cfg = (node.config ?? {}) as Record<string, unknown>;
    const outputs = Array.isArray(cfg.outputs) ? cfg.outputs as Array<Record<string, unknown>> : [];
    const hasListensFor = Array.isArray(cfg.listensFor) && (cfg.listensFor as unknown[]).length > 0;
    const hasAcceptIf = cfg.acceptIf != null;
    const hasFromPath = outputs.some(o => typeof o.fromPath === "string" && (o.fromPath as string).length > 0);

    if (!hasListensFor && !hasAcceptIf && !hasFromPath) return node;

    const provider = inferProvider(cfg.listensFor as string[] | undefined);

    const nextConfig: Record<string, unknown> = {
      provider,
      correlationKey: "issueRef",
      outputs,
    };
    if (hasListensFor) nextConfig.listensFor = cfg.listensFor;
    if (hasAcceptIf) nextConfig.acceptIf = cfg.acceptIf;
    if (cfg.timeout) nextConfig.timeout = cfg.timeout;

    changed = true;
    return { ...node, type: "webhook-wait", config: nextConfig };
  });

  return changed ? { ...graph, nodes } : graph;
}

function inferProvider(listensFor: string[] | undefined): string {
  if (!listensFor || listensFor.length === 0) return "api";
  const first = listensFor[0];
  if (first.startsWith("jira:")) return "jira";
  if (first.startsWith("linear:") || ["create", "update", "remove"].includes(first)) return "linear";
  if (first.startsWith("monday:")) return "monday";
  if (["pull_request", "pull_request_review", "issues", "issue_comment"].includes(first)) return "github";
  return "api";
}
