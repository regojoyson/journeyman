import { Handle, Position, type NodeProps } from "@xyflow/react";
import { handleBlue } from "../handle-styles.ts";
import { NodeIssueBadges } from "./NodeIssueBadges.tsx";

interface Data {
  displayName?: string;
  outcome?: string;
}

export function EndNode(props: NodeProps) {
  const data = props.data as Data;
  const label = data.displayName ?? "End";
  const subtitle = data.outcome ? `Outcome: ${data.outcome}` : "End of workflow";
  return (
    <div className="je-node je-node--end">
      <NodeIssueBadges nodeId={props.id} />
      <Handle type="target" position={Position.Left} style={handleBlue} />
      <div className="je-node__row">
        <div className="je-node__icon">■</div>
        <div className="je-node__text">
          <div className="je-node__label" title={label}>{label}</div>
          <div className="je-node__subtitle" title={subtitle}>{subtitle}</div>
        </div>
      </div>
    </div>
  );
}
