import type { WorkflowGraph, WorkflowNode } from "@journeyman/core";
import { isJsonLogicExpr, isTriggerNode, validateForkJoinPairs, validatePauseNodeOutputNames } from "@journeyman/core";

export interface ValidationIssue {
  severity: "error" | "warning";
  message: string;
  nodeId?: string;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
  /** Flat message list — preserved so the topbar banner keeps working. */
  errors: string[];
}

/** Friendly label: `'Display Name' (node_id)` when displayName exists, else `'node_id'`. */
function nodeLabel(n: WorkflowNode): string {
  const name = n.displayName?.trim();
  return name ? `'${name}' (${n.id})` : `'${n.id}'`;
}

export function isValidPhase4Graph(flow: WorkflowGraph): ValidationResult {
  const _t0 = performance.now();
  const issues: ValidationIssue[] = [];
  const push = (severity: "error" | "warning", message: string, nodeId?: string) => {
    issues.push({ severity, message, nodeId });
  };
  const starts = flow.nodes.filter(n => isTriggerNode(n));
  if (starts.length === 0) push("error", "Flow must have at least one trigger node");
  const manualCount = starts.filter(n => n.type === "trigger-manual").length;
  if (manualCount > 1) push("error", "Flow may declare at most one manual trigger");
  if (flow.nodes.filter(n => n.type === "end").length === 0) {
    push("error", "Flow must have at least one end node");
  }

  const out = new Map<string, number>();
  const inn = new Map<string, number>();
  for (const e of flow.edges) {
    out.set(e.source, (out.get(e.source) ?? 0) + 1);
    inn.set(e.target, (inn.get(e.target) ?? 0) + 1);
  }
  for (const n of flow.nodes) {
    if (n.type === "end") {
      if ((out.get(n.id) ?? 0) > 0) push("error", `End ${nodeLabel(n)} has outgoing edges`, n.id);
    }
    if (n.type === "gateway-xor" || n.type === "if") {
      if ((out.get(n.id) ?? 0) < 2) push("error", `Gateway/If ${nodeLabel(n)} needs at least 2 branches`, n.id);
    }
    if (n.type === "step" && !n.stepType) {
      push("error", `Step node ${nodeLabel(n)} is missing a step type`, n.id);
    }
    if (n.type === "subflow" && !(n.config as { workflowName?: string } | undefined)?.workflowName) {
      push("error", `Subflow ${nodeLabel(n)} is missing config.workflowName`, n.id);
    }
    for (const p of validatePauseNodeOutputNames(n)) {
      push("error", `Output '${p.name}' on ${nodeLabel(n)}: ${p.message}`, n.id);
    }
  }

  for (const node of flow.nodes) {
    if (node.type !== "gateway-xor" && node.type !== "if") continue;
    const outs = flow.edges.filter(e => e.source === node.id);
    const labels = new Set<string>();
    for (const e of outs) {
      if (e.type !== "conditional") continue;
      if (!e.branchLabel) {
        push("error", `Edge ${e.id} on gateway ${nodeLabel(node)} requires a branchLabel`, node.id);
      } else if (labels.has(e.branchLabel)) {
        push("error", `Duplicate branchLabel '${e.branchLabel}' on gateway ${nodeLabel(node)}`, node.id);
      } else {
        labels.add(e.branchLabel);
      }
      if (e.condition === undefined) {
        push("error", `Edge ${e.id} on gateway ${nodeLabel(node)} is conditional but has no condition`, node.id);
      } else if (!isJsonLogicExpr(e.condition)) {
        push("error", `Edge ${e.id} on gateway ${nodeLabel(node)} has an invalid condition shape`, node.id);
      }
    }
  }

  for (const e of validateForkJoinPairs(flow)) {
    push("error", e.message, e.nodeId);
  }

  // Multi-incoming check (mirrors the server-side rule in validate-for-publish).
  // Only Join and End may have multiple default incoming edges; triggers must
  // have zero. Everything else must have ≤1 default incoming, otherwise the
  // runtime can't decide which upstream's output to consume.
  {
    const defaultIncomingCount = new Map<string, number>();
    for (const e of flow.edges) {
      if ((e.type ?? "default") !== "default") continue;
      // Skip edges originating from a trigger — multiple triggers fanning into
      // one downstream step is a legitimate pattern.
      const src = flow.nodes.find(n => n.id === e.source);
      if (src && isTriggerNode(src)) continue;
      defaultIncomingCount.set(e.target, (defaultIncomingCount.get(e.target) ?? 0) + 1);
    }
    for (const node of flow.nodes) {
      if (node.type === "join" || node.type === "end") continue;
      if (isTriggerNode(node)) continue;
      const n = defaultIncomingCount.get(node.id) ?? 0;
      if (n > 1) {
        push(
          "error",
          `${nodeLabel(node)} has ${n} incoming arrows. To merge multiple paths into a single step, add a Join node before it.`,
          node.id,
        );
      }
    }
  }

  if (starts.length === 1) {
    const reachable = new Set<string>();
    const stack: string[] = [starts[0].id];
    while (stack.length) {
      const cur = stack.pop()!;
      if (reachable.has(cur)) continue;
      reachable.add(cur);
      for (const e of flow.edges) if (e.source === cur && !reachable.has(e.target)) stack.push(e.target);
    }
    for (const n of flow.nodes) {
      if (!reachable.has(n.id)) push("warning", `Node ${nodeLabel(n)} is unreachable from start`, n.id);
    }
  }

  const errors = issues.map(i => i.message);
  const _ms = performance.now() - _t0;
  if (_ms > 50) {
    // eslint-disable-next-line no-console
    console.warn(
      `[flow-editor] isValidPhase4Graph slow: ${_ms.toFixed(1)}ms`,
      { nodes: flow.nodes.length, edges: flow.edges.length, errors: errors.length },
    );
  }
  return { ok: issues.every(i => i.severity !== "error"), issues, errors };
}
