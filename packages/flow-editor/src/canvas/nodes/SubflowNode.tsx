import { Handle, Position, type NodeProps } from "@xyflow/react";
import { handleBlue } from "../handle-styles.ts";

export function SubflowNode(props: NodeProps) {
  const data = props.data as { displayName?: string; workflowName?: string };
  return (
    <div className="je-node je-node--subflow">
      <Handle type="target" position={Position.Left} style={handleBlue} />
      <div className="je-node__row">
        <div className="je-node__icon" style={{ background: "#a29bfe" }}>⊞</div>
        <div className="je-node__text">
          <div className="je-node__label">{data.displayName ?? "Subflow"}</div>
          <div className="je-node__subtitle">{data.workflowName ?? "—"}</div>
        </div>
      </div>
      <Handle type="source" position={Position.Right} style={handleBlue} />
    </div>
  );
}
