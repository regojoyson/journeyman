import type { WorkflowGraph, WorkflowEdge } from "@journeyman/core";

export interface ForkJoinPair {
  forkId: string;
  joinId: string;
  /** Map of branchHeadNodeId → ordered list of node ids in that branch (excludes join). */
  branches: Map<string, string[]>;
}

export interface PairDetectionResult {
  pairs: ForkJoinPair[];
  unpairedForks: Array<{ forkId: string; reason: string }>;
  orphanJoins: string[];
}

/**
 * Detect Fork↔Join pairings in a graph by walking outgoing edges from each
 * `gateway-and` node. Pure: no mutation, no I/O.
 */
export function findForkJoinPairs(graph: WorkflowGraph): PairDetectionResult {
  const outgoing = new Map<string, WorkflowEdge[]>();
  const incoming = new Map<string, WorkflowEdge[]>();
  for (const e of graph.edges) {
    const o = outgoing.get(e.source); if (o) o.push(e); else outgoing.set(e.source, [e]);
    const i = incoming.get(e.target); if (i) i.push(e); else incoming.set(e.target, [e]);
  }
  const nodesById = new Map(graph.nodes.map(n => [n.id, n]));

  const defaultOutCount = new Map<string, number>();
  for (const e of graph.edges) {
    if ((e.type ?? "default") !== "default") continue;
    defaultOutCount.set(e.source, (defaultOutCount.get(e.source) ?? 0) + 1);
  }

  const pairs: ForkJoinPair[] = [];
  const unpairedForks: Array<{ forkId: string; reason: string }> = [];
  const pairedJoinIds = new Set<string>();

  for (const node of graph.nodes) {
    if ((defaultOutCount.get(node.id) ?? 0) < 2) continue;

    const forkOuts = (outgoing.get(node.id) ?? []).filter(
      e => (e.type ?? "default") === "default",
    );
    if (forkOuts.length < 2) {
      unpairedForks.push({ forkId: node.id, reason: "fewer than 2 outgoing branches" });
      continue;
    }

    const branches = new Map<string, string[]>();
    const joinCandidates = new Set<string>();
    let walkError: string | null = null;

    for (const e of forkOuts) {
      const path: string[] = [];
      let cur: string | null = e.target;
      const visited = new Set<string>();
      let joinHit: string | null = null;

      while (cur !== null && !visited.has(cur)) {
        const here: string = cur;
        visited.add(here);
        const curNode = nodesById.get(here);
        if (!curNode) { walkError = `branch from ${node.id} references unknown node ${here}`; break; }
        if (curNode.type === "join") { joinHit = here; break; }
        if (curNode.type === "end") { walkError = `branch from ${node.id} reaches end ${here} without a join`; break; }
        path.push(here);
        const nextEdges: WorkflowEdge[] = outgoing.get(here) ?? [];
        if (nextEdges.length === 0) { walkError = `branch from ${node.id} terminates at ${here} without a join`; break; }
        cur = nextEdges[0].target;
      }

      if (walkError) break;
      if (!joinHit) {
        walkError = `branch from ${node.id} starting at ${e.target} did not reach a join`;
        break;
      }
      joinCandidates.add(joinHit);
      branches.set(e.target, path);
    }

    if (walkError) {
      unpairedForks.push({ forkId: node.id, reason: walkError });
      continue;
    }
    if (joinCandidates.size !== 1) {
      unpairedForks.push({
        forkId: node.id,
        reason: `branches converge on multiple joins: ${[...joinCandidates].join(", ")}`,
      });
      continue;
    }
    const joinId = [...joinCandidates][0];

    const joinIncoming = incoming.get(joinId) ?? [];
    if (joinIncoming.length !== forkOuts.length) {
      unpairedForks.push({
        forkId: node.id,
        reason: `join ${joinId} has ${joinIncoming.length} incoming edges, expected ${forkOuts.length}`,
      });
      continue;
    }

    pairs.push({ forkId: node.id, joinId, branches });
    pairedJoinIds.add(joinId);
  }

  const orphanJoins = graph.nodes
    .filter(n => n.type === "join" && !pairedJoinIds.has(n.id))
    .map(n => n.id);

  return { pairs, unpairedForks, orphanJoins };
}
