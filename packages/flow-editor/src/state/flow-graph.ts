import { WORKFLOW_SCHEMA_VERSION, type WorkflowEdge, type WorkflowGraph, type WorkflowNode } from "@journeyman/core";

export function createBlankFlow(): WorkflowGraph {
  return {
    schemaVersion: WORKFLOW_SCHEMA_VERSION,
    // Horizontal layout: start on the left, end on the right.
    nodes: [
      { id: "start", type: "start", position: { x: 80,  y: 200 } },
      { id: "end",   type: "end",   position: { x: 480, y: 200 } },
    ],
    edges: [
      { id: "e_start_end", source: "start", target: "end" },
    ],
  };
}

export function newPhaseNode(args: {
  phaseType: string;
  displayName: string;
  position: { x: number; y: number };
}): WorkflowNode {
  return {
    id: `step_${Math.random().toString(36).slice(2, 8)}`,
    type: "phase",
    phaseType: args.phaseType,
    displayName: args.displayName,
    config: {},
    position: args.position,
  };
}

export function newEdge(source: string, target: string): WorkflowEdge {
  return {
    id: `e_${source}_${target}_${Math.random().toString(36).slice(2, 6)}`,
    source,
    target,
  };
}

/**
 * Phase 2 validity check: exactly one start, exactly one end, every node
 * connected, no cycles, every node has at most one outgoing edge.
 */
export function isLinearAndComplete(flow: WorkflowGraph): { ok: boolean; reason?: string } {
  const starts = flow.nodes.filter(n => n.type === "start");
  if (starts.length !== 1) return { ok: false, reason: "Flow must have exactly one start node" };
  const ends = flow.nodes.filter(n => n.type === "end");
  if (ends.length === 0) return { ok: false, reason: "Flow must have at least one end node" };

  const outgoing = new Map<string, string[]>();
  for (const e of flow.edges) {
    const arr = outgoing.get(e.source) ?? [];
    arr.push(e.target);
    outgoing.set(e.source, arr);
  }
  for (const n of flow.nodes) {
    const out = outgoing.get(n.id) ?? [];
    if (n.type === "end" && out.length > 0) return { ok: false, reason: `End node has outgoing edges` };
    if (n.type !== "end" && out.length > 1) return { ok: false, reason: `Node ${n.id} has multiple outputs (Phase 2 is linear-only)` };
    if (n.type !== "end" && out.length === 0) return { ok: false, reason: `Node ${n.id} has no outgoing edge` };
  }

  const visited = new Set<string>();
  let cur: string | undefined = starts[0].id;
  while (cur) {
    if (visited.has(cur)) return { ok: false, reason: "Flow contains a cycle" };
    visited.add(cur);
    const next: string | undefined = (outgoing.get(cur) ?? [])[0];
    if (!next) break;
    cur = next;
  }
  if (visited.size !== flow.nodes.length) {
    return { ok: false, reason: "Some nodes are unreachable from start" };
  }
  return { ok: true };
}

export { isValidPhase4Graph } from "./validation.ts";
