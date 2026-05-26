import { Handle, Position, type NodeProps } from "@xyflow/react";
import { handleBlue } from "../handle-styles.ts";
import { NodeIssueBadges } from "./NodeIssueBadges.tsx";

interface Data {
  displayName?: string;
  formTitle?: string;
}

export function TriggerHumanNode(props: NodeProps) {
  const data = props.data as Data;
  const label = data.formTitle ?? data.displayName ?? "Form";
  return (
    <div className="je-node je-node--trigger je-node--trigger-human">
      <NodeIssueBadges nodeId={props.id} />
      <div className="je-node__row">
        <div className="je-node__icon">📝</div>
        <div className="je-node__text">
          <div className="je-node__label" title={label}>{label}</div>
          <div className="je-node__subtitle">Human form trigger</div>
        </div>
      </div>
      <Handle type="source" position={Position.Right} style={handleBlue} />
    </div>
  );
}
