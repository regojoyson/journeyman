import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  Background, Controls, ReactFlow, ReactFlowProvider,
  ConnectionMode,
  useNodesState, useEdgesState,
  type Connection, type Edge, type Node,
  type NodeChange, type EdgeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { FlowEdge, FlowEdgeType, FlowGraph, FlowNode, FlowNodeType } from "@journeyman/core";
import { nodeTypes, edgeTypes } from "./node-registry.ts";
import { newPhaseNode, newEdge } from "../state/flow-graph.ts";
import type { PhaseRunState } from "../phase-definition.ts";
import { usePhaseRegistry } from "../state/phase-registry-context.tsx";
import {
  KNOWN_NODE_TYPES,
  toReactFlowEdges,
  structuralSig,
  buildFlowFromInternal,
} from "./flow-rf-adapters.ts";
import { HelpPanel } from "./HelpPanel.tsx";
import { defaultProviderFor } from "../executor-common-config.ts";
import { usePhaseCatalog } from "../catalogs/use-phase-catalog.ts";

/**
 * Best-effort: for each required input field on `newNode`, scan existing phase
 * nodes for one whose outputSchema declares a field of the same name. If
 * exactly one match exists, bind. If 0 or >1, skip — user picks manually.
 */
function autoBindNewNode(
  newNode: FlowNode,
  existingNodes: FlowNode[],
  catalog: ReturnType<typeof usePhaseCatalog>,
): FlowNode {
  if (newNode.type !== "phase" || !newNode.phaseType) return newNode;
  const required = catalog[newNode.phaseType]?.inputFields ?? {};
  const inputs: Record<string, { kind: "ref"; ref: string }> = {
    ...((newNode.inputs ?? {}) as Record<string, { kind: "ref"; ref: string }>),
  };
  let changed = false;
  for (const [fieldName, meta] of Object.entries(required)) {
    if (!(meta as { required?: boolean }).required) continue;
    if (inputs[fieldName]) continue; // already bound
    // Find candidate upstream nodes whose output declares fieldName.
    const candidates = existingNodes.filter(n => {
      if (n.type !== "phase" || !n.phaseType) return false;
      const out = catalog[n.phaseType]?.outputSchema ?? {};
      return out && fieldName in out;
    });
    if (candidates.length === 1) {
      inputs[fieldName] = { kind: "ref", ref: `${candidates[0].id}.output.${fieldName}` };
      changed = true;
    }
  }
  return changed ? { ...newNode, inputs: inputs as FlowNode["inputs"] } : newNode;
}

export interface CanvasProps {
  flow: FlowGraph;
  selectedNodeId: string | null;
  onChange: (next: FlowGraph) => void;
  onSelect: (nodeId: string | null) => void;
  readOnly?: boolean;
  phaseRunStates?: Record<string, PhaseRunState>;
}

