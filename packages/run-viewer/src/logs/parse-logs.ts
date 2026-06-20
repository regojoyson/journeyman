import type { WorkflowInstanceEvent, WorkflowNode } from "@journeyman/core";
import type { LogKind, ParsedLog } from "./types.ts";

function classifyLine(line: string): LogKind {
  if (line.startsWith("🤖")) return "assistant";
  if (line.startsWith("🔧")) return "tool";
  if (line.startsWith("📥")) return "tool_result";
  if (line.startsWith("✅")) return "result_ok";
  if (line.startsWith("❌")) return "result_err";
  return "other";
}

function resolveStepName(
  nodeId: string | null,
  nameByNodeId: Map<string, string>,
): string {
  if (!nodeId) return "Workflow";
  return nameByNodeId.get(nodeId) ?? nodeId;
}

function buildNameMap(nodes: WorkflowNode[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const n of nodes) {
    const name = n.displayName ?? n.stepType ?? n.type ?? n.id;
    m.set(n.id, name);
  }
  return m;
}

function formatWorkflowEvent(ev: WorkflowInstanceEvent): string {
  const p = ev.payload as Record<string, unknown>;
  switch (ev.eventType) {
    case "workflow_instance.started":
      return "▶ workflow started";
    case "workflow_instance.completed":
      return "✅ workflow completed";
    case "workflow_instance.failed":
      return `❌ workflow failed${typeof p.error === "string" ? `: ${p.error}` : ""}`;
    case "workflow_instance.cancelled":
      return "⏹ workflow cancelled";
    case "step.started":
      return "▶ step started";
    case "step.completed":
      return "✅ step completed";
    case "step.failed": {
      const reason = typeof p.reason === "string" ? p.reason : null;
      const msg =
        typeof (p.error as any)?.message === "string"
          ? (p.error as any).message
          : typeof p.error === "string"
          ? p.error
          : null;
      const detail = [reason, msg].filter(Boolean).join(" — ");
      return `❌ step failed${detail ? `: ${detail}` : ""}`;
    }
    case "step.retrying":
      return `↻ step retrying${typeof p.attempt === "number" ? ` (attempt ${p.attempt})` : ""}`;
    case "step.skipped":
      return "⤼ step skipped";
    case "node.cycled":
      return "↻ node cycled";
    case "node.waiting":
      return "⏸ node waiting";
    case "node.resolved":
      return "✓ node resolved";
    case "edge.taken":
      return `→ edge taken${typeof p.edgeId === "string" ? ` (${p.edgeId})` : ""}`;
    case "condition.evaluated":
      return `? condition evaluated${typeof p.result !== "undefined" ? ` → ${String(p.result)}` : ""}`;
    case "worker.heartbeat":
      return "♥ worker heartbeat";
    case "task.polled":
      return "… task polled";
    case "task.dispatched":
      return "↗ task dispatched";
    default:
      return ev.eventType;
  }
}

export function parseLogs(
  events: WorkflowInstanceEvent[],
  nodes: WorkflowNode[],
): ParsedLog[] {
  const nameByNodeId = buildNameMap(nodes);
  return events.map((ev): ParsedLog => {
    if (ev.eventType === "step.log") {
      const payload = ev.payload as { line?: string; meta?: Record<string, unknown> };
      const line = payload.line ?? JSON.stringify(payload);
      return {
        id: ev.id,
        ts: ev.ts,
        nodeId: ev.nodeId,
        stepName: resolveStepName(ev.nodeId, nameByNodeId),
        line,
        kind: classifyLine(line),
        meta: payload.meta,
      };
    }
    return {
      id: ev.id,
      ts: ev.ts,
      nodeId: ev.nodeId,
      stepName: resolveStepName(ev.nodeId, nameByNodeId),
      line: formatWorkflowEvent(ev),
      kind: "other",
      meta: ev.payload as Record<string, unknown>,
    };
  });
}
