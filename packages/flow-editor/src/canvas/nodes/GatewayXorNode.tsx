import { Handle, Position, type NodeProps } from "@xyflow/react";
import { handleBlue } from "../handle-styles.ts";
import { NodeIssueBadges } from "./NodeIssueBadges.tsx";

export function GatewayXorNode(props: NodeProps) {
  return (
    <div className="je-node je-node--gateway je-node--xor">
      <NodeIssueBadges nodeId={props.id} />
      <Handle type="target" position={Position.Left} style={handleBlue} />
      <div className="je-node__icon">×</div>
      <div className="je-node__label">XOR</div>
      <Handle type="source" position={Position.Right} id="default" style={handleBlue} />
    </div>
  );
}
