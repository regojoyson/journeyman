import { Handle, Position } from "@xyflow/react";

export function GatewayXorNode() {
  return (
    <div className="je-node je-node--gateway je-node--xor">
      <Handle type="target" position={Position.Top} />
      <div className="je-node__icon">×</div>
      <div className="je-node__label">XOR</div>
      <Handle type="source" position={Position.Bottom} id="default" />
    </div>
  );
}
