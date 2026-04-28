import { Handle, Position } from "@xyflow/react";
import { handleBlue } from "../handle-styles.ts";

export function GatewayAndNode() {
  return (
    <div className="je-node je-node--gateway je-node--and">
      <Handle type="target" position={Position.Left} style={handleBlue} />
      <div className="je-node__icon">+</div>
      <div className="je-node__label">AND</div>
      <Handle type="source" position={Position.Right} id="default" style={handleBlue} />
    </div>
  );
}
