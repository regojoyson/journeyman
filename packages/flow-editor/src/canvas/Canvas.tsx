import { useCallback, useMemo, useRef } from "react";
import {
  Background, Controls, ReactFlow, ReactFlowProvider,
  applyNodeChanges, applyEdgeChanges,
  type Connection, type Edge, type Node,
  type NodeChange, type EdgeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { FlowEdge, FlowEdgeType, FlowGraph, FlowNode, FlowNodeType } from "@journeyman/core";
import { nodeTypes, edgeTypes } from "./node-registry.ts";
import { newPhaseNode, newEdge } from "../state/flow-graph.ts";
import type { PhaseCatalog } from "../types.ts";

export interface CanvasProps {
  flow: FlowGraph;
  catalog: PhaseCatalog;
  selectedNodeId: string | null;
  onChange: (next: FlowGraph) => void;
  onSelect: (nodeId: string | null) => void;
  readOnly?: boolean;
}

const KNOWN_NODE_TYPES = new Set([
  "start", "end", "phase",
  "gateway-xor", "gateway-and", "loop", "subflow", "if", "timer",
]);

function toReactFlowNodes(flow: FlowGraph, catalog: PhaseCatalog, selectedId: string | null): Node[] {
  return flow.nodes.map(n => ({
    id: n.id,
    type: KNOWN_NODE_TYPES.has(n.type) ? n.type : "phase",
    position: n.position ?? { x: 0, y: 0 },
    data: n.type === "phase"
      ? {
          displayName: n.displayName ?? n.phaseType ?? "Phase",
          phaseType: n.phaseType ?? "",
          catalogEntry: catalog.find(c => c.phaseType === n.phaseType),
        }
      : {
          displayName: n.displayName ?? n.type,
          ...(n.config ?? {}),
        },
    selected: n.id === selectedId,
    draggable: true,
    selectable: true,
  }));
}

function toReactFlowEdges(flow: FlowGraph): Edge[] {
  return flow.edges.map(e => ({
    id: e.id,
    source: e.source,
    target: e.target,
    type: e.type ?? "default",
    data: { branchLabel: e.branchLabel, condition: e.condition },
  }));
}

function CanvasInner(p: CanvasProps) {
  const wrapper = useRef<HTMLDivElement>(null);

  const rfNodes = useMemo(() => toReactFlowNodes(p.flow, p.catalog, p.selectedNodeId), [p.flow, p.catalog, p.selectedNodeId]);
  const rfEdges = useMemo(() => toReactFlowEdges(p.flow), [p.flow]);

  const handleNodesChange = useCallback((changes: NodeChange[]) => {
    if (p.readOnly) return;
    const updated = applyNodeChanges(changes, rfNodes);
    const nextNodes: FlowNode[] = p.flow.nodes.map(n => {
      const found = updated.find(u => u.id === n.id);
      if (!found) return n;
      return { ...n, position: found.position };
    });
    const deletedIds = new Set(
      changes.filter(c => c.type === "remove").map((c) => (c as { id: string }).id),
    );
    const filteredNodes = nextNodes.filter(n => !deletedIds.has(n.id));
    const filteredEdges = p.flow.edges.filter(e => !deletedIds.has(e.source) && !deletedIds.has(e.target));
    p.onChange({ ...p.flow, nodes: filteredNodes, edges: filteredEdges });
  }, [p, rfNodes]);

  const handleEdgesChange = useCallback((changes: EdgeChange[]) => {
    if (p.readOnly) return;
    const updated = applyEdgeChanges(changes, rfEdges);
    const nextEdges: FlowEdge[] = updated.map(e => {
      const existing = p.flow.edges.find(x => x.id === e.id);
      return existing ?? { id: e.id, source: e.source, target: e.target };
    });
    p.onChange({ ...p.flow, edges: nextEdges });
  }, [p, rfEdges]);

  const handleConnect = useCallback((conn: Connection) => {
    if (p.readOnly) return;
    if (!conn.source || !conn.target) return;
    const sourceNode = p.flow.nodes.find(n => n.id === conn.source);
    let edgeType: FlowEdgeType = "default";
    if (sourceNode?.type === "gateway-xor" || sourceNode?.type === "if") edgeType = "conditional";
    if (conn.sourceHandle === "error") edgeType = "error";
    if (conn.sourceHandle === "else")  edgeType = "else";
    const next: FlowEdge = { ...newEdge(conn.source, conn.target), type: edgeType };
    p.onChange({ ...p.flow, edges: [...p.flow.edges, next] });
  }, [p]);

  const handleDrop = useCallback((ev: React.DragEvent) => {
    if (p.readOnly) return;
    ev.preventDefault();
    const phaseType = ev.dataTransfer.getData("application/journeyman-phase");
    const controlType = ev.dataTransfer.getData("application/journeyman-control");
    const rect = wrapper.current?.getBoundingClientRect();
    const position = rect
      ? { x: ev.clientX - rect.left - 80, y: ev.clientY - rect.top - 30 }
      : { x: 200, y: 200 };

    if (phaseType) {
      const entry = p.catalog.find(c => c.phaseType === phaseType);
      const node = newPhaseNode({ phaseType, displayName: entry?.label ?? phaseType, position });
      p.onChange({ ...p.flow, nodes: [...p.flow.nodes, node] });
      return;
    }
    if (controlType) {
      const node: FlowNode = {
        id: `${controlType}_${Math.random().toString(36).slice(2, 8)}`,
        type: controlType as FlowNodeType,
        displayName: controlType,
        config: {},
        position,
      };
      p.onChange({ ...p.flow, nodes: [...p.flow.nodes, node] });
    }
  }, [p]);

  const handleDragOver = useCallback((ev: React.DragEvent) => {
    ev.preventDefault();
    ev.dataTransfer.dropEffect = "move";
  }, []);

  return (
    <div ref={wrapper} className="je-editor__canvas" onDrop={handleDrop} onDragOver={handleDragOver}>
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onConnect={handleConnect}
        onSelectionChange={(sel) => {
          const id = sel.nodes[0]?.id ?? null;
          p.onSelect(id);
        }}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
}

export function Canvas(p: CanvasProps) {
  return <ReactFlowProvider><CanvasInner {...p} /></ReactFlowProvider>;
}
