import { Handle, Position } from "@xyflow/react";
import { handleBlue } from "../handle-styles.ts";

export function StartNode() {
  return (
    <div className="je-node je-node--terminal je-node--start">
      <div className="je-node__icon">▶</div>
      <div className="je-node__label">Start</div>
      <Handle type="source" position={Position.Right} style={handleBlue} />
    </div>
  );
}
