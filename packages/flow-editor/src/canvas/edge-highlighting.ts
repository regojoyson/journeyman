import type { WorkflowGraph } from "@journeyman/core";

/**
 * Return the set of edge ids that belong to the Fork/Join pair containing
 * `selectedNodeId`. Empty set if not part of any pair. Pure.
 */
export function edgesForForkJoinPair(graph: WorkflowGraph, selectedNodeId: string | null): Set<string> {
  if (!selectedNodeId) return new Set();
  const node = graph.nodes.find(n => n.id === selectedNodeId);
  if (!node) return new Set();
  if (node.type !== "gateway-and" && node.type !== "join") return new Set();

  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();
  for (const e of graph.edges) {
    const o = outgoing.get(e.source); if (o) o.push(e.target); else outgoing.set(e.source, [e.target]);
    const i = incoming.get(e.target); if (i) i.push(e.source); else incoming.set(e.target, [e.source]);
  }

  let forkId: string | null = null;
  let joinId: string | null = null;
  if (node.type === "gateway-and") {
    forkId = node.id;
    const head = (outgoing.get(forkId) ?? [])[0];
    let cur: string | null = head ?? null;
    const seen = new Set<string>();
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      const n = graph.nodes.find(x => x.id === cur);
      if (n?.type === "join") { joinId = cur; break; }
      cur = (outgoing.get(cur) ?? [])[0] ?? null;
    }
  } else {
    joinId = node.id;
    let cur: string | null = (incoming.get(joinId) ?? [])[0] ?? null;
    const seen = new Set<string>();
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      const n = graph.nodes.find(x => x.id === cur);
      if (n?.type === "gateway-and") { forkId = cur; break; }
      cur = (incoming.get(cur) ?? [])[0] ?? null;
    }
  }

  if (!forkId || !joinId) return new Set();

  const out = new Set<string>();
  const stack: string[] = [forkId];
  const visited = new Set<string>();
  while (stack.length) {
    const cur = stack.pop()!;
    if (visited.has(cur)) continue;
    visited.add(cur);
    if (cur === joinId) continue;
    for (const e of graph.edges.filter(x => x.source === cur)) {
      out.add(e.id);
      stack.push(e.target);
    }
  }
  for (const e of graph.edges.filter(x => x.target === joinId)) out.add(e.id);
  return out;
}
