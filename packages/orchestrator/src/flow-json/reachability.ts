import type { WorkflowGraph } from "@journeyman/core";
import { findTriggerNodes } from "@journeyman/core";

export function dominators(graph: WorkflowGraph, target: string): Set<string> {
  const triggers = findTriggerNodes(graph);
  if (triggers.length === 0) return new Set();
  // Use a synthetic super-source preceding every trigger so the standard
  // dominator algorithm works with multiple entry points.
  const SUPER = "__super_source__";
  const start = SUPER;
  const allIds = new Set<string>([SUPER, ...graph.nodes.map(n => n.id)]);
  const dom = new Map<string, Set<string>>();
  for (const id of allIds) dom.set(id, id === start ? new Set([start]) : new Set(allIds));
  const preds = new Map<string, string[]>();
  for (const id of allIds) preds.set(id, []);
  for (const e of graph.edges) preds.get(e.target)?.push(e.source);
  // Wire the super-source as a predecessor of every trigger node.
  for (const t of triggers) preds.get(t.id)?.push(SUPER);
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
