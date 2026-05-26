import { Handle, Position, type NodeProps } from "@xyflow/react";
import { handleBlue } from "../handle-styles.ts";
import { NodeIssueBadges } from "./NodeIssueBadges.tsx";

export function TimerNode(props: NodeProps) {
  const data = props.data as { displayName?: string; duration?: string };
  return (
    <div className="je-node je-node--timer">
      <NodeIssueBadges nodeId={props.id} />
      <Handle type="target" position={Position.Left} style={handleBlue} />
      <div className="je-node__row">
        <div className="je-node__icon" style={{ background: "#fdcb6e" }}>⏱</div>
        <div className="je-node__text">
          <div className="je-node__label">{data.displayName ?? "Wait"}</div>
          <div className="je-node__subtitle">{data.duration ?? "—"}</div>
        </div>
      </div>
      <Handle type="source" position={Position.Right} style={handleBlue} />
    </div>
  );
}
