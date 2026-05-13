import type { WorkflowGraph, WorkflowEdge } from "../types/flow.types.ts";

/**
 * Map of node id → outgoing edges, built once from a graph.
 * Pass to `findConvergence` / `walkReachable` to avoid rebuilding per call.
 */
export type OutgoingEdgeMap = Map<string, WorkflowEdge[]>;

export function buildOutgoingEdgeMap(graph: WorkflowGraph): OutgoingEdgeMap {
  const out: OutgoingEdgeMap = new Map();
  for (const e of graph.edges) {
    const list = out.get(e.source);
    if (list) list.push(e);
    else out.set(e.source, [e]);
  }
  return out;
}

/**
 * Walk forward through outgoing edges starting at `start`, returning every
 * reachable node id (inclusive of `start`). Cycle-safe.
 */
export function walkReachable(start: string, outgoing: OutgoingEdgeMap): Set<string> {
  const seen = new Set<string>();
  const stack = [start];
  while (stack.length) {
    const cur = stack.pop()!;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const e of outgoing.get(cur) ?? []) {
      if (!seen.has(e.target)) stack.push(e.target);
    }
  }
  return seen;
}

/**
 * Given the heads of N parallel branches, return the first node id that all
 * branches reach (the join / convergence point), or null if the branches
 * never converge.
 */
export function findConvergence(branchHeads: string[], outgoing: OutgoingEdgeMap): string | null {
  if (branchHeads.length === 0) return null;
  const visitedPerBranch = branchHeads.map(h => walkReachable(h, outgoing));
  const intersection = [...visitedPerBranch[0]].filter(id =>
    visitedPerBranch.every(s => s.has(id)),
  );
  if (intersection.length === 0) return null;
  intersection.sort();
  return intersection[0] ?? null;
}
