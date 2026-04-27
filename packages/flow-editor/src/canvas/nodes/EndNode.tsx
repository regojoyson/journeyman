import { Handle, Position } from "@xyflow/react";

export function EndNode() {
  return (
    <div className="je-node je-node--terminal je-node--end">
      <Handle type="target" position={Position.Top} />
      <div className="je-node__icon">■</div>
      <div className="je-node__label">End</div>
    </div>
  );
}