function toReactFlowNodes(
  flow: FlowGraph,
  selectedId: string | null,
  runStates?: Record<string, PhaseRunState>,
): Node[] {
  return flow.nodes.map(n => ({
    id: n.id,
    type: KNOWN_NODE_TYPES.has(n.type) ? n.type : "phase",
    position: n.position ?? { x: 0, y: 0 },
    data: n.type === "phase"
      ? {
          displayName: n.displayName ?? n.phaseType ?? "Phase",
          phaseType: n.phaseType ?? "",
          config: n.config ?? {},
          runState: runStates?.[n.id],
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

function CanvasInner(p: CanvasProps) {
  const catalog = usePhaseCatalog();
  const wrapper = useRef<HTMLDivElement>(null);
  const registry = usePhaseRegistry();

  const [nodes, setNodes, onNodesChangeInternal] = useNodesState<Node>(
    toReactFlowNodes(p.flow, p.selectedNodeId, p.phaseRunStates),
  );
  const [edges, setEdges, onEdgesChangeInternal] = useEdgesState<Edge>(
    toReactFlowEdges(p.flow),
  );

  // Tracks the structural signature of the FlowGraph that we last emitted
  // ourselves via p.onChange. The effect below skips resyncing when the parent
  // is just echoing back our own change — that prevents the rerender feedback
  // loop that hits when an edge is deleted (parent updates → effect resyncs →
  // RF emits a selection change → effect runs again, etc.).
  const propagatedSigRef = useRef<string>(structuralSig(p.flow));
  const lastSigRef = useRef<string>(structuralSig(p.flow));
  const lastSelectedRef = useRef<string | null>(p.selectedNodeId);

  useEffect(() => {
    const sig = structuralSig(p.flow);
    if (sig === propagatedSigRef.current) {
      // Echoed back our own change — accept it without resyncing internal RF state.
      lastSigRef.current = sig;
      return;
    }
    if (sig !== lastSigRef.current || p.selectedNodeId !== lastSelectedRef.current) {
      lastSigRef.current = sig;
      lastSelectedRef.current = p.selectedNodeId;
      setNodes(toReactFlowNodes(p.flow, p.selectedNodeId, p.phaseRunStates));
      setEdges(toReactFlowEdges(p.flow));
    }
  }, [p.flow, p.selectedNodeId, p.phaseRunStates, setNodes, setEdges]);

  /** Build a fresh FlowGraph from current internal RF state + previous flow's metadata. */
  const buildFlow = useCallback(
    (rfNodes: Node[], rfEdges: Edge[]): FlowGraph => buildFlowFromInternal(p.flow, rfNodes, rfEdges),
    [p.flow],
  );

  /** Propagate a change to the parent and remember its sig so the resync effect skips the echo. */
  const propagate = useCallback((next: FlowGraph) => {
    propagatedSigRef.current = structuralSig(next);
    p.onChange(next);
  }, [p]);

  /**
   * For changes that DON'T originate from React Flow's internal pipeline
   * (palette drops, programmatic edge additions, edge splits): React Flow's
   * internal state hasn't seen them yet. We must (a) push them into internal
   * state so the canvas renders them and (b) propagate to the parent. The
   * propagate-side updates `propagatedSigRef`, which keeps the resync effect
   * from echoing the change back and undoing the internal update.
   */
  const applyExternalChange = useCallback((next: FlowGraph) => {
    setNodes(toReactFlowNodes(next, p.selectedNodeId, p.phaseRunStates));
    setEdges(toReactFlowEdges(next));
    propagate(next);
  }, [setNodes, setEdges, propagate, p.selectedNodeId, p.phaseRunStates]);

  const handleNodesChange = useCallback((changes: NodeChange[]) => {
    if (p.readOnly) return;
    onNodesChangeInternal(changes);

    const meaningful = changes.some(c => {
      if (c.type === "position") return (c as { dragging?: boolean }).dragging === false;
      if (c.type === "remove") return true;
      return false;
    });
    if (!meaningful) return;

    setNodes(curr => {
      queueMicrotask(() => propagate(buildFlow(curr, edges)));
      return curr;
    });
  }, [p.readOnly, onNodesChangeInternal, setNodes, buildFlow, edges, propagate]);

  const handleEdgesChange = useCallback((changes: EdgeChange[]) => {
    if (p.readOnly) return;
    onEdgesChangeInternal(changes);

    const meaningful = changes.some(c => c.type === "remove");
    if (!meaningful) return;

    setEdges(curr => {
      queueMicrotask(() => propagate(buildFlow(nodes, curr)));
      return curr;
    });
  }, [p.readOnly, onEdgesChangeInternal, setEdges, buildFlow, nodes, propagate]);

  const handleConnect = useCallback((conn: Connection) => {
    if (p.readOnly) return;
    if (!conn.source || !conn.target) return;
    const sourceNode = p.flow.nodes.find(n => n.id === conn.source);
    let edgeType: FlowEdgeType = "default";
    if (sourceNode?.type === "gateway-xor" || sourceNode?.type === "if") edgeType = "conditional";
    if (conn.sourceHandle === "error") edgeType = "error";
    if (conn.sourceHandle === "else")  edgeType = "else";
    const next: FlowEdge = { ...newEdge(conn.source, conn.target), type: edgeType };
    applyExternalChange({ ...p.flow, edges: [...p.flow.edges, next] });
  }, [p, applyExternalChange]);

  const handleDrop = useCallback((ev: React.DragEvent) => {
    if (p.readOnly) return;
    ev.preventDefault();
    const phaseType = ev.dataTransfer.getData("application/journeyman-phase");
    const controlType = ev.dataTransfer.getData("application/journeyman-control");
    const rect = wrapper.current?.getBoundingClientRect();
    const position = rect
      ? { x: ev.clientX - rect.left - 80, y: ev.clientY - rect.top - 30 }
      : { x: 200, y: 200 };

    let newNode: FlowNode | null = null;
    if (phaseType) {
      const def = registry.get(phaseType);
      const base = newPhaseNode({
        phaseType,
        displayName: def?.label ?? phaseType,
        position,
      });
      newNode = def
        ? {
            ...base,
            config: { ...(def.defaultConfig as Record<string, unknown>) },
            executorConfig: (() => {
              const provider = defaultProviderFor(def.executor.kind);
              return provider ? { provider } : undefined;
            })(),
          }
        : base;
    } else if (controlType) {
      newNode = {
        id: `${controlType}_${Math.random().toString(36).slice(2, 8)}`,
        type: controlType as FlowNodeType,
        displayName: controlType,
        config: {},
        position,
      };
    }
    if (!newNode) return;

    // Best-effort auto-bind: if the new phase has required input fields and an
    // existing node has a matching output field name, pre-bind it. Reduces clicks
    // for the common case (e.g. checkout-repo's workspaceDir → create-workspace.output.workspaceDir).
    newNode = autoBindNewNode(newNode, p.flow.nodes, catalog);

    // Just place the node at the drop point. The user wires edges themselves.
    applyExternalChange({ ...p.flow, nodes: [...p.flow.nodes, newNode] });
  }, [p, applyExternalChange, registry, catalog]);

  const handleDragOver = useCallback((ev: React.DragEvent) => {
    ev.preventDefault();
    ev.dataTransfer.dropEffect = "move";
  }, []);

  const stableNodeTypes = useMemo(() => nodeTypes, []);
  const stableEdgeTypes = useMemo(() => edgeTypes, []);

  return (
    <div ref={wrapper} className="je-editor__canvas" onDrop={handleDrop} onDragOver={handleDragOver}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={stableNodeTypes}
        edgeTypes={stableEdgeTypes}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onConnect={handleConnect}
        onSelectionChange={(sel) => {
          const id = sel.nodes[0]?.id ?? null;
          p.onSelect(id);
        }}
        fitView
        fitViewOptions={{ padding: 0.25 }}
        connectionRadius={40}
        connectionMode={ConnectionMode.Loose}
        selectNodesOnDrag={false}
        panOnScroll
        panOnScrollSpeed={0.6}
        zoomOnScroll
        zoomOnPinch
        proOptions={{ hideAttribution: true }}
      >
        <Background />
        <Controls showInteractive={false} />
      </ReactFlow>
      <HelpPanel />
    </div>
  );
}

export function Canvas(p: CanvasProps) {
  return <ReactFlowProvider><CanvasInner {...p} /></ReactFlowProvider>;
}
