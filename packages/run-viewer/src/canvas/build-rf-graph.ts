import type { Edge, Node } from "@xyflow/react";
import type { WorkflowGraph } from "@journeyman/core";
import type { ResolvedNodeStatus } from "../types.ts";

/**
 * Why this exists: ReactFlow keeps a node's *measured* size (and handle bounds)
 * only while the SAME node object reference is passed across renders — its
 * internal `adoptUserNodes` reuses the cached node iff `userNode ===
 * internals.userNode` (identity, not deep equality). The run viewer recomputes
 * node statuses on every workflow-instance event, INCLUDING high-frequency
 * `step.log` lines. If we allocate fresh `Node`/`Edge` objects on every such
 * event, every node is reset to "unmeasured" each tick and its handle bounds
 * cleared, forcing a full re-measure. Under a log burst (events arriving faster
 * than the measure→paint cycle) the nodes never stay measured long enough to
 * paint and edges have no handles to attach to — the canvas flickers to blank.
 *
 * The fix: reuse the previous `Node`/`Edge` object whenever nothing that
 * affects its render changed (status string + attempt + selected + position for
 * nodes; endpoints + animated flag for edges). step.log bursts then produce
 * byte-identical signatures and ReactFlow sees no node churn at all.
 *
 * The flow-editor canvas never hit this because it drives ReactFlow through its
 * internal state (`useNodesState`/`useEdgesState`) and only resyncs on
 * structural change — preserving identity. This module recreates that guarantee
 * for the read-only canvas without adopting the full controlled-state machinery.
 */

export interface GraphCacheEntry {
  nodes: Map<string, { sig: string; node: Node }>;
  edges: Map<string, { sig: string; edge: Edge }>;
}

export function emptyGraphCache(): GraphCacheEntry {
  return { nodes: new Map(), edges: new Map() };
}

export interface BuildRfGraphArgs {
  workflow: WorkflowGraph;
  statuses: Map<string, ResolvedNodeStatus>;
  selectedNodeId: string | null;
  /** Auto-layout positions for nodes that carry no saved position. */
  fallbackPos: Map<string, { x: number; y: number }> | null;
  /** Node type names that have a registered component; others fall back to "step". */
  knownNodeTypes: ReadonlySet<string>;
  isAnimatedEdge: (
    e: { source: string; target: string },
    statuses: Map<string, ResolvedNodeStatus>,
  ) => boolean;
}

/**
 * Build ReactFlow nodes/edges, reusing objects from `cache` (mutated in place)
 * whenever the render-relevant signature is unchanged. Only what's actually
 * rendered on a node feeds the signature — `runStatus.status` and `.attempt`
 * drive the status ring + badge; the rest of `ResolvedNodeStatus` (durations,
 * timestamps) is shown only in the drawer, which reads the live `statuses` map
 * directly, so it does not need to bust node identity here.
 */
export function buildRfGraph(
  args: BuildRfGraphArgs,
  cache: GraphCacheEntry,
): { nodes: Node[]; edges: Edge[] } {
  const prevNodes = cache.nodes;
  const nextNodes = new Map<string, { sig: string; node: Node }>();
  const nodes = args.workflow.nodes.map((n) => {
    const status = args.statuses.get(n.id);
    const selected = n.id === args.selectedNodeId;
    const position = n.position ?? args.fallbackPos?.get(n.id) ?? { x: 0, y: 0 };
    const sig = JSON.stringify({
      s: status?.status ?? null,
      a: status?.attempt ?? 0,
      sel: selected,
      x: position.x,
      y: position.y,
      dn: n.displayName ?? n.stepType ?? n.type,
      st: n.stepType ?? "",
      ty: n.type,
    });
    const prev = prevNodes.get(n.id);
    if (prev && prev.sig === sig) {
      nextNodes.set(n.id, prev);
      return prev.node;
    }
    const node: Node = {
      id: n.id,
      type: args.knownNodeTypes.has(n.type) ? n.type : "step",
      position,
      data: {
        displayName: n.displayName ?? n.stepType ?? n.type,
        stepType: n.stepType ?? "",
        config: n.config ?? {},
        inputs: n.inputs ?? {},
        runStatus: status,
      },
      selected,
      selectable: true,
      draggable: false,
    };
    nextNodes.set(n.id, { sig, node });
    return node;
  });
  cache.nodes = nextNodes;

  const prevEdges = cache.edges;
  const nextEdges = new Map<string, { sig: string; edge: Edge }>();
  const edges = args.workflow.edges.map((e) => {
    const animated = args.isAnimatedEdge(e, args.statuses);
    const sig = `${e.source}|${e.target}|${animated ? 1 : 0}`;
    const prev = prevEdges.get(e.id);
    if (prev && prev.sig === sig) {
      nextEdges.set(e.id, prev);
      return prev.edge;
    }
    const edge: Edge = {
      id: e.id,
      source: e.source,
      target: e.target,
      type: "default",
      animated,
    };
    nextEdges.set(e.id, { sig, edge });
    return edge;
  });
  cache.edges = nextEdges;

  return { nodes, edges };
}
