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
import { edgesForForkJoinPair } from "./edge-highlighting.ts";
import { newStepNode, newEdge } from "../state/flow-graph.ts";
import { autoPopulateCustomAiDefaults } from "./auto-populate-defaults.ts";
import type { StepRunState } from "../step-definition.ts";
import { useStepRegistry } from "../state/step-registry-context.tsx";
import {
  KNOWN_NODE_TYPES,
  toReactWorkflowEdges,
  structuralSig,
  buildFlowFromInternal,
} from "./flow-rf-adapters.ts";
import { HelpPanel } from "./HelpPanel.tsx";
import { defaultProviderFor } from "../executor-common-config.ts";
import { defaultControlCatalog } from "../palette/built-in-categories.ts";
import { useStepCatalog } from "../catalogs/use-step-catalog.ts";
import { useCustomStepDefs } from "../catalogs/use-custom-step-defs.ts";
import { collectCustomStepIds } from "../properties-panel/use-upstream-sources.ts";
import { customStepToShape } from "@journeyman/custom-steps/shape-adapter";
import type { CustomAiStep, InputFields } from "@journeyman/core";

/**
 * Best-effort: for each required input field on `newNode`, scan existing step
 * nodes for one whose outputSchema declares a field of the same name. If
 * exactly one match exists, bind. If 0 or >1, skip — user picks manually.
 */
