import { useCallback, useMemo, useRef, useState } from "react";
import type { WorkflowEdge, WorkflowGraph } from "@journeyman/core";

export interface UseFlowEditorStateArgs {
  flow: WorkflowGraph;
  onChange: (flow: WorkflowGraph) => void;
  readOnly?: boolean;
}

export function useFlowEditorState(args: UseFlowEditorStateArgs) {
  const [selectedNodeId, setSelectedNodeIdState] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeIdState] = useState<string | null>(null);
  const readOnly = args.readOnly ?? false;

  const flowRef = useRef(args.flow);
  flowRef.current = args.flow;
  const onChangeRef = useRef(args.onChange);
  onChangeRef.current = args.onChange;

  const update = useCallback((mutator: (f: WorkflowGraph) => WorkflowGraph) => {
    if (readOnly) return;
    onChangeRef.current(mutator(flowRef.current));
  }, [readOnly]);

  const selectedNode = useMemo(
    () => args.flow.nodes.find(n => n.id === selectedNodeId) ?? null,
    [args.flow.nodes, selectedNodeId],
  );

  const selectedEdge = useMemo(
    () => args.flow.edges.find(e => e.id === selectedEdgeId) ?? null,
    [args.flow.edges, selectedEdgeId],
  );

  const setSelectedNodeId = useCallback((id: string | null) => {
    setSelectedNodeIdState(id);
    if (id) setSelectedEdgeIdState(null);
  }, []);

  const setSelectedEdgeId = useCallback((id: string | null) => {
    setSelectedEdgeIdState(id);
    if (id) setSelectedNodeIdState(null);
  }, []);

  const updateEdge = useCallback((next: WorkflowEdge) => {
    if (readOnly) return;
    const flow = flowRef.current;
    onChangeRef.current({
      ...flow,
      edges: flow.edges.map(e => e.id === next.id ? next : e),
    });
  }, [readOnly]);

  return {
    flow: args.flow,
    selectedNodeId, selectedNode,
    setSelectedNodeId,
    selectedEdgeId, selectedEdge,
    setSelectedEdgeId,
    updateEdge,
    update,
    readOnly,
  };
}
