import { StartNode } from "./nodes/StartNode.tsx";
import { EndNode } from "./nodes/EndNode.tsx";
import { PhaseNode } from "./nodes/PhaseNode.tsx";
import { DefaultEdge } from "./edges/DefaultEdge.tsx";

export const nodeTypes = {
  start: StartNode,
  end: EndNode,
  phase: PhaseNode,
};

export const edgeTypes = {
  default: DefaultEdge,
};
