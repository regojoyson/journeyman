import type { FlowGraph } from "@journeyman/core";

export interface ValidationResult { ok: boolean; errors: string[]; }

export function isValidPhase4Graph(flow: FlowGraph): ValidationResult {
  const _t0 = performance.now();
  const errors: string[] = [];
  const starts = flow.nodes.filter(n => n.type === "start");
  if (starts.length !== 1) errors.push("Flow must have exactly one start node");
  if (flow.nodes.filter(n => n.type === "end").length === 0) {
    errors.push("Flow must have at least one end node");
  }

  const out = new Map<string, number>();
  const inn = new Map<string, number>();
  for (const e of flow.edges) {
    out.set(e.source, (out.get(e.source) ?? 0) + 1);
    inn.set(e.target, (inn.get(e.target) ?? 0) + 1);
  }
  for (const n of flow.nodes) {
    if (n.type === "end") {
      if ((out.get(n.id) ?? 0) > 0) errors.push(`End '${n.id}' has outgoing edges`);
    }
    if (n.type === "gateway-xor" || n.type === "if") {
      if ((out.get(n.id) ?? 0) < 2) errors.push(`Gateway/If '${n.id}' needs at least 2 branches`);
    }
    if (n.type === "gateway-and") {
      if ((out.get(n.id) ?? 0) < 2) errors.push(`gateway-and '${n.id}' needs at least 2 branches`);
    }
    if (n.type === "phase" && !n.phaseType) {
      errors.push(`Phase node '${n.id}' is missing a phase type`);
    }
    if (n.type === "subflow" && !(n.config as { workflowName?: string } | undefined)?.workflowName) {
      errors.push(`Subflow '${n.id}' is missing config.workflowName`);
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
      if (!reachable.has(n.id)) errors.push(`Node '${n.id}' is unreachable from start`);
    }
  }

  const _ms = performance.now() - _t0;
  if (_ms > 50) {
    // eslint-disable-next-line no-console
    console.warn(
      `[flow-editor] isValidPhase4Graph slow: ${_ms.toFixed(1)}ms`,
      { nodes: flow.nodes.length, edges: flow.edges.length, errors: errors.length },
    );
  }
  return { ok: errors.length === 0, errors };
}
