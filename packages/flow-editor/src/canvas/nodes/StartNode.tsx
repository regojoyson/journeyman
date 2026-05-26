import { Handle, Position, type NodeProps } from "@xyflow/react";
import { handleBlue } from "../handle-styles.ts";
import { NodeIssueBadges } from "./NodeIssueBadges.tsx";

export function StartNode(props: NodeProps) {
  return (
    <div className="je-node je-node--terminal je-node--start">
      <NodeIssueBadges nodeId={props.id} />
      <div className="je-node__icon">▶</div>
      <div className="je-node__label">Start</div>
      <Handle type="source" position={Position.Right} style={handleBlue} />
    </div>
  );
}
