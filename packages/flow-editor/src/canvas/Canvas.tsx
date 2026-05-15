import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  Background, Controls, ReactFlow, ReactFlowProvider,
  ConnectionMode,
  useNodesState, useEdgesState, useReactFlow,
  type Connection, type Edge, type Node,
  type NodeChange, type EdgeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { WorkflowEdge, WorkflowEdgeType, WorkflowGraph, WorkflowNode, WorkflowNodeType } from "@journeyman/core";
import { nodeTypes, edgeTypes } from "./node-registry.ts";
import { newPhaseNode, newEdge } from "../state/flow-graph.ts";
import { autoPopulateCustomAiDefaults } from "./auto-populate-defaults.ts";
import type { PhaseRunState } from "../phase-definition.ts";
import { usePhaseRegistry } from "../state/phase-registry-context.tsx";
import {
  KNOWN_NODE_TYPES,
  toReactWorkflowEdges,
  structuralSig,
  buildFlowFromInternal,
} from "./flow-rf-adapters.ts";
import { HelpPanel } from "./HelpPanel.tsx";
import { defaultProviderFor } from "../executor-common-config.ts";
import { usePhaseCatalog } from "../catalogs/use-phase-catalog.ts";
import { useCustomPhaseDefs } from "../catalogs/use-custom-phase-defs.ts";
import { collectCustomPhaseIds } from "../properties-panel/use-upstream-sources.ts";
import { customPhaseToShape } from "@journeyman/custom-phases/shape-adapter";
import type { CustomAiPhase, InputFields } from "@journeyman/core";

/**
 * Best-effort: for each required input field on `newNode`, scan existing phase
 * nodes for one whose outputSchema declares a field of the same name. If
 * exactly one match exists, bind. If 0 or >1, skip — user picks manually.
 */
function autoBindNewNode(
  newNode: WorkflowNode,
  existingNodes: WorkflowNode[],
  catalog: ReturnType<typeof usePhaseCatalog>,
  customPhaseDefs?: Record<string, CustomAiPhase | null>,
): WorkflowNode {
  if (newNode.type !== "phase" || !newNode.phaseType) return newNode;

  let required: InputFields = {};
  const outputSchemaForCandidate = (n: WorkflowNode): Record<string, unknown> => {
    if (n.type !== "phase" || !n.phaseType) return {};
    if (n.phaseType === "custom-ai") {
      const id = (n.config as { customPhaseId?: unknown } | undefined)?.customPhaseId;
      const def = typeof id === "string" && id ? customPhaseDefs?.[id] : undefined;
      return def ? (customPhaseToShape(def).outputSchema ?? {}) : {};
    }
    return catalog[n.phaseType]?.outputSchema ?? {};
  };

  if (newNode.phaseType === "custom-ai") {
    const customId = (newNode.config as { customPhaseId?: unknown } | undefined)?.customPhaseId;
    const def = typeof customId === "string" && customId ? customPhaseDefs?.[customId] : undefined;
    if (!def) return newNode; // def not loaded yet — skip auto-bind, user can connect manually
    required = customPhaseToShape(def).inputFields;
  } else {
    required = catalog[newNode.phaseType]?.inputFields ?? {};
  }

  const inputs: Record<string, { kind: "ref"; ref: string }> = {
    ...((newNode.inputs ?? {}) as Record<string, { kind: "ref"; ref: string }>),
  };
  let changed = false;
  for (const [fieldName, meta] of Object.entries(required)) {
    if (!(meta as { required?: boolean }).required) continue;
    if (inputs[fieldName]) continue; // already bound
    const candidates = existingNodes.filter((n) => {
      const out = outputSchemaForCandidate(n);
      return out && fieldName in out;
    });
    if (candidates.length === 1) {
      inputs[fieldName] = { kind: "ref", ref: `${candidates[0].id}.output.${fieldName}` };
      changed = true;
    }
  }
  return changed ? { ...newNode, inputs: inputs as WorkflowNode["inputs"] } : newNode;
}

