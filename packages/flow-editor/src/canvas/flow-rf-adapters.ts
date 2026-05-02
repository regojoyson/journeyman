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

let _structuralSigCalls = 0;
let _structuralSigWindowStart = 0;
export function structuralSig(flow: FlowGraph): string {
  const _t0 = performance.now();
  if (_t0 - _structuralSigWindowStart > 1000) {
    if (_structuralSigCalls > 30) {
      // eslint-disable-next-line no-console
      console.warn(
        `[flow-editor] structuralSig called ${_structuralSigCalls}× in <1s`,
        { nodes: flow.nodes.length, edges: flow.edges.length },
      );
    }
    _structuralSigWindowStart = _t0;
    _structuralSigCalls = 0;
  }
  _structuralSigCalls++;
  const result = JSON.stringify({
    nodes: flow.nodes.map(n => ({
      id: n.id, type: n.type, name: n.displayName, phase: n.phaseType,
      cfg: n.config ?? null, retry: n.retry ?? null, outcome: n.outcome ?? null,
    })),
    edges: flow.edges.map(e => ({
      id: e.id, src: e.source, tgt: e.target, type: e.type ?? "default",
      label: e.branchLabel, cond: e.condition ?? null,
    })),
  });
  const _ms = performance.now() - _t0;
  if (_ms > 25) {
    // eslint-disable-next-line no-console
    console.warn(
      `[flow-editor] structuralSig slow: ${_ms.toFixed(1)}ms`,
      { nodes: flow.nodes.length, edges: flow.edges.length },
    );
  }
  return result;
}

/** Build a fresh FlowGraph from current internal RF state + previous flow's metadata. */
export function buildFlowFromInternal(
  prevFlow: FlowGraph,
  rfNodes: Node[],
  rfEdges: Edge[],
): FlowGraph {
  const prevNodeById = new Map(prevFlow.nodes.map(n => [n.id, n]));
  const prevEdgeById = new Map(prevFlow.edges.map(e => [e.id, e]));
  const nextNodes: FlowNode[] = rfNodes.map(rfn => {
    const prev = prevNodeById.get(rfn.id);
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
    const prev = prevEdgeById.get(rfe.id);
    if (prev) return prev;
    return {
      id: rfe.id, source: rfe.source, target: rfe.target,
      type: (rfe.type ?? "default") as FlowEdgeType,
    };
  });
  return { ...prevFlow, nodes: nextNodes, edges: nextEdges };
}
