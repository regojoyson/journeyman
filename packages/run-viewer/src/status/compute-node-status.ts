import type {
  WorkflowGraph, NodeExecution, WorkflowInstanceEvent, WorkflowInstanceStatus,
} from "@journeyman/core";
import type { NodeStatus, ResolvedNodeStatus } from "../types.ts";

export interface ComputeArgs {
  workflow: WorkflowGraph;
  events: WorkflowInstanceEvent[];
  executions: NodeExecution[];
  workflowInstanceStatus: WorkflowInstanceStatus;
}

export function computeNodeStatuses(args: ComputeArgs): Map<string, ResolvedNodeStatus> {
  const out = new Map<string, ResolvedNodeStatus>();
  for (const n of args.workflow.nodes) {
    out.set(n.id, { status: "pending", attempt: 0, visitCount: 0 });
  }

  const sorted = [...args.events].sort((a, b) => a.id - b.id);
  for (const ev of sorted) {
    const id = ev.nodeId;
    if (!id) continue;
    const cur = out.get(id);
    if (!cur) continue;

    switch (ev.eventType) {
      case "phase.started": {
        cur.status = "running";
        const a = (ev.payload as { attempt?: number }).attempt;
        if (typeof a === "number") cur.attempt = a;
        cur.visitCount += 1;
        cur.startedAt ??= new Date(ev.ts);
        break;
      }
      case "phase.retrying":
        cur.status = "retry-backoff";
        break;
      case "phase.failed":
        cur.status = "failed";
        cur.completedAt = new Date(ev.ts);
        cur.errorClass = (ev.payload as { error?: { errorClass?: string } }).error?.errorClass;
        if (cur.startedAt && cur.completedAt) {
          cur.durationMs = cur.completedAt.getTime() - cur.startedAt.getTime();
        }
        break;
      case "phase.completed":
        cur.status = "completed";
        cur.completedAt = new Date(ev.ts);
        if (cur.startedAt && cur.completedAt) {
          cur.durationMs = cur.completedAt.getTime() - cur.startedAt.getTime();
        }
        break;
      case "node.waiting":
        cur.status = "waiting";
        cur.startedAt ??= new Date(ev.ts);
        break;
      case "node.resolved":
        cur.status = "completed";
        cur.completedAt = new Date(ev.ts);
        if (cur.startedAt && cur.completedAt) {
          cur.durationMs = cur.completedAt.getTime() - cur.startedAt.getTime();
        }
        break;
    }
    out.set(id, cur);
  }

  const terminal =
    args.workflowInstanceStatus === "completed" ||
    args.workflowInstanceStatus === "failed" ||
    args.workflowInstanceStatus === "cancelled";

  if (terminal) {
    for (const [id, v] of out) {
      if (v.status === "pending" || v.status === "running" || v.status === "retry-backoff") {
        const next: NodeStatus =
          args.workflowInstanceStatus === "cancelled" ? "cancelled" :
          v.status === "pending" ? "skipped" :
          v.status;
        if (next !== v.status) out.set(id, { ...v, status: next });
      }
    }
  }

  for (const e of args.executions) {
    const cur = out.get(e.nodeId);
    if (!cur) continue;
    if (e.attempt > cur.attempt) cur.attempt = e.attempt;
    if (!cur.errorClass && e.errorClass) cur.errorClass = e.errorClass;
    out.set(e.nodeId, cur);
  }
  return out;
}
