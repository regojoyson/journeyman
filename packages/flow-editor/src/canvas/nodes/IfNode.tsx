import { Handle, Position, type NodeProps } from "@xyflow/react";
import { handleBlue } from "../handle-styles.ts";
import { NodeIssueBadges } from "./NodeIssueBadges.tsx";

export function IfNode(props: NodeProps) {
  const data = props.data as { displayName?: string };
  return (
    <div className="je-node je-node--if">
      <NodeIssueBadges nodeId={props.id} />
      <Handle type="target" position={Position.Left} style={handleBlue} />
      <div className="je-node__row">
        <div className="je-node__icon" style={{ background: "#74b9ff" }}>?</div>
        <div className="je-node__text">
          <div className="je-node__label">{data.displayName ?? "If"}</div>
          <div className="je-node__subtitle">then / else</div>
        </div>
      </div>
      {/* Two outputs on the right edge with visible labels and spread vertical
          positions so the two branches read as distinct ports. */}
      <Handle type="source" position={Position.Right} id="then" style={{ ...handleBlue, top: "20%" }}>
        <span className="je-node__handle-label je-node__handle-label--then">then</span>
      </Handle>
      <Handle type="source" position={Position.Right} id="else" style={{ ...handleBlue, top: "80%" }}>
        <span className="je-node__handle-label je-node__handle-label--else">else</span>
      </Handle>
    </div>
  );
}
