import type { WorkflowGraph } from "../types/flow.types.ts";
import { type JoinConfig, type JoinMode, DEFAULT_JOIN_MODE } from "../types/parallel.types.ts";

export interface ForkJoinPairError {
  nodeId: string;
  rule:
    | "join-needs-branch-source"
    | "first-wins-non-pause-branch"
    | "shared-step-across-branches";
  message: string;
}

const PAUSE_NODE_TYPES = new Set(["human-task", "webhook-wait", "timer"]);

/**
 * Pair + topology validation for parallel fork/join. Pure.
 */
export function validateForkJoinPairs(graph: WorkflowGraph): ForkJoinPairError[] {
  const errors: ForkJoinPairError[] = [];

  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();
  for (const e of graph.edges) {
    const o = outgoing.get(e.source); if (o) o.push(e.target); else outgoing.set(e.source, [e.target]);
    const i = incoming.get(e.target); if (i) i.push(e.source); else incoming.set(e.target, [e.source]);
  }
  const nodesById = new Map(graph.nodes.map(n => [n.id, n]));
  const labelFor = (id: string): string => {
    const n = nodesById.get(id);
    const dn = n?.displayName?.trim();
    return dn && dn.length > 0 ? `"${dn}"` : id;
  };

  const defaultOutCount = new Map<string, number>();
  for (const e of graph.edges) {
    if ((e.type ?? "default") !== "default") continue;
    defaultOutCount.set(e.source, (defaultOutCount.get(e.source) ?? 0) + 1);
  }
  const forkIds = graph.nodes
    .filter(n => (defaultOutCount.get(n.id) ?? 0) >= 2)
    .map(n => n.id);
  const joinIds = graph.nodes.filter(n => n.type === "join").map(n => n.id);
  const pairedJoins = new Set<string>();
  const branchOwnership = new Map<string, string>();

  // Walk each multi-out node's branches forward. A branch may reach a Join
  // (parallel sync point), an End (terminates independently), or hit a
  // dead-end (still an error — orphan path). Branches from the same fork
  // may reach different Joins or end directly — these are independent paths.
  for (const forkId of forkIds) {
    const allOuts = graph.edges.filter(e => e.source === forkId);
    const outs = allOuts
      .filter(e => (e.type ?? "default") === "default")
      .map(e => e.target);

    const branchPathsByJoin = new Map<string, Array<{ head: string; path: string[] }>>();

    for (const head of outs) {
      const path: string[] = [];
      const visited = new Set<string>();
      let cur: string | null = head;
      let joinHit: string | null = null;

      while (cur !== null && !visited.has(cur)) {
        const here: string = cur;
        visited.add(here);
        const n = nodesById.get(here);
        if (!n) break;
        if (n.type === "join") { joinHit = here; break; }
        if (n.type === "end") { break; } // independent terminus
        path.push(here);
        // Stop walking when we hit a NESTED fork (a node with 2+ default outs
        // that isn't this fork). The inner fork claims its own region; we
        // shouldn't double-claim its descendants.
        if (here !== forkId && (defaultOutCount.get(here) ?? 0) >= 2) break;
        const nexts: string[] = outgoing.get(here) ?? [];
        cur = nexts.length > 0 ? nexts[0] : null;
      }

      if (joinHit) {
        const arr = branchPathsByJoin.get(joinHit) ?? [];
        arr.push({ head, path });
        branchPathsByJoin.set(joinHit, arr);
      }

      // Branch ownership — still flag steps that appear in multiple forks' branches.
      for (const id of path) {
        const prior = branchOwnership.get(id);
        if (prior && prior !== forkId) {
          errors.push({
            nodeId: id,
            rule: "shared-step-across-branches",
            message: `Node ${labelFor(id)} appears in branches of multiple forks (${labelFor(prior)} and ${labelFor(forkId)}).`,
          });
        } else {
          branchOwnership.set(id, forkId);
        }
      }
    }

    // Per-Join checks: count vs incoming, first-wins branch contents.
    for (const [joinId, branchPaths] of branchPathsByJoin) {
      pairedJoins.add(joinId);
      const joinNode = nodesById.get(joinId);
      const joinCfg = (joinNode?.config ?? {}) as JoinConfig;
      const mode: JoinMode = joinCfg.mode ?? DEFAULT_JOIN_MODE;
      if (mode === "first-wins") {
        for (const { path } of branchPaths) {
          for (const id of path) {
            const n = nodesById.get(id);
            if (!n) continue;
            if (!PAUSE_NODE_TYPES.has(n.type)) {
              errors.push({
                nodeId: id,
                rule: "first-wins-non-pause-branch",
                message: `Node ${labelFor(id)} (${n.type}) cannot appear in a first-wins branch — only pause nodes (human-task, webhook-wait, timer) are allowed in v1.`,
              });
            }
          }
        }
      }
    }
  }

  // A Join needs at least 2 default incoming edges to be meaningful (otherwise
  // it has nothing to coordinate). Joins that no fork branch reaches are also
  // flagged.
  for (const joinId of joinIds) {
    const incomingCount = (incoming.get(joinId) ?? []).length;
    if (incomingCount < 2) {
      errors.push({
        nodeId: joinId,
        rule: "join-needs-branch-source",
        message: `Join ${labelFor(joinId)} needs at least 2 incoming branches.`,
      });
    } else if (!pairedJoins.has(joinId)) {
      errors.push({
        nodeId: joinId,
        rule: "join-needs-branch-source",
        message: `Join ${labelFor(joinId)} has no fork upstream — its incoming branches don't originate from a parallel fork.`,
      });
    }
  }

  return errors;
}
