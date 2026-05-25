import { Handle, Position } from "@xyflow/react";
import { handleBlue } from "../handle-styles.ts";

interface Data {
  displayName?: string;
}

export function TriggerManualNode({ data }: { data: Data }) {
  return (
    <div className="je-node je-node--trigger je-node--trigger-manual">
      <div className="je-node__row">
        <div className="je-node__icon">▶</div>
        <div className="je-node__text">
          <div className="je-node__label" title={data.displayName ?? "Manual"}>
            {data.displayName ?? "Manual"}
          </div>
          <div className="je-node__subtitle">Manual trigger</div>
        </div>
      </div>
      <Handle type="source" position={Position.Right} style={handleBlue} />
    </div>
  );
}