export interface CanvasProps {
  flow: WorkflowGraph;
  selectedNodeId: string | null;
  onChange: (next: WorkflowGraph) => void;
  onSelect: (nodeId: string | null) => void;
  onEdgeSelect?: (edgeId: string | null) => void;
  readOnly?: boolean;
  phaseRunStates?: Record<string, PhaseRunState>;
}

function toReactWorkflowNodes(
  flow: WorkflowGraph,
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
          inputs: n.inputs ?? {},
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
  const customPhaseDefs = useCustomPhaseDefs(collectCustomPhaseIds(p.flow));
  const wrapper = useRef<HTMLDivElement>(null);
  const registry = usePhaseRegistry();
  const { screenToFlowPosition } = useReactFlow();

  // Mount log
  const canvasMountedRef = useRef(false);
  if (!canvasMountedRef.current) {
    canvasMountedRef.current = true;
    // eslint-disable-next-line no-console
    console.log("[Canvas] mounted", { nodes: p.flow.nodes.length, edges: p.flow.edges.length });
  }
  // Stable refs so callbacks don't recreate on every drag frame.
  const onChangeRef = useRef(p.onChange);
  const onSelectRef = useRef(p.onSelect);
  const onEdgeSelectRef = useRef(p.onEdgeSelect);
  const readOnlyRef = useRef(p.readOnly);
  const flowRef = useRef(p.flow);
  const selectedNodeIdRef = useRef(p.selectedNodeId);
  const phaseRunStatesRef = useRef(p.phaseRunStates);
  onChangeRef.current = p.onChange;
  onSelectRef.current = p.onSelect;
  onEdgeSelectRef.current = p.onEdgeSelect;
  readOnlyRef.current = p.readOnly;
  flowRef.current = p.flow;
  selectedNodeIdRef.current = p.selectedNodeId;
  phaseRunStatesRef.current = p.phaseRunStates;

  const [nodes, setNodes, onNodesChangeInternal] = useNodesState<Node>(
    toReactWorkflowNodes(p.flow, p.selectedNodeId, p.phaseRunStates),
  );
  const [edges, setEdges, onEdgesChangeInternal] = useEdgesState<Edge>(
    toReactWorkflowEdges(p.flow),
  );
  // Keep refs in sync so callbacks can read current state without being in dep arrays.
  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  nodesRef.current = nodes;
  edgesRef.current = edges;

  // Tracks the structural signature of the WorkflowGraph that we last emitted
  // ourselves via p.onChange. The effect below skips resyncing when the parent
  // is just echoing back our own change — that prevents the rerender feedback
  // loop that hits when an edge is deleted (parent updates → effect resyncs →
  // RF emits a selection change → effect runs again, etc.).
  // Lazy-init refs: `useRef(x)` evaluates `x` every render but only keeps the
  // first value, so calling structuralSig() in the argument was running JSON
  // .stringify on the whole flow on every render — 200×/s during autoPan.
  const propagatedSigRef = useRef<string | null>(null);
  const lastSigRef = useRef<string | null>(null);
  if (propagatedSigRef.current === null) {
    const sig = structuralSig(p.flow);
    propagatedSigRef.current = sig;
    lastSigRef.current = sig;
  }
  const lastSelectedRef = useRef<string | null>(p.selectedNodeId);

  // Render-loop detector: if this resync effect fires too many times in quick
  // succession, log a warning so we can see runaway state propagation in the
  // browser console instead of just a frozen tab.
  const resyncTimesRef = useRef<number[]>([]);

  useEffect(() => {
    const now = performance.now();
    const times = resyncTimesRef.current;
    times.push(now);
    while (times.length && now - times[0] > 1000) times.shift();
    if (times.length > 15) {
      // eslint-disable-next-line no-console
      console.warn(
        `[flow-editor] Canvas resync effect fired ${times.length}× in <1s — likely render loop.`,
        { flowNodes: p.flow.nodes.length, flowEdges: p.flow.edges.length, selectedNodeId: p.selectedNodeId },
      );
      resyncTimesRef.current = [];
    }

    const t0 = performance.now();
    const sig = structuralSig(p.flow);
    const sigMs = performance.now() - t0;
    if (sigMs > 10) {
      // eslint-disable-next-line no-console
      console.warn("[Canvas] structuralSig slow", { ms: +sigMs.toFixed(2), nodes: p.flow.nodes.length });
    }

    if (sig === propagatedSigRef.current) {
      // Echoed back our own change — accept it without resyncing internal RF state.
      lastSigRef.current = sig;
      return;
    }
    if (sig !== lastSigRef.current || p.selectedNodeId !== lastSelectedRef.current) {
      // eslint-disable-next-line no-console
      console.log("[Canvas] resync — external change detected", {
        nodes: p.flow.nodes.length,
        edges: p.flow.edges.length,
        selectedNodeId: p.selectedNodeId,
      });
      lastSigRef.current = sig;
      lastSelectedRef.current = p.selectedNodeId;
      setNodes(toReactWorkflowNodes(p.flow, p.selectedNodeId, p.phaseRunStates));
      setEdges(toReactWorkflowEdges(p.flow));
    }
  }, [p.flow, p.selectedNodeId, p.phaseRunStates, setNodes, setEdges]);

  /** Build a fresh WorkflowGraph from current internal RF state + previous flow's metadata. */
  const buildFlow = useCallback(
    (rfNodes: Node[], rfEdges: Edge[]): WorkflowGraph => buildFlowFromInternal(p.flow, rfNodes, rfEdges),
    [p.flow],
  );

  /** Propagate a change to the parent and remember its sig so the resync effect skips the echo. */
  const propagate = useCallback((next: WorkflowGraph) => {
    propagatedSigRef.current = structuralSig(next);
    onChangeRef.current(next);
  }, []);

  /**
   * For changes that DON'T originate from React Flow's internal pipeline
   * (palette drops, programmatic edge additions, edge splits): React Flow's
   * internal state hasn't seen them yet. We must (a) push them into internal
   * state so the canvas renders them and (b) propagate to the parent. The
   * propagate-side updates `propagatedSigRef`, which keeps the resync effect
   * from echoing the change back and undoing the internal update.
   */
  const applyExternalChange = useCallback((next: WorkflowGraph) => {
    setNodes(toReactWorkflowNodes(next, selectedNodeIdRef.current, phaseRunStatesRef.current));
    setEdges(toReactWorkflowEdges(next));
    propagate(next);
  }, [setNodes, setEdges, propagate]);

  const handleNodesChange = useCallback((changes: NodeChange[]) => {
    if (readOnlyRef.current) return;

    // Delete-protection: never allow removing the start node, and don't allow
    // removing the last remaining end node. Filter out blocked changes before
    // they reach React Flow's internal state.
    let blockedRemoval: { id: string; reason: string } | null = null;
    const flowNodes = flowRef.current.nodes;
    const endCount = flowNodes.filter(n => n.type === "end").length;
    const filtered = changes.filter(c => {
      if (c.type !== "remove") return true;
      const node = flowNodes.find(n => n.id === c.id);
      if (!node) return true;
      if (node.type === "start") {
        blockedRemoval = { id: c.id, reason: "Cannot delete the start node — every flow needs exactly one." };
        return false;
      }
      if (node.type === "end" && endCount <= 1) {
        blockedRemoval = { id: c.id, reason: "Cannot delete the only end node — flows need at least one terminal." };
        return false;
      }
      return true;
    });
    if (blockedRemoval) {
      console.info(`[flow-editor] ${(blockedRemoval as { reason: string }).reason}`);
    }

    onNodesChangeInternal(filtered);

    const meaningful = filtered.some(c => {
      if (c.type === "position") return (c as { dragging?: boolean }).dragging === false;
      if (c.type === "remove") return true;
      return false;
    });
    if (!meaningful) return;

    setNodes(curr => {
      queueMicrotask(() => propagate(buildFlow(curr, edgesRef.current)));
      return curr;
    });
  }, [onNodesChangeInternal, setNodes, buildFlow, propagate]);

  const handleEdgesChange = useCallback((changes: EdgeChange[]) => {
    if (readOnlyRef.current) return;
    onEdgesChangeInternal(changes);

    const meaningful = changes.some(c => c.type === "remove");
    if (!meaningful) return;

    setEdges(curr => {
      queueMicrotask(() => propagate(buildFlow(nodesRef.current, curr)));
      return curr;
    });
  }, [onEdgesChangeInternal, setEdges, buildFlow, propagate]);

  const handleConnect = useCallback((conn: Connection) => {
    if (readOnlyRef.current) return;
    if (!conn.source || !conn.target) return;
    const flow = flowRef.current;
    const sourceNode = flow.nodes.find(n => n.id === conn.source);
    let edgeType: WorkflowEdgeType = "default";
    if (sourceNode?.type === "gateway-xor" || sourceNode?.type === "if") edgeType = "conditional";
    if (conn.sourceHandle === "error") edgeType = "error";
    if (conn.sourceHandle === "else")  edgeType = "else";
    const next: WorkflowEdge = { ...newEdge(conn.source, conn.target), type: edgeType };
    applyExternalChange({ ...flow, edges: [...flow.edges, next] });
  }, [applyExternalChange]);

  const handleDrop = useCallback((ev: React.DragEvent) => {
    if (readOnlyRef.current) return;
    ev.preventDefault();
    const phaseType = ev.dataTransfer.getData("application/journeyman-phase");
    const controlType = ev.dataTransfer.getData("application/journeyman-control");
    const position = screenToFlowPosition({ x: ev.clientX, y: ev.clientY });

    let newNode: WorkflowNode | null = null;
    if (phaseType) {
      const def = registry.get(phaseType);
      // Synthetic palette entries for custom AI phases use a unique
      // `custom-ai:<uuid>` phaseType to avoid collisions in the palette.
      // The runtime only knows the bare `custom-ai` phase — strip the
      // suffix so the node submits as the registered task type.
      const runtimePhaseType = phaseType.startsWith("custom-ai:") ? "custom-ai" : phaseType;
      const base = newPhaseNode({
        phaseType: runtimePhaseType,
        displayName: def?.label ?? runtimePhaseType,
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
            secretBindings: (def.slots ?? []).reduce<Record<string, { mode: "auto" }>>(
              (acc, slot) => { acc[slot.name] = { mode: "auto" }; return acc; },
              {},
            ),
          }
        : base;
    } else if (controlType) {
      newNode = {
        id: `${controlType}_${Math.random().toString(36).slice(2, 8)}`,
        type: controlType as WorkflowNodeType,
        displayName: controlType,
        config: {},
        position,
      };
    }
    if (!newNode) return;

    const flow = flowRef.current;
    const t0 = performance.now();
    newNode = autoBindNewNode(newNode, flow.nodes, catalog, customPhaseDefs);
    if (newNode && newNode.phaseType === "custom-ai") {
      const cpId = (newNode.config as { customPhaseId?: unknown } | undefined)?.customPhaseId;
      const cpDef = typeof cpId === "string" ? customPhaseDefs[cpId] ?? null : null;
      newNode = autoPopulateCustomAiDefaults(newNode, cpDef);
    }
    const tBind = performance.now();
    // eslint-disable-next-line no-console
    console.log("[flow-editor] add node", {
      id: newNode.id,
      type: newNode.type,
      phaseType: newNode.phaseType,
      nodesBefore: flow.nodes.length,
      edgesBefore: flow.edges.length,
      autoBindMs: +(tBind - t0).toFixed(2),
    });
    applyExternalChange({ ...flow, nodes: [...flow.nodes, newNode] });
    // eslint-disable-next-line no-console
    console.log("[flow-editor] add node — applyExternalChange done", {
      totalMs: +(performance.now() - t0).toFixed(2),
    });
  }, [applyExternalChange, registry, catalog, screenToFlowPosition]);

  const handleDragOver = useCallback((ev: React.DragEvent) => {
    ev.preventDefault();
    ev.dataTransfer.dropEffect = "move";
  }, []);

  const handleSelectionChange = useCallback((sel: { nodes: Node[] }) => {
    const id = sel.nodes[0]?.id ?? null;
    onSelectRef.current(id);
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
        onSelectionChange={handleSelectionChange}
        onEdgeClick={(_, edge) => onEdgeSelectRef.current?.(edge.id)}
        onPaneClick={() => { onSelectRef.current(null); onEdgeSelectRef.current?.(null); }}
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
