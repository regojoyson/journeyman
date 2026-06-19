import { useMemo } from "react";
import {
  Background, Controls, ReactFlow, ReactFlowProvider,
  type Edge, type Node, type NodeProps, type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { WorkflowGraph, WorkflowNode } from "@journeyman/core";
// Reuse flow-editor's node + edge components for the n8n look.
import { nodeTypes as editorNodeTypes, edgeTypes as editorEdgeTypes } from "@journeyman/flow-editor";
import { STATUS_CLASS, STATUS_LABEL } from "./status-styles.ts";
import type { ResolvedNodeStatus } from "../types.ts";

function makeWrappedNode(InnerComponent: React.ComponentType<NodeProps>) {
  return function WrappedNode(props: NodeProps) {
    const data = props.data as { runStatus?: ResolvedNodeStatus; [k: string]: unknown };
    const rs: ResolvedNodeStatus = data.runStatus ?? { status: "pending", attempt: 0, visitCount: 0 };
    const cls = STATUS_CLASS[rs.status];
    const badge = rs.attempt > 1 ? `${STATUS_LABEL[rs.status]} ×${rs.attempt}` : STATUS_LABEL[rs.status];
    return (
      <div className={`je-runnode ${cls}`}>
        <InnerComponent {...props} />
        <div className="je-runnode__badge">{badge}</div>
      </div>
    );
  };
}

const wrappedNodeTypes: NodeTypes = {};
for (const [name, Comp] of Object.entries(editorNodeTypes)) {
  wrappedNodeTypes[name] = makeWrappedNode(Comp as unknown as React.ComponentType<NodeProps>);
}
const edgeTypes = editorEdgeTypes;

export interface ReadOnlyCanvasProps {
  workflow: WorkflowGraph;
  statuses: Map<string, ResolvedNodeStatus>;
  selectedNodeId: string | null;
  onSelect: (id: string | null) => void;
}

function isAnimatedEdge(
  e: { source: string; target: string },
  statuses: Map<string, ResolvedNodeStatus>,
): boolean {
  const src = statuses.get(e.source);
  const tgt = statuses.get(e.target);
  if (src?.status === "running") return true;
  if (src?.status === "completed" && tgt && tgt.status !== "completed" && tgt.status !== "failed") return true;
  return false;
}

/**
 * Auto-layout for graphs whose nodes carry no saved positions (e.g. the
 * ephemeral graph compiled from an agent). Lays nodes out left-to-right by
 * longest-path depth (Kahn's topo sort), stacking siblings at the same depth.
 * Guarded against cycles; unreached nodes fall back to array order.
 */
function computeFallbackPositions(
  nodes: WorkflowNode[],
  edges: { source: string; target: string }[],
): Map<string, { x: number; y: number }> {
  const adj = new Map<string, string[]>();
  const indeg = new Map<string, number>();
  for (const n of nodes) { adj.set(n.id, []); indeg.set(n.id, 0); }
  for (const e of edges) {
    if (!adj.has(e.source) || !indeg.has(e.target)) continue;
    adj.get(e.source)!.push(e.target);
    indeg.set(e.target, indeg.get(e.target)! + 1);
  }
  const depth = new Map<string, number>();
  const queue: string[] = [];
  for (const n of nodes) if (indeg.get(n.id) === 0) { depth.set(n.id, 0); queue.push(n.id); }
  let guard = nodes.length + edges.length + 1;
  while (queue.length && guard-- > 0) {
    const id = queue.shift()!;
    const d = depth.get(id) ?? 0;
    for (const t of adj.get(id) ?? []) {
      depth.set(t, Math.max(depth.get(t) ?? 0, d + 1));
      indeg.set(t, (indeg.get(t) ?? 1) - 1);
      if ((indeg.get(t) ?? 0) === 0) queue.push(t);
    }
  }
  nodes.forEach((n, i) => { if (!depth.has(n.id)) depth.set(n.id, i); });
  const rowByDepth = new Map<number, number>();
  const out = new Map<string, { x: number; y: number }>();
  for (const n of nodes) {
    const d = depth.get(n.id)!;
    const row = rowByDepth.get(d) ?? 0;
    rowByDepth.set(d, row + 1);
    out.set(n.id, { x: 80 + d * 320, y: 200 + row * 140 });
  }
  return out;
}

function CanvasInner(p: ReadOnlyCanvasProps) {
  // Only laid out when some node lacks a saved position; positioned nodes are kept as-is.
  const fallbackPos = useMemo(
    () => p.workflow.nodes.some(n => !n.position)
      ? computeFallbackPositions(p.workflow.nodes, p.workflow.edges)
      : null,
    [p.workflow.nodes, p.workflow.edges],
  );
  const rfNodes: Node[] = useMemo(() => p.workflow.nodes.map(n => ({
    id: n.id,
    type: n.type in wrappedNodeTypes ? n.type : "step",
    position: n.position ?? fallbackPos?.get(n.id) ?? { x: 0, y: 0 },
    data: {
      displayName: n.displayName ?? n.stepType ?? n.type,
      stepType: n.stepType ?? "",
      config: n.config ?? {},
      inputs: n.inputs ?? {},
      runStatus: p.statuses.get(n.id),
    },
    selected: n.id === p.selectedNodeId,
    selectable: true,
    draggable: false,
  })), [p.workflow.nodes, p.statuses, p.selectedNodeId, fallbackPos]);

  const rfEdges: Edge[] = useMemo(() => p.workflow.edges.map(e => ({
    id: e.id, source: e.source, target: e.target, type: "default",
    animated: isAnimatedEdge(e, p.statuses),
  })), [p.workflow.edges, p.statuses]);

  return (
    <div className="je-runview__canvas">
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={wrappedNodeTypes}
        edgeTypes={edgeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        onSelectionChange={(s) => p.onSelect(s.nodes[0]?.id ?? null)}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

export function ReadOnlyCanvas(p: ReadOnlyCanvasProps) {
  return <ReactFlowProvider><CanvasInner {...p} /></ReactFlowProvider>;
}
