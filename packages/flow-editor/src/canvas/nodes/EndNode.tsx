import { Handle, Position } from "@xyflow/react";
import { handleBlue } from "../handle-styles.ts";

export function EndNode() {
  return (
    <div className="je-node je-node--terminal je-node--end">
      <Handle type="target" position={Position.Left} style={handleBlue} />
      <div className="je-node__icon">■</div>
      <div className="je-node__label">End</div>
    </div>
  );
}
