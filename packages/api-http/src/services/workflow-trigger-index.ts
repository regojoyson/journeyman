import { isTriggerNode } from "@journeyman/core";
import type {
  IWorkflowTriggerStore,
  UpsertWorkflowTriggerArgs,
  WorkflowGraph,
  WorkflowNode,
} from "@journeyman/core";

function rowsFromGraph(
  workflowId: string,
  workflowVersionId: string,
  graph: WorkflowGraph,
): UpsertWorkflowTriggerArgs[] {
  const out: UpsertWorkflowTriggerArgs[] = [];
  for (const n of graph.nodes as WorkflowNode[]) {
    if (!isTriggerNode(n)) continue;
    const kind: "manual" | "webhook" | "human" =
      n.type === "trigger-manual" ? "manual"
      : n.type === "trigger-webhook" ? "webhook"
      : "human";
    const webhookId = kind === "webhook"
      ? ((n.config as { webhookId?: string } | undefined)?.webhookId ?? null)
      : null;
    out.push({ workflowId, workflowVersionId, triggerNodeId: n.id, kind, webhookId });
  }
  return out;
}

/** Refresh + activate trigger rows for a published workflow version. */
export async function refreshTriggerIndexOnPublish(
  store: IWorkflowTriggerStore,
  args: { workflowId: string; workflowVersionId: string; graph: WorkflowGraph },
): Promise<void> {
  const rows = rowsFromGraph(args.workflowId, args.workflowVersionId, args.graph);
  await store.replaceForVersion(args.workflowVersionId, rows);
  await store.setActiveForWorkflow(args.workflowId, args.workflowVersionId);
}

/** Deactivate all trigger rows for an unpublished workflow. */
export async function refreshTriggerIndexOnUnpublish(
  store: IWorkflowTriggerStore,
  args: { workflowId: string },
): Promise<void> {
  await store.setActiveForWorkflow(args.workflowId, null);
}
