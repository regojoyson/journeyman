import { Handle, Position, type NodeProps } from "@xyflow/react";
import { handleBlue } from "../handle-styles.ts";
import { NodeIssueBadges } from "./NodeIssueBadges.tsx";

export function SubflowNode(props: NodeProps) {
  const data = props.data as { displayName?: string; workflowName?: string };
  return (
    <div className="je-node je-node--subflow">
      <NodeIssueBadges nodeId={props.id} />
      <Handle type="target" position={Position.Left} style={handleBlue} />
      <div className="je-node__row">
        <div className="je-node__icon" style={{ background: "rgb(var(--color-accent) / 1)" }}>⊞</div>
        <div className="je-node__text">
          <div className="je-node__label">{data.displayName ?? "Subflow"}</div>
          <div className="je-node__subtitle">{data.workflowName ?? "—"}</div>
        </div>
      </div>
      <Handle type="source" position={Position.Right} style={handleBlue} />
    </div>
  );
}
