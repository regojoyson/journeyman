import { useMemo } from "react";
import {
  Background, Controls, ReactFlow, ReactFlowProvider,
  type Edge, type Node, type NodeProps, type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { WorkflowGraph } from "@journeyman/core";
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

function CanvasInner(p: ReadOnlyCanvasProps) {
  const rfNodes: Node[] = useMemo(() => p.workflow.nodes.map(n => ({
    id: n.id,
    type: n.type in wrappedNodeTypes ? n.type : "step",
    position: n.position ?? { x: 0, y: 0 },
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
  })), [p.workflow.nodes, p.statuses, p.selectedNodeId]);

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
