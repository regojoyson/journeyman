import type { FlowGraph } from "@journeyman/core";

export function dominators(graph: FlowGraph, target: string): Set<string> {
  const startNode = graph.nodes.find(n => n.type === "start");
  if (!startNode) return new Set();
  const start = startNode.id;
  const allIds = new Set(graph.nodes.map(n => n.id));
  const dom = new Map<string, Set<string>>();
  for (const id of allIds) dom.set(id, id === start ? new Set([start]) : new Set(allIds));
  const preds = new Map<string, string[]>();
  for (const id of allIds) preds.set(id, []);
  for (const e of graph.edges) preds.get(e.target)?.push(e.source);
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of allIds) {
      if (id === start) continue;
      const p = preds.get(id) ?? [];
      if (!p.length) continue;
      const inter = p
        .map(x => dom.get(x) ?? new Set<string>())
        .reduce((a, b) => new Set([...a].filter(x => b.has(x))));
      inter.add(id);
      const prev = dom.get(id)!;
      if (prev.size !== inter.size || [...inter].some(x => !prev.has(x))) {
        dom.set(id, inter);
        changed = true;
      }
    }
  }
  return dom.get(target) ?? new Set();
}
