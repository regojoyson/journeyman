import type { WorkflowGraph } from "../types/flow.types.ts";
import type { JoinConfig, JoinErrorMode } from "../types/parallel.types.ts";

export interface ForkJoinPairError {
  nodeId: string;
  rule:
    | "fork-needs-join"
    | "join-needs-fork"
    | "branch-escapes-to-end"
    | "branches-converge-on-different-joins"
    | "join-incoming-mismatch"
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

  const forkIds = graph.nodes.filter(n => n.type === "gateway-and").map(n => n.id);
  const joinIds = graph.nodes.filter(n => n.type === "join").map(n => n.id);
  const pairedJoins = new Set<string>();
  const branchOwnership = new Map<string, string>();

  for (const forkId of forkIds) {
    const outs = outgoing.get(forkId) ?? [];
    if (outs.length < 2) {
      errors.push({
        nodeId: forkId,
        rule: "fork-needs-join",
        message: `Fork ${forkId} needs at least 2 outgoing branches.`,
      });
      continue;
    }

    const joinCandidates = new Set<string>();
    const branchPaths: Array<{ head: string; path: string[] }> = [];
    let escapedEnd = false;

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
        if (n.type === "end") {
          errors.push({
            nodeId: here,
            rule: "branch-escapes-to-end",
            message: `Branch from fork ${forkId} reaches end ${here} without a join.`,
          });
          escapedEnd = true;
          break;
        }
        path.push(here);
        const nexts: string[] = outgoing.get(here) ?? [];
        cur = nexts.length > 0 ? nexts[0] : null;
      }

      if (joinHit) joinCandidates.add(joinHit);
      branchPaths.push({ head, path });
    }

    if (escapedEnd) continue;

    if (joinCandidates.size === 0) {
      errors.push({
        nodeId: forkId,
        rule: "fork-needs-join",
        message: `Fork ${forkId} has no branch that reaches a join.`,
      });
      continue;
    }
    if (joinCandidates.size > 1) {
      errors.push({
        nodeId: forkId,
        rule: "branches-converge-on-different-joins",
        message: `Fork ${forkId} branches converge on multiple joins: ${[...joinCandidates].join(", ")}.`,
      });
      continue;
    }
    const joinId = [...joinCandidates][0];
    const joinIncoming = incoming.get(joinId) ?? [];
    if (joinIncoming.length !== outs.length) {
      errors.push({
        nodeId: joinId,
        rule: "join-incoming-mismatch",
        message: `Join ${joinId} has ${joinIncoming.length} incoming edges; expected one per branch (${outs.length}).`,
      });
      continue;
    }

    for (const { path } of branchPaths) {
      for (const id of path) {
        const prior = branchOwnership.get(id);
        if (prior && prior !== forkId) {
          errors.push({
            nodeId: id,
            rule: "shared-step-across-branches",
            message: `Node ${id} appears in branches of multiple forks (${prior} and ${forkId}).`,
          });
        } else {
          branchOwnership.set(id, forkId);
        }
      }
    }

    pairedJoins.add(joinId);

    const joinNode = nodesById.get(joinId);
    const joinCfg = (joinNode?.config ?? {}) as JoinConfig;
    const mode: JoinErrorMode = joinCfg.errorMode ?? "fail-fast";
    if (mode === "first-wins") {
      for (const { path } of branchPaths) {
        for (const id of path) {
          const n = nodesById.get(id);
          if (!n) continue;
          if (!PAUSE_NODE_TYPES.has(n.type)) {
            errors.push({
              nodeId: id,
              rule: "first-wins-non-pause-branch",
              message: `Node ${id} (${n.type}) cannot appear in a first-wins branch — only pause nodes (human-task, webhook-wait, timer) are allowed in v1.`,
            });
          }
        }
      }
    }
  }

  for (const joinId of joinIds) {
    if (!pairedJoins.has(joinId)) {
      errors.push({
        nodeId: joinId,
        rule: "join-needs-fork",
        message: `Join ${joinId} has no matching fork.`,
      });
    }
  }

  return errors;
}
