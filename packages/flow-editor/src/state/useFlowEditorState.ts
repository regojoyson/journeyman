import { useCallback, useMemo, useState } from "react";
import type { FlowGraph } from "@journeyman/core";

export interface UseFlowEditorStateArgs {
  flow: FlowGraph;
  onChange: (flow: FlowGraph) => void;
}

export function useFlowEditorState(args: UseFlowEditorStateArgs) {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const update = useCallback((mutator: (f: FlowGraph) => FlowGraph) => {
    args.onChange(mutator(args.flow));
  }, [args]);

  const selectedNode = useMemo(
    () => args.flow.nodes.find(n => n.id === selectedNodeId) ?? null,
    [args.flow.nodes, selectedNodeId],
  );

  return {
    flow: args.flow,
    selectedNodeId, selectedNode,
    setSelectedNodeId,
    update,
  };
}
