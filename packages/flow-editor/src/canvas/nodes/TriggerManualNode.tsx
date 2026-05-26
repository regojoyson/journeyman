import { Handle, Position, type NodeProps } from "@xyflow/react";
import { handleBlue } from "../handle-styles.ts";
import { NodeIssueBadges } from "./NodeIssueBadges.tsx";

interface Data {
  displayName?: string;
}

export function TriggerManualNode(props: NodeProps) {
  const data = props.data as Data;
  return (
    <div className="je-node je-node--trigger je-node--trigger-manual">
      <NodeIssueBadges nodeId={props.id} />
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