function autoBindNewNode(
  newNode: WorkflowNode,
  existingNodes: WorkflowNode[],
  catalog: ReturnType<typeof useStepCatalog>,
  customStepDefs?: Record<string, CustomAiStep | null>,
): WorkflowNode {
  if (newNode.type !== "step" || !newNode.stepType) return newNode;

  let required: InputFields = {};
  const outputSchemaForCandidate = (n: WorkflowNode): Record<string, unknown> => {
    if (n.type !== "step" || !n.stepType) return {};
    if (n.stepType === "custom-ai") {
      const id = (n.config as { customStepId?: unknown } | undefined)?.customStepId;
      const def = typeof id === "string" && id ? customStepDefs?.[id] : undefined;
      return def ? (customStepToShape(def).outputSchema ?? {}) : {};
    }
    return catalog[n.stepType]?.outputSchema ?? {};
  };

  if (newNode.stepType === "custom-ai") {
    const customId = (newNode.config as { customStepId?: unknown } | undefined)?.customStepId;
    const def = typeof customId === "string" && customId ? customStepDefs?.[customId] : undefined;
    if (!def) return newNode; // def not loaded yet — skip auto-bind, user can connect manually
    required = customStepToShape(def).inputFields;
  } else {
    required = catalog[newNode.stepType]?.inputFields ?? {};
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
  stepRunStates?: Record<string, StepRunState>;
  /**
   * Pan and zoom-in to a node. `tick` lets the same nodeId re-trigger the
   * effect when clicked twice in a row (selection alone wouldn't change).
   */
  focusRequest?: { nodeId: string; tick: number };
}

function toReactWorkflowNodes(
  flow: WorkflowGraph,
  selectedId: string | null,
  runStates?: Record<string, StepRunState>,
): Node[] {
  return flow.nodes.map(n => ({
    id: n.id,
    type: KNOWN_NODE_TYPES.has(n.type) ? n.type : "step",
    position: n.position ?? { x: 0, y: 0 },
    data: n.type === "step"
      ? {
          displayName: n.displayName ?? n.stepType ?? "Step",
          stepType: n.stepType ?? "",
          config: n.config ?? {},
          inputs: n.inputs ?? {},
          runState: runStates?.[n.id],
        }
      : {
          displayName: n.displayName ?? n.type,
          ...(n.type === "end" ? { outcome: n.outcome } : {}),
          ...(n.config ?? {}),
        },
    selected: n.id === selectedId,
    draggable: true,
    selectable: true,
  }));
}

function CanvasInner(p: CanvasProps) {
  const catalog = useStepCatalog();
  const customStepDefs = useCustomStepDefs(collectCustomStepIds(p.flow));
  const wrapper = useRef<HTMLDivElement>(null);
  const registry = useStepRegistry();
  const { screenToFlowPosition, setCenter, getZoom } = useReactFlow();

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
  const stepRunStatesRef = useRef(p.stepRunStates);
  onChangeRef.current = p.onChange;
  onSelectRef.current = p.onSelect;
  onEdgeSelectRef.current = p.onEdgeSelect;
  readOnlyRef.current = p.readOnly;
  flowRef.current = p.flow;
  selectedNodeIdRef.current = p.selectedNodeId;
  stepRunStatesRef.current = p.stepRunStates;

  const [nodes, setNodes, onNodesChangeInternal] = useNodesState<Node>(
    toReactWorkflowNodes(p.flow, p.selectedNodeId, p.stepRunStates),
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
  // Full signature including positions — used to drop no-op propagations
  // emitted by React Flow during initial measurement/fitView where the
  // rebuilt flow is identical to what we already sent up. Without this,
  // each such no-op still creates a new parent state ref and re-renders.
  const propagatedFullSigRef = useRef<string | null>(null);
  if (propagatedSigRef.current === null) {
    const sig = structuralSig(p.flow);
    propagatedSigRef.current = sig;
    lastSigRef.current = sig;
    propagatedFullSigRef.current = JSON.stringify(p.flow);
  }
  const lastSelectedRef = useRef<string | null>(p.selectedNodeId);
  // Track which nodes are currently in a user-initiated drag. RF emits
  // position changes during fitView / measurement with `dragging: false`
  // too, which would otherwise look like a "drag commit" and propagate.
  // We only commit a position when we previously saw dragging:true.
  const draggingNodesRef = useRef<Set<string>>(new Set());

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
      // Sync the full-sig ref to the external flow so the next propagate
      // call from RF (echoing back the same content) is recognized as a
      // no-op and skipped.
      propagatedFullSigRef.current = JSON.stringify(p.flow);
      setNodes(toReactWorkflowNodes(p.flow, p.selectedNodeId, p.stepRunStates));
      setEdges(toReactWorkflowEdges(p.flow));
    }
  }, [p.flow, p.selectedNodeId, p.stepRunStates, setNodes, setEdges]);

  /** Build a fresh WorkflowGraph from current internal RF state + previous flow's metadata. */
  const buildFlow = useCallback(
    (rfNodes: Node[], rfEdges: Edge[]): WorkflowGraph => buildFlowFromInternal(p.flow, rfNodes, rfEdges),
    [p.flow],
  );

  /** Propagate a change to the parent and remember its sig so the resync effect skips the echo. */
  const propagate = useCallback((next: WorkflowGraph) => {
    const fullSig = JSON.stringify(next);
    if (fullSig === propagatedFullSigRef.current) return;
    propagatedFullSigRef.current = fullSig;
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
    setNodes(toReactWorkflowNodes(next, selectedNodeIdRef.current, stepRunStatesRef.current));
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
      if (node.type === "trigger-manual" || node.type === "trigger-webhook" || node.type === "trigger-human") {
        // Allow deletion only if at least one other trigger remains.
        const remainingTriggers = flowNodes.filter((n) =>
          n.id !== node.id &&
          (n.type === "trigger-manual" || n.type === "trigger-webhook" || n.type === "trigger-human"),
        );
        if (remainingTriggers.length === 0) {
          blockedRemoval = { id: c.id, reason: "Cannot delete the only trigger — every flow needs at least one." };
          return false;
        }
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

    // Update per-node drag tracking. Only treat position-with-dragging:false
    // as meaningful if we previously observed dragging:true for that node —
    // otherwise it's a fitView / measurement echo, not a user commit.
    let meaningful = false;
    for (const c of filtered) {
      if (c.type === "remove") { meaningful = true; continue; }
      if (c.type !== "position") continue;
      const pc = c as { id?: string; dragging?: boolean };
      if (!pc.id) continue;
      if (pc.dragging === true) {
        draggingNodesRef.current.add(pc.id);
      } else if (pc.dragging === false && draggingNodesRef.current.has(pc.id)) {
        draggingNodesRef.current.delete(pc.id);
        meaningful = true;
      }
    }
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
    const stepType = ev.dataTransfer.getData("application/journeyman-step");
    const controlType = ev.dataTransfer.getData("application/journeyman-control");
    const triggerType = ev.dataTransfer.getData("application/journeyman-trigger");
    const position = screenToFlowPosition({ x: ev.clientX, y: ev.clientY });

    let newNode: WorkflowNode | null = null;
    if (stepType) {
      const def = registry.get(stepType);
      // Synthetic palette entries for custom AI steps use a unique
      // `custom-ai:<uuid>` stepType to avoid collisions in the palette.
      // The runtime only knows the bare `custom-ai` step — strip the
      // suffix so the node submits as the registered task type.
      const runtimeStepType = stepType.startsWith("custom-ai:") ? "custom-ai" : stepType;
      const base = newStepNode({
        stepType: runtimeStepType,
        displayName: def?.label ?? runtimeStepType,
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
      const controlDef = defaultControlCatalog.find(c => c.nodeType === controlType);
      newNode = {
        id: `${controlType}_${Math.random().toString(36).slice(2, 8)}`,
        type: controlType as WorkflowNodeType,
        displayName: controlDef?.label ?? controlType,
        config: {},
        position,
      };
    } else if (triggerType) {
      // Only one manual trigger is allowed per workflow.
      if (triggerType === "trigger-manual") {
        const flow = flowRef.current;
        if (flow.nodes.some(n => n.type === "trigger-manual")) {
          // eslint-disable-next-line no-console
          console.warn("[flow-editor] only one manual trigger is allowed per workflow");
          return;
        }
      }
      const defaultName =
        triggerType === "trigger-manual"  ? "Manual"
        : triggerType === "trigger-webhook" ? "Webhook"
        : "Human form";
      newNode = {
        id: `${triggerType}_${Math.random().toString(36).slice(2, 8)}`,
        type: triggerType as WorkflowNodeType,
        displayName: defaultName,
        config: {},
        position,
      };
    }
    if (!newNode) return;

    const flow = flowRef.current;
    const t0 = performance.now();
    newNode = autoBindNewNode(newNode, flow.nodes, catalog, customStepDefs);
    if (newNode && newNode.stepType === "custom-ai") {
      const cpId = (newNode.config as { customStepId?: unknown } | undefined)?.customStepId;
      const cpDef = typeof cpId === "string" ? customStepDefs[cpId] ?? null : null;
      newNode = autoPopulateCustomAiDefaults(newNode, cpDef);
    }
    const tBind = performance.now();
    // eslint-disable-next-line no-console
    console.log("[flow-editor] add node", {
      id: newNode.id,
      type: newNode.type,
      stepType: newNode.stepType,
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

  // Pan + zoom to a requested node. Triggered by FlowEditor when a link or
  // chip is clicked inside an issue message; selection alone doesn't move
  // the viewport, so without this an offscreen node looks ignored.
  useEffect(() => {
    const req = p.focusRequest;
    if (!req) return;
    const node = p.flow.nodes.find(n => n.id === req.nodeId);
    if (!node || !node.position) return;
    const approxW = 240;
    const approxH = 80;
    const cx = node.position.x + approxW / 2;
    const cy = node.position.y + approxH / 2;
    const zoom = Math.max(getZoom(), 1);
    setCenter(cx, cy, { zoom, duration: 250 });
  }, [p.focusRequest, p.flow.nodes, setCenter, getZoom]);

  const stableNodeTypes = useMemo(() => nodeTypes, []);
  const stableEdgeTypes = useMemo(() => edgeTypes, []);

  const highlightedEdgeIds = useMemo(
    () => edgesForForkJoinPair(p.flow, p.selectedNodeId ?? null),
    [p.flow, p.selectedNodeId],
  );
  const decoratedEdges = useMemo(
    () => edges.map(e => ({
      ...e,
      className: [e.className, highlightedEdgeIds.has(e.id) ? "je-edge--pair-highlight" : ""]
        .filter(Boolean).join(" "),
    })),
    [edges, highlightedEdgeIds],
  );

  return (
    <div ref={wrapper} className="je-editor__canvas" onDrop={handleDrop} onDragOver={handleDragOver}>
      <ReactFlow
        nodes={nodes}
        edges={decoratedEdges}
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
