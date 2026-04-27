import { useCallback, useMemo, useRef } from "react";
import {
  Background, Controls, ReactFlow, ReactFlowProvider,
  applyNodeChanges, applyEdgeChanges,
  type Connection, type Edge, type Node,
  type NodeChange, type EdgeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { FlowEdge, FlowGraph, FlowNode } from "@journeyman/core";
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

function toReactFlowNodes(flow: FlowGraph, catalog: PhaseCatalog, selectedId: string | null): Node[] {
  return flow.nodes.map(n => ({
    id: n.id,
    type: n.type === "phase" ? "phase" : (n.type === "start" ? "start" : (n.type === "end" ? "end" : "phase")),
    position: n.position ?? { x: 0, y: 0 },
    data: n.type === "phase"
      ? {
          displayName: n.displayName ?? n.phaseType ?? "Phase",
          phaseType: n.phaseType ?? "",
          catalogEntry: catalog.find(c => c.phaseType === n.phaseType),
        }
      : {},
    selected: n.id === selectedId,
    draggable: true,
    selectable: true,
  }));
}

function toReactFlowEdges(flow: FlowGraph): Edge[] {
  return flow.edges.map(e => ({
    id: e.id, source: e.source, target: e.target, type: "default",
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
    const filtered = p.flow.edges.filter(e => e.source !== conn.source);
    p.onChange({ ...p.flow, edges: [...filtered, newEdge(conn.source, conn.target)] });
  }, [p]);

  const handleDrop = useCallback((ev: React.DragEvent) => {
    if (p.readOnly) return;
    ev.preventDefault();
    const phaseType = ev.dataTransfer.getData("application/journeyman-phase");
    if (!phaseType) return;
    const entry = p.catalog.find(c => c.phaseType === phaseType);
    const rect = wrapper.current?.getBoundingClientRect();
    const position = rect
      ? { x: ev.clientX - rect.left - 80, y: ev.clientY - rect.top - 30 }
      : { x: 200, y: 200 };
    const node = newPhaseNode({ phaseType, displayName: entry?.label ?? phaseType, position });
    p.onChange({ ...p.flow, nodes: [...p.flow.nodes, node] });
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
