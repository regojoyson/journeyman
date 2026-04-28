import { MarkerType, type Edge, type Node } from "@xyflow/react";
import type { FlowEdge, FlowEdgeType, FlowGraph, FlowNode, FlowNodeType } from "@journeyman/core";

export const KNOWN_NODE_TYPES = new Set([
  "start", "end", "phase",
  "gateway-xor", "gateway-and", "loop", "subflow", "if", "timer",
]);

export function toReactFlowEdges(flow: FlowGraph): Edge[] {
  return flow.edges.map(e => {
    const t = e.type ?? "default";
    const arrowColor =
      t === "error"       ? "#ff7675" :
      t === "conditional" ? "#fdcb6e" :
      t === "else"        ? "#888"    :
      /* default */        "#888";
    return {
      id: e.id,
      source: e.source,
      target: e.target,
      type: t,
      data: { branchLabel: e.branchLabel, condition: e.condition },
      markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18, color: arrowColor },
    };
  });
}

export function structuralSig(flow: FlowGraph): string {
  return JSON.stringify({
    nodes: flow.nodes.map(n => ({
      id: n.id, type: n.type, name: n.displayName, phase: n.phaseType,
      cfg: n.config ?? null, retry: n.retry ?? null, outcome: n.outcome ?? null,
    })),
    edges: flow.edges.map(e => ({
      id: e.id, src: e.source, tgt: e.target, type: e.type ?? "default",
      label: e.branchLabel, cond: e.condition ?? null,
    })),
  });
}

/** Build a fresh FlowGraph from current internal RF state + previous flow's metadata. */
export function buildFlowFromInternal(
  prevFlow: FlowGraph,
  rfNodes: Node[],
  rfEdges: Edge[],
): FlowGraph {
  const nextNodes: FlowNode[] = rfNodes.map(rfn => {
    const prev = prevFlow.nodes.find(n => n.id === rfn.id);
    if (prev) return { ...prev, position: rfn.position };
    return {
      id: rfn.id,
      type: (rfn.type ?? "phase") as FlowNodeType,
      displayName: (rfn.data as { displayName?: string } | undefined)?.displayName,
      position: rfn.position,
      config: {},
    };
  });
  const nextEdges: FlowEdge[] = rfEdges.map(rfe => {
    const prev = prevFlow.edges.find(e => e.id === rfe.id);
    if (prev) return prev;
    return {
      id: rfe.id, source: rfe.source, target: rfe.target,
      type: (rfe.type ?? "default") as FlowEdgeType,
    };
  });
  return { ...prevFlow, nodes: nextNodes, edges: nextEdges };
}
